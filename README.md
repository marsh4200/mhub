# 🟣 HDAnywhere MHUB — Home Assistant Integration
### Version: `0.0.1`

[![Add to HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=marsh4200&repository=mhub&category=integration)


HDAnywhere MHUB (Local)
Version: 3.0.0

Author: @marsh4200

In collaboration with: SMARTHOME 21

A lightweight, plug-and-play Home Assistant
 custom integration for controlling your HDAnywhere MHUB matrix system over the local LAN API.

Easily manage your MHUB — turn it ON/OFF, route HDMI inputs to outputs, control per-zone volume, and mute any output — all directly from your Home Assistant dashboard.
No cloud. No lag. Pure local control. ⚡

✨ Features

✅ Automatic MHUB Model Detection
– Works with MHUB S, PRO 2.0, MAX, and AUDIO models
– Automatically maps available inputs, outputs, and audio channels

🎬 Per-Output Video Routing
– Each HDMI output (A–H) appears as its own media player
– Switch between labeled inputs like Explora 1, PS5, or Apple TV

🔊 Volume & Mute Control (if supported)
– Control per-zone volume (0–100)
– Toggle mute directly from the UI

🔌 Power Control
– Two dedicated switches:

switch.mhub_power_on → /api/power/1/

switch.mhub_power_off → /api/power/0/

📡 Local-Only Operation
– All communication uses MHUB’s native REST API via HTTP
– No internet access or cloud dependency

🧠 Auto-Refresh State
– Detects and updates changes in routes, volume, or power every few seconds

🧩 Installation

Simply click the above HACS buttons to install this integration directly into your Home Assistant.

Once installed, restart Home Assistant and add the integration from:
Settings → Devices & Services → Add Integration → HDAnywhere MHUB (Local)

⚙️ Configuration

Enter your MHUB details:

Field	Description
IP Address	Local IP of your MHUB (e.g., 192.168.88.186)
Port	Usually 80
Name	Optional custom name for your device

Click Submit — the integration will automatically detect your model and create all relevant entities.

🧠 Example Entities Created
Entity ID	Type	Description
media_player.video_output_a	Media Player	HDMI Output A (acts like a TV)
media_player.video_output_b	Media Player	HDMI Output B
number.video_output_a_volume	Number	Volume (0–100)
switch.video_output_a_mute	Switch	Mute toggle for zone A
switch.mhub_power_on	Switch	Turn MHUB On
switch.mhub_power_off	Switch	Turn MHUB Off
🧩 Auto-Detected Example

If you have an MHUB S (8+8×8) 100, entities automatically appear like:

media_player.video_output_a
media_player.video_output_b
...
media_player.video_output_h
number.video_output_a_volume
switch.mhub_power_on
switch.mhub_power_off


If you plug in a 4×4 MHUB, the integration automatically adjusts:

media_player.video_output_a
media_player.video_output_b
media_player.video_output_c
media_player.video_output_d


No manual config. It just works. 🧩

🧠 Power Commands
Function	Endpoint	Entity
Power ON	/api/power/1/	switch.mhub_power_on
Power OFF	/api/power/0/	switch.mhub_power_off

All commands use local REST calls over HTTP.

🚀 Example Lovelace Dashboard
type: entities
title: HDAnywhere MHUB
entities:
  - entity: switch.mhub_power_on
    name: Power On
  - entity: switch.mhub_power_off
    name: Power Off
  - entity: media_player.video_output_a
  - entity: media_player.video_output_b
  - entity: number.video_output_a_volume
  - entity: switch.video_output_a_mute

🧰 Requirements

MHUB firmware 8.20+

API version 2.1+

Home Assistant 2024.6 or later

🧑‍💻 Developer Notes

Built using MHUB’s official REST API (/api/data/100, /api/control/switch, /api/power)

Tested on:

MHUB S (8+8×8) 100

MHUB PRO 2.0 (4×4)

Local async communication using aiohttp

No cloud dependencies

❤️ Credits

Developed by @marsh4200

in collaboration with SMARTHOME 21

Special thanks to the HDAnywhere engineering team for keeping the API consistent and developer-friendly.
