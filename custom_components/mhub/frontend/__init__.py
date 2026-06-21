"""Frontend (Lovelace card) registration for the MHUB integration.

The MHUB card ships inside this integration. On setup we serve the bundled
``frontend/`` folder over HTTP immediately, then — once Home Assistant has
fully started and the Lovelace resource store is guaranteed to be loaded —
register the card as a dashboard resource (storage-mode dashboards only).

Deferring the resource step to ``async_at_start`` avoids the startup race
where the resource collection isn't ready yet at config-entry setup time.

YAML-mode dashboards: the file is still served at ``/mhub/mhub-card.js`` —
add it once under Settings -> Dashboards -> Resources (type: JavaScript Module).
"""
from __future__ import annotations

import logging
import os

from homeassistant.core import HomeAssistant
from homeassistant.helpers.start import async_at_start

from ..const import JSMODULES, URL_BASE

_LOGGER = logging.getLogger(__name__)


class JSModuleRegistration:
    """Serve and register the bundled Lovelace card module(s)."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass

    async def async_register(self) -> None:
        """Serve the card now; register the resource once HA has started."""
        await self._async_register_static_path()
        # Runs immediately if HA is already running, otherwise at startup
        # completion — when the Lovelace resource store is loaded.
        async_at_start(self.hass, self._async_register_modules_cb)

    # ── lovelace helpers ────────────────────────────────────────────────
    @property
    def _lovelace(self):
        return self.hass.data.get("lovelace")

    def _lovelace_mode(self) -> str:
        lovelace = self._lovelace
        if lovelace is None:
            return "yaml"
        mode = getattr(lovelace, "mode", None)
        if mode is None and isinstance(lovelace, dict):
            mode = lovelace.get("mode")
        return mode or "yaml"

    def _resources(self):
        lovelace = self._lovelace
        if lovelace is None:
            return None
        resources = getattr(lovelace, "resources", None)
        if resources is None and isinstance(lovelace, dict):
            resources = lovelace.get("resources")
        return resources

    # ── static path ─────────────────────────────────────────────────────
    async def _async_register_static_path(self) -> None:
        """Expose ./frontend/ at URL_BASE using the non-blocking API."""
        frontend_dir = os.path.dirname(__file__)
        try:
            from homeassistant.components.http import StaticPathConfig

            await self.hass.http.async_register_static_paths(
                [StaticPathConfig(URL_BASE, frontend_dir, cache_headers=True)]
            )
        except RuntimeError:
            # Already registered (e.g. a second config entry) — fine.
            pass
        except ImportError:
            # Older cores without StaticPathConfig.
            self.hass.http.register_static_path(URL_BASE, frontend_dir, True)
        except Exception:  # noqa: BLE001 - never block setup over the card
            _LOGGER.warning(
                "MHUB: could not serve the bundled card folder", exc_info=True
            )

    # ── resource registration (after HA start) ──────────────────────────
    async def _async_register_modules_cb(self, _hass: HomeAssistant) -> None:
        await self._async_register_modules()

    async def _async_register_modules(self) -> None:
        mode = self._lovelace_mode()
        if mode != "storage":
            _LOGGER.info(
                "MHUB: Lovelace is in '%s' mode; card is served at %s/%s but "
                "must be added once under Settings -> Dashboards -> Resources "
                "(type: JavaScript Module).",
                mode,
                URL_BASE,
                JSMODULES[0]["filename"],
            )
            return

        resources = self._resources()
        if resources is None:
            _LOGGER.debug("MHUB: Lovelace resource store unavailable")
            return

        try:
            if not getattr(resources, "loaded", True):
                await resources.async_load()
                resources.loaded = True
        except Exception:  # noqa: BLE001
            _LOGGER.debug("MHUB: could not load Lovelace resources", exc_info=True)
            return

        for module in JSMODULES:
            url = f"{URL_BASE}/{module['filename']}"
            versioned = f"{url}?v={module['version']}"
            try:
                items = list(resources.async_items())
            except Exception:  # noqa: BLE001
                _LOGGER.debug("MHUB: could not list Lovelace resources", exc_info=True)
                return

            existing = [
                item
                for item in items
                if str(item.get("url", "")).split("?")[0] == url
            ]
            try:
                if not existing:
                    await resources.async_create_item(
                        {"res_type": "module", "url": versioned}
                    )
                    _LOGGER.info(
                        "MHUB: registered Lovelace card resource %s", versioned
                    )
                else:
                    for item in existing:
                        if item.get("url") != versioned:
                            await resources.async_update_item(
                                item["id"],
                                {"res_type": "module", "url": versioned},
                            )
                            _LOGGER.info(
                                "MHUB: updated card resource to %s", versioned
                            )
            except Exception:  # noqa: BLE001
                _LOGGER.warning(
                    "MHUB: failed to register card resource %s", url, exc_info=True
                )
