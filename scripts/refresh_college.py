#!/usr/bin/env python3
"""Weekly College-mode refresh for Snap Count.

Pool: the top 100 QB, RB, WR, TE and DL (no centers) from SEC, ACC and Big Ten
teams in the latest AP Top 25 (Coaches Poll if the AP poll is missing), ranked
by this season's production on a robust within-position z-score so the mix
stays comparable across positions. Stats from CollegeFootballData.com (CFBD).

Usage:
  CFBD_KEY_FILE=/workspace/snapcount-secrets/cfbd.txt python3 scripts/refresh_college.py

The API key is read from $CFBD_API_KEY or the file in $CFBD_KEY_FILE
(default /workspace/snapcount-secrets/cfbd.txt). It is never written anywhere.

Weekly API calls: 4 (rankings, teams, roster, season stats). The first run on a
fresh box also caches past rosters (2021-2025) and the recruiting class used to
work out class years: 6 more calls, once. Cache: $CFBD_CACHE_DIR
(default /workspace/snapcount-college-cache). Past seasons never change, so
those files are reused; current-season files are re-fetched every run.

Writes www/data/college.json and www/data/college-puzzles.json, mirrored to
docs/data/. Past and today's daily answers are never changed. Exits non-zero
without writing if the pool fails validation.
"""
from __future__ import annotations

import datetime as dt
import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
OUT_DIRS = [ROOT / "www" / "data", ROOT / "docs" / "data"]
API = "https://api.collegefootballdata.com"
CONFS = {"SEC": "SEC", "ACC": "ACC", "Big Ten": "B1G"}
COLLEGE_LAUNCH = dt.date(2026, 11, 24)
HORIZON_DAYS = 14
NO_REPEAT_DAYS = 60
POOL_SIZE, MIN_TEAMS = 100, 3
DL_POS = {"DL", "DE", "DT", "NT", "EDGE"}
CALLS = 0


def fnv1a(s: str) -> int:
    h = 2166136261
    for ch in s.encode("utf-8"):
        h ^= ch
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def api_key() -> str:
    key = os.environ.get("CFBD_API_KEY", "").strip()
    if not key:
        path = Path(os.environ.get("CFBD_KEY_FILE", "/workspace/snapcount-secrets/cfbd.txt"))
        if not path.exists():
            sys.exit(f"CFBD key not found at {path}")
        key = path.read_text().strip()
    if not key:
        sys.exit("CFBD key is empty")
    return key


def fetch(path: str, params: dict, cache: Path, name: str, reuse: bool, key: str):
    global CALLS
    f = cache / name
    if reuse and f.exists():
        return json.loads(f.read_text())
    url = API + path + "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(url, headers={"Authorization": "Bearer " + key, "Accept": "application/json"})
    with urllib.request.urlopen(req, timeout=180) as r:
        body = r.read()
    CALLS += 1
    data = json.loads(body)
    tmp = f.with_suffix(".tmp")
    tmp.write_bytes(body)
    tmp.replace(f)
    return data


def et_today() -> dt.date:
    try:
        from zoneinfo import ZoneInfo
        return dt.datetime.now(ZoneInfo("America/New_York")).date()
    except Exception:
        return dt.datetime.now(dt.timezone(dt.timedelta(hours=-5))).date()


def latest_poll(rankings: list):
    order = {"regular": 0, "postseason": 1}
    weeks = sorted(rankings, key=lambda w: (order.get(w.get("seasonType"), 0), w.get("week", 0)))
    for w in reversed(weeks):
        polls = {p["poll"]: p for p in w.get("polls", [])}
        for name in ("AP Top 25", "Coaches Poll"):
            if name in polls and polls[name].get("ranks"):
                return w, name, polls[name]["ranks"]
    sys.exit("No AP or Coaches poll found")


def stat_table(stats: list) -> dict:
    out: dict[str, dict] = {}
    for s in stats:
        try:
            v = float(s["stat"])
        except (TypeError, ValueError):
            continue
        out.setdefault(str(s["playerId"]), {})[s["category"] + "." + s["statType"]] = v
    return out


def class_years(cache: Path, key: str, season: int) -> tuple[dict, set]:
    """First season each player id appears on any roster, plus this year's HS recruit ids."""
    first: dict[str, int] = {}
    for y in range(season - 5, season):
        rows = fetch("/roster", {"year": y}, cache, f"roster-all-{y}.json", True, key)
        for p in rows:
            pid = str(p.get("id"))
            if pid and pid not in first:
                first[pid] = y
    recruits = fetch("/recruiting/players", {"year": season, "classification": "HighSchool"},
                     cache, f"recruits-{season}.json", True, key)
    rids = {str(r.get("id")) for r in recruits if r.get("id") is not None}
    return first, rids


def to_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def main() -> int:
    key = api_key()
    cache = Path(os.environ.get("CFBD_CACHE_DIR", "/workspace/snapcount-college-cache"))
    cache.mkdir(parents=True, exist_ok=True)
    today = et_today()
    season = int(os.environ.get("CFBD_SEASON", today.year if today.month >= 7 else today.year - 1))

    rankings = fetch("/rankings", {"year": season}, cache, f"rankings-{season}.json", False, key)
    week, poll_name, ranks = latest_poll(rankings)
    teams = fetch("/teams/fbs", {"year": season}, cache, f"teams-{season}.json", False, key)
    by_school = {t["school"]: t for t in teams}
    ranked = []
    for r in sorted(ranks, key=lambda r: r["rank"]):
        t = by_school.get(r["school"])
        if t and t.get("conference") in CONFS:
            ranked.append((r["rank"], t))
    if len(ranked) < MIN_TEAMS:
        sys.exit(f"Validation failed: only {len(ranked)} ranked SEC/ACC/Big Ten teams")

    roster = fetch("/roster", {"year": season, "classification": "fbs"}, cache, f"roster-{season}.json", False, key)
    stats = stat_table(fetch("/stats/player/season", {"year": season}, cache, f"stats-{season}.json", False, key))
    first_seen, recruit_ids = class_years(cache, key, season)

    def usable(p):
        return (p.get("firstName") or p.get("lastName")) and to_int(p.get("jersey")) is not None \
            and to_int(p.get("height")) and to_int(p.get("weight"))

    def pos_of(p):
        raw = (p.get("position") or "").upper()
        if raw in ("QB", "RB", "WR", "TE"):
            return raw
        if raw in DL_POS:
            return "DL"
        return None

    def raw_score(pos, s):
        if pos == "QB":
            return s.get("passing.YDS", 0) + 20 * s.get("passing.TD", 0)
        if pos == "RB":
            return s.get("rushing.YDS", 0) + 20 * s.get("rushing.TD", 0)
        if pos in ("WR", "TE"):
            return s.get("receiving.YDS", 0) + 10 * s.get("receiving.REC", 0) + 20 * s.get("receiving.TD", 0)
        if pos == "DL":
            return s.get("defensive.TOT", 0) + 2 * s.get("defensive.TFL", 0) + 3 * s.get("defensive.SACKS", 0)
        return 0

    def median(xs):
        ys = sorted(xs)
        n = len(ys)
        if n == 0:
            return 0.0
        mid = n // 2
        return float(ys[mid]) if n % 2 else (ys[mid - 1] + ys[mid]) / 2.0

    def robust_z(xs, x):
        """Median/MAD z-score, scaled to SD units. Falls back to mean/SD if MAD is 0."""
        if not xs:
            return 0.0
        med = median(xs)
        mad = median([abs(v - med) for v in xs])
        if mad > 0:
            return 0.6745 * (x - med) / mad
        mu = sum(xs) / len(xs)
        var = sum((v - mu) ** 2 for v in xs) / len(xs)
        sd = var ** 0.5
        return (x - mu) / sd if sd else 0.0

    team_out = {}
    school_to_key = {}
    candidates = []
    for rank, t in ranked:
        school = t["school"]
        abbr = (t.get("abbreviation") or school[:4]).replace("&", "").upper()
        tkey = "cfb-" + abbr
        school_to_key[school] = tkey
        team_out[tkey] = {
            "abbr": tkey, "display": abbr, "city": school, "conf": CONFS[t["conference"]],
            "c1": t.get("color") or "#444444", "c2": t.get("alternateColor") or "#999999", "rank": rank,
        }
        for p in roster:
            if p.get("team") != school or not usable(p):
                continue
            pos = pos_of(p)
            if not pos:
                continue
            raw = raw_score(pos, stats.get(str(p["id"]), {}))
            if raw <= 0:
                continue
            candidates.append((pos, raw, p, tkey))

    by_pos_raw: dict[str, list[float]] = {}
    for pos, raw, _p, _tkey in candidates:
        by_pos_raw.setdefault(pos, []).append(raw)
    scored = []
    for pos, raw, p, tkey in candidates:
        scored.append((robust_z(by_pos_raw[pos], raw), raw, pos, p, tkey))
    scored.sort(key=lambda x: (-x[0], -x[1], str(x[3]["id"])))
    if len(scored) < POOL_SIZE:
        sys.exit(f"Validation failed: only {len(scored)} players with production, need {POOL_SIZE}")
    picked = scored[:POOL_SIZE]

    players = []
    warnings = []
    for _z, _raw, pos, p, tkey in picked:
        pid = str(p["id"])
        if pid in first_seen:
            cls = min(5, season - first_seen[pid] + 1)
        elif any(str(r) in recruit_ids for r in (p.get("recruitIds") or [])):
            cls = 1
        else:
            cls = None
        rec = {
            "id": "cfb-" + pid,
            "name": ((p.get("firstName") or "") + " " + (p.get("lastName") or "")).strip(),
            "first": p.get("firstName") or "", "last": p.get("lastName") or "",
            "team": tkey, "pos": pos, "no": to_int(p["jersey"]),
            "ht": to_int(p["height"]), "wt": to_int(p["weight"]),
        }
        if cls is not None:
            rec["cls"] = cls
        country = (p.get("homeCountry") or "USA").upper()
        st = p.get("homeState") if country in ("USA", "US", "") else country[:3]
        if st:
            rec["hs"] = st
        if p.get("homeCity"):
            rec["hc"] = p["homeCity"]
        players.append(rec)
    mix = {k: sum(1 for x in picked if x[2] == k) for k in ("QB", "RB", "WR", "TE", "DL")}
    if any(v == 0 for v in mix.values()):
        warnings.append(f"Top {POOL_SIZE} is missing a position: {mix}")

    # dedupe ids (should not happen)
    seen = set()
    players = [p for p in players if not (p["id"] in seen or seen.add(p["id"]))]
    pool_n = len(players)
    if pool_n != POOL_SIZE:
        sys.exit(f"Validation failed: pool size {pool_n} != {POOL_SIZE}")
    eligible = sorted(p["id"] for p in players if p.get("cls"))
    if len(eligible) < 30:
        sys.exit(f"Validation failed: only {len(eligible)} answer-eligible players")

    # Daily answers: keep every date up to today, regenerate the rest.
    puz_path = OUT_DIRS[0] / "college-puzzles.json"
    puzzles = json.loads(puz_path.read_text()) if puz_path.exists() else {}
    puzzles = {k: v for k, v in puzzles.items() if dt.date.fromisoformat(k) <= today}
    d = max(COLLEGE_LAUNCH, today - dt.timedelta(days=0))
    end = today + dt.timedelta(days=HORIZON_DAYS)
    while d <= end:
        k = d.isoformat()
        if k not in puzzles:
            excl = set()
            for back in range(1, NO_REPEAT_DAYS + 1):
                prev = (d - dt.timedelta(days=back)).isoformat()
                if prev in puzzles:
                    excl.add(puzzles[prev]["college"])
            cand = [i for i in eligible if i not in excl] or eligible
            puzzles[k] = {"n": (d - COLLEGE_LAUNCH).days + 1,
                          "college": cand[fnv1a(f"gridiron-guess|{k}|college") % len(cand)]}
        d += dt.timedelta(days=1)
    puzzles = dict(sorted(puzzles.items()))

    # Keep player records for any answer that is no longer in the pool.
    pool_ids = {p["id"] for p in players}
    for p in players:
        p["pool"] = True
    old_path = OUT_DIRS[0] / "college.json"
    old = json.loads(old_path.read_text()) if old_path.exists() else {"players": [], "teams": {}}
    old_by_id = {p["id"]: p for p in old.get("players", [])}
    needed = {v["college"] for v in puzzles.values()} - pool_ids
    for pid in sorted(needed):
        rec = old_by_id.get(pid)
        if rec is None:
            sys.exit(f"Validation failed: served answer {pid} missing from previous college.json")
        rec = dict(rec, pool=False)
        players.append(rec)
        if rec["team"] not in team_out and rec["team"] in old.get("teams", {}):
            t = dict(old["teams"][rec["team"]])
            t.pop("rank", None)
            team_out[rec["team"]] = t

    by_pos = {}
    for p in players:
        if p["pool"]:
            by_pos[p["pos"]] = by_pos.get(p["pos"], 0) + 1
    payload = {
        "season": season, "week": week.get("week"), "seasonType": week.get("seasonType"), "poll": poll_name,
        "asOf": dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "attribution": "Data provided by CollegeFootballData.com",
        "teams": team_out, "players": players,
        "counts": {"pool": pool_n, "eligible": len(eligible), "teams": len(ranked), "byPos": by_pos},
    }
    for out in OUT_DIRS:
        out.mkdir(parents=True, exist_ok=True)
        for name, obj in (("college.json", payload), ("college-puzzles.json", puzzles)):
            tmp = out / (name + ".tmp")
            tmp.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False))
            tmp.replace(out / name)
    print(json.dumps({
        "season": season, "week": week.get("week"), "seasonType": week.get("seasonType"), "poll": poll_name,
        "teams": [f"#{r} {t['school']} ({CONFS[t['conference']]})" for r, t in ranked],
        "counts": payload["counts"], "retainedPastAnswers": len(needed),
        "todayAnswer": puzzles.get(today.isoformat()), "apiCalls": CALLS, "warnings": warnings,
    }, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
