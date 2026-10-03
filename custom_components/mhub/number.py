from __future__ import annotations

import logging

from homeassistant.components.number import NumberEntity
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import slugify

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass, entry, async_add_entities):
    """Set up MHUB number entities (volumes)."""
    coordinator = hass.data[DOMAIN][entry.entry_id]

    entities: list[NumberEntity] = []

    # Per-output volume. Keep these exposed whenever the device reports outputs,
    # even if model detection is conservative.
    outputs = coordinator.video_output_labels()
    for output_id, output_label in outputs.items():
        entities.append(MHUBZoneVolume(coordinator, output_id, output_label))

    # Group volume (new, AUDIO/MZMA)
    if coordinator.groups():
        for g in coordinator.groups():
            gid = g.get("group_id")
            label = g.get("group_label") or g.get("label") or f"Group {gid}"
            if gid is not None:
                entities.append(MHUBGroupVolume(coordinator, str(gid), str(label)))

    if entities:
        async_add_entities(entities, True)


class MHUBZoneVolume(CoordinatorEntity, NumberEntity):
    """Output volume slider for MHUB devices with volume API."""

    _attr_native_min_value = 0
    _attr_native_max_value = 100
    _attr_native_step = 1
    _attr_mode = "slider"

    def __init__(self, coordinator, output_id: str, name: str) -> None:
        super().__init__(coordinator)
        self.coordinator = coordinator
        self._output_id = str(output_id).lower()
        self._attr_name = f"{name} Volume"
        self._attr_unique_id = f"mhub_volume_{self._output_id}"

    @property
    def native_value(self) -> float | None:
        for zone in self.coordinator.zones():
            for state in zone.get("state", []) or []:
                if str(state.get("output_id")).lower() == self._output_id:
                    try:
                        return int(state.get("volume", 0))
                    except Exception:
                        return 0
        return 0

    async def async_set_native_value(self, value: float) -> None:
        vol = int(value)

        url = f"{self.coordinator.base_url}/control/volume/{self._output_id}/{vol}/"
        await self.coordinator.api.command(url, f"volume {self._output_id.upper()} -> {vol}")

        await self.coordinator.async_request_refresh()


class MHUBGroupVolume(CoordinatorEntity, NumberEntity):
    """Group volume slider for MHUB AUDIO / MZMA groups."""

    _attr_native_min_value = 0
    _attr_native_max_value = 100
    _attr_native_step = 1
    _attr_mode = "slider"
    _attr_icon = "mdi:volume-high"

    def __init__(self, coordinator, group_id: str, label: str) -> None:
        super().__init__(coordinator)
        self.coordinator = coordinator
        self._gid = str(group_id)
        self._label = label

        self._attr_name = f"{label} Group Volume"
        self._attr_unique_id = f"mhub_group_volume_{slugify(self._gid + '_' + label)}"

    @property
    def native_value(self) -> float | None:
        for g in self.coordinator.groups():
            if str(g.get("group_id")) == self._gid:
                try:
                    return int(g.get("group_volume", 0))
                except Exception:
                    return 0
        return 0

    async def async_set_native_value(self, value: float) -> None:
        vol = int(value)

        url = f"{self.coordinator.base_url}/control/group/volume/set/{self._gid}/{vol}/"
        await self.coordinator.api.command(url, f"group volume {self._gid} -> {vol}")

        await self.coordinator.async_request_refresh()
