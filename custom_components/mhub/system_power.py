from homeassistant.components.switch import SwitchEntity
import aiohttp
import logging
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data[DOMAIN][entry.entry_id]
    async_add_entities([MHUBSystemPower(coordinator)], True)


class MHUBSystemPower(SwitchEntity):
    """Global on/off for the entire MHUB chassis."""

    _attr_name = "MHUB System Power"
    _attr_icon = "mdi:power"
    _attr_unique_id = "mhub_system_power"

    def __init__(self, coordinator):
        self._coordinator = coordinator
        self._state = True  # assume ON by default

    @property
    def is_on(self):
        return self._state

    async def async_turn_on(self):
        await self._send_power_command(1)

    async def async_turn_off(self):
        await self._send_power_command(0)

    async def _send_power_command(self, value):
        """Send full-system power command, fallback to soft logic."""
        url = f"http://{self._coordinator.host}/api/control/power/{value}/"
        headers = {"User-Agent": "curl/8.0", "Accept": "application/json"}
        _LOGGER.info(f"🔌 Sending MHUB system power {value}")
        try:
            async with aiohttp.ClientSession(headers=headers) as s:
                async with s.get(url, allow_redirects=True) as resp:
                    if resp.status == 200:
                        _LOGGER.info(f"✅ MHUB system power {'ON' if value else 'OFF'}")
                        self._state = bool(value)
                    else:
                        _LOGGER.warning(f"⚠️ System power failed HTTP {resp.status}")
        except Exception as e:
            _LOGGER.error(f"❌ MHUB system power request failed: {e}")
            # fallback: soft toggle
            self._state = bool(value)
        self.async_write_ha_state()
        await self._coordinator.async_request_refresh()
