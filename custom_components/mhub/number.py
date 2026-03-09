from __future__ import annotations

import logging

import aiohttp
from homeassistant.components.number import NumberEntity
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.util import slugify

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass, entry, async_add_entities):
    """Set up MHUB number entities (volumes)."""
    coordinator = hass.data[DOMAIN][entry.entry_id]

    entities: list[NumberEntity] = []

    # Per-output volume (existing behaviour)
    if coordinator.model_info.get("supports_volume"):
        outputs = coordinator.video_output_labels()
        for output_id, output_label in outputs.items():
            entities.append(MHUBZoneVolume(coordinator, output_id, output_label))
    else:
        _LOGGER.info("MHUB: no output volume API detected, skipping per-output volume entities")

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

        headers = {
            "User-Agent": "HomeAssistant-MHUB",
            "Accept": "application/json",
        }

        session = async_get_clientsession(self.hass)

        try:
            async with session.get(url, headers=headers, allow_redirects=True) as resp:
                text = await resp.text()

                if resp.status == 200:
                    _LOGGER.info(
                        "MHUB volume set: %s -> %s",
                        self._output_id.upper(),
                        vol,
                    )
                else:
                    _LOGGER.warning(
                        "MHUB volume failed HTTP %s: %s",
                        resp.status,
                        text[:200],
                    )

        except aiohttp.ClientError as exc:
            _LOGGER.error("MHUB volume request failed: %s", exc)

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

        headers = {
            "User-Agent": "HomeAssistant-MHUB",
            "Accept": "application/json",
        }

        session = async_get_clientsession(self.hass)

        try:
            async with session.get(url, headers=headers, allow_redirects=True) as resp:
                text = await resp.text()

                if resp.status == 200:
                    _LOGGER.info(
                        "MHUB group volume set: %s -> %s",
                        self._gid,
                        vol,
                    )
                else:
                    _LOGGER.warning(
                        "MHUB group volume failed HTTP %s: %s",
                        resp.status,
                        text[:200],
                    )

        except aiohttp.ClientError as exc:
            _LOGGER.error("MHUB group volume request failed: %s", exc)

        await self.coordinator.async_request_refresh()
