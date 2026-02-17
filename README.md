# 🟣 HDAnywhere MHUB — Home Assistant Integration


[![Add to HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=marsh4200&repository=mhub&category=integration)

---

**Author:** [@marsh4200](https://github.com/marsh4200)  
**In collaboration with:** [SMARTHOME 21](https://smarthome21.co.za)

---

A **lightweight, plug-and-play Home Assistant custom integration** for controlling your  
**HDAnywhere MHUB matrix system** over the **local LAN API**.

Manage your MHUB like never before — turn it **ON/OFF**, **route HDMI inputs to outputs**, control **per-zone volume**, and toggle **mute** — all from your Home Assistant dashboard.  
⚡ No cloud. No lag. Pure local control.

---

## ✨ Features

✅ **Automatic MHUB Model Detection**  
• Works with **MHUB S**, **PRO 2.0**, **MAX**, and **AUDIO** models  
• Automatically maps available inputs, outputs, and audio channels  

🎬 **Per-Output Video Routing**  
• Each HDMI output (A–H) appears as its own **media player**  
• Switch between labeled inputs like *Explora 1*, *PS5*, or *Apple TV*  

🔊 **Volume & Mute Control** *(if supported)*  
• Adjust per-zone volume (0–100)  
• Mute or unmute directly from the UI  

🔌 **Power Control**  
• Two dedicated switches for system power:  
  - `switch.mhub_power_on` → `/api/power/1/`  
  - `switch.mhub_power_off` → `/api/power/0/`  

📡 **Local-Only Operation**  
• 100% local — all communication uses MHUB’s REST API  
• No cloud access required  

🧠 **Auto-Refresh State**  
• Continuously updates routing, power, and audio states every few seconds  

---

## 🧩 Installation

Simply **click the HACS button above** to install this integration directly into Home Assistant.  

After installation, **restart Home Assistant** and go to:  
**Settings → Devices & Services → Add Integration → HDAnywhere MHUB (Local)**

---

## ⚙️ Configuration

**Enter your MHUB details:**

| Field | Description |
|-------|--------------|
| **IP Address** | Local IP of your MHUB (e.g., `192.168.88.186`) |
| **Port** | Usually `80` |
| **Name** | Optional custom name |

Click **Submit** — the integration will automatically detect your model and create all relevant entities.

---

## 🧠 Example Entities Created

| Entity ID | Type | Description |
|------------|------|-------------|
| `media_player.video_output_a` | Media Player | HDMI Output A (acts like a TV) |
| `media_player.video_output_b` | Media Player | HDMI Output B |
| `number.video_output_a_volume` | Number | Zone A volume control |
| `switch.video_output_a_mute` | Switch | Mute toggle for zone A |
| `switch.mhub_power_on` | Switch | Power ON trigger |
| `switch.mhub_power_off` | Switch | Power OFF trigger |

---

## 🧩 Auto-Detection Example

If your MHUB is an **MHUB S (8+8×8) 100**, the integration auto-creates:

media_player.video_output_a
media_player.video_output_b
...
media_player.video_output_h
number.video_output_a_volume
switch.mhub_power_on
switch.mhub_power_off

If you plug in a **4×4 MHUB**, it automatically adjusts:

media_player.video_output_a
media_player.video_output_b
media_player.video_output_c
media_player.video_output_d



## No manual configuration — it just works. 🧠

---

## ⚡ Power Commands

| Function | Endpoint | Entity |
|-----------|-----------|--------|
| Power ON | `/api/power/1/` | `switch.mhub_power_on` |
| Power OFF | `/api/power/0/` | `switch.mhub_power_off` |

All communication happens locally using MHUB’s REST API.

---

## 🚀 Example Lovelace Dashboard

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
---


## 🧰 Requirements

MHUB firmware 8.20+

API version 2.1+

Home Assistant 2024.6+

## 🧑‍💻 Developer Notes

Built using MHUB’s official REST API:
/api/data/100, /api/control/switch, /api/power

Tested on:

MHUB S (8+8×8) 100

MHUB PRO 2.0 (4×4)

Local async communication using aiohttp

Zero cloud dependencies

## ❤️ Credits


## Special thanks to the HDAnywhere engineering team for keeping their API consistent and developer-friendly.

## 💜 "No cloud. No lag. Just control."
## — HDAnywhere MHUB for Home Assistant
