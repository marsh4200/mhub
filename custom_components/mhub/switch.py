
from __future__ import annotations

import logging

import aiohttp
from homeassistant.components.switch import SwitchEntity
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.util import slugify

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass, entry, async_add_entities):
    """Set up MHUB switches: per-output mute, group mute, and global power."""
    coordinator = hass.data[DOMAIN][entry.entry_id]
    outputs = coordinator.video_output_labels()

    entities: list[SwitchEntity] = []

    # Per-output mute
    for output_id, output_label in outputs.items():
        entities.append(MHUBZoneMute(coordinator, output_id, output_label))

    # Group mute (AUDIO/MZMA)
    for g in coordinator.groups():
        gid = g.get("group_id")
        label = g.get("group_label") or g.get("label") or f"Group {gid}"
        if gid is not None:
            entities.append(MHUBGroupMute(coordinator, str(gid), str(label)))

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
        self._attr_icon = "mdi:volume-off"

    @property
    def is_on(self) -> bool:
        for zone in self.coordinator.zones():
            for state in zone.get("state", []) or []:
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


class MHUBGroupMute(CoordinatorEntity, SwitchEntity):
    """Mute a group (MHUB AUDIO / MZMA)."""

    _attr_icon = "mdi:volume-mute"

    def __init__(self, coordinator, group_id: str, label: str) -> None:
        super().__init__(coordinator)
        self.coordinator = coordinator
        self._gid = str(group_id)
        self._label = label
        self._attr_name = f"{label} Group Mute"
        self._attr_unique_id = f"mhub_group_mute_{slugify(self._gid + '_' + label)}"

    @property
    def is_on(self) -> bool:
        for g in self.coordinator.groups():
            if str(g.get("group_id")) == self._gid:
                return bool(g.get("group_mute", False))
        return False

    async def async_turn_on(self, **kwargs) -> None:
        await self._set_mute(True)

    async def async_turn_off(self, **kwargs) -> None:
        await self._set_mute(False)

    async def _set_mute(self, mute: bool) -> None:
        state = "true" if mute else "false"
        url = f"{self.coordinator.base_url}/control/mutegroup/{self._gid}/{state}/"
        headers = {"User-Agent": "HomeAssistant-MHUB", "Accept": "application/json"}

        session = async_get_clientsession(self.hass)
        try:
            async with session.get(url, headers=headers, allow_redirects=True) as resp:
                text = await resp.text()
                if resp.status == 200:
                    _LOGGER.info("MHUB group mute %s: %s", self._gid, state)
                else:
                    _LOGGER.warning("MHUB group mute failed HTTP %s: %s", resp.status, text[:200])
        except aiohttp.ClientError as exc:
            _LOGGER.error("MHUB group mute request failed: %s", exc)

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
        power = self.coordinator.power_state()
        if power is None:
            return True
        return bool(power)

    async def async_turn_on(self, **kwargs) -> None:
        await self._send_power_command(1)

    async def async_turn_off(self, **kwargs) -> None:
        await self._send_power_command(0)

    async def _send_power_command(self, value: int) -> None:
        url = f"{self.coordinator.base_url}/power/{value}/"
        headers = {"User-Agent": "HomeAssistant-MHUB", "Accept": "application/json"}

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
