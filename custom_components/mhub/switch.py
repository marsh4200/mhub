"""
switch.py for MHUB integration
- Keeps existing per-output Mute switches
- Adds two global stateless power switches:
    - switch.mhub_power_on  -> calls /api/power/1/
    - switch.mhub_power_off -> calls /api/power/0/
"""

from homeassistant.components.switch import SwitchEntity
import aiohttp
import logging
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data[DOMAIN][entry.entry_id]
    outputs = coordinator.output_labels()

    entities = []
    # Existing per-output mute switches
    for output_id, output_label in outputs.items():
        entities.append(MHUBZoneMute(coordinator, output_id, output_label))

    # Add the two global Power switches (stateless trigger switches)
    entities.append(MHUBPowerTrigger(coordinator, True))   # Power ON
    entities.append(MHUBPowerTrigger(coordinator, False))  # Power OFF

    async_add_entities(entities, True)


class MHUBZoneMute(SwitchEntity):
    """Per-output mute switch (existing behavior)."""

    def __init__(self, coordinator, output_id, name):
        self._coordinator = coordinator
        self._output_id = str(output_id).lower()
        self._attr_name = f"{name} Mute"
        self._attr_unique_id = f"mhub_mute_{output_id}"

    @property
    def is_on(self):
        zones = self._coordinator.data.get("state", {}).get("zones", [])
        for zone in zones:
            for s in zone.get("state", []):
                if str(s.get("output_id")).lower() == self._output_id:
                    return bool(s.get("mute", False))
        return False

    async def async_turn_on(self, **kwargs):
        """Mute this output."""
        output_id = self._output_id.lower()
        url = f"http://{self._coordinator.host}/api/control/mute/{output_id}/true/"
        _LOGGER.debug(f"Muting MHUB output: {url}")
        headers = {"User-Agent": "curl/8.0", "Accept": "application/json"}
        try:
            async with aiohttp.ClientSession(headers=headers) as session:
                async with session.get(url, allow_redirects=True) as resp:
                    text = await resp.text()
                    if resp.status == 200:
                        _LOGGER.info(f"MHUB mute on: Output {output_id.upper()}")
                    else:
                        _LOGGER.warning(f"MHUB mute failed: HTTP {resp.status} | {text}")
        except Exception as e:
            _LOGGER.error(f"MHUB mute request failed: {e}")
        await self._coordinator.async_request_refresh()

    async def async_turn_off(self, **kwargs):
        """Unmute this output."""
        output_id = self._output_id.lower()
        url = f"http://{self._coordinator.host}/api/control/mute/{output_id}/false/"
        _LOGGER.debug(f"Unmuting MHUB output: {url}")
        headers = {"User-Agent": "curl/8.0", "Accept": "application/json"}
        try:
            async with aiohttp.ClientSession(headers=headers) as session:
                async with session.get(url, allow_redirects=True) as resp:
                    text = await resp.text()
                    if resp.status == 200:
                        _LOGGER.info(f"MHUB mute off: Output {output_id.upper()}")
                    else:
                        _LOGGER.warning(f"MHUB unmute failed: HTTP {resp.status} | {text}")
        except Exception as e:
            _LOGGER.error(f"MHUB unmute request failed: {e}")
        await self._coordinator.async_request_refresh()


class MHUBPowerTrigger(SwitchEntity):
    """
    Stateless global power trigger switch.
    - If is_on_switch == True  -> acts as 'Power ON' button (calls /api/power/1/)
    - If is_on_switch == False -> acts as 'Power OFF' button (calls /api/power/0/)
    The switch does not maintain a persistent state; it acts as a trigger.
    """

    def __init__(self, coordinator, is_on_switch: bool):
        self._coordinator = coordinator
        self._is_on_switch = is_on_switch
        self._attr_name = f"MHUB Power {'On' if is_on_switch else 'Off'}"
        self._attr_unique_id = f"mhub_power_{'on' if is_on_switch else 'off'}"
        self._attr_icon = "mdi:power"

    @property
    def is_on(self):
        """
        Always return False so the entity appears as a momentary toggle.
        This keeps the UI simple: pressing it triggers the command and it doesn't stay 'on'.
        """
        return False

    async def async_turn_on(self, **kwargs):
        """Send the appropriate power command to the MHUB."""
        value = 1 if self._is_on_switch else 0
        url = f"http://{self._coordinator.host}/api/power/{value}/"
        headers = {"User-Agent": "curl/8.0", "Accept": "application/json"}
        _LOGGER.info(f"🔌 Sending MHUB Power {'ON' if value else 'OFF'} -> {url}")

        try:
            async with aiohttp.ClientSession(headers=headers) as session:
                async with session.get(url, allow_redirects=True) as resp:
                    text = await resp.text()
                    if resp.status == 200:
                        _LOGGER.info(f"✅ MHUB Power {'ON' if value else 'OFF'} success")
                    else:
                        _LOGGER.warning(f"⚠️ MHUB Power command failed HTTP {resp.status}: {text}")
        except Exception as e:
            _LOGGER.error(f"❌ MHUB Power command error: {e}")

        # trigger a coordinator refresh so the integration updates immediately
        await self._coordinator.async_request_refresh()
        # write state (stateless - keep UI consistent)
        self.async_write_ha_state()

    async def async_turn_off(self, **kwargs):
        """No-op for turn_off; keep stateless trigger behaviour."""
        self.async_write_ha_state()
