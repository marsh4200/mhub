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

  const VERSION = "6.1.1";

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
        </style>
        <div class="ed">
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
         if this is the first load. For subsequent config-changed events fired by the
         editor (e.g. toggling a source icon or alias), just re-render the current page
         so the nav tabs and user's position in the card are preserved. */
      if (!this._ready) {
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
      return `<div class="card">
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

    /* ═══ SWITCH ═════════════════════════════════════════════ */
    _sw() {
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
