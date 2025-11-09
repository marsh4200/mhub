from homeassistant.components.number import NumberEntity
import aiohttp
import logging
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data[DOMAIN][entry.entry_id]
    outputs = coordinator.output_labels()
    entities = []
    for output_id, output_label in outputs.items():
        entities.append(MHUBZoneVolume(coordinator, output_id, output_label))
    async_add_entities(entities, True)

class MHUBZoneVolume(NumberEntity):
    def __init__(self, coordinator, output_id, name):
        self._coordinator = coordinator
        self._output_id = str(output_id).lower()
        self._attr_name = f"{name} Volume"
        self._attr_min_value = 0
        self._attr_max_value = 100
        self._attr_step = 1
        self._attr_unique_id = f"mhub_volume_{output_id}"

    @property
    def value(self):
        zones = self._coordinator.data.get("state", {}).get("zones", [])
        for zone in zones:
            for s in zone.get("state", []):
                if str(s.get("output_id")).lower() == self._output_id:
                    try:
                        return int(s.get("volume", 0))
                    except Exception:
                        return 0
        return 0

    async def async_set_value(self, value):
        output_id = self._output_id.lower()
        url = f"http://{self._coordinator.host}/api/control/volume/{output_id}/{int(value)}/"
        _LOGGER.debug(f"Setting MHUB volume: {url}")
        headers = {"User-Agent": "curl/8.0", "Accept": "application/json"}
        try:
            async with aiohttp.ClientSession(headers=headers) as session:
                async with session.get(url, allow_redirects=True) as resp:
                    text = await resp.text()
                    if resp.status == 200:
                        _LOGGER.info(f"MHUB volume set: Output {output_id.upper()} -> {value}")
                    else:
                        _LOGGER.warning(f"MHUB volume failed: HTTP {resp.status} | {text}")
        except Exception as e:
            _LOGGER.error(f"MHUB volume request failed: {e}")
        await self._coordinator.async_request_refresh()
