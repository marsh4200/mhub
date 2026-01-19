from __future__ import annotations

import logging

import aiohttp
from homeassistant.components.number import NumberEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass: HomeAssistant, entry, async_add_entities):
    """Set up MHUB volume entities if the device supports volume control."""
    coordinator = hass.data[DOMAIN][entry.entry_id]

    if not coordinator.model_info.get("supports_volume"):
        _LOGGER.info("MHUB: no volume API detected, skipping volume entities")
        return

    outputs = coordinator.video_output_labels()
    entities: list[MHUBZoneVolume] = []

    for output_id, output_label in outputs.items():
        entities.append(MHUBZoneVolume(coordinator, output_id, output_label))

    async_add_entities(entities, True)


class MHUBZoneVolume(CoordinatorEntity, NumberEntity):
    """Zone volume slider for MHUB devices with volume API."""

    _attr_min_value = 0
    _attr_max_value = 100
    _attr_step = 1

    def __init__(self, coordinator, output_id: str, name: str) -> None:
        super().__init__(coordinator)
        self.coordinator = coordinator
        self._output_id = str(output_id).lower()
        self._attr_name = f"{name} Volume"
        self._attr_unique_id = f"mhub_volume_{self._output_id}"

    @property
    def value(self) -> float | None:
        """Return current volume (0–100) for this output."""
        for zone in self.coordinator.zones():
            for state in zone.get("state", []):
                if str(state.get("output_id")).lower() == self._output_id:
                    try:
                        return int(state.get("volume", 0))
                    except Exception:
                        return 0
        return 0

    async def async_set_value(self, value: float) -> None:
        """Send volume change via /api/control/volume/[ox]/[vy]/."""
        vol = int(value)
        url = f"{self.coordinator.base_url}/control/volume/{self._output_id}/{vol}/"
        headers = {"User-Agent": "HomeAssistant-MHUB", "Accept": "application/json"}

        _LOGGER.debug("MHUB: setting volume %s -> %s", self._output_id.upper(), vol)

        session = async_get_clientsession(self.hass)
        try:
            async with session.get(url, headers=headers, allow_redirects=True) as resp:
                text = await resp.text()
                if resp.status == 200:
                    _LOGGER.info("MHUB volume set: %s -> %s", self._output_id.upper(), vol)
                else:
                    _LOGGER.warning("MHUB volume failed HTTP %s: %s", resp.status, text[:200])
        except aiohttp.ClientError as exc:
            _LOGGER.error("MHUB volume request failed: %s", exc)

        await self.coordinator.async_request_refresh()
