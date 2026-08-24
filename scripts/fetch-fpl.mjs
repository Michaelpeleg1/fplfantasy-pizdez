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
  let prevData = {};
  try { prevData = JSON.parse(readFileSync(OUT, "utf-8")); } catch {}
  const prevWinners = prevData.weekly_winners ?? [];
  const POS = { 1: "GKP", 2: "DEF", 3: "MID", 4: "FWD", 5: "AM" };
  const elById = new Map(bootstrap.elements.map((e) => [e.id, e]));
  const teamShort = new Map(bootstrap.teams.map((t) => [t.id, t.short_name]));
  const liveCache = new Map();
  async function getLivePoints(gw) {
    if (!liveCache.has(gw)) {
      const live = await get(`/event/${gw}/live/`);
      liveCache.set(gw, new Map(live.elements.map((e) => [e.id, e.stats?.total_points ?? 0])));
      await sleep(250);
    }
    return liveCache.get(gw);
  }
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
      const livePts = await getLivePoints(ev.id);
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

  // TEAM OF THE WEEK: pool every player STARTED by any league manager this GW
  // (multiplier > 0; bench-boost weeks count all 15), rank by raw player points,
  // solve the best legal XI across all 8 valid FPL formations. Final GWs cached.
  const prevTotw = prevData.totw ?? [];
  const FORMATIONS = [[3,4,3],[3,5,2],[4,3,3],[4,4,2],[4,5,1],[5,2,3],[5,3,2],[5,4,1]];
  const totw = [];
  for (const ev of events.filter((e) => e.finished || e.is_current)) {
    if (!managers.some((m) => m.gws.some((g) => g.gw === ev.id))) continue;
    const cached = prevTotw.find((t) => t.gw === ev.id && t.final);
    if (cached) { totw.push(cached); continue; }
    const livePts = await getLivePoints(ev.id);
    const pool = new Map(); // element id -> {points, owners:Set}
    for (const m of managers) {
      try {
        const picks = await get(`/entry/${m.entry}/event/${ev.id}/picks/`, { optional: true });
        await sleep(200);
        if (!picks) continue;
        for (const p of picks.picks ?? []) {
          if (!(p.multiplier > 0)) continue; // started players only
          if (!pool.has(p.element)) pool.set(p.element, { points: livePts.get(p.element) ?? 0, owners: new Set() });
          pool.get(p.element).owners.add(m.player_name);
        }
      } catch (e) { console.warn(`picks failed for ${m.player_name} GW${ev.id}: ${e.message}`); }
    }
    const byPos = { GKP: [], DEF: [], MID: [], FWD: [] };
    for (const [id, info] of pool) {
      const el = elById.get(id);
      const pos = POS[el?.element_type];
      if (!byPos[pos]) continue; // skip AM chip entries
      byPos[pos].push({ name: el.web_name, club: teamShort.get(el.team) ?? "", pos, points: info.points, owners: [...info.owners] });
    }
    for (const k of Object.keys(byPos)) byPos[k].sort((a, b) => b.points - a.points);
    let best = null;
    for (const [d, mid, f] of FORMATIONS) {
      if (byPos.GKP.length < 1 || byPos.DEF.length < d || byPos.MID.length < mid || byPos.FWD.length < f) continue;
      const xi = [byPos.GKP[0], ...byPos.DEF.slice(0, d), ...byPos.MID.slice(0, mid), ...byPos.FWD.slice(0, f)];
      const total = xi.reduce((s, p) => s + p.points, 0);
      if (!best || total > best.total) best = { formation: `${d}-${mid}-${f}`, total, players: xi };
    }
    if (best) {
      totw.push({ gw: ev.id, final: ev.finished && ev.data_checked, ...best });
      console.log(`TOTW GW${ev.id}: ${best.formation}, ${best.total} pts${ev.finished ? "" : " (live)"}`);
    }
  }

  const snapshot = {
    generated_at: new Date().toISOString(),
    league: { id: LEAGUE_ID, name: league.name },
    current_event: currentEvent,
    events,
    cup: cup ? { ...cup, cup_league: cupLeagueId, matches: cupMatches } : null,
    weekly_winners: weeklyWinners,
    totw,
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
