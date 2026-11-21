# Gridiron Guess

A daily football player puzzle — eight guesses, nine clues, one player. Independent fan project. Not affiliated with any professional football league or teams.

Play: the public GitHub Pages URL is published after the first deploy from this repository.

## Features

- Daily puzzle seeded at midnight Eastern Time (same answer for everyone)
- Clues: Team, Division, Position, Height, Age, Number, Weight, Years, Draft year (UDFA-aware), with up/down arrows
- Difficulty tiers: Stars (default), Starters, Full
- Hard mode (no Team column), Unlimited, 60-second Speed Round, Pass & Play
- Rookies and Legends packs
- Hints, remaining-candidates list, spoiler-free share grid and share image
- Colorblind mode, keyboard play, PWA / offline, Capacitor-ready `www/`

## Data

Player data via [nflverse](https://github.com/nflverse/nflverse-data/), licensed [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Live depth and popularity hints come from the public [Sleeper API](https://api.sleeper.app/v1/players/nfl). Official logos and official headshots are not used.

Refresh a local snapshot:

```bash
python3 scripts/refresh_roster.py
```

A GitHub Action runs the same script around 5:00 a.m. Eastern Time and commits an updated snapshot. Existing daily answers in `www/data/puzzles.json` are never overwritten, so the archive stays stable.

## App Store

See [APP_STORE_STEPS.md](APP_STORE_STEPS.md). An Apple Developer membership ($99/year) and Xcode are required to submit. Until then, install from Safari with Add to Home Screen.
