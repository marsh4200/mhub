from __future__ import annotations

import logging

from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers import device_registry as dr
from homeassistant.helpers.typing import ConfigType
import voluptuous as vol

from .const import DOMAIN, SERVICE_SEND_PRONTO_IR
from .coordinator import MHUBDataUpdateCoordinator

CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)

PLATFORMS: list[str] = ["media_player", "number", "switch", "button", "sensor"]

_LOGGER = logging.getLogger(__name__)

SERVICE_SCHEMA = vol.Schema(
    {
        vol.Optional("target"): cv.string,
        vol.Optional("port"): vol.Coerce(int),
        vol.Required("pronto_code"): cv.string,
    }
)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    """Set up via YAML (not used, but required)."""
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up MHUB from a config entry."""
    coordinator = MHUBDataUpdateCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()

    device_info = coordinator.data.get("device_info", {})
    device_registry = dr.async_get(hass)
    device_registry.async_get_or_create(
        config_entry_id=entry.entry_id,
        identifiers={(DOMAIN, entry.entry_id)},
        manufacturer="HDANYWHERE",
        name=device_info.get("name", entry.title or "MHUB"),
        model=device_info.get("model", "MHUB"),
        serial_number=device_info.get("serial_number"),
        sw_version=device_info.get("firmware"),
        hw_version=device_info.get("unit_id"),
        configuration_url=f"http://{device_info.get('ip_address', coordinator.api.host)}",
    )

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    if not hass.services.has_service(DOMAIN, SERVICE_SEND_PRONTO_IR):
        async def _service_handler(call: ServiceCall) -> None:
            await _async_handle_send_pronto_ir(hass, call)

        hass.services.async_register(
            DOMAIN,
            SERVICE_SEND_PRONTO_IR,
            _service_handler,
            schema=SERVICE_SCHEMA,
        )

    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Unload MHUB config entry."""
    unload_ok = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unload_ok:
        hass.data[DOMAIN].pop(entry.entry_id, None)

    if not hass.data.get(DOMAIN) and hass.services.has_service(DOMAIN, SERVICE_SEND_PRONTO_IR):
        hass.services.async_remove(DOMAIN, SERVICE_SEND_PRONTO_IR)

    return unload_ok


async def _async_handle_send_pronto_ir(hass: HomeAssistant, call: ServiceCall) -> None:
    """Send a raw pronto code to an IR port."""
    pronto_code = call.data["pronto_code"]
    target = call.data.get("target")
    port = call.data.get("port")

    if port is None and not target:
        _LOGGER.error("send_pronto_ir requires either 'target' or 'port'")
        return

    for coordinator in hass.data.get(DOMAIN, {}).values():
        actual_port = port or _map_target_to_port(coordinator, target)
        if actual_port is None:
            continue

        result = await coordinator.api.send_pronto_ir(actual_port, pronto_code)
        if result is None:
            _LOGGER.error("Failed to send Pronto IR via port %s", actual_port)
        return

    _LOGGER.error("Unable to resolve MHUB IR target '%s'", target)


def _map_target_to_port(coordinator: MHUBDataUpdateCoordinator, target: str | None) -> int | None:
    if not target:
        return None

    target = target.lower().strip()
    info = coordinator.data.get("info", {}) or {}
    ir_config = (info.get("io_data", {}) or {}).get("ir", {}) or {}
    backwards = ir_config.get("backwards", {}) or {}

    backwards_start = _safe_int(backwards.get("start_id"))
    backwards_ports = _safe_int(backwards.get("ports"), 0) or 0

    if target.startswith("output_") or target.startswith("output "):
        output_letter = target.replace("output_", "").replace("output ", "").strip().lower()
        for port_id, mapped_output in (coordinator.data.get("ir_port_to_output", {}) or {}).items():
            if mapped_output == output_letter:
                return int(port_id)
        return None

    if target.startswith("input_") or target.startswith("input "):
        input_num = target.replace("input_", "").replace("input ", "").strip()
        try:
            input_number = int(input_num)
        except ValueError:
            return None

        if backwards_start is None or input_number < 1 or input_number > backwards_ports:
            return None
        return backwards_start + (input_number - 1)

    return None


def _safe_int(value, default=None):
    try:
        return int(value)
    except (TypeError, ValueError):
        return default
