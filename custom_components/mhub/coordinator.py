from __future__ import annotations

import asyncio
from datetime import timedelta
import hashlib
import json
import logging
import time
from typing import Any

from homeassistant.helpers.aiohttp_client import async_create_clientsession
from homeassistant.helpers.storage import Store
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed

from .api import MhubApi, MhubApiError
from .const import DEFAULT_SCAN_INTERVAL, DOMAIN

_LOGGER = logging.getLogger(__name__)

# Missed polls tolerated before entities are marked unavailable (rides out a
# single slow answer instead of greying every button out for 5 seconds).
POLL_GRACE = 2

# IR packs / CEC commands barely ever change, so they are re-read on a slow
# timer -- but every minute for the first 10 minutes after (re)connecting, so a
# hub that was still starting up when we first asked gets asked again.
STATIC_TTL = 900
STATIC_TTL_SETTLING = 60
SETTLE_WINDOW = 600
STATIC_RETRY = 30
# After this many failed attempts, stop insisting on a complete IR read and
# take whatever ports do answer (previous behaviour).
STATIC_STRICT_ATTEMPTS = 5

# Never auto-reload the entry more often than this.
AUTO_RELOAD_MIN_INTERVAL = 300

STORAGE_VERSION = 1

# What is needed to rebuild every entity without the hub answering.
_SNAPSHOT_KEYS = (
    "info",
    "power",
    "zones_config",
    "groups",
    "sequences",
    "stacked",
    "sources",
    "device_info",
    "ir_devices",
    "ir_port_to_output",
    "output_to_zone",
    "cec_commands",
)


def snapshot_store(hass, entry_id: str) -> Store:
    """Last known hub layout, kept in .storage so setup never needs the hub."""
    return Store(hass, STORAGE_VERSION, f"{DOMAIN}.{entry_id}")


class MHUBDataUpdateCoordinator(DataUpdateCoordinator[dict[str, Any]]):
    """Manage polling data from the MHUB device and expose derived mappings."""

    def __init__(self, hass, entry):
        self.hass = hass
        self.entry = entry
        self.host: str = entry.data["host"]
        # Own session (own connection pool): it is closed and rebuilt with the
        # config entry, so a reload is a genuinely clean reconnect.
        self.api = MhubApi(self.host, async_create_clientsession(hass))

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

        self._store = snapshot_store(hass, entry.entry_id)
        # True once self.data holds a usable hub layout (live or from storage).
        self.has_topology = False
        # Signature of the layout the entities were built from (set by setup).
        self.built_signature: str | None = None
        self._saved_signature: str | None = None
        self._signature_mismatches = 0
        self._live = False
        self._failures = 0
        self._online_since: float | None = None
        # IR packs + CEC commands as last read from the hub (None = not yet).
        self._static: dict[str, Any] | None = None
        self._static_loaded_at = 0.0
        self._static_retry_at = 0.0
        self._static_failures = 0
        # Has this hub ever reported inputs/outputs (live or from storage)?
        self._ports_seen = False

    @property
    def base_url(self) -> str:
        return f"http://{self.host}/api"

    async def _async_update_data(self) -> dict[str, Any]:
        try:
            data, complete = await self._poll()
        except Exception as exc:  # noqa: BLE001 - any failure means "not talking"
            self._failures += 1
            self._online_since = None
            if self._live and self._failures <= POLL_GRACE:
                _LOGGER.debug(
                    "MHUB %s missed poll %s/%s: %s", self.host, self._failures, POLL_GRACE, exc
                )
                return self.data
            raise UpdateFailed(
                f"MHUB {self.host} is not answering: {exc or type(exc).__name__}"
            ) from exc

        if self._online_since is None:
            self._online_since = time.monotonic()
        self._failures = 0
        self._live = True
        self.has_topology = True

        self.data = data
        self._detect_model()
        _LOGGER.debug("MHUB data updated: %s", self.model_info)

        if complete:
            self._after_complete_poll()
        return self.data

    async def _poll(self) -> tuple[dict[str, Any], bool]:
        """Read the hub once. Returns (data, complete).

        /data/100 and the state call are mandatory: without them the hub is
        "not talking". Everything else keeps its last known value if a single
        call fails, so one flaky endpoint can no longer take the hub offline.
        ``complete`` is False when anything had to be carried over.
        """
        info = await self.api.get_system_info()
        info_data = info.get("data") if isinstance(info, dict) else None
        if not isinstance(info_data, dict) or not (info_data.get("os") or info_data.get("mhub")):
            raise UpdateFailed("Empty or invalid /api/data/100 response from MHUB")

        if self._has_ports(info_data):
            self._ports_seen = True
        elif self._ports_seen:
            # This hub is known to have inputs/outputs but reports none right
            # now: it is still booting and answers before it knows its ports.
            raise UpdateFailed("MHUB is still starting (no inputs/outputs reported yet)")

        stack_info = info_data.get("stack", {}) or {}
        stacked = bool(stack_info.get("stack_status", False))

        state = await self.api.get_state(stacked)
        if not isinstance(state, dict) or not isinstance(state.get("data"), dict):
            raise UpdateFailed("Empty or invalid MHUB state response")

        complete = True
        previous = self.data

        async def optional(call, key: str, extract):
            nonlocal complete
            try:
                return extract(await call())
            except MhubApiError as exc:
                complete = False
                _LOGGER.debug("MHUB %s: keeping previous %s (%s)", self.host, key, exc)
                return previous.get(key)

        power = await optional(
            self.api.get_power,
            "power",
            lambda p: (p.get("data") if isinstance(p, dict) else None) or {},
        )
        zones_config = await optional(self.api.get_zones, "zones_config", self._extract_zones)
        groups = await optional(self.api.get_groups, "groups", self._extract_groups)
        sequences = await optional(self.api.get_sequences, "sequences", self._extract_sequences)

        power = power if isinstance(power, dict) else {}
        zones_config = zones_config or []

        if self._static_due():
            await self._refresh_static(info_data, stacked)
        if self._static is not None:
            static = self._static
        else:
            # Not read from the hub yet: carry over what storage gave us.
            complete = False
            static = {
                "ir_devices": previous.get("ir_devices") or {},
                "ir_port_to_output": previous.get("ir_port_to_output") or {},
                "cec_commands": previous.get("cec_commands") or [],
            }

        sources = await self._get_cached_sources(info_data)
        zones_state = state["data"].get("zones", []) or []

        data = {
            "info": info_data,
            "state": state["data"],
            "power": power,
            "zones_config": zones_config,
            "groups": groups or [],
            "sequences": sequences or [],
            "stacked": stacked,
            "sources": sources,
            "zones": zones_state,
            "zones_state": zones_state,
            "device_info": self._build_device_info(info_data),
            "ir_devices": static["ir_devices"],
            "ir_port_to_output": static["ir_port_to_output"],
            "output_to_zone": self._build_output_to_zone(zones_config),
            "cec_commands": static["cec_commands"],
        }
        return data, complete

    @staticmethod
    def _has_ports(info_data: dict[str, Any]) -> bool:
        io_data = info_data.get("io_data")
        if not isinstance(io_data, dict):
            return False
        return any(value for key, value in io_data.items() if key != "ir")

    # ── IR packs / CEC commands (slow-changing) ─────────────────────────
    def _static_due(self) -> bool:
        now = time.monotonic()
        if self._static is None or self._static_retry_at:
            return now >= self._static_retry_at
        settling = self._online_since is None or now - self._online_since < SETTLE_WINDOW
        ttl = STATIC_TTL_SETTLING if settling else STATIC_TTL
        return now - self._static_loaded_at >= ttl

    async def _refresh_static(self, info_data: dict[str, Any], stacked: bool) -> None:
        strict = self._static_failures < STATIC_STRICT_ATTEMPTS
        try:
            ir_devices, ir_port_to_output = await self._get_ir_devices(info_data, stacked, strict)
            cec_commands = await self._get_cec_commands(strict)
        except MhubApiError as exc:
            # All or nothing: a half-read IR list would silently drop buttons.
            self._static_failures += 1
            self._static_retry_at = time.monotonic() + STATIC_RETRY
            _LOGGER.debug("MHUB %s: IR/CEC read incomplete, retrying: %s", self.host, exc)
            return

        self._static = {
            "ir_devices": ir_devices,
            "ir_port_to_output": ir_port_to_output,
            "cec_commands": cec_commands,
        }
        self._static_loaded_at = time.monotonic()
        self._static_retry_at = 0.0
        self._static_failures = 0

    # ── last known layout: storage + self-healing ───────────────────────
    async def async_load_snapshot(self) -> bool:
        """Seed self.data with the last layout the hub reported, if any."""
        try:
            stored = await self._store.async_load()
        except Exception as exc:  # noqa: BLE001 - a bad file must not block setup
            _LOGGER.debug("MHUB %s: could not read stored layout: %s", self.host, exc)
            return False

        data = stored.get("data") if isinstance(stored, dict) else None
        if not isinstance(data, dict) or not isinstance(data.get("info"), dict):
            return False

        snapshot = {key: data[key] for key in _SNAPSHOT_KEYS if key in data}
        # JSON turned the integer IR port ids into strings.
        ports = snapshot.get("ir_port_to_output")
        if isinstance(ports, dict):
            snapshot["ir_port_to_output"] = {
                self._safe_int(port, port): output for port, output in ports.items()
            }

        self.data.update(snapshot)
        self._ports_seen = self._has_ports(snapshot["info"])
        self._detect_model()
        self.has_topology = True
        self._saved_signature = self.topology_signature()
        return True

    def _snapshot(self) -> dict[str, Any]:
        return {"data": {key: self.data.get(key) for key in _SNAPSHOT_KEYS}}

    def topology_signature(self) -> str:
        """Fingerprint of everything that decides which entities exist."""
        data = self.data

        def dicts(items):
            return [item for item in items or [] if isinstance(item, dict)]

        power = data.get("power") or {}
        payload = {
            "outputs": self.video_output_labels(),
            "inputs": self.video_input_labels(),
            "zones": [
                [
                    zone.get("zone_id"),
                    zone.get("zone_label"),
                    [str(o.get("output_id", "")).lower() for o in dicts(zone.get("outputs"))],
                ]
                for zone in dicts(self.zones_config())
            ],
            "groups": [
                [g.get("group_id"), g.get("group_label") or g.get("label")]
                for g in dicts(self.groups())
            ],
            "sequences": [
                [
                    s.get("id") or s.get("sequence_id") or s.get("function_id"),
                    s.get("label") or s.get("name") or s.get("sequence_label") or s.get("function_label"),
                ]
                for s in dicts(self.sequences())
            ],
            "ir": {
                key: [
                    pack.get("name"),
                    [
                        [c.get("command_id") or c.get("id"), c.get("label")]
                        for c in dicts(pack.get("ir_pack") or pack.get("irpack"))
                    ],
                ]
                for key, pack in (data.get("ir_devices") or {}).items()
                if isinstance(pack, dict)
            },
            "cec": [[c.get("id"), c.get("label")] for c in dicts(data.get("cec_commands"))],
            "power": "power" in power or "Power" in power,
        }
        raw = json.dumps(payload, sort_keys=True, default=str)
        return hashlib.sha1(raw.encode()).hexdigest()

    def _after_complete_poll(self) -> None:
        signature = self.topology_signature()

        if signature != self._saved_signature:
            self._saved_signature = signature
            self._store.async_delay_save(self._snapshot, 5)

        if self.built_signature is None or signature == self.built_signature:
            self._signature_mismatches = 0
            return

        # The hub now reports a different layout than the entities were built
        # from -- typically because it (or the network) was still starting up
        # when Home Assistant loaded us. Rebuild instead of staying half-loaded
        # until someone restarts Home Assistant.
        self._signature_mismatches += 1
        if self._signature_mismatches < 2:
            return

        reloads = self.hass.data.setdefault(f"{DOMAIN}_auto_reload", {})
        now = time.monotonic()
        last = reloads.get(self.entry.entry_id)
        if last is not None and now - last < AUTO_RELOAD_MIN_INTERVAL:
            return

        reloads[self.entry.entry_id] = now
        self.built_signature = None
        _LOGGER.warning(
            "MHUB %s now reports a different layout than was loaded "
            "(it was probably still starting up); reloading the integration",
            self.host,
        )
        self.hass.config_entries.async_schedule_reload(self.entry.entry_id)

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

        if sources:  # never pin an empty list from a hub that is still starting
            self._static_cache[cache_key] = sources
            self._cache_timestamp[cache_key] = asyncio.get_event_loop().time()
        return sources

    def _build_device_info(self, info_data: dict[str, Any]) -> dict[str, Any]:
        mhub_info = info_data.get("os") or info_data.get("mhub", {})
        return {
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

    async def _get_cec_commands(self, strict: bool) -> list[dict[str, Any]]:
        try:
            payload = await self.api.get_cec_commands()
        except MhubApiError as exc:
            if strict:
                raise
            _LOGGER.debug("Unable to fetch CEC commands: %s", exc)
            return []

        data = payload.get("data") if isinstance(payload, dict) else None
        commands = data.get("cecpack") if isinstance(data, dict) else None
        return commands if isinstance(commands, list) else []

    async def _get_ir_devices(
        self, info_data: dict[str, Any], stacked: bool, strict: bool = False
    ) -> tuple[dict[str, Any], dict[int, str]]:
        """Read every IR pack. With ``strict`` any failed call raises, so the
        caller retries instead of keeping a list with ports missing."""
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
        except MhubApiError as exc:
            if strict:
                raise
            _LOGGER.debug("Unable to fetch IR pack summary: %s", exc)
            return ir_devices, ir_port_to_output

        if not isinstance(packs, dict):
            return ir_devices, ir_port_to_output

        pack_groups = packs.get("data") or []
        if not stacked:
            pack_groups = [packs.get("data")]
        if not isinstance(pack_groups, list):
            return ir_devices, ir_port_to_output

        for group in pack_groups:
            if not group or not isinstance(group, dict):
                continue

            if group.get("avr") and forwards_start is not None:
                avr_port = forwards_start + forwards_ports
                ir_port_to_output[avr_port] = "a"

            for port_group in ("input", "output", "global"):
                ports = group.get(port_group, [])
                if not isinstance(ports, list):
                    continue

                for index, port in enumerate(ports):
                    if not port or not isinstance(port, dict):
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
                    except MhubApiError as exc:
                        if strict:
                            raise
                        _LOGGER.debug("Unable to fetch IR pack details for port %s: %s", pid, exc)
                        continue

                    pack_data = (details.get("data") if isinstance(details, dict) else None) or {}
                    if not pack_data or not isinstance(pack_data, dict):
                        continue

                    pack_data["_port_type"] = port_group
                    pack_data["_port_id"] = pid
                    ir_devices[f"{port_group}_{pid}"] = pack_data

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
        self._static_retry_at = 0.0
        self._static_loaded_at = 0.0

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
        if isinstance(payload, list):
            return payload
        if not payload or not isinstance(payload, dict):
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
        if isinstance(payload, list):
            return payload
        if not payload or not isinstance(payload, dict):
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
        if isinstance(payload, list):
            return payload
        if not payload or not isinstance(payload, dict):
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
