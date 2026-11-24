#!/usr/bin/env python3
"""Build and refresh Snap Count player data from nflverse (CC BY 4.0) + Sleeper."""
from __future__ import annotations

import csv
import datetime as dt
import hashlib
import io
import json
import os
import sys
import tempfile
import urllib.request
from collections import defaultdict
from pathlib import Path

SEASON = 2026
LAUNCH = dt.date(2026, 11, 20)
HORIZON_DAYS = 365

NFLVERSE_PLAYERS = "https://github.com/nflverse/nflverse-data/releases/download/players/players.csv"
NFLVERSE_ROSTER = "https://github.com/nflverse/nflverse-data/releases/download/rosters/roster_{season}.csv"
SLEEPER_URL = "https://api.sleeper.app/v1/players/nfl"

ROOT = Path(__file__).resolve().parents[1]
WWW = ROOT / "www"
DATA = WWW / "data"

TEAMS = {
    "ARI": ("Arizona", "AFC"[:0] + "NFC", "West", "#97233F", "#FFB612"),
    "ATL": ("Atlanta", "NFC", "South", "#A71930", "#000000"),
    "BAL": ("Baltimore", "AFC", "North", "#241773", "#9E7C0C"),
    "BUF": ("Buffalo", "AFC", "East", "#00338D", "#C60C30"),
    "CAR": ("Carolina", "NFC", "South", "#0085CA", "#101820"),
    "CHI": ("Chicago", "NFC", "North", "#0B162A", "#C83803"),
    "CIN": ("Cincinnati", "AFC", "North", "#FB4F14", "#000000"),
    "CLE": ("Cleveland", "AFC", "North", "#311D00", "#FF3C00"),
    "DAL": ("Dallas", "NFC", "East", "#003594", "#869397"),
    "DEN": ("Denver", "AFC", "West", "#FB4F14", "#002244"),
    "DET": ("Detroit", "NFC", "North", "#0076B6", "#B0B7BC"),
    "GB": ("Green Bay", "NFC", "North", "#203731", "#FFB612"),
    "HOU": ("Houston", "AFC", "South", "#03202F", "#A71930"),
    "IND": ("Indianapolis", "AFC", "South", "#002C5F", "#A2AAAD"),
    "JAX": ("Jacksonville", "AFC", "South", "#006778", "#9F792C"),
    "KC": ("Kansas City", "AFC", "West", "#E31837", "#FFB81C"),
    "LA": ("Los Angeles", "NFC", "West", "#003594", "#FFA300"),
    "LAC": ("Los Angeles", "AFC", "West", "#0080C6", "#FFC20E"),
    "LV": ("Las Vegas", "AFC", "West", "#000000", "#A5ACAF"),
    "MIA": ("Miami", "AFC", "East", "#008E97", "#FC4C02"),
    "MIN": ("Minnesota", "NFC", "North", "#4F2683", "#FFC62F"),
    "NE": ("New England", "AFC", "East", "#002244", "#C60C30"),
    "NO": ("New Orleans", "NFC", "South", "#101820", "#D3BC8D"),
    "NYG": ("New York", "NFC", "East", "#0B2265", "#A71930"),
    "NYJ": ("New York", "AFC", "East", "#125740", "#FFFFFF"),
    "PHI": ("Philadelphia", "NFC", "East", "#004C54", "#A5ACAF"),
    "PIT": ("Pittsburgh", "AFC", "North", "#101820", "#FFB612"),
    "SEA": ("Seattle", "NFC", "West", "#002244", "#69BE28"),
    "SF": ("San Francisco", "NFC", "West", "#AA0000", "#B3995D"),
    "TB": ("Tampa Bay", "NFC", "South", "#D50A0A", "#322F2B"),
    "TEN": ("Tennessee", "AFC", "South", "#0C2340", "#4B92DB"),
    "WAS": ("Washington", "NFC", "East", "#5A1414", "#FFB612"),
}

# Fix the silly AFC typo above for ARI
TEAMS["ARI"] = ("Arizona", "NFC", "West", "#97233F", "#FFB612")

POS_GROUP = {
    "QB": "QB", "RB": "RB", "FB": "RB", "WR": "WR", "TE": "TE",
    "OL": "OL", "OT": "OL", "OG": "OL", "G": "OL", "C": "OL", "T": "OL",
    "DL": "DL", "DE": "DL", "DT": "DL", "NT": "DL",
    "LB": "LB", "ILB": "LB", "OLB": "LB", "MLB": "LB",
    "DB": "DB", "CB": "DB", "S": "DB", "SS": "DB", "FS": "DB", "SAF": "DB",
    "K": "K", "P": "P", "LS": "LS", "K/P": "K",
}

# Peak-career facts for a curated Legends pack. Overrides are only used for
# iconic team/number when the last-team row would be misleading. Measurables,
# birth date, college, and draft come from nflverse when the gsis_id is set.
LEGENDS = [
    {"id": "00-0019596", "name": "Tom Brady", "team": "NE", "no": 12, "nick": ["TB12"]},
    {"id": "00-0010346", "name": "Peyton Manning", "team": "IND", "no": 18, "nick": ["The Sheriff"]},
    {"id": "00-0020531", "name": "Drew Brees", "team": "NO", "no": 9, "nick": []},
    {"id": "00-0005106", "name": "Brett Favre", "team": "GB", "no": 4, "nick": []},
    {"id": "00-0011493", "name": "Joe Montana", "team": "SF", "no": 16, "nick": ["Joe Cool"]},
    {"id": "00-0010379", "name": "Dan Marino", "team": "MIA", "no": 13, "nick": []},
    {"id": "00-0004884", "name": "John Elway", "team": "DEN", "no": 7, "nick": []},
    {"id": "00-0018441", "name": "Steve Young", "team": "SF", "no": 8, "nick": []},
    {"id": "00-0000104", "name": "Troy Aikman", "team": "DAL", "no": 8, "nick": []},
    {"id": "00-0022924", "name": "Ben Roethlisberger", "team": "PIT", "no": 7, "nick": ["Big Ben"]},
    {"id": "00-0022803", "name": "Eli Manning", "team": "NYG", "no": 10, "nick": []},
    {"id": "00-0027939", "name": "Cam Newton", "team": "CAR", "no": 1, "nick": ["Superman"]},
    {"id": "00-0022942", "name": "Philip Rivers", "team": "LAC", "no": 17, "nick": []},
    {"id": "00-0026143", "name": "Matt Ryan", "team": "ATL", "no": 2, "nick": ["Matty Ice"]},
    {"id": "leg-vick", "name": "Michael Vick", "team": "ATL", "no": 7, "pos": "QB",
     "ht": 72, "wt": 215, "bd": "1980-06-26", "college": "Virginia Tech", "yoe": 13,
     "dy": 2001, "dr": 1, "dp": 1, "first": "Michael", "last": "Vick", "nick": []},
    {"id": "00-0013639", "name": "Jerry Rice", "team": "SF", "no": 80, "nick": []},
    {"id": "00-0011754", "name": "Randy Moss", "team": "MIN", "no": 84, "nick": []},
    {"id": "00-0025389", "name": "Calvin Johnson", "team": "DET", "no": 81, "nick": ["Megatron"]},
    {"id": "00-0022921", "name": "Larry Fitzgerald", "team": "ARI", "no": 11, "nick": ["Fitz"]},
    {"id": "00-0012478", "name": "Terrell Owens", "team": "SF", "no": 81, "nick": ["T.O.", "TO"]},
    {"id": "00-0022044", "name": "Andre Johnson", "team": "HOU", "no": 81, "nick": []},
    {"id": "00-0020337", "name": "Steve Smith", "team": "CAR", "no": 89, "nick": ["Steve Smith Sr."]},
    {"id": "00-0014313", "name": "Barry Sanders", "team": "DET", "no": 20, "nick": []},
    {"id": "00-0015165", "name": "Emmitt Smith", "team": "DAL", "no": 22, "nick": []},
    {"id": "PAY738296", "name": "Walter Payton", "team": "CHI", "no": 34, "nick": ["Sweetness"]},
    {"id": "00-0020536", "name": "LaDainian Tomlinson", "team": "LAC", "no": 21, "nick": ["LT"]},
    {"id": "00-0025394", "name": "Adrian Peterson", "team": "MIN", "no": 28, "nick": ["AP", "All Day"]},
    {"id": "00-0025399", "name": "Marshawn Lynch", "team": "SEA", "no": 24, "nick": ["Beast Mode"]},
    {"id": "JAC631960", "name": "Bo Jackson", "team": "LV", "no": 34, "nick": []},
    {"id": "00-0027656", "name": "Rob Gronkowski", "team": "NE", "no": 87, "nick": ["Gronk"]},
    {"id": "00-0006101", "name": "Tony Gonzalez", "team": "KC", "no": 88, "nick": []},
    {"id": "00-0009889", "name": "Ray Lewis", "team": "BAL", "no": 52, "pos": "LB", "nick": []},
    {"id": "00-0016128", "name": "Lawrence Taylor", "team": "NYG", "no": 56, "pos": "LB", "nick": ["L.T."]},
    {"id": "00-0019456", "name": "Brian Urlacher", "team": "CHI", "no": 54, "pos": "LB", "nick": []},
    {"id": "00-0014619", "name": "Junior Seau", "team": "LAC", "no": 55, "pos": "LB", "nick": []},
    {"id": "00-0029248", "name": "Luke Kuechly", "team": "CAR", "no": 59, "pos": "LB", "nick": []},
    {"id": "00-0017567", "name": "Reggie White", "team": "PHI", "no": 92, "pos": "DL", "nick": ["Minister of Defense"]},
    {"id": "00-0027949", "name": "J.J. Watt", "team": "HOU", "no": 99, "pos": "DL", "nick": ["JJ Watt"]},
    {"id": "00-0015795", "name": "Michael Strahan", "team": "NYG", "no": 92, "pos": "DL", "nick": []},
    {"id": "00-0021140", "name": "Julius Peppers", "team": "CAR", "no": 90, "pos": "DL", "nick": []},
    {"id": "00-0022119", "name": "Troy Polamalu", "team": "PIT", "no": 43, "pos": "DB", "nick": []},
    {"id": "00-0021377", "name": "Ed Reed", "team": "BAL", "no": 20, "pos": "DB", "nick": []},
    {"id": "00-0014324", "name": "Deion Sanders", "team": "ATL", "no": 21, "pos": "DB", "nick": ["Prime Time", "Neon Deion", "Prime"]},
    {"id": "00-0018227", "name": "Charles Woodson", "team": "LV", "no": 24, "pos": "DB", "nick": []},
    {"id": "00-0000585", "name": "Champ Bailey", "team": "DEN", "no": 24, "pos": "DB", "nick": []},
    {"id": "00-0025401", "name": "Darrelle Revis", "team": "NYJ", "no": 24, "pos": "DB", "nick": ["Revis Island"]},
    {"id": "00-0028129", "name": "Jason Kelce", "team": "PHI", "no": 62, "pos": "OL", "nick": []},
    {"id": "00-0025390", "name": "Joe Thomas", "team": "CLE", "no": 73, "pos": "OL", "nick": []},
]

# Ambiguous nicknames (LT) are attached to one legend only if the other pack
# cannot contain them. Live-roster nicknames go in LIVE_NICKNAMES.
LIVE_NICKNAMES = {
    "Christian McCaffrey": ["CMC"],
    "Amon-Ra St. Brown": ["Sun God", "Amon-Ra", "St. Brown", "St Brown"],
    "CeeDee Lamb": ["CeeDee", "CD Lamb"],
    "Puka Nacua": ["Puka"],
    "Derrick Henry": ["King Henry"],
    "Tyreek Hill": ["Cheetah"],
    "Brock Purdy": ["Mr. Irrelevant", "Purdy"],
    "Lamar Jackson": ["Action Jackson"],
    "Patrick Mahomes": ["Mahomes", "Pat Mahomes"],
    "Justin Jefferson": ["Jettas"],
    "Ja'Marr Chase": ["Ja'Marr", "Jamarr Chase"],
    "Ahmad Gardner": ["Sauce", "Sauce Gardner"],
    "Travis Kelce": ["Kelce"],
    "George Kittle": ["Kittle"],
    "Saquon Barkley": ["Saquon"],
    "Bijan Robinson": ["Bijan"],
    "Jahmyr Gibbs": ["Gibbs"],
    "Jayden Daniels": ["JD5"],
    "Brock Bowers": ["Bowers"],
    "Joe Burrow": ["Burrow", "Joe Shiesty"],
    "Jalen Hurts": ["Hurts"],
    "Josh Allen": ["Josh Allen"],
    "Caleb Williams": ["Caleb"],
    "Drake Maye": ["Maye"],
    "Bo Nix": ["Nix"],
    "C.J. Stroud": ["CJ Stroud", "Stroud"],
    "Ashton Jeanty": ["Jeanty"],
    "Justin Herbert": ["Herbert"],
    "Micah Parsons": ["Micah"],
    "T.J. Watt": ["TJ Watt"],
    "Maxx Crosby": ["Crosby"],
    "Davante Adams": ["Tae"],
    "A.J. Brown": ["AJ Brown"],
    "Tee Higgins": ["Tee"],
    "Nico Collins": ["Nico"],
    "Rashee Rice": ["Rashee"],
    "James Cook III": ["James Cook"],
    "De'Von Achane": ["Achane"],
    "Jonathan Taylor": ["JT"],
}


def download(url: str) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "SnapCount/1.0 (fan project; +https://github.com/vrilsolutions00/snap-count)"})
    with urllib.request.urlopen(req, timeout=120) as res:
        return res.read()


def load_csv_bytes(blob: bytes) -> list[dict]:
    text = blob.decode("utf-8", errors="replace")
    return list(csv.DictReader(io.StringIO(text)))


def primary_college(raw: str | None) -> str | None:
    if not raw:
        return None
    part = raw.split(";")[0].strip()
    return part or None


def to_int(val, default=None):
    if val is None or val == "":
        return default
    try:
        return int(float(str(val).strip()))
    except ValueError:
        return default


def fnv1a(s: str) -> int:
    h = 2166136261
    for ch in s.encode("utf-8"):
        h ^= ch
        h = (h * 16777619) & 0xFFFFFFFF
    return h


def pick_id(ids: list[str], seed: str) -> str:
    """Uniform pick from sorted ids (legacy, no exclusions)."""
    ordered = sorted(ids)
    return ordered[fnv1a(seed) % len(ordered)]


NO_REPEAT_DAYS = 60

STAR_POOL_SIZE = 100


def assign_star_flags(players: list[dict], size: int = STAR_POOL_SIZE) -> list[str]:
    """Mark exactly `size` current players as Stars via Sleeper search_rank.

    `_rank` is Sleeper search_rank (lower is better), already attached by the
    roster build. Players without a rank sort last and are only used to fill
    if fewer than `size` ranked players remain. Returns the chosen ids.
    """
    def sort_key(rec: dict):
        rank = rec.get("_rank")
        # Missing ranks go after any real rank.
        rank_key = rank if isinstance(rank, int) else 10**9
        return (rank_key, rec.get("last") or "", rec.get("first") or "", rec["id"])

    ranked = sorted(players, key=sort_key)
    chosen = {rec["id"] for rec in ranked[:size]}
    for rec in players:
        rec["star"] = rec["id"] in chosen
    return [rec["id"] for rec in ranked[:size]]




def pick_uniform(ids: list[str], seed: str, excluded: set[str] | None = None) -> str:
    """Uniform date-hash pick. Avoids excluded ids when any candidates remain.

    If the last-60-day window empties the pool (small packs like Legends),
    relax the window to len(pool)-1 so a repeat only happens when it must.
    """
    ordered = sorted(set(ids))
    excluded = excluded or set()
    candidates = [i for i in ordered if i not in excluded]
    if not candidates:
        # Keep as much of the no-repeat window as the pool size allows.
        if len(ordered) > 1:
            # excluded is a set, no order — caller should pass a sufficient window
            candidates = ordered
        else:
            candidates = ordered
    return candidates[fnv1a(seed) % len(candidates)]


def player_record(base: dict) -> dict:
    return {
        "id": base["id"],
        "name": base["name"],
        "first": base["first"],
        "last": base["last"],
        "team": base["team"],
        "pos": base["pos"],
        "no": base["no"],
        "ht": base["ht"],
        "wt": base["wt"],
        "bd": base["bd"],
        "college": base.get("college"),
        "yoe": base["yoe"],
        "dy": base.get("dy"),
        "dr": base.get("dr"),
        "dp": base.get("dp"),
        "udfa": bool(base.get("udfa")),
        "starter": bool(base.get("starter")),
        "star": bool(base.get("star")),
        "rookie": bool(base.get("rookie")),
        "active": bool(base.get("active", True)),
        "pack": base.get("pack", "live"),
        "nick": base.get("nick") or [],
    }


def complete(p: dict) -> bool:
    needed = [p.get("id"), p.get("name"), p.get("team"), p.get("pos"), p.get("no"),
              p.get("ht"), p.get("wt"), p.get("bd"), p.get("yoe")]
    if any(v is None or v == "" for v in needed):
        return False
    if p["team"] not in TEAMS:
        return False
    if p["pos"] not in {"QB", "RB", "WR", "TE", "OL", "DL", "LB", "DB", "K", "P", "LS"}:
        return False
    if not (0 <= int(p["no"]) <= 99):
        return False
    if not (60 <= int(p["ht"]) <= 90):
        return False
    if not (150 <= int(p["wt"]) <= 400):
        return False
    if p.get("udfa"):
        return True
    return p.get("dy") is not None


def build(cache_dir: Path | None = None) -> dict:
    cache_dir = cache_dir or Path(os.environ.get("GG_CACHE", "/workspace/gg-data"))
    cache_dir.mkdir(parents=True, exist_ok=True)

    def cached(path: Path, url: str) -> bytes:
        if path.exists() and path.stat().st_size > 0 and os.environ.get("GG_USE_CACHE", "1") == "1":
            return path.read_bytes()
        print(f"Downloading {url}", file=sys.stderr)
        blob = download(url)
        path.write_bytes(blob)
        return blob

    season = int(os.environ.get("GG_SEASON", SEASON))
    roster_url = NFLVERSE_ROSTER.format(season=season)
    try:
        roster_blob = cached(cache_dir / f"roster_{season}.csv", roster_url) if (cache_dir / "rosters.csv").exists() is False else None
    except Exception:
        roster_blob = None

    # Prefer the already-fetched official filenames when present.
    if (cache_dir / "rosters.csv").exists():
        roster_rows = load_csv_bytes((cache_dir / "rosters.csv").read_bytes())
    else:
        if roster_blob is None:
            roster_blob = download(roster_url)
            (cache_dir / f"roster_{season}.csv").write_bytes(roster_blob)
        roster_rows = load_csv_bytes(roster_blob)

    if (cache_dir / "players.csv").exists():
        player_rows = load_csv_bytes((cache_dir / "players.csv").read_bytes())
    else:
        player_rows = load_csv_bytes(cached(cache_dir / "players.csv", NFLVERSE_PLAYERS))

    if (cache_dir / "sleeper.json").exists():
        sleeper = json.loads((cache_dir / "sleeper.json").read_text())
    else:
        sleeper = json.loads(cached(cache_dir / "sleeper.json", SLEEPER_URL).decode("utf-8"))

    by_player = {r["gsis_id"]: r for r in player_rows if r.get("gsis_id")}

    sleeper_by_id = {str(k): v for k, v in sleeper.items() if v}
    sleeper_by_gsis = {}
    for v in sleeper_by_id.values():
        if v.get("gsis_id"):
            sleeper_by_gsis[v["gsis_id"]] = v

    # One row per player already in this roster release.
    live_src = [r for r in roster_rows if r.get("gsis_id") and r.get("status") in {"ACT", "RES", "INA"}]
    built = []
    dropped = []
    for r in live_src:
        ident = r["gsis_id"]
        meta = by_player.get(ident, {})
        sl = None
        if r.get("sleeper_id"):
            sl = sleeper_by_id.get(str(r["sleeper_id"]))
        if sl is None:
            sl = sleeper_by_gsis.get(ident)

        raw_j = r.get("jersey_number")
        jersey = to_int(raw_j) if (raw_j is not None and str(raw_j).strip() != "") else None
        if jersey is None and sl and sl.get("number") not in (None, "", 0, "0"):
            jersey = to_int(sl.get("number"))
        if jersey is None:
            raw_m = meta.get("jersey_number")
            if raw_m is not None and str(raw_m).strip() != "":
                jersey = to_int(raw_m)
        ht = to_int(r.get("height")) or to_int(meta.get("height"))
        wt = to_int(r.get("weight")) or to_int(meta.get("weight"))
        bd = (r.get("birth_date") or meta.get("birth_date") or "").strip() or None
        college = primary_college(r.get("college") or meta.get("college_name") or (sl or {}).get("college"))
        yoe = to_int(r.get("years_exp"), None)
        if yoe is None:
            yoe = to_int(meta.get("years_of_experience"), None)
        pos = POS_GROUP.get((r.get("position") or "").upper())
        team = r.get("team")
        dy = to_int(meta.get("draft_year"))
        dr = to_int(meta.get("draft_round"))
        dp = to_int(meta.get("draft_pick"))
        udfa = dy is None or dr is None
        if udfa:
            dy = None
            dr = None
            dp = None

        rank = to_int((sl or {}).get("search_rank"))
        dorder = to_int((sl or {}).get("depth_chart_order"))
        starter = dorder == 1
        rookie = yoe == 0 or to_int(r.get("rookie_year")) == season

        name = r.get("full_name") or r.get("football_name") or f"{r.get('first_name','')} {r.get('last_name','')}".strip()
        first = r.get("first_name") or name.split(" ")[0]
        last = r.get("last_name") or name.split(" ")[-1]
        nick = list(LIVE_NICKNAMES.get(name, []))
        # Sauce Gardner may be stored as Ahmad Gardner
        if "Gardner" in last and name not in LIVE_NICKNAMES:
            if "sauce" in name.lower() or (sl and "sauce" in (sl.get("first_name") or "").lower()):
                nick = ["Sauce", "Sauce Gardner"]

        rec = player_record({
            "id": ident,
            "name": name,
            "first": first,
            "last": last,
            "team": team,
            "pos": pos,
            "no": jersey,
            "ht": ht,
            "wt": wt,
            "bd": bd,
            "college": college,
            "yoe": yoe,
            "dy": dy,
            "dr": dr,
            "dp": dp,
            "udfa": udfa,
            "starter": starter,
            "star": False,
            "rookie": bool(rookie),
            "active": True,
            "pack": "live",
            "nick": nick,
        })
        rec["_rank"] = rank
        if complete(rec):
            built.append(rec)
        else:
            dropped.append((name, team, rec.get("pos"), jersey, "missing fields"))

    # Stars: exactly the top 100 current players by Sleeper search_rank
    # (lower is more popular / relevant). Retired or cut players drop off
    # on refresh and the list is refilled to 100. Ties break by name, then id.
    assign_star_flags(built)
    for rec in built:
        rec.pop("_rank", None)

    live_ids = {p["id"] for p in built}

    # Legends: skip anyone still on the live snapshot.
    legends = []
    for spec in LEGENDS:
        if spec["id"] in live_ids and not str(spec["id"]).startswith("leg-"):
            print(f"Skipping legend {spec['name']} — still on the live roster", file=sys.stderr)
            continue
        meta = by_player.get(spec["id"], {})
        if spec["id"].startswith("leg-"):
            pos = spec["pos"]
            rec = player_record({
                "id": spec["id"],
                "name": spec["name"],
                "first": spec["first"],
                "last": spec["last"],
                "team": spec["team"],
                "pos": pos,
                "no": spec["no"],
                "ht": spec["ht"],
                "wt": spec["wt"],
                "bd": spec["bd"],
                "college": spec["college"],
                "yoe": spec["yoe"],
                "dy": spec.get("dy"),
                "dr": spec.get("dr"),
                "dp": spec.get("dp"),
                "udfa": spec.get("dy") is None,
                "starter": True,
                "star": True,
                "rookie": False,
                "active": False,
                "pack": "legends",
                "nick": spec.get("nick") or [],
            })
        else:
            pos = spec.get("pos") or POS_GROUP.get((meta.get("position") or "").upper())
            college = primary_college(meta.get("college_name"))
            dy = to_int(meta.get("draft_year"))
            dr = to_int(meta.get("draft_round"))
            dp = to_int(meta.get("draft_pick"))
            udfa = dy is None or dr is None
            rec = player_record({
                "id": spec["id"],
                "name": spec["name"],
                "first": (meta.get("first_name") or spec["name"].split(" ")[0]),
                "last": (meta.get("last_name") or spec["name"].split(" ")[-1]),
                "team": spec["team"],
                "pos": pos,
                "no": spec["no"],
                "ht": to_int(meta.get("height")) or spec.get("ht"),
                "wt": to_int(meta.get("weight")) or spec.get("wt"),
                "bd": (meta.get("birth_date") or spec.get("bd") or "").strip() or None,
                "college": college or spec.get("college"),
                "yoe": to_int(meta.get("years_of_experience")) or spec.get("yoe"),
                "dy": None if udfa else dy,
                "dr": None if udfa else dr,
                "dp": None if udfa else dp,
                "udfa": udfa,
                "starter": True,
                "star": True,
                "rookie": False,
                "active": False,
                "pack": "legends",
                "nick": spec.get("nick") or [],
            })
        if complete(rec):
            legends.append(rec)
        else:
            print(f"Dropping incomplete legend {spec['name']}: {rec}", file=sys.stderr)

    # Merge previously baked players so archive answers never disappear.
    existing_path = DATA / "players.json"
    if existing_path.exists():
        try:
            old = json.loads(existing_path.read_text())
            old_by_id = {p["id"]: p for p in old.get("players", [])}
            new_ids = {p["id"] for p in built + legends}
            for oid, op in old_by_id.items():
                if oid not in new_ids:
                    op["active"] = False
                    built.append(op)
        except Exception as exc:
            print(f"Could not merge existing players.json: {exc}", file=sys.stderr)

    as_of = dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    teams_out = {
        abbr: {
            "abbr": abbr,
            "display": "LAR" if abbr == "LA" else abbr,
            "city": city,
            "conf": conf,
            "div": div,
            "c1": c1,
            "c2": c2,
        }
        for abbr, (city, conf, div, c1, c2) in TEAMS.items()
    }

    active_live = [p for p in built if p.get("pack") != "legends" and p.get("active", True)]
    payload = {
        "season": season,
        "asOf": as_of,
        "source": "nflverse",
        "license": "CC-BY-4.0",
        "sourceUrl": "https://github.com/nflverse/nflverse-data/",
        "sleeperUrl": "https://api.sleeper.app/v1/players/nfl",
        "attribution": "Player data via nflverse, licensed CC BY 4.0, with live popularity and depth hints from the public Sleeper API. This game is an independent fan project and is not affiliated with the NFL or any team.",
        "teams": teams_out,
        "players": built + legends,
        "counts": {
            "full": len(active_live),
            "starters": sum(1 for p in active_live if p["starter"]),
            "stars": sum(1 for p in active_live if p["star"]),
            "rookies": sum(1 for p in active_live if p["rookie"]),
            "legends": len(legends),
            "dropped": len(dropped),
        },
    }

    # Frozen daily answers: never overwrite a date that already exists.
    puzzles_path = DATA / "puzzles.json"
    puzzles = {}
    if puzzles_path.exists():
        try:
            puzzles = json.loads(puzzles_path.read_text())
        except Exception:
            puzzles = {}

    pools = {
        "stars": [p["id"] for p in active_live if p["star"]],
        "starters": [p["id"] for p in active_live if p["starter"]],
        "full": [p["id"] for p in active_live],
        # Hard answers use the default Starters pool (uniform, no popularity weight).
        "hard": [p["id"] for p in active_live if p["starter"]],
        "rookies": [p["id"] for p in active_live if p["rookie"]],
        "legends": [p["id"] for p in legends],
    }
    # App uses America/New_York for the live date; this is only the generator cutoff.
    try:
        from zoneinfo import ZoneInfo
        today = dt.datetime.now(ZoneInfo("America/New_York")).date()
    except Exception:
        today = dt.datetime.now(dt.timezone(dt.timedelta(hours=-5))).date()
    start = LAUNCH
    end = max(today + dt.timedelta(days=HORIZON_DAYS), LAUNCH + dt.timedelta(days=HORIZON_DAYS))
    d = start
    filled = 0
    rewritten = 0
    while d <= end:
        key = d.isoformat()
        # Never change a past or current day's published answers.
        if key in puzzles and d <= today:
            d += dt.timedelta(days=1)
            continue
        day_num = (d - LAUNCH).days + 1
        entry = {"n": day_num}
        for pool_name, ids in pools.items():
            if not ids:
                continue
            excluded = []
            for back in range(1, NO_REPEAT_DAYS + 1):
                prev = (d - dt.timedelta(days=back)).isoformat()
                if prev in puzzles and pool_name in puzzles[prev]:
                    excluded.append(puzzles[prev][pool_name])
            # Prefer a 60-day window; if that empties a small pool, keep the
            # most recent (len(pool)-1) exclusions so a repeat is last resort.
            excl_set = set(excluded)
            ordered = sorted(set(ids))
            if not [i for i in ordered if i not in excl_set] and len(ordered) > 1:
                excl_set = set(excluded[: len(ordered) - 1])
            entry[pool_name] = pick_uniform(ids, f"gridiron-guess|{key}|{pool_name}", excl_set)
        existed = key in puzzles
        puzzles[key] = entry
        filled += 1
        if existed:
            rewritten += 1
        d += dt.timedelta(days=1)

    prev_counts = None
    existing = DATA / "players.json"
    if existing.exists():
        try:
            prev_counts = json.loads(existing.read_text()).get("counts")
        except Exception:
            prev_counts = None
    validate_counts(payload["counts"], prev_counts if isinstance(prev_counts, dict) else None)

    DATA.mkdir(parents=True, exist_ok=True)
    tmp = DATA / "players.json.tmp"
    tmp.write_text(json.dumps(payload, separators=(",", ":"), ensure_ascii=False))
    tmp.replace(DATA / "players.json")
    tmp = DATA / "puzzles.json.tmp"
    tmp.write_text(json.dumps(puzzles, separators=(",", ":"), ensure_ascii=False))
    tmp.replace(DATA / "puzzles.json")

    print(json.dumps({
        "asOf": as_of,
        "counts": payload["counts"],
        "puzzlesFilled": filled, "puzzlesRewrittenFuture": rewritten,
        "droppedSample": dropped[:8],
    }, indent=2))
    synced = sync_daily_answers(puzzles)
    if synced is not None:
        print(json.dumps({"dailyAnswersSynced": synced}, indent=2))
    return payload



def validate_counts(counts: dict, previous: dict | None) -> None:
    """Fail the refresh if pool sizes look broken.

    Stars is a fixed top-100 list (STAR_POOL_SIZE). A drop from a legacy
    larger Stars list down to exactly 100 is expected and must pass.
    """
    errors = []
    stars = int(counts.get("stars") or 0)
    if stars != STAR_POOL_SIZE:
        errors.append(f"stars is {stars}, expected exactly {STAR_POOL_SIZE}")
    full = int(counts.get("full") or 0)
    if not (1700 <= full <= 2500):
        errors.append(f"full roster {full} is outside 1700-2500")
    starters = int(counts.get("starters") or 0)
    if not (400 <= starters <= 800):
        errors.append(f"starters {starters} is outside 400-800")
    if previous:
        for key, limit in (("full", 0.15), ("starters", 0.15), ("rookies", 0.25)):
            old = int(previous.get(key) or 0)
            new = int(counts.get(key) or 0)
            if old and new and abs(new - old) / old > limit:
                errors.append(f"{key} changed from {old} to {new}")
        old_stars = int(previous.get("stars") or 0)
        new_stars = int(counts.get("stars") or 0)
        if old_stars and new_stars != STAR_POOL_SIZE:
            errors.append(f"stars changed from {old_stars} to {new_stars}")
    if errors:
        raise SystemExit("Roster validation failed: " + "; ".join(errors))


def sync_daily_answers(puzzles: dict) -> dict | None:
    """Upsert future+current daily answer hashes to Supabase.

    Requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment.
    The service role key must never be committed. Without the env vars this
    is a no-op so a local or Actions roster refresh still succeeds.
    Hashes are computed server-side from the answer id; raw ids are sent
    only over HTTPS to the admin RPC and are not stored in a public table.
    """
    url = (os.environ.get("SUPABASE_URL") or "").rstrip("/")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or ""
    if not url or not key:
        print(
            "Note: daily_answers were not synced. Set SUPABASE_URL and "
            "SUPABASE_SERVICE_ROLE_KEY to keep the leaderboard answer table "
            "in sync (seed is already loaded through the current puzzle horizon)."
        )
        return None
    endpoint = url + "/rest/v1/rpc/admin_upsert_daily_answer"
    headers = {
        "apikey": key,
        "Authorization": "Bearer " + key,
        "Content-Type": "application/json",
    }
    ok = 0
    failed = 0
    for day, entry in puzzles.items():
        if not isinstance(entry, dict):
            continue
        for tier in ("stars", "starters", "full", "hard", "rookies", "legends"):
            aid = entry.get(tier)
            if not aid:
                continue
            body = json.dumps({"p_date": day, "p_tier": tier, "p_answer_id": aid}).encode()
            req = urllib.request.Request(endpoint, data=body, headers=headers, method="POST")
            try:
                with urllib.request.urlopen(req, timeout=20) as resp:
                    resp.read()
                ok += 1
            except Exception as exc:
                failed += 1
                if failed <= 5:
                    print("daily_answers sync error", day, tier, exc)
    return {"ok": ok, "failed": failed}


if __name__ == "__main__":
    build()
