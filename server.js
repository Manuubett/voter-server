require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const axios   = require('axios');
const admin   = require('firebase-admin');

// ── Firebase private key sanitizer ───────────────────────────────────────────
function sanitizePrivateKey(raw) {
  if (!raw) return null;
  let key = raw.trim();
  key = key.replace(/^["'`]+|["'`]+$/g, '').trim();
  key = key.replace(/\\n/g, '\n');
  if (!key.includes('-----BEGIN PRIVATE KEY-----')) key = '-----BEGIN PRIVATE KEY-----\n' + key;
  if (!key.includes('-----END PRIVATE KEY-----'))   key = key.trimEnd() + '\n-----END PRIVATE KEY-----\n';
  key = key
    .replace(/-----BEGIN PRIVATE KEY-----\s*/g, '-----BEGIN PRIVATE KEY-----\n')
    .replace(/\s*-----END PRIVATE KEY-----/g,   '\n-----END PRIVATE KEY-----')
    .replace(/\n{3,}/g, '\n');
  return key;
}

// ── Firebase Realtime Database init ──────────────────────────────────────────
let db;
const { FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY, FIREBASE_DATABASE_URL } = process.env;

if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY && FIREBASE_DATABASE_URL) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey:  sanitizePrivateKey(FIREBASE_PRIVATE_KEY),
      }),
      databaseURL: FIREBASE_DATABASE_URL,
    });
    db = admin.database();
    console.log('✅ Firebase Realtime Database connected');
  } catch (err) {
    console.error('❌ Firebase init failed:', err.message);
  }
} else {
  console.warn('⚠️  Firebase not configured — missing env vars');
}

// ── Telegram notifier ─────────────────────────────────────────────────────────
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    const res = await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      { chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true },
      { timeout: 8000 }
    );
    if (res.data?.ok) console.log('[Telegram] ✅ Sent');
    else console.warn('[Telegram] ⚠️ Not ok:', JSON.stringify(res.data));
  } catch (err) {
    console.error('[Telegram] ❌ Failed:', err.response?.data || err.message);
  }
}

// ── App setup ─────────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;
app.use(cors({ origin: '*' }));
app.use(express.json());

// ══════════════════════════════════════════════════════════════════
// FIX 1: /health endpoint — fast, no Firebase, used for keep-alive
// Frontend pings this every 14 min to prevent Render cold starts.
// Must respond in <100ms so it never causes its own delay.
// ══════════════════════════════════════════════════════════════════
app.get('/health', (req, res) => {
  res.json({
    ok: true,
    ts: Date.now(),
    firebase: db ? 'connected' : 'not configured',
    uptime: Math.floor(process.uptime()),
  });
});

// ── Paynecta config ───────────────────────────────────────────────────────────
const API_KEY       = process.env.PAYNECTA_API_KEY;
const USER_EMAIL    = process.env.PAYNECTA_EMAIL;
const MERCHANT_CODE = process.env.PAYNECTA_CODE;
const PRO_PRICE     = Number(process.env.PRO_PRICE_KES) || 49;
const SERVER_BASE   = process.env.SERVER_URL || 'https://your-app.onrender.com';
const PAYNECTA_URL  = 'https://paynecta.co.ke/api/v1';

if (!API_KEY)       console.error('❌ PAYNECTA_API_KEY not set');
if (!USER_EMAIL)    console.warn('⚠️  PAYNECTA_EMAIL not set');
if (!MERCHANT_CODE) console.warn('⚠️  PAYNECTA_CODE not set');

const paynectaHeaders = () => ({
  'X-API-Key':    API_KEY,
  'X-User-Email': USER_EMAIL,
  'Content-Type': 'application/json',
});

function normalisePhone(phone) {
  let p = phone.toString().replace(/\D/g, '');
  if (p.startsWith('0'))                      p = '254' + p.slice(1);
  if (p.startsWith('7') || p.startsWith('1')) p = '254' + p;
  if (!p.startsWith('254'))                   p = '254' + p;
  return p;
}

// ── AI (OpenRouter) config ────────────────────────────────────────────────────
const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
const OPENROUTER_URL     = 'https://openrouter.ai/api/v1/chat/completions';

// FIX 2a: Primary + fallback model chain
// If the primary model is slow/unavailable, we try the fallback.
// Set AI_MODEL in .env — e.g. "x-ai/grok-beta" or "openrouter/auto"
const AI_MODEL          = process.env.AI_MODEL          || 'openrouter/auto';
const AI_MODEL_FALLBACK = process.env.AI_MODEL_FALLBACK || 'mistralai/mistral-7b-instruct:free';

// FIX 2b: Timeout budget
// Render free tier kills requests after ~30s.
// We give OpenRouter 22s — leaving 8s buffer for serialisation + network.
const AI_TIMEOUT_MS = parseInt(process.env.AI_TIMEOUT_MS || '22000', 10);

if (!OPENROUTER_API_KEY) console.warn('⚠️  OPENROUTER_API_KEY not set — /api/grok/predict will fail');

// ════════════════════════════════════════════════════════════════════════════
// ESPN MODULE
// ════════════════════════════════════════════════════════════════════════════

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

const ALL_SLUGS = [
  'eng.1','esp.1','ita.1','ger.1','fra.1',
  'uefa.champions','uefa.europa','uefa.europa.conf','uefa.super_cup',
  'uefa.nations','uefa.champions_youth',
  'fifa.world','uefa.euro','conmebol.america','caf.nations',
  'fifa.cwc','concacaf.gold','afc.cup','fifa.olympics',
  'caf.championship','caf.champions','caf.confed',
  'eng.2','eng.3','eng.4','eng.fa','eng.league_cup',
  'esp.2','esp.3','esp.4','esp.copa_del_rey',
  'ita.2','ita.3','ita.coppa_italia',
  'ger.2','ger.3','ger.dfb_pokal',
  'fra.2','fra.3','fra.coupe_de_france',
  'por.1','por.2',
  'ned.1','ned.2','ned.cup',
  'bel.1','bel.2','bel.cup',
  'tur.1','tur.2','tur.cup',
  'sco.1','sco.cup',
  'sui.1','sui.2','aut.1','aut.2',
  'den.1','den.2','nor.1','nor.2','swe.1','swe.2','fin.1',
  'pol.1','pol.2','ukr.1','ukr.2','rus.1',
  'cze.1','cze.2','rou.1','srb.1','cro.1',
  'hun.1','svk.1','bul.1','isr.1','gre.1','gre.2','kaz.1',
  'usa.1','usa.2','usa.3','can.1',
  'mex.1','mex.2',
  'bra.1','bra.2','bra.3',
  'arg.1','arg.2',
  'conmebol.libertadores','conmebol.sudamericana',
  'chi.1','chi.2','col.1','col.2',
  'per.1','ecu.1','uru.1','ven.1','bol.1','par.1',
  'jpn.1','jpn.2','kor.1','kor.2',
  'afc.champions',
  'chn.1','chn.2',
  'ind.1','ind.2',
  'tha.1','tha.2',
  'sau.1','sau.2','qat.1','are.1',
  'idn.1','mys.1','irn.1','irq.1',
  'jor.1','kuw.1','omn.1','vnm.1','sgp.1',
  'egy.1','rsa.1','ken.1','mar.1',
  'alg.1','tun.1','gha.1','nga.1',
  'tza.1','uga.1','eth.1','cmr.1',
  'civ.1','sen.1','zim.1','zmb.1',
];

const LEAGUE_SLUGS = {
  'Premier League (ENG)': 'eng.1', 'Premier League': 'eng.1', 'EPL': 'eng.1',
  'La Liga (ESP)': 'esp.1', 'La Liga': 'esp.1',
  'Serie A (ITA)': 'ita.1', 'Serie A': 'ita.1',
  'Bundesliga (GER)': 'ger.1', 'Bundesliga': 'ger.1',
  'Ligue 1 (FRA)': 'fra.1', 'Ligue 1': 'fra.1',
  'UEFA Champions League': 'uefa.champions', 'Champions League': 'uefa.champions', 'UCL': 'uefa.champions',
  'Europa League': 'uefa.europa', 'UEFA Europa League': 'uefa.europa',
  'Conference League': 'uefa.europa.conf', 'UEFA Conference League': 'uefa.europa.conf',
  'UEFA Super Cup': 'uefa.super_cup',
  'UEFA Nations League': 'uefa.nations',
  'UEFA Youth League': 'uefa.champions_youth',
  'World Cup': 'fifa.world', 'FIFA World Cup': 'fifa.world',
  'European Championship': 'uefa.euro', 'Euro': 'uefa.euro',
  'Copa America': 'conmebol.america',
  'AFCON': 'caf.nations', 'Africa Cup of Nations': 'caf.nations',
  'FIFA Club World Cup': 'fifa.cwc', 'Club World Cup': 'fifa.cwc',
  'CONCACAF Gold Cup': 'concacaf.gold',
  'AFC Asian Cup': 'afc.cup',
  'African Nations Championship': 'caf.championship',
  'Olympic Football Tournament': 'fifa.olympics',
  'CAF Champions League': 'caf.champions',
  'CAF Confederation Cup': 'caf.confed',
  'EFL Championship': 'eng.2', 'Championship': 'eng.2',
  'EFL League One': 'eng.3', 'League One': 'eng.3',
  'EFL League Two': 'eng.4', 'League Two': 'eng.4',
  'FA Cup (ENG)': 'eng.fa', 'FA Cup': 'eng.fa',
  'EFL Cup (ENG)': 'eng.league_cup', 'EFL Cup': 'eng.league_cup', 'Carabao Cup': 'eng.league_cup',
  'La Liga 2 (ESP)': 'esp.2', 'La Liga 2': 'esp.2', 'Segunda División': 'esp.2',
  'Primera Federación (ESP)': 'esp.3', 'Primera Federación': 'esp.3',
  'Segunda Federación (ESP)': 'esp.4',
  'Copa del Rey (ESP)': 'esp.copa_del_rey', 'Copa del Rey': 'esp.copa_del_rey',
  'Serie B': 'ita.2',
  'Serie C (ITA)': 'ita.3', 'Serie C': 'ita.3',
  'Coppa Italia (ITA)': 'ita.coppa_italia', 'Coppa Italia': 'ita.coppa_italia',
  '2. Bundesliga': 'ger.2',
  '3. Liga (GER)': 'ger.3', '3. Liga': 'ger.3',
  'DFB-Pokal (GER)': 'ger.dfb_pokal', 'DFB-Pokal': 'ger.dfb_pokal',
  'Ligue 2': 'fra.2',
  'Championnat National (FRA)': 'fra.3', 'Championnat National': 'fra.3',
  'Coupe de France (FRA)': 'fra.coupe_de_france', 'Coupe de France': 'fra.coupe_de_france',
  'Primeira Liga (POR)': 'por.1', 'Primeira Liga': 'por.1', 'Liga Portugal': 'por.1',
  'Liga Portugal 2 (POR)': 'por.2', 'Liga Portugal 2': 'por.2',
  'Eredivisie (NED)': 'ned.1', 'Eredivisie': 'ned.1',
  'Eerste Divisie (NED)': 'ned.2', 'Eerste Divisie': 'ned.2',
  'KNVB Cup (NED)': 'ned.cup', 'KNVB Cup': 'ned.cup',
  'Belgian Pro League': 'bel.1',
  'Challenger Pro League (BEL)': 'bel.2', 'Challenger Pro League': 'bel.2',
  'Belgian Cup (BEL)': 'bel.cup', 'Belgian Cup': 'bel.cup',
  'Turkish Süper Lig': 'tur.1', 'Turkish Super Lig': 'tur.1', 'Süper Lig': 'tur.1',
  'TFF First League (TUR)': 'tur.2',
  'Turkish Cup (TUR)': 'tur.cup', 'Turkish Cup': 'tur.cup',
  'Scottish Premiership': 'sco.1',
  'Scottish Cup (SCO)': 'sco.cup', 'Scottish Cup': 'sco.cup',
  'Swiss Super League': 'sui.1', 'Swiss Challenge League (SUI)': 'sui.2',
  'Austrian Bundesliga': 'aut.1', '2. Liga (AUT)': 'aut.2',
  'Danish Superliga': 'den.1', '1st Division (DEN)': 'den.2',
  'Eliteserien (NOR)': 'nor.1', 'OBOS-ligaen (NOR)': 'nor.2',
  'Allsvenskan (SWE)': 'swe.1', 'Superettan (SWE)': 'swe.2',
  'Veikkausliiga (FIN)': 'fin.1',
  'Polish Ekstraklasa': 'pol.1', 'I Liga (POL)': 'pol.2',
  'Ukrainian Premier League': 'ukr.1', 'Persha Liha (UKR)': 'ukr.2',
  'Russian Premier League': 'rus.1',
  'Czech First League': 'cze.1',
  'Super League Greece (GRE)': 'gre.1', 'Super League Greece 2 (GRE)': 'gre.2',
  'MLS (USA)': 'usa.1', 'MLS': 'usa.1',
  'USL Championship': 'usa.2', 'USL League One (USA)': 'usa.3',
  'Canadian Premier League': 'can.1',
  'Liga MX': 'mex.1', 'Liga de Expansión MX (MEX)': 'mex.2',
  'Brasileirão Série A': 'bra.1', 'Brasileirão Série B': 'bra.2',
  'Argentine Primera División': 'arg.1',
  'Copa Libertadores': 'conmebol.libertadores',
  'Copa Sudamericana': 'conmebol.sudamericana',
  'Primera División (Chile)': 'chi.1', 'Primera B (Chile)': 'chi.2',
  'Primera A (Colombia)': 'col.1', 'Primera B (Colombia)': 'col.2',
  'Liga 1 (Peru)': 'per.1', 'Serie A (Ecuador)': 'ecu.1',
  'Primera División (Uruguay)': 'uru.1', 'Liga Profesional (Venezuela)': 'ven.1',
  'J1 League': 'jpn.1', 'J2 League': 'jpn.2',
  'K League 1': 'kor.1', 'K League 2': 'kor.2',
  'AFC Champions League': 'afc.champions',
  'Chinese Super League (CHN)': 'chn.1', 'China League One (CHN)': 'chn.2',
  'Indian Super League (IND)': 'ind.1', 'I-League (IND)': 'ind.2',
  'Thai League 1 (THA)': 'tha.1', 'Thai League 2 (THA)': 'tha.2',
  'Saudi Pro League': 'sau.1', 'Saudi First Division League (KSA)': 'sau.2',
  'Qatar Stars League (QAT)': 'qat.1',
  'UAE Pro League (UAE)': 'are.1',
  'Indonesian Liga 1 (IDN)': 'idn.1',
  'Egyptian Premier League': 'egy.1',
  'South African Premier Division': 'rsa.1',
  'Kenyan Premier League': 'ken.1', 'KPL': 'ken.1',
  'Moroccan Botola': 'mar.1',
  'Algerian Ligue 1 (ALG)': 'alg.1',
  'Tunisian Ligue Professionnelle 1 (TUN)': 'tun.1',
  'Ghana Premier League (GHA)': 'gha.1',
  'Nigerian Premier League (NGA)': 'nga.1',
  'Tanzanian Premier League (TZA)': 'tza.1',
  'Ugandan Premier League (UGA)': 'uga.1',
};

function resolveSlug(leagueKey) {
  if (!leagueKey) return null;
  if (LEAGUE_SLUGS[leagueKey]) return LEAGUE_SLUGS[leagueKey];
  const lower = leagueKey.toLowerCase();
  const ci = Object.entries(LEAGUE_SLUGS).find(([k]) => k.toLowerCase() === lower);
  if (ci) return ci[1];
  const partial = Object.entries(LEAGUE_SLUGS).find(([k]) => {
    const kl = k.toLowerCase();
    return lower.includes(kl) || kl.includes(lower);
  });
  return partial ? partial[1] : null;
}

function classify(prediction, score, winner) {
  if (!prediction || !score) return null;
  const p   = prediction.trim().toLowerCase();
  const hg  = score.home;
  const ag  = score.away;
  const tot = hg + ag;
  if (p === 'home win' || p === '1')            return winner === 'home' ? 'right' : 'wrong';
  if (p === 'away win' || p === '2')            return winner === 'away' ? 'right' : 'wrong';
  if (p === 'draw' || p === 'x')                return winner === 'draw' ? 'right' : 'wrong';
  if (p === '1x' || p === '1 or draw')          return (winner === 'home' || winner === 'draw') ? 'right' : 'wrong';
  if (p === 'x2' || p === 'draw or away')       return (winner === 'away' || winner === 'draw') ? 'right' : 'wrong';
  if (p === '12' || p === 'home or away')       return (winner === 'home' || winner === 'away') ? 'right' : 'wrong';
  if (p === 'btts' || p === 'gg' || p.includes('both teams to score') || p === 'gg (btts)')
    return (hg > 0 && ag > 0) ? 'right' : 'wrong';
  if (p === 'ng' || p.includes('no btts') || p.includes('ng (no btts)'))
    return (hg === 0 || ag === 0) ? 'right' : 'wrong';
  if (p.startsWith('over')) {
    const line = parseFloat(p.replace(/[^0-9.]/g, ''));
    if (!isNaN(line)) return tot > line ? 'right' : 'wrong';
  }
  if (p.startsWith('under')) {
    const line = parseFloat(p.replace(/[^0-9.]/g, ''));
    if (!isNaN(line)) return tot < line ? 'right' : 'wrong';
  }
  if (p.includes('over') && p.includes('btts')) {
    const m = p.match(/over\s*([\d.]+)/);
    if (m) return (tot > parseFloat(m[1]) && hg > 0 && ag > 0) ? 'right' : 'wrong';
  }
  return null;
}

// FIX 3: ESPN fetch now has a hard per-slug timeout so slow ESPN calls
// never block the sync loop indefinitely.
async function fetchESPNScoreboard(slug, retries = 1, dateStr = null) {
  const dateParam = dateStr ? `?dates=${dateStr}` : '';
  const url = `${ESPN_BASE}/${slug}/scoreboard${dateParam}`;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await axios.get(url, {
        headers: { 'User-Agent': 'BettOfficials/1.0' },
        timeout: 8000, // FIX: was 10000, reduced — sync has many slugs
      });
      return res.data;
    } catch (err) {
      if (i === retries) throw err;
      await new Promise(r => setTimeout(r, 1000 * (i + 1)));
    }
  }
}

function parseESPNEvent(ev, leagueNameOverride) {
  const comp       = ev.competitions?.[0];
  const statusType = ev.status?.type;
  const home       = comp?.competitors?.find(c => c.homeAway === 'home');
  const away       = comp?.competitors?.find(c => c.homeAway === 'away');
  let homeScore = -1, awayScore = -1;
  if (home?.score !== undefined) homeScore = parseInt(home.score, 10);
  if (away?.score !== undefined) awayScore = parseInt(away.score, 10);
  if (isNaN(homeScore) && home?.displayScore) homeScore = parseInt(home.displayScore, 10);
  if (isNaN(awayScore) && away?.displayScore) awayScore = parseInt(away.displayScore, 10);
  const hasScore = homeScore >= 0 && awayScore >= 0;
  let winner = null;
  if (hasScore && statusType?.completed) {
    if (homeScore > awayScore)      winner = 'home';
    else if (awayScore > homeScore) winner = 'away';
    else                             winner = 'draw';
  }
  const isLive = statusType?.state === 'in' || statusType?.state === 'live' ||
                 statusType?.description === 'In Progress' ||
                 (statusType?.completed === false && hasScore);
  const isFinished = statusType?.completed === true ||
                     statusType?.state === 'post' || statusType?.state === 'final';
  let displayClock = ev.status?.displayClock || ev.status?.clock || null;
  if (isLive && !displayClock && hasScore) {
    const period = ev.status?.period || 1;
    displayClock = period === 1 ? '45+' : period === 2 ? '90+' : `${period === 3 ? '105' : '120'}+`;
  }
  const scoreStr   = hasScore ? `${homeScore} - ${awayScore}` : null;
  const leagueName = leagueNameOverride || comp?.series?.shortName || ev.competitions?.[0]?.league?.name || null;
  return {
    espnId: String(ev.id), isLive, isFinished,
    clock: displayClock, period: ev.status?.period || null,
    score: hasScore ? { home: homeScore, away: awayScore } : null,
    scoreStr, outcome: scoreStr, winner,
    homeName: home?.team?.displayName || home?.team?.name || '',
    awayName: away?.team?.displayName || away?.team?.name || '',
    startTime: ev.date || null, leagueName,
  };
}

async function fetchMultipleSlugs(slugs, dateStr, BATCH = 12) {
  const results = new Map();
  const failed  = [];
  for (let i = 0; i < slugs.length; i += BATCH) {
    const batch   = slugs.slice(i, i + BATCH);
    const settled = await Promise.allSettled(
      batch.map(async slug => {
        const json       = await fetchESPNScoreboard(slug, 1, dateStr);
        const leagueName = json?.leagues?.[0]?.name || json?.leagues?.[0]?.abbreviation || null;
        return { slug, events: json?.events || [], leagueName };
      })
    );
    settled.forEach(r => {
      if (r.status === 'fulfilled') {
        r.value.events.forEach(ev => {
          const parsed = parseESPNEvent(ev, r.value.leagueName);
          if (!results.has(parsed.espnId)) results.set(parsed.espnId, { ...parsed, _slug: r.value.slug });
        });
      } else {
        failed.push(r.reason?.config?.url || '?');
      }
    });
  }
  return { events: [...results.values()], failed };
}

// ── ESPN Sync ─────────────────────────────────────────────────────────────────
let syncStats = { lastRun: null, tipsUpdated: 0, errors: 0, leaguesFetched: 0 };
let isSyncing = false;

// FIX 4: ESPN sync now has a hard 55-second overall timeout.
// This prevents it from overrunning into the next 60s tick and
// blocking the event loop when ESPN is slow.
const ESPN_SYNC_TIMEOUT_MS = 55_000;

async function espnSyncDay() {
  if (!db) { console.error('[ESPN] Firebase not available'); return; }
  const todayKey = new Date().toISOString().split('T')[0];
  const tipsRef  = db.ref(`tips/${todayKey}`);

  // FIX 4: Firebase reads now have a 10-second race timeout
  let snapshot;
  try {
    snapshot = await Promise.race([
      tipsRef.once('value'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Firebase read timeout')), 10_000)),
    ]);
  } catch (e) {
    console.error('[ESPN] Firebase read error:', e.message);
    syncStats.errors++;
    return;
  }

  const data = snapshot.val();
  if (!data) { console.log(`[ESPN] No tips for ${todayKey}`); return; }
  const espnIdMap   = new Map();
  const slugsNeeded = new Set();
  const noSlugKeys  = new Set();
  for (const leagueKey of Object.keys(data)) {
    const tips = data[leagueKey]?.tips || {};
    for (const [tipId, tip] of Object.entries(tips)) {
      if (!tip?.espnId) continue;
      const slug = resolveSlug(leagueKey);
      if (!slug) { noSlugKeys.add(leagueKey); continue; }
      slugsNeeded.add(slug);
      if (!espnIdMap.has(String(tip.espnId)))
        espnIdMap.set(String(tip.espnId), { leagueKey, tipId, prediction: tip.prediction, matchup: tip.matchup });
    }
  }
  if (noSlugKeys.size) console.warn(`[ESPN] ⚠️  No slug for: ${[...noSlugKeys].join(', ')}`);
  if (!espnIdMap.size) { console.log('[ESPN] No ESPN-linked tips'); return; }
  console.log(`[ESPN] Fetching ${slugsNeeded.size} slug(s) for ${espnIdMap.size} tip(s)`);
  const { events, failed } = await fetchMultipleSlugs([...slugsNeeded], null, 10);
  const eventMap = new Map(events.map(e => [e.espnId, e]));
  if (failed.length) console.warn(`[ESPN] ${failed.length} slugs failed`);
  const updates = {};
  let tipsUpdated = 0;
  for (const [espnId, info] of espnIdMap) {
    const ev = eventMap.get(espnId);
    if (!ev) continue;
    const base = `${info.leagueKey}/tips/${info.tipId}`;
    if (ev.scoreStr) {
      updates[`${base}/liveScore`] = ev.scoreStr;
      updates[`${base}/outcome`]   = ev.scoreStr;
      updates[`${base}/scoreStr`]  = ev.scoreStr;
    }
    updates[`${base}/isLive`]      = ev.isLive;
    updates[`${base}/isFinished`]  = ev.isFinished;
    updates[`${base}/lastUpdated`] = Date.now();
    if (ev.clock  !== null) updates[`${base}/clock`]  = ev.clock;
    if (ev.period !== null) updates[`${base}/period`] = ev.period;
    if (ev.isFinished && ev.winner && info.prediction) {
      const verdict = classify(info.prediction, ev.score, ev.winner);
      if (verdict) {
        updates[`${base}/result`] = verdict;
        console.log(`[ESPN] ✅ Auto: ${info.matchup} → ${verdict} (${ev.scoreStr})`);
        if (verdict === 'right') sendTelegram(`🎯 <b>WINNER!</b>\n${info.matchup}\nPick: ${info.prediction}\nScore: ${ev.scoreStr}`);
      }
    }
    if (ev.isLive && ev.scoreStr) console.log(`[ESPN] 🔴 LIVE: ${ev.homeName} ${ev.scoreStr} ${ev.awayName}${ev.clock ? ` (${ev.clock})` : ''}`);
    tipsUpdated++;
  }
  if (Object.keys(updates).length > 0) {
    try {
      await Promise.race([
        tipsRef.update(updates),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Firebase write timeout')), 8_000)),
      ]);
      console.log(`[ESPN] 💾 ${tipsUpdated} tip(s) / ${Object.keys(updates).length} field(s) saved`);
    } catch (err) {
      console.error('[ESPN] Update error:', err.message);
      syncStats.errors++;
    }
  }
  syncStats = { lastRun: new Date().toISOString(), tipsUpdated, errors: syncStats.errors, leaguesFetched: slugsNeeded.size };
}

async function safeSync() {
  if (isSyncing) return;
  isSyncing = true;
  try {
    // FIX 4: Hard timeout on the entire sync run
    await Promise.race([
      espnSyncDay(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Sync overall timeout')), ESPN_SYNC_TIMEOUT_MS)),
    ]);
  } catch (err) {
    console.error('[ESPN] Sync error:', err.message);
    syncStats.errors++;
  } finally {
    isSyncing = false;
  }
}

setTimeout(() => { safeSync(); setInterval(safeSync, 60_000); }, 5000);

// ════════════════════════════════════════════════════════════════════════════
// ROUTES
// ════════════════════════════════════════════════════════════════════════════

// ── Health (fast, no DB) ──────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status: 'ok', service: 'Bett Officials API',
    time: new Date().toISOString(),
    firebase: db ? 'connected' : 'not configured',
    paynecta: API_KEY ? 'configured' : 'missing key',
    price: `KES ${PRO_PRICE}`,
    espnSync: `active — ${ALL_SLUGS.length} leagues monitored`,
    syncStats,
  });
});

// ── ESPN routes ───────────────────────────────────────────────────────────────
app.get('/api/espn/search', async (req, res) => {
  const { slug, q, dates } = req.query;
  if (!slug) return res.status(400).json({ success: false, error: 'slug required' });
  try {
    const json  = await fetchESPNScoreboard(slug, 1, dates || null);
    const lName = json?.leagues?.[0]?.name || '';
    let events  = (json?.events || []).map(ev => parseESPNEvent(ev, lName));
    if (q) {
      const ql = q.toLowerCase();
      events = events.filter(e => e.homeName.toLowerCase().includes(ql) || e.awayName.toLowerCase().includes(ql));
    }
    res.json({ success: true, events });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/espn/search-all', async (req, res) => {
  const { q, dates } = req.query;
  const dateStr = dates || new Date().toISOString().split('T')[0].replace(/-/g, '');
  console.log(`[ESPN] search-all q="${q || '*'}" date=${dateStr}`);
  try {
    const { events, failed } = await fetchMultipleSlugs(ALL_SLUGS, dateStr, 15);
    let filtered = events;
    if (q) {
      const ql = q.toLowerCase();
      filtered = events.filter(e => e.homeName.toLowerCase().includes(ql) || e.awayName.toLowerCase().includes(ql));
    }
    filtered.sort((a, b) => {
      if (a.isLive && !b.isLive) return -1;
      if (!a.isLive && b.isLive) return 1;
      return new Date(a.startTime || 0) - new Date(b.startTime || 0);
    });
    res.json({ success: true, total: filtered.length, slugsSearched: ALL_SLUGS.length, slugsFailed: failed.length, events: filtered });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/espn/leagues',      (req, res) => res.json({ success: true, leagues: LEAGUE_SLUGS, allSlugs: ALL_SLUGS }));
app.get('/api/espn/sync-status',  (req, res) => res.json({ success: true, syncStats, isRunning: isSyncing, firebaseConnected: !!db }));
app.post('/api/espn/manual-sync', async (req, res) => {
  if (isSyncing) return res.json({ success: false, error: 'Sync already running' });
  safeSync();
  res.json({ success: true, message: 'Sync triggered', syncStats });
});
app.get('/api/espn/debug/:espnId', async (req, res) => {
  const { events } = await fetchMultipleSlugs(ALL_SLUGS.slice(0, 40), null, 15);
  const match = events.find(e => e.espnId === req.params.espnId);
  if (match) return res.json({ success: true, match });
  res.json({ success: false, error: 'Not found in top 40 slugs — try search-all' });
});

// ── Public Tips routes ────────────────────────────────────────────────────────
app.post('/api/tips/post', async (req, res) => {
  if (!db) return res.status(503).json({ success: false, error: 'Firebase not configured' });

  const body = req.body;
  const { homeTeam, awayTeam } = body;

  if (!homeTeam || !awayTeam) {
    return res.status(400).json({ success: false, error: 'homeTeam and awayTeam are required' });
  }

  const dateKey = body.matchDate || new Date().toISOString().split('T')[0];
  const tipId   = `${homeTeam}_${awayTeam}_${Date.now()}`.replace(/\s+/g, '_');

  const tip =
    body.tip        ||
    body.selection  ||
    body.market     ||
    body.pick       ||
    body.tipText    ||
    (body.markets?.length ? body.markets.join(' + ') : null) ||
    '';

  const kickoff =
    body.kickoff    ||
    body.kick_off   ||
    body.kickOff    ||
    body.matchTime  ||
    body.time       ||
    '';

  const verdict =
    body.verdict    ||
    body.summary    ||
    body.description ||
    '';

  const matchLabel =
    body.matchLabel ||
    body.match      ||
    `${homeTeam} vs ${awayTeam}`;

  const tipData = {
    id:           tipId,
    homeTeam,
    awayTeam,
    matchLabel,
    tip,
    selection:    tip,
    market:       tip,
    pick:         tip,
    tipText:      tip,
    kickoff,
    kick_off:     kickoff,
    kickOff:      kickoff,
    matchTime:    kickoff,
    verdict,
    markets:      body.markets || (tip ? [tip] : []),
    source:       body.source || 'ai-predict',
    aiText:       body.aiText        || '',
    probabilities:body.probabilities || null,
    probs:        body.probabilities || null,
    scores:       body.scores        || [],
    confidence:   body.confidence    || null,
    league:       body.league        || '',
    matchDate:    dateKey,
    dateKey,
    postedAt:     new Date().toISOString(),
  };

  try {
    // FIX 5: Firebase write with timeout guard
    await Promise.race([
      db.ref(`publicTips/${dateKey}/${tipId}`).set(tipData),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Firebase write timeout')), 8_000)),
    ]);
    console.log(`[Tips] ✅ Posted: ${homeTeam} vs ${awayTeam} | tip="${tip}" | kickoff="${kickoff}" → ${dateKey}/${tipId}`);

    sendTelegram(
      `📋 <b>TIP POSTED</b>\n` +
      `⚽ ${matchLabel}\n` +
      `🎯 ${tip || '—'}\n` +
      `🕐 Kick-off: ${kickoff || '—'}\n` +
      `📋 ${body.league || '—'} · ${dateKey}`
    );

    res.json({ success: true, tipId, dateKey, message: 'Tip posted' });
  } catch (err) {
    console.error('[Tips] ❌ Post error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.patch('/api/tips/:dateKey/:tipId', async (req, res) => {
  if (!db) return res.status(503).json({ success: false, error: 'Firebase not configured' });

  const { dateKey, tipId } = req.params;
  const { result, score, actualScore } = req.body;

  if (!result || !['win', 'loss'].includes(result.toLowerCase())) {
    return res.status(400).json({ success: false, error: 'result must be "win" or "loss"' });
  }

  const updates = {
    result:      result.toLowerCase(),
    outcome:     result.toLowerCase(),
    score:       score || actualScore || '',
    actualScore: score || actualScore || '',
    gradedAt:    new Date().toISOString(),
  };

  try {
    // FIX 5: Firebase write with timeout guard
    await Promise.race([
      db.ref(`publicTips/${dateKey}/${tipId}`).update(updates),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Firebase write timeout')), 8_000)),
    ]);
    console.log(`[Tips] ✅ Graded: ${dateKey}/${tipId} → ${result} | score: ${score || '—'}`);
    sendTelegram(
      `✅ <b>RESULT GRADED</b>\n` +
      `🎯 ${result.toUpperCase()} | Score: ${score || '—'}\n` +
      `📅 ${dateKey}`
    );
    res.json({ success: true, tipId, dateKey, result: result.toLowerCase() });
  } catch (err) {
    console.error('[Tips] ❌ Grade error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.get('/api/tips/public', async (req, res) => {
  if (!db) return res.status(503).json({ success: false, error: 'Firebase not configured' });
  const dateKey = req.query.date || new Date().toISOString().split('T')[0];

  // FIX 5: Keep-alive pings (date=ping) return instantly without hitting Firebase
  if (dateKey === 'ping') {
    return res.json({ success: true, dateKey: 'ping', tips: [], _ping: true });
  }

  try {
    // FIX 5: Firebase read with 10-second timeout
    const snap = await Promise.race([
      db.ref(`publicTips/${dateKey}`).once('value'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Firebase read timeout after 10s')), 10_000)),
    ]);
    const val  = snap.val();
    const tips = val ? Object.values(val).sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt)) : [];
    res.json({ success: true, dateKey, tips });
  } catch (err) {
    console.error('[Tips] ❌ Read error:', err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.delete('/api/tips/:dateKey/:tipId', async (req, res) => {
  if (!db) return res.status(503).json({ success: false, error: 'Firebase not configured' });
  const { dateKey, tipId } = req.params;
  try {
    await Promise.race([
      db.ref(`publicTips/${dateKey}/${tipId}`).remove(),
      new Promise((_, rej) => setTimeout(() => rej(new Error('Firebase delete timeout')), 8_000)),
    ]);
    console.log(`[Tips] 🗑 Deleted: ${dateKey}/${tipId}`);
    res.json({ success: true, message: 'Tip deleted' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Payment routes ────────────────────────────────────────────────────────────
app.get('/api/debug-firebase', (req, res) => {
  const raw = process.env.FIREBASE_PRIVATE_KEY || '';
  const san = sanitizePrivateKey(raw) || '';
  res.json({
    firebase_connected: !!db, project_id_set: !!FIREBASE_PROJECT_ID,
    client_email_set: !!FIREBASE_CLIENT_EMAIL, client_email: FIREBASE_CLIENT_EMAIL,
    private_key_raw_length: raw.length, private_key_san_length: san.length,
    has_begin_header: san.includes('-----BEGIN PRIVATE KEY-----'),
    has_end_footer:   san.includes('-----END PRIVATE KEY-----'),
  });
});

app.get('/api/test', async (req, res) => {
  if (!API_KEY) return res.status(500).json({ success: false, message: 'PAYNECTA_API_KEY not set' });
  try {
    const response = await axios.get(`${PAYNECTA_URL}/me`, {
      headers: paynectaHeaders(), validateStatus: () => true, timeout: 10000,
    });
    const ok = response.status < 400;
    res.status(ok ? 200 : 400).json({ success: ok, status: response.status,
      message: ok ? 'Paynecta API Key valid ✅' : 'Paynecta API Key rejected ❌' });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/pay', async (req, res) => {
  const { phone, userId } = req.body;
  if (!phone) return res.status(400).json({ success: false, error: 'Phone number required' });
  if (!API_KEY || !USER_EMAIL || !MERCHANT_CODE)
    return res.status(500).json({ success: false, error: 'Server misconfigured – missing Paynecta credentials' });
  const mobile = normalisePhone(phone);
  try {
    const payload = {
      code: MERCHANT_CODE, mobile_number: mobile, amount: PRO_PRICE,
      description: 'Bett Officials Pro Tips Unlock',
      callback_url: `${SERVER_BASE}/api/webhook`,
    };
    const response = await axios.post(`${PAYNECTA_URL}/payment/initialize`, payload, {
      headers: paynectaHeaders(), timeout: 15000,
    });
    const txRef = response.data?.data?.transaction_reference ||
                  response.data?.data?.CheckoutRequestID     ||
                  response.data?.transaction_reference       ||
                  `BETT-${Date.now()}`;
    if (db) {
      await db.ref(`proPayments/${txRef}`).set({
        phone: mobile, amount: PRO_PRICE, userId: userId || null,
        txRef, status: 'pending', createdAt: new Date().toISOString(),
      }).catch(err => console.error('[STK] Firebase write failed:', err.message));
    }
    sendTelegram(`📱 <b>STK PUSH SENT</b>\n📞 ${mobile}\n💰 Ksh ${PRO_PRICE}\n🆔 ${txRef}`);
    res.json({ success: true, reference: txRef, message: 'STK push sent. Check your phone.' });
  } catch (err) {
    console.error('[STK] Error:', err.response?.data || err.message);
    res.status(400).json({ success: false, error: 'Failed to initiate payment. Try again.' });
  }
});

app.post('/api/stk-push', async (req, res) => { req.url = '/pay'; app._router.handle(req, res); });

app.get('/pay/status/:txRef', async (req, res) => {
  const { txRef } = req.params;
  if (!txRef || txRef.length < 5) return res.status(400).json({ success: false, error: 'Invalid txRef' });
  if (!db) return res.status(503).json({ success: false, error: 'Firebase not configured' });
  try {
    const snap = await db.ref(`proPayments/${txRef}`).once('value');
    if (!snap.exists()) return res.json({ success: true, status: 'pending' });
    const data   = snap.val();
    const status = (data.status === 'completed' || data.status === 'confirmed') ? 'completed' : (data.status || 'pending');
    return res.json({ success: true, status, unlocked: status === 'completed' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Could not check status' });
  }
});

app.get('/api/pay/status/:txRef', async (req, res) => {
  req.url = `/pay/status/${req.params.txRef}`; app._router.handle(req, res);
});

app.post('/api/webhook', async (req, res) => {
  res.json({ received: true });
  try {
    const payload   = req.body;
    const data      = payload.data || {};
    const tx        = data.transaction || {};
    const txRef     = tx.reference || data.reference || payload.reference || null;
    const rawStatus = tx.status || data.status || payload.status;
    const eventType = payload.event_type || payload.event;
    const mpesaCode = data.MpesaReceiptNumber || data.mpesa_receipt || null;
    const mobile    = data.customer?.mobile_number || data.phone || null;
    console.log('[Webhook]', { eventType, txRef, rawStatus, mpesaCode });
    if (!db || !txRef) return;
    const isCompleted = eventType === 'payment.completed' || ['completed','confirmed','success'].includes(rawStatus);
    const isFailed    = eventType === 'payment.failed'    || ['failed','cancelled','timeout'].includes(rawStatus);
    if (isCompleted) {
      await db.ref(`proPayments/${txRef}`).update({ status: 'completed', mpesaCode, completedAt: new Date().toISOString() });
      const paySnap  = await db.ref(`proPayments/${txRef}`).once('value');
      const payData  = paySnap.val();
      const safePhone = (payData.phone || mobile || '').replace(/\D/g, '');
      if (safePhone) {
        await db.ref(`proSubscribers/${safePhone}`).set({
          phone: payData.phone || mobile, txRef, mpesaCode,
          unlockedAt: new Date().toISOString(), amount: payData.amount || PRO_PRICE,
        });
      }
      sendTelegram(`💚 <b>PAYMENT CONFIRMED</b>\n📞 ${payData.phone || mobile}\n💰 Ksh ${payData.amount || PRO_PRICE}\n🧾 ${mpesaCode}\n🆔 ${txRef}`);
    } else if (isFailed) {
      await db.ref(`proPayments/${txRef}`).update({ status: 'failed', failedAt: new Date().toISOString() });
      sendTelegram(`❌ <b>PAYMENT FAILED</b>\n🆔 ${txRef}\n📞 ${mobile || '—'}`);
    } else {
      await db.ref(`proPayments/${txRef}`).update({ lastEvent: eventType, lastRawStatus: rawStatus });
    }
  } catch (err) {
    console.error('[Webhook] Error:', err.message);
  }
});

app.get('/pro/check/:phone', async (req, res) => {
  const phone = req.params.phone.replace(/\D/g, '');
  if (!phone) return res.status(400).json({ success: false, error: 'Invalid phone' });
  if (!db)    return res.status(503).json({ success: false, error: 'Firebase not configured' });
  try {
    const snap = await db.ref(`proSubscribers/${phone}`).once('value');
    res.json({ success: true, isPro: snap.exists(), data: snap.exists() ? snap.val() : null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Payment alias routes ───────────────────────────────────────────────────────
app.post('/api/payment/stk-push', async (req, res) => {
  const { phone, amount, tipId, pkg, description } = req.body;
  if (!phone) return res.status(400).json({ success: false, error: 'Phone number required' });
  if (!API_KEY || !USER_EMAIL || !MERCHANT_CODE)
    return res.status(500).json({ success: false, error: 'Server misconfigured – missing Paynecta credentials' });

  function toPaynectaPhone(raw) {
    let p = raw.toString().replace(/\D/g, '');
    if (p.startsWith('0'))   p = '254' + p.slice(1);
    if (p.startsWith('7') || p.startsWith('1')) p = '254' + p;
    return p;
  }
  const mobile = toPaynectaPhone(phone);
  const payAmount = amount || PRO_PRICE;

  try {
    const payload = {
      code: MERCHANT_CODE, mobile_number: mobile, amount: payAmount,
      description: description || 'BettOfficials Prediction Unlock',
      callback_url: `${SERVER_BASE}/api/webhook`,
    };
    const response = await axios.post(`${PAYNECTA_URL}/payment/initialize`, payload, {
      headers: paynectaHeaders(), timeout: 15000,
    });
    const txRef =
      response.data?.data?.transaction_reference ||
      response.data?.data?.CheckoutRequestID     ||
      response.data?.transaction_reference       ||
      `BETT-${Date.now()}`;
    if (db) {
      await db.ref(`proPayments/${txRef}`).set({
        phone: mobile, amount: payAmount, txRef,
        tipId: tipId || null, pkg: pkg || 'single',
        status: 'pending', createdAt: new Date().toISOString(),
      }).catch(err => console.error('[STK] Firebase write failed:', err.message));
    }
    sendTelegram(`📱 <b>STK PUSH</b>\n📞 ${mobile}\n💰 Ksh ${payAmount}\n🎯 Tip: ${tipId || '—'}\n🆔 ${txRef}`);
    res.json({ success: true, checkoutRequestId: txRef, reference: txRef, message: 'STK push sent. Check your phone.' });
  } catch (err) {
    console.error('[STK] Error:', err.response?.data || err.message);
    res.status(400).json({ success: false, error: 'Failed to initiate payment. Try again.' });
  }
});

app.get('/api/payment/status', async (req, res) => {
  const checkoutId = req.query.checkoutId;
  if (!checkoutId) return res.status(400).json({ success: false, error: 'checkoutId required' });
  if (!db) return res.status(503).json({ success: false, error: 'Firebase not configured' });
  try {
    const snap = await db.ref(`proPayments/${checkoutId}`).once('value');
    if (!snap.exists()) return res.json({ success: true, status: 'pending', paid: false });
    const data   = snap.val();
    const isPaid = data.status === 'completed' || data.status === 'confirmed';
    return res.json({ success: true, status: isPaid ? 'completed' : (data.status || 'pending'), paid: isPaid, tipId: data.tipId || null, pkg: data.pkg || 'single' });
  } catch (err) {
    res.status(500).json({ success: false, error: 'Could not check status' });
  }
});

app.post('/api/payment/verify-bypass', async (req, res) => {
  const { code, tipId } = req.body;
  if (!code) return res.status(400).json({ success: false, error: 'code required' });
  if (!db)   return res.status(503).json({ success: false, error: 'Firebase not configured' });
  const cleanCode = code.trim().toUpperCase();
  try {
    const snap = await db.ref('proPayments').orderByChild('mpesaCode').equalTo(cleanCode).once('value');
    if (!snap.exists()) {
      const subSnap = await db.ref('proSubscribers').once('value');
      const subs    = subSnap.val() || {};
      const match   = Object.values(subs).find(s => s.mpesaCode === cleanCode);
      if (!match) return res.json({ success: false, error: 'Code not found. If you just paid, wait 30 seconds and try again.' });
      sendTelegram(`🔓 <b>BYPASS UNLOCK (subscriber)</b>\n🧾 ${cleanCode}\n🎯 Tip: ${tipId || '—'}`);
      return res.json({ success: true, message: 'Verified via subscriber record', pkg: 'single' });
    }
    const records = Object.values(snap.val());
    const record  = records[0];
    if (record.status !== 'completed' && record.status !== 'confirmed')
      return res.json({ success: false, error: 'Payment found but not yet confirmed. Wait a moment.' });
    sendTelegram(`🔓 <b>BYPASS UNLOCK</b>\n🧾 ${cleanCode}\n📞 ${record.phone || '—'}\n🎯 Tip: ${tipId || '—'}`);
    return res.json({ success: true, message: 'Payment verified', pkg: record.pkg || 'single', tipId: record.tipId });
  } catch (err) {
    console.error('[Bypass] Error:', err.message);
    res.status(500).json({ success: false, error: 'Verification failed. Try again.' });
  }
});

// ══════════════════════════════════════════════════════════════════════════
// FIX 2 + FIX 6: AI Proxy — primary model + fallback, hard timeout guard,
// better error messages that tell the frontend exactly what went wrong.
// ══════════════════════════════════════════════════════════════════════════
async function callOpenRouter(prompt, model, timeoutMs) {
  const payload = {
    model,
    max_tokens: 1024,
    messages: [
      {
        role: 'system',
        content: 'You are an expert football analyst and sports betting advisor. Analyze statistical data and provide structured match predictions. Be concise, data-driven, and direct. Format your response with clear sections using ### for headers. Use bullet points for lists.',
      },
      { role: 'user', content: prompt },
    ],
  };

  const controller = new AbortController();
  const timer      = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await axios.post(OPENROUTER_URL, payload, {
      headers: {
        'Authorization': `Bearer ${OPENROUTER_API_KEY}`,
        'Content-Type':  'application/json',
        'HTTP-Referer':  process.env.SERVER_URL || 'https://your-app.onrender.com',
        'X-Title':       'Bett Officials',
      },
      timeout: timeoutMs + 2000, // axios timeout slightly longer than abort
      signal:  controller.signal,
    });
    clearTimeout(timer);
    const text = response.data?.choices?.[0]?.message?.content || '';
    return { text, model, status: response.status };
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

app.post('/api/grok/predict', async (req, res) => {
  const { prompt } = req.body;
  if (!prompt)             return res.status(400).json({ success: false, error: 'prompt is required' });
  if (!OPENROUTER_API_KEY) return res.status(503).json({ success: false, error: 'OPENROUTER_API_KEY not configured on server' });

  // FIX 2: Try primary model first, then fallback model
  const models = [AI_MODEL, AI_MODEL_FALLBACK].filter(Boolean);

  for (let i = 0; i < models.length; i++) {
    const model     = models[i];
    const isFallback = i > 0;
    // Give fallback model slightly less time since we've already spent some
    const budget    = isFallback ? Math.max(AI_TIMEOUT_MS - 5000, 10_000) : AI_TIMEOUT_MS;

    try {
      console.log(`[AI] Trying model: ${model}${isFallback ? ' (fallback)' : ''} timeout:${budget}ms`);
      const { text, status } = await callOpenRouter(prompt, model, budget);

      if (!text) {
        console.warn(`[AI] Empty response from ${model}`);
        if (i < models.length - 1) continue; // try next model
        return res.status(502).json({ success: false, error: 'AI returned an empty response. Try again.' });
      }

      console.log(`[AI] ✅ Done — ${text.length} chars, model: ${model}`);
      return res.json({ success: true, text, model });

    } catch (err) {
      const isTimeout = err.code === 'ECONNABORTED' || err.name === 'AbortError' || err.message?.includes('timeout') || err.message?.includes('aborted');
      const status    = err.response?.status;
      const detail    = err.response?.data;
      const message   = detail?.error?.message || detail?.message || err.message;

      console.error(`[AI] ❌ model=${model} status=${status || 'N/A'} err=${message}`);

      // FIX 2: Specific error classification for better frontend messages
      if (status === 402 || message?.toLowerCase().includes('credit') || message?.toLowerCase().includes('quota')) {
        // Out of credits — try fallback model
        console.warn(`[AI] Credits exhausted on ${model} — trying fallback`);
        if (i < models.length - 1) continue;
        return res.status(402).json({ success: false, error: 'AI credits exhausted. Please top up OpenRouter credits.', code: 'NO_CREDITS' });
      }

      if (status === 429) {
        // Rate limited — try fallback
        console.warn(`[AI] Rate limited on ${model} — trying fallback`);
        if (i < models.length - 1) continue;
        return res.status(429).json({ success: false, error: 'AI rate limit hit. Wait a moment and retry.', code: 'RATE_LIMITED' });
      }

      if (isTimeout) {
        console.warn(`[AI] Timeout on ${model} — trying fallback`);
        if (i < models.length - 1) continue;
        return res.status(504).json({ success: false, error: `AI timed out after ${AI_TIMEOUT_MS / 1000}s. The model may be overloaded — try again.`, code: 'TIMEOUT' });
      }

      // Unknown error — try fallback once
      if (i < models.length - 1) continue;
      return res.status(status || 500).json({ success: false, error: message, detail: detail || null });
    }
  }
});

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Bett Officials server on port ${PORT}`);
  console.log(`⚽ ESPN Sync: ${ALL_SLUGS.length} leagues monitored`);
  console.log(`🤖 AI model: ${AI_MODEL} | Fallback: ${AI_MODEL_FALLBACK} | Timeout: ${AI_TIMEOUT_MS}ms`);
  console.log(`📡 Routes: GET / | GET /health | POST /api/tips/post | GET /api/tips/public | DELETE /api/tips/:date/:id`);
  console.log(`📡 Routes: /api/espn/search | /api/espn/search-all | /api/espn/sync-status`);
  console.log(`📡 Routes: POST /pay | GET /pay/status/:txRef | POST /api/webhook | GET /pro/check/:phone`);
});
