from homeassistant.components.media_player import (
    MediaPlayerEntity,
    MediaPlayerEntityFeature,
    MediaPlayerState,
)
import aiohttp
import asyncio
import logging
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data[DOMAIN][entry.entry_id]
    model = coordinator.model_info.get("model")
    outputs = coordinator.output_labels()
    entities = []
    for output_id, output_label in outputs.items():
        entities.append(MHUBOutputEntity(coordinator, output_id, output_label))
    async_add_entities(entities, True)


class MHUBOutputEntity(MediaPlayerEntity):
    _attr_supported_features = (
        MediaPlayerEntityFeature.SELECT_SOURCE |
        MediaPlayerEntityFeature.TURN_ON |
        MediaPlayerEntityFeature.TURN_OFF
    )
    _attr_device_class = "tv"

    def __init__(self, coordinator, output_id, name):
        self._coordinator = coordinator
        self._output_id = str(output_id).lower()
        self._attr_name = name
        self._attr_unique_id = f"mhub_output_{output_id}"
        self._attr_source_list = []
        self._attr_source = None
        self._attr_state = MediaPlayerState.OFF

    async def async_added_to_hass(self):
        await self._coordinator.async_request_refresh()
        self._load_sources()
        self._update_power_state()
        _LOGGER.debug(f"{self._attr_name} initialized: {self._attr_source_list}")

    def _load_sources(self):
        try:
            inputs = self._coordinator.data.get("info", {}).get("io_data", {}).get("input_video", [])
            if inputs and isinstance(inputs, list):
                self._attr_source_list = [lbl["label"] for lbl in inputs[0].get("labels", [])]
        except Exception:
            self._attr_source_list = [f"Input {i}" for i in range(1, 9)]
        self._attr_source = self._get_current_source()

    def _get_current_source(self):
        zones = self._coordinator.data.get("state", {}).get("zones", [])
        for zone in zones:
            for s in zone.get("state", []):
                if str(s.get("output_id")).lower() == self._output_id:
                    return self._input_label_from_id(s.get("input_id"))
        return None

    def _input_label_from_id(self, input_id):
        inputs = self._coordinator.data.get("info", {}).get("io_data", {}).get("input_video", [])
        if inputs:
            for lbl in inputs[0].get("labels", []):
                if str(lbl.get("id")) == str(input_id):
                    return lbl.get("label")
        return f"Input {input_id}"

    def _input_id_from_label(self, label):
        inputs = self._coordinator.data.get("info", {}).get("io_data", {}).get("input_video", [])
        if inputs:
            for lbl in inputs[0].get("labels", []):
                if lbl.get("label") == label:
                    return lbl.get("id")
        return ''.join([c for c in label if c.isdigit()]) or "1"

    def _update_power_state(self):
        # soft-power: ON if any input_id > 0, else OFF
        zones = self._coordinator.data.get("state", {}).get("zones", [])
        active = False
        for z in zones:
            for s in z.get("state", []):
                if str(s.get("output_id")).lower() == self._output_id:
                    try:
                        if int(s.get("input_id", 0)) > 0:
                            active = True
                    except Exception:
                        active = True
        self._attr_state = MediaPlayerState.ON if active else MediaPlayerState.OFF

    async def async_turn_on(self):
        # soft on: just set state and refresh
        self._attr_state = MediaPlayerState.ON
        self.async_write_ha_state()
        await self._coordinator.async_request_refresh()
        self._load_sources()

    async def async_turn_off(self):
        # soft off: set an internal state (no API) and refresh
        self._attr_state = MediaPlayerState.OFF
        self.async_write_ha_state()
        await self._coordinator.async_request_refresh()

    async def async_select_source(self, source):
        input_id = self._input_id_from_label(source)
        output_id = self._output_id
        url = f"http://{self._coordinator.host}/api/control/switch/{output_id}/{input_id}/"
        headers = {"User-Agent": "curl/8.0", "Accept": "application/json"}
        _LOGGER.info(f"Switching Output {output_id.upper()} -> Input {input_id}")
        asyncio.create_task(self._async_send_switch(url, source, output_id, input_id, headers))

    async def _async_send_switch(self, url, source, output_id, input_id, headers):
        try:
            async with aiohttp.ClientSession(headers=headers) as session:
                async with session.get(url, allow_redirects=True) as resp:
                    text = await resp.text()
                    if resp.status == 200:
                        _LOGGER.info(f"MHUB switched: {output_id.upper()} -> {input_id}")
                        self._attr_source = source
                        self._attr_state = MediaPlayerState.ON
                        self.async_write_ha_state()
                    else:
                        _LOGGER.warning(f"Switch failed HTTP {resp.status}: {text}")
        except Exception as e:
            _LOGGER.error(f"Switch request failed: {e}")
        await self._coordinator.async_request_refresh()
        self._load_sources()

    async def async_update(self):
        await self._coordinator.async_request_refresh()
        self._load_sources()
        self._update_power_state()

    @property
    def source_list(self):
        return self._attr_source_list

    @property
    def source(self):
        return self._attr_source

    @property
    def state(self):
        return self._attr_state

    @property
    def extra_state_attributes(self):
        return {
            "Output": self._output_id.upper(),
            "Model": self._coordinator.model_info.get("model"),
            "Firmware": self._coordinator.model_info.get("firmware"),
        }
