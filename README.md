# 🟣 HDAnywhere MHUB — Home Assistant Integration
[![GitHub release](https://img.shields.io/github/v/release/marsh4200/mhub.svg)](https://github.com/marsh4200/mhub/releases)
[![HACS Default](https://img.shields.io/badge/HACS-Default-41BDF5.svg)](https://www.hacs.xyz/)
[![GitHub Repo stars](https://img.shields.io/github/stars/marsh4200/mhub)](https://github.com/marsh4200/mhub/stargazers)

[![Add to HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=marsh4200&repository=mhub&category=integration)



👨‍💻 **Author:** @marsh4200  


A lightweight, plug-and-play Home Assistant integration for controlling your  
HDAnywhere MHUB matrix system over the local LAN API.

⚡ No cloud. No lag. Just control.

---
THIS INTEGRATION WAS ONLY POSSIBLE THANKS TO **In collaboration with:** [SMARTHOME 21](https://smarthome21.co.za)
---

## ✨ Features

### 🎛️ Button-Based Control (Default)

Control your MHUB using direct press buttons:

• Each output has buttons for available sources (DSTV, Apple TV, Kodi, etc.)  
• Press instantly routes that source to the selected output  
• Fast, simple, and dashboard-friendly  

---

### 📺 Media Player (Optional)

Media player entities are also available:

• Disabled by default  
• Can be enabled if preferred  
• Useful for compatibility with existing automations  

---

### 📊 Live Output Status

• One sensor per output  
• Displays the current routed source  
• Updates in real-time  

**Example:**

Output F → Kodi  
Output A → Apple TV  

---

### 📺 IR & CEC Control

Per output control support:

• IR control (via uControl / IR routing)  
• HDMI-CEC control (TV power, volume, etc.)  

👉 Configurable per zone  

---

### 🔊 Audio Control

• Per-zone volume (0–100)  
• Mute / unmute per output  

---

### 🔌 Power Control

• System ON / OFF control  
• Fast local execution  

---

### 📡 100% Local

• Uses MHUB REST API  
• No cloud dependencies  
• Instant response  

---

### 🧠 Smart Auto-Detection

• Detects MHUB model automatically  
• Maps inputs and outputs dynamically  
• Creates entities based on your system size  

---

## ⚙️ What it does

• Auto-detects MHUB model, inputs, and outputs  
• Creates clean entities for each zone  
• Source routing per output  
• Volume + mute control  
• IR and CEC support per zone  
• Proper device grouping inside Home Assistant  
• 100% local control (no cloud)  

---

## 🧩 Installation

Click the HACS button above to install.

Then go to:

Settings → Devices & Services → Add Integration → HDAnywhere MHUB (Local)

---

## ⚙️ Configuration

| Field | Description |
|------|------------|
| IP Address | MHUB local IP (e.g. 192.168.88.186) |
| Port | Usually 80 |
| Name | Optional |

👉 Click Submit — everything is auto-configured.

---

## 🧠 Notes

• No YAML required  
• Everything is handled via Config Flow (UI setup)  
• Works fully locally on your network  

---


## 🧑‍💻 Development

This integration is actively being developed and improved:

• UI simplification  
• Faster response times  
• Expanded control features (IR / CEC / automation support)  

---

## 🃏 Companion Lovelace Card (Included)

This integration **ships with the MHUB Card** — a fully self-configuring
Lovelace card. It is bundled inside the integration, so there is **nothing
extra to install from HACS**.

![MHUB Card](images/Card.png)
![MHUB Card Overview](images/Card2.png)
![MHUB Card Overview](images/Card5.png)

### How it loads

When you install this integration and add a hub, the card is **served and
registered automatically** — no `/config/www` copy, no manual *Add Resource*
step (storage-mode dashboards). Then just:

**Edit Dashboard → Add Card → Custom: MHUB Card**

The card reads your MHUB entities straight from the registry and builds
itself — zero YAML required.

### What it does

• 🎛️ One-tap source → output switching  
• 🔊 Per-zone & group volume sliders with mute  
• 🖼️ Custom per-input icons, hide unused inputs  
• ▶️ Run MHUB sequences & functions  
• 🏷️ Friendly output aliases (e.g. *Output B → Main Bedroom*)  
• ⚡ Optimistic UI — switches update instantly  

### Manual resource (YAML-mode dashboards only)

If your dashboards run in YAML mode, the card file is still served — add the
resource yourself:

```yaml
url: /mhub/mhub-card.js
type: module
```

> ℹ️ The card lives at `custom_components/mhub/frontend/mhub-card.js` and is
> maintained here, in this repository.

---

## 💜 Motto

No cloud. No lag. Just control.
