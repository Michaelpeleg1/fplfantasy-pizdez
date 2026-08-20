// Pizdez 2026/27 — FPL data pipeline (PIL-242)
// Pulls league + per-manager history from the public FPL API into data/data.json,
// and archives immutable per-GW snapshots into data/history/gwN.json.
// Usage: node scripts/fetch-fpl.mjs
import { writeFileSync, readFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const LEAGUE_ID = 237688;
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = join(ROOT, "data");
const HIST_DIR = join(DATA_DIR, "history");
const OUT = join(DATA_DIR, "data.json");

const BASE = "https://fantasy.premierleague.com/api";
const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
  Accept: "application/json",
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(path, { optional = false } = {}) {
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, { headers: HEADERS });
      if (res.status === 404 && optional) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${path}`);
      return await res.json();
    } catch (e) {
      if (attempt === 3) throw e;
      console.warn(`retry ${attempt} for ${path}: ${e.message}`);
      await sleep(1500 * attempt);
    }
  }
}

async function discoverRoster() {
  // Active standings (once season starts) + new_entries (pre-season / late joiners)
  const roster = new Map(); // entry -> {entry, player_name, team_name}
  let page = 1;
  for (;;) {
    const d = await get(`/leagues-classic/${LEAGUE_ID}/standings/?page_standings=${page}&page_new_entries=${page}`);
    for (const r of d.standings?.results ?? []) {
      roster.set(r.entry, { entry: r.entry, player_name: r.player_name, team_name: r.entry_name });
    }
    for (const r of d.new_entries?.results ?? []) {
      if (!roster.has(r.entry)) {
        roster.set(r.entry, {
          entry: r.entry,
          player_name: `${r.player_first_name} ${r.player_last_name}`.trim(),
          team_name: r.entry_name,
        });
      }
    }
    const more = (d.standings?.has_next ?? false) || (d.new_entries?.has_next ?? false);
    if (!more) return { league: d.league, roster: [...roster.values()] };
    page++;
    await sleep(300);
  }
}

async function main() {
  const bootstrap = await get("/bootstrap-static/");
  const events = bootstrap.events.map((e) => ({
    id: e.id,
    deadline_time: e.deadline_time,
    finished: e.finished,
    is_current: e.is_current,
    data_checked: e.data_checked,
  }));
  const currentEvent = events.find((e) => e.is_current)?.id ?? null;

  const { league, roster } = await discoverRoster();
  if (!roster.length) throw new Error("Roster discovery returned 0 managers — aborting, keeping previous data.json");
  console.log(`League "${league.name}" — ${roster.length} managers`);

  const cup = await get(`/league/${LEAGUE_ID}/cup-status/`, { optional: true });
  let cupMatches = null;
  const cupLeagueId = league.cup_league ?? null;
  if (cupLeagueId) {
    cupMatches = [];
    for (let p = 1; ; p++) {
      const m = await get(`/leagues-h2h-matches/league/${cupLeagueId}/?page=${p}`, { optional: true });
      if (!m) break;
      cupMatches.push(...(m.results ?? []));
      if (!m.has_next) break;
      await sleep(300);
    }
  }

  const managers = [];
  for (const r of roster) {
    const h = await get(`/entry/${r.entry}/history/`);
    managers.push({
      ...r,
      gws: (h.current ?? []).map((g) => ({
        gw: g.event,
        points: g.points, // net of hits (FPL reports net)
        total_points: g.total_points,
        transfers: g.event_transfers,
        hit_cost: g.event_transfers_cost,
        bench: g.points_on_bench,
        overall_rank: g.overall_rank,
      })),
      chips: (h.chips ?? []).map((c) => ({ name: c.name, gw: c.event })),
      past: (h.past ?? []).map((p) => ({ season: p.season_name, total: p.total_points, rank: p.rank })),
    });
    await sleep(250);
  }

  // Weekly winner squads: for each finalized GW, fetch the winning manager's picks
  // + live player points. Immutable once fetched — reuse from the previous data.json.
  let prevWinners = [];
  try { prevWinners = JSON.parse(readFileSync(OUT, "utf-8")).weekly_winners ?? []; } catch {}
  const POS = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD", 5: "AM" };
  const elById = new Map(bootstrap.elements.map((e) => [e.id, e]));
  const weeklyWinners = [];
  for (const ev of events.filter((e) => e.finished && e.data_checked)) {
    const cached = prevWinners.find((w) => w.gw === ev.id);
    if (cached) { weeklyWinners.push(cached); continue; }
    let best = null;
    for (const m of managers) {
      const g = m.gws.find((x) => x.gw === ev.id);
      if (!g) continue;
      const net = g.points - (g.hit_cost || 0);
      if (!best || net > best.net) best = { entry: m.entry, name: m.player_name, team: m.team_name, net };
    }
    if (!best) continue;
    try {
      const picks = await get(`/entry/${best.entry}/event/${ev.id}/picks/`);
      await sleep(250);
      const live = await get(`/event/${ev.id}/live/`);
      const livePts = new Map(live.elements.map((e) => [e.id, e.stats?.total_points ?? 0]));
      const squad = (picks.picks ?? []).map((p) => {
        const el = elById.get(p.element);
        return {
          name: el?.web_name ?? `#${p.element}`,
          pos: POS[el?.element_type] ?? "?",
          points: (livePts.get(p.element) ?? 0) * (p.multiplier || (p.position <= 11 ? 1 : 0)),
          raw_points: livePts.get(p.element) ?? 0,
          captain: p.is_captain, vice: p.is_vice_captain,
          bench: p.position > 11, multiplier: p.multiplier,
        };
      });
      weeklyWinners.push({ gw: ev.id, ...best, active_chip: picks.active_chip ?? null, squad });
      console.log(`GW${ev.id} winner squad: ${best.name} (${best.net} pts)`);
      await sleep(250);
    } catch (e) {
      console.warn(`Could not fetch winner squad for GW${ev.id}: ${e.message}`);
    }
  }

  const snapshot = {
    generated_at: new Date().toISOString(),
    league: { id: LEAGUE_ID, name: league.name },
    current_event: currentEvent,
    events,
    cup: cup ? { ...cup, cup_league: cupLeagueId, matches: cupMatches } : null,
    weekly_winners: weeklyWinners,
    managers,
  };

  // Atomic-ish write: tmp then rename, so a crash never truncates good data
  mkdirSync(HIST_DIR, { recursive: true });
  const tmp = OUT + ".tmp";
  writeFileSync(tmp, JSON.stringify(snapshot, null, 1));
  renameSync(tmp, OUT);
  console.log(`Wrote data/data.json (${managers.length} managers, ${events.filter((e) => e.finished).length} finished GWs)`);

  // Immutable per-GW archives: written once when a GW is finished + data_checked
  for (const ev of events.filter((e) => e.finished && e.data_checked)) {
    const f = join(HIST_DIR, `gw${ev.id}.json`);
    if (existsSync(f)) continue;
    const results = managers
      .map((m) => ({ entry: m.entry, name: m.player_name, team: m.team_name, ...(m.gws.find((g) => g.gw === ev.id) ?? {}) }))
      .filter((x) => x.points !== undefined)
      .sort((a, b) => b.points - a.points);
    writeFileSync(f, JSON.stringify({ gw: ev.id, archived_at: new Date().toISOString(), results }, null, 1));
    console.log(`Archived data/history/gw${ev.id}.json (${results.length} rows)`);
  }
}

main().catch((e) => {
  console.error("PIPELINE FAILED:", e.message);
  process.exit(1);
});
