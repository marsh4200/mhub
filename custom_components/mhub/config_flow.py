from __future__ import annotations

import logging
import re
from typing import Any

from homeassistant import config_entries
from homeassistant.const import CONF_HOST
from homeassistant.helpers.aiohttp_client import async_get_clientsession
import homeassistant.helpers.config_validation as cv
import voluptuous as vol

from .const import CONTROL_METHOD_CEC, CONTROL_METHOD_IR, CONTROL_METHOD_NONE, DOMAIN

_LOGGER = logging.getLogger(__name__)


class MHUBConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle MHUB config flow."""

    VERSION = 1

    def __init__(self) -> None:
        self._title = ""
        self._data: dict[str, Any] = {}

    @staticmethod
    def async_get_options_flow(config_entry):
        return MHUBOptionsFlow()

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        errors: dict[str, str] = {}

        if user_input is not None:
            host = user_input[CONF_HOST]
            validation_result = await self._validate_host(host)

            if validation_result["valid"]:
                unique_id = validation_result.get("serial_number", host)
                await self.async_set_unique_id(str(unique_id))
                self._abort_if_unique_id_configured()
                self._title = validation_result.get("mhub_name") or host
                self._data = {CONF_HOST: host}
                return self.async_create_entry(title=self._title, data=self._data)

            errors["base"] = validation_result.get("error", "cannot_connect")

        return self.async_show_form(
            step_id="user",
            data_schema=vol.Schema({vol.Required(CONF_HOST): str}),
            errors=errors,
        )

    async def _validate_host(self, host: str) -> dict[str, Any]:
        if not host:
            return {"valid": False, "error": "invalid_host"}

        host = host.replace("http://", "").replace("https://", "").rstrip("/")

        ip_pattern = r"^(\d{1,3}\.){3}\d{1,3}$"
        hostname_pattern = (
            r"^[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?"
            r"(\.[a-zA-Z0-9]([a-zA-Z0-9\-]{0,61}[a-zA-Z0-9])?)*$"
        )

        if not (re.match(ip_pattern, host) or re.match(hostname_pattern, host)):
            return {"valid": False, "error": "invalid_host"}

        try:
            session = async_get_clientsession(self.hass)
            async with session.get(f"http://{host}/api/data/100/", timeout=10) as response:
                if response.status != 200:
                    return {"valid": False, "error": "cannot_connect"}

                data = await response.json(content_type=None)
                inner = data.get("data", {})
                mhub_data = inner.get("os") or inner.get("mhub", {})

                return {
                    "valid": True,
                    "mhub_name": mhub_data.get("mhub_name") or mhub_data.get("mhub_official_name"),
                    "serial_number": mhub_data.get("serial_number"),
                }

        except TimeoutError:
            return {"valid": False, "error": "timeout_connect"}
        except Exception as exc:
            _LOGGER.debug("Config flow connection failed for %s: %s", host, exc)
            return {"valid": False, "error": "cannot_connect"}


class MHUBOptionsFlow(config_entries.OptionsFlow):
    """Configure per-zone IR/CEC exposure."""

    def __init__(self) -> None:
        self._zones: list[dict[str, Any]] = []
        self._zone_methods: dict[str, str] = {}
        self._zone_commands: dict[str, list[int] | None] = {}
        self._zone_key_map: dict[str, str] = {}
        self._zones_needing_commands: list[str] = []
        self._current_zone: str | None = None
        self._ir_commands: dict[str, list[dict[str, Any]]] = {}
        self._cec_commands: list[dict[str, Any]] = []

    async def async_step_init(self, user_input=None):
        coordinator = self.hass.data[DOMAIN].get(self.config_entry.entry_id)
        if not coordinator:
            return self.async_abort(reason="not_loaded")

        self._zones = coordinator.zones_config()
        existing_zones = self.config_entry.options.get("zones", {})

        if user_input is not None:
            for field_key, zone_id in self._zone_key_map.items():
                self._zone_methods[zone_id] = user_input.get(field_key, CONTROL_METHOD_NONE)

            if any(method == CONTROL_METHOD_CEC for method in self._zone_methods.values()):
                self._cec_commands = coordinator.data.get("cec_commands", []) or []

            output_to_zone = coordinator.data.get("output_to_zone", {}) or {}
            zone_to_output = {zone_id: output_id for output_id, zone_id in output_to_zone.items()}
            output_to_ir_port = {
                output_id: port_id
                for port_id, output_id in (coordinator.data.get("ir_port_to_output", {}) or {}).items()
            }

            for zone in self._zones:
                zone_id = zone["zone_id"]
                if self._zone_methods.get(zone_id) != CONTROL_METHOD_IR:
                    continue

                output_id = zone_to_output.get(zone_id)
                ir_port = output_to_ir_port.get(output_id) if output_id else None
                if not ir_port:
                    self._ir_commands[zone_id] = []
                    continue

                self._ir_commands[zone_id] = _extract_ir_commands_for_port(coordinator, ir_port)

            self._zones_needing_commands = [
                zone["zone_id"]
                for zone in self._zones
                if self._zone_methods.get(zone["zone_id"]) in (CONTROL_METHOD_IR, CONTROL_METHOD_CEC)
            ]

            return await self._next_zone_step()

        schema_dict = {}
        self._zone_key_map = {}

        for zone in self._zones:
            zone_id = zone["zone_id"]
            zone_label = zone.get("zone_label", zone_id)
            current_method = existing_zones.get(zone_id, {}).get("control_method", CONTROL_METHOD_NONE)
            field_key = f"zone_{zone_label.lower().replace(' ', '_').replace('/', '_')}"
            self._zone_key_map[field_key] = zone_id
            schema_dict[vol.Optional(field_key, default=current_method)] = vol.In(
                {
                    CONTROL_METHOD_IR: "IR (uControl pack)",
                    CONTROL_METHOD_CEC: "CEC",
                    CONTROL_METHOD_NONE: "None",
                }
            )

        zone_list = "\n".join(f"- {zone.get('zone_label', zone['zone_id'])}" for zone in self._zones)

        return self.async_show_form(
            step_id="init",
            data_schema=vol.Schema(schema_dict),
            description_placeholders={
                "zone_count": str(len(self._zones)),
                "zone_list": zone_list,
            },
        )

    async def async_step_zone_commands(self, user_input=None):
        if user_input is not None:
            selected = user_input.get("commands", [])
            self._zone_commands[self._current_zone] = [int(c) for c in selected]
            return await self._next_zone_step()

        zone_id = self._current_zone
        method = self._zone_methods.get(zone_id, CONTROL_METHOD_NONE)
        zone_label = next(
            (z.get("zone_label", zone_id) for z in self._zones if z["zone_id"] == zone_id),
            zone_id,
        )
        existing_zones = self.config_entry.options.get("zones", {})
        existing_commands = existing_zones.get(zone_id, {}).get("commands")

        commands = self._ir_commands.get(zone_id, []) if method == CONTROL_METHOD_IR else self._cec_commands
        if not commands:
            self._zone_commands[zone_id] = None
            return await self._next_zone_step()

        command_options = {
            str(cmd["id"]): cmd.get("label", str(cmd["id"]))
            for cmd in commands
            if cmd.get("id") is not None
        }

        if existing_commands is None:
            default_commands = list(command_options.keys())
        else:
            default_commands = [str(c) for c in existing_commands if str(c) in command_options]

        return self.async_show_form(
            step_id="zone_commands",
            data_schema=vol.Schema(
                {
                    vol.Optional("commands", default=default_commands): cv.multi_select(command_options)
                }
            ),
            description_placeholders={
                "zone_label": str(zone_label),
                "method": method.upper(),
                "command_count": str(len(commands)),
            },
        )

    async def _next_zone_step(self):
        if self._zones_needing_commands:
            self._current_zone = self._zones_needing_commands.pop(0)
            return await self.async_step_zone_commands()
        return self._save_options()

    def _save_options(self):
        zones_options: dict[str, dict[str, Any]] = {}
        for zone in self._zones:
            zone_id = zone["zone_id"]
            method = self._zone_methods.get(zone_id, CONTROL_METHOD_NONE)
            if method == CONTROL_METHOD_NONE:
                zones_options[zone_id] = {"control_method": CONTROL_METHOD_NONE}
            else:
                zones_options[zone_id] = {
                    "control_method": method,
                    "commands": self._zone_commands.get(zone_id),
                }

        return self.async_create_entry(title="", data={"zones": zones_options})


def _extract_ir_commands_for_port(coordinator, port_id: int) -> list[dict[str, Any]]:
    for pack in (coordinator.data.get("ir_devices", {}) or {}).values():
        if pack.get("_port_id") != port_id:
            continue

        commands = pack.get("ir_pack") or pack.get("irpack") or []
        normalized = []
        for command in commands:
            command_id = command.get("command_id") or command.get("id")
            if command_id is None:
                continue
            normalized.append({"id": int(command_id), "label": command.get("label", str(command_id))})
        return normalized
    return []
