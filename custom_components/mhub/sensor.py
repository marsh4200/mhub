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
