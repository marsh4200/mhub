"""Frontend (Lovelace card) registration for the MHUB integration.

The MHUB card ships inside this integration. When the integration is set up
we serve the bundled ``frontend/`` folder over HTTP and — when Lovelace runs
in storage mode (the default) — automatically add the card as a dashboard
resource. The result: installing the integration via HACS also delivers the
card, with no separate HACS plugin and no manual "Add Resource" step.

If Lovelace is in YAML mode the static path is still served, so the user can
add the resource manually:  url: /mhub/mhub-card.js   type: module
"""
from __future__ import annotations

import logging
import os

from homeassistant.core import HomeAssistant

from ..const import JSMODULES, URL_BASE

_LOGGER = logging.getLogger(__name__)


class JSModuleRegistration:
    """Serve and register the bundled Lovelace card module(s)."""

    def __init__(self, hass: HomeAssistant) -> None:
        self.hass = hass
        self.lovelace = hass.data.get("lovelace")

    async def async_register(self) -> None:
        """Serve the frontend folder and register the card resource."""
        await self._async_register_static_path()
        if self._lovelace_mode() == "storage":
            await self._async_register_modules()
        else:
            _LOGGER.debug(
                "MHUB: Lovelace not in storage mode; card served at %s but must "
                "be added as a resource manually",
                URL_BASE,
            )

    # ── helpers ──────────────────────────────────────────────────────────
    def _lovelace_mode(self) -> str:
        lovelace = self.lovelace
        if lovelace is None:
            return "yaml"
        mode = getattr(lovelace, "mode", None)
        if mode is None and isinstance(lovelace, dict):
            mode = lovelace.get("mode")
        return mode or "yaml"

    def _resources(self):
        lovelace = self.lovelace
        if lovelace is None:
            return None
        resources = getattr(lovelace, "resources", None)
        if resources is None and isinstance(lovelace, dict):
            resources = lovelace.get("resources")
        return resources

    async def _async_register_static_path(self) -> None:
        """Expose ./frontend/ at URL_BASE using the non-blocking API."""
        frontend_dir = os.path.dirname(__file__)
        try:
            from homeassistant.components.http import StaticPathConfig

            await self.hass.http.async_register_static_paths(
                [StaticPathConfig(URL_BASE, frontend_dir, cache_headers=True)]
            )
        except RuntimeError:
            # Already registered (e.g. a second config entry) — that's fine.
            pass
        except ImportError:
            # Older cores without StaticPathConfig: fall back to the legacy API.
            self.hass.http.register_static_path(URL_BASE, frontend_dir, True)
        except Exception:  # noqa: BLE001 - never block setup over the card
            _LOGGER.warning(
                "MHUB: could not serve the bundled card folder", exc_info=True
            )

    async def _async_register_modules(self) -> None:
        """Add (or version-bump) the card in the Lovelace resource store."""
        resources = self._resources()
        if resources is None:
            return

        try:
            if not getattr(resources, "loaded", True):
                await resources.async_load()
                resources.loaded = True
        except Exception:  # noqa: BLE001
            _LOGGER.debug("MHUB: Lovelace resources not ready", exc_info=True)
            return

        for module in JSMODULES:
            url = f"{URL_BASE}/{module['filename']}"
            versioned = f"{url}?v={module['version']}"
            try:
                existing = [
                    item
                    for item in resources.async_items()
                    if str(item.get("url", "")).split("?")[0] == url
                ]
                if not existing:
                    await resources.async_create_item(
                        {"res_type": "module", "url": versioned}
                    )
                    _LOGGER.info("MHUB: registered Lovelace resource %s", versioned)
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
