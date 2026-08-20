# Sprint S1 — Pizdez 2026/27 League Dashboard

**Status:** LOCKED (2026-08-20, approved by Michael)
**Linear project:** https://linear.app/pilotorch/project/pizdez-fpl-dashboard-202627-f221c2705162 (PIL-241…PIL-248)
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
3. **Monthly** — month groups derived from real 2026/27 deadlines (verified
   via bootstrap-static): Aug GW1-2, Sep 3-5, Oct 6-9, Nov 10-12, Dec 13-18,
   Jan 19-23, Feb 24-27, Mar 28-30, Apr 31-33, May 34-38 — computed from
   data.json, never hardcoded
4. **Cup** — FPL built-in cup: qualification tracker (GW33), then live
   bracket from `/api/leagues-h2h-matches/league/{cup_league}/`
5. **Hall of Fame** — past champions: 2024/25 & 2023/24 Roman Samoilenko,
   2022/23 Eliel Hurovich, 2021/22 Evgeny Friedman, 2020/21 Ran Meltzer,
   2019/20 Michael Peleg, 2018/19 Yogev Balilti
6. Header: league name, manager count, GW count; during registration
   window show PayBox + auto-join (code `gkorug`) links

## PRs

| PR | Linear | Title | Priority | Status |
|----|--------|-------|----------|--------|
| PR-1 | PIL-241 | Dashboard SPA (index.html, tabs 1-3+5, config block) | Urgent | open |
| PR-2 | PIL-242 | Data pipeline (fetch-fpl.mjs + GitHub Action cron) | Urgent | open |
| PR-3 | PIL-243 | Prize engine — tie-split rule, config-driven amounts | High | open |
| PR-4 | PIL-244 | Netlify deploy + auto-redeploy on data refresh | High | open |
| PR-5 | PIL-245 | Cup tab — FPL built-in cup (qual GW33, rounds GW34-38) | Medium | open |
| PR-6 | PIL-246 | Chip badges + Hall of Fame content | Medium | open |
| — | PIL-247 | Post-registration: lock roster + final prizes (due 22/08) | High | open |
| — | PIL-248 | Post-GW1 verification: data accuracy check (due 25/08) | Medium | open |

## Research round 2 (answered 2026-08-20)

- **GW→month calendar**: pulled from live bootstrap-static (see Monthly tab
  above). The original app's hardcoded groups were for 2025/26 — ours is
  derived from data.
- **Chips 2026/27**: 8 chips — Wildcard/Free Hit/Bench Boost/Triple Captain,
  one of each per half; first set expires at GW19 deadline (premierleague.com
  official announcement). Entry history API exposes chips played → chip
  badges in Weekly tab (PR-6).
- **Cup**: cup-status API confirms "Pizdez 2026/27 Cup" exists —
  qualification GW33, 32 slots (all managers qualify), random draw, byes,
  rounds GW34-38. Match data via leagues-h2h-matches once cup_league
  activates (404 until then). Dashboard displays FPL's declared winners;
  no tie-break logic on our side.
- **GitHub Actions viability**: community FPL pipelines run on Actions with
  a browser User-Agent (e.g. ARW4/FPL_Project). Residential fetch verified
  working here. Residual risk: FPL 403s some datacenter IPs — first Action
  run is the acceptance test; fallbacks: run locally / Netlify scheduled
  function.
- **Tie rule**: league rule (not FPL's display order) governs prizes —
  tied managers split the sum of prizes their positions span (PIL-243).
- **Prize/pot gap**: prizes total 7,500 vs 6,300 collected at 21 players →
  breakeven 25; amounts are config-only, finalized Friday (PIL-247).

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
- `data/data.json` — generated snapshot (roster, ALL per-GW stats season-to-date, cup)
- `data/history/gw{N}.json` — immutable per-GW archive snapshots (requirement:
  previous round results always stored and accessible in the app)
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
