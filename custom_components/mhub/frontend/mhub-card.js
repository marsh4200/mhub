/**
 * mhub-card.js — v6.1.0
 * Self-configuring Lovelace card for the MHUB integration.
 *
 * Zero manual setup. The card reads your HA entity registry,
 * finds every MHUB entity automatically, and builds itself.
 *
 * Install:
 *   1. Copy to /config/www/mhub-card.js
 *   2. Settings → Dashboards → Resources → Add
 *      URL: /local/mhub-card.js   Type: JavaScript module
 *   3. Add card → Custom → MHUB Card
 *   4. Done — no YAML, no entity entry, no config needed.
 *
 * Optional YAML overrides (all optional):
 *   type: custom:mhub-card
 *   title: My MHUB          # override header title
 *   entry_id: abc123        # force a specific config entry (multi-hub)
 */

(function () {
  "use strict";

  const VERSION = "6.3.0";

  /* ─── utilities ─────────────────────────────────────────── */
  function x(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  /* Whitelist for icon URLs we'll render in <img src="…">.
     Blocks javascript:, vbscript:, file:, http(s):// to a third party, etc.
     Anything not matching is treated as no-icon. */
  const SAFE_ICON_RE = /^(\/api\/image\/serve\/|\/local\/|data:image\/)/;
  function safeIconUrl(u) {
    if (typeof u !== "string") return null;
    return SAFE_ICON_RE.test(u) ? u : null;
  }

  /* Extract the actual image URL from whatever format is stored in config.
     New format:  /api/image/serve/{id}/512x512  (HA Image API — server-side, all devices)
     Legacy:      mhub_icon_* localStorage token, plain data URL, /local/ path
     Returns a URL only if it passes safeIconUrl(). */
  function extractIconUrl(raw) {
    if (!raw) return null;
    let candidate = null;
    if (typeof raw === "object" && raw.dataUrl) candidate = raw.dataUrl;
    else if (typeof raw === "string") {
      if (raw.startsWith("/api/image/serve/") || raw.startsWith("/local/") || raw.startsWith("data:")) {
        candidate = raw;
      } else if (raw.startsWith("mhub_icon_")) {
        try { candidate = localStorage.getItem(raw) || null; } catch (_) { candidate = null; }
      } else if (raw.startsWith("{")) {
        try { candidate = JSON.parse(raw).dataUrl || null; } catch (_) {}
      } else {
        const stripped = raw.split("#mhub-")[0];
        if (stripped) candidate = stripped;
      }
    }
    return safeIconUrl(candidate);
  }

  /* ─── brand colours ─────────────────────────────────────── */
  const BRANDS = {
    "netflix":       { bg:"#E50914", fg:"#fff",    t:"N"   },
    "youtube":       { bg:"#FF0000", fg:"#fff",    t:"YT"  },
    "sky q":         { bg:"#0072CE", fg:"#fff",    t:"SKY" },
    "sky":           { bg:"#0072CE", fg:"#fff",    t:"SKY" },
    "ps5":           { bg:"#003087", fg:"#fff",    t:"PS5" },
    "ps4":           { bg:"#003087", fg:"#fff",    t:"PS4" },
    "xbox":          { bg:"#107C10", fg:"#fff",    t:"X"   },
    "apple tv":      { bg:"#1c1c1e", fg:"#fff",    t:"ATV" },
    "appletv":       { bg:"#1c1c1e", fg:"#fff",    t:"ATV" },
    "spotify":       { bg:"#1DB954", fg:"#fff",    t:"SP"  },
    "fire tv":       { bg:"#232F3E", fg:"#FF9900", t:"F"   },
    "firetv":        { bg:"#232F3E", fg:"#FF9900", t:"F"   },
    "chromecast":    { bg:"#4285F4", fg:"#fff",    t:"CC"  },
    "nvidia shield": { bg:"#76b900", fg:"#fff",    t:"NV"  },
    "shield":        { bg:"#76b900", fg:"#fff",    t:"NV"  },
    "blu-ray":       { bg:"#1a3a6e", fg:"#4a9eff", t:"BR"  },
    "bluray":        { bg:"#1a3a6e", fg:"#4a9eff", t:"BR"  },
    "hdmi":          { bg:"#2a3050", fg:"#7aadff", t:"H"   },
    "laptop":        { bg:"#2a3050", fg:"#7aadff", t:"LP"  },
    "pc":            { bg:"#2a3050", fg:"#7aadff", t:"PC"  },
  };

  function brand(label) {
    if (!label) return { bg:"#1e2230", fg:"#7a84a0", t:"?" };
    const k = label.toLowerCase();
    for (const key of Object.keys(BRANDS)) if (k.includes(key)) return BRANDS[key];
    const words = label.trim().split(/\s+/);
    const init  = words.map(w => w[0]||"").join("").toUpperCase().slice(0,2) || "?";
    const hue   = [...label].reduce((a,c)=>(a+c.charCodeAt(0))&0xffff,0) % 360;
    return { bg:`hsl(${hue},35%,22%)`, fg:`hsl(${hue},75%,68%)`, t:init };
  }


  /* ─── design system ─────────────────────────────────────────
     Three selectable card designs share one data/service engine:
       classic — the original tabbed layout (default, unchanged)
       glass   — Apple-TV-style ambient hero with a source shelf
       remote  — physical handset with D-pad, rockers and hotkeys
     Selected via cfg.design (picker in the visual editor). */
  const DESIGNS = ["classic", "glass", "remote", "strip", "panel", "poster"];

  /* Designs that render their own chrome and ignore the tab bar unless
     the user explicitly re-enables it. */
  const CHROMELESS = ["panel"];

  /* Accent presets offered in the editor's colour picker. `null` = follow
     the active Home Assistant theme (the default, and what HACS users
     with custom themes will expect). */
  const ACCENTS = [
    { id: null,        name: "Theme",  hex: null },
    { id: "#3b8aff",   name: "Blue",   hex: "#3b8aff" },
    { id: "#22d47a",   name: "Green",  hex: "#22d47a" },
    { id: "#a855f7",   name: "Purple", hex: "#a855f7" },
    { id: "#ff8c42",   name: "Amber",  hex: "#ff8c42" },
    { id: "#ff4d6d",   name: "Rose",   hex: "#ff4d6d" },
    { id: "#14b8c4",   name: "Teal",   hex: "#14b8c4" },
  ];

  /* Validate a user-supplied colour before it reaches the DOM. Accepts
     #rgb / #rrggbb / #rrggbbaa only — anything else is rejected so a
     bad value in YAML can never inject CSS. */
  const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
  function safeHex(v) {
    return (typeof v === "string" && HEX_RE.test(v.trim())) ? v.trim() : null;
  }

  /* Relative luminance → pick readable foreground for an accent */
  function readableOn(hex) {
    const h = safeHex(hex);
    if (!h) return "#fff";
    let n = h.slice(1);
    if (n.length === 3) n = n.split("").map(function(c){ return c + c; }).join("");
    const num = parseInt(n.slice(0, 6), 16);
    if (isNaN(num)) return "#fff";
    const srgb = [(num >> 16) & 255, (num >> 8) & 255, num & 255].map(function(v) {
      const s = v / 255;
      return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
    });
    const L = 0.2126 * srgb[0] + 0.7152 * srgb[1] + 0.0722 * srgb[2];
    return L > 0.5 ? "#101319" : "#fff";
  }

  function shadeHex(hex, f) {
    const m = hex.replace("#", "");
    const n = m.length === 3 ? m.split("").map(function(c){ return c + c; }).join("") : m;
    const num = parseInt(n, 16);
    if (isNaN(num)) return hex;
    const cl = function(v){ return Math.max(0, Math.min(255, Math.round(v * f))); };
    const r = cl((num >> 16) & 255), g = cl((num >> 8) & 255), b = cl(num & 255);
    return "#" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
  }

  /* Two-stop gradient derived from a brand colour (hex or hsl) */
  function gradPair(bg) {
    if (typeof bg === "string" && bg[0] === "#") return [shadeHex(bg, 1.22), shadeHex(bg, 0.6)];
    const m = /hsl\((\d+),\s*(\d+)%?,\s*(\d+)%?\)/.exec(bg || "");
    if (m) {
      const h = m[1], s = m[2], l = parseInt(m[3], 10);
      return ["hsl(" + h + "," + s + "%," + Math.min(66, l + 14) + "%)",
              "hsl(" + h + "," + s + "%," + Math.max(10, l - 10) + "%)"];
    }
    return [bg || "#2a3050", bg || "#1e2230"];
  }

  /* Translucent glow colour for the glass ambient backdrop */
  function glowColor(bg) {
    if (typeof bg === "string" && bg[0] === "#") {
      const n = bg.slice(1);
      const x6 = n.length === 3 ? n.split("").map(function(c){ return c + c; }).join("") : n;
      const num = parseInt(x6, 16);
      if (!isNaN(num)) return "rgba(" + ((num >> 16) & 255) + "," + ((num >> 8) & 255) + "," + (num & 255) + ",.5)";
    }
    const m = /hsl\((\d+),\s*(\d+)%?,\s*(\d+)%?\)/.exec(bg || "");
    if (m) return "hsla(" + m[1] + "," + m[2] + "%," + Math.min(60, parseInt(m[3], 10) + 20) + "%,.5)";
    return "rgba(90,110,180,.4)";
  }

  /* ─── SVG icons (Tabler-style outline, 24px viewBox, 2px stroke) ─── */
  const I = {
    logo:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4.6 9a9 9 0 0 1 .49 -2M2 12c0 -.81 .1 -1.59 .3 -2.34M4.6 15a9 9 0 0 1 -.5 -2M7 4.6a9 9 0 0 1 2 -.5M12 2c.81 0 1.59 .1 2.34 .3M19.4 9a9 9 0 0 0 -.49 -2M22 12c0 -.81 -.1 -1.59 -.3 -2.34M19.4 15a9 9 0 0 0 .5 -2M17 19.4a9 9 0 0 0 2 -1.4M12 22c-.81 0 -1.59 -.1 -2.34 -.3M7 19.4a9 9 0 0 0 2 1.4"/><circle cx="12" cy="12" r="3"/></svg>`,
    power:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 6a7.75 7.75 0 1 0 10 0"/><path d="M12 4l0 8"/></svg>`,
    von:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 8a5 5 0 0 1 0 8"/><path d="M17.7 5a9 9 0 0 1 0 14"/><path d="M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v14a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5"/></svg>`,
    voff:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 8a5 5 0 0 1 1.912 4.934m-1.377 2.602a5 5 0 0 1 -.535 .464"/><path d="M17.7 5a9 9 0 0 1 2.362 11.086m-1.676 2.299a9 9 0 0 1 -.686 .615"/><path d="M9.069 5.054l.431 -.554a.8 .8 0 0 1 1.5 .5v2m0 4v8a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l1.294 -1.664"/><path d="M3 3l18 18"/></svg>`,
    play:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v16l13 -8z"/></svg>`,
    fn:     `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 3l14 0"/><path d="M5 21l14 0"/><path d="M5 3l7 8l-7 10"/><path d="M19 3l-7 8l7 10"/></svg>`,
    ref:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8.1 8.1 0 0 0 -15.5 -2m-.5 -4v4h4"/><path d="M4 13a8.1 8.1 0 0 0 15.5 2m.5 4v-4h-4"/></svg>`,
    chev:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6l6 -6"/></svg>`,
    navs: {
      switch:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 10h14l-4 -4"/><path d="M17 14h-14l4 4"/></svg>`,
      volume:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 8a5 5 0 0 1 0 8"/><path d="M6 15h-2a1 1 0 0 1 -1 -1v-4a1 1 0 0 1 1 -1h2l3.5 -4.5a.8 .8 0 0 1 1.5 .5v14a.8 .8 0 0 1 -1.5 .5l-3.5 -4.5"/></svg>`,
      sequences: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 4v16l13 -8z"/></svg>`,
      ir:        `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 4h14a2 2 0 0 1 2 2v12a2 2 0 0 1 -2 2h-14a2 2 0 0 1 -2 -2v-12a2 2 0 0 1 2 -2z"/><path d="M9 9m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0"/><path d="M9 13l0 4"/><path d="M13 9l2 0"/><path d="M13 13l2 0"/><path d="M13 17l2 0"/></svg>`,
      diag:      `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>`,
    }
  };

  /* ─── CSS ──────────────────────────────────────────────────
     Uses Home Assistant theme variables so the card adapts to
     light/dark themes automatically. Falls back to dark values. */
  const CSS = `
    *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
    :host {
      display:block;
      --mh-bg:        var(--ha-card-background, var(--card-background-color, #1c1f26));
      --mh-surface:   var(--secondary-background-color, rgba(255,255,255,.04));
      --mh-surface-2: var(--primary-background-color, rgba(0,0,0,.18));
      --mh-text:      var(--primary-text-color, #e8eeff);
      --mh-text-2:    var(--secondary-text-color, #8a93a8);
      --mh-text-3:    var(--disabled-text-color, #6a7490);
      --mh-border:    var(--divider-color, rgba(127,127,127,.2));
      --mh-accent:    var(--primary-color, #3b8aff);
      --mh-accent-fg: var(--text-primary-color, #fff);
      --mh-accent-bg: var(--primary-color, #3b8aff);
      --mh-success:   var(--success-color, #22d47a);
      --mh-warn:      var(--warning-color, #ffb830);
      --mh-error:     var(--error-color, #ff4d4d);
      --mh-radius:    var(--ha-card-border-radius, 16px);
    }

    .sr-only {
      position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
      overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0;
    }
    .card {
      background: var(--mh-bg);
      border-radius: var(--mh-radius);
      overflow: hidden;
      font-family: var(--paper-font-body1_-_font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
      color: var(--mh-text);
      border: 1px solid var(--mh-border);
      display: flex; flex-direction: column;
    }

    /* ─── header ─── */
    .hdr {
      padding: 14px 16px;
      display: flex; align-items: center; gap: 12px;
      border-bottom: 1px solid var(--mh-border);
    }
    .hdr-logo {
      width: 38px; height: 38px;
      border-radius: 11px;
      background: color-mix(in srgb, var(--mh-accent) 14%, transparent);
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0;
    }
    .hdr-logo svg { width: 20px; height: 20px; color: var(--mh-accent); display: block; }
    .hdr-text { flex: 1; min-width: 0; }
    .hdr-title {
      font-size: 16px; font-weight: 600; letter-spacing: -0.01em;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .hdr-sub {
      font-size: 12px; color: var(--mh-text-2);
      margin-top: 2px;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .pill {
      display: flex; align-items: center; gap: 6px;
      padding: 4px 10px; border-radius: 20px;
      font-size: 11px; font-weight: 600;
      flex-shrink: 0;
    }
    .pill.on  { background: color-mix(in srgb, var(--mh-success) 16%, transparent); color: var(--mh-success); }
    .pill.off { background: color-mix(in srgb, var(--mh-error) 16%, transparent);   color: var(--mh-error);   }
    .pdot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
    .pw-btn {
      width: 38px; height: 38px;
      border-radius: 11px;
      border: none;
      background: color-mix(in srgb, var(--mh-success) 14%, transparent);
      color: var(--mh-success);
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; padding: 0; flex-shrink: 0;
      transition: transform .1s, background .15s;
    }
    .pw-btn.off { background: color-mix(in srgb, var(--mh-error) 14%, transparent); color: var(--mh-error); }
    .pw-btn:hover  { background: color-mix(in srgb, var(--mh-success) 24%, transparent); }
    .pw-btn.off:hover { background: color-mix(in srgb, var(--mh-error) 24%, transparent); }
    .pw-btn:active { transform: scale(.94); }
    .pw-btn svg { width: 18px; height: 18px; display: block; }

    /* ─── pages ─── */
    .pg { display: none; }
    .pg.on { display: block; }
    .body { padding: 16px; }

    /* ─── now-playing hero ─── */
    .now-head {
      display: flex; align-items: center; justify-content: space-between;
      gap: 8px;
      margin-bottom: 10px;
    }
    .now-head-lbl {
      font-size: 11px; font-weight: 600; letter-spacing: .06em;
      text-transform: uppercase; color: var(--mh-text-3);
      flex-shrink: 1; min-width: 0;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }
    .zsel-btn {
      font-size: 12px; color: var(--mh-text-2);
      background: transparent; border: none;
      padding: 4px 8px; border-radius: 6px;
      cursor: pointer; display: flex; align-items: center; gap: 4px;
      font-family: inherit; min-width: 0; flex: 0 1 auto;
      white-space: nowrap; overflow: hidden;
    }
    /* When the card is narrow, hide the "Now showing" label so the dropdown
       has the full row to itself — prevents the output label being clipped to "Out…" */
    @container (max-width: 360px) { .now-head-lbl { display: none; } }
    @media (max-width: 360px) { .now-head-lbl { display: none; } }
    .zsel-btn:hover { color: var(--mh-text); background: var(--mh-surface); }
    .zsel-btn span { overflow: hidden; text-overflow: ellipsis; }
    .zsel-btn svg  { width: 14px; height: 14px; flex-shrink: 0; transition: transform .15s; }
    .zsel-btn[aria-expanded="true"] svg { transform: rotate(180deg); }

    /* native select sits invisibly over the button so it's still clickable
       and keyboard-accessible (and works inside HA's shadow root). */
    .zsel-wrap { position: relative; }
    .zdrop {
      position: absolute; inset: 0;
      width: 100%; height: 100%;
      opacity: 0; cursor: pointer;
      font-family: inherit; font-size: 12px;
      border: none; background: transparent;
    }

    .now {
      border-radius: 14px;
      padding: 18px;
      display: flex; align-items: center; gap: 14px;
      margin-bottom: 14px;
      transition: background .25s ease;
      min-height: 92px;
    }
    .now-ico {
      width: 56px; height: 56px;
      border-radius: 13px;
      display: flex; align-items: center; justify-content: center;
      font-size: 18px; font-weight: 800;
      flex-shrink: 0; overflow: hidden;
      letter-spacing: -.02em;
    }
    .now-ico img { width: 100%; height: 100%; object-fit: cover; }
    .now-text { flex: 1; min-width: 0; }
    .now-name {
      font-size: 19px; font-weight: 600; letter-spacing: -.01em;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .now-meta {
      font-size: 13px; margin-top: 2px;
      opacity: .82;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .now-mute {
      width: 44px; height: 44px;
      border-radius: 50%;
      border: none;
      background: rgba(255,255,255,.18);
      color: #fff;
      display: flex; align-items: center; justify-content: center;
      cursor: pointer; padding: 0;
      flex-shrink: 0;
      transition: background .15s, transform .1s;
    }
    .now-mute:hover  { background: rgba(255,255,255,.28); }
    .now-mute:active { transform: scale(.92); }
    .now-mute.muted  { background: var(--mh-warn); color: #1a1300; }
    .now-mute svg    { width: 20px; height: 20px; display: block; }

    /* When no source is active, fall back to surface bg */
    .now.idle {
      background: var(--mh-surface);
      color: var(--mh-text);
    }
    .now.idle .now-ico {
      background: var(--mh-surface-2);
      color: var(--mh-text-3);
    }
    .now.idle .now-meta { color: var(--mh-text-2); opacity: 1; }
    .now.idle .now-mute {
      background: var(--mh-surface-2);
      color: var(--mh-text-2);
    }

    /* ─── inline volume row (only when zone has a volume entity) ─── */
    .vol-inline {
      display: flex; align-items: center; gap: 12px;
      padding: 10px 14px;
      background: var(--mh-surface);
      border-radius: 12px;
      margin-bottom: 18px;
    }
    .vol-inline svg { width: 18px; height: 18px; color: var(--mh-text-2); flex-shrink: 0; display: block; }
    .vol-inline .vs { flex: 1; min-width: 0; }
    .vol-inline .vv {
      font-size: 13px; font-weight: 600; min-width: 30px;
      text-align: right; color: var(--mh-text);
    }

    /* ─── sources grid ─── */
    .slbl {
      font-size: 11px; font-weight: 600; letter-spacing: .06em;
      color: var(--mh-text-3); margin-bottom: 10px;
      text-transform: uppercase;
    }
    .sgrid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 10px;
    }
    @media (min-width: 480px) { .sgrid { grid-template-columns: repeat(4, 1fr); } }
    .sbtn {
      border: 1px solid var(--mh-border);
      border-radius: 14px;
      padding: 14px 8px 12px;
      cursor: pointer;
      background: var(--mh-surface);
      display: flex; flex-direction: column; align-items: center; gap: 8px;
      font-family: inherit;
      min-height: 96px;
      transition: transform .08s, border-color .15s;
    }
    .sbtn:hover  { border-color: color-mix(in srgb, var(--mh-text) 25%, transparent); }
    .sbtn:active { transform: scale(.96); }
    .sbtn.on {
      border: 2px solid var(--mh-accent);
      padding: 13px 7px 11px;     /* compensate for thicker border */
    }
    .sico {
      width: 44px; height: 44px;
      border-radius: 11px;
      display: flex; align-items: center; justify-content: center;
      font-size: 14px; font-weight: 800;
      flex-shrink: 0; overflow: hidden;
      letter-spacing: -.02em;
    }
    .sico img { width: 100%; height: 100%; object-fit: cover; }
    .sname {
      font-size: 12px; font-weight: 500;
      color: var(--mh-text-2);
      text-align: center; line-height: 1.3;
      word-break: break-word;
    }
    .sbtn.on .sname { color: var(--mh-accent); }

    /* ─── volume sliders (volume tab) ─── */
    .vrow { display: flex; align-items: center; gap: 12px; margin-bottom: 12px; }
    .vlbl {
      font-size: 13px; color: var(--mh-text);
      width: 110px; flex-shrink: 0;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      font-weight: 500;
    }
    .vs {
      flex: 1; min-width: 0;
      -webkit-appearance: none; appearance: none;
      height: 4px; border-radius: 2px;
      background: var(--mh-border);
      outline: none; cursor: pointer;
    }
    .vs::-webkit-slider-thumb {
      -webkit-appearance: none;
      width: 18px; height: 18px; border-radius: 50%;
      background: var(--mh-accent); cursor: pointer;
      border: 2px solid var(--mh-bg);
    }
    .vs::-moz-range-thumb {
      width: 18px; height: 18px; border-radius: 50%;
      background: var(--mh-accent); cursor: pointer;
      border: 2px solid var(--mh-bg);
    }
    .vv {
      font-size: 13px; color: var(--mh-text);
      width: 36px; text-align: right; flex-shrink: 0;
      font-weight: 600;
    }

    /* ─── mute pill button (used in volume tab) ─── */
    .mb {
      padding: 6px 12px; border-radius: 8px;
      border: 1px solid var(--mh-border);
      background: transparent;
      color: var(--mh-text-2);
      font-size: 12px; font-weight: 500;
      cursor: pointer;
      display: inline-flex; align-items: center; gap: 5px;
      white-space: nowrap; font-family: inherit;
      transition: border-color .15s, color .15s;
    }
    .mb svg { width: 14px; height: 14px; display: block; }
    .mb.muted {
      background: color-mix(in srgb, var(--mh-warn) 14%, transparent);
      border-color: color-mix(in srgb, var(--mh-warn) 40%, transparent);
      color: var(--mh-warn);
    }
    .mb:hover:not(.muted) { color: var(--mh-text); border-color: color-mix(in srgb, var(--mh-text) 30%, transparent); }

    /* ─── sequences ─── */
    .seq-pick {
      display: flex; align-items: center; gap: 10px;
      margin-bottom: 14px;
    }
    .seq-pick select {
      flex: 1; min-width: 0;
      padding: 12px 14px;
      border-radius: 12px;
      border: 1px solid var(--mh-border);
      background: var(--mh-surface);
      color: var(--mh-text);
      font-size: 13px; font-weight: 500;
      font-family: inherit;
      cursor: pointer;
      appearance: none; -webkit-appearance: none; -moz-appearance: none;
      background-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%237a84a0' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'><path d='M6 9l6 6l6 -6'/></svg>");
      background-repeat: no-repeat;
      background-position: right 12px center;
      background-size: 16px 16px;
      padding-right: 38px;
    }
    .seq-pick select:focus { outline: none; border-color: var(--mh-accent); }
    .seq-run {
      padding: 12px 18px;
      border-radius: 12px;
      border: 1px solid var(--mh-border);
      background: var(--mh-surface);
      color: var(--mh-text);
      font-size: 13px; font-weight: 600;
      font-family: inherit;
      cursor: pointer;
      display: inline-flex; align-items: center; gap: 8px;
      flex-shrink: 0;
      transition: border-color .15s, color .15s, transform .08s;
    }
    .seq-run svg { width: 16px; height: 16px; color: var(--mh-accent); display: block; }
    .seq-run:hover:not(:disabled)  { border-color: color-mix(in srgb, var(--mh-text) 25%, transparent); }
    .seq-run:active:not(:disabled) { transform: scale(.97); }
    .seq-run:disabled { opacity: .45; cursor: not-allowed; }
    .seq-run.fired {
      border-color: var(--mh-success) !important;
      color: var(--mh-success);
    }
    .seq-run.fired svg { color: var(--mh-success); }

    /* legacy grid (retained for safety / fallback) */
    .seqg {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
      gap: 8px;
    }
    .seqb {
      background: var(--mh-surface);
      border: 1px solid var(--mh-border);
      border-radius: 12px;
      padding: 12px 14px;
      cursor: pointer;
      color: var(--mh-text);
      display: flex; align-items: center; gap: 9px;
      font-size: 13px; font-weight: 500;
      font-family: inherit;
      text-align: left; width: 100%;
      transition: border-color .15s, transform .08s;
    }
    .seqb svg { width: 16px; height: 16px; color: var(--mh-accent); flex-shrink: 0; display: block; }
    .seqb:hover  { border-color: color-mix(in srgb, var(--mh-text) 25%, transparent); }
    .seqb:active { transform: scale(.97); }
    .seqb.fired {
      border-color: var(--mh-success) !important;
      color: var(--mh-success);
    }
    .seqb.fired svg { color: var(--mh-success); }

    /* ─── IR / CEC accordions ─── */
    .irdev {
      margin-bottom: 8px;
      border: 1px solid var(--mh-border);
      border-radius: 12px;
      background: var(--mh-surface);
      overflow: hidden;
    }
    .irdev[open] { border-color: color-mix(in srgb, var(--mh-text) 22%, transparent); }
    .irdsum {
      list-style: none; cursor: pointer;
      padding: 12px 14px;
      display: flex; align-items: center; gap: 10px;
      font-size: 13px; color: var(--mh-text); font-weight: 500;
      user-select: none;
    }
    .irdsum::-webkit-details-marker { display: none; }
    .irdsum::marker { display: none; content: ""; }
    .irdsum:hover { background: var(--mh-surface-2); }
    .irdchev {
      width: 16px; height: 16px;
      flex-shrink: 0;
      transition: transform .15s ease;
      color: var(--mh-text-3);
    }
    .irdev[open] .irdchev { transform: rotate(180deg); color: var(--mh-accent); }
    .irdtitle { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .irdcount {
      font-size: 11px; color: var(--mh-text-3);
      background: var(--mh-surface-2);
      padding: 2px 9px; border-radius: 20px;
      flex-shrink: 0; font-weight: 600;
    }
    .irdev[open] .irdcount {
      color: var(--mh-accent);
      background: color-mix(in srgb, var(--mh-accent) 16%, transparent);
    }
    .irdbody { padding: 4px 14px 14px; border-top: 1px solid var(--mh-border); }
    .irloc {
      font-size: 11px; font-weight: 600; letter-spacing: .04em;
      color: var(--mh-text-3);
      text-transform: uppercase;
      padding-top: 14px;
    }
    .irloc.first { padding-top: 10px; }
    .irg { display: flex; flex-wrap: wrap; gap: 6px; padding-top: 12px; }
    .irloc + .irg { padding-top: 6px; }
    .irb {
      padding: 6px 13px; border-radius: 8px;
      border: 1px solid var(--mh-border);
      background: var(--mh-surface-2);
      color: var(--mh-text-2);
      font-size: 12px; font-weight: 500;
      cursor: pointer; font-family: inherit;
      transition: border-color .15s, color .15s, transform .08s;
    }
    .irb:hover  { border-color: color-mix(in srgb, var(--mh-text) 25%, transparent); color: var(--mh-text); }
    .irb:active { transform: scale(.96); }
    .irb.fired {
      border-color: var(--mh-accent);
      color: var(--mh-accent);
      background: color-mix(in srgb, var(--mh-accent) 14%, transparent);
    }

    /* ─── diagnostics ─── */
    .dgrid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 14px; }
    .dcell {
      background: var(--mh-surface);
      border: 1px solid var(--mh-border);
      border-radius: 12px;
      padding: 12px 14px;
    }
    .dkey {
      font-size: 11px; font-weight: 600; letter-spacing: .05em;
      color: var(--mh-text-3); text-transform: uppercase;
      margin-bottom: 4px;
    }
    .dval { font-size: 15px; font-weight: 600; }
    .dval.ok   { color: var(--mh-success); }
    .dval.warn { color: var(--mh-warn); }
    .drow {
      display: flex; justify-content: space-between;
      font-size: 13px; padding: 5px 0; gap: 10px;
    }
    .dk { color: var(--mh-text-2); flex-shrink: 0; }
    .dv { color: var(--mh-text); text-align: right; word-break: break-all; font-weight: 500; }

    /* ─── bottom tab bar ─── */
    .navbar {
      display: flex;
      border-top: 1px solid var(--mh-border);
      background: var(--mh-surface);
    }
    .nb {
      flex: 1;
      padding: 10px 4px 9px;
      border: none;
      background: transparent;
      color: var(--mh-text-3);
      cursor: pointer;
      display: flex; flex-direction: column;
      align-items: center; gap: 4px;
      font-family: inherit;
      border-top: 2px solid transparent;
      transition: color .12s;
      min-width: 0;
    }
    .nb svg { width: 20px; height: 20px; display: block; }
    .nb-lbl {
      font-size: 11px; font-weight: 500;
      white-space: nowrap;
      max-width: 100%; overflow: hidden; text-overflow: ellipsis;
    }
    .nb.on {
      color: var(--mh-accent);
      border-top-color: var(--mh-accent);
      background: var(--mh-bg);
    }
    .nb:hover:not(.on) { color: var(--mh-text); }

    /* ─── footer (refresh) ─── */
    .ftr {
      border-top: 1px solid var(--mh-border);
      padding: 8px 14px;
      display: flex; justify-content: space-between; align-items: center;
    }
    .finfo { font-size: 11px; color: var(--mh-text-3); }
    .rbtn {
      padding: 5px 11px; border-radius: 8px;
      border: 1px solid var(--mh-border);
      background: transparent;
      color: var(--mh-text-2);
      font-size: 11px; font-weight: 500;
      cursor: pointer;
      display: flex; align-items: center; gap: 5px;
      font-family: inherit;
      transition: color .15s, border-color .15s;
    }
    .rbtn svg { width: 13px; height: 13px; display: block; }
    .rbtn:hover { color: var(--mh-accent); border-color: var(--mh-accent); }

    /* ─── utils ─── */
    .div { height: 1px; background: var(--mh-border); margin: 14px 0; }
    .empty {
      padding: 28px 20px; text-align: center;
      color: var(--mh-text-2); font-size: 13px; line-height: 1.6;
    }
    .loading { padding: 36px; text-align: center; color: var(--mh-text-2); font-size: 13px; }

    /* ═══ DESIGN: GLASS ══════════════════════════════════════
       Apple-TV-style skin. Dark by design; ambient glow tinted
       from the active source's brand colour. */
    .card.dz-glass {
      --mh-bg: #07080d;
      --mh-surface: rgba(255,255,255,.06);
      --mh-surface-2: rgba(255,255,255,.04);
      --mh-text: #f2f4fa;
      --mh-text-2: rgba(255,255,255,.58);
      --mh-text-3: rgba(255,255,255,.4);
      --mh-border: rgba(255,255,255,.10);
      --mh-accent: #8ab4ff;
      --mh-accent-fg: #0b1220;
      background: #07080d;
      border-color: #171b26;
      color: #f2f4fa;
    }
    .dz-glass .hdr { border-bottom: none; padding: 16px 18px 2px; background: transparent; }
    .dz-glass .hdr-logo, .dz-glass .hdr-sub, .dz-glass #stxt { display: none; }
    .dz-glass .hdr-title {
      font-size: 11px; font-weight: 600; letter-spacing: .16em;
      text-transform: uppercase; color: rgba(255,255,255,.55);
    }
    .dz-glass .pill { background: transparent; padding: 4px; }
    .dz-glass .pw-btn { background: rgba(255,255,255,.07); color: rgba(255,255,255,.85); }
    .dz-glass .pw-btn.off { background: rgba(255,90,90,.15); color: #ff7b7b; }
    .dz-glass .ftr { display: none; }
    .dz-glass .navbar {
      border-top: none; background: rgba(255,255,255,.055);
      margin: 2px 12px 12px; border-radius: 16px;
      border: 1px solid rgba(255,255,255,.09); overflow: hidden;
    }
    .dz-glass .nb { border-top: none; border-radius: 12px; color: rgba(255,255,255,.45); padding: 9px 4px 8px; }
    .dz-glass .nb.on { background: rgba(255,255,255,.10); color: #fff; }
    .dz-glass .pg { position: relative; overflow: hidden; }
    .dz-glass .body { position: relative; }

    .g-glow {
      position: absolute; top: -90px; left: 50%; transform: translateX(-50%);
      width: 380px; height: 260px; border-radius: 50%;
      pointer-events: none; transition: background .6s ease;
    }
    .g-zones {
      position: relative; display: flex; flex-wrap: wrap; gap: 6px;
      justify-content: center;
      margin: 2px 0 16px;
    }
    .g-zpill {
      flex-shrink: 0; font-size: 12px; padding: 6px 13px; border-radius: 15px;
      border: none; cursor: pointer; font-family: inherit;
      background: rgba(255,255,255,.07); color: rgba(255,255,255,.55);
      transition: background .15s, color .15s;
      white-space: nowrap;
    }
    .g-zpill.on { background: #2b62d4; color: #fff; font-weight: 600; }
    .g-hero { position: relative; text-align: center; margin-bottom: 16px; }
    .g-tile {
      width: 84px; height: 84px; border-radius: 22px; margin: 0 auto 10px;
      display: flex; align-items: center; justify-content: center;
      font-size: 30px; font-weight: 800; color: #fff;
      border: 1px solid rgba(255,255,255,.22); overflow: hidden;
      transition: background .4s;
    }
    .g-tile img { width: 100%; height: 100%; object-fit: cover; }
    .g-name {
      font-size: 22px; font-weight: 600; letter-spacing: -.01em;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .g-meta { font-size: 12px; color: rgba(255,255,255,.5); margin-top: 2px; }
    .g-shelf {
      position: relative; display: grid; gap: 10px 8px;
      grid-template-columns: repeat(auto-fill, minmax(84px, 1fr));
      padding: 4px 0 6px; margin-bottom: 12px;
    }
    .g-s { min-width: 0; background: transparent; border: none; padding: 0; cursor: pointer; font-family: inherit; }
    .g-sart {
      height: 58px; border-radius: 14px;
      display: flex; align-items: center; justify-content: center;
      font-weight: 800; color: #fff; font-size: 13px; letter-spacing: .02em;
      border: 2px solid transparent; overflow: hidden;
      transition: border-color .15s, transform .12s;
    }
    .g-sart img { width: 100%; height: 100%; object-fit: cover; }
    .g-s.on .g-sart { border-color: rgba(255,255,255,.9); }
    .g-s:active .g-sart { transform: scale(.96); }
    .g-slbl {
      font-size: 10px; color: rgba(255,255,255,.55); text-align: center; margin-top: 5px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .g-bar {
      position: relative; display: flex; align-items: center; gap: 12px;
      padding: 10px 12px; border-radius: 16px;
      background: rgba(255,255,255,.06); border: 1px solid rgba(255,255,255,.10);
    }
    .g-bar svg { width: 16px; height: 16px; color: rgba(255,255,255,.7); flex-shrink: 0; }
    .g-mute { background: transparent; border: none; padding: 0; cursor: pointer; color: inherit; display: flex; align-items: center; }
    .g-mute.muted svg { color: #ff7b7b; }
    .g-bar input[type=range] { flex: 1; }
    .g-vv { font-size: 12px; color: rgba(255,255,255,.7); min-width: 22px; text-align: right; }

    /* ═══ DESIGN: REMOTE ═════════════════════════════════════
       Physical handset skin. Pure CSS shading — no images. */
    .card.dz-remote {
      --mh-bg: #1a1c22;
      --mh-surface: rgba(255,255,255,.05);
      --mh-surface-2: rgba(0,0,0,.25);
      --mh-text: #e8ebf2;
      --mh-text-2: #9aa2b4;
      --mh-text-3: #6b7284;
      --mh-border: rgba(255,255,255,.08);
      --mh-accent: #7ee2ae;
      --mh-accent-fg: #0b1810;
      background: linear-gradient(180deg, #23262e, #15171d);
      border-color: rgba(90,96,112,.35);
      max-width: 340px; margin: 0 auto;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.07), inset 0 -2px 6px rgba(0,0,0,.45);
    }
    .dz-remote .hdr { border-bottom: none; padding: 16px 18px 4px; }
    .dz-remote .hdr-logo, .dz-remote .hdr-sub, .dz-remote #stxt { display: none; }
    .dz-remote .hdr-title {
      font-size: 10px; font-weight: 600; letter-spacing: .2em;
      text-transform: uppercase; color: #6b7284;
    }
    .dz-remote .pill { background: transparent; padding: 4px; }
    .dz-remote .pw-btn {
      width: 38px; height: 38px; border-radius: 50%;
      background: linear-gradient(180deg, #2c2f38, #1a1c22);
      border: 1px solid #3a3e4a; color: #ff5b5b;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.08);
    }
    .dz-remote .pw-btn.off { color: #5f6674; }
    .dz-remote .ftr { display: none; }
    .dz-remote .navbar { border-top: none; background: transparent; padding: 0 10px 12px; gap: 4px; }
    .dz-remote .nb { border-top: none; border-radius: 12px; color: #6b7284; }
    .dz-remote .nb.on { background: rgba(255,255,255,.07); color: #e8ebf2; }

    .r-lcd {
      border-radius: 14px; background: #0b0d12; border: 1px solid #2a2e3a;
      padding: 10px 12px; margin-bottom: 16px; user-select: none;
      font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    }
    .r-lcd.click { cursor: pointer; }
    .r-lcd-top {
      font-size: 9px; color: #4d8f6e; letter-spacing: .12em; text-transform: uppercase;
      display: flex; justify-content: space-between; gap: 8px;
    }
    .r-lcd-top span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .r-lcd-src {
      font-size: 15px; color: #7ee2ae; margin-top: 2px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .r-dpad {
      width: 158px; height: 158px; border-radius: 50%; margin: 0 auto 16px; position: relative;
      background: linear-gradient(180deg, #2b2e37, #1c1e25); border: 1px solid #3a3e4a;
      box-shadow: inset 0 2px 3px rgba(255,255,255,.06), inset 0 -3px 8px rgba(0,0,0,.45);
    }
    .r-d {
      position: absolute; background: transparent; border: none; color: #9aa2b4;
      cursor: pointer; padding: 8px; display: flex; align-items: center; justify-content: center;
    }
    .r-d svg { width: 18px; height: 18px; display: block; }
    .r-d:active { color: #fff; }
    .r-d.up    { top: 4px; left: 50%; transform: translateX(-50%); }
    .r-d.down  { bottom: 4px; left: 50%; transform: translateX(-50%); }
    .r-d.left  { left: 4px; top: 50%; transform: translateY(-50%); }
    .r-d.right { right: 4px; top: 50%; transform: translateY(-50%); }
    .r-ok {
      position: absolute; inset: 44px; border-radius: 50%;
      background: linear-gradient(180deg, #343843, #20232b); border: 1px solid #424656;
      color: #cfd5e2; font-size: 11px; font-weight: 700; letter-spacing: .05em;
      cursor: pointer; font-family: inherit;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.1);
    }
    .r-ok:active { background: #20232b; }
    .r-d.nocmd, .r-ok.nocmd { opacity: .28; cursor: default; }
    .r-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-bottom: 14px; }
    .r-row.single { grid-template-columns: 1fr; }
    .r-k {
      border-radius: 24px; background: linear-gradient(180deg, #2c2f38, #1b1d24);
      border: 1px solid #3a3e4a; display: flex; align-items: stretch;
      overflow: hidden; color: #cfd5e2;
      box-shadow: inset 0 1px 0 rgba(255,255,255,.07);
    }
    .r-kb {
      flex: 1; background: transparent; border: none; color: inherit; cursor: pointer;
      font-family: inherit; font-size: 13px; padding: 10px 0;
      display: flex; align-items: center; justify-content: center; gap: 5px; min-width: 0;
    }
    .r-kb svg { width: 14px; height: 14px; color: #9aa2b4; flex-shrink: 0; }
    .r-kb:active { background: rgba(255,255,255,.06); }
    .r-kb.muted svg { color: #ff7b7b; }
    .r-kdiv { width: 1px; background: #3a3e4a; }
    .r-src { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
    .r-s {
      aspect-ratio: 1; border-radius: 12px; border: 1px solid rgba(255,255,255,.14);
      display: flex; align-items: center; justify-content: center;
      font-size: 10px; font-weight: 800; color: #fff; cursor: pointer; padding: 0;
      overflow: hidden; font-family: inherit;
      outline: 2px solid transparent; outline-offset: 1px;
      transition: outline-color .12s, transform .1s;
    }
    .r-s img { width: 100%; height: 100%; object-fit: cover; }
    .r-s.on { outline-color: #fff; }
    .r-s:active { transform: scale(.94); }
    .r-slbl {
      font-size: 9px; color: #6b7284; text-align: center; margin-top: 4px;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }

    /* ═══ SHARED CONTROLS (used by the newer designs) ══════════
       Native <select> and <input type=range> styled to match the
       card, so they inherit platform accessibility and keyboard
       behaviour instead of re-implementing it. */
    .mh-sel {
      position: relative; display: block;
    }
    .mh-sel select {
      width: 100%; appearance: none; -webkit-appearance: none;
      font-family: inherit; font-size: 13px; color: var(--mh-text);
      background: var(--mh-surface); border: 1px solid var(--mh-border);
      border-radius: 10px; padding: 10px 34px 10px 12px; cursor: pointer;
    }
    .mh-sel select:focus-visible { outline: 2px solid var(--mh-accent); outline-offset: 1px; }
    .mh-sel::after {
      content: ""; position: absolute; right: 13px; top: 50%;
      width: 7px; height: 7px; margin-top: -5px; pointer-events: none;
      border-right: 2px solid var(--mh-text-2); border-bottom: 2px solid var(--mh-text-2);
      transform: rotate(45deg);
    }
    .mh-vol {
      display: flex; align-items: center; gap: 10px;
      padding: 9px 12px; border-radius: 12px;
      background: var(--mh-surface); border: 1px solid var(--mh-border);
    }
    .mh-vol > svg { width: 16px; height: 16px; color: var(--mh-text-2); flex-shrink: 0; }
    .mh-vol .vs { flex: 1; min-width: 0; }
    .mh-vol .mh-vv {
      font-size: 12px; color: var(--mh-text-2); min-width: 26px;
      text-align: right; font-variant-numeric: tabular-nums;
    }
    .mh-mute { background: none; border: none; padding: 0; cursor: pointer; color: inherit; display: flex; }
    .mh-mute svg { width: 16px; height: 16px; color: var(--mh-text-2); display: block; }
    .mh-mute.muted svg { color: var(--mh-error); }

    /* ═══ DESIGN: STRIP ══════════════════════════════════════
       One row per output — whole-house overview. Rows expand
       in place to reveal that zone's inputs and volume. */
    .dz-strip .body { padding: 0; }
    .dz-strip .hdr { padding: 11px 14px; }
    .dz-strip .hdr-logo { width: 30px; height: 30px; border-radius: 9px; }
    .dz-strip .hdr-logo svg { width: 16px; height: 16px; }
    .dz-strip .hdr-sub { display: none; }
    .dz-strip .hdr-title { font-size: 14px; }

    .st-row {
      display: flex; align-items: center; gap: 10px; width: 100%;
      padding: 10px 14px; background: none; border: none; cursor: pointer;
      font-family: inherit; color: var(--mh-text); text-align: left;
      border-top: 1px solid var(--mh-border);
    }
    .st-z:first-child .st-row { border-top: none; }
    .st-row:hover { background: var(--mh-surface); }
    .st-row:focus-visible { outline: 2px solid var(--mh-accent); outline-offset: -2px; }
    .st-badge {
      width: 30px; height: 30px; border-radius: 8px; flex-shrink: 0;
      display: flex; align-items: center; justify-content: center;
      font-size: 10px; font-weight: 800; overflow: hidden;
    }
    .st-badge img { width: 100%; height: 100%; object-fit: cover; }
    .st-badge.off { background: var(--mh-surface-2); color: var(--mh-text-3); font-weight: 500; }
    .st-name {
      flex: 1; min-width: 0; font-size: 13px; font-weight: 600;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .st-src {
      font-size: 12px; color: var(--mh-text-2); max-width: 42%;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .st-chev {
      width: 7px; height: 7px; flex-shrink: 0; margin-right: 2px;
      border-right: 2px solid var(--mh-text-3); border-bottom: 2px solid var(--mh-text-3);
      transform: rotate(-45deg); transition: transform .2s;
    }
    .st-z.open .st-chev { transform: rotate(45deg); }
    .st-z.open .st-row { background: var(--mh-surface); }
    .st-panel { display: none; padding: 4px 14px 14px; }
    .st-z.open .st-panel { display: block; }
    .st-grid {
      display: grid; grid-template-columns: repeat(auto-fill, minmax(74px, 1fr));
      gap: 7px; margin-bottom: 9px;
    }
    .st-i {
      display: flex; flex-direction: column; align-items: center; gap: 5px;
      padding: 8px 4px; border-radius: 10px; cursor: pointer; font-family: inherit;
      background: var(--mh-surface); border: 1px solid transparent;
    }
    .st-i.on { border-color: var(--mh-accent); background: color-mix(in srgb, var(--mh-accent) 12%, transparent); }
    .st-i:focus-visible { outline: 2px solid var(--mh-accent); outline-offset: 1px; }
    .st-iart {
      width: 28px; height: 28px; border-radius: 8px; overflow: hidden;
      display: flex; align-items: center; justify-content: center;
      font-size: 10px; font-weight: 800;
    }
    .st-iart img { width: 100%; height: 100%; object-fit: cover; }
    .st-ilbl {
      font-size: 9px; color: var(--mh-text-2); max-width: 100%;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .st-i.on .st-ilbl { color: var(--mh-accent); }

    /* ═══ DESIGN: PANEL ══════════════════════════════════════
       Kiosk for wall-mounted tablets. Large targets, no tabs. */
    .dz-panel .hdr { display: none; }
    .dz-panel .navbar, .dz-panel .ftr { display: none; }
    .dz-panel.show-nav .navbar { display: flex; }
    .dz-panel .body { padding: 16px; }

    .pn-head { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; }
    .pn-zone {
      font-size: 21px; font-weight: 700; letter-spacing: -.01em;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .pn-now { font-size: 13px; color: var(--mh-text-2); flex: 1; min-width: 0;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .pn-pw {
      width: 40px; height: 40px; border-radius: 12px; flex-shrink: 0;
      background: var(--mh-surface); border: 1px solid var(--mh-border);
      display: flex; align-items: center; justify-content: center; cursor: pointer;
      color: var(--mh-success);
    }
    .pn-pw.off { color: var(--mh-text-3); }
    .pn-pw svg { width: 19px; height: 19px; display: block; }
    .pn-grid {
      display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
      gap: 10px; margin-bottom: 12px;
    }
    .pn-i {
      min-height: 62px; border-radius: 14px; cursor: pointer; font-family: inherit;
      display: flex; align-items: center; gap: 11px; padding: 0 14px;
      border: 2px solid transparent; color: #fff; overflow: hidden; text-align: left;
      transition: transform .1s;
    }
    .pn-i.on { border-color: #fff; }
    .pn-i:active { transform: scale(.98); }
    .pn-i:focus-visible { outline: 3px solid var(--mh-accent); outline-offset: 2px; }
    .pn-iart {
      width: 34px; height: 34px; border-radius: 9px; flex-shrink: 0; overflow: hidden;
      background: rgba(255,255,255,.22);
      display: flex; align-items: center; justify-content: center;
      font-size: 12px; font-weight: 800;
    }
    .pn-iart img { width: 100%; height: 100%; object-fit: cover; }
    .pn-ilbl {
      font-size: 15px; font-weight: 600; min-width: 0;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    .pn-foot { display: flex; gap: 10px; }
    .pn-foot > * { flex: 1; min-width: 0; }
    .pn-btn {
      min-height: 46px; border-radius: 12px; cursor: pointer; font-family: inherit;
      background: var(--mh-surface); border: 1px solid var(--mh-border);
      color: var(--mh-text-2); font-size: 14px;
      display: flex; align-items: center; justify-content: center; gap: 8px;
    }
    .pn-btn svg { width: 16px; height: 16px; display: block; }
    .pn-btn:focus-visible { outline: 2px solid var(--mh-accent); outline-offset: 1px; }
    .dz-panel .mh-vol { min-height: 46px; }
    .dz-panel .mh-sel select { min-height: 46px; }

    /* ═══ DESIGN: POSTER ═════════════════════════════════════
       Artwork-first. Uploaded input images at full bleed. */
    .dz-poster .hdr-sub { display: none; }
    .po-head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 11px; }
    .po-zone { font-size: 14px; font-weight: 600; }
    .po-out { font-size: 11px; color: var(--mh-text-2); margin-left: auto; }
    .po-grid { display: grid; gap: 8px; margin-bottom: 11px; }
    .po-i {
      position: relative; aspect-ratio: 2 / 3; border-radius: 11px;
      cursor: pointer; font-family: inherit; padding: 0; overflow: hidden;
      border: 2px solid transparent; display: block; width: 100%;
      transition: transform .12s;
    }
    .po-i img { position: absolute; inset: 0; width: 100%; height: 100%; object-fit: cover; }
    .po-i.on { border-color: var(--mh-accent); }
    .po-i:active { transform: scale(.97); }
    .po-i:focus-visible { outline: 3px solid var(--mh-accent); outline-offset: 2px; }
    .po-shade {
      position: absolute; inset: 0;
      background: linear-gradient(to top, rgba(0,0,0,.75) 0%, rgba(0,0,0,.15) 45%, transparent 70%);
    }
    .po-lbl {
      position: absolute; left: 0; right: 0; bottom: 0; padding: 7px 8px;
      font-size: 10px; font-weight: 700; color: #fff; text-align: left;
      overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
      text-shadow: 0 1px 3px rgba(0,0,0,.6);
    }
    .po-i:not(.on) { opacity: .82; }
    .po-i:not(.on):hover { opacity: 1; }
    .po-bar { display: flex; gap: 8px; align-items: center; }
    .po-bar > .mh-sel { flex: 1; min-width: 0; }
    .po-bar > .mh-vol { flex: 1.2; min-width: 0; }
  `;

  /* ═══════════════════════════════════════════════════════════
     ENTITY DISCOVERY
     Reads the HA entity registry to find all MHUB entities.
     No config required.
  ═══════════════════════════════════════════════════════════ */
  function discoverMhub(hass, forcedEntryId, mhubEntityIds, mhubRegistry, deviceNames, entryEntities) {
    const allStates = Object.values(hass.states);

    /* If we have a per-entry entity set (built from the registry filtered by
       config_entry_id), restrict discovery to JUST those entities. This is
       the fix for multi-hub setups: without it, two physical MHUBs on the
       same network would have their zones, sequences, and IR commands
       merged into one card. With it, each card instance sees only the
       entities belonging to the entry_id saved in its config. */
    const all = entryEntities && entryEntities.size
      ? allStates.filter(function(s){ return entryEntities.has(s.entity_id); })
      : allStates;

    /* ── Hub-level sensors ──
       The integration uses _attr_has_entity_name = True so sensor entity_ids
       are not predictable (they depend on the device name slug).
       The MHUBStatusSensor exposes ALL diagnostic data in extra_state_attributes,
       so we find it by pattern and read everything from its attributes. */
    const find = function(pat){ return all.find(function(s){ return s.entity_id.match(pat); }); };

    /* Status sensor: unique_id = {entry_id}_hub_status → entity_id = sensor.*_status
       We find it by looking for a sensor whose attributes contain 'model' and 'firmware'
       (the diagnostic_attrs() dict that MHUBStatusSensor puts in extra_state_attributes). */
    const statS = all.find(function(s) {
      if (!s.entity_id.startsWith("sensor.")) return false;
      const a = s.attributes;
      return a.model !== undefined && a.firmware !== undefined && a.inputs !== undefined;
    }) || find(/sensor\.mhub.*status/i);

    const pwSw = find(/switch\.mhub.*system_power/i);

    /* ── Primary anchor: media_player entities with attributes.output ──
       Every MHUB output media_player exposes attributes.output = "A"/"B"/"C"…
       via extra_state_attributes. This is the definitive list of outputs. */
    const mps = all
      .filter(function(s){ return s.entity_id.startsWith("media_player.") && s.attributes.output !== undefined; })
      .sort(function(a,b){ return (a.attributes.output||"").localeCompare(b.attributes.output||""); });

    const zones = mps.map(function(mp) {
      const outLetter = (mp.attributes.output || "").toLowerCase();
      const label     = mp.attributes.friendly_name || mp.entity_id.replace("media_player.","").replace(/_/g," ");
      const slug      = mp.entity_id.replace("media_player.","");

      /* Source sensor: sensor.{slug}_source */
      const srcSensor = all.find(function(s){
        return s.entity_id.startsWith("sensor.") && s.entity_id.endsWith("_source") && (
          s.entity_id === ("sensor." + slug + "_source") ||
          (s.attributes.output || "").toLowerCase() === outLetter
        );
      });

      /* Mute switch: switch.{slug}_mute */
      const muteSwitch = all.find(function(s){
        return s.entity_id === ("switch." + slug + "_mute");
      });

      /* Volume number: number.{slug}_volume */
      const volNum = all.find(function(s){
        return s.entity_id === ("number." + slug + "_volume");
      });

      /* Sources live from media_player.source_list — populated by coordinator every 5s */
      const sourceList = mp.attributes.source_list || [];

      return {
        output:        outLetter.toUpperCase(),
        label:         label,
        media_player:  mp.entity_id,
        source_sensor: srcSensor   ? srcSensor.entity_id   : null,
        mute_switch:   muteSwitch  ? muteSwitch.entity_id  : null,
        volume_entity: volNum      ? volNum.entity_id      : null,
        sources:       sourceList.map(function(n){ return { name: n }; }),
      };
    });

    /* ── Groups (MHUB AUDIO / MZMA) ── */
    const groupVols  = all.filter(function(s){ return s.entity_id.match(/number\.mhub_group_volume_/); });
    const groupMutes = all.filter(function(s){ return s.entity_id.match(/switch\.mhub_group_mute_/); });
    const groups = groupVols.map(function(gv) {
      const slug2 = gv.entity_id.replace(/^number\./, "").replace(/_volume$/, "");
      const gm    = groupMutes.find(function(s){ return s.entity_id.replace(/^switch\./, "").replace(/_mute$/, "") === slug2; });
      const lbl   = (gv.attributes.friendly_name || slug2).replace(/ volume$/i,"").replace(/^mhub /i,"").trim();
      return { label: lbl, volume_entity: gv.entity_id, mute_switch: gm ? gm.entity_id : null };
    });

    /* ── Collect all zone slugs for exclusion logic ── */
    const zoneSlugs = zones.map(function(z){ return z.media_player.replace("media_player.",""); });

    const allButtons = all.filter(function(s){ return s.entity_id.startsWith("button."); });

    /* ── Build lookup maps from entity registry if available ──
       unique_id patterns from button.py:
         sequences:      {entry_id}_mhub_sequence_{slug}  or  {entry_id}_mhub_function_{slug}
         IR buttons:     {entry_id}_ir_{device_key}_{command_id}
         CEC buttons:    {entry_id}_cec_{device_key}_{command_id}
         source buttons: {entry_id}_source_button_{output_id}_{slug}
         identify:       {entry_id}_mhub_identify
         reboot:         {entry_id}_mhub_reboot  */

    let seqButtons = [], irButtons = [], cecButtons = [];

    if (mhubRegistry && mhubRegistry.seqEids) {
      /* Reliable path — pre-classified by device model from device registry.
         IMPORTANT: button entities that have never been pressed do NOT appear
         in hass.states. We must use the registry entity IDs directly and
         build stub objects for any that are missing from hass.states. */
      const { seqEids, irEids, cecEids } = mhubRegistry;

      const stateOrStub = function(eid) {
        return hass.states[eid] || { entity_id: eid, state: "unknown", attributes: {} };
      };

      /* Multi-hub: also restrict registry-sourced buttons to this entry */
      const inEntry = entryEntities && entryEntities.size
        ? function(eid){ return entryEntities.has(eid); }
        : function(){ return true; };

      seqButtons = [...seqEids]
        .filter(function(eid){ return !eid.match(/mhub_identify|mhub_reboot/); })
        .filter(inEntry)
        .map(stateOrStub);
      irButtons  = [...irEids].filter(inEntry).map(stateOrStub);
      cecButtons = [...cecEids].filter(inEntry).map(stateOrStub);

    } else if (mhubEntityIds && mhubEntityIds.size > 0) {
      /* Partial fallback — we have entity IDs but not unique_ids.
         Use zone-slug heuristics within the mhub set. */
      const mhubButtons = allButtons.filter(function(s){ return mhubEntityIds.has(s.entity_id); });
      const allSourceNames = new Set();
      zones.forEach(function(z){ z.sources.forEach(function(s){ allSourceNames.add(s.name.toLowerCase()); }); });

      mhubButtons.forEach(function(s) {
        if (s.entity_id.match(/mhub_identify|mhub_reboot/)) return;
        const slug = s.entity_id.replace("button.", "");
        const name = (s.attributes.friendly_name || "").toLowerCase();
        if (zoneSlugs.some(function(zs){ return slug.startsWith(zs + "_"); })) {
          if (!allSourceNames.has(name)) irButtons.push(s);
        } else {
          seqButtons.push(s);
        }
      });

    } else {
      /* Last resort fallback — no registry data at all */
      const allSourceNames = new Set();
      zones.forEach(function(z){ z.sources.forEach(function(s){ allSourceNames.add(s.name.toLowerCase()); }); });

      allButtons.forEach(function(s) {
        if (s.entity_id.match(/mhub_identify|mhub_reboot/)) return;
        const slug = s.entity_id.replace("button.", "");
        const name = (s.attributes.friendly_name || "").toLowerCase();
        if (!slug.startsWith("mhub") && !name.startsWith("mhub")) return;
        if (zoneSlugs.some(function(zs){ return slug.startsWith(zs + "_"); })) {
          if (!allSourceNames.has(name)) irButtons.push(s);
        } else {
          seqButtons.push(s);
        }
      });
    }

    /* ── Group IR buttons by device name ── */
    const irMap = {};
    irButtons.forEach(function(btn) {
      /* Use the device name from registry if available — this is set by the integration
         to something like "Living Room (Output A) - Samsung TV" or "Source - Denon AVR" */
      const devName = (deviceNames && deviceNames[btn.entity_id]) || (function() {
        const slug5  = btn.entity_id.replace("button.", "");
        const zSlug  = zoneSlugs.find(function(zs){ return slug5.startsWith(zs + "_"); });
        const zone   = zSlug && zones.find(function(z){ return z.media_player.replace("media_player.","") === zSlug; });
        return zone ? (zone.label + " IR") : "IR";
      })();
      const groupKey = devName;
      if (!irMap[groupKey]) irMap[groupKey] = { name: devName, commands: [] };
      const cmdName = btn.attributes.friendly_name ||
                      btn.entity_id.replace("button.", "").replace(/_/g, " ").trim();
      irMap[groupKey].commands.push({ name: cmdName, entity: btn.entity_id });
    });

    /* ── Group CEC buttons ── */
    const cecMap = {};
    cecButtons.forEach(function(btn) {
      const slug6  = btn.entity_id.replace("button.", "");
      const zSlug2 = zoneSlugs.find(function(zs){ return slug6.startsWith(zs + "_"); });
      const zone2  = zSlug2 && zones.find(function(z){ return z.media_player.replace("media_player.","") === zSlug2; });
      const groupKey2 = zSlug2 || "cec";
      const devName2  = zone2 ? (zone2.label + " CEC") : "CEC";
      if (!cecMap[groupKey2]) cecMap[groupKey2] = { name: devName2, commands: [] };
      const cmdName2 = btn.attributes.friendly_name ||
                       slug6.replace((zSlug2 ? zSlug2 + "_" : ""), "").replace(/_/g, " ").trim();
      cecMap[groupKey2].commands.push({ name: cmdName2, entity: btn.entity_id });
    });

    /* ── Pull diagnostic values directly from status sensor attributes ──
       MHUBStatusSensor.extra_state_attributes = diagnostic_attrs() which contains:
       model, firmware, api_version, inputs, outputs, supports_volume, etc. */
    const diagAttrs = statS ? (statS.attributes || {}) : {};

    return {
      found:       zones.length > 0 || !!statS,
      /* Pass the status sensor entity_id for power-state reads */
      status:      statS   ? statS.entity_id  : null,
      power_switch:pwSw    ? pwSw.entity_id   : null,
      /* Diagnostic values — read directly from attributes, not separate sensors */
      _diagAttrs:  diagAttrs,
      zones:       zones,
      groups:      groups,
      sequences: seqButtons.map(function(b) {
        return {
          entity: b.entity_id,
          name:   (b.attributes.friendly_name || b.entity_id.replace("button.","").replace(/_/g," ")).replace(/^mhub /i,"").trim(),
          kind:   b.entity_id.includes("function") ? "function" : "sequence",
        };
      }),
      ir_devices:  Object.values(irMap),
      cec_devices: Object.values(cecMap),
    };
  }
  /* ═══════════════════════════════════════════════════════════
     EDITOR
  ═══════════════════════════════════════════════════════════ */
  class MhubCardEditor extends HTMLElement {
    setConfig(cfg) { this._cfg = cfg || {}; this._render(); }
    set hass(h) {
      const first = !this._hass;
      this._hass = h;
      if (first) this._fetchRegistry();
      this._render();
    }

    /* Fire config-changed so HA saves the updated YAML */
    _save(cfg) {
      this._cfg = cfg;
      this.dispatchEvent(new CustomEvent("config-changed", { detail:{ config: cfg }, bubbles:true, composed:true }));
    }

    /* Render the dedicated hub-picker step shown when 2+ MHUBs exist and the
       user hasn't bound this card to one yet. Saving a choice writes
       cfg.entry_id, which then permanently locks this card to that hub. */
    _renderHubPicker(entryIds) {
      const names = this._entryNames || {};
      const counts = this._entryEntsMap || {};
      this.innerHTML = `
        <style>
          .pk { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; padding:12px 0 16px; }
          .pk-title { font-size:15px; font-weight:600; color:var(--primary-text-color,#1a1a1a);
                      margin-bottom:6px; }
          .pk-sub { font-size:12px; color:var(--secondary-text-color,#888);
                    line-height:1.5; margin-bottom:14px; }
          .pk-list { display:flex; flex-direction:column; gap:8px; }
          .pk-btn { display:flex; align-items:center; gap:12px;
                    padding:14px 16px; border-radius:10px;
                    border:1px solid var(--divider-color,#d0d4de);
                    background:var(--card-background-color,#fff);
                    color:var(--primary-text-color,#1a1a1a);
                    font-family:inherit; font-size:14px; cursor:pointer;
                    text-align:left; transition:border-color .15s, background .15s; }
          .pk-btn:hover { border-color:var(--primary-color,#3b8aff);
                          background:color-mix(in srgb, var(--primary-color,#3b8aff) 6%, transparent); }
          .pk-ico { width:36px; height:36px; flex-shrink:0; border-radius:8px;
                    background:color-mix(in srgb, var(--primary-color,#3b8aff) 14%, transparent);
                    color:var(--primary-color,#3b8aff);
                    display:flex; align-items:center; justify-content:center; }
          .pk-ico svg { width:18px; height:18px; }
          .pk-text { flex:1; min-width:0; }
          .pk-name { font-weight:600; font-size:14px;
                     overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
          .pk-meta { font-size:11px; color:var(--secondary-text-color,#888);
                     margin-top:2px;
                     overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
          .pk-note { margin-top:14px; padding:10px 12px; border-radius:8px;
                     background:color-mix(in srgb, var(--primary-color,#3b8aff) 8%, transparent);
                     font-size:11px; color:var(--secondary-text-color,#666);
                     line-height:1.5; }
        </style>
        <div class="pk">
          <div class="pk-title">Which MHUB should this card control?</div>
          <div class="pk-sub">${entryIds.length} MHUBs detected on your network. Pick the one this card is for — once saved, this card will only control that hub. To control another hub, add a new card.</div>
          <div class="pk-list">
            ${entryIds.map(eid => {
              const nm   = names[eid] || ("MHUB " + eid.slice(0, 6));
              const cnt  = (counts[eid] || new Set()).size;
              return `<button class="pk-btn" data-entry="${x(eid)}">
                <div class="pk-ico">${I.logo}</div>
                <div class="pk-text">
                  <div class="pk-name">${x(nm)}</div>
                  <div class="pk-meta">${cnt} entities · ${x(eid.slice(0, 8))}…</div>
                </div>
              </button>`;
            }).join("")}
          </div>
          <div class="pk-note">💡 Tip: each card you add can control a different MHUB — the one you pick here is saved into the card and can't bleed across.</div>
        </div>`;

      this.querySelectorAll(".pk-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const c = Object.assign({}, this._cfg || {}, { entry_id: btn.dataset.entry });
          this._save(c);
          /* setConfig→_render will be called by HA after the config-changed event;
             that pass will see entry_id is set and skip the picker. */
        });
      });
    }

    /* Fetch entity + device registry so the editor can show accurate
       sequence/IR/CEC counts and so discoverMhub() returns the same
       data the main card sees. Without this the editor's sequence
       and IR counts always read 0 because button entities that have
       never been pressed don't appear in hass.states.

       Retried with exponential backoff if the WS call fails. */
    _fetchRegistry(attempt) {
      attempt = attempt || 1;
      if (!this._hass || this._regPending) return;
      this._regPending = true;
      Promise.all([
        this._hass.callWS({ type: "config/entity_registry/list" }),
        this._hass.callWS({ type: "config/device_registry/list" }),
      ]).then(([entityEntries, deviceEntries]) => {
        const deviceIdToInfo = {};
        (deviceEntries || []).forEach(d => {
          (d.identifiers || []).forEach(p => {
            if (p[0] === "mhub") {
              deviceIdToInfo[d.id] = {
                identifier: p[1],
                name:       d.name || "",
                model:      d.model || "",
                cfgEntries: d.config_entries || [],
              };
            }
          });
        });
        const seqEids = new Set(), irEids = new Set(), cecEids = new Set(), mhubEids = new Set();
        const entityDeviceNames = {};
        const entryEntsMap = {};   /* entry_id → Set<entity_id> */
        const entryNames   = {};   /* entry_id → human-friendly hub name (from hub-level device) */

        (entityEntries || []).filter(e => e.platform === "mhub").forEach(e => {
          mhubEids.add(e.entity_id);
          const info = deviceIdToInfo[e.device_id] || {};
          if (info.name) entityDeviceNames[e.entity_id] = info.name;

          /* Group by config entry: this is what makes per-card hub isolation possible */
          const eid = e.config_entry_id || (info.cfgEntries || [])[0] || null;
          if (eid) {
            if (!entryEntsMap[eid]) entryEntsMap[eid] = new Set();
            entryEntsMap[eid].add(e.entity_id);
            /* Hub-level device's identifier === entry_id; capture its name */
            if (info.identifier === eid && info.name && !entryNames[eid]) {
              entryNames[eid] = info.name;
            }
          }

          if (e.entity_id.split(".")[0] !== "button") return;
          const model = (info.model || "").toLowerCase();
          const name  = (info.name  || "").toLowerCase();
          const isIR  = model === "mhub source ir"
                     || model === "mhub display ir"
                     || name.startsWith("source - ")
                     || (name.includes(" - ") && !name.startsWith("cec - "));
          const isCEC = model === "mhub cec" || name.startsWith("cec - ");
          if (isIR)       irEids.add(e.entity_id);
          else if (isCEC) cecEids.add(e.entity_id);
          else            seqEids.add(e.entity_id);
        });

        /* Defensive: capture hub names even if a hub has zero entities yet */
        (deviceEntries || []).forEach(d => {
          (d.identifiers || []).forEach(p => {
            if (p[0] !== "mhub") return;
            (d.config_entries || []).forEach(eid => {
              if (!entryEntsMap[eid]) entryEntsMap[eid] = new Set();
              if (p[1] === eid && d.name && !entryNames[eid]) {
                entryNames[eid] = d.name;
              }
            });
          });
        });

        this._mhubEntityIds = mhubEids;
        this._mhubRegistry  = { seqEids, irEids, cecEids };
        this._deviceNames   = entityDeviceNames;
        this._entryEntsMap  = entryEntsMap;
        this._entryNames    = entryNames;

        /* Auto-fill entry_id when there's exactly one hub — preserves the
           zero-config experience for users with a single MHUB.
           This is fired BEFORE _render() so the UI never shows the picker
           in that case. */
        const entryIds = Object.keys(entryEntsMap);
        if (entryIds.length === 1 && !this._cfg.entry_id) {
          const onlyId = entryIds[0];
          const c = Object.assign({}, this._cfg || {}, { entry_id: onlyId });
          this._save(c);   /* dispatches config-changed; HA will call setConfig back */
        }

        this._render();
      }).catch(() => {
        /* Retry up to 5 times with exponential backoff */
        if (attempt < 5) {
          const delay = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
          setTimeout(() => { if (this._hass) this._fetchRegistry(attempt + 1); }, delay);
        }
      }).finally(() => { this._regPending = false; });
    }

    _render() {
      /* Don't rebuild while the user is actively typing — HA calls setConfig →
         _render on every config-changed event which destroys any focused input. */
      if (this.querySelector("input:focus, select:focus, textarea:focus")) return;

      const cfg = this._cfg || {};

      /* HUB PICKER STEP ────────────────────────────────────────
         When 2+ MHUBs are on the network and this card hasn't been bound to
         one yet, the editor shows ONLY the hub picker. The user picks a hub,
         that selection is saved to cfg.entry_id, and from that point on the
         card is dedicated to that hub. To control a different hub the user
         creates a new card. This is by design: per-room cards stay isolated
         and a card never accidentally controls the wrong physical unit.

         Single-hub installs auto-fill cfg.entry_id in _fetchRegistry() and
         skip this step entirely — preserving the zero-config experience. */
      const entryIds = this._entryEntsMap ? Object.keys(this._entryEntsMap) : [];
      if (this._hass && entryIds.length >= 2 && !cfg.entry_id) {
        this._renderHubPicker(entryIds);
        return;
      }

      /* Editor preview: filter discovery to the bound entry's entities so the
         counts and lists shown below reflect exactly what the saved card will
         render. */
      const entryEnts = (cfg.entry_id && this._entryEntsMap)
        ? (this._entryEntsMap[cfg.entry_id] || null)
        : null;
      const disc  = this._hass
        ? discoverMhub(this._hass, cfg.entry_id, this._mhubEntityIds, this._mhubRegistry, this._deviceNames || {}, entryEnts)
        : null;
      const found = disc && disc.found;

      /* Rooms offered by the "lock to room" picker, respecting the user's
         own aliases and hidden-output choices. */
      const zoneOpts = ((disc && disc.zones) || [])
        .filter(z => !(cfg.hidden_zones || []).includes(z.output))
        .map(z => ({ output: z.output, label: x((cfg.zone_aliases || {})[z.output] || z.label) }));

      const lockedHubName = (cfg.entry_id && this._entryNames)
        ? (this._entryNames[cfg.entry_id] || null)
        : null;

      /* Collect all unique source names across all zones */
      const sourceNames = [];
      if (disc) {
        const seen = new Set();
        disc.zones.forEach(z => {
          const sl = this._hass.states[z.media_player]?.attributes?.source_list || z.sources.map(s=>s.name);
          sl.forEach(n => { if (!seen.has(n)) { seen.add(n); sourceNames.push(n); } });
        });
      }

      const inputIcons = cfg.input_icons || {};

      this.innerHTML = `
        <style>
          .ed { font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; padding:8px 0 16px; }
          .sec { font-size:11px; font-weight:600; letter-spacing:.06em; text-transform:uppercase;
                 color:var(--secondary-text-color,#888); margin:16px 0 8px; padding-bottom:6px;
                 border-bottom:1px solid var(--divider-color,#e0e0e0); }
          .row { display:flex; justify-content:space-between; padding:4px 0; font-size:13px; }
          .rk  { color:var(--secondary-text-color,#888); }
          .rv  { color:var(--primary-text-color,#333); font-weight:500; }
          .ok  { color:#0f6e56; } .warn { color:#854f0b; }
          .field { margin-bottom:10px; }
          .field label { display:block; font-size:12px; color:var(--secondary-text-color,#888); margin-bottom:4px; }
          .field input { width:100%; padding:8px 10px; border-radius:6px;
                         border:1px solid var(--divider-color,#ccc);
                         background:var(--card-background-color,#fff);
                         color:var(--primary-text-color,#333); font-size:14px; font-family:inherit; }

          /* Input icon editor */
          .irow { display:flex; flex-wrap:wrap; align-items:center; gap:8px; padding:9px 0;
                  border-bottom:1px solid var(--divider-color,rgba(0,0,0,.06)); }
          .irow:last-child { border-bottom:none; }
          .ipreview { width:40px; height:40px; border-radius:8px; flex-shrink:0;
                      display:flex; align-items:center; justify-content:center;
                      font-size:11px; font-weight:800; overflow:hidden;
                      border:1px solid var(--divider-color,rgba(0,0,0,.12)); }
          .ipreview img { width:100%; height:100%; object-fit:cover; border-radius:7px; }
          .iname { font-size:11px; color:var(--secondary-text-color,#888); white-space:nowrap;
                   overflow:hidden; text-overflow:ellipsis; max-width:90px; flex-shrink:0; }
          .irename { flex:1; min-width:90px; padding:5px 8px; border-radius:6px;
                     border:1px solid var(--divider-color,#ccc);
                     background:var(--card-background-color,#fff);
                     color:var(--primary-text-color,#333); font-size:13px; font-family:inherit; }
          .irename:focus { outline:none; border-color:var(--primary-color,#3b8aff); }
          .ibtn  { padding:4px 10px; border-radius:6px; border:1px solid var(--divider-color,#ccc);
                   background:transparent; color:var(--primary-text-color,#555);
                   font-size:12px; cursor:pointer; font-family:inherit; white-space:nowrap; }
          .ibtn:hover { border-color:var(--primary-color,#3b8aff); color:var(--primary-color,#3b8aff); }
          .ibtn.clr { color:#c0392b; border-color:#c0392b; }
          .ibtn.clr:hover { background:#fdf0ef; }
          .ifile { display:none; }
          .uploading { font-size:11px; color:var(--secondary-text-color,#888); }

          /* Design picker */
          .dzrow { display:flex; gap:8px; margin-bottom:4px; }
          .dzopt { flex:1; padding:8px 6px; border-radius:10px;
                   border:1px solid var(--divider-color,#ccc);
                   background:transparent; cursor:pointer; font-family:inherit;
                   display:flex; flex-direction:column; align-items:center; gap:6px;
                   color:var(--primary-text-color,#333); }
          .dzopt.on { border-color:var(--primary-color,#3b8aff);
                      background:color-mix(in srgb, var(--primary-color,#3b8aff) 8%, transparent); }
          .dzprev { width:100%; height:34px; border-radius:7px; display:block; }
          .dzprev.p-classic { background:linear-gradient(180deg,#1c1f26 55%,#12151c 55%); border:1px solid #2a3040; }
          .dzprev.p-glass   { background:radial-gradient(circle at 50% 0%, rgba(138,58,110,.7), #07080d 72%); border:1px solid #1b1e2a; }
          .dzprev.p-remote  { background:linear-gradient(180deg,#23262e,#15171d); border:1px solid #3a3e4a; border-radius:14px; }
          .dzname { font-size:12px; font-weight:600; text-transform:capitalize; }
          .dzhint { font-size:11px; color:var(--secondary-text-color,#888); margin-top:6px; line-height:1.5; }
          .dzgrid { display:grid; grid-template-columns:repeat(3,1fr); gap:8px; margin-bottom:4px; }
          .dzprev.p-strip  { background:repeating-linear-gradient(180deg,#1c1f26 0 8px,#12151c 8px 9px); border:1px solid #2a3040; }
          .dzprev.p-panel  { background:#0e1016; border:1px solid #232833;
                             background-image:linear-gradient(90deg,#8a3a6e 48%,transparent 48%),linear-gradient(90deg,transparent 52%,#0a63c9 52%);
                             background-size:100% 46%; background-position:0 12%,0 62%; background-repeat:no-repeat; }
          .dzprev.p-poster { background:#0b0d12; border:1px solid #1f2430;
                             background-image:linear-gradient(#a84a86,#a84a86),linear-gradient(#0a63c9,#0a63c9),linear-gradient(#2fa878,#2fa878);
                             background-size:28% 74%; background-repeat:no-repeat;
                             background-position:8% 50%,50% 50%,92% 50%; }
          /* Colour picker */
          .cgrid { display:flex; flex-wrap:wrap; gap:8px; align-items:center; }
          .cdot { width:30px; height:30px; border-radius:50%; cursor:pointer; padding:0;
                  border:2px solid transparent; position:relative; }
          .cdot.on { border-color:var(--primary-text-color,#333); }
          .cdot.theme { background:conic-gradient(#3b8aff,#22d47a,#ff8c42,#ff4d6d,#a855f7,#3b8aff); }
          .cdot .cx { position:absolute; inset:0; display:flex; align-items:center; justify-content:center;
                      font-size:13px; color:#fff; text-shadow:0 1px 2px rgba(0,0,0,.5); }
          .cnative { width:34px; height:30px; padding:0; border:1px solid var(--divider-color,#ccc);
                     border-radius:8px; background:none; cursor:pointer; }
          .crow { display:flex; align-items:center; gap:10px; margin-bottom:6px; }
          .clbl { font-size:12px; min-width:74px; color:var(--primary-text-color,#333); }
          .cclear { font-size:11px; background:none; border:none; cursor:pointer;
                    color:var(--primary-color,#3b8aff); padding:2px 4px; }
        </style>
        <div class="ed">
          <div class="sec">Card design</div>
          <div class="dzgrid">
            ${["classic","glass","remote","strip","panel","poster"].map(dz => `
              <button class="dzopt${(cfg.design||"classic")===dz?" on":""}" data-dz="${dz}">
                <span class="dzprev p-${dz}"></span>
                <span class="dzname">${dz}</span>
              </button>`).join("")}
          </div>
          <div class="dzhint">
            <b>Classic</b> — original tabbed layout ·
            <b>Glass</b> — ambient Apple-TV look ·
            <b>Remote</b> — handset with D-pad ·
            <b>Strip</b> — every room in one list ·
            <b>Panel</b> — big-button kiosk for wall tablets ·
            <b>Poster</b> — artwork tiles.
            Every feature works in all six.
          </div>

          <div class="sec">Colours</div>
          <div class="crow">
            <span class="clbl">Accent</span>
            <div class="cgrid">
              ${ACCENTS.map(a => a.hex === null
                ? `<button class="cdot theme${!cfg.accent?" on":""}" data-accent="" title="Follow theme"></button>`
                : `<button class="cdot${cfg.accent===a.hex?" on":""}" data-accent="${a.hex}" style="background:${a.hex}" title="${a.name}"></button>`
              ).join("")}
              <input class="cnative" type="color" id="accpick" value="${safeHex(cfg.accent)||"#3b8aff"}" title="Custom accent">
            </div>
          </div>
          <div class="crow">
            <span class="clbl">Background</span>
            <input class="cnative" type="color" id="bgpick" value="${safeHex(cfg.card_bg)||"#1c1f26"}" title="Card background">
            ${cfg.card_bg?`<button class="cclear" id="bgclear">Reset to theme</button>`:`<span class="dzhint" style="margin:0">Following theme</span>`}
          </div>
          <div class="crow">
            <span class="clbl">Corners</span>
            <input type="range" id="radpick" min="0" max="32" step="2" value="${parseInt(cfg.radius,10)>=0?parseInt(cfg.radius,10):16}" style="flex:1">
            <span class="dzhint" style="margin:0;min-width:34px">${parseInt(cfg.radius,10)>=0?parseInt(cfg.radius,10)+"px":"auto"}</span>
            ${cfg.radius!==undefined?`<button class="cclear" id="radclear">Reset</button>`:""}
          </div>

          ${["panel","poster"].includes(cfg.design) ? `
            <div class="sec">${cfg.design==="panel"?"Panel":"Poster"} options</div>
            <div class="crow">
              <span class="clbl">Lock to room</span>
              <select id="lockzone" style="flex:1;padding:7px;border-radius:8px;border:1px solid var(--divider-color,#ccc);background:transparent;color:var(--primary-text-color,#333);font-family:inherit;">
                <option value=""${!cfg.lock_zone?" selected":""}>All rooms (user can switch)</option>
                ${zoneOpts.map(z => `<option value="${z.output}"${String(cfg.lock_zone)===String(z.output)?" selected":""}>${z.label}</option>`).join("")}
              </select>
            </div>
            ${cfg.design==="poster" ? `
              <div class="crow">
                <span class="clbl">Columns</span>
                <input type="range" id="pocols" min="2" max="6" step="1" value="${parseInt(cfg.poster_columns,10)||3}" style="flex:1">
                <span class="dzhint" style="margin:0;min-width:14px">${parseInt(cfg.poster_columns,10)||3}</span>
              </div>` : `
              <label class="row" style="margin-top:2px"><input type="checkbox" id="showtabs" ${cfg.show_tabs?"checked":""}> <span>Show tab bar (Volume / Scenes / Remote / Info)</span></label>
              <div class="dzhint">Off by default — a kiosk panel usually wants one screen only.</div>`}
          ` : ""}

          ${(lockedHubName && entryIds.length >= 2) ? `
          <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:8px;
                      background:color-mix(in srgb, var(--primary-color,#3b8aff) 10%, transparent);
                      border:1px solid color-mix(in srgb, var(--primary-color,#3b8aff) 35%, transparent);
                      margin-bottom:14px">
            <div style="width:32px;height:32px;border-radius:8px;flex-shrink:0;
                        background:color-mix(in srgb, var(--primary-color,#3b8aff) 20%, transparent);
                        color:var(--primary-color,#3b8aff);
                        display:flex;align-items:center;justify-content:center">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-size:11px;font-weight:600;letter-spacing:.05em;text-transform:uppercase;color:var(--secondary-text-color,#666)">Bound to MHUB</div>
              <div style="font-size:14px;font-weight:600;color:var(--primary-text-color,#1a1a1a);margin-top:2px;
                          overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${x(lockedHubName)}</div>
            </div>
            <button id="ov-unbind" style="font-size:11px;padding:5px 10px;border-radius:6px;
                        border:1px solid var(--divider-color,#d0d4de);
                        background:transparent;color:var(--secondary-text-color,#666);
                        cursor:pointer;font-family:inherit;flex-shrink:0">Change…</button>
          </div>
          ` : ""}
          <div class="sec">Auto-discovery status</div>
          <div class="row"><span class="rk">MHUB detected</span>
            <span class="rv ${found?"ok":"warn"}">${found?"✓ Yes":"✗ Not found"}</span></div>
          ${found ? `
          <div class="row"><span class="rk">Outputs found</span><span class="rv">${disc.zones.length}</span></div>
          <div class="row"><span class="rk">Zones</span><span class="rv">${disc.zones.map(z=>z.label).join(", ")||"—"}</span></div>
          <div class="row"><span class="rk">Groups</span><span class="rv">${disc.groups.length||"0"}</span></div>
          <div class="row"><span class="rk">Sequences</span><span class="rv">${disc.sequences.length||"0"}</span></div>
          <div class="row"><span class="rk">IR devices</span><span class="rv">${disc.ir_devices.length||"0"}</span></div>
          ` : `<p style="font-size:13px;color:#888;margin-top:8px;line-height:1.5">
            Make sure the MHUB integration is installed and your hub is connected.</p>`}

          ${sourceNames.length ? `
          <div class="sec">Inputs — names, icons &amp; visibility</div>
          <p style="font-size:12px;color:var(--secondary-text-color,#888);margin-bottom:10px;line-height:1.5">
            Rename inputs (leave blank to use the name from MHUB), upload a custom image, or hide unused ones.
          </p>
          ${sourceNames.map(name => {
            const icon      = inputIcons[name];
            const alias     = (cfg.input_aliases || {})[name] || "";
            const hidden    = (cfg.hidden_inputs || []).includes(name);
            const b         = brand(name);
            const previewSrc = extractIconUrl(icon);
            const previewHtml = previewSrc
              ? `<img src="${x(previewSrc)}" alt="">`
              : `<span style="background:${b.bg};color:${b.fg};width:100%;height:100%;display:flex;align-items:center;justify-content:center;border-radius:7px;opacity:${hidden?0.35:1}">${x(b.t)}</span>`;
            return `<div class="irow" data-src="${x(name)}" style="opacity:${hidden?0.5:1}">
              <div class="ipreview">${previewHtml}</div>
              <span class="iname" title="${x(name)}">${x(name)}</span>
              <input type="text" class="irename" data-src="${x(name)}"
                     value="${x(alias)}" placeholder="${x(name)}">
              <input type="file" class="ifile" accept="image/*">
              <button class="ibtn upl-btn"${hidden?" disabled":""}>Image</button>
              ${icon ? `<button class="ibtn clr clr-btn">Clear</button>` : ""}
              <button class="ibtn hide-btn${hidden?" hide-on":""}" style="${hidden?"color:#3b8aff;border-color:#3b8aff":""}">${hidden?"Show":"Hide"}</button>
            </div>`;
          }).join("")}
          ` : ""}

          ${found && disc.zones.length ? `
          <div class="sec">Outputs — names &amp; visibility</div>
          <p style="font-size:12px;color:var(--secondary-text-color,#888);margin-bottom:10px;line-height:1.5">
            Rename outputs (leave blank to use the name from MHUB), or hide outputs so they don't appear in the zone dropdown — useful for restricting which TVs a room can switch.
          </p>
          ${disc.zones.map(z => {
            const alias = (cfg.zone_aliases||{})[z.output] || "";
            const zHidden = (cfg.hidden_zones || []).includes(z.output);
            return `<div class="field" data-zone-output="${x(z.output)}" style="opacity:${zHidden?0.55:1}">
              <label>Output ${x(z.output)} · ${x(z.label)}${zHidden?" — hidden":""}</label>
              <div style="display:flex;gap:6px;align-items:center">
                <input type="text" class="zone-alias" data-output="${x(z.output)}"
                       value="${x(alias)}" placeholder="${x(z.label)}" style="flex:1">
                <button class="ibtn zone-hide-btn" data-output="${x(z.output)}"
                        style="${zHidden?"color:#3b8aff;border-color:#3b8aff":""}">${zHidden?"Show":"Hide"}</button>
              </div>
            </div>`;
          }).join("")}
          ` : ""}

          <div class="sec">Optional overrides</div>
          <div class="field">
            <label>Card title (leave blank for auto)</label>
            <input type="text" id="ov-title" value="${(cfg.title||"")}" placeholder="Auto-detected from your hub">
          </div>
        </div>`;

      /* ── Design picker listeners ── */
      this.querySelectorAll(".dzopt").forEach(btn => {
        btn.addEventListener("click", () => {
          const c = Object.assign({}, this._cfg || {});
          const dz = btn.dataset.dz;
          if (dz === "classic") delete c.design; else c.design = dz;
          /* Drop options that only apply to the design being left, so
             the saved YAML never carries dead keys. */
          if (!["panel","poster"].includes(dz)) delete c.lock_zone;
          if (dz !== "poster") delete c.poster_columns;
          if (dz !== "panel")  delete c.show_tabs;
          this._save(c);
          this._render();
        });
      });

      /* ── Colour + per-design option listeners ── */
      const patch = (fn) => {
        const c = Object.assign({}, this._cfg || {});
        fn(c);
        this._save(c);
        this._render();
      };

      this.querySelectorAll("[data-accent]").forEach(btn => {
        btn.addEventListener("click", () => patch(c => {
          const v = safeHex(btn.dataset.accent);
          if (v) c.accent = v; else delete c.accent;
        }));
      });
      const accPick = this.querySelector("#accpick");
      if (accPick) accPick.addEventListener("change", () =>
        patch(c => { const v = safeHex(accPick.value); if (v) c.accent = v; }));

      const bgPick = this.querySelector("#bgpick");
      if (bgPick) bgPick.addEventListener("change", () =>
        patch(c => { const v = safeHex(bgPick.value); if (v) c.card_bg = v; }));
      const bgClear = this.querySelector("#bgclear");
      if (bgClear) bgClear.addEventListener("click", () => patch(c => { delete c.card_bg; }));

      const radPick = this.querySelector("#radpick");
      if (radPick) radPick.addEventListener("change", () =>
        patch(c => { c.radius = parseInt(radPick.value, 10); }));
      const radClear = this.querySelector("#radclear");
      if (radClear) radClear.addEventListener("click", () => patch(c => { delete c.radius; }));

      const lockZone = this.querySelector("#lockzone");
      if (lockZone) lockZone.addEventListener("change", () =>
        patch(c => { if (lockZone.value) c.lock_zone = lockZone.value; else delete c.lock_zone; }));

      const poCols = this.querySelector("#pocols");
      if (poCols) poCols.addEventListener("change", () =>
        patch(c => { c.poster_columns = parseInt(poCols.value, 10); }));

      const showTabs = this.querySelector("#showtabs");
      if (showTabs) showTabs.addEventListener("change", () =>
        patch(c => { if (showTabs.checked) c.show_tabs = true; else delete c.show_tabs; }));

      /* ── Zone alias listeners ── */
      this.querySelectorAll(".zone-alias").forEach(el => {
        el.addEventListener("blur", () => {
          const c = Object.assign({}, this._cfg||{});
          const aliases = Object.assign({}, c.zone_aliases||{});
          const val = el.value.trim();
          if (val) aliases[el.dataset.output] = val;
          else delete aliases[el.dataset.output];
          if (!Object.keys(aliases).length) delete c.zone_aliases;
          else c.zone_aliases = aliases;
          this._save(c);
        });
      });

      /* ── Zone hide/show listeners ── */
      this.querySelectorAll(".zone-hide-btn").forEach(btn => {
        btn.addEventListener("click", () => {
          const c = Object.assign({}, this._cfg||{});
          const output = btn.dataset.output;
          const hidden = (c.hidden_zones || []).slice();
          const idx = hidden.indexOf(output);
          if (idx === -1) hidden.push(output);
          else hidden.splice(idx, 1);
          if (hidden.length) c.hidden_zones = hidden;
          else delete c.hidden_zones;
          this._save(c);
          this._render();
        });
      });

      /* ── Text field listeners ── */
      const titleEl = this.querySelector("#ov-title");
      if (titleEl) titleEl.addEventListener("blur", () => {
        const c = Object.assign({}, this._cfg || {});
        c.title = titleEl.value.trim() || undefined;
        if (!c.title) delete c.title;
        this._save(c);
      });

      /* ── "Change…" button on the bound-hub banner ──
         Clears entry_id so the next render shows the hub picker again.
         Only present when 2+ hubs exist. */
      const unbind = this.querySelector("#ov-unbind");
      if (unbind) unbind.addEventListener("click", () => {
        const c = Object.assign({}, this._cfg || {});
        delete c.entry_id;
        this._save(c);
        this._render();
      });

      /* ── Icon row listeners ── */
      this.querySelectorAll(".irow").forEach(row => {
        const srcName = row.dataset.src;
        const fileInput = row.querySelector(".ifile");
        const uplBtn    = row.querySelector(".upl-btn");
        const clrBtn    = row.querySelector(".clr-btn");

        /* Rename field — save alias on blur */
        const renameEl = row.querySelector(".irename");
        if (renameEl) renameEl.addEventListener("blur", () => {
          const c = Object.assign({}, this._cfg||{});
          const aliases = Object.assign({}, c.input_aliases||{});
          const val = renameEl.value.trim();
          if (val && val !== srcName) aliases[srcName] = val;
          else delete aliases[srcName];
          if (!Object.keys(aliases).length) delete c.input_aliases;
          else c.input_aliases = aliases;
          this._save(c);
        });

        /* "Choose image" opens the hidden file input */
        if (uplBtn) uplBtn.addEventListener("click", () => fileInput.click());

        /* File selected — upload to HA Image registry (server-side, all devices see it) */
        if (fileInput) fileInput.addEventListener("change", async () => {
          const file = fileInput.files[0];
          if (!file) return;

          uplBtn.textContent = "Uploading…";
          uplBtn.disabled = true;

          try {
            const token = this._hass.auth.data.access_token;

            /* ── Step 1: Create an image entity via the HA Image upload API.
                  POST /api/image/upload  (available in all HA installs since 2023.6)
                  Returns { id, content_type, ... }
                  The resulting URL /api/image/serve/{id}/512x512 is:
                    • stored server-side — survives reboots
                    • accessible from any device (phone, tablet, remote access)
                    • served through the same HA auth as the rest of the UI       */
            const fd = new FormData();
            fd.append("file", file, file.name);

            const resp = await fetch("/api/image/upload", {
              method: "POST",
              headers: { Authorization: `Bearer ${token}` },
              body: fd,
            });

            if (!resp.ok) throw new Error(`HA image upload failed: ${resp.status}`);

            const data = await resp.json();
            /* data.id is the stable image entity ID, e.g. "abc123def456" */
            const iconUrl = `/api/image/serve/${data.id}/512x512`;

            /* ── Step 2: If there was a previous image for this input,
                  delete the old HA image entity to avoid orphans. */
            const prevRaw = (this._cfg.input_icons || {})[srcName];
            if (prevRaw && typeof prevRaw === "string") {
              const prevId = prevRaw.match(/\/api\/image\/serve\/([^/]+)\//)?.[1];
              if (prevId) {
                fetch(`/api/image/${prevId}`, {
                  method: "DELETE",
                  headers: { Authorization: `Bearer ${token}` },
                }).catch(() => {});   /* best-effort, don't block */
              }
              /* Also clean up any legacy localStorage token */
              if (prevRaw.startsWith("mhub_icon_")) {
                try { localStorage.removeItem(prevRaw); } catch(_) {}
              }
            }

            const c = Object.assign({}, this._cfg||{});
            c.input_icons = Object.assign({}, c.input_icons||{}, { [srcName]: iconUrl });
            this._save(c);
            this._render();   /* refresh preview */
          } catch(err) {
            uplBtn.textContent = "Image";
            uplBtn.disabled = false;
            console.error("MHUB icon upload failed:", err);
            /* Show a brief error message in the button */
            uplBtn.textContent = "Upload failed";
            setTimeout(() => { uplBtn.textContent = "Image"; }, 3000);
          }
        });

        /* "Hide / Show" toggles the input's visibility on the card */
        const hideBtn = row.querySelector(".hide-btn");
        if (hideBtn) hideBtn.addEventListener("click", () => {
          const c = Object.assign({}, this._cfg||{});
          const hidden = (c.hidden_inputs || []).slice();
          const idx = hidden.indexOf(srcName);
          if (idx === -1) hidden.push(srcName);
          else hidden.splice(idx, 1);
          if (hidden.length) c.hidden_inputs = hidden;
          else delete c.hidden_inputs;
          this._save(c);
          this._render();
        });
        if (clrBtn) clrBtn.addEventListener("click", () => {
          const c = Object.assign({}, this._cfg||{});
          const icons = Object.assign({}, c.input_icons||{});
          const raw = icons[srcName];
          if (raw && typeof raw === "string") {
            /* Delete the HA image entity if it was uploaded via Image API */
            const imgId = raw.match(/\/api\/image\/serve\/([^/]+)\//)?.[1];
            if (imgId) {
              const tok = this._hass.auth.data.access_token;
              fetch(`/api/image/${imgId}`, {
                method: "DELETE",
                headers: { Authorization: `Bearer ${tok}` },
              }).catch(() => {});
            }
            /* Clean up legacy localStorage token */
            if (raw.startsWith("mhub_icon_")) {
              try { localStorage.removeItem(raw); } catch(_) {}
            }
          }
          delete icons[srcName];
          if (!Object.keys(icons).length) delete c.input_icons;
          else c.input_icons = icons;
          this._save(c);
          this._render();
        });
      });
    }
  }

  customElements.define("mhub-card-editor", MhubCardEditor);

  /* ═══════════════════════════════════════════════════════════
     MAIN CARD
  ═══════════════════════════════════════════════════════════ */
  class MhubCard extends HTMLElement {
    constructor() {
      super();
      this._sh     = this.attachShadow({ mode:"open" });
      this._cfg    = {};
      this._hass   = null;
      this._disc   = null;   /* discovered config */
      this._page   = "switch";
      this._zone   = 0;
      this._ready  = false;
      this._drag   = {};     /* slider drag state */
      this._entryEntsMap = {};   /* entry_id → Set<entity_id> (from registry) */
    }

    static getConfigElement() { return document.createElement("mhub-card-editor"); }
    static getStubConfig()    { return { title: "" }; }

    setConfig(cfg) {
      const prev = this._cfg;
      this._cfg = cfg || {};
      /* Only do a full rebuild (which resets the card and re-fetches the registry)
         if this is the first load or the selected design changed. For other
         config-changed events fired by the editor (e.g. toggling a source icon
         or alias), just re-render the current page so the nav tabs and user's
         position in the card are preserved. */
      const designChanged = prev && (
        (prev.design || "classic") !== (this._cfg.design || "classic") ||
        !!prev.show_tabs !== !!this._cfg.show_tabs ||
        (prev.lock_zone || "") !== (this._cfg.lock_zone || "") ||
        (prev.poster_columns || "") !== (this._cfg.poster_columns || "")
      );
      /* Colour changes are pure CSS — repaint without a rebuild so the
         editor preview updates instantly and keeps its scroll position. */
      if (this._ready) {
        const card = this._sh && this._sh.querySelector(".card");
        if (card) card.setAttribute("style", this._themeStyle());
      }
      if (!this._ready) {
        if (this._hass) this._init();
      } else if (designChanged) {
        this._ready = false;
        if (this._hass) this._init();
      } else {
        this._live();
      }
    }

    set hass(h) {
      this._hass = h;
      if (!this._ready) this._init();
      else              this._live();
    }

    getCardSize() { return 6; }

    /* ─ helpers ─────────────────────────────────────────────── */
    _sv(id,fb) { return (id&&this._hass&&this._hass.states[id]) ? this._hass.states[id].state : (fb!==undefined?fb:""); }
    _attr(id,k,fb) { if (!id||!this._hass||!this._hass.states[id]) return fb; const v=this._hass.states[id].attributes[k]; return v!==undefined?v:fb; }
    _call(d,s,data) { if (this._hass) this._hass.callService(d,s,data); }
    _el(id) { return this._sh.getElementById(id); }

    /* Inline CSS custom properties for the user's colour choices.
       Values are validated as hex before they reach the DOM, and an
       unset option simply falls through to the HA theme as before. */
    _themeStyle() {
      const out = [];
      const accent = safeHex(this._cfg.accent);
      if (accent) {
        out.push("--mh-accent:" + accent);
        out.push("--mh-accent-bg:" + accent);
        out.push("--mh-accent-fg:" + readableOn(accent));
      }
      const bg = safeHex(this._cfg.card_bg);
      if (bg) out.push("--mh-bg:" + bg);
      const radius = parseInt(this._cfg.radius, 10);
      if (!isNaN(radius) && radius >= 0 && radius <= 48) out.push("--mh-radius:" + radius + "px");
      return out.join(";");
    }

    /* Selected card design — validated, defaults to classic */
    _design() { return DESIGNS.includes(this._cfg.design) ? this._cfg.design : "classic"; }

    /* Return the icon HTML for a source name.
       If a custom image is configured, renders an <img>.
       Otherwise falls back to the colour badge. */
    /* Extract the actual image URL from whatever format is stored in config.
       Delegates to the module-level helper so the editor and main card
       resolve URLs identically and apply the same scheme whitelist. */
    _extractUrl(raw) { return extractIconUrl(raw); }

    /* Return display name for a zone — alias from config if set, else MHUB label */
    _zoneName(zone) {
      const aliases = this._cfg.zone_aliases || {};
      return aliases[zone.output] || zone.label || ("Output " + zone.output);
    }

    /* Return display name for an input — alias from config if set, else original MHUB name */
    _inputName(name) {
      if (!name) return name;
      return (this._cfg.input_aliases || {})[name] || name;
    }

    _srcIcon(name, cls) {
      const raw = (this._cfg.input_icons || {})[name];
      const url = this._extractUrl(raw);
      cls = cls || "sico";
      if (url) {
        return `<div class="${cls}" style="background:var(--mh-surface-2)"><img src="${x(url)}" alt=""></div>`;
      }
      const b = brand(name);
      return `<div class="${cls}" style="background:${b.bg};color:${b.fg}">${b.t}</div>`;
    }

    /* Same but for the "now showing" 56×56 hero badge */
    _nowIcon(name) {
      const raw = (this._cfg.input_icons || {})[name];
      const url = this._extractUrl(raw);
      if (url) {
        return `<div class="now-ico" style="background:rgba(255,255,255,.18)"><img src="${x(url)}" alt=""></div>`;
      }
      const b = brand(name||"?");
      return `<div class="now-ico" style="background:rgba(255,255,255,.18);color:#fff">${b.t}</div>`;
    }

    /* For the idle (no source) state — uses surface colours from theme */
    _nowIconIdle() {
      return `<div class="now-ico">—</div>`;
    }

    /* ─ build ───────────────────────────────────────────────── */
    _init() {
      if (!this._hass) return;
      if (this._initPending) return;   /* prevent concurrent inits */
      this._initPending = true;
      /* Preserve the current page so a config-changed rebuild doesn't jump back to "switch" */
      const savedPage = this._page || "switch";
      this._buildCard(new Set()).catch(() => {});
      this._page = savedPage;
      /* Re-apply the saved page so nav highlight and content are correct after rebuild */
      this._sh.querySelectorAll(".nb").forEach(n => n.classList.toggle("on", n.dataset.p === savedPage));
      this._sh.querySelectorAll(".pg").forEach(p => p.classList.toggle("on", p.id === "pg-" + savedPage));

      /* Fetch entity + device registry to reliably split sequences vs IR vs source buttons.
         Device identifiers from button.py:
           sequences  → hub device:  (DOMAIN, entry_id)
           IR buttons → (DOMAIN, {entry_id}_display_{device_key}) or (DOMAIN, {entry_id}_source_{device_key})
           CEC        → (DOMAIN, {entry_id}_cec_{zone_id})
           source btns→ (DOMAIN, {entry_id}_{zone_id})  (zone devices)
         Retried automatically if the WS call fails (e.g. when accessed off-network). */
      const _fetchRegistry = (attempt) => {
        attempt = attempt || 1;
        Promise.all([
          this._hass.callWS({ type: "config/entity_registry/list" }),
          this._hass.callWS({ type: "config/device_registry/list" }),
        ]).then(([entityEntries, deviceEntries]) => {
          /* Build map: device_id → { identifier, name, model, cfgEntries } */
          const deviceIdToInfo = {};
          (deviceEntries || []).forEach(function(d) {
            (d.identifiers || []).forEach(function(pair) {
              if (pair[0] === "mhub") {
                deviceIdToInfo[d.id] = {
                  identifier: pair[1],
                  name:       d.name || "",
                  model:      d.model || "",
                  cfgEntries: d.config_entries || [],
                };
              }
            });
          });

          /* Classify each mhub button by the device name.
             button.py sets device_name explicitly:
               IR source  → "Source - {pack_name}"
               IR display → "{zone} (Output X) - {pack_name}" or "Display - {pack_name}"
               CEC        → "CEC - {zone_label}"
               zone btns  → zone_label only (no prefix)
             So: name starts with "Source - " or contains " - " and has no zone-only match → IR */
          const seqEids  = new Set();
          const irEids   = new Set();
          const cecEids  = new Set();
          const mhubEids = new Set();
          /* Per-entry entity map — drives the multi-hub filter. */
          const entryEntsMap = {};

          /* Build set of pure zone labels for exclusion */
          const zoneNames = new Set(
            (deviceEntries || [])
              .filter(function(d){ return (d.identifiers||[]).some(function(p){ return p[0]==="mhub"; }); })
              .map(function(d){ return (d.name||"").toLowerCase(); })
          );

          (entityEntries || []).filter(function(e){ return e.platform === "mhub"; }).forEach(function(e) {
            mhubEids.add(e.entity_id);

            /* Track entity → config_entry_id binding so multi-hub setups can be split */
            const info  = deviceIdToInfo[e.device_id] || {};
            const eid   = e.config_entry_id || (info.cfgEntries || [])[0] || null;
            if (eid) {
              if (!entryEntsMap[eid]) entryEntsMap[eid] = new Set();
              entryEntsMap[eid].add(e.entity_id);
            }

            const domain = e.entity_id.split(".")[0];
            if (domain !== "button") return;
            const model = (info.model || "").toLowerCase();
            const name  = (info.name  || "").toLowerCase();
            const isIR  = model === "mhub source ir"
                       || model === "mhub display ir"
                       || name.startsWith("source - ")
                       || (name.includes(" - ") && !name.startsWith("cec - "));
            const isCEC = model === "mhub cec" || name.startsWith("cec - ");
            if (isIR)       irEids.add(e.entity_id);
            else if (isCEC) cecEids.add(e.entity_id);
            else            seqEids.add(e.entity_id);
          });

          /* Build map: entity_id → device name (for IR grouping labels) */
          const entityDeviceNames = {};
          (entityEntries || []).filter(function(e){ return e.platform === "mhub"; }).forEach(function(e) {
            const info = deviceIdToInfo[e.device_id];
            if (info && info.name) entityDeviceNames[e.entity_id] = info.name;
          });

          this._mhubEntityIds   = mhubEids;
          this._mhubRegistry    = { seqEids, irEids, cecEids };
          this._deviceNames     = entityDeviceNames;
          this._entryEntsMap    = entryEntsMap;

          /* Per-card hub isolation: when cfg.entry_id is set (saved by the
             editor), restrict every discovery lookup to that entry's
             entities. With a single hub or no entry_id, behaves as before. */
          const entryEnts = this._cfg.entry_id ? (entryEntsMap[this._cfg.entry_id] || null) : null;
          this._disc = discoverMhub(this._hass, this._cfg.entry_id, mhubEids, { seqEids, irEids, cecEids }, entityDeviceNames, entryEnts);
          /* Restore the page the user was on before the registry fetch completed */
          this._page = savedPage;
          this._sh.querySelectorAll(".nb").forEach(n => n.classList.toggle("on", n.dataset.p === savedPage));
          this._sh.querySelectorAll(".pg").forEach(p => p.classList.toggle("on", p.id === "pg-" + savedPage));
          this._live();
        })
        .catch(() => {
          /* Registry unavailable (e.g. off-network, WS timeout).
             Retry up to 5 times with exponential backoff so the card
             self-heals when the connection is restored. */
          if (attempt < 5) {
            const delay = Math.min(2000 * Math.pow(2, attempt - 1), 30000);
            setTimeout(() => {
              if (this._hass) _fetchRegistry(attempt + 1);
            }, delay);
          }
          /* The card already rendered with hass.states data — it just won't
             have sequence/IR classification until the registry comes back. */
        })
        .finally(() => { this._initPending = false; });
      };
      _fetchRegistry(1);
    }

    _buildCard(mhubEntityIds) {
      return new Promise((resolve) => {
        const entryEnts = this._cfg.entry_id ? (this._entryEntsMap[this._cfg.entry_id] || null) : null;
        this._disc  = discoverMhub(this._hass, this._cfg.entry_id, mhubEntityIds, this._mhubRegistry || null, this._deviceNames || {}, entryEnts);
        this._zone  = 0;
        this._zoneRestored = false;   /* allow localStorage restore on next _sw() */
        const sh    = this._sh;
        sh.innerHTML= "";
        const style = document.createElement("style");
        style.textContent = CSS;
        sh.appendChild(style);
        const wrap = document.createElement("div");
        wrap.innerHTML = this._shell();
        sh.appendChild(wrap.firstElementChild);
        this._bindStatic();
        this._ready = true;
        this._live();
        resolve();
      });
    }

    _shell() {
      const d = this._disc || {};
      const pages = ["switch","volume","sequences","ir","diag"];
      const lbl   = {switch:"Switch",volume:"Volume",sequences:"Scenes",ir:"Remote",diag:"Info"};
      const nav   = pages.map(p =>
        `<button class="nb${p===this._page?" on":""}" data-p="${p}">`
        + I.navs[p]
        + `<span class="nb-lbl">${lbl[p]}</span>`
        + `</button>`
      ).join("");
      const isOn  = !d.power_switch || (this._hass && d.power_switch && this._sv(d.power_switch,"on")==="on");
      const dz    = this._design();
      const cls   = ["card", "dz-" + dz];
      /* Chromeless designs hide the tab bar unless the user opts back in */
      if (CHROMELESS.includes(dz) && this._cfg.show_tabs) cls.push("show-nav");
      return `<div class="${cls.join(" ")}" style="${this._themeStyle()}">
        <div class="hdr">
          <div class="hdr-logo">${I.logo}</div>
          <div class="hdr-text">
            <div class="hdr-title" id="htitle">${x(this._cfg.title||d.title||"MHUB")}</div>
            <div class="hdr-sub"   id="hsub">HDANYWHERE</div>
          </div>
          <div class="pill on" id="spill"><span class="pdot"></span><span id="stxt">Online</span></div>
          ${d.power_switch?`<button class="pw-btn${isOn?"":" off"}" id="pwbtn" title="System power" aria-label="System power">${I.power}</button>`:""}
        </div>

        <div class="pg on" id="pg-switch"><div class="body" id="swb"></div></div>
        <div class="pg"    id="pg-volume"><div class="body" id="volb"></div></div>
        <div class="pg"    id="pg-sequences"><div class="body" id="seqb"></div></div>
        <div class="pg"    id="pg-ir"><div class="body" id="irb"></div></div>
        <div class="pg"    id="pg-diag"><div class="body" id="diagb"></div></div>

        <div class="navbar">${nav}</div>

        <div class="ftr">
          <span class="finfo" id="ftxt">Updated just now</span>
          <button class="rbtn" id="rbtn">${I.ref} Refresh</button>
        </div>
      </div>`;
    }

    _bindStatic() {
      /* nav */
      this._sh.querySelectorAll(".nb").forEach(b => b.addEventListener("click", () => {
        this._page = b.dataset.p;
        this._sh.querySelectorAll(".nb").forEach(n => n.classList.toggle("on", n.dataset.p===this._page));
        this._sh.querySelectorAll(".pg").forEach(p => p.classList.toggle("on", p.id==="pg-"+this._page));
        this._renderPage();
      }));
      /* power */
      const pw = this._el("pwbtn");
      if (pw) pw.addEventListener("click", () => {
        const eid = this._disc && this._disc.power_switch;
        if (!eid) return;
        const on = this._sv(eid,"on")==="on";
        this._call("switch", on?"turn_off":"turn_on", {entity_id:eid});
      });
      /* refresh */
      const rb = this._el("rbtn");
      if (rb) rb.addEventListener("click", () => {
        /* re-discover in case integration reloaded */
        const entryEnts = this._cfg.entry_id ? (this._entryEntsMap[this._cfg.entry_id] || null) : null;
        this._disc = discoverMhub(this._hass, this._cfg.entry_id, this._mhubEntityIds || new Set(), this._mhubRegistry || null, this._deviceNames || {}, entryEnts);
        this._renderPage();
        const f = this._el("ftxt"); if (f) f.textContent = "Updated just now";
      });
    }

    /* ─ live update ─────────────────────────────────────────── */
    _live() {
      if (!this._ready) return;
      const d = this._disc;

      /* header */
      const sub = this._el("hsub");
      if (sub && d) {
        /* Read live from status sensor attributes if available, fall back to discovery cache */
        const statusState = d.status ? (this._hass?.states?.[d.status] || null) : null;
        const attrs = statusState ? (statusState.attributes || {}) : (d._diagAttrs || {});
        const m = attrs.model || "", f = attrs.firmware || "";
        const ins = attrs.inputs != null ? String(attrs.inputs) : "";
        const outs = attrs.outputs != null ? String(attrs.outputs) : "";
        let s = "HDANYWHERE";
        if (m)  s += " · " + m;
        if (f)  s += " · fw " + f;
        if (ins && outs) s += ` · ${ins}×${outs}`;
        sub.textContent = s;
      }

      /* power pill + power button */
      const isOn = !d?.power_switch || this._sv(d.power_switch,"on")==="on";
      const pill = this._el("spill"), ptxt = this._el("stxt");
      if (pill) pill.className = "pill "+(isOn?"on":"off");
      if (ptxt) ptxt.textContent = isOn?"Online":"Standby";
      const pwb = this._el("pwbtn");
      if (pwb) pwb.className = "pw-btn"+(isOn?"":" off");

      this._renderPage();
    }

    _renderPage() {
      const p = this._page;
      if (p==="switch")    this._sw();
      if (p==="volume")    this._vol();
      if (p==="sequences") this._seq();
      if (p==="ir")        this._ir();
      if (p==="diag")      this._diag();
    }

    /* ═══ SWITCH ═════════════════════════════════════════════
       Dispatches to the renderer for the selected design. All three
       designs share the same discovery, optimistic-source, and
       service-call machinery — only the presentation differs. */
    _sw() {
      const dz = this._design();
      if (dz === "glass")  return this._swGlass();
      if (dz === "remote") return this._swRemote();
      if (dz === "strip")  return this._swStrip();
      if (dz === "panel")  return this._swPanel();
      if (dz === "poster") return this._swPoster();
      return this._swClassic();
    }

    /* ── Shared zone context for the glass + remote renderers ──
       Mirrors the resolution logic inside _swClassic() (hidden zones,
       localStorage restore, optimistic source) without touching it. */
    _zoneCtx() {
      const d = this._disc;
      if (!d || !d.zones.length) return null;
      const hiddenZones = new Set(this._cfg.hidden_zones || []);
      let visibleZones = d.zones.filter(z => !hiddenZones.has(z.output));
      if (!visibleZones.length) visibleZones = d.zones;
      this._visibleZones = visibleZones;
      if (!this._zoneRestored) {
        this._zoneRestored = true;
        try {
          const key = "mhub_card_last_zone_" + (this._cfg.entry_id || "default");
          const savedOutput = localStorage.getItem(key);
          if (savedOutput) {
            const idx = visibleZones.findIndex(z => z.output === savedOutput);
            if (idx >= 0) this._zone = idx;
          }
        } catch(_) {}
      }
      if (this._zone >= visibleZones.length || this._zone < 0) this._zone = 0;
      const zone = visibleZones[this._zone] || visibleZones[0];
      const hiddenInputs = new Set(this._cfg.hidden_inputs || []);
      const sourceList = (this._attr(zone.media_player, "source_list", []) || zone.sources.map(s => s.name))
                          .filter(n => !hiddenInputs.has(n));
      const muted  = zone.mute_switch ? this._sv(zone.mute_switch, "off") === "on" : false;
      const hasVol = !!zone.volume_entity;
      const volVal = hasVol ? Math.round(parseFloat(this._sv(zone.volume_entity, "0")) || 0) : 0;
      const optKey = zone.media_player;
      const haCur  = this._attr(zone.media_player, "source", "") || this._sv(zone.source_sensor, "");
      if (this._optSrc && this._optSrc.mp === optKey && this._optSrc.src === haCur) this._optSrc = null;
      const cur = (this._optSrc && this._optSrc.mp === optKey) ? this._optSrc.src : haCur;
      return { zone, visibleZones, sourceList, muted, hasVol, volVal, cur };
    }

    _saveZone() {
      try {
        const key = "mhub_card_last_zone_" + (this._cfg.entry_id || "default");
        const z = (this._visibleZones || [])[this._zone];
        if (z) localStorage.setItem(key, z.output);
      } catch(_) {}
    }

    /* All visible zones, honouring hidden_zones. Used by designs that
       show every output at once (strip) as well as by lock_zone. */
    _allZones() {
      const d = this._disc;
      if (!d || !d.zones.length) return [];
      const hidden = new Set(this._cfg.hidden_zones || []);
      const vis = d.zones.filter(z => !hidden.has(z.output));
      return vis.length ? vis : d.zones;
    }

    /* Inputs for a zone, honouring hidden_inputs */
    _zoneSources(zone) {
      const hidden = new Set(this._cfg.hidden_inputs || []);
      return (this._attr(zone.media_player, "source_list", []) || (zone.sources || []).map(s => s.name))
        .filter(n => !hidden.has(n));
    }

    /* Currently selected source for a zone, with optimistic override */
    _zoneSrc(zone) {
      const ha = this._attr(zone.media_player, "source", "") || this._sv(zone.source_sensor, "");
      if (this._optSrc && this._optSrc.mp === zone.media_player && this._optSrc.src === ha) this._optSrc = null;
      return (this._optSrc && this._optSrc.mp === zone.media_player) ? this._optSrc.src : ha;
    }

    /* Artwork for an input: user-uploaded image if set, else the
       generated brand badge. Shared by every design. */
    _art(name) {
      const url = this._extractUrl((this._cfg.input_icons || {})[name]);
      if (url) return { img: true, style: "", html: `<img src="${x(url)}" alt="">` };
      const b = brand(name);
      return { img: false, style: `background:${b.bg};color:${b.fg}`, html: x(b.t), bg: b.bg };
    }

    /* Native <select> for output/zone choice — keyboard and screen
       reader accessible for free, and compact on mobile. */
    _selHtml(zones, activeIdx, id, label) {
      return `<label class="mh-sel">
        <span class="sr-only">${x(label || "Output")}</span>
        <select id="${id}" aria-label="${x(label || "Output")}">
          ${zones.map((z, i) =>
            `<option value="${i}"${i === activeIdx ? " selected" : ""}>${x(this._zoneName(z))}</option>`
          ).join("")}
        </select>
      </label>`;
    }

    /* Volume + mute control markup shared across designs */
    _volHtml(zone, key) {
      const hasVol = !!zone.volume_entity;
      const hasMute = !!zone.mute_switch;
      if (!hasVol && !hasMute) return "";
      const muted = hasMute ? this._sv(zone.mute_switch, "off") === "on" : false;
      const v = hasVol ? Math.round(parseFloat(this._sv(zone.volume_entity, "0")) || 0) : 0;
      return `<div class="mh-vol" data-vk="${x(key)}">
        ${hasMute
          ? `<button class="mh-mute${muted ? " muted" : ""}" aria-label="${muted ? "Unmute" : "Mute"}">${muted ? I.voff : I.von}</button>`
          : I.von}
        ${hasVol
          ? `<input class="vs" type="range" min="0" max="100" step="1" value="${v}" data-key="${x(key)}" aria-label="Volume">
             <span class="mh-vv">${v}</span>`
          : `<span class="mh-vv" style="flex:1;text-align:left">Muted only</span>`}
      </div>`;
    }

    /* Refresh an already-rendered volume control in place */
    _volSync(root, zone, key) {
      const box = root.querySelector(`.mh-vol[data-vk="${key}"]`);
      if (!box) return;
      if (zone.mute_switch) {
        const muted = this._sv(zone.mute_switch, "off") === "on";
        const mb = box.querySelector(".mh-mute");
        if (mb) { mb.classList.toggle("muted", muted); mb.innerHTML = muted ? I.voff : I.von; }
      }
      if (zone.volume_entity && !this._drag[key]) {
        const v = Math.round(parseFloat(this._sv(zone.volume_entity, "0")) || 0);
        const sl = box.querySelector(".vs"), vv = box.querySelector(".mh-vv");
        if (sl) sl.value = v;
        if (vv) vv.textContent = v;
      }
    }

    /* Wire a volume control's slider + mute button */
    _volBind(root, zone, key) {
      const box = root.querySelector(`.mh-vol[data-vk="${key}"]`);
      if (!box) return;
      const mb = box.querySelector(".mh-mute");
      if (mb && zone.mute_switch) mb.addEventListener("click", e => {
        e.stopPropagation();
        const on = this._sv(zone.mute_switch, "off") === "on";
        this._call("switch", on ? "turn_off" : "turn_on", { entity_id: zone.mute_switch });
      });
      const sl = box.querySelector(".vs"), vv = box.querySelector(".mh-vv");
      if (!sl || !zone.volume_entity) return;
      const down = () => { this._drag[key] = true; };
      const up   = () => { this._drag[key] = false; };
      sl.addEventListener("click", e => e.stopPropagation());
      sl.addEventListener("mousedown", down);
      sl.addEventListener("touchstart", down, { passive: true });
      sl.addEventListener("input", () => { if (vv) vv.textContent = sl.value; });
      sl.addEventListener("change", () => {
        up();
        this._call("number", "set_value", { entity_id: zone.volume_entity, value: parseFloat(sl.value) });
      });
      sl.addEventListener("mouseup", up);
      sl.addEventListener("touchend", up);
    }

    _selectSrc(zone, src) {
      this._optSrc = { mp: zone.media_player, src };
      this._call("media_player", "select_source", { entity_id: zone.media_player, source: src });
    }

    /* Volume nudge for the remote rocker. Prefers the zone's number
       entity; falls back to media_player volume_up/volume_down. */
    _bumpVol(zone, delta) {
      if (zone.volume_entity) {
        const cur = Math.round(parseFloat(this._sv(zone.volume_entity, "0")) || 0);
        const v = Math.max(0, Math.min(100, cur + delta));
        this._call("number", "set_value", { entity_id: zone.volume_entity, value: v });
      } else if (zone.media_player) {
        this._call("media_player", delta > 0 ? "volume_up" : "volume_down", { entity_id: zone.media_player });
      }
    }

    /* Resolve a navigation command entity for the D-pad.
       Search order: CEC devices for this zone → any CEC → IR devices
       for this zone → any IR. Command names are matched loosely but
       volume/channel/page variants are excluded. Returns entity_id or null. */
    _navEntity(zone, kind) {
      const pats = {
        up:    /(^|[\s_-])(cursor|dpad|arrow|nav)?[\s_-]*up([\s_-]|$)/i,
        down:  /(^|[\s_-])(cursor|dpad|arrow|nav)?[\s_-]*down([\s_-]|$)/i,
        left:  /(^|[\s_-])(cursor|dpad|arrow|nav)?[\s_-]*left([\s_-]|$)/i,
        right: /(^|[\s_-])(cursor|dpad|arrow|nav)?[\s_-]*right([\s_-]|$)/i,
        ok:    /(^|[\s_-])(ok|enter|select|confirm)([\s_-]|$)/i,
      };
      const bad = {
        up: /vol|chan|page/i, down: /vol|chan|page/i,
        left: /vol|chan|page/i, right: /vol|chan|page/i,
        ok: /source|input/i,
      };
      const pat = pats[kind];
      if (!pat) return null;
      const d = this._disc || {};
      const zoneTag = ((zone && this._zoneName(zone)) || "").toLowerCase();
      const outTag  = zone && zone.output ? ("output " + String(zone.output).toLowerCase()) : "";
      const matchesZone = dev => {
        const n = (dev.name || "").toLowerCase();
        return (zoneTag && n.includes(zoneTag)) || (outTag && n.includes(outTag));
      };
      const cecs = d.cec_devices || [], irs = d.ir_devices || [];
      const buckets = [cecs.filter(matchesZone), cecs, irs.filter(matchesZone), irs];
      for (const bucket of buckets) {
        for (const dev of bucket) {
          for (const c of (dev.commands || [])) {
            const n = c.name || "";
            if (pat.test(n) && !(bad[kind] && bad[kind].test(n))) return c.entity;
          }
        }
      }
      return null;
    }

    /* ═══ SWITCH · CLASSIC ═══════════════════════════════════ */
    _swClassic() {
      const d    = this._disc;
      const body = this._el("swb");

      if (!d || !d.zones.length) {
        if (body) body.innerHTML = '<div class="empty">No MHUB output zones found.<br>Check the MHUB integration is connected.</div>';
        return;
      }

      /* Filter out zones the user has hidden in the editor. */
      const hiddenZones = new Set(this._cfg.hidden_zones || []);
      let visibleZones = d.zones.filter(z => !hiddenZones.has(z.output));
      if (!visibleZones.length) visibleZones = d.zones;
      this._visibleZones = visibleZones;

      /* Restore last selected zone from localStorage on first render */
      if (!this._zoneRestored) {
        this._zoneRestored = true;
        try {
          const key = "mhub_card_last_zone_" + (this._cfg.entry_id || "default");
          const savedOutput = localStorage.getItem(key);
          if (savedOutput) {
            const idx = visibleZones.findIndex(z => z.output === savedOutput);
            if (idx >= 0) this._zone = idx;
          }
        } catch(_) {}
      }

      if (this._zone >= visibleZones.length || this._zone < 0) this._zone = 0;
      const zone = visibleZones[this._zone] || visibleZones[0];

      /* Get live data from media_player for this zone */
      const hiddenInputs = new Set(this._cfg.hidden_inputs || []);
      const sourceList = (this._attr(zone.media_player,"source_list",[]) || zone.sources.map(s=>s.name))
                          .filter(n => !hiddenInputs.has(n));
      const muted = zone.mute_switch ? this._sv(zone.mute_switch,"off")==="on" : false;
      const hasVol = !!zone.volume_entity;
      const volVal = hasVol ? Math.round(parseFloat(this._sv(zone.volume_entity,"0"))||0) : 0;

      /* Use optimistic source if we just sent a select_source command and HA hasn't
         confirmed yet.  The cache is keyed by zone so switching output clears it. */
      const optKey = zone.media_player;
      const haCur  = this._attr(zone.media_player,"source","") || this._sv(zone.source_sensor,"");
      if (this._optSrc && this._optSrc.mp === optKey && this._optSrc.src === haCur) {
        this._optSrc = null;
      }
      const cur = (this._optSrc && this._optSrc.mp === optKey) ? this._optSrc.src : haCur;

      if (!body) return;

      const out      = x(zone.output||"?");
      const zoneName = x(this._zoneName(zone));

      /* Detect zone change — clear body so we always do a full rebuild for a new zone */
      if (body.dataset.zone !== zone.output) {
        body.innerHTML = "";
        body.dataset.zone = zone.output;
      }

      /* Patch existing layout in-place to avoid flicker — same zone, already built */
      if (body.querySelector(".sgrid")) {
        /* Hero update */
        const nowEl = body.querySelector(".now");
        const ico   = body.querySelector(".now-ico-wrap");
        const nm    = body.querySelector("#now-name");
        const mt    = body.querySelector("#now-meta");
        const mute  = body.querySelector("#mbtn-hero");
        if (cur) {
          const b = brand(cur);
          if (nowEl) {
            nowEl.classList.remove("idle");
            nowEl.style.background = b.bg;
            nowEl.style.color      = b.fg;
          }
          if (ico) ico.innerHTML = this._nowIcon(cur);
          if (nm)  nm.textContent = this._inputName(cur);
          if (mt)  mt.textContent = hasVol ? `Volume ${volVal}${muted?" · muted":""}` : (muted?"Muted":"Active");
        } else {
          if (nowEl) {
            nowEl.classList.add("idle");
            nowEl.style.background = "";
            nowEl.style.color      = "";
          }
          if (ico) ico.innerHTML = this._nowIconIdle();
          if (nm)  nm.textContent = "Nothing playing";
          if (mt)  mt.textContent = "Tap a source below";
        }
        if (mute) {
          mute.className = "now-mute"+(muted?" muted":"");
          mute.innerHTML = muted?I.voff:I.von;
          mute.setAttribute("aria-label", muted?"Unmute":"Mute");
        }
        /* Inline volume update — but skip while user is dragging */
        if (hasVol) {
          const sl = body.querySelector(".vol-inline .vs");
          const vv = body.querySelector(".vol-inline .vv");
          if (sl && !this._drag["zh"]) sl.value = volVal;
          if (vv) vv.textContent = volVal;
        }
        /* Zone selector label */
        const zlbl = body.querySelector("#zsel-lbl");
        if (zlbl) zlbl.textContent = `Output ${out} · ${zoneName}`;
        /* Source tiles */
        body.querySelectorAll(".sbtn[data-src]").forEach(btn => {
          const isOn = !!(cur && btn.dataset.src === cur);
          btn.classList.toggle("on", isOn);
        });
        return;
      }

      /* ── Full build ── */
      const heroBrand = cur ? brand(cur) : null;
      const heroStyle = heroBrand ? `background:${heroBrand.bg};color:${heroBrand.fg}` : "";
      const heroClass = cur ? "now" : "now idle";
      const heroIco   = cur ? this._nowIcon(cur) : this._nowIconIdle();
      const heroName  = cur ? x(this._inputName(cur)) : "Nothing playing";
      const heroMeta  = cur
        ? (hasVol ? `Volume ${volVal}${muted?" · muted":""}` : (muted?"Muted":"Active"))
        : "Tap a source below";

      /* Zone selector — only show if more than one visible zone */
      const zoneSelectorHTML = visibleZones.length > 1
        ? `<div class="zsel-wrap">
            <button class="zsel-btn" id="zsel-btn" aria-expanded="false">
              <span id="zsel-lbl">Output ${out} · ${zoneName}</span>
              ${I.chev}
            </button>
            <select class="zdrop" id="zdrop" aria-label="Select output zone">
              ${visibleZones.map((z,i) => {
                const lbl = this._zoneName(z);
                return `<option value="${i}"${i===this._zone?" selected":""}>Output ${x(z.output||String.fromCharCode(65+i))} · ${x(lbl)}</option>`;
              }).join("")}
            </select>
          </div>`
        : `<span class="zsel-btn" style="cursor:default" id="zsel-lbl-only"><span id="zsel-lbl">Output ${out} · ${zoneName}</span></span>`;

      /* Hero with optional mute button */
      const heroHTML =
        `<div class="${heroClass}" style="${heroStyle}">
          <div class="now-ico-wrap" style="display:contents">${heroIco}</div>
          <div class="now-text">
            <div class="now-name" id="now-name">${heroName}</div>
            <div class="now-meta" id="now-meta">${x(heroMeta)}</div>
          </div>
          ${zone.mute_switch
            ? `<button class="now-mute${muted?" muted":""}" id="mbtn-hero" aria-label="${muted?"Unmute":"Mute"}">${muted?I.voff:I.von}</button>`
            : ""}
        </div>`;

      /* Inline volume row — only when this zone has a volume entity */
      const volHTML = hasVol
        ? `<div class="vol-inline">
            ${I.von}
            <input class="vs" type="range" min="0" max="100" step="1" value="${volVal}" data-key="zh" aria-label="Volume">
            <span class="vv" id="vv-zh">${volVal}</span>
          </div>`
        : "";

      /* Source grid */
      const srcHTML = sourceList.length
        ? sourceList.map(name => {
            const act = !!(cur && cur === name);
            return `<button class="sbtn${act?" on":""}" data-src="${x(name)}">`
              + this._srcIcon(name)
              + `<span class="sname">${x(this._inputName(name))}</span>`
              + `</button>`;
          }).join("")
        : '<div class="empty" style="grid-column:1/-1">No inputs found — check your MHUB hub is connected.</div>';

      body.innerHTML =
        `<div class="now-head">
          <span class="now-head-lbl">Now showing</span>
          ${zoneSelectorHTML}
        </div>`
        + heroHTML
        + volHTML
        + `<div class="slbl">Sources</div>`
        + `<div class="sgrid">${srcHTML}</div>`;

      /* ── Bind events ── */

      /* Zone dropdown (transparent <select> overlaid on the chevron button) */
      const drop = body.querySelector("#zdrop");
      if (drop) {
        drop.addEventListener("change", () => {
          this._zone = parseInt(drop.value);
          this._optSrc = null;
          try {
            const key = "mhub_card_last_zone_" + (this._cfg.entry_id || "default");
            const z = (this._visibleZones || [])[this._zone];
            if (z) localStorage.setItem(key, z.output);
          } catch(_) {}
          this._sw();
        });
      }

      /* Hero mute */
      const mh = body.querySelector("#mbtn-hero");
      if (mh) mh.addEventListener("click", () => {
        const on = this._sv(zone.mute_switch,"off")==="on";
        this._call("switch", on?"turn_off":"turn_on", {entity_id:zone.mute_switch});
      });

      /* Inline volume slider */
      if (hasVol) {
        const sl = body.querySelector(".vol-inline .vs");
        const vv = body.querySelector("#vv-zh");
        if (sl) {
          sl.addEventListener("mousedown",  () => { this._drag["zh"] = true; });
          sl.addEventListener("touchstart", () => { this._drag["zh"] = true; }, {passive:true});
          sl.addEventListener("input",      () => { if (vv) vv.textContent = sl.value; });
          sl.addEventListener("change",     () => {
            this._drag["zh"] = false;
            this._call("number","set_value",{entity_id:zone.volume_entity, value:parseFloat(sl.value)});
          });
          sl.addEventListener("mouseup",  () => { this._drag["zh"] = false; });
          sl.addEventListener("touchend", () => { this._drag["zh"] = false; });
        }
      }

      /* Source tiles */
      body.querySelectorAll(".sbtn[data-src]").forEach(btn => {
        btn.addEventListener("click", () => {
          if (!zone.media_player) return;
          const src = btn.dataset.src;
          /* Optimistic cache so live updates don't revert before HA confirms */
          this._optSrc = { mp: zone.media_player, src };
          /* Optimistic UI */
          body.querySelectorAll(".sbtn").forEach(b => b.classList.remove("on"));
          btn.classList.add("on");
          const b      = brand(src);
          const nowEl  = body.querySelector(".now");
          const ico    = body.querySelector(".now-ico-wrap");
          const nm     = body.querySelector("#now-name");
          const mt     = body.querySelector("#now-meta");
          if (nowEl) {
            nowEl.classList.remove("idle");
            nowEl.style.background = b.bg;
            nowEl.style.color      = b.fg;
          }
          if (ico) ico.innerHTML = this._nowIcon(src);
          if (nm)  nm.textContent = this._inputName(src);
          if (mt)  mt.textContent = hasVol ? `Volume ${volVal}${muted?" · muted":""}` : (muted?"Muted":"Active");
          this._call("media_player","select_source",{entity_id:zone.media_player,source:src});
        });
      });
    }


    /* ═══ SWITCH · GLASS ═════════════════════════════════════
       Ambient hero + horizontal source shelf. The glow, hero tile
       and gradients are derived from the active source's brand
       colour (or the user's uploaded image). */
    _swGlass() {
      const body = this._el("swb");
      if (!body) return;
      const ctx = this._zoneCtx();
      if (!ctx) {
        body.innerHTML = '<div class="empty">No MHUB output zones found.<br>Check the MHUB integration is connected.</div>';
        return;
      }
      const { zone, visibleZones, sourceList, muted, hasVol, volVal, cur } = ctx;
      const glow = cur ? glowColor(brand(cur).bg) : "rgba(90,110,180,.28)";

      const tileHtml = (name) => {
        const raw = (this._cfg.input_icons || {})[name];
        const url = this._extractUrl(raw);
        if (url) return { style: "background:rgba(255,255,255,.12)", html: `<img src="${x(url)}" alt="">` };
        const b = brand(name);
        const g = gradPair(b.bg);
        return { style: `background:linear-gradient(145deg,${g[0]},${g[1]})`, html: x(b.t) };
      };

      /* ── In-place patch (same zone, already built) ── */
      if (body.dataset.zone === zone.output && body.querySelector(".g-shelf")) {
        const gl = body.querySelector(".g-glow");
        if (gl) gl.style.background = `radial-gradient(closest-side, ${glow}, transparent)`;
        const tile = body.querySelector(".g-tile");
        if (tile) {
          if (cur) { const t = tileHtml(cur); tile.style.cssText = t.style; tile.innerHTML = t.html; }
          else { tile.style.cssText = "background:rgba(255,255,255,.08)"; tile.innerHTML = "—"; }
        }
        const nm = body.querySelector(".g-name");
        if (nm) nm.textContent = cur ? this._inputName(cur) : "Nothing playing";
        const mt = body.querySelector(".g-meta");
        if (mt) mt.textContent = cur
          ? `Playing on ${this._zoneName(zone)}${hasVol && muted ? " · muted" : ""}`
          : "Tap a source below";
        body.querySelectorAll(".g-s").forEach(b => b.classList.toggle("on", !!(cur && b.dataset.src === cur)));
        body.querySelectorAll(".g-zpill").forEach(pz =>
          pz.classList.toggle("on", parseInt(pz.dataset.zi) === this._zone));
        if (hasVol) {
          const sl = body.querySelector(".g-bar .vs");
          const vv = body.querySelector(".g-vv");
          if (sl && !this._drag["zh"]) sl.value = volVal;
          if (vv) vv.textContent = volVal;
        }
        const mb = body.querySelector(".g-mute");
        if (mb) { mb.classList.toggle("muted", muted); mb.innerHTML = muted ? I.voff : I.von; }
        return;
      }

      /* ── Full build ── */
      body.dataset.zone = zone.output;

      const zonesHTML = visibleZones.length > 1
        ? `<div class="g-zones">${visibleZones.map((z, i) =>
            `<button class="g-zpill${i === this._zone ? " on" : ""}" data-zi="${i}">${x(this._zoneName(z))}</button>`
          ).join("")}</div>`
        : "";

      const hero = cur ? tileHtml(cur) : { style: "background:rgba(255,255,255,.08)", html: "—" };
      const heroName = cur ? x(this._inputName(cur)) : "Nothing playing";
      const heroMeta = cur
        ? `Playing on ${x(this._zoneName(zone))}${hasVol && muted ? " · muted" : ""}`
        : "Tap a source below";

      const shelfHTML = sourceList.length
        ? sourceList.map(name => {
            const t = tileHtml(name);
            const act = !!(cur && cur === name);
            return `<button class="g-s${act ? " on" : ""}" data-src="${x(name)}">`
              + `<span class="g-sart" style="${t.style}">${t.html}</span>`
              + `<span class="g-slbl">${x(this._inputName(name))}</span>`
              + `</button>`;
          }).join("")
        : '<div class="empty" style="flex:1">No inputs found.</div>';

      const barHTML = (hasVol || zone.mute_switch)
        ? `<div class="g-bar">
            ${zone.mute_switch
              ? `<button class="g-mute${muted ? " muted" : ""}" aria-label="${muted ? "Unmute" : "Mute"}">${muted ? I.voff : I.von}</button>`
              : I.von}
            ${hasVol
              ? `<input class="vs" type="range" min="0" max="100" step="1" value="${volVal}" data-key="zh" aria-label="Volume">
                 <span class="g-vv">${volVal}</span>`
              : `<span class="g-vv" style="flex:1;text-align:left">No volume control</span>`}
          </div>`
        : "";

      body.innerHTML =
        `<div class="g-glow" style="background:radial-gradient(closest-side, ${glow}, transparent)"></div>`
        + zonesHTML
        + `<div class="g-hero">
            <div class="g-tile" style="${hero.style}">${hero.html}</div>
            <div class="g-name">${heroName}</div>
            <div class="g-meta">${heroMeta}</div>
          </div>`
        + `<div class="g-shelf">${shelfHTML}</div>`
        + barHTML;

      /* ── Bind ── */
      body.querySelectorAll(".g-zpill").forEach(pz => pz.addEventListener("click", () => {
        this._zone = parseInt(pz.dataset.zi);
        this._optSrc = null;
        this._saveZone();
        delete body.dataset.zone;   /* force full rebuild for the new zone */
        this._swGlass();
      }));

      body.querySelectorAll(".g-s[data-src]").forEach(btn => btn.addEventListener("click", () => {
        if (!zone.media_player) return;
        const src = btn.dataset.src;
        body.querySelectorAll(".g-s").forEach(b => b.classList.remove("on"));
        btn.classList.add("on");
        /* Optimistic hero + glow */
        const t = tileHtml(src);
        const tile = body.querySelector(".g-tile");
        if (tile) { tile.style.cssText = t.style; tile.innerHTML = t.html; }
        const nm = body.querySelector(".g-name"); if (nm) nm.textContent = this._inputName(src);
        const gl = body.querySelector(".g-glow");
        if (gl) gl.style.background = `radial-gradient(closest-side, ${glowColor(brand(src).bg)}, transparent)`;
        this._selectSrc(zone, src);
      }));

      const mb = body.querySelector(".g-mute");
      if (mb && zone.mute_switch) mb.addEventListener("click", () => {
        const on = this._sv(zone.mute_switch, "off") === "on";
        this._call("switch", on ? "turn_off" : "turn_on", { entity_id: zone.mute_switch });
      });

      if (hasVol) {
        const sl = body.querySelector(".g-bar .vs");
        const vv = body.querySelector(".g-vv");
        if (sl) {
          sl.addEventListener("mousedown",  () => { this._drag["zh"] = true; });
          sl.addEventListener("touchstart", () => { this._drag["zh"] = true; }, { passive: true });
          sl.addEventListener("input",      () => { if (vv) vv.textContent = sl.value; });
          sl.addEventListener("change",     () => {
            this._drag["zh"] = false;
            this._call("number", "set_value", { entity_id: zone.volume_entity, value: parseFloat(sl.value) });
          });
          sl.addEventListener("mouseup",  () => { this._drag["zh"] = false; });
          sl.addEventListener("touchend", () => { this._drag["zh"] = false; });
        }
      }
    }

    /* ═══ SWITCH · REMOTE ════════════════════════════════════
       Physical handset. D-pad navigation resolves live CEC/IR
       command entities for the selected zone; the volume rocker
       drives the zone volume; source hotkeys switch inputs. */
    _swRemote() {
      const body = this._el("swb");
      if (!body) return;
      const ctx = this._zoneCtx();
      if (!ctx) {
        body.innerHTML = '<div class="empty">No MHUB output zones found.<br>Check the MHUB integration is connected.</div>';
        return;
      }
      const { zone, visibleZones, sourceList, muted, hasVol, cur } = ctx;

      const keyArt = (name) => {
        const raw = (this._cfg.input_icons || {})[name];
        const url = this._extractUrl(raw);
        if (url) return { style: "", html: `<img src="${x(url)}" alt="">` };
        const b = brand(name);
        return { style: `background:${b.bg};color:${b.fg}`, html: x(b.t) };
      };

      const nav = {
        up:    this._navEntity(zone, "up"),
        down:  this._navEntity(zone, "down"),
        left:  this._navEntity(zone, "left"),
        right: this._navEntity(zone, "right"),
        ok:    this._navEntity(zone, "ok"),
      };
      /* Kept on the instance so click handlers and the patch path always
         use the freshest resolution — CEC/IR entities are classified
         asynchronously after the registry fetch, so a command that was
         unavailable at first render can appear moments later. */
      this._navMap = nav;

      /* ── In-place patch ── */
      if (body.dataset.zone === zone.output && body.querySelector(".r-dpad")) {
        body.querySelectorAll("[data-nav]").forEach(b =>
          b.classList.toggle("nocmd", !nav[b.dataset.nav]));
        const top = body.querySelector(".r-lcd-top span");
        if (top) top.textContent = `Output ${zone.output} · ${this._zoneName(zone)}`;
        const lc = body.querySelector(".r-lcd-src");
        if (lc) lc.textContent = cur ? this._inputName(cur) : "—";
        body.querySelectorAll(".r-s").forEach(b => b.classList.toggle("on", !!(cur && b.dataset.src === cur)));
        const mkb = body.querySelector(".r-kb[data-act=mute]");
        if (mkb) {
          mkb.classList.toggle("muted", muted);
          mkb.innerHTML = (muted ? I.voff : I.von) + `<span>${muted ? "Unmute" : "Mute"}</span>`;
        }
        return;
      }

      /* ── Full build ── */
      body.dataset.zone = zone.output;

      const chevUp    = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>`;
      const chevDown  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>`;
      const chevLeft  = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>`;
      const chevRight = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>`;

      const dBtn = (kind, cls, icon) =>
        `<button class="r-d ${cls}${nav[kind] ? "" : " nocmd"}" data-nav="${kind}" aria-label="${kind}">${icon}</button>`;

      const multiZone = visibleZones.length > 1;

      const volKey = `<div class="r-k">
          <button class="r-kb" data-act="vdn" aria-label="Volume down">${I.von}<span>−</span></button>
          <div class="r-kdiv"></div>
          <button class="r-kb" data-act="vup" aria-label="Volume up"><span>+</span></button>
        </div>`;

      let secondKey = "";
      if (zone.mute_switch && multiZone) {
        secondKey = `<div class="r-k">
            <button class="r-kb${muted ? " muted" : ""}" data-act="mute">${muted ? I.voff : I.von}<span>${muted ? "Unmute" : "Mute"}</span></button>
            <div class="r-kdiv"></div>
            <button class="r-kb" data-act="out">${I.navs.switch}<span>Output</span></button>
          </div>`;
      } else if (zone.mute_switch) {
        secondKey = `<div class="r-k">
            <button class="r-kb${muted ? " muted" : ""}" data-act="mute">${muted ? I.voff : I.von}<span>${muted ? "Unmute" : "Mute"}</span></button>
          </div>`;
      } else if (multiZone) {
        secondKey = `<div class="r-k">
            <button class="r-kb" data-act="out">${I.navs.switch}<span>Output</span></button>
          </div>`;
      }

      const rowCls = secondKey ? "r-row" : "r-row single";

      const srcHTML = sourceList.length
        ? sourceList.map(name => {
            const a = keyArt(name);
            const act = !!(cur && cur === name);
            return `<div><button class="r-s${act ? " on" : ""}" data-src="${x(name)}" style="${a.style}" aria-label="${x(name)}">${a.html}</button>`
              + `<div class="r-slbl">${x(this._inputName(name))}</div></div>`;
          }).join("")
        : '<div class="empty" style="grid-column:1/-1">No inputs found.</div>';

      body.innerHTML =
        `<div class="r-lcd${multiZone ? " click" : ""}" ${multiZone ? 'title="Tap to switch output" role="button" tabindex="0"' : ""}>
          <div class="r-lcd-top">
            <span>Output ${x(zone.output)} · ${x(this._zoneName(zone))}</span>
            ${multiZone ? "<span>⇄</span>" : ""}
          </div>
          <div class="r-lcd-src">${cur ? x(this._inputName(cur)) : "—"}</div>
        </div>`
        + `<div class="r-dpad">
            ${dBtn("up", "up", chevUp)}
            ${dBtn("down", "down", chevDown)}
            ${dBtn("left", "left", chevLeft)}
            ${dBtn("right", "right", chevRight)}
            <button class="r-ok${nav.ok ? "" : " nocmd"}" data-nav="ok">OK</button>
          </div>`
        + `<div class="${rowCls}">${volKey}${secondKey}</div>`
        + `<div class="r-src">${srcHTML}</div>`;

      /* ── Bind ── */
      const cycleOutput = () => {
        this._zone = (this._zone + 1) % visibleZones.length;
        this._optSrc = null;
        this._saveZone();
        delete body.dataset.zone;
        this._swRemote();
      };

      if (multiZone) {
        const lcd = body.querySelector(".r-lcd");
        if (lcd) {
          lcd.addEventListener("click", cycleOutput);
          lcd.addEventListener("keydown", e => {
            if (e.key === "Enter" || e.key === " ") { e.preventDefault(); cycleOutput(); }
          });
        }
      }

      body.querySelectorAll("[data-nav]").forEach(btn => btn.addEventListener("click", () => {
        const eid = (this._navMap || {})[btn.dataset.nav];
        if (!eid) return;
        this._call("button", "press", { entity_id: eid });
      }));

      body.querySelectorAll(".r-kb").forEach(btn => btn.addEventListener("click", () => {
        const act = btn.dataset.act;
        if (act === "vup")  this._bumpVol(zone, 5);
        if (act === "vdn")  this._bumpVol(zone, -5);
        if (act === "out")  cycleOutput();
        if (act === "mute" && zone.mute_switch) {
          const on = this._sv(zone.mute_switch, "off") === "on";
          this._call("switch", on ? "turn_off" : "turn_on", { entity_id: zone.mute_switch });
        }
      }));

      body.querySelectorAll(".r-s[data-src]").forEach(btn => btn.addEventListener("click", () => {
        if (!zone.media_player) return;
        const src = btn.dataset.src;
        body.querySelectorAll(".r-s").forEach(b => b.classList.remove("on"));
        btn.classList.add("on");
        const lc = body.querySelector(".r-lcd-src");
        if (lc) lc.textContent = this._inputName(src);
        this._selectSrc(zone, src);
      }));
    }


    /* ═══ SWITCH · STRIP ═════════════════════════════════════
       Whole-house overview: one row per output. Rows expand in
       place to reveal that zone's inputs and volume, so a ten-room
       property fits in a single card. */
    _swStrip() {
      const body = this._el("swb");
      if (!body) return;
      const zones = this._allZones();
      if (!zones.length) {
        body.innerHTML = '<div class="empty">No MHUB output zones found.<br>Check the MHUB integration is connected.</div>';
        return;
      }
      if (!this._stOpen) this._stOpen = new Set();

      /* Row lookup by output id — built from the live DOM rather than a
         selector, since output ids are arbitrary strings and CSS.escape
         is not available in every browser HA runs in. */
      const rowMap = () => {
        const m = {};
        body.querySelectorAll(".st-z").forEach(r => { m[r.dataset.out] = r; });
        return m;
      };

      /* ── In-place patch ── */
      if (body.dataset.n === String(zones.length) && body.querySelector(".st-z")) {
        const rows = rowMap();
        zones.forEach(zone => {
          const row = rows[zone.output];
          if (!row) return;
          const cur = this._zoneSrc(zone);
          const badge = row.querySelector(".st-badge");
          if (badge) {
            if (cur) { const a = this._art(cur); badge.className = "st-badge"; badge.style.cssText = a.style; badge.innerHTML = a.html; }
            else { badge.className = "st-badge off"; badge.style.cssText = ""; badge.textContent = "—"; }
          }
          const s = row.querySelector(".st-src");
          if (s) s.textContent = cur ? this._inputName(cur) : "Off";
          row.querySelectorAll(".st-i").forEach(b => b.classList.toggle("on", !!(cur && b.dataset.src === cur)));
          this._volSync(row, zone, "st_" + zone.output);
        });
        return;
      }

      /* ── Full build ── */
      body.dataset.n = String(zones.length);
      body.innerHTML = zones.map(zone => {
        const cur = this._zoneSrc(zone);
        const open = this._stOpen.has(zone.output);
        const a = cur ? this._art(cur) : null;
        const srcs = this._zoneSources(zone);
        return `<div class="st-z${open ? " open" : ""}" data-out="${x(zone.output)}">
          <button class="st-row" aria-expanded="${open}">
            <span class="${a ? "st-badge" : "st-badge off"}" style="${a ? a.style : ""}">${a ? a.html : "—"}</span>
            <span class="st-name">${x(this._zoneName(zone))}</span>
            <span class="st-src">${cur ? x(this._inputName(cur)) : "Off"}</span>
            <span class="st-chev"></span>
          </button>
          <div class="st-panel">
            <div class="st-grid">${
              srcs.length
                ? srcs.map(n => {
                    const ia = this._art(n);
                    return `<button class="st-i${cur === n ? " on" : ""}" data-src="${x(n)}">
                      <span class="st-iart" style="${ia.style}">${ia.html}</span>
                      <span class="st-ilbl">${x(this._inputName(n))}</span>
                    </button>`;
                  }).join("")
                : '<div class="empty" style="grid-column:1/-1">No inputs</div>'
            }</div>
            ${this._volHtml(zone, "st_" + zone.output)}
          </div>
        </div>`;
      }).join("");

      /* ── Bind ── */
      const rows = rowMap();
      zones.forEach(zone => {
        const row = rows[zone.output];
        if (!row) return;
        const head = row.querySelector(".st-row");
        head.addEventListener("click", () => {
          const nowOpen = !row.classList.contains("open");
          row.classList.toggle("open", nowOpen);
          head.setAttribute("aria-expanded", String(nowOpen));
          if (nowOpen) this._stOpen.add(zone.output); else this._stOpen.delete(zone.output);
        });
        row.querySelectorAll(".st-i[data-src]").forEach(btn => btn.addEventListener("click", () => {
          if (!zone.media_player) return;
          const src = btn.dataset.src;
          row.querySelectorAll(".st-i").forEach(b => b.classList.remove("on"));
          btn.classList.add("on");
          const badge = row.querySelector(".st-badge");
          const a = this._art(src);
          if (badge) { badge.className = "st-badge"; badge.style.cssText = a.style; badge.innerHTML = a.html; }
          const s = row.querySelector(".st-src");
          if (s) s.textContent = this._inputName(src);
          this._selectSrc(zone, src);
        }));
        this._volBind(row, zone, "st_" + zone.output);
      });
    }

    /* ═══ SWITCH · PANEL ═════════════════════════════════════
       Kiosk for wall-mounted tablets. Oversized targets, no tabs,
       and an optional locked zone so a guest can't change room. */
    _swPanel() {
      const body = this._el("swb");
      if (!body) return;
      const zones = this._allZones();
      if (!zones.length) {
        body.innerHTML = '<div class="empty">No MHUB output zones found.<br>Check the MHUB integration is connected.</div>';
        return;
      }
      const locked = this._cfg.lock_zone
        ? zones.find(z => String(z.output) === String(this._cfg.lock_zone))
        : null;
      const list = locked ? [locked] : zones;
      if (this._zone >= list.length || this._zone < 0) this._zone = 0;
      const zone = list[this._zone];
      const cur = this._zoneSrc(zone);
      const srcs = this._zoneSources(zone);
      const d = this._disc || {};
      const powerOn = !d.power_switch || this._sv(d.power_switch, "on") === "on";

      /* ── In-place patch ── */
      if (body.dataset.zone === zone.output && body.querySelector(".pn-grid")) {
        const nw = body.querySelector(".pn-now");
        if (nw) nw.textContent = cur ? "now on " + this._inputName(cur) : "off";
        body.querySelectorAll(".pn-i").forEach(b => b.classList.toggle("on", !!(cur && b.dataset.src === cur)));
        const pw = body.querySelector(".pn-pw");
        if (pw) pw.classList.toggle("off", !powerOn);
        this._volSync(body, zone, "pn");
        return;
      }

      /* ── Full build ── */
      body.dataset.zone = zone.output;
      const gridHtml = srcs.length
        ? srcs.map(n => {
            const a = this._art(n);
            const bg = a.img ? "background:#2a3040" : `background:${brand(n).bg};color:${brand(n).fg}`;
            return `<button class="pn-i${cur === n ? " on" : ""}" data-src="${x(n)}" style="${bg}">
              <span class="pn-iart">${a.img ? a.html : x(brand(n).t)}</span>
              <span class="pn-ilbl">${x(this._inputName(n))}</span>
            </button>`;
          }).join("")
        : '<div class="empty" style="grid-column:1/-1">No inputs found.</div>';

      const showPicker = !locked && list.length > 1;
      body.innerHTML =
        `<div class="pn-head">
          <div class="pn-zone">${x(this._zoneName(zone))}</div>
          <div class="pn-now">${cur ? "now on " + x(this._inputName(cur)) : "off"}</div>
          ${d.power_switch ? `<button class="pn-pw${powerOn ? "" : " off"}" aria-label="System power">${I.power}</button>` : ""}
        </div>
        <div class="pn-grid">${gridHtml}</div>
        <div class="pn-foot">
          ${this._volHtml(zone, "pn")}
          ${showPicker ? this._selHtml(list, this._zone, "pnsel", "Room") : ""}
        </div>`;

      /* ── Bind ── */
      body.querySelectorAll(".pn-i[data-src]").forEach(btn => btn.addEventListener("click", () => {
        if (!zone.media_player) return;
        const src = btn.dataset.src;
        body.querySelectorAll(".pn-i").forEach(b => b.classList.remove("on"));
        btn.classList.add("on");
        const nw = body.querySelector(".pn-now");
        if (nw) nw.textContent = "now on " + this._inputName(src);
        this._selectSrc(zone, src);
      }));
      const sel = body.querySelector("#pnsel");
      if (sel) sel.addEventListener("change", () => {
        this._zone = parseInt(sel.value, 10) || 0;
        this._optSrc = null;
        delete body.dataset.zone;
        this._swPanel();
      });
      const pw = body.querySelector(".pn-pw");
      if (pw && d.power_switch) pw.addEventListener("click", () => {
        const on = this._sv(d.power_switch, "on") === "on";
        this._call("switch", on ? "turn_off" : "turn_on", { entity_id: d.power_switch });
      });
      this._volBind(body, zone, "pn");
    }

    /* ═══ SWITCH · POSTER ════════════════════════════════════
       Artwork-first grid. Uses uploaded input images at full
       bleed, falling back to a brand gradient where none is set. */
    _swPoster() {
      const body = this._el("swb");
      if (!body) return;
      const zones = this._allZones();
      if (!zones.length) {
        body.innerHTML = '<div class="empty">No MHUB output zones found.<br>Check the MHUB integration is connected.</div>';
        return;
      }
      const locked = this._cfg.lock_zone
        ? zones.find(z => String(z.output) === String(this._cfg.lock_zone))
        : null;
      const list = locked ? [locked] : zones;
      if (this._zone >= list.length || this._zone < 0) this._zone = 0;
      const zone = list[this._zone];
      const cur = this._zoneSrc(zone);
      const srcs = this._zoneSources(zone);
      const cols = Math.max(2, Math.min(6, parseInt(this._cfg.poster_columns, 10) || 3));

      /* ── In-place patch ── */
      if (body.dataset.zone === zone.output && body.querySelector(".po-grid")) {
        body.querySelectorAll(".po-i").forEach(b => b.classList.toggle("on", !!(cur && b.dataset.src === cur)));
        this._volSync(body, zone, "po");
        return;
      }

      /* ── Full build ── */
      body.dataset.zone = zone.output;
      const gridHtml = srcs.length
        ? srcs.map(n => {
            const a = this._art(n);
            const g = gradPair(brand(n).bg);
            const bg = a.img ? "" : `background:linear-gradient(160deg,${g[0]},${g[1]})`;
            return `<button class="po-i${cur === n ? " on" : ""}" data-src="${x(n)}" style="${bg}" aria-label="${x(n)}">
              ${a.img ? a.html : ""}
              <span class="po-shade"></span>
              <span class="po-lbl">${x(this._inputName(n))}</span>
            </button>`;
          }).join("")
        : '<div class="empty" style="grid-column:1/-1">No inputs found.</div>';

      const showPicker = !locked && list.length > 1;
      body.innerHTML =
        `<div class="po-head">
          <span class="po-zone">${x(this._zoneName(zone))}</span>
          <span class="po-out">Output ${x(zone.output)}</span>
        </div>
        <div class="po-grid" style="grid-template-columns:repeat(${cols},1fr)">${gridHtml}</div>
        <div class="po-bar">
          ${showPicker ? this._selHtml(list, this._zone, "posel", "Output") : ""}
          ${this._volHtml(zone, "po")}
        </div>`;

      /* ── Bind ── */
      body.querySelectorAll(".po-i[data-src]").forEach(btn => btn.addEventListener("click", () => {
        if (!zone.media_player) return;
        const src = btn.dataset.src;
        body.querySelectorAll(".po-i").forEach(b => b.classList.remove("on"));
        btn.classList.add("on");
        this._selectSrc(zone, src);
      }));
      const sel = body.querySelector("#posel");
      if (sel) sel.addEventListener("change", () => {
        this._zone = parseInt(sel.value, 10) || 0;
        this._optSrc = null;
        delete body.dataset.zone;
        this._swPoster();
      });
      this._volBind(body, zone, "po");
    }

    /* ═══ VOLUME ═════════════════════════════════════════════ */
    _vol() {
      const body = this._el("volb");
      if (!body) return;
      const d = this._disc;
      const zones  = (d?.zones  ||[]).filter(z=>z.volume_entity);
      const groups = (d?.groups ||[]).filter(g=>g.volume_entity);

      /* patch existing sliders in-place without rebuild */
      if (body.querySelector(".vs")) {
        body.querySelectorAll(".vs").forEach(sl => {
          if (this._drag[sl.dataset.key]) return;
          const v = Math.round(parseFloat(this._sv(sl.dataset.entity,"0"))||0);
          sl.value = v;
          const dv = body.querySelector(`#vv-${sl.dataset.key}`); if (dv) dv.textContent=v;
        });
        body.querySelectorAll(".mb[data-meid]").forEach(btn => {
          const on = this._sv(btn.dataset.meid,"off")==="on";
          btn.className = "mb"+(on?" muted":"");
          btn.innerHTML = (on?I.voff:I.von)+" "+(on?"Unmute":"Mute");
        });
        return;
      }

      if (!zones.length&&!groups.length) { body.innerHTML=`<div class="empty">No volume entities found.</div>`; return; }

      const vrow = (key,lbl,val,eid,meid,muted) => {
        let h=`<div class="vrow">
          <span class="vlbl">${x(lbl)}</span>
          <input class="vs" type="range" min="0" max="100" step="1" value="${val}" data-entity="${eid}" data-key="${key}">
          <span class="vv" id="vv-${key}">${val}</span>
        </div>`;
        if (meid) h+=`<div class="vrow" style="margin-bottom:6px">
          <span class="vlbl" style="font-size:11px;color:#3a4060">Mute</span>
          <button class="mb${muted?" muted":""}" data-meid="${meid}">${muted?I.voff:I.von} ${muted?"Unmute":"Mute"}</button>
        </div>`;
        return h;
      };

      let html="";
      if (zones.length) {
        html+=`<div class="slbl">Zone volumes</div>`;
        zones.forEach((z,i)=>{
          const v=Math.round(parseFloat(this._sv(z.volume_entity,"0"))||0);
          const m=z.mute_switch?this._sv(z.mute_switch,"off")==="on":false;
          html+=vrow(`z${i}`,z.label||"Zone "+(i+1),v,z.volume_entity,z.mute_switch,m);
        });
      }
      if (groups.length) {
        if (zones.length) html+=`<div class="div"></div>`;
        html+=`<div class="slbl">Group volumes</div>`;
        groups.forEach((g,i)=>{
          const v=Math.round(parseFloat(this._sv(g.volume_entity,"0"))||0);
          const m=g.mute_switch?this._sv(g.mute_switch,"off")==="on":false;
          html+=vrow(`g${i}`,g.label||"Group "+(i+1),v,g.volume_entity,g.mute_switch,m);
        });
      }
      body.innerHTML = html;

      body.querySelectorAll(".vs").forEach(sl => {
        const key=sl.dataset.key;
        sl.addEventListener("mousedown",  ()=>{ this._drag[key]=true; });
        sl.addEventListener("touchstart", ()=>{ this._drag[key]=true; },{passive:true});
        sl.addEventListener("input",  ()=>{ const d=body.querySelector(`#vv-${key}`); if(d)d.textContent=sl.value; });
        sl.addEventListener("change", ()=>{ this._drag[key]=false; this._call("number","set_value",{entity_id:sl.dataset.entity,value:parseFloat(sl.value)}); });
        sl.addEventListener("mouseup",  ()=>{ this._drag[key]=false; });
        sl.addEventListener("touchend", ()=>{ this._drag[key]=false; });
      });
      body.querySelectorAll(".mb[data-meid]").forEach(btn => btn.addEventListener("click", ()=>{
        const on=this._sv(btn.dataset.meid,"off")==="on";
        this._call("switch",on?"turn_off":"turn_on",{entity_id:btn.dataset.meid});
      }));
    }

    /* ═══ SEQUENCES ══════════════════════════════════════════
       Compact UI: one dropdown listing every sequence and function
       (grouped via <optgroup>), plus a Run button. Saves vertical
       space when many sequences exist and keeps the card compact. */
    _seq() {
      const body = this._el("seqb");
      if (!body) return;
      /* Skip rebuild if the dropdown is already rendered — selection state is
         preserved across the periodic _live() updates. */
      if (body.querySelector(".seq-pick")) return;

      const seqs = this._disc?.sequences || [];
      if (!seqs.length) {
        body.innerHTML = `<div class="empty">No sequences found.<br>Create sequences in the MHUB app — they appear here automatically.</div>`;
        return;
      }

      const norm = seqs.filter(s => s.kind === "sequence" || !s.kind);
      const fns  = seqs.filter(s => s.kind === "function");

      /* Build the option list. Use optgroup when both kinds are present. */
      const opt = (s) => `<option value="${x(s.entity)}">${x(s.name)}</option>`;
      let options = "";
      if (norm.length && fns.length) {
        options =
          `<optgroup label="Sequences">${norm.map(opt).join("")}</optgroup>` +
          `<optgroup label="Functions">${fns.map(opt).join("")}</optgroup>`;
      } else {
        options = (norm.length ? norm : fns).map(opt).join("");
      }

      const label = (norm.length && fns.length) ? "Sequences &amp; Functions"
                  : norm.length                  ? "Sequences"
                  :                                "Functions";

      body.innerHTML = `
        <div class="slbl">${label}</div>
        <div class="seq-pick">
          <select id="seq-select" aria-label="Choose a sequence">${options}</select>
          <button class="seq-run" id="seq-run">${I.play}<span>Run</span></button>
        </div>`;

      const sel = body.querySelector("#seq-select");
      const run = body.querySelector("#seq-run");

      const fire = () => {
        const eid = sel && sel.value;
        if (!eid) return;
        this._call("button", "press", { entity_id: eid });
        /* Confirmation flash, mirrors the old per-button feedback */
        run.classList.add("fired");
        setTimeout(() => run.classList.remove("fired"), 1200);
      };

      if (run) run.addEventListener("click", fire);
      /* Pressing Enter while the select is focused also triggers Run */
      if (sel) sel.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { e.preventDefault(); fire(); }
      });
    }

    /* ═══ IR / CEC ═══════════════════════════════════════════ */
    _ir() {
      const body = this._el("irb");
      if (!body) return;
      const irs  = this._disc?.ir_devices ||[];
      const cecs = this._disc?.cec_devices||[];

      /* Only skip rebuild if we already have real IR buttons rendered.
         Do NOT bail if body only has the empty-state div — the async
         registry fetch may not have completed yet when we first render. */
      if (body.querySelector(".irdev")) return;

      if (!irs.length&&!cecs.length) { body.innerHTML=`<div class="empty">No IR or CEC devices found.<br>Make sure IR packs are assigned to ports in the MHUB app, then reload the integration.</div>`; return; }

      /* Track which pack sections are expanded so re-renders preserve state. */
      if (!this._irOpen) this._irOpen = new Set();

      /* Split a device name into { pack, location }.
         Integration name patterns (see button.py):
           IR source  → "Source - {pack}"
           IR display → "{zone} (Output X) - {pack}"  or  "Display - {pack}"
           CEC        → "CEC - {zone}"               (we group these by the part after " - " too)
         We split on the LAST " - " so pack names that themselves contain " - "
         (rare, but possible) survive intact. */
      const splitPack = (name) => {
        const s = String(name || "");
        const i = s.lastIndexOf(" - ");
        if (i < 0) return { pack: s || "Other", location: "" };
        return { pack: s.slice(i + 3).trim() || "Other", location: s.slice(0, i).trim() };
      };

      const chev = `<svg class="irdchev" viewBox="0 0 24 24"><path d="M8 5l8 7-8 7z"/></svg>`;

      /* Group a flat list of devices by pack name, preserving original order. */
      const groupByPack = (devs) => {
        const map = new Map();
        devs.forEach(d => {
          const { pack, location } = splitPack(d.name);
          if (!map.has(pack)) map.set(pack, { pack, locations: [] });
          map.get(pack).locations.push({
            location: location || d.name,
            commands: d.commands || []
          });
        });
        return [...map.values()];
      };

      const block = (devs, lbl) => {
        const packs = groupByPack(devs);
        let h = `<div class="slbl">${lbl}</div>`;
        packs.forEach(p => {
          const key   = lbl + "::pack::" + p.pack;
          const open  = this._irOpen.has(key) ? " open" : "";
          const total = p.locations.reduce((n, l) => n + l.commands.length, 0);
          h += `<details class="irdev"${open} data-irkey="${x(key)}">`
             +   `<summary class="irdsum">${chev}<span class="irdtitle">${x(p.pack)}</span><span class="irdcount">${total}</span></summary>`
             +   `<div class="irdbody">`;
          /* If the pack only has one location, render commands flat — no need
             for a sub-heading. Otherwise show each location as a sub-section. */
          if (p.locations.length === 1) {
            h += `<div class="irg">`;
            p.locations[0].commands.forEach(c => {
              h += `<button class="irb" data-eid="${x(c.entity)}">${x(c.name)}</button>`;
            });
            h += `</div>`;
          } else {
            p.locations.forEach((loc, idx) => {
              h += `<div class="irloc${idx === 0 ? " first" : ""}">${x(loc.location)}</div>`
                 + `<div class="irg">`;
              loc.commands.forEach(c => {
                h += `<button class="irb" data-eid="${x(c.entity)}">${x(c.name)}</button>`;
              });
              h += `</div>`;
            });
          }
          h += `</div></details>`;
        });
        return h;
      };

      let html = "";
      if (irs.length)  html += block(irs,  "IR commands");
      if (cecs.length) { if (irs.length) html += `<div class="div"></div>`; html += block(cecs, "CEC commands"); }
      body.innerHTML = html;

      /* Persist open/closed state across re-renders */
      body.querySelectorAll("details.irdev").forEach(det => {
        det.addEventListener("toggle", () => {
          const k = det.dataset.irkey;
          if (!k) return;
          if (det.open) this._irOpen.add(k);
          else          this._irOpen.delete(k);
        });
      });

      body.querySelectorAll(".irb").forEach(btn => btn.addEventListener("click", () => {
        if (btn.dataset.eid) this._call("button", "press", { entity_id: btn.dataset.eid });
        btn.classList.add("fired"); setTimeout(() => btn.classList.remove("fired"), 700);
      }));
    }

    /* ═══ DIAGNOSTICS ════════════════════════════════════════ */
    _diag() {
      const body = this._el("diagb");
      if (!body) return;
      const d    = this._disc;

      /* MHUBStatusSensor puts all diagnostic_attrs() into extra_state_attributes.
         Re-read live from hass.states so firmware/model updates propagate. */
      const statusState = d?.status ? (this._hass?.states?.[d.status] || null) : null;
      const attrs = statusState ? (statusState.attributes || {}) : (d?._diagAttrs || {});

      const isOn = !d?.power_switch || this._sv(d.power_switch,"on")==="on";
      const mdl  = attrs.model        || "—";
      const fw   = attrs.firmware     || "—";
      const api  = attrs.api_version  || "—";
      const ins  = attrs.inputs  != null ? String(attrs.inputs)  : "—";
      const outs = attrs.outputs != null ? String(attrs.outputs) : "—";
      /* Hub name/serial come from status sensor state attributes too */
      const statAttrs = d?.status ? (this._hass?.states?.[d.status]?.attributes || {}) : {};
      const hubName   = statAttrs.name || "—";
      const serial    = statAttrs.serial_number || "—";

      body.innerHTML=`
        <div class="dgrid">
          <div class="dcell"><div class="dkey">Status</div><div class="dval ${isOn?"ok":"warn"}">${isOn?"Online":"Standby"}</div></div>
          <div class="dcell"><div class="dkey">Model</div><div class="dval">${x(mdl)}</div></div>
          <div class="dcell"><div class="dkey">Inputs</div><div class="dval">${x(ins)}</div></div>
          <div class="dcell"><div class="dkey">Outputs</div><div class="dval">${x(outs)}</div></div>
        </div>
        <div class="div"></div>
        <div class="drow"><span class="dk">Hub name</span><span class="dv">${x(hubName)}</span></div>
        <div class="drow"><span class="dk">Firmware</span><span class="dv">${x(fw)}</span></div>
        <div class="drow"><span class="dk">API version</span><span class="dv">${x(api)}</span></div>
        <div class="drow"><span class="dk">Serial number</span><span class="dv">${x(serial)}</span></div>
        <div class="drow"><span class="dk">Zones discovered</span><span class="dv">${d?.zones?.length||0}</span></div>
        <div class="drow"><span class="dk">Sequences found</span><span class="dv">${d?.sequences?.length||0}</span></div>`;
    }
  }

  customElements.define("mhub-card", MhubCard);

  window.customCards = window.customCards || [];
  window.customCards.push({
    type: "mhub-card",
    name: "MHUB Card",
    description: "Self-configuring card for the MHUB matrix switcher. No setup needed.",
    preview: true,
  });

  console.info(
    `%c MHUB-CARD %c v${VERSION} `,
    "background:#3b8aff;color:#fff;font-weight:bold;padding:2px 4px;border-radius:4px 0 0 4px",
    "background:#0d0f14;color:#3b8aff;font-weight:bold;padding:2px 4px;border-radius:0 4px 4px 0"
  );
})();
