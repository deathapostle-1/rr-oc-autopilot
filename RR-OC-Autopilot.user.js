// ==UserScript==
// @name         RR OC Autopilot
// @version      0.10.2
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

  /* ---------- Helpers ---------- */
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
    if (gmx) {
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
    return fetch(url, {
      method,
      headers: hdrs,
      body: body ? JSON.stringify(body) : undefined,
    }).then((r) => r.json());
  }

  const STATUS_VIS = {
    Okay: { colour: "#2f9e44", timed: false },
    Hospital: { colour: "#e03131", timed: true },
    Jail: { colour: "#a1632a", timed: true },
    Federal: { colour: "#0a0a0a", timed: true },
    Traveling: { colour: "#74c0fc", timed: false },
    Abroad: { colour: "#74c0fc", timed: false },
  };
  const STATUS_RING_CAP = 60 * 60;

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
          for (const m of r.members)
            this.members[m.id] = {
              state: m.status?.state || "",
              until: m.status?.until || 0,
            };
          renderAll(true);
        }
      } catch (e) {}
    },
    statusFor(xid) {
      return this.members?.[xid] || null;
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
          if (!r || typeof r.successChance !== "number")
            throw new Error("bad response");
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
    loaded: false,
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
          if (r.minimumSuccessChance != null)
            th[k][rk] = r.minimumSuccessChance;
          if (r.weight != null) wt[k][rk] = r.weight;
        }
      }
      this.thresholds = th;
      this.weights = wt;
      this.loaded = true;
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

  .rr-circle {
    position: absolute;
    top: 4px;
    left: 6px;
    width: 12px;
    height: 12px;
    border-radius: 50%;
    z-index: 5;
    pointer-events: none;
    box-shadow: 0 0 0 1px rgba(255, 255, 255, .28)
  }

  .rr-circle.rr-ring::after {
    content: "";
    position: absolute;
    inset: 2px;
    border-radius: 50%;
    background:${FACTION_COLOURS.dark}
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

  .rr-hidden-panel {
    display: none !important
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
      slug,
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
      `<div class="rr-cell"><div class="rr-l">Weight</div><div class="rr-v">${w == null ? "--.--%" : Number(w).toFixed(1) + "%"}</div></div>`;
    const old = slot.wrap.querySelector(".rr-meta");
    if (old) {
      if (old.innerHTML !== html) old.innerHTML = html;
    } else slot.wrap.appendChild(el("div", "rr-meta", html));
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
            if (Toolbar.state.sort.startsWith("success"))
              safe("sort", applyVisibility);
          };
          const key = scenario + "|" + params.join(",");
          if (Success.cache.has(key)) show(Success.cache.get(key));
          else {
            if (!/%/.test(line.textContent))
              line.innerHTML = `<span class="rr-pip" style="background:#868e96"></span>Success: …`;
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
    if (getComputedStyle(e).position === "static")
      e.style.position = "relative";
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

  function renderStatusCircle(s, onCompleted) {
    let circle = s.wrap.querySelector(".rr-circle");
    const st =
      !onCompleted && s.xid && TornApi.members
        ? TornApi.statusFor(s.xid)
        : null;
    const vis = st && STATUS_VIS[st.state];
    if (!vis) {
      circle?.remove();
      return;
    }
    if (!circle) {
      circle = el("span", "rr-circle");
      relative(s.wrap);
      s.wrap.appendChild(circle);
    }
    if (vis.timed && st.until) {
      const frac = Math.max(
        0,
        Math.min(1, (st.until - Date.now() / 1000) / STATUS_RING_CAP),
      );
      circle.className = "rr-circle rr-ring";
      circle.style.background = `conic-gradient(${vis.colour} ${frac * 360}deg, rgba(255,255,255,.14) 0)`;
    } else {
      circle.className = "rr-circle";
      circle.style.background = vis.colour;
    }
  }

  function renderSlotState(info, tab) {
    const { panel, key, slots } = info;
    const onRecruiting = tab === "Recruiting";
    const onPlanning = tab === "Planning";
    const onCompleted = tab === "Completed";
    let openCount = 0,
      eligibleCount = 0;
    for (const s of slots) {
      clearSlot(s.wrap);
      s.header.classList.add("rr-role");
      if (!onRecruiting && !onPlanning && !onCompleted) continue;
      renderStatusCircle(s, onCompleted);
      if (s.chance == null) continue;
      const required = requiredFor(key, s.roleNorm);

      if (onRecruiting && !s.xid) {
        openCount++;
        if (required == null) {
          s.wrap.classList.add("rr-fill-grey");
          eligibleCount++;
        } else if (s.chance >= required) {
          eligibleCount++;
          s.wrap.classList.add("rr-fill-green");
        } else {
          relative(s.wrap);
          s.wrap.classList.add("rr-fill-grey");
          s.wrap.appendChild(
            el(
              "div",
              "rr-lock",
              `<span>Not Eligible: Requires: ${required}+</span>`,
            ),
          );
        }
      } else {
        s.wrap.classList.add(
          required == null
            ? "rr-fill-grey"
            : "rr-fill-" + fillState(s.chance, required),
        );
      }
    }
    panel.dataset.rrAutoHide =
      onRecruiting && openCount > 0 && eligibleCount === 0 ? "1" : "0";
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
        <span class="rr-right">
          <select class="rr-sort">
            <option value="default">Sort: default</option>
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
      apiBtn.title = "Torn API key for member availability";
      apiBtn.addEventListener("click", () => {
        if (bar.querySelector(".rr-api-input")) return;
        const input = el("input", "rr-api-input");
        input.type = "text";
        input.placeholder = "Torn API key (public) — blank clears";
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
          Config.fetch();
          renderAll(true);
        });
      });
    },
  };

  function applyVisibility() {
    const tab = activeTab();
    const panels = qa(document, "div[data-oc-id]");
    const list = listContainer();
    const st = Toolbar.state;
    if (list) {
      const sorting = st.sort !== "default";
      list.style.display = sorting ? "flex" : "";
      list.style.flexDirection = sorting ? "column" : "";
    }
    const metric = {
      "success-desc": (p) =>
        p.dataset.rrSuccess ? -p.dataset.rrSuccess : Infinity,
      "success-asc": (p) =>
        p.dataset.rrSuccess ? +p.dataset.rrSuccess : Infinity,
      "level-desc": (p) => -(+p.dataset.rrLevel || 0),
      "level-asc": (p) => +p.dataset.rrLevel || 0,
      "open-desc": (p) => -(+p.dataset.rrOpen || 0),
    }[st.sort];
    if (metric)
      [...panels]
        .sort((a, b) => metric(a) - metric(b))
        .forEach((p, i) => (p.style.order = i));
    else panels.forEach((p) => (p.style.order = ""));
    for (const p of panels) {
      p.classList.toggle(
        "rr-hidden-panel",
        tab === "Recruiting" && p.dataset.rrAutoHide === "1",
      );
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
      info.slots.map((s) => `${s.roleNorm}:${s.chance}:${s.xid}`).join("|"),
    ].join("§");
    if (panel.dataset.rrFp === fp) return;
    panel.dataset.rrFp = fp;

    for (const s of info.slots) {
      safe("meta", () => renderMeta(s, info.key));
    }
    safe("info", () => renderInfoRow(info, tab));
    safe("slot-state", () => renderSlotState(info, tab));

    safe("dataset", () => {
      panel.dataset.rrLevel = info.level || "";
      panel.dataset.rrOpen = info.slots.filter((s) => !s.xid).length;
      panel.dataset.rrTitle = info.title;
    });
  }

  /* ============================================================================
     MAIN LOOP / ENTRY POINT
     ============================================================================ */
  function renderAll(force = false) {
    const tab = safe("tab", activeTab, null);
    if (force)
      qa(document, "div[data-oc-id]").forEach((p) => delete p.dataset.rrFp);
    const live = new Set(
      qa(document, "div[data-oc-id]").map((p) => p.getAttribute("data-oc-id")),
    );
    for (const [ocId, rec] of panelNodes)
      if (!live.has(ocId) && !rec.info?.isConnected) panelNodes.delete(ocId);
    for (const p of qa(document, "div[data-oc-id]"))
      safe("panel", () => processPanel(p, tab));
    safe("toolbar", () => Toolbar.ensure(tab));
    safe("visibility", applyVisibility);
    safe("torn-api", () => TornApi.refresh());
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
    window.addEventListener("hashchange", () =>
      setTimeout(() => safe("render", () => renderAll(true)), 300),
    );
    safe("config", () => Config.load());
    renderAll();
  });
})();
