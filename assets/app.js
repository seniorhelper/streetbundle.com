/* StreetBundle app v2.0
   One script for every page. Two data adapters behind one API:
   - LIVE: Supabase (auth, Postgres RPCs, triggers, realtime) + Stripe card holds, when keys are set in config.js
   - DEMO: the same API and the same trigger rules, saved in this browser, with a demo clock and role switcher
*/
(function () {
  "use strict";
  var CFG = window.HW_CONFIG || {};
  var HOUR = 36e5, DAY = 864e5;
  var LIVE = !!(CFG.SUPABASE_URL && CFG.SUPABASE_ANON_KEY);
  var PAGE = document.body.getAttribute("data-page") || "";

  /* ================= helpers ================= */
  function $(s, r) { return (r || document).querySelector(s); }
  function $$(s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function money(n) { return n == null || isNaN(n) ? "—" : "$" + Math.round(n).toLocaleString("en-US"); }
  function money2(n) { return n == null || isNaN(n) ? "—" : "$" + Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function fmtDate(t) { if (!t) return "—"; var d = new Date(t); return isNaN(d) ? "—" : d.toLocaleDateString("en-US", { month: "short", day: "numeric" }); }
  function fmtDateTime(t) { if (!t) return "—"; return new Date(t).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }); }
  function uid() { return "x" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
  function code6() { var a = "ABCDEFGHJKMNPQRSTUVWXYZ23456789", s = ""; for (var i = 0; i < 6; i++) s += a[Math.floor(Math.random() * a.length)]; return s; }
  function qs(k) { return new URLSearchParams(location.search).get(k); }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function toast(msg, bad) {
    var t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); t.textContent = msg;
    if (bad) t.style.background = "#8A2410";
    document.body.appendChild(t); setTimeout(function () { t.remove(); }, 3800);
  }
  function errMsg(e) { return (e && (e.message || e.error_description || e.msg)) || String(e || "Something went wrong"); }
  function fail(e) { console.warn(e); toast(errMsg(e), true); }
  function zipOk(z) { return /^\d{5}$/.test(String(z || "").trim()); }
  function timeLeft(t) {
    var ms = new Date(t).getTime() - now(); if (ms <= 0) return "closing…";
    var h = Math.floor(ms / HOUR), m = Math.floor((ms % HOUR) / 6e4);
    return h >= 48 ? Math.floor(h / 24) + "d " + (h % 24) + "h" : h + "h " + m + "m";
  }
  function effective(price, flexPct, herdFlex) { price = Number(price); return herdFlex ? price * (1 - (Number(flexPct) || 0) / 100) : price; }
  function modal(html, onMount) {
    var back = document.createElement("div"); back.className = "modal-back";
    back.innerHTML = '<div class="modal" role="dialog" aria-modal="true">' + html + "</div>";
    function close() { back.remove(); document.removeEventListener("keydown", key); }
    function key(e) { if (e.key === "Escape") close(); }
    back.addEventListener("click", function (e) { if (e.target === back || e.target.closest("[data-close]")) close(); });
    document.addEventListener("keydown", key);
    document.body.appendChild(back);
    var f = back.querySelector("input,select,textarea,button"); if (f) f.focus();
    if (onMount) onMount(back.querySelector(".modal"), close);
    return close;
  }

  var STATUS = {
    forming: { label: "Filling up", chip: "live" },
    bidding: { label: "Bidding open", chip: "bid" },
    awarded: { label: "Approve your price", chip: "bid" },
    scheduled: { label: "Scheduled", chip: "locked" },
    in_progress: { label: "Crew on the street", chip: "locked" },
    completed: { label: "Done", chip: "" },
    expired: { label: "Expired", chip: "" },
    cancelled: { label: "Cancelled", chip: "" }
  };
  function chip(st) { var s = STATUS[st] || { label: st, chip: "" }; return '<span class="chip ' + s.chip + '">' + esc(s.label) + "</span>"; }

  /* demo clock (DEMO mode only) */
  var clockOffset = LIVE ? 0 : lsGet("hw2-clock", 0);
  function now() { return Date.now() + clockOffset; }

  /* ================= DEMO adapter ================= */
  var CATS_SEED = [
    ["gutter-cleaning", "Gutter cleaning", 185, 6], ["roof-inspection", "Roof inspection", 225, 6], ["water-heater", "Water heater replacement", 1850, 5],
    ["hvac-tuneup", "HVAC tune-up", 160, 8], ["window-washing", "Window washing", 260, 8], ["pest-control", "Pest control plan", 420, 6],
    ["tree-trimming", "Tree trimming", 650, 5], ["dryer-vent", "Dryer vent cleaning", 150, 8], ["chimney-sweep", "Chimney sweep", 275, 6],
    ["pressure-washing", "Pressure washing", 320, 6], ["lawn-aeration", "Lawn aeration", 110, 8], ["holiday-lights", "Holiday light install", 450, 6],
    ["sprinkler-blowout", "Sprinkler blowout", 95, 8], ["solar-panel-cleaning", "Solar panel cleaning", 200, 6]
  ];
  var DEMO_KEY = "hw2-db";
  var Demo = (function () {
    var db;
    function seed() {
      var t = Date.now(), cats = CATS_SEED.map(function (c, i) { return { slug: c[0], label: c[1], unit: "home", est_solo_price: c[2], default_threshold: c[3], sort: i }; });
      var users = {
        "me": { id: "me", role: "home", first_name: "You", zip: "", street: "", phone: "" },
        "p1": { id: "p1", role: "pro", first_name: "Sample" }, "p2": { id: "p2", role: "pro", first_name: "Example" }, "p3": { id: "p3", role: "pro", first_name: "Demo" }
      };
      var pros = {
        p1: { id: "p1", business_name: "Front Range Example Gutters", trades: ["gutter-cleaning", "roof-inspection", "pressure-washing", "holiday-lights"], service_zips: ["*"], verified: true, rating: 4.8, jobs_done: 42, license_no: "EX-1001" },
        p2: { id: "p2", business_name: "Sample Home Systems", trades: ["water-heater", "hvac-tuneup", "dryer-vent", "chimney-sweep", "sprinkler-blowout"], service_zips: ["*"], verified: true, rating: 4.9, jobs_done: 77, license_no: "EX-2002" },
        p3: { id: "p3", business_name: "Demo Exteriors Co.", trades: CATS_SEED.map(function (c) { return c[0]; }), service_zips: ["*"], verified: true, rating: 4.6, jobs_done: 18, license_no: "EX-3003" }
      };
      var herds = [], members = [], bids = [], events = [];
      var ex = [
        ["80204", "Lincoln Park blocks", "gutter-cleaning", 6, 4, "forming", 0],
        ["80206", "Cherry Creek North, 3rd–6th Ave", "roof-inspection", 6, 7, "bidding", 1],
        ["80211", "Highland, Clay to Zuni", "water-heater", 5, 3, "forming", 0],
        ["80220", "Park Hill, Fairfax corridor", "window-washing", 8, 9, "bidding", 2],
        ["80301", "Boulder, Gunbarrel loop", "hvac-tuneup", 8, 5, "forming", 0],
        ["80602", "Brighton, Prairie Center streets", "sprinkler-blowout", 8, 12, "completed", 0]
      ];
      var names = ["Ana", "Ben", "Cyd", "Dev", "Eli", "Fay", "Gus", "Hana", "Ira", "Jo", "Kai", "Lu", "Max"];
      ex.forEach(function (e, i) {
        var id = "ex" + (i + 1), cat = cats.filter(function (c) { return c.slug === e[2]; })[0];
        var h = { id: id, code: "EXMPL" + (i + 1), category: e[2], zip: e[0], street_area: e[1], threshold: e[3], max_homes: 25, window_start: new Date(t + 10 * DAY).toISOString().slice(0, 10), window_end: new Date(t + 40 * DAY).toISOString().slice(0, 10), flex: i % 2 === 0, status: e[5], forming_expires_at: new Date(t + (8 + i) * DAY).toISOString(), bid_closes_at: e[5] === "bidding" ? new Date(t + (20 + i * 6) * HOUR).toISOString() : null, winning_bid_id: null, scheduled_for: null, is_example: true, created_by: null, created_at: new Date(t - (3 + i) * DAY).toISOString() };
        herds.push(h);
        for (var k = 0; k < e[4]; k++) members.push({ herd_id: id, user_id: "n" + i + "-" + k, first_name: names[(k + i) % names.length], street: "Example St", flex_weeks: k % 3, approved: e[5] === "completed", payment_status: e[5] === "completed" ? "captured" : "none", joined_at: new Date(t - (e[4] - k) * 7 * HOUR).toISOString() });
        events.push({ id: uid(), herd_id: id, kind: "created", payload: {}, created_at: h.created_at });
        if (e[5] !== "forming") events.push({ id: uid(), herd_id: id, kind: "bidding_opened", payload: {}, created_at: new Date(t - 26 * HOUR).toISOString() });
        if (e[6] > 0) {
          var base = cat.est_solo_price;
          bids.push({ id: uid(), herd_id: id, pro_id: "p3", per_home_price: Math.round(base * 0.74), flex_discount_pct: 5, schedule_date: h.window_start, message: "Two crews, one pass per side of the street.", status: "active", created_at: new Date(t - 20 * HOUR).toISOString() });
          if (e[6] > 1) bids.push({ id: uid(), herd_id: id, pro_id: "p1", per_home_price: Math.round(base * 0.69), flex_discount_pct: 8, schedule_date: h.window_start, message: "Photo report for every home.", status: "active", created_at: new Date(t - 6 * HOUR).toISOString() });
          events.push({ id: uid(), herd_id: id, kind: "bid_placed", payload: { price: Math.round(base * 0.74) }, created_at: new Date(t - 20 * HOUR).toISOString() });
        }
        if (e[5] === "completed") {
          var b = { id: uid(), herd_id: id, pro_id: "p2", per_home_price: 68, flex_discount_pct: 0, schedule_date: h.window_start, message: "", status: "won", created_at: new Date(t - 30 * DAY).toISOString() };
          bids.push(b); h.winning_bid_id = b.id; h.scheduled_for = h.window_start;
          events.push({ id: uid(), herd_id: id, kind: "completed", payload: {}, created_at: new Date(t - 2 * DAY).toISOString() });
        }
      });
      return { v: 2, me: "me", users: users, pros: pros, cats: cats, herds: herds, members: members, bids: bids, events: events, reviews: [], forecast: [], notes: [], keys: [], agentReqs: [] };
    }
    function load() { db = lsGet(DEMO_KEY, null); if (!db || db.v !== 2) { db = seed(); save(); } }
    function save() { lsSet(DEMO_KEY, db); }
    function me() { return db.users[db.me]; }
    function need() { if (!db.me || !db.users[db.me]) throw new Error("Sign in first."); return me(); }
    function herd(id) { var h = db.herds.filter(function (x) { return x.id === id || x.code === id; })[0]; if (!h) throw new Error("That bundle doesn't exist."); return h; }
    function membersOf(id) { return db.members.filter(function (m) { return m.herd_id === id; }); }
    function bidsOf(id) { return db.bids.filter(function (b) { return b.herd_id === id; }); }
    function cat(slug) { return db.cats.filter(function (c) { return c.slug === slug; })[0] || { label: slug, est_solo_price: 0 }; }
    function ev(hid, kind, payload) { db.events.push({ id: uid(), herd_id: hid, kind: kind, payload: payload || {}, created_at: new Date(now()).toISOString() }); }
    function notify(userId, kind, hid, title, body) { if (!userId || !db.users[userId]) return; db.notes.push({ id: uid(), user_id: userId, kind: kind, herd_id: hid, title: title, body: body, read: false, created_at: new Date(now()).toISOString() }); }
    function notifyMembers(hid, kind, title, body) { membersOf(hid).forEach(function (m) { notify(m.user_id, kind, hid, title, body); }); }
    function activeBids(h) { return bidsOf(h.id).filter(function (b) { return b.status === "active"; }); }
    function bestPrice(h) { var a = activeBids(h).map(function (b) { return effective(b.per_home_price, b.flex_discount_pct, h.flex); }); return a.length ? Math.min.apply(null, a) : null; }
    function pub(h) {
      var c = cat(h.category), ms = membersOf(h.id), ab = activeBids(h), wb = h.winning_bid_id ? db.bids.filter(function (b) { return b.id === h.winning_bid_id; })[0] : null;
      return Object.assign({}, h, { label: c.label, est_solo_price: c.est_solo_price, member_count: ms.length, bid_count: ab.length, best_price: wb ? effective(wb.per_home_price, wb.flex_discount_pct, h.flex) : bestPrice(h), approvals: ms.filter(function (m) { return m.approved; }).length });
    }
    /* ---- the triggers ---- */
    function afterJoin(h) {
      var n = membersOf(h.id).length;
      ev(h.id, "joined", { count: n });
      if (h.status === "forming") {
        if (n === Math.ceil(h.threshold / 2)) notifyMembers(h.id, "halfway", "Your bundle is halfway there", n + " of " + h.threshold + " homes have joined.");
        if (n === h.threshold - 1) notifyMembers(h.id, "one_left", "One spot left", "One more home and bidding opens on its own.");
        if (n >= h.threshold) openBidding(h);
      }
    }
    function openBidding(h) {
      h.status = "bidding"; h.bid_closes_at = new Date(now() + (CFG.BID_WINDOW_HOURS || 48) * HOUR).toISOString();
      ev(h.id, "bidding_opened", {});
      notifyMembers(h.id, "bidding_opened", "Bidding is open", "Your bundle filled. Local pros have " + (CFG.BID_WINDOW_HOURS || 48) + " hours to bid on the whole route.");
      Object.keys(db.pros).forEach(function (pid) { var p = db.pros[pid]; if (p.verified && matches(p, h)) notify(pid, "new_herd", h.id, "New bundle in your area", cat(h.category).label + " · " + membersOf(h.id).length + " homes · " + h.zip); });
      // demo only: sample pros respond after a short delay so the flow is visible
      if (!h.is_example) setTimeout(function () { load(); var hh = db.herds.filter(function (x) { return x.id === h.id; })[0]; if (hh && hh.status === "bidding") { simBid(hh, "p3", 0.78); save(); bus(); } }, 2500);
      if (!h.is_example) setTimeout(function () { load(); var hh = db.herds.filter(function (x) { return x.id === h.id; })[0]; if (hh && hh.status === "bidding") { simBid(hh, "p1", 0.71); save(); bus(); } }, 6000);
    }
    function matches(p, h) { return (p.trades || []).indexOf(h.category) >= 0 && ((p.service_zips || []).indexOf("*") >= 0 || (p.service_zips || []).indexOf(h.zip) >= 0); }
    function simBid(h, pid, f) { if (!matches(db.pros[pid], h)) return; insertBid(h, pid, Math.round(cat(h.category).est_solo_price * f), h.flex ? 6 : 0, h.window_start, "Sample bid from a demo pro."); }
    function insertBid(h, pid, price, flexPct, date, msg) {
      var before = bestPrice(h), prevLeader = leader(h);
      bidsOf(h.id).forEach(function (b) { if (b.pro_id === pid && b.status === "active") b.status = "withdrawn"; });
      var b = { id: uid(), herd_id: h.id, pro_id: pid, per_home_price: Number(price), flex_discount_pct: Number(flexPct) || 0, schedule_date: date || null, message: msg || "", status: "active", created_at: new Date(now()).toISOString() };
      db.bids.push(b);
      var eff = effective(b.per_home_price, b.flex_discount_pct, h.flex);
      ev(h.id, "bid_placed", { price: eff });
      if (before == null || eff < before) {
        notifyMembers(h.id, "new_best", "New best price: " + money(eff) + "/home", db.pros[pid].business_name + " just took the lead.");
        if (prevLeader && prevLeader.pro_id !== pid) notify(prevLeader.pro_id, "outbid", h.id, "You were outbid", "A lower bid came in on bundle " + h.code + ".");
      }
      return b;
    }
    function leader(h) {
      var a = activeBids(h).slice().sort(function (x, y) {
        var d = effective(x.per_home_price, x.flex_discount_pct, h.flex) - effective(y.per_home_price, y.flex_discount_pct, h.flex);
        if (d) return d; var r = (db.pros[y.pro_id] || {}).rating - (db.pros[x.pro_id] || {}).rating; if (r) return r; return x.created_at < y.created_at ? -1 : 1;
      });
      return a[0] || null;
    }
    function sweep() {
      var t = now(), changed = false;
      db.herds.forEach(function (h) {
        if (h.status === "forming" && new Date(h.forming_expires_at).getTime() <= t) { h.status = "expired"; ev(h.id, "expired", {}); notifyMembers(h.id, "expired", "Your bundle expired", "It didn't fill in time. Start a new one any time."); changed = true; }
        if (h.status === "bidding" && h.bid_closes_at && new Date(h.bid_closes_at).getTime() <= t) {
          var w = leader(h);
          if (!w) {
            var ext = db.events.some(function (e) { return e.herd_id === h.id && e.kind === "bidding_extended"; });
            if (!ext) { h.bid_closes_at = new Date(t + 24 * HOUR).toISOString(); ev(h.id, "bidding_extended", {}); notifyMembers(h.id, "extended", "Bidding extended 24 hours", "No bids yet, so we gave pros another day."); }
            else { h.status = "expired"; ev(h.id, "expired", {}); notifyMembers(h.id, "expired", "No pro bid this time", "We'll let you know if pros join your area."); }
          } else {
            activeBids(h).forEach(function (b) { b.status = b.id === w.id ? "won" : "lost"; });
            h.status = "awarded"; h.winning_bid_id = w.id; h.awarded_at = new Date(t).toISOString();
            var eff = effective(w.per_home_price, w.flex_discount_pct, h.flex);
            ev(h.id, "awarded", { price: eff });
            notifyMembers(h.id, "awarded", "Approve your price: " + money(eff) + "/home", (db.pros[w.pro_id] || {}).business_name + " won your bundle. Approve to lock your spot.");
            notify(w.pro_id, "won", h.id, "You won bundle " + h.code, membersOf(h.id).length + " homes at " + money(eff) + "/home.");
          }
          changed = true;
        }
        if (h.status === "awarded" && h.awarded_at && new Date(h.awarded_at).getTime() + (CFG.APPROVAL_WINDOW_HOURS || 72) * HOUR <= t) {
          var ap = membersOf(h.id).filter(function (m) { return m.approved; }).length;
          if (ap >= h.threshold) schedule(h); else { h.status = "expired"; ev(h.id, "expired", {}); notifyMembers(h.id, "expired", "Not enough approvals", "Card holds were released."); membersOf(h.id).forEach(function (m) { if (m.payment_status === "held") m.payment_status = "refunded"; }); }
          changed = true;
        }
      });
      if (changed) save();
      return changed;
    }
    function schedule(h) {
      var w = db.bids.filter(function (b) { return b.id === h.winning_bid_id; })[0];
      membersOf(h.id).filter(function (m) { return !m.approved; }).forEach(function (m) { db.members.splice(db.members.indexOf(m), 1); });
      h.status = "scheduled"; h.scheduled_for = (w && w.schedule_date) || h.window_start;
      ev(h.id, "scheduled", { date: h.scheduled_for });
      notifyMembers(h.id, "scheduled", "You're on the route", "Service date: " + fmtDate(h.scheduled_for) + ".");
      if (w) notify(w.pro_id, "scheduled", h.id, "Route " + h.code + " is locked", membersOf(h.id).length + " stops on " + fmtDate(h.scheduled_for) + ".");
    }
    function P(fn) { return new Promise(function (res, rej) { try { load(); sweep(); var r = fn(); save(); res(r); setTimeout(bus, 0); } catch (e) { rej(e); } }); }
    var busy = false;
    function Q(fn) { return new Promise(function (res, rej) { try { load(); var ch = sweep(); var r = fn(); res(r); if (ch && !busy) { busy = true; setTimeout(function () { bus(); busy = false; }, 0); } } catch (e) { rej(e); } }); }

    return {
      kind: "demo",
      init: function () { load(); if (sweep()) bus(); return Promise.resolve(); },
      session: function () { load(); return Promise.resolve(db.me ? Object.assign({}, me(), { pro: db.pros[db.me] || null, email: db.me === "me" ? "you@example.com" : db.me + "@example.com" }) : null); },
      signIn: function (email, role) { return P(function () {
        var id = role === "pro" ? "mypro" : role === "admin" ? "admin" : "me";
        if (!db.users[id]) db.users[id] = { id: id, role: role || "home", first_name: role === "admin" ? "Admin" : role === "pro" ? "Your crew" : "You", zip: "", street: "", phone: "" };
        db.me = id; return me(); }); },
      signOut: function () { return P(function () { db.me = null; }); },
      updateProfile: function (p) { return P(function () { Object.assign(need(), p); return me(); }); },
      categories: function () { load(); return Promise.resolve(db.cats.slice()); },
      listHerds: function (f) { return Q(function () {
        f = f || {}; return db.herds.filter(function (h) {
          return (!f.zip || h.zip.indexOf(f.zip) === 0) && (!f.category || h.category === f.category) && (!f.status || (f.status === "open" ? (h.status === "forming" || h.status === "bidding") : h.status === f.status));
        }).map(pub).sort(function (a, b) { return a.created_at < b.created_at ? 1 : -1; }); }); },
      getHerd: function (id) { return Q(function () {
        var h = herd(id), my = db.me ? membersOf(h.id).filter(function (m) { return m.user_id === db.me; })[0] || null : null;
        var bids = bidsOf(h.id).filter(function (b) { return b.status !== "withdrawn"; }).map(function (b) { var p = db.pros[b.pro_id] || {}; return Object.assign({}, b, { business_name: p.business_name, rating: p.rating, verified: p.verified, jobs_done: p.jobs_done, effective: effective(b.per_home_price, b.flex_discount_pct, h.flex) }); }).sort(function (a, b) { return a.effective - b.effective; });
        return { herd: pub(h), events: db.events.filter(function (e) { return e.herd_id === h.id; }).sort(function (a, b) { return a.created_at < b.created_at ? -1 : 1; }), bids: bids, mine: my, myReview: db.reviews.filter(function (r) { return r.herd_id === h.id && r.user_id === db.me; })[0] || null, iAmWinner: !!(h.winning_bid_id && db.bids.some(function (b) { return b.id === h.winning_bid_id && b.pro_id === db.me; })) }; }); },
      createHerd: function (a) { return P(function () {
        var u = need(); if (!zipOk(a.zip)) throw new Error("Enter a 5-digit ZIP code."); var c = cat(a.category);
        var h = { id: uid(), code: code6(), category: a.category, zip: a.zip, street_area: a.street_area || "", threshold: Math.max(3, Math.min(25, Number(a.threshold) || c.default_threshold || 6)), max_homes: 25, window_start: a.window_start || null, window_end: a.window_end || null, flex: !!a.flex, status: "forming", forming_expires_at: new Date(now() + 21 * DAY).toISOString(), bid_closes_at: null, winning_bid_id: null, scheduled_for: null, is_example: false, created_by: u.id, created_at: new Date(now()).toISOString() };
        db.herds.push(h); ev(h.id, "created", {});
        db.members.push({ herd_id: h.id, user_id: u.id, first_name: u.first_name, street: u.street, flex_weeks: a.flex ? 2 : 0, notes: a.notes || "", approved: false, payment_status: "none", joined_at: new Date(now()).toISOString() });
        afterJoin(h); return pub(h); }); },
      joinHerd: function (id, flexWeeks, notes) { return P(function () {
        var u = need(), h = herd(id);
        if (h.is_example) throw new Error("This is an example bundle. Start a real one for your street.");
        if (["forming", "bidding"].indexOf(h.status) < 0) throw new Error("This bundle isn't taking new homes.");
        if (membersOf(h.id).some(function (m) { return m.user_id === u.id; })) throw new Error("You're already in this bundle.");
        if (membersOf(h.id).length >= h.max_homes) throw new Error("This bundle is full.");
        db.members.push({ herd_id: h.id, user_id: u.id, first_name: u.first_name, street: u.street, flex_weeks: Number(flexWeeks) || 0, notes: notes || "", approved: false, payment_status: "none", joined_at: new Date(now()).toISOString() });
        afterJoin(h); return pub(h); }); },
      demoNeighbor: function (id) { return P(function () {
        var h = herd(id); if (["forming", "bidding"].indexOf(h.status) < 0) throw new Error("Bundle isn't open.");
        var n = membersOf(h.id).length, names = ["Rosa", "Theo", "Mina", "Jack", "Priya", "Owen", "Lena", "Sam"];
        db.members.push({ herd_id: h.id, user_id: "nb-" + uid(), first_name: names[n % names.length], street: "Neighbor St", flex_weeks: n % 3, approved: false, payment_status: "none", joined_at: new Date(now()).toISOString() });
        afterJoin(h); return pub(h); }); },
      leaveHerd: function (id) { return P(function () {
        var u = need(), h = herd(id); if (h.status !== "forming") throw new Error("You can only leave while the bundle is still filling.");
        db.members = db.members.filter(function (m) { return !(m.herd_id === h.id && m.user_id === u.id); }); ev(h.id, "left", { count: membersOf(h.id).length }); }); },
      placeBid: function (id, price, flexPct, date, msg) { return P(function () {
        var u = need(), p = db.pros[u.id], h = herd(id);
        if (!p) throw new Error("Set up your pro profile first."); if (!p.verified) throw new Error("Your license and insurance are still being verified.");
        if (!matches(p, h)) throw new Error("This bundle is outside your trades or service ZIPs.");
        if (h.status !== "bidding" || new Date(h.bid_closes_at).getTime() <= now()) throw new Error("Bidding is closed on this bundle.");
        if (!(Number(price) > 0)) throw new Error("Enter a per-home price."); if (Number(flexPct) < 0 || Number(flexPct) > 30) throw new Error("Flex discount must be 0–30%.");
        return insertBid(h, u.id, price, flexPct, date, msg); }); },
      withdrawBid: function (bidId) { return P(function () { var u = need(); db.bids.forEach(function (b) { if (b.id === bidId && b.pro_id === u.id && b.status === "active") b.status = "withdrawn"; }); }); },
      approveAward: function (id) { return P(function () {
        var u = need(), h = herd(id), m = membersOf(h.id).filter(function (x) { return x.user_id === u.id; })[0];
        if (!m) throw new Error("You're not in this bundle."); if (h.status !== "awarded") throw new Error("There's no price to approve yet.");
        m.approved = true; m.approved_at = new Date(now()).toISOString(); m.payment_status = "held"; ev(h.id, "approved", { count: membersOf(h.id).filter(function (x) { return x.approved; }).length });
        if (membersOf(h.id).every(function (x) { return x.approved || !db.users[x.user_id]; })) {
          membersOf(h.id).forEach(function (x) { if (!x.approved) { x.approved = true; x.payment_status = "held"; } }); // demo neighbors approve along with you
          schedule(h);
        }
        return m; }); },
      startRoute: function (id) { return P(function () { var h = herd(id); if (!isWinner(h)) throw new Error("Only the winning pro can start this route."); if (h.status !== "scheduled") throw new Error("Route isn't scheduled."); h.status = "in_progress"; ev(h.id, "started", {}); notifyMembers(h.id, "started", "Crew is on your street", "Your service is happening today."); }); },
      completeRoute: function (id) { return P(function () {
        var h = herd(id); if (!isWinner(h)) throw new Error("Only the winning pro can complete this route."); if (h.status !== "in_progress") throw new Error("Start the route first.");
        h.status = "completed"; ev(h.id, "completed", {}); membersOf(h.id).forEach(function (m) { if (m.payment_status === "held") m.payment_status = "captured"; });
        db.pros[db.me].jobs_done = (db.pros[db.me].jobs_done || 0) + 1;
        notifyMembers(h.id, "completed", "All done. How did they do?", "Rate the crew so the next bundle knows."); }); },
      rateHerd: function (id, stars, body) { return P(function () {
        var u = need(), h = herd(id); if (h.status !== "completed") throw new Error("You can rate after the route is done.");
        var w = db.bids.filter(function (b) { return b.id === h.winning_bid_id; })[0];
        db.reviews = db.reviews.filter(function (r) { return !(r.herd_id === h.id && r.user_id === u.id); });
        db.reviews.push({ herd_id: h.id, user_id: u.id, pro_id: w && w.pro_id, stars: Number(stars), body: body || "", created_at: new Date(now()).toISOString() });
        if (w && db.pros[w.pro_id]) { var rs = db.reviews.filter(function (r) { return r.pro_id === w.pro_id; }); db.pros[w.pro_id].rating = Math.round(rs.reduce(function (s, r) { return s + r.stars; }, 0) / rs.length * 10) / 10; }
        ev(h.id, "rated", { stars: Number(stars) }); }); },
      reportForecast: function (zip, item, year) { return P(function () { if (!zipOk(zip)) throw new Error("Enter a 5-digit ZIP."); var y = Number(year), cy = new Date().getFullYear(); if (!(y > 1950 && y <= cy)) throw new Error("Enter a real install year."); db.forecast.push({ zip: zip, item: item, install_year: y, created_at: new Date(now()).toISOString() }); }); },
      forecastByZip: function (zip) { return Q(function () {
        var cy = new Date().getFullYear(), rows = {}, life = { "water-heater": 12, "roof-inspection": 20, "hvac-tuneup": 15, "dryer-vent": 1, "chimney-sweep": 1, "gutter-cleaning": 1 };
        db.forecast.filter(function (r) { return r.zip === zip; }).forEach(function (r) { (rows[r.item] = rows[r.item] || []).push(cy - r.install_year); });
        return Object.keys(rows).map(function (k) { var a = rows[k].sort(function (x, y) { return x - y; }), L = life[k] || 15; return { zip: zip, item: k, reports: a.length, median_age_years: a[Math.floor(a.length / 2)], due_next_2y: a.filter(function (x) { return x >= L - 2; }).length }; }); }); },
      becomePro: function (a) { return P(function () { var u = need(); u.role = "pro"; db.pros[u.id] = Object.assign({ id: u.id, verified: false, rating: 0, jobs_done: 0 }, db.pros[u.id] || {}, { business_name: a.business_name, trades: a.trades, service_zips: a.service_zips, license_no: a.license_no }); notify(u.id, "pro_pending", null, "Application received", "We verify license and insurance before you can bid. In demo mode an admin can approve you from the admin page."); return db.pros[u.id]; }); },
      myHerds: function () { return Q(function () { var u = need(); var ids = db.members.filter(function (m) { return m.user_id === u.id; }).map(function (m) { return m.herd_id; }); return db.herds.filter(function (h) { return ids.indexOf(h.id) >= 0; }).map(pub); }); },
      proBoard: function () { return Q(function () {
        var u = need(), p = db.pros[u.id]; if (!p) return { pro: null, open: [], bids: [], routes: [] };
        var open = db.herds.filter(function (h) { return h.status === "bidding" && matches(p, h); }).map(function (h) { var x = pub(h), my = activeBids(h).filter(function (b) { return b.pro_id === u.id; })[0]; x.my_bid = my ? effective(my.per_home_price, my.flex_discount_pct, h.flex) : null; x.leading = !!(my && leader(h) && leader(h).id === my.id); return x; });
        var filling = db.herds.filter(function (h) { return h.status === "forming" && matches(p, h); }).map(pub);
        var bids = db.bids.filter(function (b) { return b.pro_id === u.id && b.status !== "withdrawn"; }).map(function (b) { var h = db.herds.filter(function (x) { return x.id === b.herd_id; })[0]; return Object.assign({}, b, { herd: h ? pub(h) : null }); }).reverse();
        var routes = db.herds.filter(function (h) { return isWinnerFor(h, u.id); }).map(pub);
        return { pro: p, open: open, filling: filling, bids: bids, routes: routes }; }); },
      routeStops: function (id) { return Q(function () { var h = herd(id); if (!isWinner(h)) throw new Error("Only the winning pro sees the route."); if (["scheduled", "in_progress", "completed"].indexOf(h.status) < 0) return []; return membersOf(h.id).map(function (m, i) { return { first_name: m.first_name, street: m.street || "Address shared on approval", zip: h.zip, flex_weeks: m.flex_weeks, notes: m.notes || "" }; }); }); },
      notifications: function () { return Q(function () { var u = db.me; return db.notes.filter(function (n) { return n.user_id === u; }).slice().reverse(); }); },
      markRead: function () { return P(function () { db.notes.forEach(function (n) { if (n.user_id === db.me) n.read = true; }); }); },
      createAgentKey: function (label) { return P(function () { var u = need(), raw = "hw_" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2); db.keys.push({ id: uid(), user_id: u.id, label: label || "My assistant", created_at: new Date(now()).toISOString(), revoked: false, preview: raw.slice(0, 7) + "…" }); return raw; }); },
      agentKeys: function () { return Q(function () { return db.keys.filter(function (k) { return k.user_id === db.me && !k.revoked; }); }); },
      agentRequests: function () { return Q(function () { return db.agentReqs.filter(function (r) { return r.user_id === db.me; }).map(function (r) { var h = db.herds.filter(function (x) { return x.id === r.herd_id; })[0]; return Object.assign({}, r, { herd: h ? pub(h) : null }); }); }); },
      demoAgentRequest: function () { return P(function () { var u = need(), h = db.herds.filter(function (x) { return x.status === "forming" && !x.is_example && !membersOf(x.id).some(function (m) { return m.user_id === u.id; }); })[0] || db.herds.filter(function (x) { return x.status === "forming"; })[0]; if (!h) throw new Error("No open bundles for the demo assistant to find."); db.agentReqs.push({ id: uid(), user_id: u.id, herd_id: h.id, action: "join", status: "pending", agent: "Demo assistant", created_at: new Date(now()).toISOString() }); notify(u.id, "agent_request", h.id, "Your assistant wants to join a bundle", cat(h.category).label + " in " + h.zip + ". Approve or decline."); }); },
      respondAgentRequest: function (rid, ok) { var self = this; return P(function () { var r = db.agentReqs.filter(function (x) { return x.id === rid; })[0]; if (!r) throw new Error("Request not found."); r.status = ok ? "approved" : "declined"; return r; }).then(function (r) { if (ok) { var h = db.herds.filter(function (x) { return x.id === r.herd_id; })[0]; if (h && h.is_example) return toast("Approved. (Example bundles can't be joined, so nothing was added.)"); return self.joinHerd(r.herd_id, 0, "Joined by my assistant"); } }); },
      adminPros: function () { return Q(function () { return Object.keys(db.pros).map(function (k) { return db.pros[k]; }); }); },
      adminVerify: function (pid, ok) { return P(function () { if (me().role !== "admin") throw new Error("Admins only."); db.pros[pid].verified = !!ok; notify(pid, "verified", null, ok ? "You're verified" : "Verification paused", ok ? "You can now bid on bundles in your area." : "Contact support."); }); },
      adminHerds: function () { return Q(function () { return db.herds.map(pub); }); },
      adminForceClose: function (id) { return P(function () { var h = herd(id); if (h.status !== "bidding") throw new Error("Not in bidding."); h.bid_closes_at = new Date(now() - 1000).toISOString(); sweep(); }); },
      skipAhead: function (hours) { clockOffset += hours * HOUR; lsSet("hw2-clock", clockOffset); return P(function () { return true; }); },
      reset: function () { try { localStorage.removeItem(DEMO_KEY); localStorage.removeItem("hw2-clock"); } catch (e) {} clockOffset = 0; load(); bus(); return Promise.resolve(); },
      subscribe: function (fn) { window.addEventListener("storage", function (e) { if (e.key === DEMO_KEY) fn(); }); }
    };
    function isWinner(h) { return isWinnerFor(h, db.me); }
    function isWinnerFor(h, pid) { return !!(h.winning_bid_id && db.bids.some(function (b) { return b.id === h.winning_bid_id && b.pro_id === pid; })); }
  })();

  /* ================= LIVE adapter (Supabase + Stripe) ================= */
  var Live = (function () {
    var sb = null, user = null, profile = null, pro = null;
    function rpc(name, args) { return sb.rpc(name, args || {}).then(function (r) { if (r.error) throw r.error; return r.data; }); }
    function q(p) { return p.then(function (r) { if (r.error) throw r.error; return r.data; }); }
    function fn(name, body) {
      return sb.auth.getSession().then(function (s) {
        return fetch(CFG.SUPABASE_URL + "/functions/v1/" + name, { method: "POST", headers: { "Content-Type": "application/json", apikey: CFG.SUPABASE_ANON_KEY, Authorization: "Bearer " + ((s.data.session && s.data.session.access_token) || CFG.SUPABASE_ANON_KEY) }, body: JSON.stringify(body || {}) })
          .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.message || j.error || ("Request failed (" + r.status + ")")); return j; }); });
      });
    }
    function loadScript(src) { return new Promise(function (res, rej) { if ($('script[src="' + src + '"]')) return res(); var s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = function () { rej(new Error("Couldn't load " + src)); }; document.head.appendChild(s); }); }
    function refreshMe() {
      return sb.auth.getUser().then(function (r) {
        user = r.data.user; if (!user) { profile = pro = null; return null; }
        return Promise.all([q(sb.from("profiles").select("*").eq("id", user.id).maybeSingle()), q(sb.from("pros").select("*").eq("id", user.id).maybeSingle())])
          .then(function (a) { profile = a[0]; pro = a[1]; return profile; });
      });
    }
    function decorateBids(h, bids) { return (bids || []).map(function (b) { b.effective = effective(b.per_home_price, b.flex_discount_pct, h.flex); return b; }).sort(function (a, b) { return a.effective - b.effective; }); }
    function payHold(herdId) {
      if (!CFG.STRIPE_PUBLISHABLE_KEY) return Promise.resolve(null);
      return Promise.all([loadScript("https://js.stripe.com/v3/"), fn("stripe-checkout", { action: "hold", herd_id: herdId })]).then(function (a) {
        var j = a[1]; if (j.already_held) return j; var stripe = window.Stripe(CFG.STRIPE_PUBLISHABLE_KEY);
        return new Promise(function (res, rej) {
          modal('<h3>Hold your spot</h3><p class="muted">Your card is authorized, not charged. You pay only after the crew finishes your home.</p><div id="pay-el"></div><div class="actions"><button class="btn primary" id="pay-go" type="button">Authorize ' + money2(j.amount_cents / 100) + '</button><button class="btn" data-close type="button">Cancel</button></div>', function (m, close) {
            var els = stripe.elements({ clientSecret: j.client_secret }), pe = els.create("payment"); pe.mount($("#pay-el", m));
            $("#pay-go", m).onclick = function () { this.disabled = true; stripe.confirmPayment({ elements: els, redirect: "if_required" }).then(function (r) { if (r.error) { $("#pay-go", m).disabled = false; toast(r.error.message, true); } else { close(); res(r.paymentIntent); } }); };
            $("[data-close]", m).addEventListener("click", function () { rej(new Error("Payment cancelled.")); });
          });
        });
      });
    }
    return {
      kind: "live",
      init: function () {
        return loadScript("https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2").then(function () {
          sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_ANON_KEY);
          sb.auth.onAuthStateChange(function () { refreshMe().then(bus); });
          return refreshMe();
        });
      },
      session: function () { return Promise.resolve(user ? Object.assign({}, profile || {}, { id: user.id, email: user.email, pro: pro }) : null); },
      signIn: function (email, role, first) {
        return q(sb.auth.signInWithOtp({ email: email, options: { emailRedirectTo: location.origin + "/account/", data: { role: role === "pro" ? "pro" : "home", first_name: first || "" } } })).then(function () { return "sent"; });
      },
      signOut: function () { return sb.auth.signOut(); },
      updateProfile: function (p) { return q(sb.from("profiles").update(p).eq("id", user.id).select().single()).then(function (r) { profile = r; return r; }); },
      categories: function () { return q(sb.from("categories").select("*").order("sort")); },
      listHerds: function (f) {
        f = f || {}; var x = sb.from("public_herds").select("*").order("created_at", { ascending: false }).limit(200);
        if (f.zip) x = x.like("zip", f.zip + "%"); if (f.category) x = x.eq("category", f.category);
        if (f.status === "open") x = x.in("status", ["forming", "bidding"]); else if (f.status) x = x.eq("status", f.status);
        return q(x);
      },
      getHerd: function (id) {
        var col = /^[A-Z0-9]{6}$/.test(id) ? "code" : "id";
        return q(sb.from("public_herds").select("*").eq(col, id).maybeSingle()).then(function (h) {
          if (!h) throw new Error("That bundle doesn't exist.");
          h.approvals = h.approved_count || 0;
          return Promise.all([
            q(sb.from("herd_events").select("*").eq("herd_id", h.id).order("created_at")),
            q(sb.from("public_bids").select("*").eq("herd_id", h.id)),
            user ? q(sb.from("herd_members").select("*").eq("herd_id", h.id).eq("user_id", user.id).maybeSingle()) : null,
            user ? q(sb.from("reviews").select("*").eq("herd_id", h.id).eq("user_id", user.id).maybeSingle()) : null,
            user && pro && h.winning_bid_id ? q(sb.from("bids").select("id").eq("id", h.winning_bid_id).eq("pro_id", user.id).maybeSingle()) : null
          ]).then(function (a) { return { herd: h, events: a[0] || [], bids: decorateBids(h, (a[1] || []).filter(function (b) { return b.status !== "withdrawn"; })), mine: a[2], myReview: a[3], iAmWinner: !!a[4] }; });
        });
      },
      createHerd: function (a) { return rpc("create_herd", { p_category: a.category, p_zip: a.zip, p_street_area: a.street_area || null, p_threshold: a.threshold ? Number(a.threshold) : null, p_window_start: a.window_start || null, p_window_end: a.window_end || null, p_flex: !!a.flex }); },
      joinHerd: function (id, w, notes) { return rpc("join_herd", { p_herd_id: id, p_flex_weeks: Number(w) || 0, p_notes: notes || null }); },
      leaveHerd: function (id) { return rpc("leave_herd", { p_herd_id: id }); },
      placeBid: function (id, price, flexPct, date, msg) { return rpc("place_bid", { p_herd_id: id, p_per_home_price: Number(price), p_flex_discount_pct: Number(flexPct) || 0, p_schedule_date: date || null, p_message: msg || null }); },
      withdrawBid: function (bid) { return rpc("withdraw_bid", { p_bid_id: bid }); },
      approveAward: function (id) { return payHold(id).then(function () { return rpc("approve_award", { p_herd_id: id }); }); },
      startRoute: function (id) { return rpc("start_route", { p_herd_id: id }); },
      completeRoute: function (id) { return rpc("complete_route", { p_herd_id: id }).then(function () { return CFG.STRIPE_PUBLISHABLE_KEY ? fn("stripe-checkout", { action: "capture_route", herd_id: id }) : null; }); },
      rateHerd: function (id, s, b) { return rpc("rate_herd", { p_herd_id: id, p_stars: Number(s), p_body: b || null }); },
      reportForecast: function (z, i, y) { return rpc("report_forecast", { p_zip: z, p_item: i, p_install_year: Number(y) }); },
      forecastByZip: function (z) { return q(sb.from("forecast_by_zip").select("*").eq("zip", z)); },
      becomePro: function (a) { return rpc("become_pro", { p_business_name: a.business_name, p_trades: a.trades, p_service_zips: a.service_zips, p_license_no: a.license_no }).then(function (r) { return refreshMe().then(function () { return r; }); }); },
      proConnect: function () { return fn("stripe-connect", { action: "onboard" }).then(function (j) { if (j.url) location.href = j.url; }); },
      myHerds: function () { if (!user) return Promise.resolve([]); return q(sb.from("herd_members").select("herd_id").eq("user_id", user.id)).then(function (rows) { var ids = rows.map(function (r) { return r.herd_id; }); return ids.length ? q(sb.from("public_herds").select("*").in("id", ids)) : []; }); },
      proBoard: function () {
        if (!pro) return Promise.resolve({ pro: null, open: [], filling: [], bids: [], routes: [] });
        var zips = pro.service_zips || [], any = zips.indexOf("*") >= 0;
        function scope(x) { x = x.in("category", pro.trades || []); return any ? x : x.in("zip", zips); }
        return Promise.all([
          q(scope(sb.from("public_herds").select("*").eq("status", "bidding"))),
          q(scope(sb.from("public_herds").select("*").eq("status", "forming")).limit(50)),
          q(sb.from("bids").select("*").eq("pro_id", user.id).neq("status", "withdrawn").order("created_at", { ascending: false }))
        ]).then(function (a) {
          var mine = a[2], won = mine.filter(function (b) { return b.status === "won"; }).map(function (b) { return b.herd_id; }), all = mine.map(function (b) { return b.herd_id; });
          return (all.length ? q(sb.from("public_herds").select("*").in("id", all)) : Promise.resolve([])).then(function (hs) {
            var byId = {}; hs.forEach(function (h) { byId[h.id] = h; });
            a[0].forEach(function (h) { var my = mine.filter(function (b) { return b.herd_id === h.id && b.status === "active"; })[0]; h.my_bid = my ? effective(my.per_home_price, my.flex_discount_pct, h.flex) : null; h.leading = !!(my && h.best_price != null && h.my_bid <= h.best_price); });
            return { pro: pro, open: a[0], filling: a[1], bids: mine.map(function (b) { return Object.assign({}, b, { herd: byId[b.herd_id] || null }); }), routes: won.map(function (id) { return byId[id]; }).filter(Boolean) };
          });
        });
      },
      routeStops: function (id) { return rpc("get_route_stops", { p_herd_id: id }); },
      notifications: function () { if (!user) return Promise.resolve([]); return q(sb.from("notifications").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(60)); },
      markRead: function () { return rpc("mark_notifications_read", { p_ids: null }); },
      createAgentKey: function (label) { return rpc("create_agent_key", { p_label: label || "My assistant" }); },
      agentKeys: function () { return q(sb.from("agent_keys").select("id,label,created_at,revoked").eq("user_id", user.id).eq("revoked", false)); },
      agentRequests: function () { return q(sb.from("agent_requests").select("*").eq("user_id", user.id).order("created_at", { ascending: false })).then(function (rs) { var ids = rs.map(function (r) { return r.herd_id; }); return (ids.length ? q(sb.from("public_herds").select("*").in("id", ids)) : Promise.resolve([])).then(function (hs) { return rs.map(function (r) { r.herd = hs.filter(function (h) { return h.id === r.herd_id; })[0]; return r; }); }); }); },
      respondAgentRequest: function (id, ok) { return rpc("respond_agent_request", { p_request_id: id, p_approve: !!ok }); },
      adminPros: function () { return q(sb.from("pros").select("*").order("created_at", { ascending: false })); },
      adminVerify: function (id, ok) { return rpc("admin_verify_pro", { p_pro_id: id, p_verified: !!ok }); },
      adminHerds: function () { return q(sb.from("public_herds").select("*").order("created_at", { ascending: false }).limit(300)); },
      subscribe: function (cb) { var t; function ping() { clearTimeout(t); t = setTimeout(cb, 250); } sb.channel("hw-live").on("postgres_changes", { event: "*", schema: "public", table: "bundles" }, ping).on("postgres_changes", { event: "*", schema: "public", table: "bids" }, ping).on("postgres_changes", { event: "*", schema: "public", table: "herd_members" }, ping).on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications" }, ping).subscribe(); }
    };
  })();

  var API = LIVE ? Live : Demo;
  window.StreetBundle = { api: API, live: LIVE };
  var subs = [];
  function bus() { subs.forEach(function (f) { try { f(); } catch (e) { console.error(e); } }); }
  function onChange(f) { subs.push(f); }

  /* ================= shared UI ================= */
  var ME = null, CATS = [];
  function catLabel(s) { var c = CATS.filter(function (x) { return x.slug === s; })[0]; return c ? c.label : s; }
  function catOptions(sel, any) { return (any ? '<option value="">' + any + "</option>" : "") + CATS.map(function (c) { return '<option value="' + c.slug + '"' + (c.slug === sel ? " selected" : "") + ">" + esc(c.label) + "</option>"; }).join(""); }
  function homesTxt(n, t) { return n >= t ? n + " homes" : n + "/" + t + " homes"; }
  function meter(n, t) { var s = "", total = Math.max(t, n); for (var i = 0; i < total; i++) s += "<i" + (i < n ? ' class="on"' : "") + "></i>"; return '<div class="meter" aria-label="' + n + " of " + t + ' homes">' + s + "</div>"; }
  function herdCard(h) {
    var pct = Math.min(100, Math.round(h.member_count / h.threshold * 100)), save = h.best_price && h.est_solo_price ? Math.max(0, Math.round((1 - h.best_price / h.est_solo_price) * 100)) : null;
    return '<article class="hcard"><div class="meta">' + chip(h.status) + (h.is_example ? '<span class="chip ex">Example</span>' : "") + (h.flex ? '<span class="chip">Flex timing</span>' : "") + "</div>" +
      '<h3><a href="/bundle/?id=' + encodeURIComponent(h.id) + '">' + esc(h.label || catLabel(h.category)) + "</a></h3>" +
      '<p class="muted">' + esc(h.street_area || "Neighborhood") + " · " + esc(h.zip) + "</p>" + meter(h.member_count, h.threshold) +
      '<div class="bar"><b style="width:' + pct + '%"></b></div><div class="stats"><span>' + homesTxt(h.member_count, h.threshold) + "</span><span>" +
      (h.status === "bidding" ? "Closes in " + timeLeft(h.bid_closes_at) : h.best_price ? money(h.best_price) + "/home" + (save ? " · " + save + "% off" : "") : "Solo ~" + money(h.est_solo_price)) + "</span></div>" +
      '<a class="btn small" href="/bundle/?id=' + encodeURIComponent(h.id) + '">' + (h.status === "forming" ? "Join this bundle" : "View bundle") + "</a></article>";
  }
  function requireSignIn(role, why) {
    return new Promise(function (res, rej) {
      if (ME) return res(ME);
      modal('<h3>' + (role === "pro" ? "Sign in as a pro" : "Sign in to continue") + '</h3><p class="muted">' + esc(why || "We'll email you a sign-in link. No password.") + '</p>' +
        '<form id="si" class="list"><label>First name<input name="first" autocomplete="given-name" placeholder="Your first name" required></label><label>Email<input name="email" type="email" autocomplete="email" placeholder="you@email.com" required></label>' +
        '<div class="actions"><button class="btn primary" type="submit">' + (LIVE ? "Email me a link" : "Continue (demo)") + '</button><button class="btn" type="button" data-close>Cancel</button></div></form>', function (m, close) {
        $("#si", m).onsubmit = function (e) {
          e.preventDefault(); var f = e.target;
          API.signIn(f.email.value.trim(), role, f.first.value.trim()).then(function (r) {
            if (r === "sent") { m.innerHTML = '<h3>Check your email</h3><p>We sent a sign-in link to <b>' + esc(f.email.value) + '</b>. Open it on this device and you\'ll land back here.</p><button class="btn" data-close type="button">OK</button>'; return rej(new Error("Check your email to finish signing in.")); }
            return (API.updateProfile ? API.updateProfile({ first_name: f.first.value.trim() }) : null);
          }).then(function () { return refreshSession(); }).then(function () { close(); res(ME); }).catch(function (er) { if (String(errMsg(er)).indexOf("Check your email") < 0) fail(er); });
        };
      });
    });
  }
  function refreshSession() { return API.session().then(function (s) { ME = s; paintHeader(); return s; }); }
  function paintHeader() {
    var slot = $("#acct"); if (!slot) return;
    if (!ME) { slot.innerHTML = '<a class="btn small" href="/account/">Sign in</a>'; return; }
    API.notifications().then(function (ns) {
      var unread = ns.filter(function (n) { return !n.read; }).length;
      slot.innerHTML = '<a class="bell" href="/account/#alerts" aria-label="Alerts">&#128276;' + (unread ? "<b>" + unread + "</b>" : "") + '</a><a class="btn small" href="' + (ME.pro ? "/pros/dashboard/" : "/account/") + '">' + esc(ME.first_name || "Account") + "</a>";
    }).catch(function () {});
  }
  function demoBar() {
    if (LIVE) return;
    var b = document.createElement("div"); b.className = "demo-bar";
    b.innerHTML = '<div class="wrap"><b>Demo mode</b><span>Saved on this device. Try every role:</span>' +
      '<button type="button" data-role="home">Homeowner</button><button type="button" data-role="pro">Pro</button><button type="button" data-role="admin">Admin</button>' +
      '<button type="button" data-skip="24">Skip 24h</button><button type="button" data-skip="49">Skip 49h</button><button type="button" data-reset>Reset demo</button><span class="mono" id="demo-clock"></span></div>';
    document.body.insertBefore(b, document.body.firstChild);
    function clk() { var c = $("#demo-clock"); if (c) c.textContent = clockOffset ? "Demo clock: +" + Math.round(clockOffset / HOUR) + "h" : ""; }
    clk();
    b.addEventListener("click", function (e) {
      var r = e.target.getAttribute("data-role"), s = e.target.getAttribute("data-skip");
      if (r) API.signIn("", r).then(refreshSession).then(function () { if (r === "pro" && ME && !ME.pro) toast("You're a pro now. Fill in your pro profile to bid."); else toast("Viewing as " + (r === "home" ? "a homeowner" : r === "pro" ? "a pro" : "an admin")); bus(); });
      if (s) API.skipAhead(Number(s)).then(function () { clk(); toast("Clock moved ahead " + s + " hours. Timers and triggers ran."); });
      if (e.target.hasAttribute("data-reset")) API.reset().then(function () { clk(); return refreshSession(); }).then(function () { toast("Demo reset."); });
    });
  }
  function wireChrome() {
    var btn = $(".menu-btn"), nav = $("#nav");
    if (btn && nav) btn.addEventListener("click", function () { var o = nav.classList.toggle("open"); btn.setAttribute("aria-expanded", o); });
    $$(".copy-phone").forEach(function (b) { b.addEventListener("click", function () { var t = CFG.PHONE || "1-800-481-8638"; (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { toast("Copied " + t); }, function () { toast(t); }); }); });
    var here = location.pathname.replace(/index\.html$/, "");
    $$("#nav a").forEach(function (a) { if (a.getAttribute("href") === here) a.setAttribute("aria-current", "page"); });
  }
  function heroForm() {
    $$(".hero-form").forEach(function (f) {
      var sel = $("select", f); if (sel) sel.innerHTML = catOptions("", "Any service");
      f.addEventListener("submit", function (e) { e.preventDefault(); var z = $("input", f).value.trim(); if (!zipOk(z)) return toast("Enter a 5-digit ZIP code.", true); location.href = "/bundles/?zip=" + z + (sel && sel.value ? "&category=" + sel.value : ""); });
    });
  }

  /* ================= pages ================= */
  var pages = {};

  pages.home = function () {
    function draw() {
      API.listHerds({ status: "" }).then(function (hs) {
        var open = hs.filter(function (h) { return h.status === "forming" || h.status === "bidding"; });
        var hero = open.filter(function (h) { return h.status === "bidding"; })[0] || open[0];
        if (hero && $("#hero-live")) $("#hero-live").innerHTML = '<div class="row"><span class="eyebrow">Live bundle</span>' + chip(hero.status) + (hero.is_example ? '<span class="chip ex">Example</span>' : "") + '</div><h3 style="margin-top:10px">' + esc(hero.label) + '</h3><p class="muted">' + esc(hero.street_area) + " · " + hero.zip + "</p>" + meter(hero.member_count, hero.threshold) +
          '<div class="row"><span class="mono">' + homesTxt(hero.member_count, hero.threshold) + '</span><span class="mono">' + (hero.best_price ? "Best " + money(hero.best_price) + "/home" : "Solo ~" + money(hero.est_solo_price)) + '</span></div><p style="margin-top:12px"><a class="btn small primary" href="/bundle/?id=' + hero.id + '">See this bundle</a></p>';
        var homes = hs.reduce(function (s, h) { return s + h.member_count; }, 0), bidding = hs.filter(function (h) { return h.status === "bidding"; }).length;
        var savings = hs.filter(function (h) { return h.best_price && h.est_solo_price; }).map(function (h) { return 1 - h.best_price / h.est_solo_price; });
        var avg = savings.length ? Math.round(savings.reduce(function (a, b) { return a + b; }, 0) / savings.length * 100) : 0;
        if ($("#live-stats")) $("#live-stats").innerHTML = [["Open bundles", open.length], ["Homes in bundles", homes], ["Bidding right now", bidding], ["Avg. bundle price vs. solo", avg ? "−" + avg + "%" : "—"]].map(function (s) { return '<div class="tile"><span class="num">' + s[1] + '</span><span class="muted">' + s[0] + "</span></div>"; }).join("");
        if ($("#home-bundles")) $("#home-bundles").innerHTML = open.slice(0, 6).map(herdCard).join("") || '<div class="empty">No open bundles yet. <a href="/start/">Start the first one.</a></div>';
      }).catch(fail);
    }
    draw(); onChange(draw);
  };

  pages.herds = function () {
    var f = $("#board-filters"), z = $("#bf-zip"), c = $("#bf-cat"), s = $("#bf-status");
    c.innerHTML = catOptions(qs("category") || "", "All services"); z.value = qs("zip") || "";
    function draw() {
      API.listHerds({ zip: z.value.trim(), category: c.value, status: s.value }).then(function (hs) {
        $("#board").innerHTML = hs.map(herdCard).join("") || '<div class="empty"><p><b>No bundles match yet.</b></p><p>Be the first on your street. It takes a minute.</p><p class="mt"><a class="btn primary" href="/start/?zip=' + esc(z.value) + "&category=" + esc(c.value) + '">Start a bundle here</a></p></div>';
        $("#board-count").textContent = hs.length + " bundle" + (hs.length === 1 ? "" : "s");
      }).catch(fail);
    }
    f.addEventListener("input", function () { clearTimeout(f._t); f._t = setTimeout(draw, 200); });
    f.addEventListener("submit", function (e) { e.preventDefault(); draw(); });
    draw(); onChange(draw); setInterval(draw, 60000);
  };

  pages.herd = function () {
    var id = qs("id") || qs("code"), root = $("#bundle-root");
    if (!id) { root.innerHTML = '<div class="empty">No bundle selected. <a href="/bundles/">Browse bundles</a></div>'; return; }
    function draw() {
      API.getHerd(id).then(function (d) {
        var h = d.herd, mine = d.mine, isPro = !!(ME && ME.pro), wb = d.bids.filter(function (b) { return b.id === h.winning_bid_id; })[0];
        document.title = (h.label || "Bundle") + " in " + h.zip + " | " + (CFG.BRAND || "StreetBundle");
        var steps = [["forming", "Bundle filling"], ["bidding", "Pros bidding"], ["awarded", "Approve price"], ["scheduled", "Scheduled"], ["in_progress", "On the street"], ["completed", "Done"]];
        var idx = steps.map(function (x) { return x[0]; }).indexOf(h.status);
        var tl = steps.map(function (x, i) { return '<div class="' + (i < idx || h.status === "completed" ? "done" : i === idx ? "now" : "") + '">' + x[1] + "</div>"; }).join("");
        var act = "";
        if (h.is_example) act = '<div class="notice">This is an example bundle so you can see how it works. <a href="/start/?zip=' + h.zip + "&category=" + h.category + '">Start a real one for your street</a>.</div>';
        else if (!mine && (h.status === "forming" || h.status === "bidding") && !isPro) act = '<form id="join-f" class="form"><h3>Join this bundle</h3><label>How flexible is your timing?<select name="flex"><option value="0">I need the listed window</option><option value="1">I can flex 1 week</option><option value="2">I can flex 2 weeks</option><option value="4">Anytime this season</option></select><small>Flexible homes help pros build tighter routes' + (h.flex ? ", and get the flex discount" : "") + '.</small></label><label>Notes for the pro <small>(optional)</small><input name="notes" maxlength="200" placeholder="Two-story, side gate, dog in yard"></label><button class="btn primary" type="submit">Join · free</button><p class="src">Joining is free. You only pay if you approve the winning price.</p></form>';
        else if (mine && h.status === "forming") act = '<div class="item"><b class="note-ok">You\'re in.</b><p class="muted">Share the link with neighbors. Bidding opens on its own at ' + h.threshold + ' homes.</p><div class="actions"><button class="btn primary" id="share" type="button">Share with neighbors</button><button class="btn" id="leave" type="button">Leave bundle</button>' + (!LIVE ? '<button class="btn" id="nb" type="button">Demo: add a neighbor</button>' : "") + "</div></div>";
        else if (mine && h.status === "bidding") act = '<div class="item"><b class="note-ok">You\'re in. Bidding is open.</b><p class="muted">Bids close in <span class="countdown">' + timeLeft(h.bid_closes_at) + "</span>. The best qualified bid wins, then you approve the price.</p>" + (!LIVE ? '<p class="src">Demo: use "Skip 49h" in the yellow bar to close bidding now.</p>' : "") + "</div>";
        else if (mine && h.status === "awarded" && !mine.approved) act = '<div class="item"><h3>Approve ' + money2(h.best_price) + '/home</h3><p class="muted">' + esc(wb ? wb.business_name : "The winning pro") + " won your bundle. Approve to lock your spot. Your card is held, not charged, until your home is done.</p><button class=\"btn primary\" id=\"approve\" type=\"button\">Approve & hold my spot</button></div>";
        else if (mine && h.status === "awarded") act = '<div class="item"><b class="note-ok">Approved.</b><p class="muted">' + h.approvals + " of " + h.member_count + " homes approved. The route locks when everyone approves or the window closes.</p></div>";
        else if (mine && (h.status === "scheduled" || h.status === "in_progress")) act = '<div class="item"><b class="note-ok">' + (h.status === "scheduled" ? "You're on the route for " + fmtDate(h.scheduled_for) + "." : "The crew is on your street today.") + "</b><p class=\"muted\">We'll text you when they're done.</p></div>";
        else if (mine && h.status === "completed") act = d.myReview ? '<div class="item"><b>Thanks for rating.</b> <span class="stars">' + "★".repeat(d.myReview.stars) + "</span></div>" : '<form id="rate-f" class="form"><h3>How did the crew do?</h3><div class="star-pick" id="sp">' + [1, 2, 3, 4, 5].map(function (n) { return '<button type="button" data-s="' + n + '" aria-label="' + n + ' stars">★</button>'; }).join("") + '</div><label>Short review<textarea name="body" rows="3" maxlength="600" placeholder="On time, clean work, fair price"></textarea></label><button class="btn primary" type="submit">Post rating</button></form>';
        if (isPro && h.status === "bidding" && !h.is_example) act += '<div class="item mt"><b>Pros:</b> this bundle is open for bids. <a class="btn small primary" href="/pros/dashboard/?bid=' + h.id + '">Bid on this route</a></div>';
        if (d.iAmWinner) act += '<div class="item mt"><b>You won this route.</b><div class="actions">' + (h.status === "scheduled" ? '<button class="btn primary" id="start-r" type="button">Start route</button>' : "") + (h.status === "in_progress" ? '<button class="btn primary" id="done-r" type="button">Mark route complete</button>' : "") + '<a class="btn" href="/pros/dashboard/#routes">Route stops</a></div></div>';

        var bidRows = d.bids.length ? '<div class="scroll-x"><table><thead><tr><th>Pro</th><th class="mono">Per home</th><th>Date</th><th>Notes</th></tr></thead><tbody>' + d.bids.map(function (b, i) {
          return '<tr class="' + ((h.status === "bidding" && i === 0 && b.status === "active") || b.status === "won" ? "best" : "") + '"><td><b>' + esc(b.business_name || "Verified pro") + '</b><br><span class="src">' + (b.verified ? "Verified · " : "") + (b.rating ? "★ " + b.rating + " · " : "") + (b.jobs_done || 0) + " bundles" + (b.status === "won" ? " · <b>Winner</b>" : b.status === "lost" ? " · not selected" : "") + '</span></td><td class="mono">' + money2(b.effective) + (h.flex && b.flex_discount_pct ? '<br><span class="src">incl. ' + b.flex_discount_pct + "% flex</span>" : "") + "</td><td>" + fmtDate(b.schedule_date) + "</td><td>" + esc(b.message || "") + "</td></tr>";
        }).join("") + "</tbody></table></div>" : '<p class="muted">' + (h.status === "forming" ? "Bids open when the bundle fills." : "No bids yet.") + "</p>";
        var evLabel = { created: "Bundle started", joined: "A home joined", left: "A home left", bidding_opened: "Bundle filled. Bidding opened", bid_placed: "New bid", bidding_extended: "Bidding extended 24h", awarded: "Winner picked", approved: "A home approved", scheduled: "Route scheduled", started: "Crew started", completed: "Route complete", rated: "Rated", expired: "Expired" };
        var evs = d.events.slice(-12).reverse().map(function (e) { return '<div class="stop" style="grid-template-columns:1fr auto"><span>' + esc(evLabel[e.kind] || e.kind) + (e.payload && e.payload.price ? " · " + money(e.payload.price) + "/home" : "") + (e.payload && e.payload.count ? " · " + e.payload.count + " homes" : "") + '</span><span class="src">' + fmtDateTime(e.created_at) + "</span></div>"; }).join("");
        var save = h.best_price && h.est_solo_price ? Math.round((1 - h.best_price / h.est_solo_price) * 100) : null;

        root.innerHTML = '<p class="crumbs"><a href="/">Home</a> / <a href="/bundles/">Bundles</a> / ' + esc(h.code || "") + '</p><div class="meta" style="display:flex;gap:6px;flex-wrap:wrap">' + chip(h.status) + (h.is_example ? '<span class="chip ex">Example</span>' : "") + (h.flex ? '<span class="chip">Flex timing</span>' : "") + '<span class="chip">Code ' + esc(h.code || "") + '</span></div><h1 style="margin-top:12px;font-size:clamp(2rem,5vw,3.2rem)">' + esc(h.label) + '</h1><p class="sub muted" style="margin-top:8px">' + esc(h.street_area || "Neighborhood") + " · " + esc(h.zip) + "</p>" +
          '<div class="detail mt2"><div class="list"><div class="item">' + meter(h.member_count, h.threshold) + '<div class="row"><b class="mono">' + (h.member_count >= h.threshold ? h.member_count + " homes in" : h.member_count + " of " + h.threshold + " homes") + '</b><span class="muted">' + (h.status === "forming" ? Math.max(0, h.threshold - h.member_count) + " more to open bidding" : h.status === "bidding" ? "Bids close in " + timeLeft(h.bid_closes_at) : STATUS[h.status].label) + "</span></div></div>" + act +
          '<div class="item"><h3>Bids</h3>' + bidRows + '</div></div><aside class="list"><div class="item"><h3>The numbers</h3><dl class="kv"><dt>Solo price, typical</dt><dd>' + money(h.est_solo_price) + "</dd><dt>" + (h.status === "bidding" ? "Best bid now" : "Bundle price") + "</dt><dd>" + (h.best_price ? money2(h.best_price) : "—") + "</dd><dt>You save</dt><dd>" + (save != null ? save + "%" : "—") + "</dd><dt>Window</dt><dd>" + (h.window_start || h.window_end ? fmtDate(h.window_start) + " – " + fmtDate(h.window_end) : "Flexible") + "</dd><dt>Max homes</dt><dd>" + h.max_homes + '</dd></dl></div><div class="item"><h3>Progress</h3><div class="timeline">' + tl + '</div></div><div class="item"><h3>Activity</h3>' + (evs || '<p class="muted">Nothing yet.</p>') + "</div></aside></div>";

        var jf = $("#join-f"); if (jf) jf.onsubmit = function (e) { e.preventDefault(); requireSignIn("home", "Joining is free. We'll only share your first name and street with the bundle.").then(function () { return API.joinHerd(h.id, jf.flex.value, jf.notes.value); }).then(function () { toast("You're in the bundle."); refreshSession(); draw(); }).catch(function (er) { if (String(errMsg(er)).indexOf("Check your email") < 0) fail(er); }); };
        var sh = $("#share"); if (sh) sh.onclick = function () { var url = location.origin + "/bundle/?id=" + h.id, txt = "I started a " + h.label.toLowerCase() + " bundle for our street. If " + h.threshold + " homes join, local pros bid and we all pay less: " + url; if (navigator.share) navigator.share({ title: "Join our bundle", text: txt, url: url }).catch(function () {}); else (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(function () { toast("Invite copied. Paste it in your neighborhood group or text thread."); }, function () { toast(url); }); };
        var lv = $("#leave"); if (lv) lv.onclick = function () { API.leaveHerd(h.id).then(function () { toast("You left the bundle."); draw(); }).catch(fail); };
        var nb = $("#nb"); if (nb) nb.onclick = function () { API.demoNeighbor(h.id).then(function (x) { toast(x.status === "bidding" ? "Bundle filled. Bidding opened on its own." : "A neighbor joined."); draw(); }).catch(fail); };
        var ap = $("#approve"); if (ap) ap.onclick = function () { ap.disabled = true; API.approveAward(h.id).then(function () { toast("Approved. Your spot is locked."); draw(); refreshSession(); }).catch(function (e) { ap.disabled = false; fail(e); }); };
        var sr = $("#start-r"); if (sr) sr.onclick = function () { API.startRoute(h.id).then(function () { toast("Route started. Households were notified."); draw(); }).catch(fail); };
        var dr = $("#done-r"); if (dr) dr.onclick = function () { API.completeRoute(h.id).then(function () { toast("Route complete. Payments released."); draw(); }).catch(fail); };
        var rf = $("#rate-f"); if (rf) { var stars = 0; $$("#sp button").forEach(function (b) { b.onclick = function () { stars = Number(b.getAttribute("data-s")); $$("#sp button").forEach(function (x) { x.classList.toggle("on", Number(x.getAttribute("data-s")) <= stars); }); }; });
          rf.onsubmit = function (e) { e.preventDefault(); if (!stars) return toast("Pick 1–5 stars.", true); API.rateHerd(h.id, stars, rf.body.value).then(function () { toast("Thanks. Your rating helps the next bundle."); draw(); }).catch(fail); }; }
      }).catch(function (e) { root.innerHTML = '<div class="empty">' + esc(errMsg(e)) + ' <a href="/bundles/">Browse bundles</a></div>'; });
    }
    draw(); onChange(draw); setInterval(function () { var c = $(".countdown"); if (c) draw(); }, 60000);
  };

  pages.start = function () {
    var st = { step: 1, category: qs("category") || "", zip: qs("zip") || "", street_area: "", threshold: "", window_start: "", window_end: "", flex: true, notes: "" };
    var root = $("#wiz");
    function cat() { return CATS.filter(function (c) { return c.slug === st.category; })[0]; }
    function draw() {
      var head = '<div class="wiz-steps">' + ["Service", "Where", "When", "Review"].map(function (s, i) { return '<span class="' + (i + 1 === st.step ? "on" : "") + '">' + (i + 1) + ". " + s + "</span>"; }).join("") + "</div>";
      var body = "";
      if (st.step === 1) body = '<h2>What does your street need?</h2><div class="cat-grid mt">' + CATS.map(function (c) { return '<button type="button" data-c="' + c.slug + '" aria-pressed="' + (c.slug === st.category) + '">' + esc(c.label) + "<small>Solo ~" + money(c.est_solo_price) + "</small></button>"; }).join("") + '</div><div class="actions mt"><button class="btn primary" data-next type="button">Next</button></div>';
      if (st.step === 2) body = '<h2>Where is the bundle?</h2><div class="form mt"><div class="two"><label>ZIP code<input id="w-zip" inputmode="numeric" maxlength="5" value="' + esc(st.zip) + '" placeholder="80204" required></label><label>Street or area name<input id="w-area" maxlength="80" value="' + esc(st.street_area) + '" placeholder="Maple St and nearby"></label></div><label>Homes needed to open bidding<input id="w-th" type="number" min="3" max="25" value="' + esc(st.threshold || (cat() ? cat().default_threshold : 6)) + '"><small>Most bundles use 5–8. Smaller fills faster, bigger gets better prices.</small></label></div><div class="actions mt"><button class="btn" data-back type="button">Back</button><button class="btn primary" data-next type="button">Next</button></div>';
      if (st.step === 3) body = '<h2>When works?</h2><div class="form mt"><div class="two"><label>Earliest date<input id="w-ws" type="date" value="' + esc(st.window_start) + '"></label><label>Latest date<input id="w-we" type="date" value="' + esc(st.window_end) + '"></label></div><label style="grid-template-columns:auto 1fr;align-items:center"><input id="w-flex" type="checkbox" style="width:22px;min-height:22px" ' + (st.flex ? "checked" : "") + '> Flexible timing bundle <small>Pros can offer a lower price for homes that let them pick the day.</small></label><label>Notes for pros <small>(optional)</small><input id="w-notes" maxlength="200" value="' + esc(st.notes) + '" placeholder="Mostly two-story homes, 1990s builds"></label></div><div class="actions mt"><button class="btn" data-back type="button">Back</button><button class="btn primary" data-next type="button">Review</button></div>';
      if (st.step === 4) { var c = cat(); body = '<h2>Look good?</h2><div class="item mt"><dl class="kv"><dt>Service</dt><dd>' + esc(c ? c.label : "") + "</dd><dt>Where</dt><dd>" + esc(st.street_area || "My street") + " · " + esc(st.zip) + "</dd><dt>Opens bidding at</dt><dd>" + esc(st.threshold) + " homes</dd><dt>Window</dt><dd>" + (st.window_start ? fmtDate(st.window_start) : "Flexible") + " – " + (st.window_end ? fmtDate(st.window_end) : "Flexible") + "</dd><dt>Flex timing</dt><dd>" + (st.flex ? "Yes" : "No") + '</dd><dt>Solo price, typical</dt><dd>' + money(c ? c.est_solo_price : 0) + '</dd></dl></div><p class="src mt">You join first. The bundle stays open 21 days. If it fills, bidding opens on its own for ' + (CFG.BID_WINDOW_HOURS || 48) + ' hours.</p><div class="actions mt"><button class="btn" data-back type="button">Back</button><button class="btn primary" id="w-go" type="button">Start my bundle</button></div>'; }
      root.innerHTML = head + body;
    }
    root.addEventListener("click", function (e) {
      var c = e.target.closest("[data-c]"); if (c) { st.category = c.getAttribute("data-c"); var cc = cat(); if (!st.threshold && cc) st.threshold = cc.default_threshold; draw(); return; }
      if (e.target.hasAttribute("data-back")) { st.step--; draw(); return; }
      if (e.target.hasAttribute("data-next")) {
        if (st.step === 1 && !st.category) return toast("Pick a service.", true);
        if (st.step === 2) { st.zip = $("#w-zip").value.trim(); st.street_area = $("#w-area").value.trim(); st.threshold = $("#w-th").value; if (!zipOk(st.zip)) return toast("Enter a 5-digit ZIP code.", true); if (!(st.threshold >= 3 && st.threshold <= 25)) return toast("Pick 3 to 25 homes.", true); }
        if (st.step === 3) { st.window_start = $("#w-ws").value; st.window_end = $("#w-we").value; st.flex = $("#w-flex").checked; st.notes = $("#w-notes").value.trim(); if (st.window_start && st.window_end && st.window_end < st.window_start) return toast("Latest date must be after the earliest.", true); }
        st.step++; draw(); return;
      }
      if (e.target.id === "w-go") {
        e.target.disabled = true;
        requireSignIn("home", "You'll be the first home in the bundle. We only share your first name and street with neighbors.").then(function () { return API.createHerd(st); }).then(function (h) { location.href = "/bundle/?id=" + encodeURIComponent(h.id); }).catch(function (er) { e.target.disabled = false; if (String(errMsg(er)).indexOf("Check your email") < 0) fail(er); });
      }
    });
    draw();
  };

  pages.account = function () {
    var root = $("#acct-root");
    function draw() {
      if (!ME) { root.innerHTML = '<div class="split"><div class="form"><h2>Sign in</h2><p class="muted">' + (LIVE ? "We'll email you a one-tap sign-in link." : "Demo mode: pick a role in the yellow bar or continue below.") + '</p><button class="btn primary" id="si-btn" type="button">Sign in or create account</button></div><div class="item"><h3>Are you a pro?</h3><p class="muted">Bid on whole streets of work in your service area.</p><a class="btn" href="/pros/join/">Apply as a pro</a></div></div>'; $("#si-btn").onclick = function () { requireSignIn("home").then(draw).catch(function () {}); }; return; }
      root.innerHTML = '<div class="tabs" role="tablist"><button role="tab" data-t="bundles">My bundles</button><button role="tab" data-t="alerts">Alerts</button><button role="tab" data-t="agents">AI assistant</button><button role="tab" data-t="profile">Profile</button></div><div class="panel" data-p="bundles"></div><div class="panel" data-p="alerts" hidden></div><div class="panel" data-p="agents" hidden></div><div class="panel" data-p="profile" hidden></div>';
      function tab(t) { $$(".tabs button", root).forEach(function (b) { b.setAttribute("aria-selected", b.getAttribute("data-t") === t); }); $$(".panel", root).forEach(function (p) { p.hidden = p.getAttribute("data-p") !== t; }); }
      $(".tabs", root).onclick = function (e) { var t = e.target.getAttribute("data-t"); if (t) { history.replaceState(null, "", "#" + t); tab(t); } };
      tab((location.hash || "#bundles").slice(1) || "bundles");
      API.myHerds().then(function (hs) { $('[data-p="bundles"]').innerHTML = (hs.length ? '<div class="bundle-list">' + hs.map(herdCard).join("") + "</div>" : '<div class="empty"><p>You\'re not in any bundles yet.</p><p class="mt"><a class="btn primary" href="/start/">Start a bundle</a> <a class="btn" href="/bundles/">Find one</a></p></div>'); }).catch(fail);
      API.notifications().then(function (ns) { $('[data-p="alerts"]').innerHTML = '<div class="actions" style="margin-bottom:12px"><button class="btn small" id="mr" type="button">Mark all read</button></div><div class="list">' + (ns.map(function (n) { return '<div class="item ' + (n.read ? "" : "unread") + '"><div class="row"><b>' + esc(n.title) + '</b><span class="src">' + fmtDateTime(n.created_at) + '</span></div><p class="muted">' + esc(n.body) + "</p>" + (n.herd_id ? '<a class="btn small" href="/bundle/?id=' + n.herd_id + '">Open bundle</a>' : "") + "</div>"; }).join("") || '<p class="muted">No alerts yet. We\'ll tell you when your bundle fills, bids come in, and your crew is on the way.</p>') + "</div>"; var mr = $("#mr"); if (mr) mr.onclick = function () { API.markRead().then(function () { draw(); refreshSession(); }); }; }).catch(fail);
      Promise.all([API.agentKeys(), API.agentRequests()]).then(function (a) {
        var keys = a[0], reqs = a[1];
        $('[data-p="agents"]').innerHTML = '<div class="split"><div class="item"><h3>Let your AI assistant find bundles</h3><p class="muted">Create a key for an assistant you trust. It can read open bundles and <b>ask</b> to join one for you. Nothing happens until you approve it here.</p><form id="ak" class="actions mt"><input name="label" placeholder="Assistant name" style="flex:1 1 180px" maxlength="40"><button class="btn primary" type="submit">Create key</button></form><div id="ak-out"></div><div class="list mt">' + keys.map(function (k) { return '<div class="item"><div class="row"><b>' + esc(k.label) + '</b><span class="src">' + fmtDate(k.created_at) + "</span></div></div>"; }).join("") + '</div><p class="src mt">Developers: see the <a href="/agents/">Bundle Protocol</a>.</p></div><div class="item"><h3>Requests from your assistant</h3><div class="list">' +
          (reqs.map(function (r) { return '<div class="item"><div class="row"><b>' + esc(r.herd ? r.herd.label + " · " + r.herd.zip : "Bundle") + '</b><span class="badge ' + (r.status === "approved" ? "ok" : r.status === "declined" ? "bad" : "warn") + '">' + esc(r.status) + "</span></div>" + (r.status === "pending" ? '<div class="actions"><button class="btn small primary" data-ar="' + r.id + '" data-ok="1" type="button">Approve & join</button><button class="btn small" data-ar="' + r.id + '" data-ok="0" type="button">Decline</button></div>' : "") + "</div>"; }).join("") || '<p class="muted">No requests yet.</p>') + "</div>" + (!LIVE ? '<button class="btn small mt" id="sim-ar" type="button">Demo: have an assistant request a bundle</button>' : "") + "</div></div>";
        $("#ak").onsubmit = function (e) { e.preventDefault(); API.createAgentKey(e.target.label.value).then(function (raw) { modal('<h3>Your assistant key</h3><p class="muted">Copy it now. It won\'t be shown again. Paste it into your assistant\'s settings.</p><pre id="ak-key">' + esc(raw) + '</pre><div class="actions"><button class="btn primary" id="ak-copy" type="button">Copy key</button><button class="btn" data-close type="button">Done</button></div>', function (m) { $("#ak-copy", m).onclick = function () { (navigator.clipboard ? navigator.clipboard.writeText(raw) : Promise.reject()).then(function () { toast("Key copied."); }, function () { toast("Select the key and copy it."); }); }; }); }).catch(fail); };
        $$("[data-ar]").forEach(function (b) { b.onclick = function () { API.respondAgentRequest(b.getAttribute("data-ar"), b.getAttribute("data-ok") === "1").then(function () { toast("Done."); draw(); }).catch(fail); }; });
        var sim = $("#sim-ar"); if (sim) sim.onclick = function () { API.demoAgentRequest().then(function () { toast("Your assistant asked to join a bundle."); draw(); }).catch(fail); };
      }).catch(fail);
      $('[data-p="profile"]').innerHTML = '<form id="pf" class="form" style="max-width:560px"><div class="two"><label>First name<input name="first_name" value="' + esc(ME.first_name || "") + '" placeholder="Your first name"></label><label>Mobile for texts<input name="phone" type="tel" value="' + esc(ME.phone || "") + '" placeholder="(555) 555-5555"></label></div><div class="two"><label>Street <small>(shared with your bundle)</small><input name="street" value="' + esc(ME.street || "") + '" placeholder="Maple St"></label><label>ZIP<input name="zip" inputmode="numeric" maxlength="5" value="' + esc(ME.zip || "") + '" placeholder="80204"></label></div><p class="src">Your full address goes only to the winning pro, after you approve a price.</p><div class="actions"><button class="btn primary" type="submit">Save</button><button class="btn" id="so" type="button">Sign out</button></div></form>';
      $("#pf").onsubmit = function (e) { e.preventDefault(); var f = e.target; if (f.zip.value && !zipOk(f.zip.value)) return toast("Enter a 5-digit ZIP.", true); API.updateProfile({ first_name: f.first_name.value.trim(), phone: f.phone.value.trim(), street: f.street.value.trim(), zip: f.zip.value.trim() }).then(function () { toast("Saved."); refreshSession(); }).catch(fail); };
      $("#so").onclick = function () { API.signOut().then(refreshSession).then(draw); };
    }
    draw(); onChange(function () { refreshSession().then(draw); });
  };

  pages["pro-join"] = function () {
    var f = $("#pj"), box = $("#pj-trades");
    box.innerHTML = CATS.map(function (c) { return '<label style="grid-template-columns:auto 1fr;align-items:center;font-weight:500"><input type="checkbox" name="trade" value="' + c.slug + '" style="width:20px;min-height:20px"> ' + esc(c.label) + "</label>"; }).join("");
    f.onsubmit = function (e) {
      e.preventDefault();
      var trades = $$('input[name="trade"]:checked', f).map(function (i) { return i.value; });
      var zips = f.zips.value.split(/[\s,]+/).filter(Boolean);
      if (!trades.length) return toast("Pick at least one service.", true);
      if (!zips.length || !zips.every(function (z) { return zipOk(z) || z === "*"; })) return toast("List 5-digit service ZIPs, separated by commas.", true);
      requireSignIn("pro", "We'll email you a link to finish your pro account.").then(function () { return API.becomePro({ business_name: f.biz.value.trim(), trades: trades, service_zips: zips, license_no: f.lic.value.trim() }); })
        .then(function () { return refreshSession(); }).then(function () { location.href = "/pros/dashboard/"; }).catch(function (er) { if (String(errMsg(er)).indexOf("Check your email") < 0) fail(er); });
    };
  };

  pages["pro-dash"] = function () {
    var root = $("#pd-root");
    function draw() {
      if (!ME) { root.innerHTML = '<div class="empty"><p>Sign in to see bundles in your area.</p><p class="mt"><button class="btn primary" id="pd-si" type="button">Sign in</button> <a class="btn" href="/pros/join/">Apply as a pro</a></p></div>'; $("#pd-si").onclick = function () { requireSignIn("pro").then(draw).catch(function () {}); }; return; }
      API.proBoard().then(function (b) {
        if (!b.pro) { root.innerHTML = '<div class="empty"><p><b>Set up your pro profile first.</b></p><p class="mt"><a class="btn primary" href="/pros/join/">Set up pro profile</a></p></div>'; return; }
        var p = b.pro, fee = CFG.PLATFORM_FEE_PCT || 8;
        root.innerHTML = '<div class="grid g4"><div class="tile"><span class="num">' + b.open.length + '</span><span class="muted">Bundles open for bids</span></div><div class="tile"><span class="num">' + (b.filling || []).length + '</span><span class="muted">Filling in your area</span></div><div class="tile"><span class="num">' + b.routes.length + '</span><span class="muted">Routes won</span></div><div class="tile"><span class="num">' + (p.rating ? "★ " + p.rating : "New") + '</span><span class="muted">' + (p.jobs_done || 0) + " bundles done</span></div></div>" +
          (p.verified ? "" : '<div class="notice mt"><b>Verification pending.</b> We check license and insurance before you can bid. You can still watch bundles fill.' + (!LIVE ? " (Demo: switch to Admin in the yellow bar and approve yourself.)" : "") + "</div>") +
          (LIVE && !p.stripe_account_id ? '<div class="notice mt"><b>Get paid:</b> connect a payout account so captured payments reach you. <button class="btn small" id="connect" type="button">Connect payouts</button></div>' : "") +
          '<div class="tabs mt2" role="tablist"><button data-t="open">Open for bids</button><button data-t="filling">Filling</button><button data-t="bids">My bids</button><button data-t="routes">Routes</button><button data-t="profile">Profile</button></div>' +
          '<div class="panel" data-p="open"><div class="bundle-list">' + (b.open.map(function (h) { return '<article class="hcard"><div class="meta">' + chip(h.status) + (h.is_example ? '<span class="chip ex">Example</span>' : "") + (h.leading ? '<span class="chip live">You lead</span>' : h.my_bid ? '<span class="chip">Outbid</span>' : "") + '</div><h3><a href="/bundle/?id=' + h.id + '">' + esc(h.label) + '</a></h3><p class="muted">' + esc(h.street_area) + " · " + h.zip + '</p><div class="stats"><span>' + h.member_count + ' homes</span><span>Closes in ' + timeLeft(h.bid_closes_at) + '</span></div><div class="stats"><span>Best: ' + (h.best_price ? money2(h.best_price) : "no bids") + "</span><span>" + (h.my_bid ? "Yours: " + money2(h.my_bid) : "") + '</span></div><button class="btn small primary" data-bid="' + h.id + '" type="button"' + (p.verified && !h.is_example ? "" : " disabled") + ">" + (h.my_bid ? "Update bid" : "Bid on route") + "</button></article>"; }).join("") || '<div class="empty">No bundles are open for bids in your trades and ZIPs right now. You\'ll get an alert the moment one fills.</div>') + "</div></div>" +
          '<div class="panel" data-p="filling" hidden><div class="bundle-list">' + ((b.filling || []).map(herdCard).join("") || '<div class="empty">Nothing filling in your area yet.</div>') + "</div></div>" +
          '<div class="panel" data-p="bids" hidden><div class="list">' + (b.bids.map(function (x) { return '<div class="item"><div class="row"><b>' + esc(x.herd ? x.herd.label + " · " + x.herd.zip : "Bundle") + '</b><span class="badge ' + (x.status === "won" ? "ok" : x.status === "lost" ? "bad" : "warn") + '">' + esc(x.status) + "</span></div><div class=\"row\"><span class=\"mono\">" + money2(x.per_home_price) + "/home" + (x.flex_discount_pct ? " · " + x.flex_discount_pct + "% flex" : "") + '</span><span class="src">' + fmtDateTime(x.created_at) + '</span></div><div class="actions">' + (x.herd ? '<a class="btn small" href="/bundle/?id=' + x.herd_id + '">Open</a>' : "") + (x.status === "active" ? '<button class="btn small" data-wd="' + x.id + '" type="button">Withdraw</button>' : "") + "</div></div>"; }).join("") || '<p class="muted">No bids yet.</p>') + "</div></div>" +
          '<div class="panel" data-p="routes" hidden><div class="list" id="routes">' + (b.routes.map(function (h) { return '<div class="item" data-route-id="' + h.id + '"><div class="row"><b>' + esc(h.label) + " · " + h.zip + "</b>" + chip(h.status) + '</div><p class="muted">' + h.member_count + " homes · " + money2(h.best_price) + "/home · gross " + money(h.best_price * h.member_count) + " · fee " + fee + "% · net " + money(h.best_price * h.member_count * (1 - fee / 100)) + '</p><div class="stops"></div><div class="actions">' + (h.status === "scheduled" ? '<button class="btn small primary" data-start="' + h.id + '" type="button">Start route</button>' : "") + (h.status === "in_progress" ? '<button class="btn small primary" data-done="' + h.id + '" type="button">Mark complete</button>' : "") + '<a class="btn small" href="/bundle/?id=' + h.id + '">Open bundle</a></div></div>'; }).join("") || '<p class="muted">Routes you win show up here with every stop.</p>') + "</div></div>" +
          '<div class="panel" data-p="profile" hidden><div class="item"><dl class="kv"><dt>Business</dt><dd>' + esc(p.business_name) + "</dd><dt>Status</dt><dd>" + (p.verified ? '<span class="badge ok">Verified</span>' : '<span class="badge warn">Pending</span>') + "</dd><dt>Services</dt><dd>" + (p.trades || []).map(catLabel).join(", ") + "</dd><dt>Service ZIPs</dt><dd>" + esc((p.service_zips || []).join(", ")) + "</dd><dt>License</dt><dd>" + esc(p.license_no || "—") + '</dd></dl><p class="mt"><a class="btn small" href="/pros/join/">Edit profile</a></p></div></div>';
        function tab(t) { $$(".tabs button", root).forEach(function (x) { x.setAttribute("aria-selected", x.getAttribute("data-t") === t); }); $$(".panel", root).forEach(function (x) { x.hidden = x.getAttribute("data-p") !== t; }); }
        $(".tabs", root).onclick = function (e) { var t = e.target.getAttribute("data-t"); if (t) { history.replaceState(null, "", "#" + t); tab(t); } };
        tab((location.hash || "#open").slice(1) || "open");
        $$("[data-bid]", root).forEach(function (x) { x.onclick = function () { bidModal(x.getAttribute("data-bid")); }; });
        $$("[data-wd]", root).forEach(function (x) { x.onclick = function () { API.withdrawBid(x.getAttribute("data-wd")).then(function () { toast("Bid withdrawn."); draw(); }).catch(fail); }; });
        $$("[data-start]", root).forEach(function (x) { x.onclick = function () { API.startRoute(x.getAttribute("data-start")).then(function () { toast("Route started. Homes were texted."); draw(); }).catch(fail); }; });
        $$("[data-done]", root).forEach(function (x) { x.onclick = function () { API.completeRoute(x.getAttribute("data-done")).then(function () { toast("Route complete. Payments released."); draw(); }).catch(fail); }; });
        $$("[data-route-id]", root).forEach(function (el) { var hid = el.getAttribute("data-route-id"); API.routeStops(hid).then(function (stops) { if (!stops || !stops.length) return; $(".stops", el).innerHTML = stops.map(function (s, i) { return '<div class="stop"><span class="n">' + (i + 1) + "</span><span><b>" + esc(s.first_name) + "</b> · " + esc(s.street) + " " + esc(s.zip) + (s.notes ? '<br><span class="src">' + esc(s.notes) + "</span>" : "") + '</span><span class="src">' + (s.flex_weeks ? "flex " + s.flex_weeks + "w" : "") + "</span></div>"; }).join(""); }).catch(function () {}); });
        var cn = $("#connect"); if (cn) cn.onclick = function () { API.proConnect().catch(fail); };
        var pre = qs("bid"); if (pre && b.open.some(function (h) { return h.id === pre; })) { history.replaceState(null, "", location.pathname); bidModal(pre); }
      }).catch(fail);
    }
    function bidModal(hid) {
      API.getHerd(hid).then(function (d) {
        var h = d.herd, best = d.bids.filter(function (b) { return b.status === "active"; })[0];
        modal('<h3>Bid on ' + esc(h.label) + '</h3><p class="muted">' + h.member_count + " homes · " + esc(h.street_area) + " " + h.zip + " · best now " + (best ? money2(best.effective) : "none") + '</p><form id="bf" class="list"><label>Price per home<input name="price" type="number" min="1" step="1" required placeholder="' + Math.round(h.est_solo_price * 0.75) + '"></label>' + (h.flex ? '<label>Flex-timing discount %<input name="flex" type="number" min="0" max="30" step="1" value="5"><small>For homes that let you choose the day.</small></label>' : '<input name="flex" type="hidden" value="0">') + '<label>Service date<input name="date" type="date" value="' + esc(h.window_start || "") + '"></label><label>Note to the bundle<input name="msg" maxlength="160" placeholder="Two crews, one pass per side of the street"></label><div class="calc-out"><span class="muted">Route revenue after ' + (CFG.PLATFORM_FEE_PCT || 8) + '% fee</span><span class="big" id="bf-net">—</span><span class="muted" id="bf-vs"></span></div><div class="actions"><button class="btn primary" type="submit">Place bid</button><button class="btn" data-close type="button">Cancel</button></div></form>', function (m, close) {
          var f = $("#bf", m);
          function calc() { var p = Number(f.price.value) || 0, e = effective(p, f.flex.value, h.flex), gross = e * h.member_count; $("#bf-net", m).textContent = money(gross * (1 - (CFG.PLATFORM_FEE_PCT || 8) / 100)); $("#bf-vs", m).textContent = p ? money2(e) + "/home effective · " + (best && e >= best.effective ? "not the lowest yet" : "would lead") : ""; }
          f.addEventListener("input", calc); calc();
          f.onsubmit = function (e) { e.preventDefault(); API.placeBid(h.id, f.price.value, f.flex.value, f.date.value, f.msg.value).then(function () { close(); toast("Bid placed. The bundle was notified."); draw(); }).catch(fail); };
        });
      }).catch(fail);
    }
    draw(); onChange(draw);
  };

  pages.admin = function () {
    var root = $("#admin-root");
    function draw() {
      if (!ME || ME.role !== "admin") { root.innerHTML = '<div class="empty">Admins only.' + (!LIVE ? " In demo mode, pick Admin in the yellow bar." : "") + "</div>"; return; }
      Promise.all([API.adminPros(), API.adminHerds()]).then(function (a) {
        root.innerHTML = '<h2>Pro verification</h2><div class="scroll-x mt"><table><thead><tr><th>Business</th><th>Services</th><th>License</th><th>Status</th><th></th></tr></thead><tbody>' + a[0].map(function (p) { return "<tr><td><b>" + esc(p.business_name) + "</b></td><td>" + (p.trades || []).length + "</td><td>" + esc(p.license_no || "—") + "</td><td>" + (p.verified ? '<span class="badge ok">Verified</span>' : '<span class="badge warn">Pending</span>') + '</td><td><button class="btn small" data-v="' + p.id + '" data-ok="' + (p.verified ? 0 : 1) + '" type="button">' + (p.verified ? "Pause" : "Verify") + "</button></td></tr>"; }).join("") + "</tbody></table></div>" +
          '<h2 class="mt2">All bundles</h2><div class="scroll-x mt"><table><thead><tr><th>Bundle</th><th>ZIP</th><th>Homes</th><th>Status</th><th class="mono">Price</th><th></th></tr></thead><tbody>' + a[1].map(function (h) { return '<tr><td><a href="/bundle/?id=' + h.id + '">' + esc(h.label) + "</a>" + (h.is_example ? ' <span class="badge">example</span>' : "") + "</td><td>" + h.zip + "</td><td>" + h.member_count + "/" + h.threshold + "</td><td>" + chip(h.status) + '</td><td class="mono">' + (h.best_price ? money2(h.best_price) : "—") + "</td><td>" + (!LIVE && h.status === "bidding" ? '<button class="btn small" data-fc="' + h.id + '" type="button">Close bidding now</button>' : "") + "</td></tr>"; }).join("") + "</tbody></table></div>";
        $$("[data-v]", root).forEach(function (b) { b.onclick = function () { API.adminVerify(b.getAttribute("data-v"), b.getAttribute("data-ok") === "1").then(function () { toast("Updated."); draw(); }).catch(fail); }; });
        $$("[data-fc]", root).forEach(function (b) { b.onclick = function () { API.adminForceClose(b.getAttribute("data-fc")).then(function () { toast("Bidding closed. Winner picked."); draw(); }).catch(fail); }; });
      }).catch(fail);
    }
    draw(); onChange(function () { refreshSession().then(draw); });
  };

  pages.forecast = function () {
    var f = $("#fc-form"), r = $("#fc-report"), out = $("#fc-out"), items = CATS.filter(function (c) { return ["water-heater", "roof-inspection", "hvac-tuneup", "tree-trimming", "pressure-washing", "chimney-sweep"].indexOf(c.slug) >= 0; });
    $("#fc-item").innerHTML = items.map(function (c) { return '<option value="' + c.slug + '">' + esc(c.label.replace(" replacement", "").replace(" inspection", "")) + "</option>"; }).join("");
    $("#fc-zip").value = qs("zip") || "";
    function show(z) {
      API.forecastByZip(z).then(function (rows) {
        out.innerHTML = rows.length ? '<div class="scroll-x"><table><thead><tr><th>Item</th><th class="mono">Reports</th><th class="mono">Median age</th><th class="mono">Due soon</th><th></th></tr></thead><tbody>' + rows.map(function (x) { return "<tr><td>" + esc(catLabel(x.item)) + '</td><td class="mono">' + x.reports + '</td><td class="mono">' + x.median_age_years + ' yrs</td><td class="mono">' + x.due_next_2y + '</td><td><a class="btn small" href="/start/?zip=' + z + "&category=" + x.item + '">Start bundle</a></td></tr>'; }).join("") + "</tbody></table></div>" : '<p class="muted">No reports for ' + esc(z) + " yet. Add yours above and share the page with neighbors.</p>";
      }).catch(fail);
    }
    f.onsubmit = function (e) { e.preventDefault(); var z = $("#fc-zip").value.trim(); if (!zipOk(z)) return toast("Enter a 5-digit ZIP.", true); show(z); };
    r.onsubmit = function (e) { e.preventDefault(); var z = $("#fc-zip").value.trim(); if (!zipOk(z)) return toast("Enter your ZIP in the first box.", true); API.reportForecast(z, $("#fc-item").value, $("#fc-year").value).then(function () { toast("Added anonymously. Thank you."); show(z); }).catch(fail); };
    if (zipOk($("#fc-zip").value)) show($("#fc-zip").value);
  };

  pages.savings = function () {
    var f = $("#calc"), sel = $("#c-cat");
    sel.innerHTML = catOptions("gutter-cleaning");
    function run() {
      var c = CATS.filter(function (x) { return x.slug === sel.value; })[0] || { est_solo_price: 0 }, homes = Number($("#c-homes").value), flex = $("#c-flex").checked;
      var disc = Math.min(0.34, 0.12 + homes * 0.012) + (flex ? 0.05 : 0), each = c.est_solo_price * (1 - disc);
      $("#c-homes-v").textContent = homes;
      $("#c-out").innerHTML = '<span class="muted">Estimated bundle price per home</span><span class="big">' + money(each) + '</span><span class="muted">vs. about ' + money(c.est_solo_price) + " solo · you keep about " + money(c.est_solo_price - each) + " (" + Math.round(disc * 100) + '%)</span><span class="muted">Street saves ' + money((c.est_solo_price - each) * homes) + " together</span>";
    }
    f.addEventListener("input", run); run();
    var p = $("#pcalc");
    function prun() {
      var jobs = Number($("#p-jobs").value), drive = Number($("#p-drive").value), rate = Number($("#p-rate").value);
      $("#p-jobs-v").textContent = jobs; $("#p-drive-v").textContent = drive;
      var scattered = jobs * drive, herd = Math.max(5, drive * 0.25) + (jobs - 1) * 3, saved = (scattered - herd) / 60;
      $("#p-out").innerHTML = '<span class="muted">Drive time saved per route</span><span class="big">' + saved.toFixed(1) + ' hrs</span><span class="muted">' + Math.round(scattered) + " min scattered vs. " + Math.round(herd) + " min on one street · worth about " + money(saved * rate) + " in crew time</span>";
    }
    p.addEventListener("input", prun); prun();
  };

  pages.agents = function () {
    API.listHerds({ status: "open" }).then(function (hs) {
      var feed = { herdwell_protocol: "1.0", generated_at: new Date().toISOString(), herds: hs.slice(0, 3).map(function (h) { return { id: h.id, code: h.code, service: h.category, label: h.label, zip: h.zip, area: h.street_area, status: h.status, homes: h.member_count, threshold: h.threshold, best_price_per_home: h.best_price, typical_solo_price: h.est_solo_price, bidding_closes_at: h.bid_closes_at, flexible_timing: h.flex, url: (CFG.SITE || location.origin) + "/bundle/?id=" + h.id, example: !!h.is_example }; }) };
      $("#live-feed").textContent = JSON.stringify(feed, null, 2);
    }).catch(fail);
    var base = LIVE ? CFG.SUPABASE_URL + "/functions/v1/agent-api" : (CFG.SITE || "") + "/api/";
    $$(".api-base").forEach(function (e) { e.textContent = base; });
  };

  pages.contact = function () {
    var f = $("#ct"); if (!f) return;
    f.onsubmit = function (e) {
      e.preventDefault(); var b = f.querySelector("button"); b.disabled = true;
      fetch("https://formsubmit.co/ajax/info@eyetoad.com", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ _subject: "StreetBundle contact: " + f.topic.value, name: f.name.value, email: f.email.value, topic: f.topic.value, message: f.message.value, _template: "table" }) })
        .then(function (r) { if (!r.ok) throw new Error("Couldn't send. Call us instead."); f.innerHTML = '<h3>Thanks. We got it.</h3><p class="muted">We reply within one business day.</p>'; })
        .catch(function (er) { b.disabled = false; fail(er); });
    };
  };

  pages.bundle = pages.herd; pages.bundles = pages.herds;

  /* ================= boot ================= */
  wireChrome(); demoBar();
  API.init().then(function () { return API.categories(); }).then(function (c) { CATS = c || []; return refreshSession(); }).then(function () {
    heroForm();
    if (pages[PAGE]) pages[PAGE]();
    if (API.subscribe) API.subscribe(function () { bus(); });
    onChange(paintHeader);
    if (!LIVE) setInterval(function () { Demo.init(); }, 30000);
  }).catch(function (e) { console.error(e); toast("Couldn't connect. Showing what we can.", true); });
})();
