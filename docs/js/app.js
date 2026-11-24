/* Snap Count */
(() => {
  "use strict";

  const LAUNCH = "2026-11-20";
  const COLS = ["team", "div", "pos", "ht", "age", "no", "wt", "yoe", "dy"];
  const COL_LABELS = { team: "Team", div: "Div", pos: "Pos", ht: "Ht", age: "Age", no: "No", wt: "Wt", yoe: "Yrs", dy: "Draft" };
  const CLOSE = { ht: 2, age: 2, no: 5, wt: 10, yoe: 2, dy: 2 };
  const NUMERIC = new Set(["ht", "age", "no", "wt", "yoe", "dy"]);
  const MAX = { daily: 8, unlimited: 8, hard: 10, speed: 8, passplay: 8 };
  const CCOLS = ["team", "conf", "pos", "cls", "no", "ht", "wt", "home"];
  const CCOL_LABELS = { team: "Team", conf: "Conf", pos: "Pos", cls: "Class", no: "No", ht: "Ht", wt: "Wt", home: "Home" };
  const CLASS_LABELS = { 1: "FR", 2: "SO", 3: "JR", 4: "SR", 5: "GS" };
  const CCLOSE = { cls: 1, no: 5, ht: 2, wt: 10 };
  const CPOS_UNIT = { QB: "offense", RB: "offense", WR: "offense", TE: "offense", C: "offense", DL: "defense" };
  const ACHIEVEMENTS = [
    { id: "first-down", name: "First Down", desc: "Win your first game" },
    { id: "hail-mary", name: "Hail Mary", desc: "Solve it in one guess" },
    { id: "clutch", name: "Clutch", desc: "Win on your last guess" },
    { id: "on-a-roll", name: "On a Roll", desc: "Reach a 5-game streak" },
    { id: "iron-man", name: "Iron Man", desc: "Reach a 7-game streak" },
    { id: "legend-hunter", name: "Legend Hunter", desc: "Solve a Legends pack" },
    { id: "rookie-wall", name: "Rookie Wall", desc: "Solve a Rookies pack" },
    { id: "speed-demon", name: "Speed Demon", desc: "Solve 3 in one Speed Round" },
    { id: "two-minute", name: "Two-Minute Drill", desc: "Finish a Pass & Play match" }
  ];

  let DATA = null;
  let PUZZLES = null;
  let CDATA = null;
  let CPUZZLES = {};
  let playersById = new Map();
  const state = {
    view: "home",
    tier: loadJSON("gg:tier", "starters"),
    hardMode: loadJSON("gg:hard", false),
    settings: loadJSON("gg:settings", { sound: true, haptics: true, colorblind: false }),
    game: null,
    overlay: null,
    search: "",
    suggest: [],
    suggestIndex: 0,
    toast: null,
    packPick: null,
    speed: null,
    pass: null,
    archiveMonth: null,
    lbTab: "daily",
    lbRows: null,
    lbMeta: null,
    lbLoading: false,
    lbError: null,
    lbGroup: null,
    postError: null,
    postBusy: false,
    groupError: null,
    sessionAnswers: []
  };

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  }
  function saveJSON(key, val) {
    localStorage.setItem(key, JSON.stringify(val));
  }

  function etDate(d) {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/New_York",
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(d || new Date());
  }
  function prettyDate(iso) {
    const parts = iso.split("-").map(Number);
    const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12));
    return new Intl.DateTimeFormat("en-US", { weekday: "long", month: "short", day: "numeric" }).format(dt);
  }
  function shortDate(iso) {
    const parts = iso.split("-").map(Number);
    const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], 12));
    return new Intl.DateTimeFormat("en-US", { weekday: "short", month: "short", day: "numeric" }).format(dt);
  }
  function puzzleNum(iso) {
    const a = new Date(LAUNCH + "T00:00:00Z");
    const b = new Date(iso + "T00:00:00Z");
    return Math.floor((b - a) / 86400000) + 1;
  }
  function ageOn(bd, onDate) {
    if (!bd) return null;
    const b = bd.split("-").map(Number);
    const o = onDate.split("-").map(Number);
    let age = o[0] - b[0];
    if (o[1] < b[1] || (o[1] === b[1] && o[2] < b[2])) age--;
    return age;
  }
  function fmtHt(inches) {
    return Math.floor(inches / 12) + "'" + (inches % 12) + '"';
  }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }
  function contrast(hex) {
    const h = hex.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16), g = parseInt(h.slice(2, 4), 16), b = parseInt(h.slice(4, 6), 16);
    return (r * 299 + g * 587 + b * 114) / 1000 > 150 ? "#111" : "#fff";
  }
  function teamInfo(abbr) { return DATA.teams[abbr] || (CDATA && CDATA.teams[abbr]); }
  function isCollege(p) { return !!(p && typeof p.id === "string" && p.id.indexOf("cfb-") === 0); }
  function colsFor(g) {
    if (g.pack === "college") return CCOLS;
    return g.hard ? COLS.filter(function (c) { return c !== "team"; }) : COLS;
  }
  function colLabel(g, c) { return g.pack === "college" ? CCOL_LABELS[c] : COL_LABELS[c]; }
  function cattrs(p) {
    const t = teamInfo(p.team);
    return { team: p.team, conf: t ? t.conf : "", pos: p.pos, cls: p.cls == null ? null : p.cls, no: p.no, ht: p.ht, wt: p.wt, hs: p.hs || "", hc: p.hc || "" };
  }
  function cgradeCol(col, g, a) {
    if (col === "team") return { col: col, grade: g.team === a.team ? "exact" : "miss", text: teamLabel(g.team), team: g.team };
    if (col === "conf") return { col: col, grade: g.conf === a.conf ? "exact" : "miss", text: g.conf };
    if (col === "pos") {
      const grade = g.pos === a.pos ? "exact" : (CPOS_UNIT[g.pos] && CPOS_UNIT[g.pos] === CPOS_UNIT[a.pos] ? "close" : "miss");
      return { col: col, grade: grade, text: g.pos };
    }
    if (col === "home") {
      const sameState = !!g.hs && g.hs === a.hs;
      const exact = sameState && !!g.hc && g.hc.toLowerCase() === a.hc.toLowerCase();
      return { col: col, grade: exact ? "exact" : sameState ? "close" : "miss", text: g.hs || "—", sub: g.hc };
    }
    if (col === "cls") {
      if (g.cls == null || a.cls == null) return { col: col, grade: "miss", text: g.cls == null ? "—" : CLASS_LABELS[g.cls], arrow: "" };
      const d = Math.abs(g.cls - a.cls);
      return { col: col, grade: d === 0 ? "exact" : d <= CCLOSE.cls ? "close" : "miss", text: CLASS_LABELS[g.cls], arrow: d === 0 ? "" : (g.cls < a.cls ? "up" : "down") };
    }
    const gv = g[col], av = a[col];
    const abs = Math.abs(gv - av);
    return { col: col, grade: abs === 0 ? "exact" : abs <= CCLOSE[col] ? "close" : "miss", text: col === "ht" ? fmtHt(gv) : String(gv), arrow: abs === 0 ? "" : (gv < av ? "up" : "down") };
  }
  function ccompatible(player, guess, grades) {
    const p = cattrs(player), g = cattrs(guess);
    for (let i = 0; i < grades.length; i++) {
      const t = grades[i];
      const fresh = cgradeCol(t.col, g, p);
      if (fresh.grade !== t.grade || (fresh.arrow || "") !== (t.arrow || "")) return false;
    }
    return true;
  }
  function teamLabel(abbr) { const t = teamInfo(abbr); return t ? t.display : abbr; }
  function city(abbr) { const t = teamInfo(abbr); return t ? t.city : abbr; }
  function attrs(p, onDate) {
    const t = teamInfo(p.team);
    return {
      team: p.team,
      divKey: t ? t.conf + "-" + t.div : "",
      conf: t ? t.conf : "",
      div: t ? t.div : "",
      pos: p.pos,
      ht: p.ht,
      age: ageOn(p.bd, onDate),
      no: p.no,
      wt: p.wt,
      yoe: p.yoe,
      dy: p.udfa ? "UDFA" : p.dy,
      udfa: p.udfa
    };
  }
  function displayVal(col, val) {
    if (col === "team") return teamLabel(val);
    if (col === "ht") return fmtHt(val);
    if (col === "dy") return (val == null || val === "UDFA") ? "UDFA" : String(val);
    return val == null ? "—" : String(val);
  }

  function gradeGuess(guess, answer, onDate, hard) {
    if (isCollege(answer)) {
      const cg = cattrs(guess), ca = cattrs(answer);
      return CCOLS.map(function (col) { return cgradeCol(col, cg, ca); });
    }
    const g = attrs(guess, onDate);
    const a = attrs(answer, onDate);
    const cols = hard ? COLS.filter(function (c) { return c !== "team"; }) : COLS;
    return cols.map(function (col) { return gradeCol(col, g, a); });
  }
  var POS_CANON = {
    QB: "QB", RB: "RB", FB: "RB", WR: "WR", TE: "TE",
    OL: "OL", OT: "OL", OG: "OL", G: "OL", C: "OL", T: "OL",
    DL: "DL", DE: "DL", DT: "DL", NT: "DL",
    LB: "LB", ILB: "LB", OLB: "LB", MLB: "LB",
    DB: "DB", CB: "DB", S: "DB", FS: "DB", SS: "DB", SAF: "DB",
    K: "K", P: "P", LS: "LS", "K/P": "K"
  };
  var POS_UNIT = {
    QB: "offense", RB: "offense", WR: "offense", TE: "offense", OL: "offense",
    DL: "defense", LB: "defense", DB: "defense",
    K: "special", P: "special", LS: "special"
  };
  function canonPos(pos) {
    var p = String(pos || "").toUpperCase().replace(/[^A-Z\/]/g, "");
    return POS_CANON[p] || p;
  }
  function unitOf(pos) {
    return POS_UNIT[canonPos(pos)] || "other";
  }

  function gradeCol(col, g, a) {
    if (col === "team") {
      return { col: col, grade: g.team === a.team ? "exact" : "miss", text: displayVal("team", g.team), team: g.team };
    }
    if (col === "div") {
      const exact = g.divKey === a.divKey;
      const close = !exact && g.conf === a.conf;
      return { col: col, grade: exact ? "exact" : close ? "close" : "miss", text: g.conf, sub: g.div };
    }
    if (col === "pos") {
      var gp = canonPos(g.pos), ap = canonPos(a.pos);
      var grade = gp === ap ? "exact" : (unitOf(gp) !== "other" && unitOf(gp) === unitOf(ap) ? "close" : "miss");
      return { col: col, grade: grade, text: g.pos };
    }
    if (col === "dy") {
      if (g.udfa || a.udfa) {
        return { col: col, grade: (g.udfa && a.udfa) ? "exact" : "miss", text: g.udfa ? "UDFA" : String(g.dy) };
      }
      return numericGrade(col, g.dy, a.dy);
    }
    return numericGrade(col, g[col], a[col]);
  }
  function numericGrade(col, gv, av) {
    const diff = gv - av;
    const abs = Math.abs(diff);
    const grade = abs === 0 ? "exact" : abs <= CLOSE[col] ? "close" : "miss";
    const arrow = abs === 0 ? "" : (gv < av ? "up" : "down");
    return { col: col, grade: grade, text: displayVal(col, gv), arrow: arrow };
  }

  function compatible(player, guess, grades, onDate) {
    if (isCollege(player)) return ccompatible(player, guess, grades);
    const p = attrs(player, onDate);
    const g = attrs(guess, onDate);
    for (let i = 0; i < grades.length; i++) {
      const tile = grades[i];
      const col = tile.col;
      if (col === "team") {
        if (tile.grade === "exact" && p.team !== g.team) return false;
        if (tile.grade === "miss" && p.team === g.team) return false;
      } else if (col === "div") {
        if (tile.grade === "exact" && p.divKey !== g.divKey) return false;
        if (tile.grade === "close" && (p.conf !== g.conf || p.divKey === g.divKey)) return false;
        if (tile.grade === "miss" && p.conf === g.conf) return false;
      } else if (col === "pos") {
        var pp = canonPos(p.pos), gp = canonPos(g.pos);
        var pu = unitOf(pp), gu = unitOf(gp);
        if (tile.grade === "exact" && pp !== gp) return false;
        if (tile.grade === "close" && (pp === gp || pu !== gu || pu === "other")) return false;
        if (tile.grade === "miss" && pu === gu && pu !== "other") return false;
      } else if (col === "dy") {
        if (g.udfa || tile.text === "UDFA") {
          if (tile.grade === "exact" && !p.udfa) return false;
          if (tile.grade === "miss" && p.udfa) return false;
        } else if (!numOk(p.dy, g.dy, tile, CLOSE.dy)) return false;
      } else if (NUMERIC.has(col)) {
        if (!numOk(p[col], g[col], tile, CLOSE[col])) return false;
      }
    }
    return true;
  }
  function numOk(pv, gv, tile, thr) {
    if (pv == null || gv == null) return false;
    const abs = Math.abs(pv - gv);
    if (tile.grade === "exact") return pv === gv;
    if (tile.grade === "close") {
      if (!(abs > 0 && abs <= thr)) return false;
    } else if (!(abs > thr)) return false;
    if (tile.arrow === "up") return pv > gv;
    if (tile.arrow === "down") return pv < gv;
    return true;
  }

  function poolFor(pack, tier) {
    if (pack === "college") return CDATA ? CDATA.players.filter(function (p) { return p.pool; }) : [];
    return DATA.players.filter(function (p) { return inPool(p, pack, tier); });
  }
  function collegeAnswerPool() {
    return poolFor("college").filter(function (p) { return p.cls != null; });
  }
  function inPool(p, pack, tier) {
    if (pack === "legends") return p.pack === "legends";
    if (p.pack === "legends" || p.active === false) return false;
    if (pack === "rookies") return p.rookie;
    if (tier === "stars") return p.star;
    if (tier === "starters") return p.starter;
    return true;
  }
  function searchUniverse(pack) {
    if (pack === "college") return CDATA ? CDATA.players : [];
    if (pack === "legends") return DATA.players.filter(function (p) { return p.pack === "legends"; });
    return DATA.players.filter(function (p) { return p.pack !== "legends" && p.active !== false; });
  }

  function norm(s) {
    return String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");
  }
  function levenshtein(a, b) {
    if (Math.abs(a.length - b.length) > 2) return 99;
    const m = [];
    for (let i = 0; i <= a.length; i++) {
      m[i] = [i];
      for (let j = 1; j <= b.length; j++) {
        if (i === 0) m[0][j] = j;
        else {
          const cost = a[i - 1] === b[j - 1] ? 0 : 1;
          m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + cost);
        }
      }
    }
    return m[a.length][b.length];
  }
  function searchPlayers(query, pack, excludeIds) {
    const q = query.trim();
    if (q.length < 1) return [];
    const nq = norm(q);
    const list = searchUniverse(pack);
    const out = [];
    for (let i = 0; i < list.length; i++) {
      const p = list[i];
      if (excludeIds.has(p.id)) continue;
      const names = [p.name, p.first, p.last, p.first + " " + p.last].concat(p.nick || []);
      const given = p.name.split(" ")[0];
      if (given && names.indexOf(given) === -1) names.push(given);
      let score = 0;
      for (let j = 0; j < names.length; j++) {
        const nn = norm(names[j]);
        if (nn === nq) score = Math.max(score, 100);
        else if (nn.startsWith(nq)) score = Math.max(score, 80 - Math.max(0, nn.length - nq.length));
        else if (nn.includes(nq)) score = Math.max(score, 50);
        else if (nq.length >= 4 && levenshtein(nn, nq) === 1) score = Math.max(score, 40);
        else if (nq.length >= 5 && levenshtein(nn, nq) === 2) score = Math.max(score, 25);
      }
      if (score > 0) out.push({ p: p, score: score });
    }
    out.sort(function (a, b) {
      return b.score - a.score || a.p.last.localeCompare(b.p.last) || a.p.name.localeCompare(b.p.name);
    });
    return out.slice(0, 12).map(function (x) { return x.p; });
  }
  let audioCtx = null;
  function getAudio() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }
  function beep(freq, dur, type, gain) {
    if (!state.settings.sound) return;
    try {
      const c = getAudio();
      const o = c.createOscillator();
      const g = c.createGain();
      o.type = type || "square";
      o.frequency.value = freq;
      g.gain.value = gain == null ? 0.05 : gain;
      g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + dur);
      o.connect(g).connect(c.destination);
      o.start();
      o.stop(c.currentTime + dur);
    } catch (e) {}
  }
  function vibrate(ms) {
    if (state.settings.haptics && navigator.vibrate) navigator.vibrate(ms);
  }
  function sfxFlip() { beep(420, 0.05, "triangle", 0.03); vibrate(8); }
  function sfxWin() {
    beep(523, 0.12, "triangle", 0.06);
    setTimeout(function () { beep(659, 0.12, "triangle", 0.06); }, 90);
    setTimeout(function () { beep(784, 0.2, "triangle", 0.06); }, 180);
    vibrate([12, 40, 18]);
  }
  function sfxLose() { beep(180, 0.25, "sawtooth", 0.04); vibrate(30); }

  function toast(msg) {
    state.toast = msg;
    render();
    setTimeout(function () {
      if (state.toast === msg) { state.toast = null; render(); }
    }, 1800);
  }

  function statsKey(tier) { return "gg:stats:" + tier; }
  function getStats(tier) {
    return loadJSON(statsKey(tier), { played: 0, wins: 0, streak: 0, maxStreak: 0, lastDate: null, dist: [0,0,0,0,0,0,0,0,0,0] });
  }
  function addDays(iso, n) {
    const p = iso.split("-").map(Number);
    const dt = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
    return dt.toISOString().slice(0, 10);
  }
  function recordDaily(tier, date, won, guesses) {
    const s = getStats(tier);
    if (s.lastDate === date) return s;
    s.played += 1;
    if (won) {
      s.wins += 1;
      const yesterday = addDays(date, -1);
      s.streak = s.lastDate === yesterday ? s.streak + 1 : 1;
      s.maxStreak = Math.max(s.maxStreak, s.streak);
      const i = Math.min(guesses, 10) - 1;
      if (i >= 0) s.dist[i] = (s.dist[i] || 0) + 1;
    } else {
      s.streak = 0;
    }
    s.lastDate = date;
    saveJSON(statsKey(tier), s);
    return s;
  }
  function unlock(id) {
    const have = loadJSON("gg:achs", []);
    if (have.indexOf(id) === -1) {
      have.push(id);
      saveJSON("gg:achs", have);
      const a = ACHIEVEMENTS.filter(function (x) { return x.id === id; })[0];
      if (a) toast("Achievement: " + a.name);
    }
  }
  function dailyKey(date, tier, hard, pack) {
    return "gg:daily:" + date + ":" + tier + ":" + (hard ? "hard" : "classic") + ":" + (pack || "live");
  }

  var NO_REPEAT_DAYS = 60;

  function fnv1a(str) {
    var h = 2166136261;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  }

  function puzzleKey(pack, tier, hard) {
    if (pack === "college") return "college";
    if (pack === "legends") return "legends";
    if (pack === "rookies") return "rookies";
    if (hard) return "hard";
    return tier;
  }

  function pickUniformSeeded(ids, date, key) {
    var ordered = ids.slice().sort();
    var excluded = [];
    var book = key === "college" ? CPUZZLES : PUZZLES;
    for (var back = 1; back <= NO_REPEAT_DAYS; back++) {
      var prev = addDays(date, -back);
      if (book[prev] && book[prev][key]) excluded.push(book[prev][key]);
    }
    var excl = {};
    excluded.forEach(function (id) { excl[id] = true; });
    var candidates = ordered.filter(function (id) { return !excl[id]; });
    if (!candidates.length && ordered.length > 1) {
      excl = {};
      excluded.slice(0, ordered.length - 1).forEach(function (id) { excl[id] = true; });
      candidates = ordered.filter(function (id) { return !excl[id]; });
    }
    if (!candidates.length) candidates = ordered;
    var seed = "gridiron-guess|" + date + "|" + key;
    return candidates[fnv1a(seed) % candidates.length];
  }

  function cryptoIndex(n) {
    if (n <= 1) return 0;
    var buf = new Uint32Array(1);
    var max = Math.floor(4294967296 / n) * n;
    var x;
    do {
      crypto.getRandomValues(buf);
      x = buf[0];
    } while (x >= max);
    return x % n;
  }

  function recentSlot(pack, tier, hard) {
    return pack + ":" + (pack === "live" ? tier : pack) + ":" + (hard ? "hard" : "classic");
  }

  function recentIds(pack, tier, hard) {
    var cutoff = addDays(etDate(), -NO_REPEAT_DAYS);
    var slot = recentSlot(pack, tier, hard);
    var set = new Set(state.sessionAnswers || []);
    (loadJSON("gg:recent-answers", [])).forEach(function (r) {
      if (r.date >= cutoff && r.slot === slot) set.add(r.id);
    });
    return set;
  }

  function rememberAnswer(id, pack, tier, hard) {
    var cutoff = addDays(etDate(), -NO_REPEAT_DAYS);
    var rec = (loadJSON("gg:recent-answers", [])).filter(function (r) { return r.date >= cutoff; });
    rec.push({ id: id, date: etDate(), slot: recentSlot(pack, tier, hard) });
    saveJSON("gg:recent-answers", rec);
  }

  function answerPool(pack, tier, hard, isDailyHard) {
    // Daily Hard answers come from the Starters pool (and Stars, so archived
    // hard puzzles from the earlier Stars pool still appear in "remaining").
    if (isDailyHard && pack === "live") {
      var seen = {};
      return poolFor(pack, "starters").concat(poolFor(pack, "stars")).filter(function (p) {
        if (seen[p.id]) return false;
        seen[p.id] = true;
        return true;
      });
    }
    return poolFor(pack, tier);
  }

  function pickAnswer(mode, pack, tier, date, hard) {
    var isDaily = (mode === "daily");
    var key = puzzleKey(pack, tier, hard);
    if (isDaily && key === "college") {
      var crow = CPUZZLES[date];
      var cp = crow && crow.college && playersById.get(crow.college);
      if (cp) return cp;
      var cpicked = pickUniformSeeded(collegeAnswerPool().map(function (x) { return x.id; }), date, "college");
      return playersById.get(cpicked) || null;
    }
    if (isDaily) {
      var row = PUZZLES[date];
      var id = row && row[key];
      var p = id && playersById.get(id);
      if (p) return p;
      var fallbackPool = answerPool(pack, key === "hard" ? "starters" : tier, hard, key === "hard");
      if (key === "hard") fallbackPool = poolFor(pack, "starters");
      if (key === "rookies") fallbackPool = poolFor("rookies", tier);
      if (key === "legends") fallbackPool = poolFor("legends", tier);
      var picked = pickUniformSeeded(fallbackPool.map(function (x) { return x.id; }), date, key);
      return playersById.get(picked) || null;
    }
    var pool = pack === "college" ? collegeAnswerPool() : poolFor(pack, tier);
    if (!pool.length) return null;
    var avoid = recentIds(pack, tier, hard);
    var candidates = pool.filter(function (x) { return !avoid.has(x.id); });
    if (!candidates.length) candidates = pool;
    return candidates[cryptoIndex(candidates.length)];
  }

  function newGame(opts) {
    const date = opts.date || etDate();
    const mode = opts.mode;
    const pack = opts.pack || "live";
    const tier = opts.tier || state.tier;
    const hard = pack === "college" ? false : !!(opts.hard || mode === "hard");
    const max = MAX[mode] || 8;
    const answer = opts.answer || pickAnswer(mode, pack, tier, date, hard);
    if (answer) {
      state.sessionAnswers = (state.sessionAnswers || []).concat([answer.id]);
      if (mode !== "daily") rememberAnswer(answer.id, pack, tier, hard);
    }
    return {
      mode: mode, pack: pack, tier: tier, hard: hard, date: date,
      answerId: answer.id,
      max: max,
      guesses: [],
      grades: [],
      remaining: answerPool(pack, tier, hard, !!(hard && mode === "daily")).map(function (p) { return p.id; }),
      hints: { college: false, draft: false, colors: false, unit: false },
      hintCosts: 0,
      status: "playing",
      startedAt: Date.now(),
      archive: !!opts.archive,
      passSeat: opts.passSeat || null
    };
  }

  function applyGuess(player) {
    const g = state.game;
    if (!g || g.status !== "playing") return;
    if (g.guesses.indexOf(player.id) !== -1) { toast("Already guessed"); return; }
    if (g.guesses.length === 0 && window.SnapLB && SnapLB.officialDaily(g)) {
      SnapLB.startSession(g);
    }
    const answer = playersById.get(g.answerId);
    const tiles = gradeGuess(player, answer, g.date, g.hard);
    g.guesses.push(player.id);
    g.grades.push(tiles);
    g.remaining = g.remaining.filter(function (id) {
      const p = playersById.get(id);
      return p && compatible(p, player, tiles, g.date);
    });
    sfxFlip();
    if (player.id === answer.id) {
      g.status = "won";
      sfxWin();
      finishGame(true);
    } else if (g.guesses.length >= g.max) {
      g.status = "lost";
      sfxLose();
      finishGame(false);
    }
    persistGame();
    state.search = "";
    state.suggest = [];
    state.overlay = (g.status === "won" || g.status === "lost") ? "result" : state.overlay;
    render();
  }

  function useHint(kind) {
    const g = state.game;
    if (!g || g.status !== "playing" || g.hints[kind]) return;
    const freeKind = g.pack === "college" ? "unit" : "college";
    const freeCollege = kind === freeKind && g.mode === "daily" && !g.archive && !g.hints[freeKind];
    if (!freeCollege) {
      if (g.guesses.length >= g.max - 1) {
        toast("Not enough guesses left for that hint");
        return;
      }
      g.hintCosts += 1;
      g.max = Math.max(g.guesses.length, g.max - 1);
    }
    g.hints[kind] = true;
    persistGame();
    vibrate(10);
    render();
  }

  function finishGame(won) {
    const g = state.game;
    if (window.SnapLB && SnapLB.officialDaily(g)) {
      SnapLB.recordFirstResult(g);
    }
    if (g.mode === "daily" && !g.archive) {
      const s = recordDaily(g.tier, g.date, won, g.guesses.length);
      if (won) {
        unlock("first-down");
        if (g.guesses.length === 1) unlock("hail-mary");
        if (g.guesses.length === g.max) unlock("clutch");
        if (s.streak >= 5) unlock("on-a-roll");
        if (s.streak >= 7) unlock("iron-man");
      }
    }
    if (won && g.pack === "legends") unlock("legend-hunter");
    if (won && g.pack === "rookies") unlock("rookie-wall");
    if (g.mode === "speed") {
      state.speed = state.speed || { solved: 0, attempts: 0, skipped: 0 };
      state.speed.attempts += 1;
      if (won) state.speed.solved += 1;
      if (state.speed.solved >= 3) unlock("speed-demon");
    }
    if (g.mode === "passplay") {
      state.pass = state.pass || { p1: null, p2: null, answerId: g.answerId, pack: g.pack, tier: g.tier, hard: g.hard };
      const rec = { won: won, guesses: g.guesses.length, max: g.max };
      if (g.passSeat === 1) state.pass.p1 = rec;
      if (g.passSeat === 2) { state.pass.p2 = rec; unlock("two-minute"); }
    }
    if (g.mode === "daily" && !g.archive && window.goatcounter && typeof window.goatcounter.count === "function") {
      window.goatcounter.count({ path: (g.pack === "college" ? "college-" : "puzzle-") + (won ? "won" : "lost"), event: true });
    }
  }

  function persistGame() {
    const g = state.game;
    if (!g) return;
    if (g.mode === "daily") saveJSON(dailyKey(g.date, g.tier, g.hard, g.pack), g);
  }
  function loadDailyIfAny() {
    return loadJSON(dailyKey(etDate(), state.tier, state.hardMode, "live"), null);
  }

  const root = document.getElementById("app");

  function icon(name) {
    const paths = {
      back: '<path d="M15 18l-6-6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
      info: '<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 10v6M12 7h.01" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
      gear: '<circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
      cal: '<rect x="3" y="5" width="18" height="16" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 10h18M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
      infinite: '<path d="M8 12c0-2.2 1.8-4 4-4h0c2 0 3 2 4 4s2 4 4 4 4-1.8 4-4-1.8-4-4-4-3 2-4 4-2 4-4 4-4-1.8-4-4z" transform="translate(-8 0)" fill="none" stroke="currentColor" stroke-width="2"/>',
      people: '<circle cx="9" cy="8" r="3" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="16" cy="9" r="2.4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3 19c1-3 3.2-5 6-5s5 2 6 5M14 14c2 0 3.8 1.2 5 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
      bolt: '<path d="M13 2L4 14h7l-1 8 9-12h-7l1-8z" fill="currentColor"/>',
      home: '<path d="M4 11l8-7 8 7v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10 22V12h4v10" fill="none" stroke="currentColor" stroke-width="2"/>',
      search: '<circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" stroke-width="2"/><path d="M16 16l4 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
      school: '<path d="M3 10l9-6 9 6-9 6-9-6z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 12v5c2 1.5 5 2 5 2s3-.5 5-2v-5" fill="none" stroke="currentColor" stroke-width="2"/>',
      draft: '<rect x="4" y="3" width="16" height="18" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 8h8M8 12h8M8 16h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
      jersey: '<path d="M8 4l2 2h4l2-2 3 2-2 4v10H7V10L5 6z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>'
    };
    return '<svg viewBox="0 0 24 24" aria-hidden="true">' + (paths[name] || "") + "</svg>";
  }

  function badge(abbr, small) {
    const t = teamInfo(abbr);
    if (!t) return escapeHtml(abbr);
    const color = contrast(t.c1);
    const pad = small ? "1px 5px" : "2px 7px";
    const size = small ? "9px" : "11px";
    const minw = small ? "22px" : "26px";
    return '<span class="badge-team" style="background:' + t.c1 + ";color:" + color + ";box-shadow:inset -7px 0 0 " + t.c2 + ";padding:" + pad + ";border-radius:5px;font-weight:800;font-size:" + size + ";letter-spacing:.02em;display:inline-block;min-width:" + minw + ';text-align:center">' + escapeHtml(t.display) + "</span>";
  }

  function silhouetteSVG(answer, guesses, painted, inline) {
    const t = teamInfo(answer.team);
    const body = painted && t ? t.c1 : "#3A3A40";
    const accent = painted && t ? t.c2 : "#6A6A70";
    const visor = painted ? "#0A0A0C" : "#2A2A30";
    const blur = Math.max(0, 7 - guesses * 1.1);
    const qOp = Math.max(0, 1 - guesses / 5);
    const sharp = Math.min(1, guesses / 6);
    const showNum = (guesses >= 5 || (state.game && state.game.status !== "playing")) ? answer.no : "";
    const q = (qOp > 0.05 && state.game && state.game.status === "playing") ? '<div class="q" style="opacity:' + qOp + '">?</div>' : "";
    const html = '<div class="sil" aria-hidden="true"><svg viewBox="0 0 80 110" style="filter:blur(' + blur + "px) saturate(" + (painted ? 1 : 0.2) + ") contrast(" + (1 + sharp * 0.3) + ')">' +
      '<ellipse cx="40" cy="104" rx="22" ry="5" fill="rgba(0,0,0,.4)"/>' +
      '<path d="M28 18c0-10 24-10 24 0v6H28z" fill="' + body + '"/>' +
      '<rect x="24" y="16" width="32" height="14" rx="7" fill="' + body + '"/>' +
      '<rect x="27" y="20" width="26" height="8" rx="4" fill="' + visor + '"/>' +
      '<rect x="30" y="23" width="20" height="3" fill="' + accent + '"/>' +
      '<path d="M30 32h20l6 14H24z" fill="' + body + '"/>' +
      '<path d="M18 44l12-8 4 10-14 8z" fill="' + body + '"/>' +
      '<path d="M62 44L50 36l-4 10 14 8z" fill="' + body + '"/>' +
      '<rect x="26" y="44" width="28" height="30" rx="6" fill="' + body + '"/>' +
      '<rect x="26" y="62" width="28" height="8" fill="' + accent + '"/>' +
      '<path d="M26 72l-2 28h12l2-28z" fill="' + body + '"/>' +
      '<path d="M54 72l2 28H44l-2-28z" fill="' + body + '"/>' +
      '<text x="40" y="62" text-anchor="middle" font-family="Oswald,sans-serif" font-size="14" font-weight="700" fill="' + contrast(body) + '">' + showNum + "</text></svg>" + q + "</div>";
    return inline ? html : '<div class="sil-wrap">' + html + "</div>";
  }
  function render() {
    if (state.settings.colorblind) document.documentElement.classList.add("cb");
    else document.documentElement.classList.remove("cb");
    let html = "";
    if (state.view === "home") html = viewHome();
    else if (state.view === "packs") html = viewPacks();
    else if (state.view === "game") html = viewGame();
    else if (state.view === "stats") html = viewStats();
    else if (state.view === "archive") html = viewArchive();
    else if (state.view === "leaderboard") html = viewLeaderboard();
    else if (state.view === "groups") html = viewGroups();
    else if (state.view === "how") html = viewHow();
    else if (state.view === "settings") html = viewSettings();
    else html = viewHome();
    if (state.overlay === "hints") html += sheetHints();
    if (state.overlay === "remain") html += sheetRemain();
    if (state.overlay === "post-score") html += modalPostScore();
    if (state.overlay === "already-played") html += modalAlreadyPlayed();
    if (state.overlay === "result") html += modalResult();
    if (state.overlay === "pass-ready") html += modalPassReady();
    if (state.overlay === "speed-end") html += modalSpeedEnd();
    if (state.toast) html += '<div class="toast">' + escapeHtml(state.toast) + "</div>";
    root.innerHTML = html;
    bind();
  }

  function viewHome() {
    const date = etDate();
    const n = (PUZZLES[date] && PUZZLES[date].n) || puzzleNum(date);
    return '<div class="screen"><div class="top"><div class="ico mark">S</div><div class="top-actions">' +
      '<button class="ico" data-go="how" aria-label="How to play">' + icon("info") + "</button>" +
      '<button class="ico" data-go="settings" aria-label="Settings">' + icon("gear") + "</button></div></div>" +
      '<div class="kicker">Daily player puzzle</div>' +
      '<h1 class="logo">Snap<br><span>Count</span></h1>' +
      '<p class="tag">Eight guesses. Nine clues. One player.</p><div class="modes">' +
      '<button class="mode primary" data-act="play-daily"><div class="mi">' + icon("cal") + "</div><div><h2>Daily</h2><p>" +
      escapeHtml(shortDate(date)) + " · Puzzle #" + n + " · Midnight ET</p></div><span class=\"chev\">›</span></button>" +
      (CDATA ? '<button class="mode college-new" data-act="play-college"><div class="mi">' + icon("school") +
        '</div><div><h2>College <span class="new-pill">New</span></h2><p>Top 25 SEC, ACC &amp; Big Ten starters · Conference and team clues</p></div><span class="chev">›</span></button>' : "") +
      '<button class="mode" data-act="packs" data-next="unlimited"><div class="mi">' + icon("infinite") +
      '</div><div><h2>Unlimited</h2><p>Practice any pack — no streak risk</p></div><span class="chev">›</span></button>' +
      '<button class="mode" data-act="packs" data-next="passplay"><div class="mi">' + icon("people") +
      '</div><div><h2>Pass & Play</h2><p>Head-to-head on one phone</p></div><span class="chev">›</span></button>' +
      '<button class="mode" data-act="packs" data-next="speed"><div class="mi">' + icon("bolt") +
      '</div><div><h2>Speed Round</h2><p>60 seconds on the clock</p></div><span class="chev">›</span></button></div>' +
      '<div class="diff-label">Daily difficulty · Answer pool</div><div class="pills">' +
      ["stars","starters","full"].map(function (t) {
        return '<button data-tier="' + t + '" class="' + (state.tier===t?"on":"") + '">' + t[0].toUpperCase() + t.slice(1) + "</button>";
      }).join("") + "</div>" +
      '<div class="hard-row"><span>Hard mode — hide the Team column</span>' +
      '<button class="toggle ' + (state.hardMode?"on":"") + '" data-act="toggle-hard" aria-pressed="' + state.hardMode + '"><i></i></button></div>' +
      '<div class="home-foot"><button class="chip" data-go="stats">' + icon("home") + " Stats</button>" +
      '<button class="chip" data-act="open-board">Leaderboard</button>' +
      '<button class="chip" data-go="archive">Archive</button>' +
      '<button class="chip ghost" data-go="how">How to play</button></div>' +
      '<p class="legal">Fan project, not affiliated with any league, conference, school, or team.<br>Player data via nflverse, CC BY 4.0.' +
      (CDATA ? " College data provided by CollegeFootballData.com." : "") + "</p></div>";
  }

  function viewPacks() {
    const counts = DATA.counts;
    const label = (state.packPick || "unlimited").replace("passplay", "Pass & Play");
    return '<div class="screen"><div class="top"><button class="ico" data-go="home" aria-label="Back">' + icon("back") +
      '</button><div class="top-title">' + escapeHtml(label) + '</div><div style="width:40px"></div></div>' +
      '<div class="page-title"><h1>Choose a pack</h1><p>Practice anytime. These games never touch your daily streak.</p></div>' +
      '<button class="pack" data-act="start-pack" data-pack="live"><div class="eyebrow">Default · Live roster</div><h3>All players</h3>' +
      "<p>Current rosters only. Guess anyone — answers follow the Stars, Starters, or Full pool you pick next.</p>" +
      '<div class="stat">' + counts.stars + " stars · " + counts.starters + " starters · " + counts.full + " full</div></button>" +
      '<button class="pack" data-act="start-pack" data-pack="rookies"><div class="eyebrow">Themed pack</div><h3>Rookies</h3>' +
      "<p>First-year players only — years in the league is always 0. A tighter, tougher pool.</p>" +
      '<div class="stat">' + counts.rookies + " rookies this season</div></button>" +
      '<button class="pack" data-act="start-pack" data-pack="legends"><div class="eyebrow">Retired stars · Peak years</div><h3>Legends</h3>' +
      "<p>A curated set of household names from past seasons, graded on peak team, number, and size.</p>" +
      '<div class="stat">' + counts.legends + " retired stars</div></button>" +
      (CDATA ? '<button class="pack" data-act="start-pack" data-pack="college"><div class="eyebrow">New · Updated weekly</div><h3>College</h3>' +
        "<p>Starters from SEC, ACC and Big Ten teams in this week’s Top 25. Graded on team, conference, position, class, number, size, and home state.</p>" +
        '<div class="stat">' + CDATA.counts.pool + " players · " + CDATA.counts.teams + " ranked teams</div></button>" : "") +
      '<p class="legal">Retired players appear only in Legends. Not affiliated with any professional football league or teams.</p></div>';
  }

  function viewGame() {
    const g = state.game;
    const answer = playersById.get(g.answerId);
    const left = g.max - g.guesses.length;
    const hardClass = g.hard ? " hard" : "";
    const cols = colsFor(g);
    const isC = g.pack === "college";
    const n = isC ? collegeNum(g.date) : ((PUZZLES[g.date] && PUZZLES[g.date].n) || puzzleNum(g.date));
    const colClass = isC ? " college" : hardClass;
    let title = "Unlimited";
    if (g.mode === "daily") title = (isC ? "College #" : "Daily #") + n;
    else if (g.mode === "speed") title = "Speed Round";
    else if (g.mode === "passplay") title = "Pass & Play · P" + g.passSeat;
    else if (g.pack === "legends") title = "Legends";
    else if (g.pack === "rookies") title = "Rookies";
    else if (isC) title = "College";
    let rows = "";
    for (let i = 0; i < g.max; i++) {
      if (i < g.guesses.length) {
        const p = playersById.get(g.guesses[i]);
        const tiles = g.grades[i];
        rows += '<div class="row-block"><div class="who">' + badge(p.team, true) + ' <span class="nm">' + escapeHtml(p.name) +
          '</span> <span class="num">#' + p.no + "</span></div><div class=\"tiles" + colClass + '">' +
          tiles.map(tileHtml).join("") + "</div></div>";
      } else {
        rows += '<div class="row-block"><div class="tiles' + colClass + '">' + cols.map(function () { return '<div class="tile"></div>'; }).join("") + "</div></div>";
      }
    }
    const painted = g.hints.colors || g.status !== "playing";
    const hintsLine = [];
    if (g.hints.college) hintsLine.push("College: " + (answer.college || "Not listed"));
    if (g.hints.unit) hintsLine.push("Plays " + (CPOS_UNIT[answer.pos] === "defense" ? "defense" : "offense"));
    if (g.hints.draft) hintsLine.push(answer.udfa ? "Entered the league undrafted." : ("Drafted " + answer.dy + " · Round " + answer.dr + (answer.dp ? " · Pick " + answer.dp : "")));
    let timer = "";
    if (g.mode === "speed" && state.speed) {
      timer = '<span class="timer' + (state.speed.left <= 10 ? " low" : "") + '" data-timer>' + fmtTime(state.speed.left) + "</span>";
    }
    const playing = g.status === "playing";
    const packLabel = isC ? "College" : g.pack === "legends" ? "Legends" : g.pack === "rookies" ? "Rookies" : (g.tier[0].toUpperCase() + g.tier.slice(1));
    let suggest = "";
    if (state.suggest.length) {
      suggest = '<div class="suggest">' + state.suggest.map(function (p, i) {
        return '<button data-act="pick" data-id="' + p.id + '" class="' + (i===state.suggestIndex?"on":"") + '">' +
          badge(p.team, true) + " <span>" + escapeHtml(p.name) + '</span> <span class="meta">' + p.pos + " #" + p.no + "</span></button>";
      }).join("") + "</div>";
    }
    const search = playing
      ? '<div class="search-bar"><span class="mag">' + icon("search") + '</span><input id="guess" type="text" enterkeyhint="go" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Guess a player" value="' +
        escapeHtml(state.search) + '"/>' + suggest + "</div>"
      : '<div class="actions" style="margin-top:8px"><button class="btn gold" data-act="show-result">See result</button>' +
        ((g.mode === "unlimited" || g.mode === "speed") ? '<button class="btn ghost" data-act="again">Play again</button>' : "") + "</div>";
    return '<div class="screen"><div class="top"><button class="ico" data-act="leave-game" aria-label="Back">' + icon("back") +
      '</button><div class="top-title">' + escapeHtml(title) + '</div><button class="ico" data-go="how" aria-label="Info">' + icon("info") + "</button></div>" +
      '<div class="game-meta"><div class="left">' + escapeHtml(shortDate(g.date)) + " · <b>" + packLabel + "</b>" +
      (g.hard ? " · Hard" : "") + (g.mode === "speed" ? " · " + (state.speed ? state.speed.solved : 0) + " solved" : "") + "</div>" +
      (timer || ('<span class="guesses-left' + (left<=2?" low":"") + '">' + left + " guess" + (left===1?"":"es") + " left</span>")) + "</div>" +
      silhouetteSVG(answer, g.guesses.length + (painted && g.hints.colors ? 2 : 0), painted) +
      (hintsLine.length ? '<p class="legal" style="margin:0 0 8px;color:var(--gold)">' + hintsLine.map(escapeHtml).join(" · ") + "</p>" : "") +
      '<div class="board-wrap"><div class="cols' + colClass + '">' + cols.map(function (c) { return "<span>" + colLabel(g, c) + "</span>"; }).join("") + "</div>" + rows + "</div>" +
      search + '<div class="game-foot"><button class="hints-btn" data-act="hints"' + (playing?"":" disabled") + ">Hints</button>" +
      (g.mode === "speed" && playing ? '<button class="skip" data-act="speed-skip">Skip</button>' : "") +
      "</div>" + (isC ? '<p class="legal">Fan project, not affiliated with any league, conference, or school. Data provided by CollegeFootballData.com.</p>' : "") + "</div>";
  }

  function tileHtml(t, idx) {
    const glyph = t.grade === "exact" ? "✓" : t.grade === "close" ? "~" : "–";
    const label = t.grade === "exact" ? "Exact match" : t.grade === "close" ? "Close" : "Miss";
    const delay = ' style="animation-delay:' + (idx * 70) + 'ms"';
    const arrow = t.arrow === "up" ? "▲" : t.arrow === "down" ? "▼" : "";
    let inner;
    if (t.col === "team") inner = badge(t.team, true);
    else if (t.col === "div" || t.col === "home") inner = escapeHtml(t.text) + '<span class="div-sub">' + escapeHtml(t.sub || "") + "</span>";
    else inner = escapeHtml(t.text);
    return '<div class="tile filled ' + t.grade + (t.col === "home" ? " home" : "") + '" aria-label="' + label + '"' + delay + ">" +
      (arrow ? '<span class="arrow" aria-hidden="true">' + arrow + "</span>" : "") +
      inner + '<span class="cue" aria-hidden="true">' + glyph + "</span></div>";
  }

  function fmtTime(s) {
    const n = Math.max(0, Math.ceil(s));
    return Math.floor(n / 60) + ":" + String(n % 60).padStart(2, "0");
  }

  function sheetHints() {
    const g = state.game;
    const answer = playersById.get(g.answerId);
    const freeReady = g.mode === "daily" && !g.archive && !g.hints.college;
    function cost(used, free) {
      return '<span class="pill-cost ' + (used ? "used" : free ? "free" : "") + '">' + (used ? "Used" : free ? "Free today" : "−1 guess") + "</span>";
    }
    if (g.pack === "college") {
      const unitFree = g.mode === "daily" && !g.archive && !g.hints.unit;
      return '<div class="overlay" data-act="close-overlay"><div class="sheet" data-stop><div class="handle"></div><h3>Hints</h3>' +
        '<p class="lead">One free hint per daily. Extra lifelines cost a guess.</p>' +
        '<button class="hint-row" data-act="use-hint" data-hint="unit"' + (g.hints.unit?" disabled":"") + '><div class="ico">' + icon("people") +
        "</div><div><h4>Offense or defense</h4><p>" + (g.hints.unit ? (CPOS_UNIT[answer.pos] === "defense" ? "Plays defense." : "Plays offense.") : "Shows which side of the ball, nothing else.") + "</p></div>" +
        cost(g.hints.unit, unitFree) + "</button>" +
        '<button class="hint-row" data-act="use-hint" data-hint="colors"' + (g.hints.colors?" disabled":"") + '><div class="ico">' + icon("jersey") +
        "</div><div><h4>Jersey colors</h4><p>Paints the silhouette in school colors. No likeness.</p></div>" + cost(g.hints.colors, false) + "</button>" +
        "</div></div>";
    }
    return '<div class="overlay" data-act="close-overlay"><div class="sheet" data-stop><div class="handle"></div><h3>Hints</h3>' +
      '<p class="lead">One free hint per daily. Extra lifelines cost a guess and show on your share card.</p>' +
      '<button class="hint-row" data-act="use-hint" data-hint="college"' + (g.hints.college?" disabled":"") + '><div class="ico">' + icon("school") +
      "</div><div><h4>Reveal college</h4><p>" + (g.hints.college ? escapeHtml(answer.college || "Not listed") : "Shows the school, nothing else.") + "</p></div>" +
      cost(g.hints.college, freeReady) + "</button>" +
      '<button class="hint-row" data-act="use-hint" data-hint="draft"' + (g.hints.draft?" disabled":"") + '><div class="ico">' + icon("draft") +
      "</div><div><h4>Draft year &amp; round</h4><p>Or “entered the league undrafted.”</p></div>" + cost(g.hints.draft, false) + "</button>" +
      '<button class="hint-row" data-act="use-hint" data-hint="colors"' + (g.hints.colors?" disabled":"") + '><div class="ico">' + icon("jersey") +
      "</div><div><h4>Jersey colors</h4><p>Paints the silhouette in team colors. No likeness.</p></div>" + cost(g.hints.colors, false) + "</button>" +
      "</div></div>";
  }

  function sheetRemain() {
    const g = state.game;
    const list = g.remaining.map(function (id) { return playersById.get(id); }).filter(Boolean)
      .sort(function (a, b) { return a.last.localeCompare(b.last) || a.name.localeCompare(b.name); });
    const rows = list.slice(0, 80).map(function (p) {
      return '<button class="list-row" data-act="pick" data-id="' + p.id + '">' + badge(p.team, true) +
        "<div><h4>" + escapeHtml(p.name) + "</h4><p>" + p.pos + " · #" + p.no + " · " + escapeHtml(city(p.team)) + "</p></div></button>";
    }).join("");
    return '<div class="overlay" data-act="close-overlay"><div class="sheet" data-stop><div class="handle"></div><h3>Still in the hunt</h3>' +
      '<p class="lead">' + list.length + " player" + (list.length===1?"":"s") + " still match every clue so far.</p>" +
      rows + (list.length > 80 ? '<p class="legal">Showing first 80.</p>' : "") + "</div></div>";
  }

  function emojiGrid(g) {
    const map = { exact: "🟩", close: "🟨", miss: "⬛" };
    return g.grades.map(function (row) { return row.map(function (t) { return map[t.grade]; }).join(""); }).join("\n");
  }
  function shareHeadline(g) {
    const n = g.pack === "college" ? collegeNum(g.date) : ((PUZZLES[g.date] && PUZZLES[g.date].n) || puzzleNum(g.date));
    const score = g.status === "won" ? (g.guesses.length + "/" + g.max) : ("X/" + g.max);
    const pack = g.pack === "live" ? (g.tier[0].toUpperCase() + g.tier.slice(1)) : (g.pack[0].toUpperCase() + g.pack.slice(1));
    return "Snap Count · " + pack + (g.hard ? " Hard" : "") + " #" + n + " " + score;
  }
  function factLine(p) {
    if (p.udfa) return "“Entered the league as an undrafted free agent.”";
    if (p.dy && p.dr) return "“Drafted in round " + p.dr + " in " + p.dy + ".”";
    if (p.college) return "“Played college football at " + p.college + ".”";
    return "";
  }
  function modalResult() {
    const g = state.game;
    const p = playersById.get(g.answerId);
    const won = g.status === "won";
    const s = getStats(g.tier);
    const title = won ? ("Solved in " + g.guesses.length + " · " + (g.tier[0].toUpperCase() + g.tier.slice(1))) : "OUT OF GUESSES";
    let extra = "";
    if (g.mode === "daily" && !g.archive && g.pack === "college") {
      extra += '<p class="streak-line">College streak <b>' + s.streak + "</b> · Best " + s.maxStreak + " · Next puzzle at midnight ET</p>" +
        '<div class="actions"><button class="btn ghost" data-act="again">Practice College</button><button class="btn ghost" data-go="home">Home</button></div>';
    } else if (g.mode === "daily" && !g.archive) {
      extra += '<p class="streak-line">Streak <b>' + s.streak + "</b> · Best " + s.maxStreak + " · Next puzzle at midnight ET</p>";
      var lock = window.SnapLB ? SnapLB.getLockSync(g.date, g.tier, g.hard) : null;
      var postBtn = (lock && lock.posted)
        ? '<button class="btn gold" data-act="open-board">See leaderboard</button>'
        : '<button class="btn gold" data-act="open-post">Post your score</button>';
      extra += '<div class="actions">' + postBtn + '<button class="btn ghost" data-go="home">Home</button></div>';
    }
    if (g.mode === "unlimited" || g.mode === "speed") {
      extra += '<div class="actions"><button class="btn ghost" data-act="again">Play again</button><button class="btn ghost" data-go="home">Home</button></div>';
    }
    if (g.mode === "passplay" && g.passSeat === 1) {
      extra += '<div class="actions"><button class="btn gold" data-act="pass-to-p2">Pass the phone</button></div>';
    }
    if (g.mode === "passplay" && g.passSeat === 2) extra += passSummary();
    return '<div class="overlay center" data-act="close-overlay"><div class="card" data-stop><div class="solved">' + escapeHtml(title) + "</div>" +
      '<div class="ident">' + silhouetteSVG(p, 8, true, true).replace('class="sil"', 'class="sil" style="width:72px;height:90px"') +
      "<div><h2>" + escapeHtml(p.name) + "</h2><p>" + escapeHtml(city(p.team)) + " · " + p.pos + " · #" + p.no + "</p></div></div>" +
      (isCollege(p) ? collegeFacts(p) : ('<dl class="facts"><div><dt>Team</dt><dd>' + escapeHtml(city(p.team)) + "</dd></div><div><dt>Position</dt><dd>" + p.pos +
      "</dd></div><div><dt>College</dt><dd>" + escapeHtml(p.college || "—") + "</dd></div><div><dt>Draft</dt><dd>" +
      (p.udfa ? "UDFA" : (p.dy + " · Round " + p.dr)) + "</dd></div><div><dt>Years</dt><dd>" + p.yoe +
      "</dd></div><div><dt>Height / Wt</dt><dd>" + fmtHt(p.ht) + " · " + p.wt + " lb</dd></div></dl>" +
      '<p class="factoid">' + escapeHtml(factLine(p)) + "</p>")) +
      '<div class="share-box"><div class="cap">Spoiler-free share</div><div style="font-weight:700;margin-bottom:6px">' +
      escapeHtml(shareHeadline(g)) + '</div><pre class="emoji">' + emojiGrid(g) + "</pre></div>" +
      '<div class="actions"><button class="btn gold" data-act="share-image">Share image</button>' +
      '<button class="btn ghost" data-act="copy-grid">Copy grid</button></div>' + extra + "</div></div>";
  }
  function collegeFacts(p) {
    const t = teamInfo(p.team);
    return '<dl class="facts"><div><dt>School</dt><dd>' + escapeHtml(city(p.team)) + "</dd></div><div><dt>Conference</dt><dd>" + escapeHtml(t ? t.conf : "—") +
      "</dd></div><div><dt>Position</dt><dd>" + escapeHtml(p.pos) + "</dd></div><div><dt>Class</dt><dd>" + (p.cls ? CLASS_LABELS[p.cls] : "—") +
      "</dd></div><div><dt>Hometown</dt><dd>" + escapeHtml([p.hc, p.hs].filter(Boolean).join(", ") || "—") +
      "</dd></div><div><dt>Height / Wt</dt><dd>" + fmtHt(p.ht) + " · " + p.wt + " lb</dd></div></dl>";
  }
  function collegeNum(iso) {
    const row = CPUZZLES[iso];
    if (row && row.n) return row.n;
    const a = new Date("2026-11-24T00:00:00Z"), b = new Date(iso + "T00:00:00Z");
    return Math.floor((b - a) / 86400000) + 1;
  }
  function passSummary() {
    const p = state.pass;
    if (!p || !p.p1 || !p.p2) return "";
    function score(r) { return r.won ? r.guesses : 99; }
    let msg = "It's a tie";
    if (score(p.p1) < score(p.p2)) msg = "Player 1 wins";
    else if (score(p.p2) < score(p.p1)) msg = "Player 2 wins";
    else if (!p.p1.won && !p.p2.won) msg = "Neither found them — tie";
    function fmt(r) { return r.won ? (r.guesses + "/" + r.max) : ("X/" + r.max); }
    return '<p class="streak-line"><b>' + msg + "</b><br>P1 " + fmt(p.p1) + " · P2 " + fmt(p.p2) +
      '</p><div class="actions"><button class="btn ghost" data-go="home">Home</button></div>';
  }
  function modalPassReady() {
    return '<div class="overlay center"><div class="card" data-stop><div class="solved">Pass & Play</div>' +
      '<h2 style="font-family:var(--font-d);text-align:center;margin:8px 0 12px">HAND THE PHONE TO PLAYER 2</h2>' +
      '<p class="legal">Same player, fresh board. Fewer guesses wins.</p>' +
      '<div class="actions"><button class="btn gold" data-act="start-p2">I\'m Player 2</button></div></div></div>';
  }
  function modalSpeedEnd() {
    const s = state.speed || { solved: 0 };
    return '<div class="overlay center" data-act="close-overlay"><div class="card" data-stop><div class="solved">Time\'s up</div>' +
      '<h2 style="font-family:var(--font-d);text-align:center;font-size:42px;margin:8px 0">' + s.solved + "</h2>" +
      '<p class="legal">Players solved in 60 seconds.</p><div class="actions">' +
      '<button class="btn gold" data-act="again">Play again</button><button class="btn ghost" data-go="home">Home</button></div></div></div>';
  }

  function viewStats() {
    const s = getStats(state.tier);
    const pct = s.played ? Math.round((s.wins / s.played) * 100) : 0;
    const maxd = Math.max(1, Math.max.apply(null, s.dist));
    const have = {};
    (loadJSON("gg:achs", [])).forEach(function (id) { have[id] = true; });
    const bars = s.dist.slice(0, 8).map(function (n, i) {
      return '<div class="d"><span>' + (i + 1) + '</span><div class="bar"><i style="width:' + ((n / maxd) * 100) + '%"></i></div><span>' + n + "</span></div>";
    }).join("");
    const ach = ACHIEVEMENTS.map(function (a) {
      return '<div class="ach' + (have[a.id] ? " on" : "") + '"><div class="dot"></div><div><h4>' + a.name + "</h4><p>" + a.desc + "</p></div></div>";
    }).join("");
    return '<div class="screen"><div class="top"><button class="ico" data-go="home" aria-label="Back">' + icon("back") +
      '</button><div class="top-title">Stats</div><div style="width:40px"></div></div>' +
      '<div class="page-title"><h1>' + state.tier + " daily</h1><p>Streaks only count official daily puzzles at this difficulty.</p></div>" +
      '<div class="stat-grid"><div class="stat-cell"><b>' + s.played + "</b><span>Played</span></div>" +
      '<div class="stat-cell"><b>' + pct + "</b><span>Win %</span></div>" +
      '<div class="stat-cell"><b>' + s.streak + "</b><span>Streak</span></div>" +
      '<div class="stat-cell"><b>' + s.maxStreak + "</b><span>Best</span></div>" +
      '<div class="stat-cell"><b>' + s.wins + "</b><span>Wins</span></div>" +
      '<div class="stat-cell"><b>' + (DATA.counts[state.tier] || "—") + "</b><span>Pool</span></div></div>" +
      '<h3 style="font-family:var(--font-d);letter-spacing:.06em;text-transform:uppercase;margin:8px 0">Guess distribution</h3>' +
      '<div class="dist">' + bars + "</div>" +
      '<h3 style="font-family:var(--font-d);letter-spacing:.06em;text-transform:uppercase;margin:18px 0 8px">Achievements</h3>' + ach + "</div>";
  }

  function viewArchive() {
    const today = etDate();
    const ym = (state.archiveMonth || today.slice(0, 7)).split("-").map(Number);
    const ty = ym[0], tm = ym[1];
    const first = new Date(Date.UTC(ty, tm - 1, 1));
    const startDow = first.getUTCDay();
    const daysIn = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
    const label = first.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    let cells = "";
    for (let i = 0; i < startDow; i++) cells += '<div class="day empty"></div>';
    for (let d = 1; d <= daysIn; d++) {
      const iso = ty + "-" + String(tm).padStart(2, "0") + "-" + String(d).padStart(2, "0");
      if (iso < LAUNCH || iso > today || !PUZZLES[iso]) {
        cells += '<button class="day" disabled>' + d + "</button>";
        continue;
      }
      const saved = loadJSON(dailyKey(iso, state.tier, state.hardMode, "live"), null);
      let cls = "day";
      if (saved && saved.status === "won") cls += " won";
      else if (saved && saved.status === "lost") cls += " lost";
      if (iso === today) cls += " today";
      cells += '<button class="' + cls + '" data-act="open-archive" data-date="' + iso + '">' + d + "</button>";
    }
    const prev = addDays(ty + "-" + String(tm).padStart(2, "0") + "-01", -1).slice(0, 7);
    const next = addDays(ty + "-" + String(tm).padStart(2, "0") + "-" + daysIn, 1).slice(0, 7);
    return '<div class="screen"><div class="top"><button class="ico" data-go="home" aria-label="Back">' + icon("back") +
      '</button><div class="top-title">Archive</div><div style="width:40px"></div></div>' +
      '<div class="page-title"><h1>Flashback</h1><p>Replay any past daily. Archive games never change your streak.</p></div>' +
      '<div class="cal-head"><button class="ico" data-act="month" data-month="' + prev + '">' + icon("back") + "</button><b>" + label +
      '</b><button class="ico" data-act="month" data-month="' + next + '">›</button></div>' +
      '<div class="cal-grid">' + ["S","M","T","W","T","F","S"].map(function (d) { return '<div class="dow">' + d + "</div>"; }).join("") + cells + "</div></div>";
  }


  function lbDateLabel(iso) {
    return shortDate(iso || etDate());
  }
  function viewLeaderboard() {
    const tab = state.lbTab || "daily";
    const date = etDate();
    const n = (PUZZLES[date] && PUZZLES[date].n) || puzzleNum(date);
    const group = state.lbGroup;
    const sub = group
      ? ("Group board · " + group.name)
      : (lbDateLabel(date) + " · Starters #" + n + " · fewest guesses, then fastest time");
    const tabs = [["daily", "Daily"], ["weekly", "Weekly"], ["streak", "Best Streak"]].map(function (pair) {
      return '<button class="tab' + (tab === pair[0] ? " on" : "") + '" data-act="lb-tab" data-tab="' + pair[0] + '">' + pair[1] + "</button>";
    }).join("");
    let heads;
    if (tab === "weekly") heads = ["#", "Player", "Days", "Guess"];
    else if (tab === "streak") heads = ["#", "Player", "Best", "Now"];
    else heads = ["#", "Player", "Guess", "Time"];
    let body = "";
    if (state.lbLoading) body = '<p class="lb-empty">Loading the board…</p>';
    else if (state.lbError) body = '<p class="lb-empty">' + escapeHtml(SnapLB.errorText(state.lbError)) + "</p>";
    else if (!state.lbRows || !state.lbRows.length) body = '<p class="lb-empty">No scores on this board yet. Be the first to post.</p>';
    else {
      body = '<div class="lb-head">' + heads.map(function (h) { return "<span>" + h + "</span>"; }).join("") + "</div>";
      body += state.lbRows.map(function (row) {
        var c3, c4;
        if (tab === "weekly") { c3 = String(row.days_played); c4 = String(row.guesses); }
        else if (tab === "streak") { c3 = String(row.best_streak); c4 = String(row.current_streak); }
        else { c3 = String(row.guesses); c4 = SnapLB.fmtMs(row.solve_ms); }
        return '<div class="lb-row' + (row.is_me ? " me" : "") + '"><div class="lb-rank">' + row.rank +
          '</div><div class="lb-who">' + escapeHtml(row.nickname) + (row.is_me ? "<small>You</small>" : "") +
          '</div><div class="lb-g">' + escapeHtml(c3) + '</div><div class="lb-t">' + escapeHtml(c4) + "</div></div>";
      }).join("");
    }
    return '<div class="screen"><div class="top"><button class="ico" data-go="home" aria-label="Back">' + icon("back") +
      '</button><div class="top-title">Leaderboard</div><button class="ico" data-act="open-groups" aria-label="Friend groups">' +
      icon("people") + "</button></div>" +
      '<div class="page-title"><h1>Leaderboard</h1><p class="lb-subline">' + escapeHtml(sub) + "</p></div>" +
      '<div class="lb-tabs">' + tabs + "</div>" + body +
      (group ? '<div class="actions" style="margin-top:12px"><button class="btn ghost" data-act="clear-group">All players</button></div>' : "") +
      "</div>";
  }
  function viewGroups() {
    const groups = (state.lbMeta && state.lbMeta.groups) || [];
    const err = state.groupError ? '<p class="lb-err">' + escapeHtml(SnapLB.errorText(state.groupError)) + "</p>" : "";
    const list = groups.length
      ? groups.map(function (g) {
          return '<button class="lb-row" data-act="pick-group" data-code="' + escapeHtml(g.join_code) + '" data-name="' + escapeHtml(g.name) +
            '"><div class="lb-rank">#</div><div class="lb-who">' + escapeHtml(g.name) + "<small>" + escapeHtml(g.join_code) +
            (g.mine ? " · yours" : "") + '</small></div><div class="lb-g"></div><div class="lb-t">Open</div></button>';
        }).join("")
      : '<p class="lb-empty">You haven’t joined a huddle yet.</p>';
    return '<div class="screen"><div class="top"><button class="ico" data-act="open-board" aria-label="Back">' + icon("back") +
      '</button><div class="top-title">Friend Groups</div><div style="width:40px"></div></div>' +
      '<div class="page-title"><h1>Friend Groups</h1><p class="lb-subline">Your huddle</p></div>' + err +
      '<div class="lb-block"><h3>Create a group</h3><p class="lb-note">Pick a group name. We’ll give you a join code to share.</p>' +
      '<div class="lb-label">Group name</div><input class="lb-field" id="group-name" maxlength="24" placeholder="The Huddle"/>' +
      '<div class="actions"><button class="btn gold" data-act="create-group">Create group</button></div></div>' +
      '<div class="lb-block"><h3>Join with a code</h3><p class="lb-note">Enter the 6-character code a friend sent you.</p>' +
      '<input class="lb-field center" id="group-code" maxlength="6" placeholder="XXXXXX" autocomplete="off"/>' +
      '<div class="actions"><button class="btn gold" data-act="join-group">Join</button></div></div>' +
      '<h3 class="lb-label" style="margin:8px 4px">Your groups</h3>' + list + "</div>";
  }
  function modalPostScore() {
    const g = state.game;
    if (!g) return "";
    const lock = window.SnapLB ? SnapLB.getLockSync(g.date, g.tier, g.hard) : null;
    const guesses = lock ? lock.guesses : g.guesses.length;
    const ms = (lock && (lock.solveMs || lock.solveMsEst)) || (g.lbSession && g.lbSession.started_at ? (Date.now() - Date.parse(g.lbSession.started_at)) : null);
    const nick = (lock && lock.nickname) || (window.SnapLB && SnapLB.savedNickname()) || "";
    const n = (PUZZLES[g.date] && PUZZLES[g.date].n) || puzzleNum(g.date);
    const err = state.postError ? '<p class="lb-err">' + escapeHtml(SnapLB.errorText(state.postError)) + "</p>" : "";
    const busy = state.postBusy ? " disabled" : "";
    return '<div class="overlay" data-act="close-overlay"><div class="sheet lb-sheet" data-stop><div class="handle"></div>' +
      "<h3>Post your score</h3>" +
      '<div class="stat-row"><div class="stat-pill"><b>' + guesses + "</b><span>Guesses</span></div>" +
      '<div class="stat-pill"><b>' + (window.SnapLB ? SnapLB.fmtMs(ms) : "—") + "</b><span>Solve time</span></div>" +
      '<div class="stat-pill"><b>#' + n + "</b><span>" + escapeHtml((g.tier[0].toUpperCase() + g.tier.slice(1)) + (g.hard ? " hard" : " daily")) + "</span></div></div>" +
      '<div class="lb-label">Nickname</div>' +
      '<input class="lb-field" id="lb-nick" maxlength="16" placeholder="GridKid" value="' + escapeHtml(nick) + '" autocomplete="nickname"/>' +
      '<p class="lb-note">Nicknames only, 2–16 characters. <b>Names are filtered for kid-safe language</b> before they go up on the board. No real names or emails.</p>' +
      err +
      '<div class="actions"><button class="btn gold"' + busy + ' data-act="post-score">Post score</button>' +
      '<button class="btn ghost" data-act="skip-post">Not now</button></div></div></div>';
  }
  function modalAlreadyPlayed() {
    const g = state.game;
    const lock = (g && window.SnapLB) ? SnapLB.getLockSync(g.date, g.tier, g.hard) : null;
    const guesses = lock ? lock.guesses : (g ? g.guesses.length : "—");
    const ms = lock && (lock.solveMs || lock.solveMsEst);
    const nick = (lock && lock.nickname) || (window.SnapLB && SnapLB.savedNickname()) || "—";
    const time = window.SnapLB ? SnapLB.fmtMs(ms) : "—";
    return '<div class="overlay" data-act="close-overlay"><div class="sheet lb-sheet" data-stop><div class="handle"></div>' +
      "<h3>Already played today</h3>" +
      '<p class="lead">Your first result is locked in. That’s the only score that can go on the board until the next puzzle at midnight ET.</p>' +
      '<div class="lock-banner"><div><b>First result only.</b> Later retries on this device can’t replace it — ' +
      guesses + " guess" + (guesses === 1 ? "" : "es") + (ms ? (" in " + time) : "") + " stands.</div></div>" +
      '<div class="stat-row"><div class="stat-pill"><b>' + guesses + "</b><span>Guesses</span></div>" +
      '<div class="stat-pill"><b>' + time + "</b><span>Solve time</span></div>" +
      '<div class="stat-pill"><b>' + escapeHtml(String(nick)) + "</b><span>Nickname</span></div></div>" +
      '<div class="actions"><button class="btn gold" data-act="open-board">See leaderboard</button>' +
      '<button class="btn ghost" disabled>Post new score</button></div></div></div>';
  }
  function openLeaderboard() {
    state.view = "leaderboard";
    state.overlay = null;
    state.lbError = null;
    loadLeaderboard();
  }
  function loadLeaderboard() {
    if (!window.SnapLB) {
      state.lbLoading = false;
      state.lbError = "offline";
      state.lbRows = [];
      render();
      return;
    }
    state.lbLoading = true;
    state.lbError = null;
    render();
    const date = etDate();
    const tier = "starters";
    const code = state.lbGroup && state.lbGroup.join_code;
    const tab = state.lbTab || "daily";
    const req = tab === "weekly" ? SnapLB.getWeeklyBoard(date, tier, code)
      : tab === "streak" ? SnapLB.getStreakBoard(tier, code)
      : SnapLB.getDailyBoard(date, tier, code);
    req.then(function (res) {
      state.lbLoading = false;
      if (!res || !res.ok) {
        state.lbError = (res && res.error) || "offline";
        state.lbRows = [];
      } else {
        state.lbRows = res.rows || [];
        state.lbMeta = Object.assign({}, state.lbMeta, res);
      }
      render();
    });
  }
  function loadGroups() {
    state.view = "groups";
    state.overlay = null;
    state.groupError = null;
    render();
    if (!window.SnapLB) return;
    SnapLB.listGroups().then(function (res) {
      if (res && res.ok) state.lbMeta = Object.assign({}, state.lbMeta, { groups: res.groups || [] });
      else state.groupError = (res && res.error) || "offline";
      render();
    });
  }

  function viewHow() {
    return '<div class="screen how"><div class="top"><button class="ico" data-go="home" aria-label="Back">' + icon("back") +
      '</button><div class="top-title">How to play</div><div style="width:40px"></div></div>' +
      '<div class="page-title"><h1>Find the player</h1><p>You get eight guesses (ten in Hard). Each guess scores nine clues.</p></div>' +
      "<h3>Colors</h3><ul><li><span class=\"swatch\" style=\"background:var(--exact)\"></span> Green — exact match</li>" +
      '<li><span class="swatch" style="background:var(--close)"></span> Gold — close (same conference; same unit for position; height / age / years / draft year within 2; jersey number within 5; weight within 10 lb)</li>' +
      '<li><span class="swatch" style="background:var(--miss)"></span> Gray — not close</li></ul>' +
      "<p>Every graded tile also has a small badge: ✓ exact, ~ close, – miss.</p>" +
      "<h3>Position</h3><p>Green is the exact position. Gold means a different position on the same unit: offense (QB, RB, WR, TE, OL), defense (DL, LB, DB), or special teams (K, P, LS). Gray means a different unit.</p>" +
      "<h3>Arrows</h3><p>On number clues, ▲ means the answer is higher and ▼ means the answer is lower.</p>" +
      "<h3>Draft year</h3><p>Undrafted players are shown as UDFA. A UDFA only matches another UDFA — there is no “close” draft year in that case.</p>" +
      "<h3>Difficulty</h3><p>Starters is the default pool: every current depth-chart starter, chosen uniformly at random. Stars is a smaller, more familiar list. Full is every validated player on a current roster. Hard hides the Team column.</p>" +
      "<h3>Packs</h3><p>Rookies uses this season’s first-year players. Legends is a curated set of retired stars, graded on peak team, number, and size. Retired players never appear in the live daily.</p>" +
      "<h3>College</h3><p>College mode uses starters from SEC, ACC and Big Ten teams ranked in the latest AP Top 25: quarterback, running backs, receivers, tight end, center, and defensive linemen. The list updates weekly with the rankings. Clues: Team, Conference, Position (gold = same side of the ball), Class (FR, SO, JR, SR, GS = fifth year or later, counted from seasons on a college roster; gold within one year), jersey number, height, weight, and Home (green = same hometown, gold = same home state). College data provided by <a href=\"https://collegefootballdata.com\" target=\"_blank\" rel=\"noopener\">CollegeFootballData.com</a>. Not affiliated with any conference or school.</p>" +
      "<h3>Add to Home Screen</h3><p>In Safari, tap Share → Add to Home Screen to install this as an app, for free. It works offline once loaded.</p>" +
      '<h3>About the data</h3><p>Player data via <a href="https://github.com/nflverse/nflverse-data/" target="_blank" rel="noopener">nflverse</a>, licensed <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener">CC BY 4.0</a>, with live depth and popularity hints from the public Sleeper API. Rosters refresh daily. Ages are computed from birth dates as of the puzzle’s Eastern Time date. Snapshot: ' +
      escapeHtml((DATA.asOf || "").replace("T", " ").replace("Z", " UTC")) + ".</p>" +
      "<p>Snap Count is an independent fan project and is not affiliated with, endorsed by, or sponsored by any professional football league, team, or players association. No official logos or player likenesses are used.</p>" +
      '<p><a href="./privacy-policy.html">Privacy policy</a></p></div>';
  }

  function viewSettings() {
    const s = state.settings;
    function row(key, label, desc) {
      return '<div class="hard-row" style="padding:12px 0;border-bottom:1px solid var(--line)"><div><b>' + label +
        '</b><div class="legal" style="text-align:left;margin:0">' + desc + '</div></div><button class="toggle ' +
        (s[key] ? "on" : "") + '" data-act="set" data-key="' + key + '"><i></i></button></div>';
    }
    return '<div class="screen"><div class="top"><button class="ico" data-go="home" aria-label="Back">' + icon("back") +
      '</button><div class="top-title">Settings</div><div style="width:40px"></div></div>' +
      '<div class="page-title"><h1>Settings</h1></div>' +
      row("sound", "Sound", "Short beeps on tile flips and results.") +
      row("haptics", "Haptics", "A light vibrate when tiles flip, if your phone allows it.") +
      row("colorblind", "Colorblind mode", "Blue for exact, orange for close, plus a ✓ ≈ – mark on every tile.") +
      '<p class="legal" style="text-align:left;margin-top:24px">Snap Count is a free fan project. Data as of ' +
      escapeHtml(DATA.asOf) + '. <a href="./privacy-policy.html">Privacy policy</a></p></div>';
  }
  function bind() {
    root.querySelectorAll("[data-go]").forEach(function (b) {
      b.addEventListener("click", function () {
        state.overlay = null;
        state.view = b.getAttribute("data-go");
        render();
      });
    });
    root.querySelectorAll("[data-tier]").forEach(function (b) {
      b.addEventListener("click", function () {
        state.tier = b.getAttribute("data-tier");
        saveJSON("gg:tier", state.tier);
        render();
      });
    });
    root.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        handleAct(b.getAttribute("data-act"), b, ev);
      });
    });
    root.querySelectorAll(".overlay").forEach(function (o) {
      o.addEventListener("click", function (ev) {
        if (ev.target === o && o.getAttribute("data-act") === "close-overlay") {
          state.overlay = null;
          render();
        }
      });
    });
    const input = root.querySelector("#guess");
    if (input) {
      input.addEventListener("input", function () {
        state.search = input.value;
        const g = state.game;
        state.suggest = searchPlayers(state.search, g.pack, new Set(g.guesses));
        state.suggestIndex = 0;
        renderKeepInput();
      });
      input.addEventListener("keydown", function (e) { onSearchKey(e); });
    }
  }

  function renderKeepInput() {
    const active = document.activeElement && document.activeElement.id === "guess";
    const start = active ? document.activeElement.selectionStart : null;
    render();
    const input = document.getElementById("guess");
    if (active && input) {
      input.focus();
      const n = state.search.length;
      input.setSelectionRange(start == null ? n : start, start == null ? n : start);
    }
  }

  function onSearchKey(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      state.suggestIndex = Math.min(state.suggest.length - 1, state.suggestIndex + 1);
      renderKeepInput();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      state.suggestIndex = Math.max(0, state.suggestIndex - 1);
      renderKeepInput();
    } else if (e.key === "Enter") {
      e.preventDefault();
      const p = state.suggest[state.suggestIndex] || state.suggest[0];
      if (p) applyGuess(p);
    } else if (e.key === "Escape") {
      state.suggest = [];
      renderKeepInput();
    }
  }

  function startGame(opts) {
    state.game = newGame(opts);
    state.view = "game";
    state.overlay = null;
    state.search = "";
    state.suggest = [];
    if (opts.mode === "daily") persistGame();
    render();
  }

  function handleAct(act, btn) {
    if (act === "toggle-hard") {
      state.hardMode = !state.hardMode;
      saveJSON("gg:hard", state.hardMode);
      render();
    } else if (act === "play-daily") {
      const saved = loadDailyIfAny();
      if (saved && saved.answerId && playersById.get(saved.answerId)) {
        state.game = saved;
        state.view = "game";
        state.overlay = saved.status !== "playing" ? "result" : null;
        render();
        return;
      }
      startGame({ mode: "daily", pack: "live", tier: state.tier, hard: state.hardMode, date: etDate() });
    } else if (act === "play-college") {
      if (!CDATA) { toast("College data is still loading"); return; }
      const csaved = loadJSON(dailyKey(etDate(), "college", false, "college"), null);
      if (csaved && csaved.answerId && playersById.get(csaved.answerId) && csaved.date === etDate()) {
        state.game = csaved;
        state.view = "game";
        state.overlay = csaved.status !== "playing" ? "result" : null;
        render();
        return;
      }
      startGame({ mode: "daily", pack: "college", tier: "college", hard: false, date: etDate() });
    } else if (act === "packs") {
      state.packPick = btn.getAttribute("data-next");
      state.view = "packs";
      render();
    } else if (act === "start-pack") {
      const pack = btn.getAttribute("data-pack");
      const mode = state.packPick || "unlimited";
      if (mode === "speed") {
        state.speed = { solved: 0, attempts: 0, skipped: 0, left: 60, pack: pack, started: Date.now() };
        startGame({ mode: "speed", pack: pack, tier: pack === "college" ? "college" : state.tier, hard: state.hardMode });
        startSpeedClock();
      } else if (mode === "passplay") {
        const answer = pickAnswer("unlimited", pack, state.tier, etDate(), state.hardMode);
        state.pass = { p1: null, p2: null, answerId: answer.id, pack: pack, tier: state.tier, hard: state.hardMode };
        startGame({ mode: "passplay", pack: pack, tier: state.tier, hard: state.hardMode, answer: answer, passSeat: 1 });
      } else {
        startGame({ mode: "unlimited", pack: pack, tier: pack === "college" ? "college" : state.tier, hard: state.hardMode });
      }
    } else if (act === "pick") {
      const p = playersById.get(btn.getAttribute("data-id"));
      state.overlay = null;
      if (p) applyGuess(p);
    } else if (act === "hints") { state.overlay = "hints"; render(); }
    else if (act === "remain") { state.overlay = "remain"; render(); }
    else if (act === "use-hint") { useHint(btn.getAttribute("data-hint")); }
    else if (act === "show-result") { state.overlay = "result"; render(); }
    else if (act === "again") {
      if (state.game && state.game.mode === "speed") {
        const pack = state.game.pack;
        if (!state.speed || state.speed.left <= 0) {
          state.speed = { solved: 0, attempts: 0, skipped: 0, left: 60, pack: pack, started: Date.now() };
          startSpeedClock();
        }
        startGame({ mode: "speed", pack: pack, tier: state.tier, hard: state.hardMode });
      } else if (state.game) {
        startGame({ mode: state.game.mode === "daily" ? "unlimited" : state.game.mode, pack: state.game.pack, tier: state.game.pack === "college" ? "college" : state.game.tier, hard: state.game.hard });
      }
    } else if (act === "leave-game") {
      if (state.game && state.game.mode === "speed") stopSpeedClock();
      state.view = "home";
      state.overlay = null;
      render();
    } else if (act === "copy-grid") copyGrid();
    else if (act === "share-image") shareImage();
    else if (act === "pass-to-p2") { state.overlay = "pass-ready"; render(); }
    else if (act === "start-p2") {
      const p = state.pass;
      startGame({ mode: "passplay", pack: p.pack, tier: p.tier, hard: p.hard, answer: playersById.get(p.answerId), passSeat: 2 });
    } else if (act === "speed-skip") {
      if (state.speed) state.speed.skipped += 1;
      startGame({ mode: "speed", pack: state.game.pack, tier: state.tier, hard: state.hardMode });
    } else if (act === "open-archive") {
      const date = btn.getAttribute("data-date");
      const saved = loadJSON(dailyKey(date, state.tier, state.hardMode, "live"), null);
      if (saved && saved.answerId && playersById.get(saved.answerId) && saved.date === date) {
        state.game = saved;
        state.view = "game";
        state.overlay = saved.status !== "playing" ? "result" : null;
        render();
        return;
      }
      startGame({ mode: "daily", pack: "live", tier: state.tier, hard: state.hardMode, date: date, archive: true });
    } else if (act === "month") {
      state.archiveMonth = btn.getAttribute("data-month");
      render();
    } else if (act === "set") {
      const key = btn.getAttribute("data-key");
      state.settings[key] = !state.settings[key];
      saveJSON("gg:settings", state.settings);
      render();
    } else if (act === "open-board") {
      openLeaderboard();
    } else if (act === "lb-tab") {
      state.lbTab = btn.getAttribute("data-tab") || "daily";
      loadLeaderboard();
    } else if (act === "open-post") {
      const g = state.game;
      const lock = (g && window.SnapLB) ? SnapLB.getLockSync(g.date, g.tier, g.hard) : null;
      state.postError = null;
      state.postBusy = false;
      state.overlay = (lock && lock.posted) ? "already-played" : "post-score";
      render();
    } else if (act === "skip-post") {
      state.overlay = null;
      render();
    } else if (act === "post-score") {
      const g = state.game;
      if (!g || !window.SnapLB) return;
      const input = document.getElementById("lb-nick");
      const nick = input ? input.value : "";
      state.postBusy = true;
      state.postError = null;
      render();
      // re-fill the field after render
      SnapLB.submitScore(g, nick).then(function (res) {
        state.postBusy = false;
        if (res && res.ok) {
          state.overlay = null;
          openLeaderboard();
        } else {
          state.postError = (res && res.error) || "offline";
          render();
          const field = document.getElementById("lb-nick");
          if (field) field.value = nick;
        }
      });
    } else if (act === "open-groups") {
      loadGroups();
    } else if (act === "create-group") {
      const input = document.getElementById("group-name");
      const name = input ? input.value : "";
      if (!window.SnapLB) return;
      SnapLB.createGroup(name).then(function (res) {
        if (res && res.ok) {
          state.lbGroup = { name: res.name, join_code: res.join_code };
          SnapLB.setSavedGroup(state.lbGroup);
          state.groupError = null;
          openLeaderboard();
        } else {
          state.groupError = (res && res.error) || "offline";
          render();
          const field = document.getElementById("group-name");
          if (field) field.value = name;
        }
      });
    } else if (act === "join-group") {
      const input = document.getElementById("group-code");
      const code = input ? input.value : "";
      if (!window.SnapLB) return;
      SnapLB.joinGroup(code).then(function (res) {
        if (res && res.ok) {
          state.lbGroup = { name: res.name, join_code: res.join_code };
          SnapLB.setSavedGroup(state.lbGroup);
          state.groupError = null;
          openLeaderboard();
        } else {
          state.groupError = (res && res.error) || "offline";
          render();
          const field = document.getElementById("group-code");
          if (field) field.value = code;
        }
      });
    } else if (act === "pick-group") {
      state.lbGroup = { name: btn.getAttribute("data-name"), join_code: btn.getAttribute("data-code") };
      if (window.SnapLB) SnapLB.setSavedGroup(state.lbGroup);
      openLeaderboard();
    } else if (act === "clear-group") {
      state.lbGroup = null;
      if (window.SnapLB) SnapLB.setSavedGroup(null);
      openLeaderboard();
    }
  }

  async function copyGrid() {
    const g = state.game;
    const text = shareHeadline(g) + "\n\n" + emojiGrid(g) + "\n";
    try {
      await navigator.clipboard.writeText(text);
      toast("Grid copied");
    } catch (e) { toast("Could not copy"); }
  }

  async function shareImage() {
    const g = state.game;
    const canvas = document.createElement("canvas");
    canvas.width = 1080;
    canvas.height = 1350;
    const c = canvas.getContext("2d");
    c.fillStyle = "#050506";
    c.fillRect(0, 0, 1080, 1350);
    const grd = c.createRadialGradient(540, 0, 20, 540, 0, 700);
    grd.addColorStop(0, "rgba(200,255,0,0.16)");
    grd.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = grd;
    c.fillRect(0, 0, 1080, 1350);
    c.fillStyle = "#C8FF00";
    c.font = "700 28px sans-serif";
    c.textAlign = "center";
    c.fillText("SNAP COUNT", 540, 160);
    c.fillStyle = "#fff";
    c.font = "700 48px sans-serif";
    c.fillText(shareHeadline(g), 540, 240);
    const rows = g.grades;
    const colsN = rows[0] ? rows[0].length : 9;
    const size = 72, gap = 12;
    const w = colsN * size + (colsN - 1) * gap;
    const x0 = (1080 - w) / 2;
    let y = 320;
    const colors = { exact: "#159A55", close: "#E0A800", miss: "#2C2C30" };
    rows.forEach(function (row) {
      row.forEach(function (t, i) {
        c.fillStyle = colors[t.grade];
        const x = x0 + i * (size + gap);
        c.beginPath();
        const r = 12;
        c.moveTo(x + r, y);
        c.arcTo(x + size, y, x + size, y + size, r);
        c.arcTo(x + size, y + size, x, y + size, r);
        c.arcTo(x, y + size, x, y, r);
        c.arcTo(x, y, x + size, y, r);
        c.closePath();
        c.fill();
      });
      y += size + gap;
    });
    const s = getStats(g.tier);
    c.fillStyle = "#B4B4B4";
    c.font = "600 28px sans-serif";
    c.fillText(g.mode === "daily" ? ("Streak " + s.streak + "  ·  Best " + s.maxStreak) : "Practice game", 540, y + 70);
    c.fillStyle = "#7A7A7A";
    c.font = "500 22px sans-serif";
    c.fillText("Not affiliated with any professional league or teams", 540, 1280);
    const blob = await new Promise(function (res) { canvas.toBlob(res, "image/png"); });
    const file = new File([blob], "snap-count.png", { type: "image/png" });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "Snap Count" });
        return;
      }
    } catch (e) {}
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "snap-count.png";
    a.click();
    URL.revokeObjectURL(url);
    toast("Image saved");
  }

  let speedTimer = null;
  function startSpeedClock() {
    stopSpeedClock();
    speedTimer = setInterval(function () {
      if (!state.speed) return;
      state.speed.left = Math.max(0, 60 - (Date.now() - state.speed.started) / 1000);
      const t = document.querySelector("[data-timer]");
      if (t) {
        t.textContent = fmtTime(state.speed.left);
        t.classList.toggle("low", state.speed.left <= 10);
      }
      if (state.speed.left <= 0) {
        stopSpeedClock();
        if (state.game) state.game.status = "lost";
        state.overlay = "speed-end";
        render();
      }
    }, 200);
  }
  function stopSpeedClock() {
    if (speedTimer) clearInterval(speedTimer);
    speedTimer = null;
  }

  let lastEt = etDate();
  setInterval(function () {
    const now = etDate();
    if (now !== lastEt) {
      lastEt = now;
      if (state.view === "game" && state.game && state.game.mode === "daily" && !state.game.archive && state.game.date !== now && state.game.status === "playing") {
        toast("A new daily puzzle is available");
      }
    }
  }, 15000);
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) lastEt = etDate();
  });

  document.addEventListener("keydown", function (e) {
    if (state.view !== "game" || !state.game || state.game.status !== "playing") return;
    const input = document.getElementById("guess");
    if (input && document.activeElement === input) return;
    if (e.key === "/" || (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey)) {
      if (e.key !== "/") {
        state.search += e.key;
        state.suggest = searchPlayers(state.search, state.game.pack, new Set(state.game.guesses));
      }
      render();
      const i = document.getElementById("guess");
      if (i) i.focus();
      if (e.key !== "/") e.preventDefault();
    }
  });

  function loadCollege() {
    Promise.all([
      fetch("./data/college.json").then(function (r) { if (!r.ok) throw new Error("college " + r.status); return r.json(); }),
      fetch("./data/college-puzzles.json").then(function (r) { return r.ok ? r.json() : {}; })
    ]).then(function (res) {
      CDATA = res[0];
      CPUZZLES = res[1] || {};
      CDATA.players.forEach(function (p) {
        if (!p.first) p.first = p.name.split(" ")[0];
        if (!p.last) p.last = p.name.split(" ").slice(1).join(" ");
        if (!p.nick) p.nick = [];
        playersById.set(p.id, p);
      });
      if (state.view === "home" || state.view === "packs") render();
    }).catch(function (e) { console.warn("College data unavailable", e); });
  }

  async function init() {
    try {
      const pack = await Promise.all([
        fetch("./data/players.json").then(function (r) { return r.json(); }),
        fetch("./data/puzzles.json").then(function (r) { return r.json(); })
      ]);
      DATA = pack[0];
      PUZZLES = pack[1];
      playersById = new Map(DATA.players.map(function (p) { return [p.id, p]; }));
      loadCollege();
      if (window.SnapLB) state.lbGroup = SnapLB.savedGroup();
      render();
      if ("serviceWorker" in navigator) {
        navigator.serviceWorker.register("./sw.js").catch(function () {});
      }
    } catch (err) {
      root.innerHTML = '<div class="screen"><p class="tag">Could not load the roster. Check your connection and try again.</p></div>';
      console.error(err);
    }
  }
  init();
})();
