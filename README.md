# Snap Count

A daily football player puzzle — eight guesses, nine clues, one player. Independent fan project. Not affiliated with any professional football league or teams.

Play: https://vrilsolutions00.github.io/snap-count/

The GitHub repository is [vrilsolutions00/snap-count](https://github.com/vrilsolutions00/snap-count). The previous name, Gridiron Guess, redirects there.

## Features

- Daily puzzle seeded at midnight Eastern Time (same answer for everyone)
- Clues: Team, Division, Position, Height, Age, Number, Weight, Years, Draft year (UDFA-aware), with up/down arrows
- Difficulty tiers: Starters (default), Stars (top 100 current players by Sleeper search rank, refreshed with the roster), Full
- Hard mode (no Team column), Unlimited, 60-second Speed Round, Pass & Play
- Rookies and Legends packs
- Hints, remaining-candidates list, spoiler-free share grid and share image
- Colorblind mode, keyboard play, PWA / offline, Capacitor-ready `www/`
- Daily / weekly / best-streak leaderboards and optional friend groups (nickname only)

## Data

Player data via [nflverse](https://github.com/nflverse/nflverse-data/), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Live depth and popularity hints come from the public [Sleeper API](https://api.sleeper.app/v1/players/nfl). Official logos and official headshots are not used.

Refresh a local snapshot:

```bash
python3 scripts/refresh_roster.py
```

The refresh script lives at `scripts/refresh_roster.py` and writes `www/data/players.json` and `www/data/puzzles.json` relative to the project root (no hardcoded machine path). After editing `www/`, copy it to `docs/` so classic GitHub Pages stays in sync.

Workflow files in `.github/workflows/` are ready to refresh the roster around 5:00 a.m. Eastern Time and (optionally) deploy with Actions. The first publish uses classic GitHub Pages from the `docs/` folder because the connected GitHub token did not have the `workflow` scope needed to push Actions YAML. After you add the `workflow` scope, commit those files, switch Pages to GitHub Actions, and keep `docs/` in sync with `www/` (or retire `docs/` once the Actions deploy is live). Existing daily answers in `www/data/puzzles.json` are never overwritten, so the archive stays stable.


## Leaderboard

Daily scores are posted with a nickname only. The public board ranks fewest guesses, then fastest server-measured solve time. A device-side lock (localStorage + IndexedDB) keeps the first result of the Eastern Time day; the server enforces the same rule, rejects solves under 3 seconds, and checks a hash of that day's answer.

The backend is a free Supabase project. The client ships only the publishable (anon) key in `www/js/lb.js`. To keep `daily_answers` in sync when future puzzles are generated, set `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` in the environment before running `python3 scripts/refresh_roster.py`. Never commit the service role key. The current puzzle horizon is 365 days ahead and is already seeded.

## App Store

See [APP_STORE_STEPS.md](APP_STORE_STEPS.md). An Apple Developer membership ($99/year) and Xcode are required to submit. Until then, install from Safari with Add to Home Screen.
