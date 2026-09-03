from __future__ import annotations

import logging

import aiohttp
from homeassistant.components.button import ButtonEntity
from homeassistant.helpers.aiohttp_client import async_get_clientsession
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import slugify

from .const import CONTROL_METHOD_CEC, CONTROL_METHOD_IR, CONTROL_METHOD_NONE, DOMAIN

_LOGGER = logging.getLogger(__name__)


def _get_zone_options(entry, zone_id: str | None) -> dict:
    if not zone_id:
        return {}
    return entry.options.get("zones", {}).get(zone_id, {})


def _command_allowed(zone_opts: dict, command_id) -> bool:
    commands = zone_opts.get("commands")
    if commands is None:
        return True
    return int(command_id) in [int(c) for c in commands]


def _get_cec_type(output_id: str) -> int:
    return 0 if output_id == "a" else 1


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data[DOMAIN][entry.entry_id]

    entities: list[ButtonEntity] = [
        MHUBIdentifyButton(coordinator, entry.entry_id),
        MHUBRebootButton(coordinator, entry.entry_id),
    ]

    entities.extend(_build_source_buttons(coordinator, entry.entry_id))
    for item in coordinator.sequences():
        sid, kind, label = _parse_sequence_item(item)
        if sid and label:
            entities.append(MHUBSequenceButton(coordinator, entry.entry_id, sid, kind, label))

    entities.extend(_build_ir_buttons(coordinator, entry))
    entities.extend(_build_cec_buttons(coordinator, entry))

    async_add_entities(entities, True)

    try:
        from .custom_ir import async_setup_custom_ir_buttons

        await async_setup_custom_ir_buttons(hass, entry, async_add_entities, coordinator)
    except Exception as exc:
        _LOGGER.error("Failed to load custom IR buttons: %s", exc)


def _parse_sequence_item(item: dict) -> tuple[str | None, str, str | None]:
    if not isinstance(item, dict):
        return None, "sequence", None

    sid = item.get("id") or item.get("sequence_id") or item.get("function_id")
    label = item.get("label") or item.get("name") or item.get("sequence_label") or item.get("function_label")

    kind = "sequence"
    if item.get("function_id") or "function" in str(item.get("type", "")).lower():
        kind = "function"

    if sid is not None:
        sid = str(sid)
    if label is not None:
        label = str(label).strip()

    return sid, kind, label


def _build_source_buttons(coordinator, entry_id: str) -> list[ButtonEntity]:
    entities: list[ButtonEntity] = []
    outputs = coordinator.video_output_labels()
    sources = coordinator.video_input_labels()

    for output_id, output_label in outputs.items():
        zone_id, zone_label = _resolve_zone_for_output(coordinator, output_id)
        device_identifier, device_name = _build_output_device_details(
            coordinator, entry_id, output_id, output_label, zone_id, zone_label
        )

        for input_id, source_label in sources.items():
            entities.append(
                MHUBSourceButton(
                    coordinator,
                    entry_id,
                    device_identifier,
                    device_name,
                    output_id,
                    str(input_id),
                    str(source_label),
                )
            )

    return entities


def _resolve_zone_for_output(coordinator, output_id: str) -> tuple[str | None, str | None]:
    target_output_id = str(output_id).lower()
    for zone in coordinator.zones_config():
        zone_id = zone.get("zone_id")
        zone_label = zone.get("zone_label", zone_id)
        for output in zone.get("outputs", []) or []:
            current_output_id = str(output.get("output_id", "")).lower()
            if current_output_id == target_output_id:
                return (str(zone_id), str(zone_label) if zone_label is not None else None)
    return (None, None)


def _build_output_device_details(coordinator, entry_id: str, output_id: str, output_label: str, zone_id, zone_label):
    output_key = str(output_id).lower()
    resolved_zone_id = zone_id or f"output_{output_key}"
    resolved_zone_name = zone_label or output_label
    device_identifier = (DOMAIN, f"{entry_id}_{resolved_zone_id}")
    return device_identifier, resolved_zone_name


def _build_ir_buttons(coordinator, entry) -> list[ButtonEntity]:
    entities: list[ButtonEntity] = []
    zones = coordinator.zones_config()
    zones_dict = {zone["zone_id"]: zone.get("zone_label", zone["zone_id"]) for zone in zones}
    ir_devices = coordinator.data.get("ir_devices", {}) or {}
    ir_port_to_output = coordinator.data.get("ir_port_to_output", {}) or {}
    output_to_zone = coordinator.data.get("output_to_zone", {}) or {}

    for device_key, pack in ir_devices.items():
        port_type = pack.get("_port_type")
        port_id = pack.get("_port_id")
        pack_name = pack.get("name", f"{port_type} {port_id}")

        if port_type == "output":
            output_id = ir_port_to_output.get(port_id)
            zone_id = output_to_zone.get(output_id) if output_id else None
            zone_label = zones_dict.get(zone_id) if zone_id else None
            device_identifier = (DOMAIN, f"{entry.entry_id}_display_{device_key}")
            if zone_label and output_id:
                device_name = f"{zone_label} (Output {output_id.upper()}) - {pack_name}"
            elif output_id:
                device_name = f"Output {output_id.upper()} - {pack_name}"
            else:
                device_name = f"Display - {pack_name}"
            model = "MHUB Display IR"
        else:
            zone_id = None
            device_identifier = (DOMAIN, f"{entry.entry_id}_source_{device_key}")
            device_name = f"Source - {pack_name}"
            model = "MHUB Source IR"

        zone_opts = _get_zone_options(entry, zone_id) if zone_id else {}
        method = zone_opts.get("control_method")
        if zone_id and method in (CONTROL_METHOD_CEC, CONTROL_METHOD_NONE):
            continue
        if zone_id and method not in (CONTROL_METHOD_IR, None):
            continue

        ir_commands = pack.get("ir_pack") or pack.get("irpack") or []
        for command in ir_commands:
            command_id = command.get("command_id") or command.get("id")
            command_label = command.get("label")
            if not command_id or not command_label:
                continue
            if not _command_allowed(zone_opts, command_id):
                continue
            entities.append(
                MHUBIRButton(
                    coordinator,
                    entry.entry_id,
                    device_identifier,
                    device_name,
                    int(port_id),
                    int(command_id),
                    str(command_label),
                    model,
                )
            )

    return entities


def _build_cec_buttons(coordinator, entry) -> list[ButtonEntity]:
    entities: list[ButtonEntity] = []
    cec_commands = coordinator.data.get("cec_commands", []) or []

    for zone in coordinator.zones_config():
        zone_id = zone["zone_id"]
        zone_opts = _get_zone_options(entry, zone_id)
        if zone_opts.get("control_method") != CONTROL_METHOD_CEC:
            continue

        zone_label = zone.get("zone_label", zone_id)
        outputs = zone.get("outputs", []) or []
        if not outputs:
            continue

        output_id = str(outputs[0].get("output_id", "")).lower()
        if not output_id:
            continue

        device_identifier = (DOMAIN, f"{entry.entry_id}_cec_{zone_id}")
        device_name = f"{zone_label} - CEC"

        for command in cec_commands:
            command_id = command.get("id")
            command_label = command.get("label")
            if command_id is None or not command_label:
                continue
            if not _command_allowed(zone_opts, command_id):
                continue
            entities.append(
                MHUBCECButton(
                    coordinator,
                    entry.entry_id,
                    device_identifier,
                    device_name,
                    output_id,
                    _get_cec_type(output_id),
                    int(command_id),
                    str(command_label),
                )
            )

    return entities


class MHUBIdentifyButton(CoordinatorEntity, ButtonEntity):
    _attr_name = "MHUB Identify"
    _attr_icon = "mdi:flash"

    def __init__(self, coordinator, entry_id: str) -> None:
        super().__init__(coordinator)
        self._entry_id = entry_id
        self._attr_unique_id = f"{entry_id}_mhub_identify"

    @property
    def device_info(self) -> DeviceInfo:
        info = self.coordinator.data.get("device_info", {})
        return DeviceInfo(
            identifiers={(DOMAIN, self._entry_id)},
            name=info.get("name", "MHUB"),
            manufacturer="HDANYWHERE",
            model=info.get("model", "MHUB"),
            serial_number=info.get("serial_number"),
            sw_version=info.get("firmware"),
            hw_version=info.get("unit_id"),
            configuration_url=f"http://{info.get('ip_address', self.coordinator.api.host)}",
        )

    async def async_press(self) -> None:
        url = f"{self.coordinator.base_url}/identify/"
        await _simple_get(self.hass, url, "identify")


class MHUBRebootButton(CoordinatorEntity, ButtonEntity):
    _attr_name = "MHUB Reboot"
    _attr_icon = "mdi:restart"

    def __init__(self, coordinator, entry_id: str) -> None:
        super().__init__(coordinator)
        self._entry_id = entry_id
        self._attr_unique_id = f"{entry_id}_mhub_reboot"

    @property
    def device_info(self) -> DeviceInfo:
        info = self.coordinator.data.get("device_info", {})
        return DeviceInfo(
            identifiers={(DOMAIN, self._entry_id)},
            name=info.get("name", "MHUB"),
            manufacturer="HDANYWHERE",
            model=info.get("model", "MHUB"),
            serial_number=info.get("serial_number"),
            sw_version=info.get("firmware"),
            hw_version=info.get("unit_id"),
            configuration_url=f"http://{info.get('ip_address', self.coordinator.api.host)}",
        )

    async def async_press(self) -> None:
        url = f"{self.coordinator.base_url}/reboot/1/"
        await _simple_get(self.hass, url, "reboot")


class MHUBSequenceButton(CoordinatorEntity, ButtonEntity):
    def __init__(self, coordinator, entry_id: str, sid: str, kind: str, label: str) -> None:
        super().__init__(coordinator)
        self.coordinator = coordinator
        self._entry_id = entry_id
        self._sid = sid
        self._kind = kind
        self._attr_name = label
        self._attr_icon = "mdi:play-circle"
        self._attr_unique_id = f"{entry_id}_mhub_{kind}_{slugify(sid + '_' + label)}"

    @property
    def device_info(self) -> DeviceInfo:
        info = self.coordinator.data.get("device_info", {})
        return DeviceInfo(
            identifiers={(DOMAIN, self._entry_id)},
            name=info.get("name", "MHUB"),
            manufacturer="HDANYWHERE",
            model=info.get("model", "MHUB"),
            serial_number=info.get("serial_number"),
            sw_version=info.get("firmware"),
            hw_version=info.get("unit_id"),
            configuration_url=f"http://{info.get('ip_address', self.coordinator.api.host)}",
        )

    async def async_press(self) -> None:
        if self._kind == "function":
            url = f"{self.coordinator.base_url}/control/function/{self._sid}/true"
        else:
            url = f"{self.coordinator.base_url}/control/sequence/{self._sid}/true"
        await _simple_get(self.hass, url, f"{self._kind}:{self._sid}")
        await self.coordinator.async_request_refresh()


class MHUBSourceButton(CoordinatorEntity, ButtonEntity):
    _attr_has_entity_name = True
    _attr_entity_registry_enabled_default = True
    _attr_icon = "mdi:video-input-hdmi"

    def __init__(
        self,
        coordinator,
        entry_id: str,
        device_identifier,
        device_name: str,
        output_id: str,
        input_id: str,
        source_label: str,
    ) -> None:
        super().__init__(coordinator)
        self._output_id = str(output_id).lower()
        self._input_id = str(input_id)
        self._attr_name = source_label
        self._attr_unique_id = f"{entry_id}_source_button_{self._output_id}_{slugify(self._input_id + '_' + source_label)}"
        self._attr_device_info = DeviceInfo(
            identifiers={device_identifier},
            name=device_name,
            manufacturer="HDANYWHERE",
            model="MHUB Zone",
            # No via_device= -- see the note in media_player.py's device_info.
            # __init__.py already links this zone device to the hub via the
            # non-deprecated via_device_id parameter when it pre-registers it.
        )

    async def async_press(self) -> None:
        await self.coordinator.api.switch_output_input(self._output_id, self._input_id)
        await self.coordinator.async_request_refresh()


class MHUBIRButton(CoordinatorEntity, ButtonEntity):
    def __init__(
        self,
        coordinator,
        entry_id: str,
        device_identifier,
        device_name: str,
        port_id: int,
        command_id: int,
        command_label: str,
        model: str,
    ) -> None:
        super().__init__(coordinator)
        self._port_id = port_id
        self._command_id = command_id
        self._attr_name = command_label
        self._attr_unique_id = f"{entry_id}_ir_{device_identifier[1]}_{command_id}"
        self._attr_device_info = DeviceInfo(
            identifiers={device_identifier},
            name=device_name,
            manufacturer="HDANYWHERE",
            model=model,
        )

    async def async_press(self) -> None:
        await self.coordinator.api.send_ir(self._port_id, self._command_id)


class MHUBCECButton(CoordinatorEntity, ButtonEntity):
    def __init__(
        self,
        coordinator,
        entry_id: str,
        device_identifier,
        device_name: str,
        output_id: str,
        cec_type: int,
        command_id: int,
        command_label: str,
    ) -> None:
        super().__init__(coordinator)
        self._output_id = output_id
        self._cec_type = cec_type
        self._command_id = command_id
        self._attr_name = command_label
        self._attr_unique_id = f"{entry_id}_cec_{device_identifier[1]}_{command_id}"
        self._attr_device_info = DeviceInfo(
            identifiers={device_identifier},
            name=device_name,
            manufacturer="HDANYWHERE",
            model="MHUB CEC",
        )

    async def async_press(self) -> None:
        await self.coordinator.api.send_cec(self._output_id, self._cec_type, self._command_id)


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
