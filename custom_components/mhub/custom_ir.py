from __future__ import annotations

import logging
import os
from pathlib import Path

from homeassistant.components.button import ButtonEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN, SERVICE_SEND_PRONTO_IR

_LOGGER = logging.getLogger(__name__)

# Persistent custom IR store lives in the HA config root (e.g.
# /config/mhub_custom_ir_devices.yaml), NOT inside the integration folder.
# HACS deletes and re-copies custom_components/mhub/ on every update, which
# used to wipe user-added custom IRs. Keeping the file in /config means it is
# never touched by updates. The integration creates and seeds this file
# automatically on first run, so users never have to make any file by hand.
CUSTOM_IR_FILENAME = "mhub_custom_ir_devices.yaml"
_EMPTY_TEMPLATE = "custom_ir_devices: []\n"


def _ensure_persistent_file(config_path: str, bundled_path: str) -> None:
    """Create the persistent custom IR file on first run (runs in executor).

    If the file already exists it is left completely untouched, so user entries
    survive integration/HACS updates. On first run it is seeded from the older
    in-folder file if that one still holds entries (one-time migration),
    otherwise from an empty template.
    """
    if os.path.exists(config_path):
        return

    seed = _EMPTY_TEMPLATE
    try:
        if os.path.exists(bundled_path):
            with open(bundled_path, "r", encoding="utf-8") as handle:
                content = handle.read()
            # Only carry the old in-folder file over if it actually holds
            # devices, migrating any pre-existing hand-added entries.
            if content.strip() and content.strip() != "custom_ir_devices: []":
                seed = content
    except Exception as exc:  # best effort seed only
        _LOGGER.warning("Could not read bundled custom IR file for migration: %s", exc)

    try:
        with open(config_path, "w", encoding="utf-8") as handle:
            handle.write(seed)
        _LOGGER.info("Created persistent custom IR file at %s", config_path)
    except Exception as exc:
        _LOGGER.error("Could not create custom IR file %s: %s", config_path, exc)


async def async_setup_custom_ir_buttons(
    hass: HomeAssistant,
    config_entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
    coordinator,
) -> None:
    """Create optional custom Pronto IR buttons from the persistent YAML."""

    config_file = Path(hass.config.path(CUSTOM_IR_FILENAME))
    bundled_file = Path(__file__).parent / "custom_ir_devices.yaml"

    # Auto-create (and migrate) the persistent file on first run. Existing
    # files are left untouched so custom IRs are never lost on update.
    await hass.async_add_executor_job(
        _ensure_persistent_file, str(config_file), str(bundled_file)
    )

    if not config_file.exists():
        return

    try:
        from homeassistant.util import yaml

        config = await hass.async_add_executor_job(yaml.load_yaml, str(config_file))
    except Exception as exc:
        _LOGGER.error("Failed to load %s: %s", CUSTOM_IR_FILENAME, exc)
        return

    devices = (config or {}).get("custom_ir_devices", [])
    entities: list[ButtonEntity] = []

    for device in devices:
        device_name = device.get("name")
        target = device.get("target")
        buttons = device.get("buttons", [])
        mhub_filter = device.get("mhub")

        if mhub_filter and mhub_filter != config_entry.title:
            continue
        if not device_name or not target or not buttons:
            continue

        device_key = device_name.lower().replace(" ", "_").replace("/", "_")
        device_identifier = (DOMAIN, f"{config_entry.entry_id}_custom_ir_{device_key}")

        via_device = None
        if str(target).startswith("output_"):
            output_letter = str(target).replace("output_", "").lower()
            zone_id = (coordinator.data.get("output_to_zone", {}) or {}).get(output_letter)
            if zone_id:
                via_device = (DOMAIN, f"{config_entry.entry_id}_{zone_id}")

        for button_config in buttons:
            button_name = button_config.get("name")
            pronto_code = button_config.get("pronto_code")
            if not button_name or not pronto_code:
                continue

            entities.append(
                CustomIRButton(
                    coordinator,
                    config_entry,
                    device_identifier,
                    device_name,
                    target,
                    button_name,
                    pronto_code,
                    via_device,
                )
            )

    if entities:
        async_add_entities(entities)


class CustomIRButton(ButtonEntity):
    _attr_has_entity_name = True

    def __init__(
        self,
        coordinator,
        config_entry: ConfigEntry,
        device_identifier,
        device_name: str,
        target: str,
        button_name: str,
        pronto_code: str,
        via_device=None,
    ) -> None:
        self.coordinator = coordinator
        self._device_identifier = device_identifier
        self._device_name = device_name
        self._target = target
        self._pronto_code = pronto_code
        self._via_device = via_device

        button_key = button_name.lower().replace(" ", "_").replace("/", "_")
        device_key = device_name.lower().replace(" ", "_").replace("/", "_")
        self._attr_unique_id = f"{config_entry.entry_id}_custom_{device_key}_{button_key}"
        self._attr_name = button_name

    @property
    def device_info(self):
        info = {
            "identifiers": {self._device_identifier},
            "name": self._device_name,
            "manufacturer": "MHUB Custom",
            "model": "Custom IR Device",
        }
        if self._via_device:
            info["via_device"] = self._via_device
        return info

    async def async_press(self) -> None:
        await self.coordinator.hass.services.async_call(
            DOMAIN,
            SERVICE_SEND_PRONTO_IR,
            {"target": self._target, "pronto_code": self._pronto_code},
            blocking=True,
        )
