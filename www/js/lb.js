/* Snap Count leaderboard client. Uses only the publishable key. */
(function (global) {
  "use strict";

  var URL = "https://cxndbxnhizjzwelavzsw.supabase.co";
  var ANON = "sb_publishable_OXco-1m75MwKOvTTGtXA3A_33m7Uo4m";
  var LS_DEVICE = "gg:lb:device";
  var LS_NICK = "gg:lb:nickname";
  var LS_GROUP = "gg:lb:group";
  var DB_NAME = "snap-count";
  var DB_STORE = "dailyResults";

  function headers() {
    return {
      apikey: ANON,
      Authorization: "Bearer " + ANON,
      "Content-Type": "application/json",
      Prefer: "return=representation"
    };
  }

  function rpc(name, body) {
    return fetch(URL + "/rest/v1/rpc/" + name, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify(body || {})
    }).then(function (res) {
      return res.json().then(function (data) {
        if (!res.ok) {
          var msg = (data && (data.message || data.error || data.hint)) || ("HTTP " + res.status);
          return { ok: false, error: "network", detail: msg };
        }
        return data;
      });
    }).catch(function () {
      return { ok: false, error: "offline" };
    });
  }

  function uuid() {
    if (global.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = new Uint8Array(16);
    crypto.getRandomValues(b);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    var h = [...b].map(function (x) { return x.toString(16).padStart(2, "0"); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }

  function deviceId() {
    try {
      var id = localStorage.getItem(LS_DEVICE);
      if (id && /^[0-9a-f-]{36}$/i.test(id)) return id;
      id = uuid();
      localStorage.setItem(LS_DEVICE, id);
      return id;
    } catch (e) {
      return uuid();
    }
  }

  function lockKey(date, tier, hard) {
    return "gg:lb:lock:" + date + ":" + (tier || "starters") + ":" + (hard ? "1" : "0");
  }

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!global.indexedDB) { resolve(null); return; }
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(DB_STORE)) db.createObjectStore(DB_STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { resolve(null); };
    });
  }

  function idbPut(key, val) {
    return openDb().then(function (db) {
      if (!db) return;
      return new Promise(function (resolve) {
        var tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).put(val, key);
        tx.oncomplete = function () { resolve(true); };
        tx.onerror = function () { resolve(false); };
      });
    });
  }

  function idbGet(key) {
    return openDb().then(function (db) {
      if (!db) return null;
      return new Promise(function (resolve) {
        var tx = db.transaction(DB_STORE, "readonly");
        var r = tx.objectStore(DB_STORE).get(key);
        r.onsuccess = function () { resolve(r.result || null); };
        r.onerror = function () { resolve(null); };
      });
    });
  }

  function getLockSync(date, tier, hard) {
    try {
      var raw = localStorage.getItem(lockKey(date, tier, hard));
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  }

  function saveLock(rec) {
    var key = lockKey(rec.date, rec.tier, rec.hard);
    try { localStorage.setItem(key, JSON.stringify(rec)); } catch (e) {}
    return idbPut(key, rec);
  }

  function loadLock(date, tier, hard) {
    var local = getLockSync(date, tier, hard);
    if (local) return Promise.resolve(local);
    return idbGet(lockKey(date, tier, hard)).then(function (rec) {
      if (rec) {
        try { localStorage.setItem(lockKey(date, tier, hard), JSON.stringify(rec)); } catch (e) {}
      }
      return rec;
    });
  }

  function sha256Hex(text) {
    var enc = new TextEncoder().encode(text);
    return crypto.subtle.digest("SHA-256", enc).then(function (buf) {
      return [...new Uint8Array(buf)].map(function (b) { return b.toString(16).padStart(2, "0"); }).join("");
    });
  }

  function answerHash(date, tier, answerId, hard) {
    var t = hard ? "hard" : (tier || "starters");
    return sha256Hex(date + ":" + t + ":" + answerId);
  }

  function fmtMs(ms) {
    if (ms == null || isNaN(ms)) return "—";
    var s = Math.max(0, Math.round(Number(ms) / 1000));
    var m = Math.floor(s / 60);
    return m + ":" + String(s % 60).padStart(2, "0");
  }

  function officialDaily(g) {
    return g && g.mode === "daily" && !g.archive && g.pack === "live";
  }

  function sessionKey(g) {
    return "gg:lb:session:" + g.date + ":" + g.tier + ":" + (g.hard ? "1" : "0");
  }

  function startSession(g) {
    if (!officialDaily(g)) return Promise.resolve(null);
    if (g.lbSession && g.lbSession.token) return Promise.resolve(g.lbSession);
    try {
      var cached = JSON.parse(localStorage.getItem(sessionKey(g)) || "null");
      if (cached && cached.token) {
        g.lbSession = cached;
        return Promise.resolve(cached);
      }
    } catch (e) {}
    return rpc("start_session", {
      p_puzzle_date: g.date,
      p_device_id: deviceId(),
      p_tier: g.tier || "starters",
      p_hard: !!g.hard
    }).then(function (res) {
      if (res && res.ok && res.token) {
        g.lbSession = res;
        try { localStorage.setItem(sessionKey(g), JSON.stringify(res)); } catch (e) {}
        return res;
      }
      return res;
    });
  }

  function recordFirstResult(g) {
    if (!officialDaily(g) || (g.status !== "won" && g.status !== "lost")) return Promise.resolve(null);
    return loadLock(g.date, g.tier, g.hard).then(function (existing) {
      if (existing) return existing;
      var started = g.lbSession && g.lbSession.started_at ? Date.parse(g.lbSession.started_at) : null;
      var rec = {
        date: g.date,
        tier: g.tier,
        hard: !!g.hard,
        guesses: g.guesses.length,
        won: g.status === "won",
        answerId: g.answerId,
        max: g.max,
        solveMsEst: started ? Math.max(0, Date.now() - started) : null,
        posted: false,
        nickname: null
      };
      return saveLock(rec).then(function () { return rec; });
    });
  }

  function submitScore(g, nickname) {
    var recPromise = loadLock(g.date, g.tier, g.hard);
    return recPromise.then(function (lock) {
      if (lock && lock.posted) return { ok: false, error: "already_submitted", lock: lock };
      return startSession(g).then(function (sess) {
        if (!sess || !sess.token) return { ok: false, error: (sess && sess.error) || "offline" };
        var hard = !!g.hard;
        var answerId = g.answerId;
        var guesses = lock ? lock.guesses : g.guesses.length;
        var won = lock ? lock.won : g.status === "won";
        return answerHash(g.date, g.tier, answerId, hard).then(function (hash) {
          return rpc("submit_score", {
            p_token: sess.token,
            p_nickname: nickname,
            p_guesses: guesses,
            p_answer_hash: hash,
            p_won: won
          }).then(function (res) {
            if (res && res.ok) {
              var stored = Object.assign({}, lock || {}, {
                posted: true,
                nickname: res.nickname,
                solveMs: res.solve_ms,
                guesses: res.guesses,
                won: res.won
              });
              try { localStorage.setItem(LS_NICK, res.nickname); } catch (e) {}
              return saveLock(stored).then(function () { return res; });
            }
            return res;
          });
        });
      });
    });
  }

  function errorText(code) {
    var map = {
      offline: "Couldn’t reach the board. Check your connection and try again.",
      network: "Couldn’t reach the board. Try again in a moment.",
      wrong_date: "This board is for today’s puzzle (midnight Eastern).",
      too_fast: "That solve was too quick to count. Play it out and post again tomorrow.",
      bad_hash: "That score didn’t match today’s answer.",
      nickname_length: "Nicknames should be 2 to 16 characters.",
      nickname_chars: "Use letters, numbers, spaces, or underscores only.",
      nickname_blocked: "Please pick a kid-safe nickname.",
      nickname_taken: "That nickname is already on today’s board.",
      device_taken: "This device already posted today’s score.",
      already_submitted: "Your first result is already on the board.",
      rate_limited: "Too many tries. Wait a bit and try again.",
      bad_guesses: "That guess count doesn’t look right.",
      bad_token: "Your scoring session expired. Open today’s puzzle and try again.",
      no_answer: "Today’s board isn’t ready yet.",
      name_length: "Group names should be 2 to 24 characters.",
      name_chars: "Use letters, numbers, spaces, or underscores only.",
      name_blocked: "Please pick a kid-safe group name.",
      bad_code: "Join codes are 6 characters.",
      not_found: "We couldn’t find a group with that code."
    };
    return map[code] || "Something went wrong. Try again.";
  }

  global.SnapLB = {
    url: URL,
    deviceId: deviceId,
    officialDaily: officialDaily,
    startSession: startSession,
    recordFirstResult: recordFirstResult,
    loadLock: loadLock,
    getLockSync: getLockSync,
    submitScore: submitScore,
    fmtMs: fmtMs,
    errorText: errorText,
    savedNickname: function () {
      try { return localStorage.getItem(LS_NICK) || ""; } catch (e) { return ""; }
    },
    savedGroup: function () {
      try { return JSON.parse(localStorage.getItem(LS_GROUP) || "null"); } catch (e) { return null; }
    },
    setSavedGroup: function (g) {
      try {
        if (g) localStorage.setItem(LS_GROUP, JSON.stringify(g));
        else localStorage.removeItem(LS_GROUP);
      } catch (e) {}
    },
    getDailyBoard: function (date, tier, groupCode) {
      return rpc("get_daily_board", {
        p_date: date || null,
        p_tier: tier || "starters",
        p_group_code: groupCode || null,
        p_device_id: deviceId()
      });
    },
    getWeeklyBoard: function (date, tier, groupCode) {
      return rpc("get_weekly_board", {
        p_date: date || null,
        p_tier: tier || "starters",
        p_group_code: groupCode || null,
        p_device_id: deviceId()
      });
    },
    getStreakBoard: function (tier, groupCode) {
      return rpc("get_streak_board", {
        p_tier: tier || "starters",
        p_group_code: groupCode || null,
        p_device_id: deviceId()
      });
    },
    createGroup: function (name) {
      return rpc("create_group", { p_device_id: deviceId(), p_name: name });
    },
    joinGroup: function (code) {
      return rpc("join_group", { p_device_id: deviceId(), p_code: code });
    },
    listGroups: function () {
      return rpc("list_groups", { p_device_id: deviceId() });
    }
  };
})(window);
