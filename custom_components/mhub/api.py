from __future__ import annotations

import logging
from typing import Any

_LOGGER = logging.getLogger(__name__)


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

    async def _get(self, path: str) -> Any:
        url = f"http://{self._host}{path}"
        async with self._session.get(url, allow_redirects=True) as resp:
            try:
                return await resp.json(content_type=None)
            except Exception as exc:
                text = await resp.text()
                _LOGGER.debug("Non-JSON MHUB response for %s: %s", path, text[:200])
                _LOGGER.debug("JSON parse error: %s", exc)
                return text

    async def _post(self, path: str, payload: dict[str, Any]) -> Any:
        url = f"http://{self._host}{path}"
        async with self._session.post(url, json=payload, allow_redirects=True) as resp:
            try:
                return await resp.json(content_type=None)
            except Exception as exc:
                text = await resp.text()
                _LOGGER.debug("Non-JSON MHUB POST response for %s: %s", path, text[:200])
                _LOGGER.debug("JSON parse error: %s", exc)
                return None

    async def get_system_info(self) -> dict[str, Any]:
        response = await self._get("/api/data/100/")
        if isinstance(response, dict):
            data = response.get("data", {})
            mhub_data = data.get("os") or data.get("mhub", {})
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
