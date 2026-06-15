// ==UserScript==
// @name         RR OC Autopilot
// @version      0.7.0
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

  /* ---------- faction config ---------- */
  const AMBER_BAND = 4; // nearly eligible
  // thresholds + weights come live from our ZZCraft backend, per faction,
  // authenticated with each user's own public Torn key (never a shared key)
  const ZZCRAFT = { factionId: 8062, base: "https://api.torn.zzcraft.net" };
  const FACTION_COLOURS = { accent: "#029e7a", dark: "#1f1f1f" };
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

  // null = no threshold configured for this role → no eligibility colour ("show nothing")
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

  const weightFor = (key, roleNorm) => Config.weights?.[key]?.[roleNorm] ?? null;

  /* ---------- Torn API key (the user's own public access key) ---------- */
  function apiKey() {
    try {
      return localStorage.getItem("rr_oc_api_key") || "";
    } catch (e) {
      return "";
    }
  }

  // GM request if available, else plain fetch; returns parsed JSON
  function requestJson({ method = "GET", url, body, headers }) {
    const hdrs = Object.assign(body ? { "Content-Type": "application/json" } : {}, headers || {});
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

  const STATUS = {
    Okay: { verb: "Available", colour: "#2f9e44" },
    Hospital: { verb: "Hospitalized", colour: "#e03131" },
    Traveling: { verb: "Traveling", colour: "#74c0fc" },
    Abroad: { verb: "Abroad", colour: "#74c0fc" },
    Jail: { verb: "Jailed", colour: "#a1632a" },
    Federal: { verb: "Fedded", colour: "#0a0a0a" },
  };
  const statusMeta = (state) => STATUS[state] || { verb: state || "Unknown", colour: "#868e96" };
  const isAway = (state) => !!state && state !== "Okay"; // away = show time remaining

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

  // clean direction text for a traveling/abroad member — no timing (the API gives
  // no live travel countdown for other players, so any figure would be a guess)
  function travelDetail(st) {
    const d = st.description || "";
    let m;
    if ((m = d.match(/from Torn to (.+)/i))) return `Traveling to ${m[1]}`;
    if ((m = d.match(/from (.+) to Torn/i))) return `Returning from ${m[1]}`;
    if ((m = d.match(/^In (.+)/i))) return `In ${m[1]}`;
    return d || "Traveling";
  }

  // tooltip detail: travel shows direction only; everything else gets the flat until timer
  function statusDetail(st) {
    if (st.state === "Traveling" || st.state === "Abroad") return travelDetail(st);
    return `${statusMeta(st.state).verb}${humanUntil(st.until)}`;
  }

  // success chance calculation
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
      // dedupe: fold onto an already queued / in-flight request for the same key
      const pending = this.queue.find((j) => j.key === key) || (this.busyJob?.key === key ? this.busyJob : null);
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
      requestJson({ method: "POST", url: this.api + "CalculateSuccess", body: { scenario: job.scenario, parameters: job.params } })
        .then((r) => {
          if (!r || typeof r.successChance !== "number") throw new Error("bad response");
          this.cache.set(job.key, r.successChance);
          job.cbs.forEach((cb) => cb(r.successChance));
        })
        .catch(() => {
          if (++job.tries < 3) this.queue.push(job); // transient failure — retry later
          else job.cbs.forEach((cb) => cb(null)); // give up → show "n/a"
        })
        .finally(() =>
          setTimeout(() => {
            this.busy = false;
            this.busyJob = null;
            this.pump();
          }, 250)
        );
    },
  };

  /* ---------- faction thresholds + weights (ZZCraft backend) ----------
     Live per-faction config. Authenticated with the user's OWN public Torn key
     (toolbar input) — never a shared/admin key, since this script is public.
     No data (no key / offline / not loaded) ⇒ show nothing. */
  const Config = {
    thresholds: null, // { scenarioKey: { roleKey: minSuccessChance } }
    weights: null, //    { scenarioKey: { roleKey: weight } }
    loaded: false,
    loading: false,
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
          if (r.minimumSuccessChance != null) th[k][rk] = r.minimumSuccessChance;
          if (r.weight != null) wt[k][rk] = r.weight;
        }
      }
      this.thresholds = th;
      this.weights = wt;
      this.loaded = true;
    },
    load() {
      // build from cache for an instant first paint, then ALWAYS refresh from the
      // backend so config edits show up on the next page load (no stale TTL window)
      try {
        const c = JSON.parse(localStorage.getItem("rr_oc_config") || "null");
        if (c && Array.isArray(c.data)) this.build(c.data);
      } catch (e) {}
      this.fetch();
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
          try {
            localStorage.setItem("rr_oc_config", JSON.stringify({ data }));
          } catch (e) {}
          this.loading = false;
          renderAll(true);
        })
        .catch(() => {
          this.loading = false;
        });
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
  /* role name forced white — readable on the dark role box in both themes */
  #faction-crimes-root [class*="slotHeader___"] [class*="title___"]{color:#fff !important}

  .rr-success small{font-weight:400;opacity:.7}

  /* success chance + member status: matching pills, each bordered and glowing
     in its own status colour (set inline via --rr-c) */
  /* the title is a fixed-height flex row — never shrink or wrap the success
     pill; the long title truncates instead */
  .rr-info{display:flex;align-items:center;flex:0 0 auto;margin:0 6px;min-width:0}
  .rr-chip,.rr-success{position:relative;display:inline-flex;align-items:center;gap:6px;
    padding:2px 10px;border-radius:10px;font-size:12px;font-weight:700;line-height:1.5;
    white-space:nowrap;color:#fff !important;background:${FACTION_COLOURS.dark};
    border:1px solid var(--rr-c,#444);box-shadow:0 0 7px -1px var(--rr-c,transparent);cursor:default}
  .rr-pip{width:8px;height:8px;border-radius:50%;flex:none;
    box-shadow:0 0 0 1px rgba(255,255,255,.28)}
  /* per-slot member status: same pill as the success chip, centred under the member */
  .rr-slot-status{display:flex;justify-content:center;margin:3px 5px 0;max-width:100%}
  .rr-slot-status .rr-chip{max-width:calc(100% - 2px)}
  /* centred + width-capped so it never trails off a narrow PDA screen */
  .rr-chip .rr-tip{display:none;position:absolute;bottom:calc(100% + 7px);left:50%;transform:translateX(-50%);
    z-index:99999;background:${FACTION_COLOURS.dark};border:1px solid ${FACTION_COLOURS.accent};color:#eee;
    font-weight:400;padding:5px 9px;border-radius:5px;white-space:normal;width:max-content;
    max-width:min(240px,80vw);text-align:center;box-shadow:0 3px 12px rgba(0,0,0,.6);pointer-events:none}
  .rr-chip:hover .rr-tip,.rr-chip.rr-open .rr-tip{display:block}

  /* threshold fill + matching outline. The infill is a translucent inset
     shadow (not a flat background) so it tints the slot without smothering it;
     the matching ring is the outer glow. !important keeps it above TornTools.
     Outline/fill only — never blocks interaction. */
  .rr-fill-green,.rr-fill-amber,.rr-fill-red,.rr-fill-grey{border-radius:5px}
  .rr-fill-green{box-shadow:inset 0 0 0 200px rgba(2,158,122,.42),0 0 0 2px #029e7a,0 0 9px rgba(2,158,122,.5) !important}
  .rr-fill-amber{box-shadow:inset 0 0 0 200px rgba(219,123,43,.5),0 0 0 2px #db7b2b,0 0 8px rgba(219,123,43,.45) !important}
  .rr-fill-red{box-shadow:inset 0 0 0 200px rgba(204,50,50,.5),0 0 0 2px #cc3232,0 0 8px rgba(204,50,50,.45) !important}
  /* unconfigured role → solid grey card (clearly "no data", not just a tint) */
  .rr-fill-grey{box-shadow:inset 0 0 0 200px rgba(66,66,66,.96),0 0 0 2px rgba(150,150,150,.6) !important}
  /* drop Torn's member-slot border so the card interior reads cleanly */
  #faction-crimes-root [class*="slotBody___"]{border-color:transparent !important}
  /* TornTools paints whole OC cards green (.tt-oc-highlight), which our green
     "eligible" fill blends into — give those slots a white ring/glow so they
     stay distinct. Keeps the green interior so it still reads as eligible. */
  .tt-oc-highlight .rr-fill-green{box-shadow:inset 0 0 0 200px rgba(2,158,122,.42),0 0 0 2px #fff,0 0 10px rgba(255,255,255,.5) !important}

  /* Recruiting open slot you can't join — click-blocking tag */
  .rr-lock{position:absolute;inset:0;z-index:40;display:flex;align-items:flex-end;
    justify-content:center;cursor:not-allowed;padding:5px}
  .rr-lock span{background:rgba(31,31,31,.94);border:1px solid rgba(150,150,150,.5);color:#cfcfcf;
    font-size:10px;font-weight:600;padding:2px 8px;border-radius:8px;line-height:1.4;text-align:center}

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

  /* ---------- presence guard ----------
     Our success / availability / unknown lines sit inside Torn's React panel,
     which re-renders ~once a second (the live countdown) and drops foreign
     nodes. We keep the live node and re-attach the same one the instant it's
     detached — no recompute, no "calculating…" flash — so nothing pulses. */
  const panelNodes = new Map(); // ocId -> { info, success }
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

  /* ---------- renderers ---------- */
  function renderWeight(slot, key) {
    const w = weightFor(key, slot.roleNorm);
    const html = `<div class="rr-l">WEIGHT</div><div class="rr-v">${w == null ? "--.--%" : Number(w).toFixed(1) + "%"}</div>`;
    const old = slot.wrap.querySelector(".rr-weight");
    if (old) {
      if (old.innerHTML !== html) old.innerHTML = html;
    } else slot.wrap.appendChild(el("div", "rr-weight", html));
  }

  // success chance + member status rendered as one level row of matching pills
  function renderInfoRow(info, tab) {
    const { panel, ocId, title, slots } = info;
    const titleEl = q(panel, sel("panelTitle"));
    let row = panel.querySelector(".rr-info") || panelNodes.get(ocId)?.info;
    qa(panel, ".rr-info").forEach((r) => r !== row && r.remove()); // collapse any stray duplicate rows
    const drop = () => {
      row?.remove();
      cacheNode(ocId, "info", null);
      cacheNode(ocId, "success", null);
    };

    // success pill (Planning + Completed, once every slot has a chance)
    let pill = null,
      queue = null;
    if (tab !== "Recruiting" && titleEl && slots.length && slots.every((s) => s.chance != null)) {
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
          // DOM-first so a pill left behind by cache/DOM churn is reused, not duplicated
          pill = panel.querySelector(".rr-success") || panelNodes.get(ocId)?.success || el("span", "rr-success");
          cacheNode(ocId, "success", pill);
          const line = pill;
          // write only if this is still the live success node (it may be briefly
          // detached mid React-drop — the guard re-attaches the row with its value)
          const show = (v) => {
            if (panelNodes.get(ocId)?.success !== line) return;
            if (v == null) {
              // request failed after retries — don't leave it stuck on "calculating"
              line.style.removeProperty("--rr-c");
              line.innerHTML = `<span class="rr-pip" style="background:#868e96"></span>Success: n/a`;
              return;
            }
            const c = v >= 0.75 ? FACTION_COLOURS.accent : v >= 0.5 ? "#db7b2b" : "#cc3232";
            line.style.setProperty("--rr-c", c);
            line.innerHTML = `<span class="rr-pip" style="background:${c}"></span>Success: ${(v * 100).toFixed(2)}%`;
            panel.dataset.rrSuccess = (v * 100).toFixed(2); // for the success sort
            if (Toolbar.state.sort.startsWith("success")) safe("sort", applyVisibility);
          };
          const key = scenario + "|" + params.join(",");
          if (Success.cache.has(key)) show(Success.cache.get(key));
          else {
            // keep any value already on the pill; placeholder only on a fresh one
            // (pip kept so the calculating + resolved states are the same height)
            if (!/%/.test(line.textContent)) line.innerHTML = `<span class="rr-pip" style="background:#868e96"></span>Success: …`;
            queue = () => Success.get(scenario, params, show);
          }
        }
      }
    }
    if (!pill) return drop(); // member status now lives on each slot, not here
    if (!row) row = el("div", "rr-info");
    qa(panel, ".rr-success").forEach((p) => p !== pill && p.remove()); // exactly one success pill
    if (row.firstChild !== pill) row.prepend(pill);
    if (!panel.contains(row)) titleEl?.after(row);
    cacheNode(ocId, "info", row);
    if (queue) queue();
  }

  const relative = (e) => {
    if (getComputedStyle(e).position === "static") e.style.position = "relative";
  };
  const FILL = ["rr-fill-green", "rr-fill-amber", "rr-fill-red", "rr-fill-grey"];
  function clearSlot(wrap) {
    wrap.querySelector(".rr-lock")?.remove();
    wrap.classList.remove(...FILL);
    // NB: .rr-slot-status is reused in place (see renderSlotState), not cleared here
  }
  function fillState(chance, required) {
    if (chance >= required) return "green";
    if (chance >= required - AMBER_BAND) return "amber";
    return "red";
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
      s.header.classList.add("rr-role"); // frame to match the weight box
      if (!onRecruiting && !onPlanning && !onCompleted) continue;
      // member status pill — reuse in place (like the weight box) so re-renders and
      // transient parses (a momentarily-missing profile link → null xid) don't flicker it
      const st = !onCompleted && s.xid && TornApi.members ? TornApi.statusFor(s.xid) : null;
      const existingStatus = s.wrap.querySelector(".rr-slot-status");
      if (st) {
        const m = statusMeta(st.state);
        const sig = `${s.xid}|${st.state}|${st.until}|${st.name}`; // rebuild only when status changes
        if (!existingStatus || existingStatus.dataset.sig !== sig) {
          const holder = el(
            "div",
            "rr-slot-status",
            `<span class="rr-chip" style="--rr-c:${m.colour}"><span class="rr-pip" style="background:${m.colour}"></span>${esc(m.verb)}<span class="rr-tip">${esc(st.name)}: ${esc(statusDetail(st))}</span></span>`
          );
          holder.dataset.sig = sig;
          if (existingStatus) existingStatus.replaceWith(holder);
          else {
            const w = s.wrap.querySelector(".rr-weight");
            if (w) s.wrap.insertBefore(holder, w);
            else s.wrap.appendChild(holder);
          }
        }
        // unchanged → leave the existing pill (no flicker)
      } else if (existingStatus && (onCompleted || !TornApi.members)) {
        existingStatus.remove(); // status definitively shouldn't show here (transient null xid keeps it)
      }
      if (s.chance == null) continue;
      const required = requiredFor(key, s.roleNorm); // null = not configured in ZZCraft → grey

      if (onRecruiting && !s.xid) {
        openCount++;
        if (required == null) {
          s.wrap.classList.add("rr-fill-grey"); // unknown requirement — don't block, don't hide
          eligibleCount++;
        } else if (s.chance >= required) {
          eligibleCount++;
          s.wrap.classList.add("rr-fill-green");
        } else {
          relative(s.wrap);
          s.wrap.classList.add("rr-fill-grey");
          s.wrap.appendChild(el("div", "rr-lock", `<span>Not Eligible: Requires: ${required}+</span>`));
        }
      } else {
        s.wrap.classList.add(required == null ? "rr-fill-grey" : "rr-fill-" + fillState(s.chance, required));
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
          Config.fetch(); // re-pull thresholds/weights with the new key
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
      // restore Torn's own layout when not sorting (don't leave the list forced to flex)
      const sorting = st.sort !== "default";
      list.style.display = sorting ? "flex" : "";
      list.style.flexDirection = sorting ? "column" : "";
    }
    const metric = {
      // unresolved success (no value yet) sorts to the bottom in both directions
      "success-desc": (p) => (p.dataset.rrSuccess ? -p.dataset.rrSuccess : Infinity),
      "success-asc": (p) => (p.dataset.rrSuccess ? +p.dataset.rrSuccess : Infinity),
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
    safe("info", () => renderInfoRow(info, tab));
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
    const live = new Set(qa(document, "div[data-oc-id]").map((p) => p.getAttribute("data-oc-id")));
    // drop departed crimes — but keep any whose nodes are still on the page, so a
    // transient list re-render can't desync the cache from the DOM (→ duplicate pills)
    for (const [ocId, rec] of panelNodes)
      if (!live.has(ocId) && !rec.info?.isConnected) panelNodes.delete(ocId);
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
    // re-attach dropped nodes synchronously (no flicker); recompute is debounced
    new MutationObserver(() => {
      safe("guard", guardPresence);
      scheduleRender();
    }).observe(root, { childList: true, subtree: true });
    window.addEventListener("hashchange", () => setTimeout(() => safe("render", () => renderAll(true)), 300));
    safe("config", () => Config.load()); // pull faction thresholds/weights from ZZCraft
    renderAll();
  });
})();
