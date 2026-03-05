
from __future__ import annotations

from homeassistant.components.sensor import SensorEntity, SensorDeviceClass
from homeassistant.helpers.update_coordinator import CoordinatorEntity
from homeassistant.util import slugify

from .const import DOMAIN


async def async_setup_entry(hass, entry, async_add_entities):
    coordinator = hass.data[DOMAIN][entry.entry_id]

    sensors: list[SensorEntity] = [
        MHUBInfoSensor(coordinator, "Model", "model"),
        MHUBInfoSensor(coordinator, "Firmware", "firmware"),
        MHUBInfoSensor(coordinator, "API Version", "api_version"),
        MHUBInfoSensor(coordinator, "Inputs", "inputs", device_class=SensorDeviceClass.ENUM),
        MHUBInfoSensor(coordinator, "Outputs", "outputs", device_class=SensorDeviceClass.ENUM),
    ]

    async_add_entities(sensors, True)


class MHUBInfoSensor(CoordinatorEntity, SensorEntity):
    def __init__(self, coordinator, name: str, key: str, device_class=None) -> None:
        super().__init__(coordinator)
        self.coordinator = coordinator
        self._key = key
        self._attr_name = f"MHUB {name}"
        self._attr_unique_id = f"mhub_info_{slugify(key)}"
        if device_class is not None:
            self._attr_device_class = device_class

    @property
    def native_value(self):
        return self.coordinator.diagnostic_attrs().get(self._key)
