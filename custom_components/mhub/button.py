
from __future__ import annotations

import logging

import aiohttp
from homeassistant.components.button import ButtonEntity
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.util import slugify

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data[DOMAIN][entry.entry_id]

    entities: list[ButtonEntity] = [
        MHUBIdentifyButton(coordinator),
        MHUBRebootButton(coordinator),
    ]

    # Dynamic sequence/function buttons (if present)
    for item in coordinator.sequences():
        sid, kind, label = _parse_sequence_item(item)
        if sid and label:
            entities.append(MHUBSequenceButton(coordinator, sid, kind, label))

    async_add_entities(entities, True)


def _parse_sequence_item(item: dict) -> tuple[str | None, str, str | None]:
    """Best-effort parsing for /api/data/202 structures."""
    if not isinstance(item, dict):
        return None, "sequence", None

    # common keys
    sid = item.get("id") or item.get("sequence_id") or item.get("function_id")
    label = item.get("label") or item.get("name") or item.get("sequence_label") or item.get("function_label")

    kind = "sequence"
    if item.get("function_id") or "function" in str(item.get("type", "")).lower():
        kind = "function"
    # If the id came from function_id but we don't know, assume function
    if item.get("function_id"):
        kind = "function"

    if sid is not None:
        sid = str(sid)
    if label is not None:
        label = str(label).strip()

    return sid, kind, label


class MHUBIdentifyButton(CoordinatorEntity, ButtonEntity):
    """Flash MHUB LEDs to identify the device."""

    _attr_name = "MHUB Identify"
    _attr_icon = "mdi:flash"
    _attr_unique_id = "mhub_identify"

    async def async_press(self) -> None:
        url = f"{self.coordinator.base_url}/identify/"
        await _simple_get(self.hass, url, "identify")
        # no need to refresh


class MHUBRebootButton(CoordinatorEntity, ButtonEntity):
    """Full reboot / power cycle of MHUB."""

    _attr_name = "MHUB Reboot"
    _attr_icon = "mdi:restart"
    _attr_unique_id = "mhub_reboot"

    async def async_press(self) -> None:
        url = f"{self.coordinator.base_url}/reboot/1/"
        await _simple_get(self.hass, url, "reboot")
        # After reboot, next poll will recover


class MHUBSequenceButton(CoordinatorEntity, ButtonEntity):
    """Execute a stored MHUB sequence or function."""

    def __init__(self, coordinator, sid: str, kind: str, label: str) -> None:
        super().__init__(coordinator)
        self.coordinator = coordinator
        self._sid = sid
        self._kind = kind  # sequence | function
        self._label = label
        self._attr_name = f"{label}"
        self._attr_icon = "mdi:play-circle"
        self._attr_unique_id = f"mhub_{kind}_{slugify(sid + '_' + label)}"

    async def async_press(self) -> None:
        if self._kind == "function":
            url = f"{self.coordinator.base_url}/control/function/{self._sid}/true"
        else:
            url = f"{self.coordinator.base_url}/control/sequence/{self._sid}/true"
        await _simple_get(self.hass, url, f"{self._kind}:{self._sid}")
        await self.coordinator.async_request_refresh()


async def _simple_get(hass, url: str, name: str) -> None:
    headers = {"User-Agent": "HomeAssistant-MHUB", "Accept": "application/json"}
    session = async_get_clientsession(hass)
    try:
        async with session.get(url, headers=headers, allow_redirects=True) as resp:
            text = await resp.text()
            if resp.status == 200:
                _LOGGER.info("MHUB %s OK", name)
            else:
                _LOGGER.warning("MHUB %s failed HTTP %s: %s", name, resp.status, text[:200])
    except aiohttp.ClientError as exc:
        _LOGGER.error("MHUB %s request failed: %s", name, exc)
