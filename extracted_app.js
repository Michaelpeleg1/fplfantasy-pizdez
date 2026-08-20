
const SHEET_CSV_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vRIZ-iVKKiAsoOGSdyfdea6xk9FpyETU2Pn4hOWKwPUTNTIVua-KQEmhziYf3cbN5hQxQUQHLfsrBXf/pub?gid=0&single=true&output=csv";
const WEEKLY_PRIZE = 25;

const LEAGUE_PRIZES = [2200, 1400, 850, 600, 400];
const SH_PRIZES = [600, 400, 250];

const MONTH_GROUPS = [
  { label:"August", gws:[1,2,3] }, { label:"September", gws:[4,5,6,7] },
  { label:"October", gws:[8,9,10,11] }, { label:"November", gws:[12,13,14,15] },
  { label:"December", gws:[16,17,18,19] }, { label:"January", gws:[20,21,22,23] },
  { label:"February", gws:[24,25,26,27] }, { label:"March", gws:[28,29,30] },
  { label:"April", gws:[31,32,33,34,35] }, { label:"May", gws:[36,37,38] },
];

let players = [], gameweeks = [];
let weeklyPage = 0;
const PAGE_SIZE = 12;

// Parse score: "45 (49)" => net=45, tookHit=true; "55" => net=55, tookHit=false
function parseScoreFull(raw) {
  if (!raw || raw.trim() === "") return null;
  const s = raw.trim();
  const m = s.match(/^(\d+)\s*\((\d+)\)/);
  if (m) return { net: parseInt(m[1]), tookHit: true };
  const n = parseInt(s);
  return isNaN(n) ? null : { net: n, tookHit: false };
}

function parseScore(raw) {
  const r = parseScoreFull(raw);
  return r ? r.net : null;
}

function parseCSVText(text) {
  const lines = text.trim().split(/\r?\n/);
  const parseRow = line => {
    const cols = []; let cur = ""; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; }
      else if (c === ',' && !inQ) { cols.push(cur.trim()); cur = ""; }
      else { cur += c; }
    }
    cols.push(cur.trim());
    return cols;
  };
  const headers = parseRow(lines[0]);
  return lines.slice(1).map(line => {
    const cols = parseRow(line);
    const obj = {};
    headers.forEach((h,i) => obj[h] = cols[i] ?? "");
    return obj;
  }).filter(r => r["Name"] && r["Name"].trim());
}

function medal(rank) {
  if (rank === 1) return "🥇";
  if (rank === 2) return "🥈";
  if (rank === 3) return "🥉";
  return `<span style="color:#f0e6f6;font-weight:700">${rank}</span>`;
}

function prizeBadge(amount) {
  if (!amount) return "";
  return `<span class="prize-badge">₪${amount.toLocaleString()}</span>`;
}

// Compute prize allocations for standings + second half with no-double-prize rule
function computePrizes(leagueRows, shRows) {
  // leagueRows and shRows are sorted arrays of {name, ...}
  // LEAGUE prizes: positions 1-5 => LEAGUE_PRIZES
  // SH prizes: positions 1-3 => SH_PRIZES
  // Rule: no double prizes. If a player is in both, give them the bigger prize
  // and cascade the smaller prize to the next eligible player.

  const leaguePrizes = [...LEAGUE_PRIZES]; // [2200,1400,850,600,400]
  const shPrizes = [...SH_PRIZES]; // [600,400,250]

  // Build initial assignments
  // league: top 5
  const leagueAssign = {}; // name -> prize
  const shAssign = {}; // name -> prize

  leagueRows.slice(0, leaguePrizes.length).forEach((r, i) => {
    leagueAssign[r.name] = leaguePrizes[i];
  });
  shRows.slice(0, shPrizes.length).forEach((r, i) => {
    shAssign[r.name] = shPrizes[i];
  });

  // Find conflicts: players in both
  const conflicts = Object.keys(leagueAssign).filter(n => shAssign[n] !== undefined);

  for (const name of conflicts) {
    const lp = leagueAssign[name];
    const sp = shAssign[name];
    if (lp >= sp) {
      // Keep league prize, remove from SH, cascade SH prize down
      delete shAssign[name];
      // find next SH player not in leagueAssign or shAssign
      let pos = shRows.findIndex(r => r.name === name);
      // find next eligible
      for (let i = pos + 1; i < shRows.length; i++) {
        const candidate = shRows[i].name;
        if (!shAssign[candidate] && !leagueAssign[candidate]) {
          shAssign[candidate] = sp;
          break;
        } else if (!shAssign[candidate] && leagueAssign[candidate]) {
          // also in league, skip and continue cascade
          continue;
        }
      }
    } else {
      // Keep SH prize, remove from league, cascade league prize down
      delete leagueAssign[name];
      let pos = leagueRows.findIndex(r => r.name === name);
      for (let i = pos + 1; i < leagueRows.length; i++) {
        const candidate = leagueRows[i].name;
        if (!leagueAssign[candidate] && !shAssign[candidate]) {
          leagueAssign[candidate] = lp;
          break;
        } else if (!leagueAssign[candidate] && shAssign[candidate]) {
          continue;
        }
      }
    }
  }

  return { leagueAssign, shAssign };
}

// ---- CUP DATA ----
const CUP_GAMES = {"1":{"num":1,"round":"PRELIMINARY ROUND","gw":9,"home":"Michael P.","away":"Kfir Emmer","home_score":43,"away_score":54,"winner":"Kfir Emmer","loser":"Michael P.","played":true},"2":{"num":2,"round":"PRELIMINARY ROUND","gw":9,"home":"Elad Kainer","away":"Yogev Balilti","home_score":36,"away_score":80,"winner":"Yogev Balilti","loser":"Elad Kainer","played":true},"3":{"num":3,"round":"PRELIMINARY ROUND","gw":9,"home":"Guy Tash","away":"Tal Avraham","home_score":53,"away_score":28,"winner":"Guy Tash","loser":"Tal Avraham","played":true},"4":{"num":4,"round":"PRELIMINARY ROUND","gw":9,"home":"Alon Shamir","away":"Mika Cohen","home_score":36,"away_score":39,"winner":"Mika Cohen","loser":"Alon Shamir","played":true},"5":{"num":5,"round":"PRELIMINARY ROUND","gw":9,"home":"Roe Ikeda","away":"Tomer G.","home_score":44,"away_score":64,"winner":"Tomer G.","loser":"Roe Ikeda","played":true},"6":{"num":6,"round":"PRELIMINARY ROUND","gw":9,"home":"Rani Eylat","away":"Tom Harel","home_score":42,"away_score":53,"winner":"Tom Harel","loser":"Rani Eylat","played":true},"7":{"num":7,"round":"2ND ROUND","gw":17,"home":"Nitsan A.","away":"Ofer N.","home_score":99,"away_score":94,"winner":"Nitsan A.","loser":"Ofer N.","played":true},"8":{"num":8,"round":"2ND ROUND","gw":17,"home":"Adi Ginzburg","away":"Guy Tash","home_score":81,"away_score":87,"winner":"Guy Tash","loser":"Adi Ginzburg","played":true},"9":{"num":9,"round":"2ND ROUND","gw":17,"home":"Idan Shwartz","away":"Ohad Mandel","home_score":119,"away_score":79,"winner":"Idan Shwartz","loser":"Ohad Mandel","played":true},"10":{"num":10,"round":"2ND ROUND","gw":17,"home":"Alex Golts","away":"Tomer G.","home_score":82,"away_score":91,"winner":"Tomer G.","loser":"Alex Golts","played":true},"11":{"num":11,"round":"2ND ROUND","gw":17,"home":"Yogev Balilti","away":"avner sabah","home_score":72,"away_score":85,"winner":"avner sabah","loser":"Yogev Balilti","played":true},"12":{"num":12,"round":"2ND ROUND","gw":17,"home":"Kfir Emmer","away":"Mika Cohen","home_score":72,"away_score":78,"winner":"Mika Cohen","loser":"Kfir Emmer","played":true},"13":{"num":13,"round":"2ND ROUND","gw":17,"home":"Adam R.","away":"David Peres","home_score":111,"away_score":76,"winner":"Adam R.","loser":"David Peres","played":true},"14":{"num":14,"round":"2ND ROUND","gw":17,"home":"Yuval Shkolar","away":"Roy Weiss","home_score":97,"away_score":73,"winner":"Yuval Shkolar","loser":"Roy Weiss","played":true},"15":{"num":15,"round":"2ND ROUND","gw":17,"home":"Ronen Pari","away":"Oran Turgeman","home_score":60,"away_score":107,"winner":"Oran Turgeman","loser":"Ronen Pari","played":true},"16":{"num":16,"round":"2ND ROUND","gw":17,"home":"Yaniv Salomon","away":"Tom Harel","home_score":64,"away_score":79,"winner":"Tom Harel","loser":"Yaniv Salomon","played":true},"17":{"num":17,"round":"2ND ROUND","gw":17,"home":"Hadar Grubman","away":"Dor Hazan","home_score":77,"away_score":57,"winner":"Hadar Grubman","loser":"Dor Hazan","played":true},"18":{"num":18,"round":"2ND ROUND","gw":17,"home":"Ohad Gold","away":"Ben Y.","home_score":83,"away_score":72,"winner":"Ohad Gold","loser":"Ben Y.","played":true},"19":{"num":19,"round":"2ND ROUND","gw":17,"home":"Alon Meir","away":"Omer Apel","home_score":84,"away_score":78,"winner":"Alon Meir","loser":"Omer Apel","played":true},"20":{"num":20,"round":"2ND ROUND","gw":17,"home":"hadar hason","away":"Dudi Cohen","home_score":77,"away_score":100,"winner":"Dudi Cohen","loser":"hadar hason","played":true},"21":{"num":21,"round":"2ND ROUND","gw":17,"home":"Yonatan Cohen","away":"Or Portal","home_score":67,"away_score":77,"winner":"Or Portal","loser":"Yonatan Cohen","played":true},"22":{"num":22,"round":"2ND ROUND","gw":17,"home":"Sharon Erez","away":"Danny Simon","home_score":98,"away_score":85,"winner":"Sharon Erez","loser":"Danny Simon","played":true},"23":{"num":23,"round":"3RD ROUND","gw":24,"home":"Oran Turgeman","away":"Alon Meir","home_score":38,"away_score":60,"winner":"Alon Meir","loser":"Oran Turgeman","played":true},"24":{"num":24,"round":"3RD ROUND","gw":24,"home":"Mika Cohen","away":"avner sabah","home_score":43,"away_score":77,"winner":"avner sabah","loser":"Mika Cohen","played":true},"25":{"num":25,"round":"3RD ROUND","gw":24,"home":"Dudi Cohen","away":"Yuval Shkolar","home_score":62,"away_score":66,"winner":"Yuval Shkolar","loser":"Dudi Cohen","played":true},"26":{"num":26,"round":"3RD ROUND","gw":24,"home":"Ohad Gold","away":"Tom Harel","home_score":37,"away_score":67,"winner":"Tom Harel","loser":"Ohad Gold","played":true},"27":{"num":27,"round":"3RD ROUND","gw":24,"home":"Tomer G.","away":"Hadar Grubman","home_score":44,"away_score":75,"winner":"Hadar Grubman","loser":"Tomer G.","played":true},"28":{"num":28,"round":"3RD ROUND","gw":24,"home":"Or Portal","away":"Guy Tash","home_score":67,"away_score":51,"winner":"Or Portal","loser":"Guy Tash","played":true},"29":{"num":29,"round":"3RD ROUND","gw":24,"home":"Idan Shwartz","away":"Nitsan A.","home_score":65,"away_score":65,"winner":"Idan Shwartz","loser":"Nitsan A.","played":true},"30":{"num":30,"round":"3RD ROUND","gw":24,"home":"Sharon Erez","away":"Adam R.","home_score":67,"away_score":61,"winner":"Sharon Erez","loser":"Adam R.","played":true},"31":{"num":31,"round":"QUARTER-FINALS","gw":26,"home":"Yuval Shkolar","away":"Tom Harel","home_score":69,"away_score":57,"winner":"Yuval Shkolar","loser":"Tom Harel","played":true},"32":{"num":32,"round":"QUARTER-FINALS","gw":26,"home":"avner sabah","away":"Hadar Grubman","home_score":70,"away_score":57,"winner":"avner sabah","loser":"Hadar Grubman","played":true},"33":{"num":33,"round":"QUARTER-FINALS","gw":26,"home":"Alon Meir","away":"Idan Shwartz","home_score":47,"away_score":74,"winner":"Idan Shwartz","loser":"Alon Meir","played":true},"34":{"num":34,"round":"QUARTER-FINALS","gw":26,"home":"Or Portal","away":"Sharon Erez","home_score":60,"away_score":97,"winner":"Sharon Erez","loser":"Or Portal","played":true},"35":{"num":35,"round":"CONSOLATION QF","gw":26,"home":"Dudi Cohen","away":"Ohad Gold","home_score":81,"away_score":52,"winner":"Dudi Cohen","loser":"Ohad Gold","played":true},"36":{"num":36,"round":"CONSOLATION QF","gw":26,"home":"Mika Cohen","away":"Tomer G.","home_score":57,"away_score":46,"winner":"Mika Cohen","loser":"Tomer G.","played":true},"37":{"num":37,"round":"CONSOLATION QF","gw":26,"home":"Oran Turgeman","away":"Nitsan A.","home_score":65,"away_score":62,"winner":"Oran Turgeman","loser":"Nitsan A.","played":true},"38":{"num":38,"round":"CONSOLATION QF","gw":26,"home":"Guy Tash","away":"Adam R.","home_score":58,"away_score":83,"winner":"Adam R.","loser":"Guy Tash","played":true},"39":{"num":39,"round":"CONSOLATION SF","gw":29,"home":"Mika Cohen","away":"Dudi Cohen","home_score":59,"away_score":59,"winner":"Dudi Cohen","loser":"Mika Cohen","played":true},"40":{"num":40,"round":"CONSOLATION SF","gw":29,"home":"Adam R.","away":"Oran Turgeman","home_score":64,"away_score":86,"winner":"Oran Turgeman","loser":"Adam R.","played":true},"41":{"num":41,"round":"SEMI-FINALS","gw":29,"home":"avner sabah","away":"Yuval Shkolar","home_score":49,"away_score":62,"winner":"Yuval Shkolar","loser":"avner sabah","played":true},"42":{"num":42,"round":"SEMI-FINALS","gw":29,"home":"Sharon Erez","away":"Idan Shwartz","home_score":80,"away_score":62,"winner":"Sharon Erez","loser":"Idan Shwartz","played":true},"43":{"num":43,"round":"FINAL","gw":33,"home":"Yuval Shkolar","away":"Sharon Erez","home_score":null,"away_score":null,"winner":null,"loser":null,"played":false},"44":{"num":44,"round":"CONSOLATION FINALS","gw":33,"home":"Dudi Cohen","away":"avner sabah","home_score":null,"away_score":null,"winner":null,"loser":null,"played":false},"45":{"num":45,"round":"CONSOLATION FINALS","gw":33,"home":"Oran Turgeman","away":"Idan Shwartz","home_score":null,"away_score":null,"winner":null,"loser":null,"played":false}};



function matchCard(g, showGw) {
  if (!g) return '<div class="match"><div class="match-team tbd">TBD</div><div class="match-team tbd">TBD</div></div>';
  const hWin = g.played && g.winner === g.home;
  const aWin = g.played && g.winner === g.away;
  const hTbd = !g.home || g.home === 'TBD';
  const aTbd = !g.away || g.away === 'TBD';
  const hScore = g.home_score !== null && g.home_score !== undefined ? g.home_score : '';
  const aScore = g.away_score !== null && g.away_score !== undefined ? g.away_score : '';
  return `
    <div class="match ${!g.played ? 'upcoming' : ''}">
      ${showGw ? `<div class="match-gw">GW${g.gw}</div>` : ''}
      <div class="match-team ${hWin ? 'winner' : ''} ${hTbd ? 'tbd' : ''}">
        <span>${g.home || 'TBD'}</span>
        <span class="match-score ${g.played && !hWin ? 'loser' : ''}">${hScore}</span>
      </div>
      <div class="match-team ${aWin ? 'winner' : ''} ${aTbd ? 'tbd' : ''}">
        <span>${g.away || 'TBD'}</span>
        <span class="match-score ${g.played && !aWin ? 'loser' : ''}">${aScore}</span>
      </div>
    </div>`;
}

function makeRound(title, gameNums) {
  const matches = gameNums.map(n => `<div class="match-wrap">${matchCard(CUP_GAMES[n], true)}</div>`).join('');
  return `<div class="bracket-round"><div class="bracket-round-title">${title}</div>${matches}</div>`;
}

function buildCup() {
  // MAIN CUP: Prelim(6 games) -> R2(16 games) -> R3(8 games) -> QF(4) -> SF(2) -> Final(1)
  // Split R2 into two columns of 8 for readability
  const mainHTML = `
    <div class="bracket-section">
      <div class="bracket-title">🏆 Main Cup</div>
      <div class="bracket-scroll">
        <div class="bracket">
          ${makeRound('PRELIM · GW9', [1,2,3,4,5,6])}
          ${makeRound('ROUND 2 · GW17', [7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22])}
          ${makeRound('ROUND 3 · GW24', [23,24,25,26,27,28,29,30])}
          ${makeRound('QUARTER-FINALS · GW26', [31,32,33,34])}
          ${makeRound('SEMI-FINALS · GW29', [41,42])}
          ${makeRound('FINAL · GW33', [43])}
        </div>
      </div>
    </div>`;
  document.getElementById('mainCupBracket').innerHTML = mainHTML;

  // CONSOLATION: starts after R3 losers -> Consolation QF -> SF -> Final
  const conHTML = `
    <div class="bracket-section">
      <div class="bracket-title">🥈 Consolation Cup</div>
      <div class="bracket-scroll">
        <div class="bracket">
          ${makeRound('CONSOLATION QF · GW26', [35,36,37,38])}
          ${makeRound('CONSOLATION SF · GW29', [39,40])}
          ${makeRound('CONSOLATION FINAL · GW33', [44,45])}
        </div>
      </div>
    </div>`;
  document.getElementById('consolationBracket').innerHTML = conHTML;
}

function showCupTab(name, btn) {
  document.querySelectorAll('.cup-view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.cup-tab-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('cup-'+name).classList.add('active');
  btn.classList.add('active');
}



async function loadData() {
  try {
    const resp = await fetch(SHEET_CSV_URL);
    if (!resp.ok) throw new Error("Failed to fetch sheet: " + resp.status);
    const text = await resp.text();
    const rows = parseCSVText(text);
    if (!rows.length) throw new Error("No data rows found");

    const headers = Object.keys(rows[0]);
    const gwCols = headers.filter(h => /^GW\d+\s*Pts$/i.test(h));
    if (!gwCols.length) throw new Error("No GWX Pts columns found");

    gameweeks = gwCols.map(c => parseInt(c.match(/(\d+)/)[1])).sort((a,b)=>a-b);

    players = rows.map(row => {
      const scores = {};
      const rawScores = {};
      gameweeks.forEach(gw => {
        const col = gwCols.find(c => new RegExp(`^GW${gw}\\s*Pts$`,'i').test(c));
        const raw = col ? row[col] : null;
        const parsed = parseScoreFull(raw);
        scores[gw] = parsed ? parsed.net : null;
        rawScores[gw] = parsed;
      });
      return { name: row["Name"].trim(), scores, rawScores };
    });

    document.getElementById("loading").style.display = "none";
    document.getElementById("app").style.display = "block";
    document.getElementById("headerStats").style.display = "flex";
    document.getElementById("statManagers").textContent = players.length;
    document.getElementById("statGWs").textContent = gameweeks.length;

    buildWeekly();
    buildMonthly();
    buildGWSelect();
    renderStandings();
    buildSecondHalf();
    buildWinners();
    buildCup();

  } catch(e) {
    document.getElementById("loading").style.display = "none";
    const eb = document.getElementById("errorBox");
    eb.style.display = "block";
    eb.textContent = "⚠️ Could not load data: " + e.message;
  }
}

// ---- WEEKLY ----
function buildWeekly() {
  const winners = gameweeks.map(gw => {
    const scores = players.map(p => ({ name:p.name, score:p.scores[gw] }))
      .filter(p => p.score !== null).sort((a,b)=>b.score-a.score);
    return { gw, winner:scores[0], runners:scores.slice(1,4) };
  });

  function renderPage(page) {
    const grid = document.getElementById("weeklyGrid");
    const slice = winners.slice(page*PAGE_SIZE, page*PAGE_SIZE+PAGE_SIZE);
    grid.innerHTML = slice.map(({gw,winner,runners}) => `
      <div class="week-card">
        <div class="week-header">
          <span class="gw-label">GW ${gw}</span>
          <span class="pts-badge">${winner?.score} pts</span>
        </div>
        <div class="winner-name">🏆 ${winner?.name}</div>
        <div class="runners">
          ${runners.map(r=>`<div class="runner-row"><span>${r.name}</span><span class="runner-score">${r.score}</span></div>`).join("")}
        </div>
      </div>
    `).join("");

    const pages = Math.ceil(winners.length/PAGE_SIZE);
    const pg = document.getElementById("weeklyPagination");
    pg.innerHTML = pages > 1 ? Array.from({length:pages},(_,i)=>`
      <button class="page-btn ${i===page?'active':''}" onclick="goWeeklyPage(${i})">${i+1}</button>
    `).join("") : "";
  }

  window.goWeeklyPage = function(p) { weeklyPage=p; renderPage(p); };
  renderPage(0);
}

// ---- MONTHLY ----
function buildMonthly() {
  const gwSet = new Set(gameweeks);
  const months = MONTH_GROUPS.map(m=>({...m,gws:m.gws.filter(g=>gwSet.has(g))})).filter(m=>m.gws.length);
  const grid = document.getElementById("monthlyGrid");
  grid.innerHTML = months.map(m => {
    const standings = players.map(p=>({
      name:p.name,
      total:m.gws.reduce((s,g)=>s+(p.scores[g]??0),0)
    })).sort((a,b)=>b.total-a.total);
    return `
      <div class="month-card">
        <div class="month-title">${m.label}</div>
        <div class="month-range">GW${m.gws[0]} – GW${m.gws[m.gws.length-1]}</div>
        ${standings.slice(0,5).map((p,i)=>`
          <div class="month-row">
            <div class="month-player">
              <span style="width:22px;text-align:center">${medal(i+1)}</span>
              <span style="font-size:0.9rem;color:${i===0?'#ffd700':'#f0e6f6'};font-weight:${i===0?800:400}">${p.name}</span>
            </div>
            <span class="month-pts">${p.total}</span>
          </div>
        `).join("")}
      </div>
    `;
  }).join("");
}

// ---- STANDINGS ----
function buildGWSelect() {
  const sel = document.getElementById("gwSelect");
  sel.innerHTML = gameweeks.map(g=>`<option value="${g}">GW ${g}</option>`).join("");
  sel.value = gameweeks[gameweeks.length-1];
}

function renderStandings() {
  const gw = parseInt(document.getElementById("gwSelect").value);
  document.getElementById("gwScoreHeader").textContent = `GW${gw} Score`;

  const leagueRows = players.map(p=>({
    name:p.name,
    total:gameweeks.filter(g=>g<=gw).reduce((s,g)=>s+(p.scores[g]??0),0),
    gwScore:p.scores[gw]??0
  })).sort((a,b)=>b.total-a.total);

  const shRows = players.map(p=>({
    name:p.name,
    total:gameweeks.filter(g=>g>=20&&g<=gw).reduce((s,g)=>s+(p.scores[g]??0),0)
  })).sort((a,b)=>b.total-a.total);

  const { leagueAssign } = computePrizes(leagueRows, shRows);

  document.getElementById("standingsBody").innerHTML = leagueRows.map((r,i)=>`
    <tr>
      <td class="td-rank">${medal(i+1)}</td>
      <td class="td-name ${i===0?'name-first':''}">${r.name}</td>
      <td class="td-num td-dim">${r.gwScore}</td>
      <td class="td-num td-green">${r.total}</td>
      <td class="td-num">${leagueAssign[r.name] ? prizeBadge(leagueAssign[r.name]) : ''}</td>
    </tr>
  `).join("");
}

// ---- SECOND HALF ----
function buildSecondHalf() {
  const gws = gameweeks.filter(g=>g>=20);
  if (!gws.length) {
    document.getElementById("shStats").innerHTML = `<p style="color:#f0e6f6;font-family:'Nunito',sans-serif">No GW20+ data yet.</p>`;
    return;
  }

  const shRows = players.map(p=>({
    name:p.name,
    total:gws.reduce((s,g)=>s+(p.scores[g]??0),0),
    played:gws.filter(g=>p.scores[g]!==null).length
  })).sort((a,b)=>b.total-a.total);

  const leagueRows = players.map(p=>({
    name:p.name,
    total:gameweeks.reduce((s,g)=>s+(p.scores[g]??0),0)
  })).sort((a,b)=>b.total-a.total);

  const { shAssign } = computePrizes(leagueRows, shRows);

  document.getElementById("shStats").innerHTML = `
    <div class="sh-stat">
      <div class="sh-label">GW Range</div>
      <div class="sh-value">GW20 – GW${gws[gws.length-1]}</div>
    </div>
    <div class="sh-stat-dark">
      <div class="sh-label-green">Leader</div>
      <div class="sh-value-gold">${shRows[0]?.name}</div>
    </div>
  `;

  document.getElementById("shBody").innerHTML = shRows.map((r,i)=>`
    <tr>
      <td class="td-rank">${medal(i+1)}</td>
      <td class="td-name ${i===0?'name-first':''}">${r.name}</td>
      <td class="td-num td-green">${r.total}</td>
      <td class="td-num td-dim">${r.played?(r.total/r.played).toFixed(1):"—"}</td>
      <td class="td-num">${shAssign[r.name] ? prizeBadge(shAssign[r.name]) : ''}</td>
    </tr>
  `).join("");
}

// ---- WINNERS TAB ----
function buildWinners() {
  // For each GW, find the winner(s):
  // - Get max score for that GW
  // - All players with that score are candidates
  // - EXCLUDE any candidate who took a hit (rawScore.tookHit === true) IF there is at least one candidate who did NOT take a hit
  // - Split ₪25 equally among remaining winners

  const gwResults = gameweeks.map(gw => {
    const allScores = players
      .map(p => ({ name: p.name, score: p.scores[gw], tookHit: p.rawScores[gw]?.tookHit ?? false }))
      .filter(p => p.score !== null)
      .sort((a,b) => b.score - a.score);

    if (!allScores.length) return { gw, winners: [], prize: 0, topScore: 0 };

    const topScore = allScores[0].score;
    let topPlayers = allScores.filter(p => p.score === topScore);

    // If any top player did NOT take a hit, exclude those who did
    const hasCleanWinner = topPlayers.some(p => !p.tookHit);
    if (hasCleanWinner) {
      topPlayers = topPlayers.filter(p => !p.tookHit);
    }

    const prizeEach = WEEKLY_PRIZE / topPlayers.length;
    return { gw, winners: topPlayers.map(p=>p.name), prize: prizeEach, topScore, shared: topPlayers.length > 1 };
  });

  // Aggregate per player
  const earnings = {};
  players.forEach(p => { earnings[p.name] = { wins: 0, sharedWins: 0, total: 0 }; });

  gwResults.forEach(({winners, prize, shared}) => {
    winners.forEach(name => {
      if (!earnings[name]) earnings[name] = { wins: 0, sharedWins: 0, total: 0 };
      earnings[name].wins++;
      if (shared) earnings[name].sharedWins++;
      earnings[name].total += prize;
    });
  });

  const ranked = Object.entries(earnings)
    .map(([name, e]) => ({ name, ...e }))
    .filter(e => e.total > 0)
    .sort((a,b) => b.total - a.total || b.wins - a.wins);

  // Hero cards (top 3)
  const heroEmojis = ["🥇","🥈","🥉"];
  document.getElementById("winnersHero").innerHTML = ranked.slice(0,3).map((r,i) => `
    <div class="winner-hero-card ${i===0?'top1':''}">
      <div class="winner-hero-rank" style="color:${i===0?'#ffd700':i===1?'#c0c0c0':'#cd7f32'}">${heroEmojis[i]}</div>
      <div class="winner-hero-name">${r.name}</div>
      <div class="winner-hero-wins">${r.wins} win${r.wins!==1?'s':''} ${r.sharedWins>0?`(${r.sharedWins} shared)`:''}</div>
      <div class="winner-hero-amount">₪${r.total % 1 === 0 ? r.total : r.total.toFixed(2)}</div>
    </div>
  `).join("");

  // Full table
  document.getElementById("winnersBody").innerHTML = ranked.map((r,i) => `
    <tr>
      <td class="td-rank">${medal(i+1)}</td>
      <td class="td-name" style="color:${i===0?'#ffd700':'#f0e6f6'};font-weight:${i===0?800:400}">${r.name}</td>
      <td class="td-num td-dim">${r.wins}</td>
      <td class="td-num td-dim">${r.sharedWins}</td>
      <td class="td-num td-green">₪${r.total % 1 === 0 ? r.total : r.total.toFixed(2)}</td>
    </tr>
  `).join("");

  // Week by week breakdown
  document.getElementById("weekByWeekList").innerHTML = gwResults.map(({gw, winners, prize, topScore, shared}) => `
    <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid rgba(124,45,142,0.3);font-family:'Nunito',sans-serif;font-size:0.9rem">
      <span style="font-family:'Bebas Neue',cursive;font-size:1rem;color:#00ff87;letter-spacing:1px;min-width:45px">GW ${gw}</span>
      <span style="color:#f0e6f6">${winners.join(", ")}</span>
      <span style="color:rgba(240,230,246,0.5);font-size:0.8rem">${topScore} pts</span>
      ${shared ? `<span style="font-size:0.75rem;color:rgba(240,230,246,0.4)">(split)</span>` : ''}
      <span style="margin-left:auto;color:#ffd700;font-weight:700">₪${prize % 1 === 0 ? prize : prize.toFixed(2)}</span>
    </div>
  `).join("");
}

// ---- TABS ----
function showTab(name, btn) {
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b=>b.classList.remove('active'));
  document.getElementById('view-'+name).classList.add('active');
  btn.classList.add('active');
}

loadData();
