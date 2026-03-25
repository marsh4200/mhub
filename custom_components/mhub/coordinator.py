from __future__ import annotations

import asyncio
from datetime import timedelta
import json
import logging
from typing import Any

import aiohttp
import async_timeout

from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import MhubApi
from .const import DEFAULT_SCAN_INTERVAL

_LOGGER = logging.getLogger(__name__)


class MHUBDataUpdateCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Manage polling data from the MHUB device and expose derived mappings."""

    def __init__(self, hass, entry):
        self.hass = hass
        self.entry = entry
        self.host: str = entry.data["host"]
        self.api = MhubApi(self.host, async_get_clientsession(hass))

        super().__init__(
            hass,
            _LOGGER,
            name="MHUB Data Coordinator",
            update_interval=timedelta(seconds=DEFAULT_SCAN_INTERVAL),
        )

        self.data: dict[str, Any] = {
            "info": {},
            "state": {},
            "power": {},
            "zones_config": [],
            "groups": [],
            "sequences": [],
            "stacked": False,
            "sources": {},
            "zones": [],
            "device_info": {},
            "ir_devices": {},
            "ir_port_to_output": {},
            "output_to_zone": {},
            "cec_commands": [],
        }

        self.model_info: dict[str, Any] = {
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

        self._static_cache: dict[str, Any] = {}
        self._cache_timestamp: dict[str, float] = {}

    @property
    def base_url(self) -> str:
        return f"http://{self.host}/api"

    async def _async_update_data(self) -> dict[str, Any]:
        headers = {"User-Agent": "HomeAssistant-MHUB", "Accept": "application/json"}

        try:
            async with async_timeout.timeout(12):
                info = await self.api.get_system_info()

                if not info or "data" not in info:
                    raise UpdateFailed("Empty or invalid /api/data/100 response from MHUB")

                info_data = info.get("data", {}) or {}
                stack_info = info_data.get("stack", {}) or {}
                stacked = bool(stack_info.get("stack_status", False))

                state = await self.api.get_state(stacked)
                if not state or "data" not in state:
                    raise UpdateFailed("Empty or invalid MHUB state response")

                power = await self._get_json(
                    self.base_url + "/data/0/",
                    headers,
                    allow_failure=True,
                )

                zones = await self.api.get_zones()
                groups = await self.api.get_groups()
                sequences = await self.api.get_sequences()

                sources = await self._get_cached_sources(info_data)
                zones_config = self._extract_zones(zones)
                zones_state = (state.get("data", {}) or {}).get("zones", []) or []
                output_to_zone = self._build_output_to_zone(zones_config)
                ir_devices, ir_port_to_output = await self._get_ir_devices(info_data, stacked)
                cec_commands = await self._get_cached_cec_commands()
                device_info = await self._get_cached_device_info(info_data)

            self.data = {
                "info": info_data,
                "state": state.get("data", {}) or {},
                "power": (power.get("data", {}) if isinstance(power, dict) else {}) or {},
                "zones_config": zones_config,
                "groups": self._extract_groups(groups),
                "sequences": self._extract_sequences(sequences),
                "stacked": stacked,
                "sources": sources,
                "zones": zones_state,
                "zones_state": zones_state,
                "device_info": device_info,
                "ir_devices": ir_devices,
                "ir_port_to_output": ir_port_to_output,
                "output_to_zone": output_to_zone,
                "cec_commands": cec_commands,
            }

            self._detect_model()
            _LOGGER.debug("MHUB data updated: %s", self.model_info)
            return self.data

        except Exception as exc:
            _LOGGER.error("MHUB update failed: %s", exc)
            raise UpdateFailed(str(exc)) from exc

    async def _get_json(
        self,
        url: str,
        headers: dict[str, str],
        allow_failure: bool = False,
    ) -> dict[str, Any]:
        session = async_get_clientsession(self.hass)
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
                    return json.loads(text)

        except Exception:
            if allow_failure:
                return {}
            raise

    async def _get_cached_sources(self, info_data: dict[str, Any]) -> dict[str, str]:
        cache_key = "sources"
        if self._is_cache_valid(cache_key, 300):
            return self._static_cache[cache_key]

        sources: dict[str, str] = {}
        io_data = info_data.get("io_data", {}) or {}
        for group in io_data.get("input_video", []) or []:
            for label in group.get("labels", []) or []:
                input_id = label.get("id")
                input_label = label.get("label")
                if input_id is not None and input_label:
                    sources[str(input_id)] = str(input_label)

        self._static_cache[cache_key] = sources
        self._cache_timestamp[cache_key] = asyncio.get_event_loop().time()
        return sources

    async def _get_cached_device_info(self, info_data: dict[str, Any]) -> dict[str, Any]:
        cache_key = "device_info"
        if cache_key in self._static_cache:
            return self._static_cache[cache_key]

        mhub_info = info_data.get("os") or info_data.get("mhub", {})
        device_info = {
            "api_version": mhub_info.get("api"),
            "model": mhub_info.get("product_code") or mhub_info.get("mhub_official_name", "MHUB"),
            "name": mhub_info.get("mhub_name", "MHUB"),
            "serial_number": mhub_info.get("serial_number"),
            "firmware": mhub_info.get("firmware") or mhub_info.get("mhub_firmware"),
            "os_firmware": mhub_info.get("os_firmware") or mhub_info.get("mhub-os_firmware"),
            "os_version": mhub_info.get("os_version") or mhub_info.get("mhub-os_version"),
            "unit_id": mhub_info.get("unit_id"),
            "ip_address": mhub_info.get("ip_address") or self.host,
        }
        self._static_cache[cache_key] = device_info
        return device_info

    async def _get_cached_cec_commands(self) -> list[dict[str, Any]]:
        cache_key = "cec_commands"
        if cache_key in self._static_cache:
            return self._static_cache[cache_key]

        try:
            payload = await self.api.get_cec_commands()
            commands = (payload.get("data", {}) or {}).get("cecpack", []) or []
        except Exception as exc:
            _LOGGER.debug("Unable to fetch CEC commands: %s", exc)
            commands = []

        self._static_cache[cache_key] = commands
        return commands

    async def _get_ir_devices(
        self, info_data: dict[str, Any], stacked: bool
    ) -> tuple[dict[str, Any], dict[int, str]]:
        cache_key = f"ir_devices_{'stacked' if stacked else 'single'}"
        if cache_key in self._static_cache:
            cached = self._static_cache[cache_key]
            return cached["ir_devices"], cached["ir_port_to_output"]

        ir_devices: dict[str, Any] = {}
        ir_port_to_output: dict[int, str] = {}

        io_data = info_data.get("io_data", {}) or {}
        ir_info = io_data.get("ir") or {}
        backwards = ir_info.get("backwards") or {}
        forwards = ir_info.get("forwards") or {}

        backwards_start = self._safe_int(backwards.get("start_id"))
        forwards_start = self._safe_int(forwards.get("start_id"))
        forwards_ports = self._safe_int(forwards.get("ports"), 0)

        if not ir_info:
            return ir_devices, ir_port_to_output

        try:
            packs = await self.api.get_ir_packs(stacked)
        except Exception as exc:
            _LOGGER.debug("Unable to fetch IR pack summary: %s", exc)
            return ir_devices, ir_port_to_output

        pack_groups = packs.get("data", [])
        if not stacked:
            pack_groups = [packs.get("data")]

        for group in pack_groups:
            if not group:
                continue

            if group.get("avr") and forwards_start is not None:
                avr_port = forwards_start + forwards_ports
                ir_port_to_output[avr_port] = "a"

            for port_group in ("input", "output", "global"):
                ports = group.get(port_group, [])
                if not isinstance(ports, list):
                    continue

                for index, port in enumerate(ports):
                    if not port:
                        continue

                    has_ir_pack = bool(port.get("irpack"))
                    pid = self._resolve_ir_port_id(port_group, port, index, backwards_start, forwards_start)
                    if pid is None:
                        continue

                    if port_group == "output":
                        output_id = str(port.get("id", "")).lower()
                        if output_id:
                            ir_port_to_output[pid] = output_id

                    if not has_ir_pack:
                        continue

                    try:
                        details = await self.api.get_ir_pack_details(pid, stacked)
                    except Exception as exc:
                        _LOGGER.debug("Unable to fetch IR pack details for port %s: %s", pid, exc)
                        continue

                    pack_data = details.get("data") or {}
                    if not pack_data:
                        continue

                    pack_data["_port_type"] = port_group
                    pack_data["_port_id"] = pid
                    ir_devices[f"{port_group}_{pid}"] = pack_data

        self._static_cache[cache_key] = {
            "ir_devices": ir_devices,
            "ir_port_to_output": ir_port_to_output,
        }
        return ir_devices, ir_port_to_output

    @staticmethod
    def _resolve_ir_port_id(
        port_group: str,
        port: dict[str, Any],
        index: int,
        backwards_start: int | None,
        forwards_start: int | None,
    ) -> int | None:
        if port_group == "input" and backwards_start is not None:
            return backwards_start + index
        if port_group == "output" and forwards_start is not None:
            return forwards_start + index
        if port_group == "global":
            try:
                return int(port.get("id"))
            except (TypeError, ValueError):
                return None
        return None

    @staticmethod
    def _build_output_to_zone(zones: list[dict[str, Any]]) -> dict[str, str]:
        mapping: dict[str, str] = {}
        for zone in zones:
            zone_id = zone.get("zone_id")
            for output in zone.get("outputs", []) or []:
                output_id = str(output.get("output_id", "")).lower()
                if output_id and zone_id:
                    mapping[output_id] = str(zone_id)
        return mapping

    @staticmethod
    def _safe_int(value: Any, default: int | None = None) -> int | None:
        try:
            return int(value)
        except (TypeError, ValueError):
            return default

    def _is_cache_valid(self, key: str, ttl: int) -> bool:
        if key not in self._static_cache or key not in self._cache_timestamp:
            return False
        age = asyncio.get_event_loop().time() - self._cache_timestamp[key]
        return age < ttl

    def clear_cache(self) -> None:
        self._static_cache.clear()
        self._cache_timestamp.clear()

    def _detect_model(self) -> None:
        try:
            info = self.data.get("info", {}) or {}
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

            fw = os_data.get("os_firmware") or mhub_data.get("mhub-os_firmware")
            os_version = os_data.get("os_version") or mhub_data.get("mhub-os_version")
            firmware = f"{fw} (OS {os_version})" if fw and os_version else fw or os_version

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
            supports_volume = any(key in name for key in ("MHUBAUDIO", "MZMA", "66100A"))
            self.model_info["supports_volume"] = supports_volume and self.model_info["supports_audio"]

            power_data = self.data.get("power", {}) or {}
            power_state = power_data.get("power")
            if power_state is None:
                power_state = power_data.get("Power")

            if power_state is not None:
                self.model_info["power_state"] = bool(power_state)
                self.model_info["supports_power_api"] = True
            else:
                self.model_info["power_state"] = None
                self.model_info["supports_power_api"] = False

        except Exception as exc:
            _LOGGER.warning("Model detection error: %s", exc)

    @staticmethod
    def _extract_ports(blocks: list[dict[str, Any]]) -> int:
        if not blocks:
            return 0
        first = blocks[0]
        ports = first.get("ports")
        try:
            return int(ports)
        except Exception:
            return len(first.get("labels") or [])

    @staticmethod
    def _extract_zones(payload: dict[str, Any]) -> list[dict[str, Any]]:
        if not payload:
            return []
        data = payload.get("data")
        if isinstance(data, list):
            return data
        if isinstance(data, dict) and "data" in data and isinstance(data["data"], list):
            return data["data"]
        if isinstance(payload, list):
            return payload
        return []

    @staticmethod
    def _extract_groups(payload: dict[str, Any]) -> list[dict[str, Any]]:
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
    def _extract_sequences(payload: dict[str, Any]) -> list[dict[str, Any]]:
        if not payload:
            return []
        data = payload.get("data", payload)
        if isinstance(data, dict):
            seq = data.get("sequences_functions") or data.get("sequences") or data.get("functions")
            if isinstance(seq, list):
                return seq
            if isinstance(seq, dict):
                out: list[dict[str, Any]] = []
                for key in ("sequences", "functions", "Sequences", "Functions"):
                    part = seq.get(key)
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
                for lbl in block.get("labels", []) or []:
                    out_id = str(lbl.get("id")).lower()
                    label = lbl.get("label") or f"Output {lbl.get('id')}"
                    mapping[out_id] = label
        except Exception as exc:
            _LOGGER.warning("Failed to parse output labels: %s", exc)
        return mapping

    def video_input_labels(self) -> dict[str, str]:
        return self.data.get("sources", {}) or {}

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
            "stacked": self.data.get("stacked", False),
        }
