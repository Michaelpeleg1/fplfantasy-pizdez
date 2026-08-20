# Sprint S1 — Pizdez 2026/27 League Dashboard

**Status:** DRAFT (awaiting LOCK)
**Date:** 2026-08-20
**Mode:** ORCH_MODE

## Overview

Clone and adapt the "Benzema Fantasy League Dashboard" (recovered from HAR:
single static HTML page + external data feed) for the **Pizdez 2026/27**
FPL classic league (id 237688, "ליגת הכפכפים", 21+ managers, registration
closes Fri 2026-08-21, GW1 deadline 17:30 UTC same day).

Key architectural change vs. the original: replace the manually-maintained
Google Sheets CSV with an **automated data pipeline** pulling from the free
public FPL API (verified working 2026-08-20: entry history, league
standings, bootstrap-static, cup-status). FPL API sends no CORS headers,
so the browser never calls it directly — a scheduled fetcher writes a
static `data.json` consumed by the page.

### Decisions (made by Michael)
- English UI
- FPL built-in cup ("Pizdez 2026/27 Cup", qualification GW33, random draw,
  byes) — no custom bracket
- Prizes: 1st ₪3,600 / 2nd ₪2,100 / 3rd ₪1,300 / Cup winner ₪500;
  tie on points → winners split their combined prize sum. Config-driven
  (may adjust after final signup count; buy-in ₪300/player).
- No weekly/monthly cash prizes — those tabs are stats-only.

### Tabs (v1)
1. **Standings** — cumulative league table as-of selected GW, prize badges,
   tie-split handling
2. **Weekly** — per-GW winner + runners-up (bragging rights)
3. **Monthly** — month groups per 2026/27 GW calendar, top-5 per month
4. **Cup** — FPL built-in cup: qualification tracker (GW33), then live
   bracket from `/api/leagues-h2h-matches/league/{cup_league}/`
5. **Hall of Fame** — past champions: 2024/25 & 2023/24 Roman Samoilenko,
   2022/23 Eliel Hurovich, 2021/22 Evgeny Friedman, 2020/21 Ran Meltzer,
   2019/20 Michael Peleg, 2018/19 Yogev Balilti
6. Header: league name, manager count, GW count; during registration
   window show PayBox + auto-join (code `gkorug`) links

## PRs

| PR | Title | Scope | Est. LOC | Status |
|----|-------|-------|----------|--------|
| PR-1 | Static dashboard (index.html) | Adapted single-page app: theme, tabs 1–3 + 5, config block (prizes, links), reads `data/data.json` | ~700 | open |
| PR-2 | Data pipeline (fetch-fpl.mjs) | Node script: league standings → roster auto-discovery → per-entry history → `data/data.json`; GitHub Action cron (2× daily) + manual trigger | ~200 | open |
| PR-3 | Cup tab | Qualification tracker pre-GW33; bracket renderer from h2h-matches API once `cup_league` activates | ~150 | open |
| PR-4 | Deploy | Netlify site (drag-free: netlify.toml), Action commits refreshed data.json → auto redeploy | ~30 | open |

## Cost Gate

- **External Calls Added?** Yes — FPL public API (fantasy.premierleague.com).
  Free, unauthenticated, no key.
- **Real Cost Control:** Scheduled fetch only (~22 requests/run, 2 runs/day
  via GitHub Action cron). No browser-side API calls. Snapshot persists if
  FPL is down.
- **Default Behavior:** Cheapest path — static site reads committed JSON.
- **Manual Override Only:** `workflow_dispatch` for on-demand refresh.
- **Verdict: PASS** — zero monetary cost, bounded request volume.

## Files

- `index.html` — dashboard (self-contained CSS/JS, like the original)
- `data/data.json` — generated snapshot (roster, per-GW stats, cup)
- `scripts/fetch-fpl.mjs` — pipeline
- `.github/workflows/refresh-data.yml` — cron + manual trigger
- `netlify.toml` — static deploy config
- `config` block inside index.html (prizes, links, league id)
- `docs/sprints/S1/Plan_Pizdez_Dashboard.md` — this plan
- Reference (not shipped): `extracted_index.html`, `extracted_app.js`,
  `extracted_data.csv`, `famous-pudding-d5e4ca.netlify.app.har`

## Deployment checklist

- [ ] PR-1 dashboard renders with mock/pre-season data.json
- [ ] PR-2 pipeline run against live league; roster matches FPL site
- [ ] After Fri 21/08 registration close: re-run pipeline, confirm final roster
- [ ] GitHub repo created + Action enabled (push requires SHIP)
- [ ] Netlify site connected to repo, deploy verified
- [ ] After GW1 completes: verify points/bench/hits match FPL
- [ ] GW33+: verify cup bracket renders from live cup_league data

## Risks

- FPL API is unofficial: schemas can change between seasons (they did not
  materially change in 3+ years; pipeline fails loudly, snapshot persists).
- Cup `cup_league` id is null until activation near GW33 — PR-3 handles
  both states.
- Prize amounts may change after final signup count — config-only edit.
