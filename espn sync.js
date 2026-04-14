/**
 * espn-sync.js - FIXED FOR REALTIME DATABASE
 * ─────────────────────────────────────────────────────────────────
 * Drop this file into your Render backend root, then in your main
 * server file (e.g. index.js / server.js) add:
 *
 *   require('./espn-sync');
 *
 * That's it. The cron starts automatically.
 *
 * IMPORTANT: This uses Realtime Database, NOT Firestore!
 * Make sure FIREBASE_DATABASE_URL is set in your environment variables.
 * ─────────────────────────────────────────────────────────────────
 */

const admin  = require('firebase-admin');

// ── Get Realtime Database reference ──────────────────────────────
function getDB() {
  // If firebase-admin is already initialised elsewhere, use that
  if (!admin.apps.length) {
    // Try to initialize with environment variables
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;
    const databaseURL = process.env.FIREBASE_DATABASE_URL;
    
    if (projectId && clientEmail && privateKey && databaseURL) {
      // Sanitize private key
      let key = privateKey.trim();
      key = key.replace(/^["'`]+|["'`]+$/g, '').trim();
      key = key.replace(/\\n/g, '\n');
      if (!key.includes('-----BEGIN PRIVATE KEY-----')) {
        key = '-----BEGIN PRIVATE KEY-----\n' + key;
      }
      if (!key.includes('-----END PRIVATE KEY-----')) {
        key = key.trimEnd() + '\n-----END PRIVATE KEY-----\n';
      }
      
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: projectId,
          clientEmail: clientEmail,
          privateKey: key,
        }),
        databaseURL: databaseURL,
      });
    } else {
      // Fallback to application default
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
    }
  }
  return admin.database(); // Returns Realtime Database, NOT Firestore!
}

// ── ESPN league slug map ─────────────────────────────────────────
const LEAGUE_SLUGS = {
  'Premier League':          'eng.1',
  'Premier League (ENG)':    'eng.1',
  'La Liga':                 'esp.1',
  'La Liga (ESP)':           'esp.1',
  'Serie A':                 'ita.1',
  'Serie A (ITA)':           'ita.1',
  'Bundesliga':              'ger.1',
  'Bundesliga (GER)':        'ger.1',
  'Ligue 1':                 'fra.1',
  'Ligue 1 (FRA)':           'fra.1',
  'UEFA Champions League':   'uefa.champions',
  'Champions League':        'uefa.champions',
  'Europa League':           'uefa.europa',
  'Conference League':       'uefa.europa.conf',
  'MLS':                     'usa.1',
  'MLS (USA)':               'usa.1',
  'KPL':                     'ken.1',
  'Primeira Liga':           'por.1',
  'Primeira Liga (POR)':     'por.1',
  'Eredivisie':              'ned.1',
  'Eredivisie (NED)':        'ned.1',
  'Scottish Premiership':    'sco.1',
  'Turkish Süper Lig':       'tur.1',
  'Belgian Pro League':      'bel.1',
  'Saudi Pro League':        'sau.1',
  'Brasileirão Série A':     'bra.1',
  'Argentine Primera División': 'arg.1',
  'EFL Championship':        'eng.2',
  'Championship':            'eng.2',
  '2. Bundesliga':           'ger.2',
  'Serie B':                 'ita.2',
  'Ligue 2':                 'fra.2',
};

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

// ── Prediction → result auto-classification ──────────────────────
function classify(prediction, score, espnWinner) {
  if (!prediction || score === null) return null;
  const p  = prediction.trim().toLowerCase();
  const hg = score.home;
  const ag = score.away;
  const total = hg + ag;

  if (p === 'home win' || p === '1')              return espnWinner === 'home' ? 'right' : 'wrong';
  if (p === 'away win' || p === '2')              return espnWinner === 'away' ? 'right' : 'wrong';
  if (p === 'draw'     || p === 'x')              return espnWinner === 'draw' ? 'right' : 'wrong';
  if (p === '1x')                                 return (espnWinner === 'home' || espnWinner === 'draw') ? 'right' : 'wrong';
  if (p === 'x2')                                 return (espnWinner === 'away' || espnWinner === 'draw') ? 'right' : 'wrong';
  if (p === '12')                                 return (espnWinner === 'home' || espnWinner === 'away') ? 'right' : 'wrong';
  if (p === 'btts' || p === 'both teams to score') return (hg > 0 && ag > 0) ? 'right' : 'wrong';
  if (p === 'ng' || p.includes('no btts'))        return (hg === 0 || ag === 0) ? 'right' : 'wrong';
  if (p.startsWith('over')) {
    const line = parseFloat(p.replace(/[^0-9.]/g,''));
    if (!isNaN(line)) return total > line ? 'right' : 'wrong';
  }
  if (p.startsWith('under')) {
    const line = parseFloat(p.replace(/[^0-9.]/g,''));
    if (!isNaN(line)) return total < line ? 'right' : 'wrong';
  }
  return null;
}

// ── Fetch ESPN scoreboard for one league ────────────────────────
async function fetchESPN(leagueSlug) {
  const url = `${ESPN_BASE}/${leagueSlug}/scoreboard`;
  const fetch = (...args) => import('node-fetch').then(({default: f}) => f(...args));
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 BettOfficials/1.0' },
  });
  if (!res.ok) throw new Error(`ESPN ${leagueSlug} HTTP ${res.status}`);
  return res.json();
}

// ── Parse ESPN event into a clean object (FIXED for live scores) ──
function parseEvent(ev) {
  const comp    = ev.competitions?.[0];
  const status  = ev.status?.type;
  const home    = comp?.competitors?.find(c => c.homeAway === 'home');
  const away    = comp?.competitors?.find(c => c.homeAway === 'away');

  let homeScore = -1, awayScore = -1;
  if (home?.score !== undefined) homeScore = parseInt(home.score, 10);
  if (away?.score !== undefined) awayScore = parseInt(away.score, 10);
  if (isNaN(homeScore) && home?.displayScore !== undefined) homeScore = parseInt(home.displayScore, 10);
  if (isNaN(awayScore) && away?.displayScore !== undefined) awayScore = parseInt(away.displayScore, 10);
  
  const hasScore = homeScore >= 0 && awayScore >= 0;

  let winner = null;
  if (hasScore && status?.completed) {
    if (homeScore > awayScore) winner = 'home';
    else if (awayScore > homeScore) winner = 'away';
    else winner = 'draw';
  }

  // FIX: Better live detection
  const isLive = status?.state === 'in' || 
                 status?.state === 'live' || 
                 status?.description === 'In Progress' ||
                 (status?.completed === false && hasScore);
  
  const isFinished = status?.completed === true || 
                     status?.state === 'post' || 
                     status?.state === 'final';

  // FIX: Get clock correctly
  let displayClock = ev.status?.displayClock || ev.status?.clock || null;
  if (isLive && !displayClock && hasScore) {
    const period = ev.status?.period || 1;
    if (period === 1) displayClock = '45+';
    else if (period === 2) displayClock = '90';
    else displayClock = `${period === 3 ? '105' : '120'}'`;
  }

  return {
    espnId    : String(ev.id),
    isLive    : isLive,
    isFinished: isFinished,
    clock     : displayClock,
    period    : ev.status?.period || null,
    score     : hasScore ? { home: homeScore, away: awayScore } : null,
    outcomeStr: hasScore ? `${homeScore} - ${awayScore}` : null,
    winner,
    homeName  : home?.team?.displayName || home?.team?.name || '',
    awayName  : away?.team?.displayName || away?.team?.name || '',
  };
}

// ── Main sync function for REALTIME DATABASE ─────────────────────
async function syncDay() {
  const db = getDB();
  const todayKey = new Date().toISOString().split('T')[0];
  const tipsRef = db.ref(`tips/${todayKey}`);

  // 1. Load today's tips from Realtime Database
  const snapshot = await tipsRef.once('value');
  const data = snapshot.val();
  
  if (!data) {
    console.log(`[ESPN-SYNC] No tips for ${todayKey}`);
    return;
  }

  // 2. Collect all unique ESPN IDs referenced by tips
  const espnIdMap = new Map();
  const leagueSet = new Set();

  for (const leagueKey of Object.keys(data)) {
    const tips = data[leagueKey]?.tips || {};
    leagueSet.add(leagueKey);
    for (const [tipId, tip] of Object.entries(tips)) {
      if (tip?.espnId) {
        espnIdMap.set(String(tip.espnId), {
          leagueKey,
          tipId,
          prediction: tip.prediction,
          matchup: tip.matchup
        });
      }
    }
  }

  if (!espnIdMap.size) {
    console.log('[ESPN-SYNC] No espnId fields found in today\'s tips');
    return;
  }

  console.log(`[ESPN-SYNC] Syncing ${espnIdMap.size} matches across ${leagueSet.size} leagues`);

  // 3. Fetch ESPN scoreboards for relevant leagues
  const eventMap = {};

  for (const leagueKey of leagueSet) {
    const slug = LEAGUE_SLUGS[leagueKey];
    if (!slug) {
      console.warn(`[ESPN-SYNC] No slug mapped for league: "${leagueKey}"`);
      continue;
    }
    try {
      const json = await fetchESPN(slug);
      const events = json?.events || [];
      for (const ev of events) {
        const parsed = parseEvent(ev);
        eventMap[parsed.espnId] = parsed;
        if (parsed.isLive && parsed.outcomeStr) {
          console.log(`[ESPN-SYNC] 🔴 LIVE: ${parsed.homeName} vs ${parsed.awayName} - ${parsed.outcomeStr}${parsed.clock ? ` (${parsed.clock})` : ''}`);
        }
      }
      console.log(`[ESPN-SYNC] ${leagueKey}: fetched ${events.length} events`);
    } catch (err) {
      console.error(`[ESPN-SYNC] Failed to fetch ${leagueKey}:`, err.message);
    }
  }

  // 4. Build Realtime Database updates
  const updates = {};
  let updatesCount = 0;

  for (const [espnId, tipInfo] of espnIdMap) {
    const ev = eventMap[espnId];
    if (!ev) continue;

    const path = `${tipInfo.leagueKey}/tips/${tipInfo.tipId}`;

    // Live score / outcome
    if (ev.outcomeStr) {
      updates[`${path}/outcome`] = ev.outcomeStr;
      updates[`${path}/liveScore`] = ev.outcomeStr;
    }

    // Live status fields
    updates[`${path}/isLive`] = ev.isLive;
    updates[`${path}/isFinished`] = ev.isFinished;
    if (ev.clock) updates[`${path}/clock`] = ev.clock;
    if (ev.period) updates[`${path}/period`] = ev.period;

    // Auto-classify result only when match is finished
    if (ev.isFinished && ev.winner && tipInfo.prediction) {
      const verdict = classify(tipInfo.prediction, ev.score, ev.winner);
      if (verdict) {
        updates[`${path}/result`] = verdict;
        console.log(`[ESPN-SYNC] Auto-result: ${tipInfo.matchup} → ${verdict} (${ev.outcomeStr})`);
      }
    }

    updatesCount++;
  }

  // 5. Commit updates to Realtime Database
  if (Object.keys(updates).length > 0) {
    await tipsRef.update(updates);
    console.log(`[ESPN-SYNC] ✅ Updated ${updatesCount} tips (${Object.keys(updates).length} fields) for ${todayKey}`);
  } else {
    console.log(`[ESPN-SYNC] No changes for ${todayKey}`);
  }
}

// ── Cron (every 60 seconds) ──────────────────────────────────────
const INTERVAL_MS = 60_000;

console.log('[ESPN-SYNC] Starting cron — syncing every 60s');
syncDay().catch(e => console.error('[ESPN-SYNC] Initial sync error:', e));
setInterval(() => {
  syncDay().catch(e => console.error('[ESPN-SYNC] Cron error:', e));
}, INTERVAL_MS);

module.exports = { syncDay, classify, LEAGUE_SLUGS };
