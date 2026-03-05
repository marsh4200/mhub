from __future__ import annotations

from datetime import timedelta
from typing import Any, Dict
import json
import logging

import aiohttp
import async_timeout

from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import DEFAULT_SCAN_INTERVAL

_LOGGER = logging.getLogger(__name__)


class MHUBDataUpdateCoordinator(DataUpdateCoordinator[Dict[str, Any]]):
    """Manage polling data from the MHUB device and detect capabilities.

    This coordinator polls MHUB-OS HTTP APIs and normalises data for entities.
    We keep this resilient because MHUB firmware versions vary.
    """

    def __init__(self, hass, entry):
        self.hass = hass
        self.host: str = entry.data["host"]

        super().__init__(
            hass,
            _LOGGER,
            name="MHUB Data Coordinator",
            update_interval=timedelta(seconds=DEFAULT_SCAN_INTERVAL),
        )

        self.data: Dict[str, Any] = {
            "info": {},
            "state": {},
            "power": {},
            "zones_config": [],
            "groups": [],
            "sequences": [],
        }

        self.model_info: Dict[str, Any] = {
            "model": None,
            "api_version": None,
            "firmware": None,
            "supports_audio": False,
            "supports_volume": False,
            "supports_power_api": False,
            "inputs": 0,
            "outputs": 0,
            "power_state": None,
        }

    @property
    def base_url(self) -> str:
        return f"http://{self.host}/api"

    async def _async_update_data(self) -> Dict[str, Any]:
        session = async_get_clientsession(self.hass)
        headers = {"User-Agent": "HomeAssistant-MHUB", "Accept": "application/json"}

        info_url = f"{self.base_url}/data/100/"
        state_url = f"{self.base_url}/data/200/"
        power_url = f"{self.base_url}/data/0/"

        zones_url = f"{self.base_url}/data/102/"
        groups_url = f"{self.base_url}/data/103/"
        sequences_url = f"{self.base_url}/data/202/"

        try:
            async with async_timeout.timeout(12):
                info = await self._get_json(session, info_url, headers)
                state = await self._get_json(session, state_url, headers)

                power = await self._get_json(session, power_url, headers, allow_failure=True)
                zones = await self._get_json(session, zones_url, headers, allow_failure=True)
                groups = await self._get_json(session, groups_url, headers, allow_failure=True)
                sequences = await self._get_json(session, sequences_url, headers, allow_failure=True)

            if not info or "data" not in info:
                raise UpdateFailed("Empty or invalid /api/data/100 response from MHUB")

            if not state or "data" not in state:
                raise UpdateFailed("Empty or invalid /api/data/200 response from MHUB")

            self.data = {
                "info": info.get("data", {}) or {},
                "state": state.get("data", {}) or {},
                "power": (power.get("data", {}) if isinstance(power, dict) else {}) or {},
                "zones_config": self._extract_zones(zones),
                "groups": self._extract_groups(groups),
                "sequences": self._extract_sequences(sequences),
            }

            self._detect_model()

            _LOGGER.debug("MHUB data updated: %s", self.model_info)

            return self.data

        except Exception as exc:
            _LOGGER.error("MHUB update failed: %s", exc)
            raise UpdateFailed(str(exc)) from exc

    async def _get_json(
        self,
        session: aiohttp.ClientSession,
        url: str,
        headers: Dict[str, str],
        allow_failure: bool = False,
    ) -> Dict[str, Any]:
        try:
            async with session.get(url, headers=headers, allow_redirects=True) as resp:
                text = await resp.text()

                if resp.status != 200:
                    if allow_failure:
                        _LOGGER.debug(
                            "Optional call %s failed HTTP %s: %s",
                            url,
                            resp.status,
                            text[:200],
                        )
                        return {}
                    raise UpdateFailed(f"HTTP {resp.status} for {url}")

                try:
                    return await resp.json(content_type=None)
                except Exception:
                    return json.loads(text)

        except Exception as exc:
            if allow_failure:
                _LOGGER.debug("Optional call %s failed: %s", url, exc)
                return {}
            raise

    def _detect_model(self) -> None:
        """Populate model_info based on /api/data/100 and /api/data/0."""
        try:
            info = self.data.get("info", {}) or {}

            # Support BOTH MHUB API formats
            os_data = info.get("os", {}) or {}
            mhub_data = info.get("mhub", {}) or {}

            io_data = info.get("io_data", {}) or {}

            model_name = (
                os_data.get("product_code")
                or mhub_data.get("mhub_official_name")
                or os_data.get("mhub_name")
                or mhub_data.get("mhub_name")
            )

            api_version = os_data.get("api") or mhub_data.get("api")

            fw = (
                os_data.get("os_firmware")
                or mhub_data.get("mhub-os_firmware")
            )

            os_version = (
                os_data.get("os_version")
                or mhub_data.get("mhub-os_version")
            )

            if fw and os_version:
                firmware = f"{fw} (OS {os_version})"
            else:
                firmware = fw or os_version

            self.model_info["model"] = model_name
            self.model_info["api_version"] = api_version
            self.model_info["firmware"] = firmware

            audio_out = io_data.get("output_audio") or io_data.get("output_audio_mirror") or []
            audio_in = io_data.get("input_audio") or io_data.get("input_audio_mirror") or []

            self.model_info["supports_audio"] = bool(audio_out or audio_in)

            video_in = io_data.get("input_video") or []
            video_out = io_data.get("output_video") or []

            self.model_info["inputs"] = self._extract_ports(video_in)
            self.model_info["outputs"] = self._extract_ports(video_out)

            name = (model_name or "").upper()

            supports_volume = any(
                key in name
                for key in ("MHUBAUDIO", "MZMA", "66100A")
            )

            self.model_info["supports_volume"] = (
                supports_volume and self.model_info["supports_audio"]
            )

            power_data = self.data.get("power", {}) or {}

            p = power_data.get("power")
            if p is None:
                p = power_data.get("Power")

            if p is not None:
                self.model_info["power_state"] = bool(p)
                self.model_info["supports_power_api"] = True
            else:
                self.model_info["power_state"] = None
                self.model_info["supports_power_api"] = False

        except Exception as exc:
            _LOGGER.warning("Model detection error: %s", exc)

    @staticmethod
    def _extract_ports(blocks: list[dict]) -> int:
        if not blocks:
            return 0

        first = blocks[0]
        ports = first.get("ports")

        try:
            return int(ports)
        except Exception:
            labels = first.get("labels") or []
            return len(labels)

    @staticmethod
    def _extract_zones(payload: Dict[str, Any]) -> list[dict[str, Any]]:
        if not payload:
            return []

        data = payload.get("data")

        if isinstance(data, list):
            return data

        if isinstance(data, dict) and "data" in data and isinstance(data["data"], list):
            return data["data"]

        if isinstance(payload, list):
            return payload

        return data if isinstance(data, list) else []

    @staticmethod
    def _extract_groups(payload: Dict[str, Any]) -> list[dict[str, Any]]:
        if not payload:
            return []

        data = payload.get("data", payload)

        if isinstance(data, dict):
            groups = data.get("groups") or data.get("Groups")
            if isinstance(groups, list):
                return groups

        if isinstance(data, list):
            return data

        return []

    @staticmethod
    def _extract_sequences(payload: Dict[str, Any]) -> list[dict[str, Any]]:
        if not payload:
            return []

        data = payload.get("data", payload)

        if isinstance(data, dict):
            seq = (
                data.get("sequences_functions")
                or data.get("sequences")
                or data.get("functions")
            )

            if isinstance(seq, list):
                return seq

            if isinstance(seq, dict):
                out: list[dict[str, Any]] = []

                for k in ("sequences", "functions", "Sequences", "Functions"):
                    part = seq.get(k)
                    if isinstance(part, list):
                        out.extend(part)

                return out

        if isinstance(data, list):
            return data

        return []

    def video_output_labels(self) -> dict[str, str]:
        mapping: dict[str, str] = {}

        io_data = (self.data.get("info", {}) or {}).get("io_data", {}) or {}
        outs = io_data.get("output_video") or []

        try:
            for block in outs:
                for lbl in block.get("labels", []):
                    out_id = str(lbl.get("id")).lower()
                    label = lbl.get("label") or f"Output {lbl.get('id')}"
                    mapping[out_id] = label

        except Exception as exc:
            _LOGGER.warning("Failed to parse output labels: %s", exc)

        return mapping

    def video_input_labels(self) -> dict[str, str]:
        mapping: dict[str, str] = {}

        io_data = (self.data.get("info", {}) or {}).get("io_data", {}) or {}
        ins = io_data.get("input_video") or []

        try:
            for block in ins:
                for lbl in block.get("labels", []):
                    in_id = str(lbl.get("id"))
                    label = lbl.get("label") or f"Input {lbl.get('id')}"
                    mapping[in_id] = label

        except Exception as exc:
            _LOGGER.warning("Failed to parse input labels: %s", exc)

        return mapping

    def zones(self) -> list[dict[str, Any]]:
        return (self.data.get("state", {}) or {}).get("zones", []) or []

    def zones_config(self) -> list[dict[str, Any]]:
        return self.data.get("zones_config", []) or []

    def output_to_zone_label(self) -> dict[str, str]:
        out: dict[str, str] = {}

        for z in self.zones_config():
            label = z.get("zone_label") or z.get("label") or z.get("zone_id")

            for o in z.get("outputs", []) or []:
                oid = str(o.get("output_id", "")).lower()

                if oid:
                    out[oid] = str(label)

        return out

    def groups(self) -> list[dict[str, Any]]:
        return self.data.get("groups", []) or []

    def sequences(self) -> list[dict[str, Any]]:
        return self.data.get("sequences", []) or []

    def power_state(self) -> bool | None:
        return self.model_info.get("power_state")

    def diagnostic_attrs(self) -> dict[str, Any]:
        return {
            "model": self.model_info.get("model"),
            "firmware": self.model_info.get("firmware"),
            "api_version": self.model_info.get("api_version"),
            "inputs": self.model_info.get("inputs"),
            "outputs": self.model_info.get("outputs"),
            "supports_volume": self.model_info.get("supports_volume"),
            "supports_power_api": self.model_info.get("supports_power_api"),
        }