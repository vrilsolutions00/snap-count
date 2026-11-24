#!/usr/bin/env python3
"""Weekly College-mode refresh for Snap Count.

Pool: SEC, ACC and Big Ten teams in the latest AP Top 25 (Coaches Poll if the
AP poll is missing). Per team: 1 QB, 1-2 RB, 3 WR, 1 TE, 1 C, 4 DL, picked from
CollegeFootballData.com (CFBD) season stats. Centers come from
scripts/college_centers.json because CFBD lists most linemen only as "OL".

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
CENTERS_FILE = ROOT / "scripts" / "college_centers.json"
API = "https://api.collegefootballdata.com"
CONFS = {"SEC": "SEC", "ACC": "ACC", "Big Ten": "B1G"}
COLLEGE_LAUNCH = dt.date(2026, 11, 24)
HORIZON_DAYS = 14
NO_REPEAT_DAYS = 60
POOL_MIN, POOL_MAX, MIN_TEAMS = 60, 500, 3
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
    centers = json.loads(CENTERS_FILE.read_text())["teams"]

    team_out = {}
    players = []
    warnings = []
    for rank, t in ranked:
        school = t["school"]
        abbr = (t.get("abbreviation") or school[:4]).replace("&", "").upper()
        tkey = "cfb-" + abbr
        team_out[tkey] = {
            "abbr": tkey, "display": abbr, "city": school, "conf": CONFS[t["conference"]],
            "c1": t.get("color") or "#444444", "c2": t.get("alternateColor") or "#999999", "rank": rank,
        }
        mine = [p for p in roster if p.get("team") == school]

        def usable(p):
            return (p.get("firstName") or p.get("lastName")) and to_int(p.get("jersey")) is not None \
                and to_int(p.get("height")) and to_int(p.get("weight"))

        def top(positions, metric, n, need=0.0):
            cand = []
            for p in mine:
                if (p.get("position") or "").upper() not in positions or not usable(p):
                    continue
                s = stats.get(str(p["id"]), {})
                score = metric(s)
                if score > need:
                    cand.append((score, p))
            cand.sort(key=lambda x: (-x[0], str(x[1]["id"])))
            return cand[:n]

        picks = []
        picks += [("QB", p) for _, p in top({"QB"}, lambda s: s.get("passing.ATT", 0), 1)]
        rbs = top({"RB"}, lambda s: s.get("rushing.CAR", 0), 2)
        if rbs:
            picks.append(("RB", rbs[0][1]))
            if len(rbs) > 1 and rbs[1][0] >= 0.4 * rbs[0][0]:
                picks.append(("RB", rbs[1][1]))
        picks += [("WR", p) for _, p in top({"WR"}, lambda s: s.get("receiving.YDS", 0) + s.get("receiving.REC", 0) / 100, 3)]
        picks += [("TE", p) for _, p in top({"TE"}, lambda s: s.get("receiving.YDS", 0) + s.get("receiving.REC", 0) / 100, 1)]
        dl_metric = lambda s: (s.get("defensive.TOT", 0) + 2 * s.get("defensive.TFL", 0)
                               + 3 * s.get("defensive.SACKS", 0) + s.get("defensive.QB HUR", 0))
        picks += [("DL", p) for _, p in top(DL_POS, dl_metric, 4)]
        c = centers.get(school)
        cp = None
        if c:
            cp = next((p for p in mine if str(p.get("id")) == str(c.get("cfbdId"))), None)
            if cp is None:
                cp = next((p for p in mine if to_int(p.get("jersey")) == c.get("no")
                           and (p.get("lastName") or "").split(" ")[0].lower() in c["name"].lower()), None)
        if cp is not None and usable(cp):
            picks.append(("C", cp))
        else:
            warnings.append(f"No center for {school} (update scripts/college_centers.json)")
        for pos, p in picks:
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
        counted = {k: sum(1 for x, _ in picks if x == k) for k in ("QB", "RB", "WR", "TE", "C", "DL")}
        if counted["QB"] == 0 or counted["DL"] < 2 or counted["WR"] < 2:
            warnings.append(f"Thin picks for {school}: {counted}")

    # dedupe ids (should not happen)
    seen = set()
    players = [p for p in players if not (p["id"] in seen or seen.add(p["id"]))]
    pool_n = len(players)
    if not (POOL_MIN <= pool_n <= POOL_MAX):
        sys.exit(f"Validation failed: pool size {pool_n} outside {POOL_MIN}-{POOL_MAX}")
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
