from __future__ import annotations

DOMAIN = "mhub"

# Poll MHUB every 5 seconds - adjust if you want less chatter
DEFAULT_SCAN_INTERVAL = 5

CONTROL_METHOD_IR = "ir"
CONTROL_METHOD_CEC = "cec"
CONTROL_METHOD_NONE = "none"

SERVICE_SEND_PRONTO_IR = "send_pronto_ir"

# Keep in sync with manifest.json "version" — used to cache-bust the bundled
# Lovelace card resource URL whenever the integration is updated.
INTEGRATION_VERSION = "0.1.4"

# Base HTTP path the bundled frontend folder is served from.
URL_BASE = "/mhub"

# Lovelace cards shipped inside this integration (served from ./frontend/).
JSMODULES = [
    {
        "name": "MHUB Card",
        "filename": "mhub-card.js",
        "version": INTEGRATION_VERSION,
    }
]
