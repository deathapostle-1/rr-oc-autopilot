// ==UserScript==
// @name         RR OC Autopilot
// @version      0.1.0
// @author       TXM [1712536]
// @description  Ruthless Reborn OC Autopilot
// @match        https://www.torn.com/factions.php*
// @grant        GM.xmlHttpRequest
// @grant        GM_xmlhttpRequest
// @connect      api.torn.com
// @connect      tornprobability.com
// @license      MIT
// @updateURL    https://raw.githubusercontent.com/deathapostle-1/RR-OC-Autopilot/main/RR-OC-Autopilot.user.js
// @downloadURL  https://raw.githubusercontent.com/deathapostle-1/RR-OC-Autopilot/main/RR-OC-Autopilot.user.js
// ==/UserScript==

(function () {
  "use strict";

  /* ---------- faction config [switch to API-driven] ---------- */
  const PDA_KEY = "###PDA-APIKEY###"; // Torn PDA fills this in automatically
  const LEVEL_DEFAULT = 68; // fallback CPR
  const AMBER_BAND = 4; // nearly eligible

  const THRESHOLDS = {
    blastfromthepast: { roles: { picklock1: 65, hacker: 65, engineer: 65, bomber: 65, muscle: 65, picklock2: 60 } },
    stackingthedeck: { roles: { hacker: 70, imitator: 70, catburglar: 70, driver: 60 } },
    aceinthehole: { roles: { hacker: 67, driver: 57, muscle1: 67, imitator: 67, muscle2: 67 } },
    breakthebank: { roles: { robber: 67, muscle1: 67, thief1: 60, muscle2: 67, muscle3: 67, thief2: 67 } },
    clinicalprecision: { roles: { assassin: 70, catburglar: 70, cleaner: 70, imitator: 70 } },
    manifestcruelty: { roles: { hacker: 65, interrogator: 65, reviver: 69, catburglar: 65 } },
    gonefission: { roles: { imitator: 63, pickpocket: 63, bomber: 63, hijacker: 60, engineer: 63 } },
    cranereaction: { roles: { lookout: 60, sniper: 61, bomber: 60, engineer: 59, muscle1: 60, muscle2: 60 } },
    windowofopportunity: { roles: { muscle1: 65, muscle2: 65, looter1: 65, looter2: 65, engineer: 65 } },
    honeytrap: { default: 70 },
    leavenotrace: { default: 65 },
    stagefright: { default: 65 },
    snowblind: { default: 65 },
    petproject: { default: 65 },
    cashmeifyoucan: { default: 65 },
    smokeandwingmirrors: { default: 65 },
    marketforces: { default: 65 },
    noreserve: { default: 65 },
  };

  // how much each role matters to its crime (%)
  const ROLE_WEIGHTS = {
    aceinthehole: { imitator: 21.1, muscle1: 18.3, muscle2: 24.7, hacker: 28.3, driver: 7.6 },
    bestofthelot: { picklock: 20.7, carthief: 19.5, muscle: 43.7, imitator: 16.1 },
    biddingwar: { robber1: 7.1, driver: 12.5, robber2: 22.9, robber3: 31.7, bomber1: 7.8, bomber2: 18 },
    blastfromthepast: { picklock1: 10.8, hacker: 12.1, engineer: 24, bomber: 15.6, muscle: 34.6, picklock2: 2.9 },
    breakthebank: { robber: 12.7, muscle1: 13.5, muscle2: 10.1, thief1: 2.9, muscle3: 31.7, thief2: 29.1 },
    cashmeifyoucan: { thief1: 54.2, thief2: 28, lookout: 17.8 },
    clinicalprecision: { imitator: 43.3, catburglar: 18.9, assassin: 16.1, cleaner: 21.7 },
    counteroffer: { robber: 35.9, looter: 7, hacker: 12.1, picklock: 16.5, engineer: 28.4 },
    cranereaction: { sniper: 40.7, lookout: 16.6, engineer: 8.3, bomber: 15.9, muscle1: 10.7, muscle2: 7.8 },
    firstaidandabet: { picklock: 26, decoy: 30.7, pickpocket: 43.2 },
    gaslighttheway: { imitator1: 9.4, imitator2: 27.5, imitator3: 41.3, looter1: 9.4, looter2: 0, looter3: 12.4 },
    gonefission: { hijacker: 24.9, engineer: 15.6, pickpocket: 16.5, imitator: 24.9, bomber: 18 },
    guardianngels: { enforcer: 27.4, hustler: 42.1, engineer: 30.5 },
    honeytrap: { enforcer: 27, muscle1: 30.9, muscle2: 42.2 },
    leavenotrace: { techie: 29, negotiator: 34.1, imitator: 36.9 },
    manifestcruelty: { hacker: 16.3, interrogator: 23.5, reviver: 46.3, catburglar: 13.9 },
    marketforces: { enforcer: 29.4, negotiator: 27.2, lookout: 16.4, arsonist: 4.5, muscle: 22.5 },
    mobmentality: { looter1: 34, looter2: 26.5, looter3: 18.4, looter4: 21.2 },
    noreserve: { carthief: 30.5, techie: 38.4, engineer: 31.1 },
    petproject: { kidnapper: 30.9, muscle: 32.6, picklock: 36.4 },
    pluckingthelotuspetal: { robber1: 14, hustler: 14.4, robber2: 23.7, muscle: 47.9 },
    smokeandwingmirrors: { carthief: 50.9, imitator: 27.1, hustler1: 9, hustler2: 13 },
    sneakygitgrab: { imitator: 17.5, pickpocket: 50.8, hacker: 14.5, techie: 17.1 },
    snowblind: { hustler: 48.4, imitator: 34.6, muscle1: 8.5, muscle2: 8.5 },
    stackingthedeck: { catburglar: 23.4, driver: 3, hacker: 25.4, imitator: 48.2 },
    stagefright: { enforcer: 15.7, muscle1: 20, muscle2: 2.7, muscle3: 9.2, lookout: 6.2, sniper: 46.3 },
    thoushaltnotsteal: { thief: 12.4, pickpocket: 37.9, picklock: 49.7 },
    windowofopportunity: { engineer: 14.6, looter1: 19.5, looter2: 25.8, muscle1: 23.1, muscle2: 17 },
  };

  const FACTION_COLOURS = { accent: "#029e7a", dark: "#1f1f1f" };

  const SHEL = { id: "3940892", note: "Tom doesn't care" };

  // Torn's art folder names that don't match the crime's display name
  const SLUG_ALIASES = { pier_pressure: "manifestcruelty", boom_or_bust: "cranereaction" };

  /* ---------- helpers ---------- */
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
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const safe = (label, fn, fallback = undefined) => {
    try {
      return fn();
    } catch (e) {
      console.warn(`[RR OC Autopilot] ${label}:`, e);
      return fallback;
    }
  };

  function requiredFor(key, roleNorm) {
    const t = THRESHOLDS[key];
    if (t && t.roles && roleNorm in t.roles) return t.roles[roleNorm];
    if (t && t.default != null) return t.default;
    return LEVEL_DEFAULT;
  }

  const viewerId = () => (document.cookie.match(/(?:^|;\s*)uid=(\d+)/) || [])[1] || null;
  const isShel = () => viewerId() === SHEL.id;

  function resolveScenarioKey(title, slug) {
    const t = norm(title);
    if (THRESHOLDS[t] || ROLE_WEIGHTS[t]) return t;
    if (slug) {
      if (SLUG_ALIASES[slug]) return SLUG_ALIASES[slug];
      const s = norm(slug.replace(/_\d+$/, ""));
      if (THRESHOLDS[s] || ROLE_WEIGHTS[s]) return s;
    }
    return t || null;
  }

  const weightFor = (key, roleNorm) => ROLE_WEIGHTS[key]?.[roleNorm] ?? null;

  /* ---------- Torn API key ---------- */
  function apiKey() {
    if (PDA_KEY && !PDA_KEY.includes("###")) return PDA_KEY;
    try {
      return localStorage.getItem("rr_oc_api_key") || "";
    } catch (e) {
      return "";
    }
  }

  // GM request if available, else plain fetch; returns parsed JSON
  function requestJson({ method = "GET", url, body }) {
    const gmx =
      (typeof GM_xmlhttpRequest === "function" && GM_xmlhttpRequest) ||
      (typeof GM !== "undefined" && GM && GM.xmlHttpRequest) ||
      null;
    if (gmx) {
      return new Promise((resolve, reject) => {
        gmx({
          method,
          url,
          headers: body ? { "Content-Type": "application/json" } : {},
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
      headers: body ? { "Content-Type": "application/json" } : {},
      body: body ? JSON.stringify(body) : undefined,
    }).then((r) => r.json());
  }

  const UNAVAILABLE = {
    Hospital: { verb: "Hospitalized", colour: "#e03131" },
    Traveling: { verb: "Traveling", colour: "#74c0fc" },
    Abroad: { verb: "Abroad", colour: "#74c0fc" },
    Jail: { verb: "Jailed", colour: "#a1632a" },
    Federal: { verb: "Fedded", colour: "#0a0a0a" },
  };

  const TornApi = {
    members: null,
    fetchedAt: 0,
    async refresh() {
      const key = apiKey();
      if (!key) return;
      if (Date.now() - this.fetchedAt < 5 * 60 * 1000) return;
      this.fetchedAt = Date.now();
      try {
        const r = await requestJson({ url: `https://api.torn.com/v2/faction/members?key=${encodeURIComponent(key)}` });
        if (r && Array.isArray(r.members)) {
          this.members = {};
          for (const m of r.members)
            this.members[m.id] = {
              name: m.name,
              state: m.status?.state || "",
              until: m.status?.until || null,
              description: m.status?.description || "",
            };
          renderAll(true);
        }
      } catch (e) {
        // Wow, this was the fix to Flamers script all along...
      }
    },
    statusFor(xid) {
      return this.members?.[xid] || null;
    },
  };

  function humanUntil(until) {
    if (!until) return "";
    let s = Math.max(0, Math.floor(until - Date.now() / 1000));
    const d = Math.floor(s / 86400);
    s -= d * 86400;
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const parts = d ? [`${d}d`, `${h}h`] : h ? [`${h}h`, `${m}m`] : [`${m}m`];
    return ` — back in ${parts.join(" ")}`;
  }

  // success chance calculation
  const Success = {
    api: "https://tornprobability.com:3000/api/",
    roles: null,
    loading: false,
    cache: new Map(),
    queue: [],
    busy: false,
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
      this.queue.push({ scenario, params, key, cb });
      this.pump();
    },
    pump() {
      if (this.busy || !this.queue.length) return;
      this.busy = true;
      const job = this.queue.shift();
      requestJson({ method: "POST", url: this.api + "CalculateSuccess", body: { scenario: job.scenario, parameters: job.params } })
        .then((r) => {
          if (r && typeof r.successChance === "number") {
            this.cache.set(job.key, r.successChance);
            job.cb(r.successChance);
          }
        })
        .catch(() => {})
        .finally(() => setTimeout(() => {
          this.busy = false;
          this.pump();
        }, 250));
    },
  };

  /* ---------- styles ---------- */
  const STYLE = `
  .rr-weight{box-sizing:border-box;width:calc(100% - 10px);margin:5px auto;padding:3px 4px;
    border-radius:4px;text-align:center;background:${FACTION_COLOURS.dark};
    border:1px solid rgba(2,158,122,.45);display:block}
  .rr-weight .rr-l{font-size:10px;letter-spacing:1px;color:${FACTION_COLOURS.accent};opacity:.95}
  .rr-weight .rr-v{font-size:16px;font-weight:700;color:#fff}

  /* reframe Torn's role header to match the weight box stacked below it */
  .rr-role.rr-role{box-sizing:border-box;width:calc(100% - 10px);margin:5px auto !important;
    border:1px solid rgba(2,158,122,.45) !important;border-radius:4px !important;
    background:${FACTION_COLOURS.dark} !important}
  .rr-success{margin:2px 0 4px;font-weight:700;color:${FACTION_COLOURS.accent} !important}
  .rr-success small{font-weight:400;opacity:.7}
  .rr-unknown{margin:4px 0;padding:4px 8px;border-radius:4px;font-size:12px;
    background:rgba(240,140,0,.18);border:1px solid rgba(240,140,0,.6);color:#ffb84d}

  .rr-avail{display:flex;flex-wrap:wrap;gap:5px;margin:3px 0 5px}
  .rr-chip{position:relative;display:inline-flex;align-items:center;gap:5px;padding:2px 9px;
    border-radius:10px;font-size:11px;font-weight:600;background:${FACTION_COLOURS.dark};
    border:1px solid #444;color:#ddd;cursor:default;line-height:1.5}
  .rr-chip .rr-pip{width:8px;height:8px;border-radius:50%;flex:none;
    box-shadow:0 0 0 1px rgba(255,255,255,.28)}
  .rr-chip .rr-tip{display:none;position:absolute;bottom:calc(100% + 7px);left:0;z-index:99999;
    background:${FACTION_COLOURS.dark};border:1px solid ${FACTION_COLOURS.accent};color:#eee;font-weight:400;
    padding:5px 9px;border-radius:5px;white-space:nowrap;box-shadow:0 3px 12px rgba(0,0,0,.6);
    pointer-events:none}
  .rr-chip:hover .rr-tip,.rr-chip.rr-open .rr-tip{display:block}

  /* threshold fill + matching outline. The infill is a translucent inset
     shadow (not a flat background) so it tints the slot without smothering it;
     the matching ring is the outer glow. !important keeps it above TornTools.
     Outline/fill only — never blocks interaction. */
  .rr-fill-green,.rr-fill-amber,.rr-fill-red,.rr-fill-grey{border-radius:5px}
  .rr-fill-green{box-shadow:inset 0 0 0 200px rgba(2,158,122,.42),0 0 0 2px #029e7a,0 0 9px rgba(2,158,122,.5) !important}
  .rr-fill-amber{box-shadow:inset 0 0 0 200px rgba(219,123,43,.5),0 0 0 2px #db7b2b,0 0 8px rgba(219,123,43,.45) !important}
  .rr-fill-red{box-shadow:inset 0 0 0 200px rgba(204,50,50,.5),0 0 0 2px #cc3232,0 0 8px rgba(204,50,50,.45) !important}
  .rr-fill-grey{box-shadow:inset 0 0 0 200px rgba(38,38,38,.72),0 0 0 2px rgba(150,150,150,.55) !important}

  /* Recruiting open slot you can't join — click-blocking tag */
  .rr-lock{position:absolute;inset:0;z-index:40;display:flex;align-items:flex-end;
    justify-content:center;cursor:not-allowed;padding:5px}
  .rr-lock span{background:rgba(31,31,31,.94);border:1px solid rgba(150,150,150,.5);color:#cfcfcf;
    font-size:10px;font-weight:600;padding:2px 8px;border-radius:8px;line-height:1.4;text-align:center}
  .rr-egg{margin:4px auto 2px;width:95%;text-align:center;font-size:11px;font-style:italic;
    color:${FACTION_COLOURS.accent};opacity:.9}

  .rr-toolbar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin:8px 0;padding:8px 12px;
    background:${FACTION_COLOURS.dark};border:1px solid rgba(2,158,122,.5);border-radius:6px}
  .rr-brand{color:${FACTION_COLOURS.accent};font-weight:700;font-size:12px;letter-spacing:1.5px}
  .rr-brand small{color:#8a8a8a;font-weight:600;letter-spacing:1px}
  .rr-right{margin-left:auto;display:flex;gap:8px;align-items:center}
  .rr-toolbar select,.rr-toolbar input{background:#2a2a2a;color:#ddd;border:1px solid #444;
    border-radius:4px;padding:3px 6px;font-size:12px}
  .rr-api{background:transparent;border:1px solid ${FACTION_COLOURS.accent};color:${FACTION_COLOURS.accent};
    border-radius:4px;padding:3px 10px;cursor:pointer;font-size:11px;font-weight:700;letter-spacing:1px}
  .rr-api:hover{background:${FACTION_COLOURS.accent};color:#fff}
  .rr-api.rr-on{background:${FACTION_COLOURS.accent};color:#fff}
  .rr-hidden-panel{display:none !important}
  `;

  /* ---------- panel parsing ---------- */
  function parsePanel(panel) {
    const title = q(panel, sel("panelTitle"))?.textContent.trim() || "";
    const slugEl = q(panel, '[style*="organizedCrimes/scenario"]');
    const slug = slugEl?.getAttribute("style")?.match(/scenario\/([a-z0-9_]+)\//)?.[1] || null;
    const level = parseInt(q(panel, sel("levelValue"))?.textContent || "0", 10);
    const key = resolveScenarioKey(title, slug);
    const slots = qa(panel, sel("slotHeader")).map((header) => {
      const wrap = header.parentElement;
      const role = q(header, sel("title"))?.textContent.trim() || "";
      const chance = parseFloat(q(header, sel("successChance"))?.textContent || "");
      const profile = q(wrap, 'a[href*="profiles.php?XID="]');
      const xid = profile ? profile.href.match(/XID=(\d+)/)?.[1] : null;
      return { wrap, header, role, roleNorm: norm(role), chance: isNaN(chance) ? null : chance, xid };
    });
    return { panel, ocId: panel.getAttribute("data-oc-id"), title, slug, level, key, slots };
  }

  /* ---------- renderers ---------- */
  function renderWeight(slot, key) {
    const w = weightFor(key, slot.roleNorm);
    const old = slot.wrap.querySelector(".rr-weight");
    if (w == null) {
      old?.remove();
      return;
    }
    const html = `<div class="rr-l">WEIGHT</div><div class="rr-v">${Number(w).toFixed(1)}%</div>`;
    if (old) old.innerHTML = html;
    else slot.wrap.appendChild(el("div", "rr-weight", html));
  }

  function renderSuccess(info, tab) {
    const { panel, title, slots } = info;
    let line = panel.querySelector(".rr-success");
    // Recruiting slots aren't filled yet, so a success % is meaningless there
    if (tab === "Recruiting") {
      line?.remove();
      return;
    }
    const titleEl = q(panel, sel("panelTitle"));
    if (!titleEl || !slots.length || !slots.every((s) => s.chance != null)) {
      line?.remove();
      return;
    }
    Success.ensureRoles();
    const scenario = Success.scenarioName(title);
    const order = scenario && Success.order(scenario);
    if (!order) {
      line?.remove();
      return;
    }
    const params = Array(order.length).fill(null);
    for (const s of slots) {
      const i = order.indexOf(s.roleNorm);
      if (i >= 0) params[i] = s.chance;
    }
    if (params.some((p) => p == null)) {
      line?.remove();
      return;
    }
    if (!line) {
      line = el("p", "rr-success");
      titleEl.after(line);
    }
    const show = (v) => {
      if (line.isConnected) line.textContent = `Success: ${(v * 100).toFixed(2)}%`;
    };
    const key = scenario + "|" + params.join(",");
    if (Success.cache.has(key)) show(Success.cache.get(key));
    else {
      line.innerHTML = `Success: <small>calculating…</small>`;
      Success.get(scenario, params, show);
    }
  }

  function renderUnknownBanner(info) {
    const { panel, key } = info;
    const known = !!(THRESHOLDS[key] || ROLE_WEIGHTS[key]);
    const existing = panel.querySelector(".rr-unknown");
    if (known) {
      existing?.remove();
      return;
    }
    if (!existing) {
      const msg = isShel()
        ? `⚠ New scenario — ${SHEL.note}.`
        : `⚠ New scenario — RR default requirement ${LEVEL_DEFAULT} applies until the script is updated.`;
      q(panel, sel("panelTitle"))?.after(el("div", "rr-unknown", msg));
    }
  }

  function renderAvailability(info, tab) {
    const { panel, slots } = info;
    panel.querySelector(".rr-avail")?.remove();
    if (tab === "Completed" || !TornApi.members) return;
    const chips = [];
    for (const s of slots) {
      if (!s.xid) continue;
      const st = TornApi.statusFor(s.xid);
      const meta = st && UNAVAILABLE[st.state];
      if (!meta) continue;
      chips.push(
        `<span class="rr-chip"><span class="rr-pip" style="background:${meta.colour}"></span>${esc(st.name)}<span class="rr-tip">${esc(st.name)} is ${meta.verb}${esc(humanUntil(st.until))}${st.description ? ` · ${esc(st.description)}` : ""}</span></span>`
      );
    }
    if (chips.length) q(panel, sel("panelTitle"))?.after(el("div", "rr-avail", chips.join("")));
  }

  const relative = (e) => {
    if (getComputedStyle(e).position === "static") e.style.position = "relative";
  };
  const FILL = ["rr-fill-green", "rr-fill-amber", "rr-fill-red", "rr-fill-grey"];
  function clearSlot(wrap) {
    wrap.querySelector(".rr-lock")?.remove();
    wrap.querySelector(".rr-egg")?.remove();
    wrap.classList.remove(...FILL);
  }
  function fillState(chance, required, shel) {
    if (shel || chance >= required) return "green";
    if (chance >= required - AMBER_BAND) return "amber";
    return "red";
  }

  function renderSlotState(info, tab) {
    const { panel, key, slots } = info;
    const shel = isShel();
    const onRecruiting = tab === "Recruiting";
    const onPlanning = tab === "Planning";
    const onCompleted = tab === "Completed";
    let openCount = 0,
      eligibleCount = 0;
    for (const s of slots) {
      clearSlot(s.wrap);
      s.header.classList.add("rr-role"); // frame to match the weight box
      if (!onRecruiting && !onPlanning && !onCompleted) continue;
      if (s.chance == null) continue;
      const required = requiredFor(key, s.roleNorm);

      if (onRecruiting && !s.xid) {
        openCount++;
        if (shel || s.chance >= required) {
          eligibleCount++;
          s.wrap.classList.add("rr-fill-green");
          if (shel) s.wrap.appendChild(el("div", "rr-egg", esc(SHEL.note)));
        } else {
          relative(s.wrap);
          s.wrap.classList.add("rr-fill-grey");
          s.wrap.appendChild(el("div", "rr-lock", `<span>Not Eligible: Requires: ${required}+</span>`));
        }
      } else {
        s.wrap.classList.add("rr-fill-" + fillState(s.chance, required, shel));
      }
    }
    panel.dataset.rrAutoHide = onRecruiting && openCount > 0 && eligibleCount === 0 ? "1" : "0";
  }

  /* ---------- tabs / toolbar / visibility ---------- */
  function activeTab() {
    const btn = document.querySelector(`${sel("buttonsContainer")} button${sel("active")}`);
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
        <span class="rr-brand">RUTHLESS REBORN <small>· OC AUTOPILOT</small></span>
        <span class="rr-right">
          <select class="rr-sort">
            <option value="default">Sort: default</option>
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
      // inline input rather than prompt() — works everywhere, PDA included
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
          } catch (e) {
            // storage unavailable
          }
          input.remove();
          ok.remove();
          apiBtn.style.display = "";
          syncApiBtn();
          TornApi.fetchedAt = 0;
          TornApi.members = null;
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
    if (list && st.sort !== "default") {
      list.style.display = "flex";
      list.style.flexDirection = "column";
    }
    const metric = {
      "level-desc": (p) => -(+p.dataset.rrLevel || 0),
      "level-asc": (p) => +p.dataset.rrLevel || 0,
      "open-desc": (p) => -(+p.dataset.rrOpen || 0),
    }[st.sort];
    if (metric) [...panels].sort((a, b) => metric(a) - metric(b)).forEach((p, i) => (p.style.order = i));
    else panels.forEach((p) => (p.style.order = ""));
    for (const p of panels) {
      p.classList.toggle("rr-hidden-panel", tab === "Recruiting" && p.dataset.rrAutoHide === "1");
    }
  }

  /* ---------- per-panel pipeline ---------- */
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
      safe("weights", () => renderWeight(s, info.key));
    }
    safe("success", () => renderSuccess(info, tab));
    safe("banner", () => renderUnknownBanner(info));
    safe("availability", () => renderAvailability(info, tab));
    safe("slot-state", () => renderSlotState(info, tab));

    safe("dataset", () => {
      panel.dataset.rrLevel = info.level || "";
      panel.dataset.rrOpen = info.slots.filter((s) => !s.xid).length;
      panel.dataset.rrTitle = info.title;
    });
  }

  /* ---------- main loop ---------- */
  function renderAll(force = false) {
    const tab = safe("tab", activeTab, null);
    if (force) qa(document, "div[data-oc-id]").forEach((p) => delete p.dataset.rrFp);
    for (const p of qa(document, "div[data-oc-id]")) safe("panel", () => processPanel(p, tab));
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
    document.addEventListener("click", (e) => {
      const chip = e.target.closest?.(".rr-chip");
      qa(document, ".rr-chip.rr-open").forEach((c) => c !== chip && c.classList.remove("rr-open"));
      chip?.classList.toggle("rr-open");
    });
    const root = document.querySelector("#faction-crimes-root") || document.body;
    new MutationObserver(scheduleRender).observe(root, { childList: true, subtree: true });
    window.addEventListener("hashchange", () => setTimeout(() => safe("render", () => renderAll(true)), 300));
    renderAll();
  });
})();
