/**
 * espn-sync.js
 * ─────────────────────────────────────────────────────────────────
 * Drop this file into your Render backend root, then in your main
 * server file (e.g. index.js / server.js) add:
 *
 *   require('./espn-sync');
 *
 * That's it. The cron starts automatically.
 *
 * Firebase Admin SDK must already be initialised in your project.
 * If you initialise it in a separate file, import the db from there:
 *   const { db } = require('./firebase-admin');   ← adjust path
 *
 * ESPN hidden API used (no key required):
 *   https://site.api.espn.com/apis/site/v2/sports/soccer/{league}/scoreboard
 * ─────────────────────────────────────────────────────────────────
 */

const admin  = require('firebase-admin');
const fetch  = (...a) => import('node-fetch').then(({default:f})=>f(...a));

// ── Firestore (adjust if you use a different db reference) ──────
function getDB() {
  // If firebase-admin is already initialised elsewhere, this is safe
  if (!admin.apps.length) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      // or: credential: admin.credential.cert(require('./serviceAccount.json'))
    });
  }
  return admin.firestore();
}

// ── ESPN league slug map ─────────────────────────────────────────
// Key = whatever league name you use in Firebase tips
// Value = ESPN slug (from site.api.espn.com URLs)
const LEAGUE_SLUGS = {
  'Premier League'   : 'eng.1',
  'La Liga'          : 'esp.1',
  'Serie A'          : 'ita.1',
  'Bundesliga'       : 'ger.1',
  'Ligue 1'          : 'fra.1',
  'Champions League' : 'uefa.champions',
  'Europa League'    : 'uefa.europa',
  'MLS'              : 'usa.1',
  'KPL'              : 'ken.1',
  // Add more as needed — check ESPN for the correct slug
};

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

// ── Prediction → result auto-classification ──────────────────────
/**
 * Given a tip's prediction string and the ESPN outcome, determine
 * whether the tip is "right" or "wrong".
 *
 * Supported prediction formats (case-insensitive):
 *   "Home Win" / "1"  → home team wins
 *   "Away Win" / "2"  → away team wins
 *   "Draw" / "X"      → draw
 *   "BTTS"            → both teams scored
 *   "Over 2.5"        → total goals > 2.5
 *   "Under 2.5"       → total goals < 2.5
 *   "1X"              → home or draw
 *   "X2"              → draw or away
 *   "12"              → home or away (no draw)
 *
 * @param {string} prediction   - tip.prediction from Firebase
 * @param {object} score        - { home: number, away: number }
 * @param {string} espnWinner   - 'home' | 'away' | 'draw'
 * @returns {'right'|'wrong'|null}  null = cannot determine
 */
function classify(prediction, score, espnWinner) {
  if (!prediction || score === null) return null;
  const p  = prediction.trim().toLowerCase();
  const hg = score.home;
  const ag = score.away;
  const total = hg + ag;

  if (p === 'home win' || p === '1')              return espnWinner === 'home'               ? 'right' : 'wrong';
  if (p === 'away win' || p === '2')              return espnWinner === 'away'               ? 'right' : 'wrong';
  if (p === 'draw'     || p === 'x')              return espnWinner === 'draw'               ? 'right' : 'wrong';
  if (p === '1x')                                 return (espnWinner === 'home' || espnWinner === 'draw') ? 'right' : 'wrong';
  if (p === 'x2')                                 return (espnWinner === 'away' || espnWinner === 'draw') ? 'right' : 'wrong';
  if (p === '12')                                 return (espnWinner === 'home' || espnWinner === 'away') ? 'right' : 'wrong';
  if (p === 'btts' || p === 'both teams to score') return (hg > 0 && ag > 0)                ? 'right' : 'wrong';
  if (p.startsWith('over')) {
    const line = parseFloat(p.replace(/[^0-9.]/g,''));
    if (!isNaN(line)) return total > line ? 'right' : 'wrong';
  }
  if (p.startsWith('under')) {
    const line = parseFloat(p.replace(/[^0-9.]/g,''));
    if (!isNaN(line)) return total < line ? 'right' : 'wrong';
  }
  return null; // unknown prediction format — leave as pending
}

// ── Fetch ESPN scoreboard for one league ────────────────────────
async function fetchESPN(leagueSlug) {
  const url = `${ESPN_BASE}/${leagueSlug}/scoreboard`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 BettOfficials/1.0' },
    timeout: 8000,
  });
  if (!res.ok) throw new Error(`ESPN ${leagueSlug} HTTP ${res.status}`);
  return res.json();
}

// ── Parse ESPN event into a clean object ────────────────────────
function parseEvent(ev) {
  const comp    = ev.competitions?.[0];
  const status  = ev.status?.type;
  const home    = comp?.competitors?.find(c => c.homeAway === 'home');
  const away    = comp?.competitors?.find(c => c.homeAway === 'away');

  const homeScore = parseInt(home?.score ?? '-1', 10);
  const awayScore = parseInt(away?.score ?? '-1', 10);
  const hasScore  = homeScore >= 0 && awayScore >= 0;

  let winner = null;
  if (hasScore && status?.completed) {
    if (homeScore > awayScore) winner = 'home';
    else if (awayScore > homeScore) winner = 'away';
    else winner = 'draw';
  }

  return {
    espnId    : String(ev.id),
    isLive    : status?.state === 'in',
    isFinished: !!status?.completed,
    clock     : ev.status?.displayClock || null,     // e.g. "72'"
    period    : ev.status?.period || null,
    score     : hasScore ? { home: homeScore, away: awayScore } : null,
    outcomeStr: hasScore ? `${homeScore} - ${awayScore}` : null,
    winner,
    homeName  : home?.team?.displayName || '',
    awayName  : away?.team?.displayName || '',
  };
}

// ── Main sync function ───────────────────────────────────────────
async function syncDay() {
  const db      = getDB();
  const todayKey = new Date().toISOString().split('T')[0];
  const tipsRef  = db.collection('tips').doc(todayKey);

  // 1. Load today's tips from Firestore
  const snap = await tipsRef.get();
  if (!snap.exists) return; // nothing to sync today
  const data = snap.data() || {};

  // 2. Collect all unique ESPN IDs referenced by tips
  const espnIdSet = new Set();
  const leagueSet = new Set();

  for (const leagueKey of Object.keys(data)) {
    const tips = data[leagueKey]?.tips || {};
    leagueSet.add(leagueKey);
    for (const tipId of Object.keys(tips)) {
      const t = tips[tipId];
      if (t?.espnId) espnIdSet.add(String(t.espnId));
    }
  }

  if (!espnIdSet.size) {
    console.log('[ESPN-SYNC] No espnId fields found in today\'s tips — nothing to sync.');
    return;
  }

  // 3. Fetch ESPN scoreboards for relevant leagues
  const eventMap = {}; // espnId → parsed event

  for (const leagueKey of leagueSet) {
    const slug = LEAGUE_SLUGS[leagueKey];
    if (!slug) {
      console.warn(`[ESPN-SYNC] No slug mapped for league: "${leagueKey}" — skipping`);
      continue;
    }
    try {
      const json  = await fetchESPN(slug);
      const events = json?.events || [];
      for (const ev of events) {
        const parsed = parseEvent(ev);
        eventMap[parsed.espnId] = parsed;
      }
      console.log(`[ESPN-SYNC] ${leagueKey}: fetched ${events.length} events`);
    } catch (err) {
      console.error(`[ESPN-SYNC] Failed to fetch ${leagueKey}:`, err.message);
    }
  }

  // 4. Build Firestore batch updates
  const batch   = db.batch();
  let   updates = 0;

  for (const leagueKey of Object.keys(data)) {
    const tips = data[leagueKey]?.tips || {};
    for (const tipId of Object.keys(tips)) {
      const tip = tips[tipId];
      if (!tip?.espnId) continue;
      const ev = eventMap[String(tip.espnId)];
      if (!ev) continue;

      const fields = {};

      // Live score / outcome
      if (ev.score) {
        fields[`${leagueKey}.tips.${tipId}.outcome`]   = ev.outcomeStr;
        fields[`${leagueKey}.tips.${tipId}.liveScore`] = ev.outcomeStr;
      }

      // Live status fields
      fields[`${leagueKey}.tips.${tipId}.isLive`]     = ev.isLive;
      fields[`${leagueKey}.tips.${tipId}.isFinished`] = ev.isFinished;
      if (ev.clock)  fields[`${leagueKey}.tips.${tipId}.clock`]  = ev.clock;
      if (ev.period) fields[`${leagueKey}.tips.${tipId}.period`] = ev.period;

      // Auto-classify result only when match is finished
      if (ev.isFinished && ev.winner && tip.result !== 'right' && tip.result !== 'wrong') {
        const verdict = classify(tip.prediction, ev.score, ev.winner);
        if (verdict) {
          fields[`${leagueKey}.tips.${tipId}.result`] = verdict;
          console.log(`[ESPN-SYNC] Auto-result: ${tip.matchup} → ${verdict} (${ev.outcomeStr})`);
        }
      }

      if (Object.keys(fields).length) {
        batch.update(tipsRef, fields);
        updates++;
      }
    }
  }

  // 5. Commit
  if (updates > 0) {
    await batch.commit();
    console.log(`[ESPN-SYNC] ✅ Committed ${updates} tip updates for ${todayKey}`);
  } else {
    console.log(`[ESPN-SYNC] No changes for ${todayKey}`);
  }

  // 6. Update daily stats summary in Firestore (optional convenience doc)
  await writeDailyStats(db, todayKey, data);
}

// ── Daily stats summary doc ──────────────────────────────────────
async function writeDailyStats(db, dateKey, data) {
  let total=0, wins=0, losses=0, live=0;
  for (const lk of Object.keys(data)) {
    const tips = data[lk]?.tips || {};
    for (const t of Object.values(tips)) {
      if (!t) continue;
      total++;
      if (t.result === 'right')  wins++;
      if (t.result === 'wrong')  losses++;
      if (t.isLive)              live++;
    }
  }
  const wr = (wins + losses) > 0 ? Math.round(wins / (wins + losses) * 100) : null;
  await db.collection('stats').doc(dateKey).set({
    total, wins, losses, live,
    winRate  : wr,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

// ── Cron (every 60 seconds) ──────────────────────────────────────
const INTERVAL_MS = 60_000;

console.log('[ESPN-SYNC] Starting cron — sync every 60s');
syncDay().catch(e => console.error('[ESPN-SYNC] Initial sync error:', e));
setInterval(() => {
  syncDay().catch(e => console.error('[ESPN-SYNC] Cron error:', e));
}, INTERVAL_MS);

module.exports = { syncDay, classify, LEAGUE_SLUGS };
