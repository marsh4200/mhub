from __future__ import annotations

from datetime import timedelta
from typing import Any, Dict
import json
import logging

import aiohttp
import async_timeout

from homeassistant.core import HomeAssistant
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .const import DOMAIN, DEFAULT_SCAN_INTERVAL

_LOGGER = logging.getLogger(__name__)


class MHUBDataUpdateCoordinator(DataUpdateCoordinator[Dict[str, Any]]):
    """Manage polling data from the MHUB device and detect capabilities."""

    def __init__(self, hass: HomeAssistant, entry):
        self.hass = hass
        self.host: str = entry.data["host"]

        super().__init__(
            hass,
            _LOGGER,
            name="MHUB Data Coordinator",
            update_interval=timedelta(seconds=DEFAULT_SCAN_INTERVAL),
        )

        # Structure:
        #   info  -> /api/data/100/ "data"
        #   state -> /api/data/200/ "data"
        #   power -> /api/data/0/   "data"
        self.data: Dict[str, Any] = {"info": {}, "state": {}, "power": {}}

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
        """Fetch data from MHUB."""
        session = async_get_clientsession(self.hass)
        headers = {"User-Agent": "HomeAssistant-MHUB", "Accept": "application/json"}

        info_url = f"{self.base_url}/data/100/"
        state_url = f"{self.base_url}/data/200/"
        power_url = f"{self.base_url}/data/0/"

        try:
            async with async_timeout.timeout(10):
                info = await self._get_json(session, info_url, headers)
                state = await self._get_json(session, state_url, headers)
                power = await self._get_json(session, power_url, headers, allow_failure=True)

            if not info or "data" not in info:
                raise UpdateFailed("Empty or invalid /api/data/100 response from MHUB")
            if not state or "data" not in state:
                raise UpdateFailed("Empty or invalid /api/data/200 response from MHUB")

            self.data = {
                "info": info.get("data", {}),
                "state": state.get("data", {}),
                "power": power.get("data", {}) if isinstance(power, dict) else {},
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
        """GET a URL and return JSON with robust parsing."""
        try:
            async with session.get(url, headers=headers, allow_redirects=True) as resp:
                text = await resp.text()
                if resp.status != 200:
                    if allow_failure:
                        _LOGGER.debug("Optional call %s failed HTTP %s: %s", url, resp.status, text[:200])
                        return {}
                    raise UpdateFailed(f"HTTP {resp.status} for {url}")
                try:
                    return await resp.json(content_type=None)
                except Exception:
                    # Try manual JSON
                    return json.loads(text)
        except Exception as exc:
            if allow_failure:
                _LOGGER.debug("Optional call %s failed: %s", url, exc)
                return {}
            raise

    # ---- Capability / helpers -------------------------------------------------

    def _detect_model(self) -> None:
        """Populate model_info based on /api/data/100 and /api/data/0."""
        try:
            info = self.data.get("info", {})
            mhub = info.get("mhub", {}) or {}
            io_data = info.get("io_data", {}) or {}

            model_name = mhub.get("mhub_official_name") or mhub.get("mhub_name")
            api_version = mhub.get("api")
            firmware = mhub.get("mhub-os_version") or mhub.get("mhub_firmware")

            self.model_info["model"] = model_name
            self.model_info["api_version"] = api_version
            self.model_info["firmware"] = firmware

            # Audio presence
            audio_out = io_data.get("output_audio") or io_data.get("output_audio_mirror") or []
            audio_in = io_data.get("input_audio") or io_data.get("input_audio_mirror") or []
            self.model_info["supports_audio"] = bool(audio_out or audio_in)

            # Video input/output counts
            video_in = io_data.get("input_video") or []
            video_out = io_data.get("output_video") or []

            self.model_info["inputs"] = self._extract_ports(video_in)
            self.model_info["outputs"] = self._extract_ports(video_out)

            # Volume support (from API doc: MHUBAUDIO6455, MZMA6455, MHUB44100A, MHUB66100A)
            # We use heuristics on official name.
            name = (model_name or "").upper()
            supports_volume = any(
                key in name
                for key in ("AUDIO (6X4)", "MULTI ZONE AMP", "44100A", "66100A", "MZMA6455", "MHUBAUDIO")
            )
            self.model_info["supports_volume"] = supports_volume and self.model_info["supports_audio"]

            # Power state from /api/data/0/
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
        """Try to determine number of ports from io_data."""
        if not blocks:
            return 0
        # Most MHUBs report 'ports' on the first descriptor
        first = blocks[0]
        ports = first.get("ports")
        try:
            return int(ports)
        except Exception:
            # fallback to count labels if present
            labels = first.get("labels") or []
            return len(labels)

    # ---- Convenience accessors used by entities --------------------------------

    def video_output_labels(self) -> dict[str, str]:
        """Return mapping 'a' -> 'Lounge TV', ..."""
        mapping: dict[str, str] = {}
        io_data = self.data.get("info", {}).get("io_data", {}) or {}
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
        """Return mapping '1' -> 'Apple TV', ..."""
        mapping: dict[str, str] = {}
        io_data = self.data.get("info", {}).get("io_data", {}) or {}
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
        """Return the 'zones' list from /api/data/200/."""
        return self.data.get("state", {}).get("zones", []) or []

    def power_state(self) -> bool | None:
        """Return True/False if known, else None."""
        return self.model_info.get("power_state")
