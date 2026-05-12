from __future__ import annotations

from homeassistant.components.sensor import SensorEntity
from homeassistant.helpers.device_registry import DeviceInfo
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import slugify

from .const import DOMAIN


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data[DOMAIN][entry.entry_id]

    sensors: list[SensorEntity] = [
        MHUBStatusSensor(entry.entry_id, coordinator),
        MHUBInfoSensor(entry.entry_id, coordinator, "Model", "model"),
        MHUBInfoSensor(entry.entry_id, coordinator, "Firmware", "firmware"),
        MHUBInfoSensor(entry.entry_id, coordinator, "API Version", "api_version"),
        MHUBInfoSensor(entry.entry_id, coordinator, "Inputs", "inputs"),
        MHUBInfoSensor(entry.entry_id, coordinator, "Outputs", "outputs"),
    ]

    for output_id, output_label in coordinator.video_output_labels().items():
        sensors.append(MHUBOutputSourceSensor(entry.entry_id, coordinator, output_id, output_label))

    async_add_entities(sensors, True)


class MHUBInfoSensor(CoordinatorEntity, SensorEntity):
    _attr_entity_registry_enabled_default = True
    _attr_has_entity_name = True

    def __init__(self, entry_id: str, coordinator, name: str, key: str) -> None:
        super().__init__(coordinator)
        self.coordinator = coordinator
        self._entry_id = entry_id
        self._key = key
        self._attr_name = name
        self._attr_unique_id = f"{entry_id}_hub_info_{slugify(key)}"

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

    @property
    def native_value(self):
        value = self.coordinator.diagnostic_attrs().get(self._key)
        if value is None:
            return "unknown"
        return value


class MHUBStatusSensor(CoordinatorEntity, SensorEntity):
    _attr_entity_registry_enabled_default = True
    _attr_has_entity_name = True

    def __init__(self, entry_id: str, coordinator) -> None:
        super().__init__(coordinator)
        self.coordinator = coordinator
        self._entry_id = entry_id
        self._attr_name = "Status"
        self._attr_unique_id = f"{entry_id}_hub_status"

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

    @property
    def native_value(self):
        model = self.coordinator.diagnostic_attrs().get("model")
        return model or "online"

    @property
    def extra_state_attributes(self):
        attrs = self.coordinator.diagnostic_attrs().copy()
        info = self.coordinator.data.get("device_info", {})
        attrs.update(
            {
                "name": info.get("name"),
                "serial_number": info.get("serial_number"),
                "unit_id": info.get("unit_id"),
                "ip_address": info.get("ip_address"),
            }
        )
        return attrs


class MHUBOutputSourceSensor(CoordinatorEntity, SensorEntity):
    _attr_entity_registry_enabled_default = True
    _attr_has_entity_name = True
    _attr_icon = "mdi:video-input-hdmi"

    def __init__(self, entry_id: str, coordinator, output_id: str, output_label: str) -> None:
        super().__init__(coordinator)
        self.coordinator = coordinator
        self._entry_id = entry_id
        self._output_id = str(output_id).lower()
        self._output_label = output_label
        self._zone_id, self._zone_label = self._resolve_zone_for_output()
        # _attr_name (entity-name suffix) is provided live via the `name` property below.
        self._attr_unique_id = f"{entry_id}_output_source_{slugify(self._output_id)}"

    def _resolve_zone_for_output(self) -> tuple[str | None, str | None]:
        for zone in self.coordinator.zones_config():
            zone_id = zone.get("zone_id")
            zone_label = zone.get("zone_label", zone_id)
            for output in zone.get("outputs", []) or []:
                current_output_id = str(output.get("output_id", "")).lower()
                if current_output_id == self._output_id:
                    return (str(zone_id), str(zone_label) if zone_label is not None else None)
        return (None, None)

    def _current_zone_label(self) -> str | None:
        """Re-resolve the zone label every time so renames flow through immediately."""
        _zone_id, zone_label = self._resolve_zone_for_output()
        if _zone_id:
            self._zone_id = _zone_id
        if zone_label:
            self._zone_label = zone_label
        return zone_label

    @property
    def name(self) -> str:
        # With _attr_has_entity_name = True this is the suffix appended to the device name.
        # Use the live zone label so it tracks renames; fall back to the raw output label.
        label = self._current_zone_label() or self._output_label
        return f"{label} Source"

    @property
    def device_info(self) -> DeviceInfo:
        info = self.coordinator.data.get("device_info", {})
        zone_id = self._zone_id or f"output_{self._output_id}"
        zone_name = self._current_zone_label() or self._output_label
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

    def _find_state_for_output(self):
        for zone in self.coordinator.zones():
            for state in zone.get("state", []) or []:
                if str(state.get("output_id", "")).lower() == self._output_id:
                    return state
        return None

    @property
    def native_value(self):
        state = self._find_state_for_output()
        if not state:
            return "unknown"

        input_id = state.get("input_id")
        if input_id is None:
            return "unknown"

        input_id_str = str(input_id)
        return self.coordinator.video_input_labels().get(input_id_str, f"Input {input_id_str}")

    @property
    def extra_state_attributes(self):
        state = self._find_state_for_output() or {}
        input_id = state.get("input_id")
        attrs = {
            "output": self._output_id.upper(),
            "output_label": self._output_label,
            "zone_id": self._zone_id,
            "zone_label": self._zone_label,
        }
        if input_id is not None:
            attrs["input_id"] = str(input_id)
        return attrs
