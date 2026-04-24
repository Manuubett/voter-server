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

// ── Firebase Realtime Database init (NOT Firestore!) ─────────────────────────
let db;
const {
  FIREBASE_PROJECT_ID,
  FIREBASE_CLIENT_EMAIL,
  FIREBASE_PRIVATE_KEY,
  FIREBASE_DATABASE_URL,
} = process.env;

if (FIREBASE_PROJECT_ID && FIREBASE_CLIENT_EMAIL && FIREBASE_PRIVATE_KEY && FIREBASE_DATABASE_URL) {
  try {
    const privateKey = sanitizePrivateKey(FIREBASE_PRIVATE_KEY);
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId:   FIREBASE_PROJECT_ID,
        clientEmail: FIREBASE_CLIENT_EMAIL,
        privateKey,
      }),
      databaseURL: FIREBASE_DATABASE_URL,
    });
    db = admin.database();
    console.log('✅ Firebase Realtime Database connected');
  } catch (err) {
    console.error('❌ Firebase init failed:', err.message);
  }
} else {
  console.warn('⚠️  Firebase not configured — missing FIREBASE_DATABASE_URL');
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
// ESPN SYNC — delegated entirely to espn-sync.js
// All /api/espn/* routes and the 60s cron live there.
// ════════════════════════════════════════════════════════════════════════════
const { registerRoutes } = require('./espn-sync');
registerRoutes(app);

// ════════════════════════════════════════════════════════════════════════════
// GENERAL ROUTES
// ════════════════════════════════════════════════════════════════════════════

app.get('/', (req, res) => {
  res.json({
    status:   'ok',
    service:  'Bett Officials API',
    time:     new Date().toISOString(),
    firebase: db ? 'connected' : 'not configured',
    paynecta: API_KEY ? 'configured' : 'missing key',
    price:    `KES ${PRO_PRICE}`,
    espnSync: 'active — see /api/espn/sync-status',
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

// ════════════════════════════════════════════════════════════════════════════
// PAYMENT ROUTES
// ════════════════════════════════════════════════════════════════════════════

// ── Shared STK push handler ───────────────────────────────────────────────────
async function handleStkPush(req, res) {
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
      await db.ref(`proPayments/${txRef}`).set({
        phone:     mobile,
        amount:    PRO_PRICE,
        userId:    userId || null,
        txRef,
        status:    'pending',
        createdAt: new Date().toISOString(),
      }).catch(err => console.error('[STK] Firebase write failed:', err.message));
    }

    console.log('[STK] ✅ txRef:', txRef);
    sendTelegram(`📱 <b>STK PUSH SENT</b>\n📞 ${mobile}\n💰 Ksh ${PRO_PRICE}\n🆔 ${txRef}`);

    res.json({ success: true, reference: txRef, message: 'STK push sent. Check your phone.' });
  } catch (err) {
    const errData = err.response?.data || err.message;
    console.error('[STK] Error:', errData);
    res.status(400).json({ success: false, error: 'Failed to initiate payment. Try again.' });
  }
}

// Both paths, one handler
app.post('/pay',          handleStkPush);
app.post('/api/stk-push', handleStkPush);

// ── Shared payment status handler ─────────────────────────────────────────────
async function handlePayStatus(req, res) {
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
    console.error('[STATUS] Error:', err.message);
    res.status(500).json({ success: false, error: 'Could not check status' });
  }
}

// Both paths, one handler
app.get('/pay/status/:txRef',     handlePayStatus);
app.get('/api/pay/status/:txRef', handlePayStatus);

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
      await db.ref(`proPayments/${txRef}`).update({
        status: 'completed', mpesaCode, completedAt: new Date().toISOString()
      });

      const paySnap = await db.ref(`proPayments/${txRef}`).once('value');
      const payData = paySnap.val();
      const safePhone = (payData.phone || mobile || '').replace(/\D/g, '');
      if (safePhone) {
        await db.ref(`proSubscribers/${safePhone}`).set({
          phone: payData.phone || mobile, txRef, mpesaCode,
          unlockedAt: new Date().toISOString(), amount: payData.amount || PRO_PRICE,
        });
        console.log(`✅ Pro unlocked — ${safePhone}`);
      }
      sendTelegram(`💚 <b>PAYMENT CONFIRMED</b>\n📞 ${payData.phone || mobile}\n💰 Ksh ${payData.amount || PRO_PRICE}\n🧾 ${mpesaCode}\n🆔 ${txRef}`);

    } else if (isFailed) {
      await db.ref(`proPayments/${txRef}`).update({ status: 'failed', failedAt: new Date().toISOString() });
      console.log(`❌ Payment failed — ${txRef}`);
      sendTelegram(`❌ <b>PAYMENT FAILED</b>\n🆔 ${txRef}\n📞 ${mobile || '—'}`);

    } else {
      await db.ref(`proPayments/${txRef}`).update({ lastEvent: eventType, lastRawStatus: rawStatus });
      console.log(`ℹ️ Unhandled event: ${eventType}`);
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

// ════════════════════════════════════════════════════════════════════════════
// START
// ════════════════════════════════════════════════════════════════════════════

app.listen(PORT, () => {
  console.log(`✅ Bett Officials server running on port ${PORT}`);
  console.log(`💰 Pro price: KES ${PRO_PRICE}`);
  console.log(`🔗 Webhook URL: ${SERVER_BASE}/api/webhook`);
  console.log(`📡 ESPN Sync: delegated to espn-sync.js`);
  console.log(`📊 Sync status: /api/espn/sync-status`);
});
