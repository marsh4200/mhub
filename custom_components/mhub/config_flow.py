from __future__ import annotations

import logging
from typing import Any

from homeassistant import config_entries
import voluptuous as vol
import aiohttp
import async_timeout

from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)


class MHUBConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    """Handle MHUB config flow."""

    VERSION = 1
    CONNECTION_CLASS = config_entries.CONN_CLASS_LOCAL_POLL

    async def async_step_user(self, user_input: dict[str, Any] | None = None):
        errors: dict[str, str] = {}

        if user_input is not None:
            host = user_input.get("host", "").strip()
            url = f"http://{host}/api/data/100/"
            headers = {"User-Agent": "HomeAssistant-MHUB", "Accept": "application/json"}

            try:
                async with aiohttp.ClientSession(headers=headers) as session:
                    async with async_timeout.timeout(8):
                        async with session.get(url, allow_redirects=True) as resp:
                            if resp.status != 200:
                                raise RuntimeError(f"HTTP {resp.status}")
                            data = await resp.json(content_type=None)

                header = data.get("header") or {}
                version = header.get("version")
                if not version:
                    raise RuntimeError("Missing header.version")

                mhub_data = data.get("data", {}).get("mhub", {})
                title = mhub_data.get("mhub_official_name") or mhub_data.get("mhub_name") or host

                # Prevent duplicate entries for same host
                await self.async_set_unique_id(f"mhub_{host}")
                self._abort_if_unique_id_configured()

                return self.async_create_entry(title=title, data={"host": host})

            except Exception as exc:
                _LOGGER.debug("Config flow connect failed: %s", exc)
                errors["base"] = "cannot_connect"

        data_schema = vol.Schema({vol.Required("host"): str})

        return self.async_show_form(
            step_id="user",
            data_schema=data_schema,
            errors=errors,
        )
