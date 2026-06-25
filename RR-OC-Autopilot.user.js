// ==UserScript==
// @name         RR OC Autopilot
// @version      0.11.2
// @author       TXM [1712536]
// @description  Ruthless Reborn OC Autopilot
// @match        https://www.torn.com/factions.php*
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @connect      tornprobability.com
// @connect      api.torn.zzcraft.net
// @license      MIT
// @updateURL    https://raw.githubusercontent.com/deathapostle-1/rr-oc-autopilot/main/RR-OC-Autopilot.user.js
// @downloadURL  https://raw.githubusercontent.com/deathapostle-1/rr-oc-autopilot/main/RR-OC-Autopilot.user.js
// ==/UserScript==

(function () {
  "use strict";

  /* ============================================================================
     RR OC Autopilot
     ============================================================================ */
  const AMBER_BAND = 4;
  const ZZCRAFT = { factionId: 8062, base: "https://api.torn.zzcraft.net" };
  const FACTION_COLOURS = { accent: "#029e7a", dark: "#1f1f1f" };
  const SLUG_ALIASES = {
    pier_pressure: "manifestcruelty",
    boom_or_bust: "cranereaction",
  };

  const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
  const sel = (prefix) => `[class*="${prefix}___"]`;
  const q = (root, s) => root.querySelector(s);
  const qa = (root, s) => Array.from(root.querySelectorAll(s));
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  };
  const safe = (label, fn, fallback = undefined) => {
    try {
      return fn();
    } catch (e) {
      console.warn(`[RR OC Autopilot] ${label}:`, e);
      return fallback;
    }
  };

  function requiredFor(key, roleNorm) {
    const t = Config.thresholds?.[key];
    return t && roleNorm in t ? t[roleNorm] : null;
  }

  function resolveScenarioKey(title, slug) {
    const t = norm(title);
    if (Config.has(t)) return t;
    if (slug) {
      if (SLUG_ALIASES[slug]) return SLUG_ALIASES[slug];
      const s = norm(slug.replace(/_\d+$/, ""));
      if (Config.has(s)) return s;
    }
    return t || null;
  }

  const weightFor = (key, roleNorm) =>
    Config.weights?.[key]?.[roleNorm] ?? null;

  /* ============================================================================
     API KEY / NETWORKING / CONFIG
     ============================================================================ */
  function apiKey() {
    try {
      return localStorage.getItem("rr_oc_api_key") || "";
    } catch (e) {
      return "";
    }
  }

  function requestJson({ method = "GET", url, body, headers }) {
    const hdrs = Object.assign(
      body ? { "Content-Type": "application/json" } : {},
      headers || {},
    );
    const gmx =
      (typeof GM_xmlhttpRequest === "function" && GM_xmlhttpRequest) ||
      (typeof GM !== "undefined" && GM && GM.xmlHttpRequest) ||
      null;
    if (!gmx) return Promise.reject(new Error("GM_xmlhttpRequest unavailable"));
    return new Promise((resolve, reject) => {
      gmx({
        method,
        url,
        headers: hdrs,
        data: body ? JSON.stringify(body) : null,
        timeout: 15000,
        onload: (r) => {
          try {
            resolve(JSON.parse(r.responseText));
          } catch (e) {
            reject(e);
          }
        },
        onerror: reject,
        ontimeout: () => reject(new Error("timeout")),
      });
    });
  }

  const STATUS_VIS = {
    Okay: { timed: false },
    Hospital: { timed: true },
    Jail: { timed: true },
    Federal: { timed: true },
    Traveling: { timed: false },
    Abroad: { timed: false },
  };
  const STATUS_ICON = {
    Okay: `<svg width="14" height="14" viewBox="0 0 24 24"><circle cx="12" cy="12" r="6" fill="#2f9e44"/></svg>`,
    Hospital: `<svg width="14" height="14" viewBox="0 0 24 24" fill="#e03131"><path d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7z"/></svg>`,
    Jail: `<svg width="14" height="14" viewBox="0 0 24 24" fill="#c98a52"><rect x="3.5" y="2" width="3" height="20" rx="1"/><rect x="10.5" y="2" width="3" height="20" rx="1"/><rect x="17.5" y="2" width="3" height="20" rx="1"/></svg>`,
    Traveling: `<svg width="14" height="14" viewBox="0 0 24 24" fill="#74c0fc"><path d="M22 12c0-.7-.6-1.3-1.3-1.3L14 10l-4-7H8l2 7-4 .3L4 8H2.5l1 4-1 4H4l2-2.3 4 .3-2 7h2l4-7 6.7-.7c.7 0 1.3-.6 1.3-1.3z"/></svg>`,
  };
  STATUS_ICON.Federal = STATUS_ICON.Jail;
  STATUS_ICON.Abroad = STATUS_ICON.Traveling;

  const TornApi = {
    members: null,
    fetchedAt: 0,
    async refresh() {
      const key = apiKey();
      if (!key) return;
      if (Date.now() - this.fetchedAt < 5 * 60 * 1000) return;
      this.fetchedAt = Date.now();
      try {
        const r = await requestJson({
          url: `https://api.torn.com/v2/faction/members?key=${encodeURIComponent(key)}`,
        });
        if (r && Array.isArray(r.members)) {
          this.members = {};
          for (const m of r.members) {
            this.members[m.id] = {
              state: m.status?.state || "",
              until: m.status?.until || 0,
              description: m.status?.description || "",
            };
          }
          renderAll(true);
        }
      } catch (e) {}
    },
    statusFor(xid) {
      return this.members?.[xid] || null;
    },
  };

  const FactionCrimes = {
    byId: null,
    fetchedAt: 0,
    async refresh() {
      const key = apiKey();
      if (!key) return;
      if (Date.now() - this.fetchedAt < 5 * 60 * 1000) return;
      this.fetchedAt = Date.now();
      try {
        const r = await requestJson({
          url: `https://api.torn.com/v2/faction/crimes?key=${encodeURIComponent(key)}`,
        });
        if (r && Array.isArray(r.crimes)) {
          const map = {};
          for (const c of r.crimes) {
            const roles = {};
            for (const s of c.slots || []) {
              const req = s.item_requirement;
              if (req) {
                roles[norm(s.position)] = { id: req.id, available: req.is_available !== false };
              }
            }
            map[c.id] = { roles, status: c.status };
          }
          this.byId = map;
          renderAll(true);
        }
      } catch (e) {}
    },
    missingItem(ocId, roleNorm) {
      const r = this.byId?.[ocId]?.roles?.[roleNorm];
      return r && !r.available ? r : null;
    },
    failed(ocId) {
      return /fail/i.test(this.byId?.[ocId]?.status || "");
    },
  };

  const Success = {
    api: "https://tornprobability.com:3000/api/",
    roles: null,
    loading: false,
    cache: new Map(),
    queue: [],
    busy: false,
    busyJob: null,
    ensureRoles() {
      if (this.roles || this.loading) return;
      this.loading = true;
      requestJson({ url: this.api + "GetRoleNames" })
        .then((r) => {
          this.roles = r || {};
          this.loading = false;
          renderAll(true);
        })
        .catch(() => {
          this.loading = false;
        });
    },
    scenarioName(title) {
      if (!this.roles) return null;
      const t = norm(title);
      return Object.keys(this.roles).find((k) => norm(k) === t) || null;
    },
    order(scenario) {
      const map = this.roles?.[scenario];
      if (!map) return null;
      return Object.keys(map)
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map((k) => norm(map[k]));
    },
    get(scenario, params, cb) {
      const key = scenario + "|" + params.join(",");
      if (this.cache.has(key)) {
        cb(this.cache.get(key));
        return;
      }
      const pending =
        this.queue.find((j) => j.key === key) ||
        (this.busyJob?.key === key ? this.busyJob : null);
      if (pending) {
        pending.cbs.push(cb);
        return;
      }
      this.queue.push({ scenario, params, key, cbs: [cb], tries: 0 });
      this.pump();
    },
    pump() {
      if (this.busy || !this.queue.length) return;
      this.busy = true;
      const job = (this.busyJob = this.queue.shift());
      requestJson({
        method: "POST",
        url: this.api + "CalculateSuccess",
        body: { scenario: job.scenario, parameters: job.params },
      })
        .then((r) => {
          if (!r || typeof r.successChance !== "number") {
            throw new Error("bad response");
          }
          this.cache.set(job.key, r.successChance);
          job.cbs.forEach((cb) => cb(r.successChance));
        })
        .catch(() => {
          if (++job.tries < 3) this.queue.push(job);
          else job.cbs.forEach((cb) => cb(null));
        })
        .finally(() =>
          setTimeout(() => {
            this.busy = false;
            this.busyJob = null;
            this.pump();
          }, 250),
        );
    },
  };

  /* ============================================================================
     FACTION THRESHOLDS / WEIGHTS / CONFIG LIVE FROM ZZCRAFT
     ============================================================================ */
  const Config = {
    thresholds: null,
    weights: null,
    loading: false,
    at: 0,
    ttl: 6 * 60 * 60 * 1000,
    has(key) {
      return !!(this.thresholds && (this.thresholds[key] || this.weights[key]));
    },
    build(arr) {
      const th = {},
        wt = {};
      for (const sc of arr) {
        const k = norm(sc.name);
        th[k] = {};
        wt[k] = {};
        for (const r of sc.roles || []) {
          const rk = norm(r.label);
          if (r.minimumSuccessChance != null) {
            th[k][rk] = r.minimumSuccessChance;
          }
          if (r.weight != null) wt[k][rk] = r.weight;
        }
      }
      this.thresholds = th;
      this.weights = wt;
    },
    load() {
      try {
        const c = JSON.parse(localStorage.getItem("rr_oc_config") || "null");
        if (c && Array.isArray(c.data)) {
          this.build(c.data);
          this.at = c.at || 0;
        }
      } catch (e) {}
      if (Date.now() - this.at > this.ttl) this.fetch();
    },
    fetch() {
      const key = apiKey();
      if (!key || this.loading) return;
      this.loading = true;
      requestJson({
        url: `${ZZCRAFT.base}/Factions/${ZZCRAFT.factionId}/OrganizedCrimes/thresholds`,
        headers: { "X-Api-Key": key },
      })
        .then((data) => {
          if (!Array.isArray(data)) throw new Error("bad config");
          this.build(data);
          this.at = Date.now();
          try {
            localStorage.setItem(
              "rr_oc_config",
              JSON.stringify({ data, at: this.at }),
            );
          } catch (e) {}
          this.loading = false;
          renderAll(true);
        })
        .catch(() => {
          this.loading = false;
        });
    },
  };

  /* ============================================================================
     STYLE / DOM RENDERING
     ============================================================================ */
    const STYLE = `.rr-meta {
    box-sizing: border-box;
    display: flex;
    gap: 4px;
    width: calc(100% - 10px);
    margin: 5px auto;
    position: relative;
    z-index: 1
  }

  .rr-meta .rr-cell {
    flex: 1;
    min-width: 0;
    padding: 3px 4px;
    border-radius: 4px;
    text-align: center;
    background:${FACTION_COLOURS.dark};
    border: 1px solid rgba(2, 158, 122, .45)
  }

  .rr-meta .rr-l {
    font-size: 10px;
    letter-spacing: .5px;
    color:${FACTION_COLOURS.accent};
    opacity: .95
  }

  .rr-meta .rr-v {
    font-size: 11px;
    font-weight: 700;
    color: #fff
  }

  .rr-cp {
    box-sizing: border-box;
    width: calc(100% - 10px);
    height: 4px;
    margin: 0 auto 5px;
    border-radius: 2px;
    overflow: hidden;
    background: var(--oc-clock-bg, rgba(255, 255, 255, .12))
  }

  .rr-cp > i {
    display: block;
    height: 100%;
    background:${FACTION_COLOURS.accent}
  }

  .rr-cp.rr-amber > i {
    background: #db7b2b
  }

  .rr-cp.rr-fail > i {
    background: #cc3232
  }

  .rr-role.rr-role {
    box-sizing: border-box;
    width: 100% !important;
    margin: 0 !important;
    border: none !important;
    border-radius: 6px 6px 0 0 !important;
    background:${FACTION_COLOURS.dark} !important;
    padding: 0 6px 0 20px !important
  }

  #faction-crimes-root [class*="slotIcon___"] {
    display: none !important
  }

  #faction-crimes-root [class*="slotHeader___"] [class*="title___"] {
    color: #fff !important
  }

  #faction-crimes-root [class*="slotHeader___"].rr-item-missing [class*="title___"] {
    color: #cc3232 !important
  }

  .rr-success small {
    font-weight: 400;
    opacity: .7
  }

  .rr-info {
    display: flex;
    align-items: center;
    flex: 0 0 auto;
    margin: 0 6px;
    min-width: 0
  }

  .rr-success {
    position: relative;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    padding: 2px 10px;
    border-radius: 10px;
    font-size: 12px;
    font-weight: 700;
    line-height: 1.5;
    white-space: nowrap;
    color: #fff !important;
    background:${FACTION_COLOURS.dark};
    border: 1px solid var(--rr-c, #444);
    box-shadow: 0 0 7px -1px var(--rr-c, transparent);
    cursor: default
  }

  .rr-pip {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex: none;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, .28)
  }

  .rr-stat {
    position: absolute;
    top: 3px;
    left: 4px;
    width: 14px;
    height: 14px;
    z-index: 5;
    pointer-events: none;
    display: flex
  }

  .rr-stat svg {
    display: block
  }

  .rr-fill-green,
  .rr-fill-amber,
  .rr-fill-red,
  .rr-fill-grey {
    position: relative;
    border-radius: 6px;
    background: #2b2b2b !important
  }

  .rr-fill-green {
    box-shadow: 0 0 0 2px #029e7a, 0 0 9px rgba(2, 158, 122, .5) !important
  }

  .rr-fill-amber {
    box-shadow: 0 0 0 2px #db7b2b, 0 0 8px rgba(219, 123, 43, .45) !important
  }

  .rr-fill-red {
    box-shadow: 0 0 0 2px #cc3232, 0 0 8px rgba(204, 50, 50, .45) !important
  }

  .rr-fill-grey {
    box-shadow: 0 0 0 2px rgba(150, 150, 150, .6), 0 0 8px rgba(150, 150, 150, .3) !important
  }

  #faction-crimes-root [class*="slotBody___"] {
    background: transparent !important;
    border-color: transparent !important
  }

  .tt-oc-highlight .rr-fill-green,
  .tt-oc-highlight .rr-fill-amber,
  .tt-oc-highlight .rr-fill-red,
  .tt-oc-highlight .rr-fill-grey {
    outline: 2px solid rgba(0, 0, 0, .6) !important;
    outline-offset: 2px
  }

  .rr-lock {
    position: absolute;
    inset: 0;
    z-index: 40;
    display: flex;
    align-items: flex-end;
    justify-content: center;
    cursor: not-allowed;
    padding: 5px
  }

  .rr-lock span {
    background: rgba(31, 31, 31, .94);
    border: 1px solid rgba(150, 150, 150, .5);
    color: #cfcfcf;
    font-size: 10px;
    font-weight: 600;
    padding: 2px 8px;
    border-radius: 8px;
    line-height: 1.4;
    text-align: center
  }

  .rr-toolbar {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    align-items: center;
    margin: 8px 0;
    padding: 8px 12px;
    background:${FACTION_COLOURS.dark};
    border: 1px solid rgba(2, 158, 122, .5);
    border-radius: 6px
  }

  .rr-brand {
    color:${FACTION_COLOURS.accent};
    font-weight: 700;
    font-size: 12px;
    letter-spacing: 1.5px
  }

  .rr-brand small {
    color: #8a8a8a;
    font-weight: 600;
    letter-spacing: 1px
  }

  .rr-count {
    font-size: 11px;
    color: #8a8a8a;
    white-space: nowrap
  }

  .rr-right {
    margin-left: auto;
    display: flex;
    gap: 8px;
    align-items: center
  }

  .rr-toolbar select,
  .rr-toolbar input {
    background: #2a2a2a;
    color: #ddd;
    border: 1px solid #444;
    border-radius: 4px;
    padding: 3px 6px;
    font-size: 12px
  }

  .rr-api {
    background: transparent;
    border:1px solid ${FACTION_COLOURS.accent};
    color:${FACTION_COLOURS.accent};
    border-radius: 4px;
    padding: 3px 10px;
    cursor: pointer;
    font-size: 11px;
    font-weight: 700;
    letter-spacing: 1px
  }

  .rr-api:hover {
    background:${FACTION_COLOURS.accent};
    color: #fff
  }

  .rr-api.rr-on {
    background:${FACTION_COLOURS.accent};
    color: #fff
  }

  .rr-legend {
    display: flex;
    gap: 10px;
    flex-wrap: wrap;
    align-items: center;
    font-size: 11px;
    color: #b9c1bd
  }

  .rr-legend span {
    display: inline-flex;
    align-items: center;
    gap: 4px
  }

  .rr-legend i {
    width: 10px;
    height: 10px;
    border-radius: 2px;
    display: inline-block
  }

  body:not(.dark-mode) .rr-fill-green,
  body:not(.dark-mode) .rr-fill-amber,
  body:not(.dark-mode) .rr-fill-red,
  body:not(.dark-mode) .rr-fill-grey {
    background: #e2e4e6 !important
  }

  body:not(.dark-mode) .rr-role.rr-role {
    background: #d4d7da !important
  }

  body:not(.dark-mode) #faction-crimes-root [class*="slotHeader___"] [class*="title___"] {
    color: #2a2a2a !important
  }

  body:not(.dark-mode) #faction-crimes-root [class*="slotHeader___"].rr-item-missing [class*="title___"] {
    color: #cc3232 !important
  }

  body:not(.dark-mode) .rr-meta .rr-cell {
    background: #eef0f1
  }

  body:not(.dark-mode) .rr-meta .rr-v {
    color: #222
  }

  body:not(.dark-mode) .rr-success {
    background: #eef0f1;
    color: #222 !important
  }

  body:not(.dark-mode) .rr-cp {
    background: rgba(0, 0, 0, .12)
  }

  body:not(.dark-mode) .rr-legend i {
    box-shadow: 0 0 0 1px rgba(0, 0, 0, .25)
  }`;

  /* ============================================================================
     RENDERING / PANEL PARSING
     ============================================================================ */
  function parsePanel(panel) {
    const title = q(panel, sel("panelTitle"))?.textContent.trim() || "";
    const slugEl = q(panel, '[style*="organizedCrimes/scenario"]');
    const slug =
      slugEl?.getAttribute("style")?.match(/scenario\/([a-z0-9_]+)\//)?.[1] ||
      null;
    const level = parseInt(q(panel, sel("levelValue"))?.textContent || "0", 10);
    const key = resolveScenarioKey(title, slug);
    const slots = qa(panel, sel("slotHeader")).map((header) => {
      const wrap = header.parentElement;
      const role = q(header, sel("title"))?.textContent.trim() || "";
      const chance = parseFloat(
        q(header, sel("successChance"))?.textContent || "",
      );
      const profile = q(wrap, 'a[href*="profiles.php?XID="]');
      const xid = profile ? profile.href.match(/XID=(\d+)/)?.[1] : null;
      return {
        wrap,
        header,
        role,
        roleNorm: norm(role),
        chance: isNaN(chance) ? null : chance,
        xid,
      };
    });
    return {
      panel,
      ocId: panel.getAttribute("data-oc-id"),
      title,
      level,
      key,
      slots,
    };
  }

  const panelNodes = new Map();
  function cacheNode(ocId, kind, node) {
    if (!ocId) return;
    let rec = panelNodes.get(ocId);
    if (!rec) panelNodes.set(ocId, (rec = {}));
    if (node) rec[kind] = node;
    else delete rec[kind];
  }
  function guardPresence() {
    for (const [ocId, rec] of panelNodes) {
      const panel = document.querySelector(`div[data-oc-id="${ocId}"]`);
      const titleEl = panel && q(panel, sel("panelTitle"));
      if (!titleEl) continue;
      const node = rec.info;
      if (node && !panel.contains(node)) titleEl.after(node);
    }
  }

  function renderMeta(slot, key) {
    const w = weightFor(key, slot.roleNorm);
    const req = requiredFor(key, slot.roleNorm);
    const html =
      `<div class="rr-cell"><div class="rr-l">Min</div><div class="rr-v">${req == null ? "--" : req}</div></div>` +
      `<div class="rr-cell"><div class="rr-l">Weight</div><div class="rr-v">${w == null ? "--.--%" : Number(w).toFixed(2) + "%"}</div></div>`;
    const old = slot.wrap.querySelector(".rr-meta");
    if (old) {
      if (old.innerHTML !== html) old.innerHTML = html;
    } else slot.wrap.appendChild(el("div", "rr-meta", html));
  }

  function renderCheckpoint(slot) {
    const ocId = slot.wrap
      .closest("div[data-oc-id]")
      ?.getAttribute("data-oc-id");
    const failed =
      FactionCrimes.failed(ocId) || !!slot.wrap.closest(sel("failed"));
    const ring = slot.wrap.querySelector(sel("planning"));
    const deg = ring && (ring.getAttribute("style") || "").match(/([\d.]+)deg/);
    let bar = slot.wrap.querySelector(".rr-cp");
    if (!failed && !deg) {
      bar?.remove();
      return;
    }
    if (!bar) {
      bar = el("div", "rr-cp", "<i></i>");
      slot.wrap.insertBefore(bar, slot.wrap.querySelector(".rr-meta"));
    }
    const pctNum = failed
      ? 100
      : Math.max(0, Math.min(100, Math.round(parseFloat(deg[1]) / 3.6)));
    bar.classList.toggle("rr-fail", failed);
    bar.classList.toggle("rr-amber", !failed && pctNum < 100);
    const pct = pctNum + "%";
    if (bar.firstChild.style.width !== pct) bar.firstChild.style.width = pct;
  }

  function renderInfoRow(info, tab) {
    const { panel, ocId, title, slots } = info;
    const titleEl = q(panel, sel("panelTitle"));
    let row = panel.querySelector(".rr-info") || panelNodes.get(ocId)?.info;
    qa(panel, ".rr-info").forEach((r) => r !== row && r.remove());
    const drop = () => {
      row?.remove();
      cacheNode(ocId, "info", null);
      cacheNode(ocId, "success", null);
    };

    let pill = null,
      queue = null;
    if (
      tab !== "Recruiting" &&
      titleEl &&
      slots.length &&
      slots.every((s) => s.chance != null)
    ) {
      Success.ensureRoles();
      const scenario = Success.scenarioName(title);
      const order = scenario && Success.order(scenario);
      if (order) {
        const params = Array(order.length).fill(null);
        for (const s of slots) {
          const i = order.indexOf(s.roleNorm);
          if (i >= 0) params[i] = s.chance;
        }
        if (!params.some((p) => p == null)) {
          pill =
            panel.querySelector(".rr-success") ||
            panelNodes.get(ocId)?.success ||
            el("span", "rr-success");
          cacheNode(ocId, "success", pill);
          const line = pill;
          const show = (v) => {
            if (panelNodes.get(ocId)?.success !== line) return;
            if (v == null) {
              line.style.removeProperty("--rr-c");
              line.innerHTML = `<span class="rr-pip" style="background:#868e96"></span>Success: n/a`;
              return;
            }
            const c =
              v >= 0.75
                ? FACTION_COLOURS.accent
                : v >= 0.5
                  ? "#db7b2b"
                  : "#cc3232";
            line.style.setProperty("--rr-c", c);
            line.innerHTML = `<span class="rr-pip" style="background:${c}"></span>Success: ${(v * 100).toFixed(2)}%`;
            panel.dataset.rrSuccess = (v * 100).toFixed(2); // for the success sort
            if (Toolbar.state.sort.startsWith("success")) {
              safe("sort", applyVisibility);
            }
          };
          const key = scenario + "|" + params.join(",");
          if (Success.cache.has(key)) show(Success.cache.get(key));
          else {
            if (!/%/.test(line.textContent)) {
              line.innerHTML = `<span class="rr-pip" style="background:#868e96"></span>Success: …`;
            }
            queue = () => Success.get(scenario, params, show);
          }
        }
      }
    }
    if (!pill) return drop();
    if (!row) row = el("div", "rr-info");
    qa(panel, ".rr-success").forEach((p) => p !== pill && p.remove());
    if (row.firstChild !== pill) row.prepend(pill);
    if (!panel.contains(row)) titleEl?.after(row);
    cacheNode(ocId, "info", row);
    if (queue) queue();
  }

  const relative = (e) => {
    if (getComputedStyle(e).position === "static") {
      e.style.position = "relative";
    }
  };
  const FILL = [
    "rr-fill-green",
    "rr-fill-amber",
    "rr-fill-red",
    "rr-fill-grey",
  ];
  function clearSlot(wrap) {
    wrap.querySelector(".rr-lock")?.remove();
    wrap.classList.remove(...FILL);
  }
  function fillState(chance, required) {
    if (chance >= required) return "green";
    if (chance >= required - AMBER_BAND) return "amber";
    return "red";
  }

  function renderStatusIcon(s, onCompleted) {
    let icon = s.wrap.querySelector(".rr-stat");
    const st =
      !onCompleted && s.xid && TornApi.members
        ? TornApi.statusFor(s.xid)
        : null;
    const svg = st && STATUS_ICON[st.state];
    if (!svg) {
      icon?.remove();
      return;
    }
    if (!icon) {
      icon = el("span", "rr-stat");
      relative(s.wrap);
      s.wrap.appendChild(icon);
    }
    if (icon.dataset.st !== st.state) {
      icon.dataset.st = st.state;
      icon.innerHTML = svg;
    }
  }

  function humanLeft(secs) {
    const d = Math.floor(secs / 86400),
      h = Math.floor((secs % 86400) / 3600),
      m = Math.floor((secs % 3600) / 60);
    if (d) return `${d}d ${h}h`;
    if (h) return `${h}h ${m}m`;
    if (m) return `${m}m`;
    return `${secs}s`;
  }

  function slotWrapOf(elm) {
    for (let e = elm; e && e !== document.body; e = e.parentElement) {
      if (e.querySelector?.(`:scope > ${sel("slotHeader")}`)) return e;
    }
    return null;
  }

  function tooltipNode(node) {
    if (!(node instanceof Element)) return null;
    if (
      node.matches('[class*="tooltip___"]') ||
      node.hasAttribute("data-floating-ui-focusable")
    ) {
      return node;
    }
    return node.querySelector?.('[class*="tooltip___"]') || null;
  }

  function tooltipTrigger(tip) {
    if (tip.id) {
      const ref = document.querySelector(`[aria-describedby~="${tip.id}"]`);
      if (ref) return ref;
    }
    return [...document.querySelectorAll(":hover")].pop() || null;
  }

  function statusText(st) {
    const vis = st && STATUS_VIS[st.state];
    if (!vis) return null;
    if (st.state === "Okay") return "Available";
    if (vis.timed && st.until) {
      const left = st.until - Math.floor(Date.now() / 1000);
      return left > 0 ? `${st.state} — out in ${humanLeft(left)}` : st.state;
    }
    if (st.state === "Traveling" || st.state === "Abroad") {
      return st.description || st.state;
    }
    return null;
  }

  function applyTooltipStatus(tip) {
    if (!TornApi.members) return;
    const wrap = slotWrapOf(tooltipTrigger(tip));
    if (!wrap) return;
    const xid = wrap
      .querySelector('a[href*="profiles.php?XID="]')
      ?.href.match(/XID=(\d+)/)?.[1];
    const st = xid && TornApi.statusFor(xid);
    const text = st && statusText(st);
    if (!text) return;
    const top = qa(tip, sel("section"))[0];
    if (!top) return;
    const iconDiv = q(top, sel("icon"));
    const textEl = [...top.children].find((c) => c !== iconDiv) || top;
    if (textEl.textContent === text) return; // idempotent — icon set alongside, avoids a loop
    // overwrite Torn's planning row with our status icon + text
    textEl.textContent = text;
    if (iconDiv && STATUS_ICON[st.state]) iconDiv.innerHTML = STATUS_ICON[st.state];
  }

  // the tooltip is React-managed and re-renders (e.g. live planning %), reverting a one-shot
  // edit — so re-apply on every change. The observer callback runs before paint => no flicker.
  function augmentTooltip(tip) {
    if (tip.__rrObs) return;
    const apply = () => safe("tooltip", () => applyTooltipStatus(tip));
    tip.__rrObs = new MutationObserver(apply);
    apply();
    tip.__rrObs.observe(tip, {
      childList: true,
      subtree: true,
      characterData: true,
    });
  }

  function renderSlotState(info, tab) {
    const { key, slots, ocId } = info;
    const onRecruiting = tab === "Recruiting";
    const onPlanning = tab === "Planning";
    const onCompleted = tab === "Completed";
    for (const s of slots) {
      clearSlot(s.wrap);
      s.header.classList.add("rr-role");
      s.header.classList.toggle(
        "rr-item-missing",
        !!s.xid && !!FactionCrimes.missingItem(ocId, s.roleNorm),
      );
      if (!onRecruiting && !onPlanning && !onCompleted) continue;
      renderStatusIcon(s, onCompleted);
      if (s.chance == null) continue;
      const required = requiredFor(key, s.roleNorm);

      if (onRecruiting && !s.xid) {
        if (required == null) {
          s.wrap.classList.add("rr-fill-grey");
        } else {
          const state = fillState(s.chance, required);
          s.wrap.classList.add("rr-fill-" + state);
          if (state === "red") {
            relative(s.wrap);
            s.wrap.appendChild(
              el(
                "div",
                "rr-lock",
                `<span>Not Eligible: Requires: ${required}+</span>`,
              ),
            );
          }
        }
      } else {
        s.wrap.classList.add(
          required == null
            ? "rr-fill-grey"
            : "rr-fill-" + fillState(s.chance, required),
        );
      }
    }
  }

  /* ============================================================================
     TABS / TOOLBAR / VISIBILITY
     ============================================================================ */
  function activeTab() {
    const btn = document.querySelector(
      `${sel("buttonsContainer")} button${sel("active")}`,
    );
    return btn ? q(btn, sel("tabName"))?.textContent.trim() || null : null;
  }

  function listContainer() {
    return document.querySelector("div[data-oc-id]")?.parentElement || null;
  }

  const Toolbar = {
    state: { sort: "default" },
    ensure(tab) {
      const existing = document.querySelector(".rr-toolbar");
      if (tab !== "Recruiting" && tab !== "Planning") {
        existing?.remove();
        return;
      }
      const list = listContainer();
      if (!list || existing) return;
      const bar = el("div", "rr-toolbar");
      bar.innerHTML = `
        <span class="rr-brand">RR <small>· OC AUTOPILOT</small></span>
        <span class="rr-count"></span>
        <span class="rr-legend">
          <span><i style="background:#029e7a"></i>Eligible</span>
          <span><i style="background:#db7b2b"></i>Close</span>
          <span><i style="background:#cc3232"></i>Below</span>
          <span><i style="background:#6a6a6a"></i>No data</span>
        </span>
        <span class="rr-right">
          <select class="rr-sort">
            <option value="default">Sort: default</option>
            <option value="eligibility-desc">Eligibility ↓</option>
            <option value="success-desc">Success ↓</option>
            <option value="success-asc">Success ↑</option>
            <option value="level-desc">Level ↓</option>
            <option value="level-asc">Level ↑</option>
            <option value="open-desc">Open slots ↓</option>
          </select>
          <button class="rr-api" type="button">API</button>
        </span>
      `;
      list.before(bar);
      bar.querySelector(".rr-sort").value = this.state.sort;
      bar.querySelector(".rr-sort").addEventListener("change", (e) => {
        this.state.sort = e.target.value;
        applyVisibility();
      });
      const apiBtn = bar.querySelector(".rr-api");
      const syncApiBtn = () => apiBtn.classList.toggle("rr-on", !!apiKey());
      syncApiBtn();
      apiBtn.title = "Torn API key (Limited Access) for member status + items";
      apiBtn.addEventListener("click", () => {
        if (bar.querySelector(".rr-api-input")) return;
        const input = el("input", "rr-api-input");
        input.type = "text";
        input.placeholder = "Torn API key (Limited Access) — blank clears";
        input.style.width = "230px";
        const ok = el("button", "rr-api", "SAVE");
        apiBtn.before(input, ok);
        apiBtn.style.display = "none";
        input.focus();
        ok.addEventListener("click", () => {
          try {
            const v = input.value.trim();
            if (v) localStorage.setItem("rr_oc_api_key", v);
            else localStorage.removeItem("rr_oc_api_key");
          } catch (e) {}
          input.remove();
          ok.remove();
          apiBtn.style.display = "";
          syncApiBtn();
          TornApi.fetchedAt = 0;
          TornApi.members = null;
          FactionCrimes.fetchedAt = 0;
          FactionCrimes.byId = null;
          Config.fetch();
          renderAll(true);
        });
      });
    },
  };

  function applyVisibility() {
    const panels = qa(document, "div[data-oc-id]");
    const list = listContainer();
    const st = Toolbar.state;
    if (list) {
      const sorting = st.sort !== "default";
      list.style.display = sorting ? "flex" : "";
      list.style.flexDirection = sorting ? "column" : "";
    }
    const metric = {
      "eligibility-desc": (p) => -(+p.dataset.rrJoinable || 0),
      "success-desc": (p) =>
        p.dataset.rrSuccess ? -p.dataset.rrSuccess : Infinity,
      "success-asc": (p) =>
        p.dataset.rrSuccess ? +p.dataset.rrSuccess : Infinity,
      "level-desc": (p) => -(+p.dataset.rrLevel || 0),
      "level-asc": (p) => +p.dataset.rrLevel || 0,
      "open-desc": (p) => -(+p.dataset.rrOpen || 0),
    }[st.sort];
    if (metric) {
      [...panels]
        .sort((a, b) => metric(a) - metric(b))
        .forEach((p, i) => (p.style.order = i));
    } else panels.forEach((p) => (p.style.order = ""));
    const countEl = document.querySelector(".rr-count");
    if (countEl) {
      const joinable = panels.filter((p) => +p.dataset.rrJoinable > 0).length;
      countEl.textContent = `${panels.length} OCs${joinable ? ` · ${joinable} joinable` : ""}`;
    }
  }

  /* ============================================================================
     PER-PANEL PROCESSING
     ============================================================================ */
  function processPanel(panel, tab) {
    const info = safe("parse", () => parsePanel(panel));
    if (!info || !info.key || !info.slots.length) return;
    const fp = [
      info.key,
      tab,
      TornApi.fetchedAt,
      FactionCrimes.fetchedAt,
      info.slots.map((s) => `${s.roleNorm}:${s.chance}:${s.xid}`).join("|"),
    ].join("§");
    if (panel.dataset.rrFp === fp) return;
    panel.dataset.rrFp = fp;

    for (const s of info.slots) {
      safe("checkpoint", () => renderCheckpoint(s));
      safe("meta", () => renderMeta(s, info.key));
    }
    safe("info", () => renderInfoRow(info, tab));
    safe("slot-state", () => renderSlotState(info, tab));

    safe("dataset", () => {
      panel.dataset.rrLevel = info.level || "";
      panel.dataset.rrOpen = info.slots.filter((s) => !s.xid).length;
      panel.dataset.rrJoinable = info.slots.filter((s) => {
        if (s.xid || s.chance == null) return false;
        const req = requiredFor(info.key, s.roleNorm);
        return req == null || s.chance >= req - AMBER_BAND;
      }).length;
    });
  }

  /* ============================================================================
     MAIN LOOP / ENTRY POINT
     ============================================================================ */
  function renderAll(force = false) {
    const tab = safe("tab", activeTab, null);
    if (force) {
      qa(document, "div[data-oc-id]").forEach((p) => delete p.dataset.rrFp);
    }
    const live = new Set(
      qa(document, "div[data-oc-id]").map((p) => p.getAttribute("data-oc-id")),
    );
    for (const [ocId, rec] of panelNodes) {
      if (!live.has(ocId) && !rec.info?.isConnected) panelNodes.delete(ocId);
    }
    for (const p of qa(document, "div[data-oc-id]")) {
      safe("panel", () => processPanel(p, tab));
    }
    safe("toolbar", () => Toolbar.ensure(tab));
    safe("visibility", applyVisibility);
    safe("torn-api", () => TornApi.refresh());
    safe("faction-crimes", () => FactionCrimes.refresh());
  }

  function tickLive() {
    const tab = safe("tab", activeTab, null);
    if (tab !== "Planning" && tab !== "Recruiting" && tab !== "Completed") {
      return;
    }
    const onCompleted = tab === "Completed";
    for (const header of qa(document, `div[data-oc-id] ${sel("slotHeader")}`)) {
      const profile = q(header.parentElement, 'a[href*="profiles.php?XID="]');
      const s = {
        wrap: header.parentElement,
        xid: profile ? profile.href.match(/XID=(\d+)/)?.[1] : null,
      };
      safe("tick-cp", () => renderCheckpoint(s));
      safe("tick-icon", () => renderStatusIcon(s, onCompleted));
    }
  }

  let scheduled = false;
  function scheduleRender() {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      safe("render", renderAll);
    }, 120);
  }

  safe("init", () => {
    const style = document.createElement("style");
    style.textContent = STYLE;
    document.head.appendChild(style);
    const root =
      document.querySelector("#faction-crimes-root") || document.body;
    new MutationObserver(() => {
      safe("guard", guardPresence);
      scheduleRender();
    }).observe(root, { childList: true, subtree: true });
    new MutationObserver((muts) => {
      for (const mut of muts) {
        for (const n of mut.addedNodes) {
          const tip = tooltipNode(n);
          if (tip) safe("tooltip", () => augmentTooltip(tip));
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
    window.addEventListener("hashchange", () =>
      setTimeout(() => safe("render", () => renderAll(true)), 300),
    );
    safe("config", () => Config.load());
    setInterval(() => safe("tick", tickLive), 1000);
    renderAll();
  });
})();
