from homeassistant import config_entries
import voluptuous as vol
import aiohttp
import async_timeout
import logging
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

class MHUBConfigFlow(config_entries.ConfigFlow, domain=DOMAIN):
    VERSION = 1
    CONNECTION_CLASS = config_entries.CONN_CLASS_LOCAL_POLL

    async def async_step_user(self, user_input=None):
        errors = {}
        if user_input is not None:
            host = user_input.get("host", "").strip()
            url = f"http://{host}/api/data/100/"
            headers = {"User-Agent": "curl/8.0", "Accept": "application/json"}
            try:
                async with aiohttp.ClientSession(headers=headers) as session:
                    with async_timeout.timeout(8):
                        async with session.get(url, allow_redirects=True) as resp:
                            if resp.status != 200:
                                raise Exception(f"HTTP {resp.status}")
                            data = await resp.json(content_type=None)
                            if "header" in data and "version" in data["header"]:
                                title = data.get("data", {}).get("mhub", {}).get("mhub_official_name", host)
                                return self.async_create_entry(title=title, data={"host": host})
                            raise Exception("Invalid JSON")
            except Exception as e:
                _LOGGER.debug("Config flow connect failed: %s", e)
                errors["base"] = "cannot_connect"

        data_schema = vol.Schema({vol.Required("host"): str})
        return self.async_show_form(step_id="user", data_schema=data_schema, errors=errors)
