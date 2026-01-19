from __future__ import annotations

import logging

import aiohttp
from homeassistant.components.switch import SwitchEntity
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass: HomeAssistant, entry, async_add_entities):
    """Set up MHUB switches: per-output mute and global power."""
    coordinator = hass.data[DOMAIN][entry.entry_id]
    outputs = coordinator.video_output_labels()

    entities: list[SwitchEntity] = []

    # Per-output mute
    for output_id, output_label in outputs.items():
        entities.append(MHUBZoneMute(coordinator, output_id, output_label))

    # Global system power (if API is supported)
    if coordinator.model_info.get("supports_power_api", False):
        entities.append(MHUBSystemPower(coordinator))

    async_add_entities(entities, True)


class MHUBZoneMute(CoordinatorEntity, SwitchEntity):
    """Per-output mute switch."""

    def __init__(self, coordinator, output_id: str, name: str) -> None:
        super().__init__(coordinator)
        self.coordinator = coordinator
        self._output_id = str(output_id).lower()
        self._attr_name = f"{name} Mute"
        self._attr_unique_id = f"mhub_mute_{self._output_id}"

    @property
    def is_on(self) -> bool:
        """Return True if this output is muted."""
        for zone in self.coordinator.zones():
            for state in zone.get("state", []):
                if str(state.get("output_id")).lower() == self._output_id:
                    return bool(state.get("mute", False))
        return False

    async def async_turn_on(self, **kwargs) -> None:
        await self._set_mute(True)

    async def async_turn_off(self, **kwargs) -> None:
        await self._set_mute(False)

    async def _set_mute(self, mute: bool) -> None:
        state = "true" if mute else "false"
        url = f"{self.coordinator.base_url}/control/mute/{self._output_id}/{state}/"
        headers = {"User-Agent": "HomeAssistant-MHUB", "Accept": "application/json"}

        _LOGGER.debug("MHUB: mute %s -> %s", self._output_id.upper(), state)

        session = async_get_clientsession(self.hass)
        try:
            async with session.get(url, headers=headers, allow_redirects=True) as resp:
                text = await resp.text()
                if resp.status == 200:
                    _LOGGER.info("MHUB mute %s: %s", self._output_id.upper(), state)
                else:
                    _LOGGER.warning("MHUB mute failed HTTP %s: %s", resp.status, text[:200])
        except aiohttp.ClientError as exc:
            _LOGGER.error("MHUB mute request failed: %s", exc)

        await self.coordinator.async_request_refresh()


class MHUBSystemPower(CoordinatorEntity, SwitchEntity):
    """Global standby control for the entire MHUB chassis.

    Uses:
      GET /api/power/0/ -> Standby ON (turn off)
      GET /api/power/1/ -> Standby OFF (turn on)
    and reads /api/data/0/ via coordinator to show state.
    """

    _attr_name = "MHUB System Power"
    _attr_icon = "mdi:power"
    _attr_unique_id = "mhub_system_power"

    def __init__(self, coordinator) -> None:
        super().__init__(coordinator)
        self.coordinator = coordinator

    @property
    def is_on(self) -> bool:
        """True if MHUB is on (not in standby)."""
        power = self.coordinator.power_state()
        if power is None:
            # Unknown, assume on
            return True
        return bool(power)

    async def async_turn_on(self, **kwargs) -> None:
        await self._send_power_command(1)

    async def async_turn_off(self, **kwargs) -> None:
        await self._send_power_command(0)

    async def _send_power_command(self, value: int) -> None:
        url = f"{self.coordinator.base_url}/power/{value}/"
        headers = {"User-Agent": "HomeAssistant-MHUB", "Accept": "application/json"}

        _LOGGER.info("MHUB: sending system power %s (%s)", value, "ON" if value else "OFF")

        session = async_get_clientsession(self.hass)
        try:
            async with session.get(url, headers=headers, allow_redirects=True) as resp:
                text = await resp.text()
                if resp.status == 200:
                    _LOGGER.info("MHUB system power OK: %s", "ON" if value else "OFF")
                else:
                    _LOGGER.warning("MHUB system power failed HTTP %s: %s", resp.status, text[:200])
        except aiohttp.ClientError as exc:
            _LOGGER.error("MHUB system power request failed: %s", exc)

        await self.coordinator.async_request_refresh()
