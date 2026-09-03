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


def _preregister_zone_devices(
    device_registry: dr.DeviceRegistry,
    entry: ConfigEntry,
    coordinator: MHUBDataUpdateCoordinator,
    hub_device,
    device_info: dict,
) -> None:
    """Create (or refresh) a device row for every output/zone up front.

    media_player.py, sensor.py and button.py each build a per-zone DeviceInfo
    using the legacy tuple form ``via_device=(DOMAIN, entry_id)`` so Home
    Assistant's entity platform can link the zone device to the hub device.
    When entity_platform.py has to create that zone device for the first
    time, recent Home Assistant core versions route the via_device link
    through a deprecated code path (device_registry.async_get_or_create
    called with `via_device=` instead of `via_device_id=`). Normally that
    only logs a warning, but when HA can't identify a calling integration
    frame for it, it raises instead — and the entity being added at that
    moment (whichever platform runs first: media_player) fails to register
    at all, forever showing as "unavailable" in the UI, even across
    reloads/restarts, since the same crash repeats every time.

    Registering every zone device here — with the modern `via_device_id`
    parameter — means every platform's entities always find an existing
    device row by the time they're added, so that buggy "create on the fly"
    path is never exercised again. Keep the identifier scheme (and the
    "output_<id>" fallback for outputs with no resolved zone) identical to
    what media_player.py / sensor.py / button.py compute at runtime.
    """
    output_to_zone: dict[str, dict] = {}
    for zone in coordinator.zones_config():
        zone_id = zone.get("zone_id")
        for output in zone.get("outputs", []) or []:
            oid = str(output.get("output_id", "")).lower()
            if oid:
                output_to_zone[oid] = zone

    for output_id, output_label in coordinator.video_output_labels().items():
        zone = output_to_zone.get(output_id)
        zone_id = zone.get("zone_id") if zone else None
        zone_label = zone.get("zone_label", zone_id) if zone else None

        resolved_zone_id = zone_id if zone_id is not None else f"output_{output_id}"
        resolved_zone_name = zone_label or output_label

        device_registry.async_get_or_create(
            config_entry_id=entry.entry_id,
            identifiers={(DOMAIN, f"{entry.entry_id}_{resolved_zone_id}")},
            manufacturer="HDANYWHERE",
            name=resolved_zone_name,
            model=device_info.get("model", "MHUB Zone"),
            serial_number=device_info.get("serial_number"),
            sw_version=device_info.get("firmware"),
            hw_version=device_info.get("unit_id"),
            configuration_url=f"http://{device_info.get('ip_address', coordinator.api.host)}",
            via_device_id=hub_device.id,
        )


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Set up MHUB from a config entry."""
    coordinator = MHUBDataUpdateCoordinator(hass, entry)
    await coordinator.async_config_entry_first_refresh()

    device_info = coordinator.data.get("device_info", {})
    device_registry = dr.async_get(hass)
    hub_device = device_registry.async_get_or_create(
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

    _preregister_zone_devices(device_registry, entry, coordinator, hub_device, device_info)

    hass.data.setdefault(DOMAIN, {})[entry.entry_id] = coordinator
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)

    # Register the bundled MHUB Lovelace card once (shared across all entries).
    # Stored under a separate key so the coordinator dict — and the unload
    # logic that empties it — is left untouched.
    frontend_key = f"{DOMAIN}_frontend_registered"
    if not hass.data.get(frontend_key):
        try:
            from .frontend import JSModuleRegistration

            await JSModuleRegistration(hass).async_register()
            hass.data[frontend_key] = True
        except Exception:  # noqa: BLE001 - card issues must never break setup
            _LOGGER.warning("MHUB: bundled card registration failed", exc_info=True)

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
