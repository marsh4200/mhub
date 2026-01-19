from __future__ import annotations

import logging
from typing import Any

import aiohttp

from homeassistant.components.media_player import (
    MediaPlayerEntity,
    MediaPlayerEntityFeature,
    MediaPlayerState,
)
from homeassistant.core import HomeAssistant
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass: HomeAssistant, entry, async_add_entities):
    """Set up MHUB media_player entities from a config entry."""
    coordinator = hass.data[DOMAIN][entry.entry_id]
    outputs = coordinator.video_output_labels()

    entities: list[MHUBOutputEntity] = []
    for output_id, output_label in outputs.items():
        entities.append(MHUBOutputEntity(coordinator, output_id, output_label))

    async_add_entities(entities, True)


class MHUBOutputEntity(CoordinatorEntity, MediaPlayerEntity):
    """Represents a single MHUB video output as a media_player."""

    _attr_supported_features = (
        MediaPlayerEntityFeature.SELECT_SOURCE |
        MediaPlayerEntityFeature.TURN_ON |
        MediaPlayerEntityFeature.TURN_OFF
    )
    _attr_device_class = "tv"

    def __init__(self, coordinator, output_id: str, name: str) -> None:
        super().__init__(coordinator)
        self.coordinator = coordinator
        self._output_id = str(output_id).lower()
        self._attr_name = name
        self._attr_unique_id = f"mhub_output_{self._output_id}"
        self._source_list: list[str] = []
        self._current_source: str | None = None
        self._update_sources_from_coordinator()

    # ---- Coordinator-driven updates ------------------------------------------

    @property
    def available(self) -> bool:
        return self.coordinator.last_update_success

    async def async_added_to_hass(self) -> None:
        """Run when entity is added."""
        self._update_sources_from_coordinator()
        self._current_source = self._get_current_source()

    def _update_sources_from_coordinator(self) -> None:
        """Rebuild the list of sources from coordinator io_data."""
        labels = self.coordinator.video_input_labels()
        if labels:
            self._source_list = list(labels.values())
        else:
            # Fallback generic list
            self._source_list = [f"Input {i}" for i in range(1, 9)]

    # ---- Helpers over coordinator.state --------------------------------------

    def _get_current_state_block(self) -> dict[str, Any] | None:
        """Find the state block for this output in /api/data/200/."""
        for zone in self.coordinator.zones():
            for state in zone.get("state", []):
                if str(state.get("output_id")).lower() == self._output_id:
                    return state
        return None

    def _get_current_source(self) -> str | None:
        block = self._get_current_state_block()
        if not block:
            return None
        input_id = str(block.get("input_id"))
        input_labels = self.coordinator.video_input_labels()
        return input_labels.get(input_id, f"Input {input_id}")

    # ---- Properties ----------------------------------------------------------

    @property
    def source_list(self) -> list[str]:
        return self._source_list

    @property
    def source(self) -> str | None:
        self._current_source = self._get_current_source()
        return self._current_source

    @property
    def state(self) -> MediaPlayerState | None:
        # If we know the chassis is in standby, report OFF
        power = self.coordinator.power_state()
        if power is False:
            return MediaPlayerState.OFF

        # Otherwise, consider ON if there is a valid input selected
        block = self._get_current_state_block()
        if not block:
            return MediaPlayerState.OFF

        try:
            input_id = int(block.get("input_id", 0))
            if input_id > 0:
                return MediaPlayerState.ON
        except Exception:
            return MediaPlayerState.ON

        return MediaPlayerState.OFF

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        return {
            "output": self._output_id.upper(),
            "model": self.coordinator.model_info.get("model"),
            "firmware": self.coordinator.model_info.get("firmware"),
        }

    # ---- Actions -------------------------------------------------------------

    async def async_turn_on(self) -> None:
        """Soft power on – just mark as on; real power is done by switch entity."""
        # No direct API: turning on is usually done by selecting a source.
        # We just refresh to pick up routing state.
        await self.coordinator.async_request_refresh()

    async def async_turn_off(self) -> None:
        """Soft power off – no direct API for outputs, rely on MHUB power switch."""
        # You could additionally route input 0 if the device supported that.
        await self.coordinator.async_request_refresh()

    async def async_select_source(self, source: str) -> None:
        """Switch this output to a new input."""
        # Find input ID from label
        input_labels = self.coordinator.video_input_labels()
        input_id: str | None = None
        for i_id, label in input_labels.items():
            if label == source:
                input_id = i_id
                break

        if input_id is None:
            # Fallback: attempt to extract number from the string
            digits = "".join(c for c in source if c.isdigit())
            input_id = digits or "1"

        url = f"{self.coordinator.base_url}/control/switch/{self._output_id}/{input_id}/"
        headers = {"User-Agent": "HomeAssistant-MHUB", "Accept": "application/json"}

        _LOGGER.info("MHUB: Switching output %s -> input %s", self._output_id.upper(), input_id)

        session = async_get_clientsession(self.hass)
        try:
            async with session.get(url, headers=headers, allow_redirects=True) as resp:
                body = await resp.text()
                if resp.status == 200:
                    _LOGGER.debug("MHUB switch ok: %s", body[:200])
                else:
                    _LOGGER.warning("MHUB switch failed HTTP %s: %s", resp.status, body[:200])
        except aiohttp.ClientError as exc:
            _LOGGER.error("MHUB switch request failed: %s", exc)

        await self.coordinator.async_request_refresh()
