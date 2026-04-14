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
  if (!key.includes('-----BEGIN PRIVATE KEY-----')) {
    key = '-----BEGIN PRIVATE KEY-----\n' + key;
  }
  if (!key.includes('-----END PRIVATE KEY-----')) {
    key = key.trimEnd() + '\n-----END PRIVATE KEY-----\n';
  }
  key = key
    .replace(/-----BEGIN PRIVATE KEY-----\s*/g, '-----BEGIN PRIVATE KEY-----\n')
    .replace(/\s*-----END PRIVATE KEY-----/g, '\n-----END PRIVATE KEY-----')
    .replace(/\n{3,}/g, '\n');
  return key;
}

// ── Firebase init ─────────────────────────────────────────────────────────────
let db;
const {
  FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY,
} = process.env;

if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY) {
  try {
    const privateKey = sanitizePrivateKey(FIREBASE_PRIVATE_KEY);
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey,
      }),
    });
    db = admin.firestore();
    console.log('✅ Firebase (Firestore) connected');
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
    else console.warn('[Telegram] ⚠️  Not ok:', JSON.stringify(res.data));
  } catch (err) {
    console.error('[Telegram] ❌ Failed:', err.response?.data || err.message);
  }
}

// ── App setup ─────────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: '*' }));
app.use(express.json());

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
  if (p.startsWith('0'))                       p = '254' + p.slice(1);
  if (p.startsWith('7') || p.startsWith('1'))  p = '254' + p;
  if (!p.startsWith('254'))                    p = '254' + p;
  return p;
}

// ════════════════════════════════════════════════════════════════════════════
// ESPN SYNC MODULE
// ════════════════════════════════════════════════════════════════════════════

const ESPN_BASE = 'https://site.api.espn.com/apis/site/v2/sports/soccer';

// League name → ESPN slug mapping
// Add more slugs as needed: https://site.api.espn.com/apis/site/v2/sports/soccer/{slug}/scoreboard
const LEAGUE_SLUGS = {
  // Full names (what admin types)
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

/**
 * Classify a tip result from ESPN match data.
 * Supports: Home Win/1, Away Win/2, Draw/X, BTTS, Over N.N, Under N.N, 1X, X2, 12
 */
function classify(prediction, score, winner) {
  if (!prediction || !score) return null;
  const p   = prediction.trim().toLowerCase();
  const hg  = score.home;
  const ag  = score.away;
  const tot = hg + ag;

  if (p === 'home win' || p === '1')                    return winner === 'home' ? 'right' : 'wrong';
  if (p === 'away win' || p === '2')                    return winner === 'away' ? 'right' : 'wrong';
  if (p === 'draw' || p === 'x')                        return winner === 'draw' ? 'right' : 'wrong';
  if (p === '1x')                                       return (winner === 'home' || winner === 'draw') ? 'right' : 'wrong';
  if (p === 'x2')                                       return (winner === 'away' || winner === 'draw') ? 'right' : 'wrong';
  if (p === '12')                                       return (winner === 'home' || winner === 'away') ? 'right' : 'wrong';
  if (p === 'btts' || p === 'gg' || p.includes('gg (btts)') || p.includes('both teams to score'))
                                                        return (hg > 0 && ag > 0) ? 'right' : 'wrong';
  if (p === 'ng' || p.includes('no btts'))              return (hg === 0 || ag === 0) ? 'right' : 'wrong';
  if (p.startsWith('over')) {
    const line = parseFloat(p.replace(/[^0-9.]/g, ''));
    if (!isNaN(line)) return tot > line ? 'right' : 'wrong';
  }
  if (p.startsWith('under')) {
    const line = parseFloat(p.replace(/[^0-9.]/g, ''));
    if (!isNaN(line)) return tot < line ? 'right' : 'wrong';
  }
  return null; // unknown market — leave as pending
}

/**
 * Fetch ESPN scoreboard for a given league slug.
 */
async function fetchESPNScoreboard(slug) {
  const url = `${ESPN_BASE}/${slug}/scoreboard`;
  const res = await axios.get(url, {
    headers: { 'User-Agent': 'BettOfficials/1.0' },
    timeout: 10000,
  });
  return res.data;
}

/**
 * Parse a raw ESPN event object into a clean data structure.
 */
function parseESPNEvent(ev) {
  const comp       = ev.competitions?.[0];
  const statusType = ev.status?.type;
  const home       = comp?.competitors?.find(c => c.homeAway === 'home');
  const away       = comp?.competitors?.find(c => c.homeAway === 'away');

  const homeScore  = parseInt(home?.score ?? '-1', 10);
  const awayScore  = parseInt(away?.score ?? '-1', 10);
  const hasScore   = homeScore >= 0 && awayScore >= 0;

  let winner = null;
  if (hasScore && statusType?.completed) {
    if      (homeScore > awayScore) winner = 'home';
    else if (awayScore > homeScore) winner = 'away';
    else                            winner = 'draw';
  }

  return {
    espnId:     String(ev.id),
    isLive:     statusType?.state === 'in',
    isFinished: !!statusType?.completed,
    clock:      ev.status?.displayClock || null,
    period:     ev.status?.period || null,
    score:      hasScore ? { home: homeScore, away: awayScore } : null,
    scoreStr:   hasScore ? `${homeScore} - ${awayScore}` : null,
    winner,
    homeName:   home?.team?.displayName || '',
    awayName:   away?.team?.displayName || '',
    shortName:  ev.shortName || `${home?.team?.abbreviation || '?'} vs ${away?.team?.abbreviation || '?'}`,
    startTime:  ev.date || null,
  };
}

/**
 * Main sync function — reads today's Firestore tips, fetches ESPN, writes back scores/results.
 */
async function espnSyncDay() {
  if (!db) return;

  const todayKey = new Date().toISOString().split('T')[0];
  const tipsRef  = db.collection('tips').doc(todayKey);

  let snap;
  try { snap = await tipsRef.get(); } catch (e) { console.error('[ESPN] Firestore read error:', e.message); return; }
  if (!snap.exists) return;

  const data = snap.data() || {};

  // Collect ESPN IDs and league slugs needed
  const espnIdSet = new Set();
  const leagueSet = new Set();

  for (const leagueKey of Object.keys(data)) {
    const tips = data[leagueKey]?.tips || {};
    for (const tip of Object.values(tips)) {
      if (tip?.espnId) { espnIdSet.add(String(tip.espnId)); leagueSet.add(leagueKey); }
    }
  }

  if (!espnIdSet.size) return; // nothing to sync

  // Fetch ESPN events for each relevant league
  const eventMap = {};
  for (const leagueKey of leagueSet) {
    const slug = LEAGUE_SLUGS[leagueKey];
    if (!slug) { console.warn(`[ESPN] No slug for: "${leagueKey}"`); continue; }
    try {
      const json   = await fetchESPNScoreboard(slug);
      const events = json?.events || [];
      for (const ev of events) {
        const parsed = parseESPNEvent(ev);
        eventMap[parsed.espnId] = parsed;
      }
      console.log(`[ESPN] ${leagueKey} (${slug}): ${events.length} events`);
    } catch (err) {
      console.error(`[ESPN] Failed to fetch ${leagueKey}:`, err.message);
    }
  }

  // Build Firestore field-level updates
  const updates = {};
  let   changed = 0;

  for (const leagueKey of Object.keys(data)) {
    const tips = data[leagueKey]?.tips || {};
    for (const [tipId, tip] of Object.entries(tips)) {
      if (!tip?.espnId) continue;
      const ev = eventMap[String(tip.espnId)];
      if (!ev) continue;

      const pfx = `${leagueKey}.tips.${tipId}`;

      if (ev.scoreStr) {
        updates[`${pfx}.liveScore`] = ev.scoreStr;
        updates[`${pfx}.outcome`]   = ev.scoreStr;
      }
      updates[`${pfx}.isLive`]     = ev.isLive;
      updates[`${pfx}.isFinished`] = ev.isFinished;
      if (ev.clock)  updates[`${pfx}.clock`]  = ev.clock;
      if (ev.period) updates[`${pfx}.period`] = ev.period;

      // Auto-classify result only when finished and not already set
      if (ev.isFinished && ev.winner && tip.result !== 'right' && tip.result !== 'wrong') {
        const verdict = classify(tip.prediction, ev.score, ev.winner);
        if (verdict) {
          updates[`${pfx}.result`] = verdict;
          console.log(`[ESPN] Auto-result: ${tip.matchup} → ${verdict} (${ev.scoreStr})`);
        }
      }
      changed++;
    }
  }

  if (changed > 0) {
    try {
      await tipsRef.update(updates);
      console.log(`[ESPN] ✅ Updated ${changed} tips for ${todayKey}`);
    } catch (err) {
      console.error('[ESPN] Firestore update error:', err.message);
    }
  }

  // Write daily stats summary
  try {
    let total=0, wins=0, losses=0, live=0;
    for (const lk of Object.keys(data)) {
      for (const t of Object.values(data[lk]?.tips || {})) {
        if (!t) continue; total++;
        if (t.result === 'right') wins++;
        if (t.result === 'wrong') losses++;
        if (t.isLive)             live++;
      }
    }
    const wr = (wins+losses) > 0 ? Math.round(wins/(wins+losses)*100) : null;
    await db.collection('stats').doc(todayKey).set(
      { total, wins, losses, live, winRate: wr, updatedAt: admin.firestore.FieldValue.serverTimestamp() },
      { merge: true }
    );
  } catch(e) { /* non-critical */ }
}

// Start ESPN cron — every 60 seconds
const ESPN_INTERVAL = 60_000;
console.log('[ESPN] Cron starting — syncing every 60s');
setTimeout(() => {
  espnSyncDay().catch(e => console.error('[ESPN] Initial sync error:', e.message));
  setInterval(() => espnSyncDay().catch(e => console.error('[ESPN] Cron error:', e.message)), ESPN_INTERVAL);
}, 5000); // 5s delay to let Firebase init settle

// ════════════════════════════════════════════════════════════════════════════
// ESPN PROXY ENDPOINTS  (used by admin panel for match lookup)
// ════════════════════════════════════════════════════════════════════════════

/**
 * GET /api/espn/search?slug=eng.1&q=Arsenal
 * Returns today's events for a league slug, optionally filtered by team name.
 * Used by admin panel "ESPN ID" lookup field.
 */
app.get('/api/espn/search', async (req, res) => {
  const { slug, q } = req.query;
  if (!slug) return res.status(400).json({ success: false, error: 'slug required' });
  try {
    const json   = await fetchESPNScoreboard(slug);
    let events   = (json?.events || []).map(parseESPNEvent);
    if (q) {
      const query = q.toLowerCase();
      events = events.filter(e =>
        e.homeName.toLowerCase().includes(query) ||
        e.awayName.toLowerCase().includes(query) ||
        e.shortName.toLowerCase().includes(query)
      );
    }
    res.json({ success: true, events });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

/**
 * GET /api/espn/leagues
 * Returns the full LEAGUE_SLUGS map so the admin panel can populate its dropdown.
 */
app.get('/api/espn/leagues', (req, res) => {
  res.json({ success: true, leagues: LEAGUE_SLUGS });
});

// ════════════════════════════════════════════════════════════════════════════
// EXISTING ROUTES (unchanged)
// ════════════════════════════════════════════════════════════════════════════

// ── Health / debug endpoints ──────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status:   'ok',
    service:  'Bett Officials API',
    time:     new Date().toISOString(),
    firebase: db ? 'connected' : 'not configured',
    paynecta: API_KEY ? 'configured' : 'missing key',
    price:    `KES ${PRO_PRICE}`,
    espnSync: 'active (60s interval)',
  });
});

app.get('/api/debug-firebase', (req, res) => {
  const raw = process.env.FIREBASE_PRIVATE_KEY || '';
  const sanitized = sanitizePrivateKey(raw) || '';
  res.json({
    firebase_connected:      !!db,
    project_id_set:          !!FIREBASE_PROJECT_ID,
    client_email_set:        !!FIREBASE_CLIENT_EMAIL,
    client_email:            FIREBASE_CLIENT_EMAIL,
    private_key_raw_length:  raw.length,
    private_key_san_length:  sanitized.length,
    has_begin_header:        sanitized.includes('-----BEGIN PRIVATE KEY-----'),
    has_end_footer:          sanitized.includes('-----END PRIVATE KEY-----'),
  });
});

app.get('/api/test', async (req, res) => {
  if (!API_KEY) return res.status(500).json({ success: false, message: 'PAYNECTA_API_KEY not set' });
  try {
    const response = await axios.get(`${PAYNECTA_URL}/me`, {
      headers: paynectaHeaders(),
      validateStatus: () => true,
      timeout: 10000,
    });
    const ok = response.status < 400;
    res.status(ok ? 200 : 400).json({
      success: ok,
      status:  response.status,
      message: ok ? 'Paynecta API Key valid ✅' : 'Paynecta API Key rejected ❌',
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── STK Push ──────────────────────────────────────────────────────────────────
app.post('/pay', async (req, res) => {
  const { phone, userId } = req.body;
  if (!phone) return res.status(400).json({ success: false, error: 'Phone number required' });

  if (!API_KEY || !USER_EMAIL || !MERCHANT_CODE) {
    return res.status(500).json({ success: false, error: 'Server misconfigured – missing Paynecta credentials' });
  }

  const mobile = normalisePhone(phone);
  try {
    const payload = {
      code:          MERCHANT_CODE,
      mobile_number: mobile,
      amount:        PRO_PRICE,
      description:   'Bett Officials Pro Tips Unlock',
      callback_url:  `${SERVER_BASE}/api/webhook`,
    };

    console.log('[STK] Sending:', { mobile, amount: PRO_PRICE });

    const response = await axios.post(`${PAYNECTA_URL}/payment/initialize`, payload, {
      headers: paynectaHeaders(),
      timeout: 15000,
    });

    const txRef = response.data?.data?.transaction_reference ||
                  response.data?.data?.CheckoutRequestID     ||
                  response.data?.transaction_reference       ||
                  `BETT-${Date.now()}`;

    if (db) {
      await db.collection('proPayments').doc(txRef).set({
        phone:     mobile,
        amount:    PRO_PRICE,
        userId:    userId || null,
        txRef,
        status:    'pending',
        createdAt: new Date().toISOString(),
      }).catch(err => console.error('[STK] Firestore write failed:', err.message));
    }

    console.log('[STK] ✅ txRef:', txRef);
    sendTelegram(`📱 <b>STK PUSH SENT</b>\n📞 ${mobile}\n💰 Ksh ${PRO_PRICE}\n🆔 ${txRef}`);

    res.json({ success: true, reference: txRef, message: 'STK push sent. Check your phone.' });
  } catch (err) {
    const errData = err.response?.data || err.message;
    console.error('[STK] Error:', errData);
    res.status(400).json({ success: false, error: 'Failed to initiate payment. Try again.' });
  }
});

// Legacy compat
app.post('/api/stk-push', async (req, res) => {
  req.url = '/pay';
  app._router.handle(req, res);
});

// ── Payment status ────────────────────────────────────────────────────────────
app.get('/pay/status/:txRef', async (req, res) => {
  const { txRef } = req.params;
  if (!txRef || txRef.length < 5) return res.status(400).json({ success: false, error: 'Invalid txRef' });
  if (!db) return res.status(503).json({ success: false, error: 'Firebase not configured' });

  try {
    const snap = await db.collection('proPayments').doc(txRef).get();
    if (!snap.exists) return res.json({ success: true, status: 'pending' });
    const data   = snap.data();
    const status = (data.status === 'completed' || data.status === 'confirmed') ? 'completed' : (data.status || 'pending');
    return res.json({ success: true, status, unlocked: status === 'completed' });
  } catch (err) {
    console.error('[STATUS] Error:', err.message);
    res.status(500).json({ success: false, error: 'Could not check status' });
  }
});

app.get('/api/pay/status/:txRef', async (req, res) => {
  req.url = `/pay/status/${req.params.txRef}`;
  app._router.handle(req, res);
});

// ── Webhook ───────────────────────────────────────────────────────────────────
app.post('/api/webhook', async (req, res) => {
  res.json({ received: true });

  try {
    const payload = req.body;
    const data    = payload.data || {};
    const tx      = data.transaction || {};

    const txRef      = tx.reference || data.reference || payload.reference || null;
    const rawStatus  = tx.status || data.status || payload.status;
    const eventType  = payload.event_type || payload.event;
    const mpesaCode  = data.MpesaReceiptNumber || data.mpesa_receipt || null;
    const mobile     = data.customer?.mobile_number || data.phone || null;

    console.log('[Webhook]', { eventType, txRef, rawStatus, mpesaCode });

    if (!db || !txRef) return;

    const isCompleted = eventType === 'payment.completed' || ['completed','confirmed','success'].includes(rawStatus);
    const isFailed    = eventType === 'payment.failed'    || ['failed','cancelled','timeout'].includes(rawStatus);

    if (isCompleted) {
      await db.collection('proPayments').doc(txRef).set({
        status: 'completed', mpesaCode, completedAt: new Date().toISOString()
      }, { merge: true });

      const paySnap  = await db.collection('proPayments').doc(txRef).get();
      const payData  = paySnap.data();
      const safePhone = (payData.phone || mobile || '').replace(/\D/g, '');
      if (safePhone) {
        await db.collection('proSubscribers').doc(safePhone).set({
          phone: payData.phone || mobile, txRef, mpesaCode,
          unlockedAt: new Date().toISOString(), amount: payData.amount || PRO_PRICE,
        });
        console.log(`✅ Pro unlocked — ${safePhone}`);
      }
      sendTelegram(`💚 <b>PAYMENT CONFIRMED</b>\n📞 ${payData.phone || mobile}\n💰 Ksh ${payData.amount || PRO_PRICE}\n🧾 ${mpesaCode}\n🆔 ${txRef}`);

    } else if (isFailed) {
      await db.collection('proPayments').doc(txRef).set({ status: 'failed', failedAt: new Date().toISOString() }, { merge: true });
      console.log(`❌ Payment failed — ${txRef}`);
      sendTelegram(`❌ <b>PAYMENT FAILED</b>\n🆔 ${txRef}\n📞 ${mobile || '—'}`);

    } else {
      await db.collection('proPayments').doc(txRef).set({ lastEvent: eventType, lastRawStatus: rawStatus }, { merge: true });
      console.log(`ℹ️ Unhandled event: ${eventType}`);
    }
  } catch (err) {
    console.error('[Webhook] Error:', err.message);
  }
});

// ── Pro check by phone ────────────────────────────────────────────────────────
app.get('/pro/check/:phone', async (req, res) => {
  const phone = req.params.phone.replace(/\D/g, '');
  if (!phone) return res.status(400).json({ success: false, error: 'Invalid phone' });
  if (!db)    return res.status(503).json({ success: false, error: 'Firebase not configured' });
  try {
    const snap = await db.collection('proSubscribers').doc(phone).get();
    res.json({ success: true, isPro: snap.exists, data: snap.exists ? snap.data() : null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Start server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Bett Officials server running on port ${PORT}`);
  console.log(`💰 Pro price: KES ${PRO_PRICE}`);
  console.log(`🔗 Webhook URL: ${SERVER_BASE}/api/webhook`);
  console.log(`📡 ESPN Sync: active`);
});
