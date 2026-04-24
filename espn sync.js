/**
 * espn-sync.js - UPDATED: Comprehensive league slug map + improved parsing
 * ─────────────────────────────────────────────────────────────────
 * Drop this file into your Render backend root, then in your main
 * server file (e.g. index.js / server.js) add:
 *
 *   require('./espn-sync');
 *
 * IMPORTANT: Uses Realtime Database, NOT Firestore.
 * Make sure FIREBASE_DATABASE_URL is set in your environment variables.
 * ─────────────────────────────────────────────────────────────────
 */

const admin = require('firebase-admin');

// ── Get Realtime Database reference ──────────────────────────────
function getDB() {
  if (!admin.apps.length) {
    const projectId   = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey  = process.env.FIREBASE_PRIVATE_KEY;
    const databaseURL = process.env.FIREBASE_DATABASE_URL;

    if (projectId && clientEmail && privateKey && databaseURL) {
      let key = privateKey.trim();
      key = key.replace(/^["'`]+|["'`]+$/g, '').trim();
      key = key.replace(/\\n/g, '\n');
      if (!key.includes('-----BEGIN PRIVATE KEY-----')) key = '-----BEGIN PRIVATE KEY-----\n' + key;
      if (!key.includes('-----END PRIVATE KEY-----'))   key = key.trimEnd() + '\n-----END PRIVATE KEY-----\n';

      admin.initializeApp({
        credential: admin.credential.cert({ projectId, clientEmail, privateKey: key }),
        databaseURL,
      });
    } else {
      admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
  }
  return admin.database();
}

// ═══════════════════════════════════════════════════════════════════
// COMPREHENSIVE ESPN LEAGUE SLUG MAP
// Covers every league name that may appear as a Firebase key
// (matches what the admin frontend uses when publishing tips)
// ═══════════════════════════════════════════════════════════════════
const LEAGUE_SLUGS = {
  // ── Top 5 European leagues ──────────────────────────────────────
  'Premier League (ENG)':          'eng.1',
  'Premier League':                'eng.1',
  'EPL':                           'eng.1',
  'La Liga (ESP)':                 'esp.1',
  'La Liga':                       'esp.1',
  'Serie A (ITA)':                 'ita.1',
  'Serie A':                       'ita.1',
  'Bundesliga (GER)':              'ger.1',
  'Bundesliga':                    'ger.1',
  'Ligue 1 (FRA)':                 'fra.1',
  'Ligue 1':                       'fra.1',

  // ── European club cups ──────────────────────────────────────────
  'UEFA Champions League':         'uefa.champions',
  'Champions League':              'uefa.champions',
  'UCL':                           'uefa.champions',
  'Europa League':                 'uefa.europa',
  'UEFA Europa League':            'uefa.europa',
  'Conference League':             'uefa.europa.conf',
  'UEFA Conference League':        'uefa.europa.conf',
  'UEFA Super Cup':                'uefa.super_cup',
  'UEFA Nations League':           'uefa.nations',
  'UEFA Youth League':             'uefa.champions_youth',

  // ── International competitions ──────────────────────────────────
  'World Cup':                     'fifa.world',
  'FIFA World Cup':                'fifa.world',
  'European Championship':         'uefa.euro',
  'Euro':                          'uefa.euro',
  'Copa America':                  'conmebol.america',
  'AFCON':                         'caf.nations',
  'Africa Cup of Nations':         'caf.nations',
  'FIFA Club World Cup':           'fifa.cwc',
  'Club World Cup':                'fifa.cwc',
  'CONCACAF Gold Cup':             'concacaf.gold',
  'AFC Asian Cup':                 'afc.cup',

  // ── English football ─────────────────────────────────────────────
  'EFL Championship':              'eng.2',
  'Championship':                  'eng.2',
  'EFL League One':                'eng.3',
  'League One':                    'eng.3',
  'EFL League Two':                'eng.4',
  'League Two':                    'eng.4',
  'FA Cup (ENG)':                  'eng.fa',
  'FA Cup':                        'eng.fa',
  'EFL Cup (ENG)':                 'eng.league_cup',
  'EFL Cup':                       'eng.league_cup',
  'Carabao Cup':                   'eng.league_cup',

  // ── Spanish football ─────────────────────────────────────────────
  'La Liga 2 (ESP)':               'esp.2',
  'La Liga 2':                     'esp.2',
  'Segunda División':              'esp.2',
  'Primera Federación (ESP)':      'esp.3',
  'Segunda Federación (ESP)':      'esp.4',
  'Copa del Rey (ESP)':            'esp.copa_del_rey',
  'Copa del Rey':                  'esp.copa_del_rey',

  // ── Italian football ─────────────────────────────────────────────
  'Serie B':                       'ita.2',
  'Serie C (ITA)':                 'ita.3',
  'Serie C':                       'ita.3',
  'Coppa Italia (ITA)':            'ita.coppa_italia',
  'Coppa Italia':                  'ita.coppa_italia',

  // ── German football ──────────────────────────────────────────────
  '2. Bundesliga':                 'ger.2',
  '3. Liga (GER)':                 'ger.3',
  '3. Liga':                       'ger.3',
  'DFB-Pokal (GER)':               'ger.dfb_pokal',
  'DFB-Pokal':                     'ger.dfb_pokal',

  // ── French football ──────────────────────────────────────────────
  'Ligue 2':                       'fra.2',
  'Championnat National (FRA)':    'fra.3',
  'Coupe de France (FRA)':         'fra.coupe_de_france',
  'Coupe de France':               'fra.coupe_de_france',

  // ── Portuguese football ──────────────────────────────────────────
  'Primeira Liga (POR)':           'por.1',
  'Primeira Liga':                 'por.1',
  'Liga Portugal':                 'por.1',
  'Liga Portugal 2 (POR)':         'por.2',
  'Liga Portugal 2':               'por.2',

  // ── Dutch football ───────────────────────────────────────────────
  'Eredivisie (NED)':              'ned.1',
  'Eredivisie':                    'ned.1',
  'Eerste Divisie (NED)':          'ned.2',
  'Eerste Divisie':                'ned.2',
  'KNVB Cup (NED)':                'ned.cup',
  'KNVB Cup':                      'ned.cup',

  // ── Belgian football ─────────────────────────────────────────────
  'Belgian Pro League':            'bel.1',
  'Challenger Pro League (BEL)':   'bel.2',
  'Belgian Cup (BEL)':             'bel.cup',
  'Belgian Cup':                   'bel.cup',

  // ── Turkish football ─────────────────────────────────────────────
  'Turkish Süper Lig':             'tur.1',
  'Turkish Super Lig':             'tur.1',
  'TFF First League (TUR)':        'tur.2',
  'Turkish Cup (TUR)':             'tur.cup',

  // ── Other European top flights ───────────────────────────────────
  'Swiss Super League':            'sui.1',
  'Swiss Challenge League (SUI)':  'sui.2',
  'Austrian Bundesliga':           'aut.1',
  '2. Liga (AUT)':                 'aut.2',
  'Danish Superliga':              'den.1',
  '1st Division (DEN)':            'den.2',
  'Polish Ekstraklasa':            'pol.1',
  'I Liga (POL)':                  'pol.2',
  'Ukrainian Premier League':      'ukr.1',
  'Persha Liha (UKR)':             'ukr.2',
  'Scottish Premiership':          'sco.1',
  'Scottish Cup (SCO)':            'sco.cup',
  'Super League Greece (GRE)':     'gre.1',
  'Super League Greece 2 (GRE)':   'gre.2',
  'Allsvenskan (SWE)':             'swe.1',
  'Superettan (SWE)':              'swe.2',
  'Eliteserien (NOR)':             'nor.1',
  'OBOS-ligaen (NOR)':             'nor.2',
  'Veikkausliiga (FIN)':           'fin.1',
  'Russian Premier League':        'rus.1',
  'Czech First League':            'cze.1',

  // ── Americas ─────────────────────────────────────────────────────
  'MLS (USA)':                     'usa.1',
  'MLS':                           'usa.1',
  'USL Championship':              'usa.usl.1',
  'USL League One (USA)':          'usa.usl.2',
  'Canadian Premier League':       'can.1',
  'Liga MX':                       'mex.1',
  'Liga de Expansión MX (MEX)':    'mex.2',
  'Brasileirão Série A':           'bra.1',
  'Brasileirão Série B':           'bra.2',
  'Argentine Primera División':    'arg.1',
  'Primera B (Chile)':             'chi.2',
  'Primera División (Chile)':      'chi.1',
  'Primera A (Colombia)':          'col.1',
  'Primera B (Colombia)':          'col.2',
  'Liga 1 (Peru)':                 'per.1',
  'Serie A (Ecuador)':             'ecu.1',
  'Primera División (Uruguay)':    'uru.1',
  'Liga Profesional (Venezuela)':  'ven.1',
  'Copa Libertadores':             'conmebol.libertadores',
  'Copa Sudamericana':             'conmebol.sudamericana',

  // ── Asia ─────────────────────────────────────────────────────────
  'J1 League':                     'jpn.1',
  'J2 League':                     'jpn.2',
  'K League 1':                    'kor.1',
  'K League 2':                    'kor.2',
  'AFC Champions League':          'afc.champions',
  'Chinese Super League (CHN)':    'chn.1',
  'China League One (CHN)':        'chn.2',
  'Indian Super League (IND)':     'ind.1',
  'I-League (IND)':                'ind.2',
  'Thai League 1 (THA)':           'tha.1',
  'Thai League 2 (THA)':           'tha.2',
  'Saudi Pro League':              'sau.1',
  'Saudi First Division League (KSA)': 'sau.2',
  'Qatar Stars League (QAT)':      'qat.1',
  'UAE Pro League (UAE)':          'uae.pro',
  'Indonesian Liga 1 (IDN)':       'idn.1',

  // ── Africa ───────────────────────────────────────────────────────
  'Egyptian Premier League':       'egy.1',
  'South African Premier Division': 'rsa.1',
  'Kenyan Premier League':         'ken.1',
  'KPL':                           'ken.1',
  'Moroccan Botola':               'mar.1',
  'Algerian Ligue 1 (ALG)':        'alg.1',
  'Tunisian Ligue Professionnelle 1 (TUN)': 'tun.1',
  'Ghana Premier League (GHA)':    'gha.1',
  'Nigerian Premier League (NGA)': 'nga.1',
  'Tanzanian Premier League (TZA)': 'tza.1',
  'Ugandan Premier League (UGA)':  'uga.1',
  'CAF Champions League':          'caf.champions',
  'CAF Confederation Cup':         'caf.confed',
};

// ── ESPN base URL ────────────────────────────────────────────────
const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

// ── Helper: get today's date string in YYYYMMDD (UTC) ───────────
// Using UTC avoids timezone drift where a late-night match
// on e.g. 2025-04-24T23:30Z could be fetched as "tomorrow" on
// a server that runs ahead of UTC.
function todayUTC() {
  return new Date().toISOString().split('T')[0].replace(/-/g, '');
}

// ── Prediction → result auto-classification ──────────────────────
function classify(prediction, score, espnWinner) {
  if (!prediction || !score) return null;
  const p     = prediction.trim().toLowerCase();
  const hg    = score.home;
  const ag    = score.away;
  const total = hg + ag;

  // 1X2 variants
  if (p === 'home win' || p === '1')                return espnWinner === 'home' ? 'right' : 'wrong';
  if (p === 'away win' || p === '2')                return espnWinner === 'away' ? 'right' : 'wrong';
  if (p === 'draw'     || p === 'x')                return espnWinner === 'draw' ? 'right' : 'wrong';
  if (p === '1x' || p === '1 or draw')              return (espnWinner === 'home' || espnWinner === 'draw') ? 'right' : 'wrong';
  if (p === 'x2' || p === 'draw or away')           return (espnWinner === 'away' || espnWinner === 'draw') ? 'right' : 'wrong';
  if (p === '12' || p === 'home or away')           return (espnWinner === 'home' || espnWinner === 'away') ? 'right' : 'wrong';

  // BTTS
  if (p === 'btts' || p.includes('both teams to score') || p === 'gg (btts)' || p === 'gg') {
    return (hg > 0 && ag > 0) ? 'right' : 'wrong';
  }
  if (p === 'ng' || p.includes('no btts') || p.includes('ng (no btts)')) {
    return (hg === 0 || ag === 0) ? 'right' : 'wrong';
  }

  // Totals — "over 2.5 goals", "under 1.5", etc.
  if (p.startsWith('over')) {
    const line = parseFloat(p.replace(/[^0-9.]/g, ''));
    if (!isNaN(line)) return total > line ? 'right' : 'wrong';
  }
  if (p.startsWith('under')) {
    const line = parseFloat(p.replace(/[^0-9.]/g, ''));
    if (!isNaN(line)) return total < line ? 'right' : 'wrong';
  }

  // Combined markets — e.g. "Over 2.5 & BTTS"
  if (p.includes('over') && p.includes('btts')) {
    const lineMatch = p.match(/over\s*([\d.]+)/);
    const line = lineMatch ? parseFloat(lineMatch[1]) : null;
    if (line !== null) return (total > line && hg > 0 && ag > 0) ? 'right' : 'wrong';
  }
  if (p.includes('under') && p.includes('btts')) {
    const lineMatch = p.match(/under\s*([\d.]+)/);
    const line = lineMatch ? parseFloat(lineMatch[1]) : null;
    if (line !== null) return (total < line && hg > 0 && ag > 0) ? 'right' : 'wrong';
  }

  // GG & Win — BTTS + home/away wins
  if (p.includes('gg') && p.includes('win')) {
    const btts = hg > 0 && ag > 0;
    const homeWin  = p.includes('home') ? espnWinner === 'home' : false;
    const awayWin  = p.includes('away') ? espnWinner === 'away' : false;
    return (btts && (homeWin || awayWin)) ? 'right' : 'wrong';
  }

  return null; // unrecognised market — skip auto-classify
}

// ── Fuzzy league key resolver ─────────────────────────────────────
// Handles slight variations in league key spelling saved in Firebase
function resolveSlug(leagueKey) {
  // 1. Direct match
  if (LEAGUE_SLUGS[leagueKey]) return LEAGUE_SLUGS[leagueKey];

  // 2. Case-insensitive exact match
  const lower = leagueKey.toLowerCase();
  const exactCi = Object.entries(LEAGUE_SLUGS).find(([k]) => k.toLowerCase() === lower);
  if (exactCi) return exactCi[1];

  // 3. Partial match — key contains the league name or vice versa
  const partial = Object.entries(LEAGUE_SLUGS).find(([k]) => {
    const kl = k.toLowerCase();
    return lower.includes(kl) || kl.includes(lower);
  });
  if (partial) return partial[1];

  return null;
}

// ── Fetch ESPN scoreboard for one league ────────────────────────
// FIX: Now accepts an explicit dateStr (YYYYMMDD) and appends
//      &limit=100 so ESPN doesn't silently truncate results.
async function fetchESPN(leagueSlug, dateStr) {
  const { default: fetch } = await import('node-fetch');
  const date = dateStr || todayUTC();
  const url  = `${ESPN_BASE}/${leagueSlug}/scoreboard?dates=${date}&limit=100`;
  const res  = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 BettOfficials/1.0' },
    timeout: 10000,
  });
  if (!res.ok) throw new Error(`ESPN ${leagueSlug} HTTP ${res.status}`);
  return res.json();
}

// ── Parse ESPN event into a clean object ────────────────────────
function parseEvent(ev) {
  const comp  = ev.competitions?.[0];
  const status = ev.status?.type;
  const home  = comp?.competitors?.find(c => c.homeAway === 'home');
  const away  = comp?.competitors?.find(c => c.homeAway === 'away');

  let homeScore = -1, awayScore = -1;
  if (home?.score !== undefined) homeScore = parseInt(home.score, 10);
  if (away?.score !== undefined) awayScore = parseInt(away.score, 10);
  if (isNaN(homeScore) && home?.displayScore !== undefined) homeScore = parseInt(home.displayScore, 10);
  if (isNaN(awayScore) && away?.displayScore !== undefined) awayScore = parseInt(away.displayScore, 10);
  const hasScore = homeScore >= 0 && awayScore >= 0;

  let winner = null;
  if (hasScore && status?.completed) {
    if (homeScore > awayScore)      winner = 'home';
    else if (awayScore > homeScore) winner = 'away';
    else                             winner = 'draw';
  }

  const isLive = status?.state === 'in' ||
                 status?.state === 'live' ||
                 status?.description === 'In Progress' ||
                 (status?.completed === false && hasScore);

  const isFinished = status?.completed === true ||
                     status?.state === 'post' ||
                     status?.state === 'final';

  // Derive clock display
  let displayClock = ev.status?.displayClock || ev.status?.clock || null;
  if (isLive && !displayClock && hasScore) {
    const period = ev.status?.period || 1;
    displayClock = period === 1 ? '45+' : period === 2 ? '90+' : `${period === 3 ? '105' : '120'}+'`;
  }

  // scoreStr format used by the frontend  e.g. "2 - 1"
  const scoreStr = hasScore ? `${homeScore} - ${awayScore}` : null;

  return {
    espnId    : String(ev.id),
    isLive,
    isFinished,
    clock     : displayClock,
    period    : ev.status?.period || null,
    score     : hasScore ? { home: homeScore, away: awayScore } : null,
    scoreStr,
    outcomeStr: scoreStr,      // alias kept for compat
    winner,
    homeName  : home?.team?.displayName || home?.team?.name || '',
    awayName  : away?.team?.displayName || away?.team?.name || '',
  };
}

// ── Main sync function ───────────────────────────────────────────
async function syncDay() {
  const db       = getDB();
  // FIX: use UTC date for both Firebase key lookup AND ESPN fetching
  const dateStr  = todayUTC();                             // e.g. "20250424"
  const todayKey = `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6)}`; // "2025-04-24"
  const tipsRef  = db.ref(`tips/${todayKey}`);

  // 1. Load today's tips
  const snapshot = await tipsRef.once('value');
  const data     = snapshot.val();
  if (!data) {
    console.log(`[ESPN-SYNC] No tips for ${todayKey}`);
    return { tipsUpdated: 0, errors: 0 };
  }

  // 2. Collect unique ESPN IDs + which leagues we need to fetch
  const espnIdMap  = new Map();  // espnId → { leagueKey, tipId, prediction, matchup }
  const slugSet    = new Set();  // unique slugs to fetch
  const noSlugKeys = new Set();  // leagues with no slug (for logging)

  for (const leagueKey of Object.keys(data)) {
    const tips = data[leagueKey]?.tips || {};
    for (const [tipId, tip] of Object.entries(tips)) {
      if (!tip?.espnId) continue;
      const id   = String(tip.espnId);
      const slug = resolveSlug(leagueKey);
      if (!slug) {
        noSlugKeys.add(leagueKey);
        continue;
      }
      slugSet.add(slug);
      if (!espnIdMap.has(id)) {
        espnIdMap.set(id, { leagueKey, tipId, prediction: tip.prediction, matchup: tip.matchup, slug });
      }
    }
  }

  if (noSlugKeys.size) {
    console.warn(`[ESPN-SYNC] ⚠️  No slug for: ${[...noSlugKeys].join(', ')}`);
  }
  if (!espnIdMap.size) {
    console.log('[ESPN-SYNC] No ESPN-linked tips found');
    return { tipsUpdated: 0, errors: 0 };
  }

  console.log(`[ESPN-SYNC] Fetching ${slugSet.size} league(s) for ${espnIdMap.size} linked tip(s) [date=${dateStr}]`);

  // 3. Fetch ESPN scoreboards (in parallel, capped at 8 concurrent)
  //    FIX: pass dateStr explicitly to every fetchESPN call
  const eventMap = new Map();  // espnId → parsedEvent
  let   errors   = 0;

  const slugArr  = [...slugSet];
  const PARALLEL = 8;
  for (let i = 0; i < slugArr.length; i += PARALLEL) {
    const batch = slugArr.slice(i, i + PARALLEL);
    const results = await Promise.allSettled(batch.map(slug => fetchESPN(slug, dateStr)));
    results.forEach((r, idx) => {
      if (r.status === 'fulfilled') {
        const events = r.value?.events || [];
        events.forEach(ev => {
          const parsed = parseEvent(ev);
          eventMap.set(parsed.espnId, parsed);
          if (parsed.isLive && parsed.scoreStr) {
            console.log(`[ESPN-SYNC] 🔴 LIVE  ${parsed.homeName} ${parsed.scoreStr} ${parsed.awayName}` +
                        (parsed.clock ? `  (${parsed.clock})` : ''));
          }
        });
        console.log(`[ESPN-SYNC] ${batch[idx]}: ${events.length} events`);
      } else {
        console.error(`[ESPN-SYNC] ❌ ${batch[idx]}: ${r.reason?.message || r.reason}`);
        errors++;
      }
    });
  }

  // 4. Build Realtime Database update payload
  const updates = {};
  let   tipsUpdated = 0;

  for (const [espnId, info] of espnIdMap) {
    const ev = eventMap.get(espnId);
    if (!ev) {
      // Match not found in fetched data — could be a slug mismatch or ESPN
      // listing the game on a different date. Log so it's easy to diagnose.
      console.warn(`[ESPN-SYNC] ⚠️  espnId ${espnId} (${info.matchup}) not found in ${info.slug} [date=${dateStr}]`);
      continue;
    }

    const base = `${info.leagueKey}/tips/${info.tipId}`;

    if (ev.scoreStr) {
      updates[`${base}/outcome`]   = ev.scoreStr;
      updates[`${base}/liveScore`] = ev.scoreStr;
      updates[`${base}/scoreStr`]  = ev.scoreStr;
    }

    updates[`${base}/isLive`]     = ev.isLive;
    updates[`${base}/isFinished`] = ev.isFinished;
    if (ev.clock  !== null) updates[`${base}/clock`]  = ev.clock;
    if (ev.period !== null) updates[`${base}/period`] = ev.period;

    // Auto-classify result when match is finished
    if (ev.isFinished && ev.winner && info.prediction) {
      const verdict = classify(info.prediction, ev.score, ev.winner);
      if (verdict) {
        updates[`${base}/result`] = verdict;
        console.log(`[ESPN-SYNC] ✅ Auto: ${info.matchup} → ${verdict} (${ev.scoreStr})`);
      }
    }

    tipsUpdated++;
  }

  // 5. Commit to Realtime Database
  if (Object.keys(updates).length > 0) {
    await tipsRef.update(updates);
    console.log(`[ESPN-SYNC] 💾 Saved ${tipsUpdated} tip(s) / ${Object.keys(updates).length} field(s) for ${todayKey}`);
  } else {
    console.log(`[ESPN-SYNC] No DB changes for ${todayKey}`);
  }

  return { tipsUpdated, errors };
}

// ── Sync status tracking ─────────────────────────────────────────
const syncStats = { lastRun: null, tipsUpdated: 0, errors: 0, isRunning: false };

async function runSync() {
  if (syncStats.isRunning) return;
  syncStats.isRunning = true;
  try {
    const result = await syncDay();
    syncStats.tipsUpdated = result.tipsUpdated;
    syncStats.errors      = result.errors;
  } catch (e) {
    console.error('[ESPN-SYNC] Error:', e.message);
    syncStats.errors++;
  } finally {
    syncStats.lastRun    = new Date().toISOString();
    syncStats.isRunning  = false;
  }
}

// ── Expose sync stats + manual trigger via Express (optional) ────
// If your server.js exposes an `app` via module.exports.app or
// global.app you can hook into it here; otherwise add these routes
// directly in your main server file using the exports below.
function registerRoutes(app) {
  // GET /api/espn/sync-status
  app.get('/api/espn/sync-status', (req, res) => {
    res.json({ success: true, syncStats, isRunning: syncStats.isRunning });
  });

  // POST /api/espn/manual-sync
  app.post('/api/espn/manual-sync', async (req, res) => {
    if (syncStats.isRunning) {
      return res.json({ success: false, error: 'Sync already running' });
    }
    runSync(); // fire and forget
    res.json({ success: true, message: 'Sync triggered', syncStats });
  });

  // GET /api/espn/leagues  — returns the full slug map for the frontend
  app.get('/api/espn/leagues', (req, res) => {
    res.json({ success: true, leagues: LEAGUE_SLUGS });
  });

  // GET /api/espn/search?slug=eng.1&dates=20250424&q=arsenal
  app.get('/api/espn/search', async (req, res) => {
    const { slug, dates, q } = req.query;
    if (!slug) return res.status(400).json({ success: false, error: 'slug required' });
    try {
      // FIX: reuse fetchESPN (which now includes &limit=100) instead of
      //      building a raw URL that might omit the limit param.
      const dateStr = dates || todayUTC();
      const json    = await fetchESPN(slug, dateStr);
      let events = (json?.events || []).map(ev => {
        const p  = parseEvent(ev);
        return {
          espnId    : p.espnId,
          homeName  : p.homeName,
          awayName  : p.awayName,
          startTime : ev.date,
          isLive    : p.isLive,
          isFinished: p.isFinished,
          clock     : p.clock,
          scoreStr  : p.scoreStr,
          leagueName: json?.leagues?.[0]?.name || '',
        };
      });
      if (q) {
        const ql = q.toLowerCase();
        events = events.filter(e =>
          e.homeName.toLowerCase().includes(ql) ||
          e.awayName.toLowerCase().includes(ql)
        );
      }
      res.json({ success: true, events });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });
}

// ── Start cron ───────────────────────────────────────────────────
const INTERVAL_MS = 60_000; // every 60 seconds

console.log('[ESPN-SYNC] Starting — syncing every 60s');
runSync();
setInterval(runSync, INTERVAL_MS);

module.exports = { syncDay, classify, LEAGUE_SLUGS, resolveSlug, registerRoutes };
