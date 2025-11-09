from datetime import timedelta
from homeassistant.helpers.update_coordinator import DataUpdateCoordinator, UpdateFailed
import aiohttp, async_timeout, logging, json
from .const import DOMAIN, DEFAULT_SCAN_INTERVAL

_LOGGER = logging.getLogger(__name__)

class MHUBDataUpdateCoordinator(DataUpdateCoordinator):
    """Manages polling data from the HDAnywhere MHUB device and auto-detects model capabilities."""

    def __init__(self, hass, entry):
        self.hass = hass
        self.host = entry.data["host"]
        super().__init__(
            hass,
            _LOGGER,
            name="MHUB Data Coordinator",
            update_interval=timedelta(seconds=DEFAULT_SCAN_INTERVAL),
        )
        self.data = {"info": {}, "state": {}}
        self.model_info = {
            "model": None,
            "api_version": None,
            "firmware": None,
            "supports_power": False,
            "supports_audio": False,
            "inputs": 0,
            "outputs": 0,
        }

    async def _async_update_data(self):
        base = f"http://{self.host}/api/data"
        headers = {"User-Agent": "curl/8.0", "Accept": "application/json"}

        async with aiohttp.ClientSession(headers=headers) as s:
            try:
                with async_timeout.timeout(10):
                    async with s.get(f"{base}/100/", allow_redirects=True) as r1:
                        raw1 = await r1.text()
                        info = await self._safe_json(r1, raw1)
                    async with s.get(f"{base}/200/", allow_redirects=True) as r2:
                        raw2 = await r2.text()
                        state = await self._safe_json(r2, raw2)
                if not info or not state:
                    raise UpdateFailed("Empty response from MHUB")
                # store
                self.data = {"info": info.get("data", {}), "state": state.get("data", {})}
                # run detection
                self._detect_model()
                _LOGGER.debug("MHUB data updated: model=%s", self.model_info.get("model"))
                return self.data
            except Exception as e:
                _LOGGER.error("MHUB update failed: %s", e)
                raise UpdateFailed(str(e))

    async def _safe_json(self, resp, raw):
        try:
            return await resp.json(content_type=None)
        except Exception:
            try:
                return json.loads(raw)
            except Exception as e:
                _LOGGER.error("JSON decode error: %s\nRaw: %s", e, raw[:400])
                return {}

    def _detect_model(self):
        try:
            mhub = self.data.get("info", {}).get("mhub", {})
            model = mhub.get("mhub_official_name") or mhub.get("mhub_name")
            api = mhub.get("api")
            fw = mhub.get("mhub-os_version") or mhub.get("mhub_firmware")
            self.model_info["model"] = model
            self.model_info["api_version"] = api
            self.model_info["firmware"] = fw
            # detect audio support
            io = self.data.get("info", {}).get("io_data", {})
            outputs = io.get("output_audio") or io.get("output_audio_mirror") or []
            inputs = io.get("input_audio") or io.get("input_audio_mirror") or []
            self.model_info["supports_audio"] = bool(outputs or inputs)
            # counts
            iv = io.get("input_video") or []
            ov = io.get("output_video") or []
            try:
                self.model_info["inputs"] = int(iv[0].get("ports")) if iv else 0
            except Exception:
                self.model_info["inputs"] = len(iv)
            try:
                self.model_info["outputs"] = int(ov[0].get("ports")) if ov else 0
            except Exception:
                self.model_info["outputs"] = len(ov)
            # detect power endpoint presence by probing a known endpoint (non-fatal)
            try:
                import requests
                url = f"http://{self.host}/api/control/power/a/1/"
                resp = requests.get(url, timeout=2)
                self.model_info["supports_power"] = (resp.status_code == 200)
            except Exception:
                # assume no power control (safe fallback)
                self.model_info["supports_power"] = False
        except Exception as e:
            _LOGGER.warning("Model detect error: %s", e)
            self.model_info = self.model_info

    def zones(self):
        return self.data.get("state", {}).get("zones", []) or []

    def output_labels(self):
        mapping = {}
        try:
            outs = self.data.get("info", {}).get("io_data", {}).get("output_video", [])
            for o in outs:
                for l in o.get("labels", []):
                    mapping[str(l.get("id"))] = l.get("label")
        except Exception as e:
            _LOGGER.warning("Output parse error: %s", e)
        return mapping
