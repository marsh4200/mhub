from __future__ import annotations

import asyncio
import json
import logging
from typing import Any

import aiohttp

from homeassistant.exceptions import HomeAssistantError

_LOGGER = logging.getLogger(__name__)

# Every single request gets its own deadline. Without one, aiohttp waits up to
# five minutes on a hub that accepted the connection but never answers (which
# is exactly what a booting MHUB / booting network switch looks like).
REQUEST_TIMEOUT = 8
_TIMEOUT = aiohttp.ClientTimeout(total=REQUEST_TIMEOUT)
_HEADERS = {"User-Agent": "HomeAssistant-MHUB", "Accept": "application/json"}
_RETRY_PAUSE = 0.4


class MhubApiError(HomeAssistantError):
    """The MHUB could not be reached or answered with a server error."""


class MhubApi:
    """Thin MHUB API wrapper used by the coordinator and button/service logic."""

    def __init__(self, host: str, session) -> None:
        self._host = host
        self._session = session
        self._api_version: str | None = None

    @property
    def host(self) -> str:
        return self._host

    @property
    def api_version(self) -> str | None:
        return self._api_version

    async def _request(
        self,
        method: str,
        url: str,
        payload: dict[str, Any] | None = None,
        attempts: int = 2,
    ) -> tuple[int, str]:
        """Send one request with a deadline; return (HTTP status, body text).

        A connection that could not be opened, or a kept-alive socket the hub
        dropped while it rebooted, is retried once on a fresh connection.
        Timeouts are not retried here (the request may already have reached
        the hub, and the 5 second poll is its own retry).
        """
        last_exc: Exception | None = None
        for attempt in range(attempts):
            if attempt:
                await asyncio.sleep(_RETRY_PAUSE)
            kwargs: dict[str, Any] = {
                "headers": _HEADERS,
                "allow_redirects": True,
                "timeout": _TIMEOUT,
            }
            if payload is not None:
                kwargs["json"] = payload
            try:
                async with self._session.request(method, url, **kwargs) as resp:
                    return resp.status, await resp.text(errors="replace")
            except TimeoutError as exc:
                raise MhubApiError(
                    f"no answer from {self._host} within {REQUEST_TIMEOUT}s"
                ) from exc
            except aiohttp.ClientConnectionError as exc:
                last_exc = exc
            except (aiohttp.ClientError, OSError) as exc:
                raise MhubApiError(f"{type(exc).__name__}: {exc}") from exc

        raise MhubApiError(
            f"cannot connect to {self._host}: {last_exc or 'connection failed'}"
        ) from last_exc

    async def _get(self, path: str) -> Any:
        status, text = await self._request("GET", f"http://{self._host}{path}")
        if status >= 500:
            raise MhubApiError(f"HTTP {status} from {self._host} for {path}")
        try:
            return json.loads(text)
        except ValueError as exc:
            _LOGGER.debug("Non-JSON MHUB response for %s: %s", path, text[:200])
            _LOGGER.debug("JSON parse error: %s", exc)
            return text

    async def _post(self, path: str, payload: dict[str, Any]) -> Any:
        status, text = await self._request("POST", f"http://{self._host}{path}", payload)
        if status >= 500:
            raise MhubApiError(f"HTTP {status} from {self._host} for {path}")
        try:
            return json.loads(text)
        except ValueError as exc:
            _LOGGER.debug("Non-JSON MHUB POST response for %s: %s", path, text[:200])
            _LOGGER.debug("JSON parse error: %s", exc)
            return None

    async def command(self, url: str, name: str) -> bool:
        """Fire a control URL. Never raises; returns True when the hub said OK."""
        try:
            status, text = await self._request("GET", url)
        except MhubApiError as exc:
            _LOGGER.error("MHUB %s request failed: %s", name, exc)
            return False

        if status == 200:
            _LOGGER.info("MHUB %s OK", name)
            return True

        _LOGGER.warning("MHUB %s failed HTTP %s: %s", name, status, text[:200])
        return False

    async def get_system_info(self) -> dict[str, Any]:
        response = await self._get("/api/data/100/")
        if isinstance(response, dict):
            data = response.get("data") or {}
            if isinstance(data, dict):
                mhub_data = data.get("os") or data.get("mhub") or {}
                if isinstance(mhub_data, dict):
                    self._api_version = mhub_data.get("api")
        return response or {}

    async def get_zones(self) -> dict[str, Any]:
        return await self._get("/api/data/102/") or {}

    async def get_groups(self) -> dict[str, Any]:
        return await self._get("/api/data/103/") or {}

    async def get_sequences(self) -> dict[str, Any]:
        return await self._get("/api/data/202/") or {}

    async def get_power(self) -> dict[str, Any]:
        return await self._get("/api/data/0/") or {}

    async def get_state(self, stacked: bool = False) -> dict[str, Any]:
        return await self._get("/api/data/203/" if stacked else "/api/data/200/") or {}

    async def get_cec_commands(self) -> dict[str, Any]:
        return await self._get("/api/data/204/") or {}

    async def get_ir_packs(self, stacked: bool = False) -> dict[str, Any]:
        return await self._get("/api/data/205/" if stacked else "/api/data/201/") or {}

    async def get_ir_pack_details(self, port_id: int, stacked: bool = False) -> dict[str, Any]:
        path = f"/api/data/205/{port_id}/" if stacked else f"/api/data/201/{port_id}/"
        return await self._get(path) or {}

    async def switch_output_input(self, output_id: str, input_id: str | int) -> Any:
        return await self._get(f"/api/control/switch/{output_id}/{input_id}/")

    async def set_output_volume(self, output_id: str, volume: int) -> Any:
        return await self._get(f"/api/control/volume/{output_id}/{volume}/")

    async def set_output_mute(self, output_id: str, mute: bool) -> Any:
        return await self._get(f"/api/control/mute/{output_id}/{'true' if mute else 'false'}/")

    async def send_ir(self, port_id: int, command_id: int | str) -> Any:
        return await self._get(f"/api/command/ir/{port_id}/{command_id}/")

    async def send_pronto_ir(self, port_id: int, pronto_code: str) -> Any:
        return await self._post(f"/api/command/irpass/{port_id}/", {"irdata": pronto_code})

    async def send_cec(self, output_id: str, cec_type: int, command_id: int | str) -> Any:
        return await self._post(f"/api/command/cec/{output_id}/{cec_type}/{command_id}/", {})
