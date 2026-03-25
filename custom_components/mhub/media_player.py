from __future__ import annotations

import logging
from typing import Any

import aiohttp

from homeassistant.components.media_player import (
    MediaPlayerEntity,
    MediaPlayerEntityFeature,
    MediaPlayerState,
)
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass, entry, async_add_entities):
    """Set up MHUB media_player entities from a config entry."""
    coordinator = hass.data[DOMAIN][entry.entry_id]

    entities: list[MediaPlayerEntity] = []

    # ONLY create output players (A B C D)
    outputs = coordinator.video_output_labels()

    for output_id, output_label in outputs.items():
        entities.append(MHUBOutputEntity(coordinator, entry.entry_id, output_id, output_label))

    async_add_entities(entities, True)


class _BaseMHUBPlayer(CoordinatorEntity, MediaPlayerEntity):

    _attr_supported_features = (
        MediaPlayerEntityFeature.SELECT_SOURCE
        | MediaPlayerEntityFeature.TURN_ON
        | MediaPlayerEntityFeature.TURN_OFF
    )

    _attr_device_class = "tv"

    def _update_sources_from_coordinator(self) -> None:
        labels = self.coordinator.video_input_labels()

        if labels:
            self._source_list = list(labels.values())
        else:
            self._source_list = [f"Input {i}" for i in range(1, 9)]

    @property
    def available(self) -> bool:
        return self.coordinator.last_update_success

    @property
    def source_list(self) -> list[str]:
        self._update_sources_from_coordinator()
        return self._source_list

    def _find_state_for_output(self, output_id: str) -> dict[str, Any] | None:

        for zone in self.coordinator.zones():
            for state in zone.get("state", []) or []:
                if str(state.get("output_id")).lower() == str(output_id).lower():
                    return state

        return None

    def _get_current_source_for_output(self, output_id: str) -> str | None:

        block = self._find_state_for_output(output_id)

        if not block:
            return None

        input_id = str(block.get("input_id"))

        input_labels = self.coordinator.video_input_labels()

        return input_labels.get(input_id, f"Input {input_id}")

    async def _switch_output_to_source(self, output_id: str, source: str) -> None:

        input_labels = self.coordinator.video_input_labels()

        input_id: str | None = None

        for i_id, label in input_labels.items():
            if label == source:
                input_id = i_id
                break

        if input_id is None:
            digits = "".join(c for c in source if c.isdigit())
            input_id = digits or "1"

        url = f"{self.coordinator.base_url}/control/switch/{str(output_id).lower()}/{input_id}/"

        headers = {"User-Agent": "HomeAssistant-MHUB", "Accept": "application/json"}

        _LOGGER.info("MHUB: Switching output %s -> input %s", str(output_id).upper(), input_id)

        session = async_get_clientsession(self.hass)

        try:

            async with session.get(url, headers=headers, allow_redirects=True) as resp:

                body = await resp.text()

                if resp.status != 200:
                    _LOGGER.warning("MHUB switch failed HTTP %s: %s", resp.status, body[:200])

        except aiohttp.ClientError as exc:
            _LOGGER.error("MHUB switch request failed: %s", exc)

        await self.coordinator.async_request_refresh()

    @property
    def state(self) -> MediaPlayerState | None:

        power = self.coordinator.power_state()

        if power is False:
            return MediaPlayerState.OFF

        return MediaPlayerState.ON


class MHUBOutputEntity(_BaseMHUBPlayer):

    def __init__(self, coordinator, entry_id: str, output_id: str, name: str) -> None:

        super().__init__(coordinator)

        self.coordinator = coordinator
        self._entry_id = entry_id
        self._output_id = str(output_id).lower()
        self._zone_id, self._zone_label = self._resolve_zone_for_output(self._output_id)

        self._attr_name = name
        self._attr_unique_id = f"{entry_id}_mhub_output_{self._output_id}"

        self._source_list: list[str] = []

        self._update_sources_from_coordinator()

    def _resolve_zone_for_output(self, output_id: str) -> tuple[str | None, str | None]:
        for zone in self.coordinator.zones_config():
            zone_id = zone.get("zone_id")
            zone_label = zone.get("zone_label", zone_id)
            for output in zone.get("outputs", []) or []:
                current_output_id = str(output.get("output_id", "")).lower()
                if current_output_id == output_id:
                    return (str(zone_id), str(zone_label) if zone_label is not None else None)
        return (None, None)

    @property
    def device_info(self) -> DeviceInfo:
        info = self.coordinator.data.get("device_info", {})
        zone_id = self._zone_id or f"output_{self._output_id}"
        zone_name = self._zone_label or self._attr_name
        return DeviceInfo(
            identifiers={(DOMAIN, f"{self._entry_id}_{zone_id}")},
            name=zone_name,
            manufacturer="HDANYWHERE",
            model=info.get("model", "MHUB Zone"),
            serial_number=info.get("serial_number"),
            sw_version=info.get("firmware"),
            hw_version=info.get("unit_id"),
            configuration_url=f"http://{info.get('ip_address', self.coordinator.api.host)}",
            via_device=(DOMAIN, self._entry_id),
        )

    @property
    def source(self) -> str | None:
        return self._get_current_source_for_output(self._output_id)

    @property
    def extra_state_attributes(self) -> dict[str, Any]:

        return {
            "output": self._output_id.upper(),
            "model": self.coordinator.model_info.get("model"),
            "firmware": self.coordinator.model_info.get("firmware"),
        }

    async def async_turn_on(self) -> None:
        await self.coordinator.async_request_refresh()

    async def async_turn_off(self) -> None:
        await self.coordinator.async_request_refresh()

    async def async_select_source(self, source: str) -> None:
        await self._switch_output_to_source(self._output_id, source)
