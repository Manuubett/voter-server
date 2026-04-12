require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const axios   = require('axios');
const admin   = require('firebase-admin');

// ── Firebase private key sanitizer ───────────────────────────────────────────
function sanitizePrivateKey(raw) {
  if (!raw) return null;
  let key = raw;

  // 1. Trim outer whitespace
  key = key.trim();

  // 2. Strip surrounding quotes Render/env tools sometimes add
  key = key.replace(/^["'`]+|["'`]+$/g, '').trim();

  // 3. Replace literal \n with real newlines
  key = key.replace(/\\n/g, '\n');

  // 4. Ensure PEM header/footer exist
  if (!key.includes('-----BEGIN PRIVATE KEY-----')) {
    key = '-----BEGIN PRIVATE KEY-----\n' + key;
  }
  if (!key.includes('-----END PRIVATE KEY-----')) {
    key = key.trimEnd() + '\n-----END PRIVATE KEY-----\n';
  }

  // 5. Ensure newline immediately after header and before footer
  key = key
    .replace(/-----BEGIN PRIVATE KEY-----\s*/g, '-----BEGIN PRIVATE KEY-----\n')
    .replace(/\s*-----END PRIVATE KEY-----/g,   '\n-----END PRIVATE KEY-----')
    .replace(/\n{3,}/g, '\n'); // collapse triple+ newlines

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

    console.log('[Firebase] Project:    ', FIREBASE_PROJECT_ID);
    console.log('[Firebase] Email:      ', FIREBASE_CLIENT_EMAIL);
    console.log('[Firebase] Key starts: ', JSON.stringify(privateKey.substring(0, 40)));
    console.log('[Firebase] Key ends:   ', JSON.stringify(privateKey.slice(-40)));

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
    console.error('   Stack:', err.stack);
  }
} else {
  const missing = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY']
    .filter(k => !process.env[k]);
  console.warn('⚠️  Firebase not configured — missing:', missing.join(', '));
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

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({
    status:   'ok',
    service:  'Bett Officials API',
    time:     new Date().toISOString(),
    firebase: db ? 'connected' : 'not configured',
    paynecta: API_KEY ? 'configured' : 'missing key',
    price:    `KES ${PRO_PRICE}`,
  });
});

// ── Debug Firebase key — safe, never exposes actual key value ─────────────────
// Visit GET /api/debug-firebase on Render to diagnose key issues
app.get('/api/debug-firebase', (req, res) => {
  const raw       = process.env.FIREBASE_PRIVATE_KEY || '';
  const sanitized = sanitizePrivateKey(raw) || '';
  res.json({
    firebase_connected:      !!db,
    project_id_set:          !!FIREBASE_PROJECT_ID,
    client_email_set:        !!FIREBASE_CLIENT_EMAIL,
    private_key_raw_length:  raw.length,
    private_key_san_length:  sanitized.length,
    has_begin_header:        sanitized.includes('-----BEGIN PRIVATE KEY-----'),
    has_end_footer:          sanitized.includes('-----END PRIVATE KEY-----'),
    raw_starts_with:         JSON.stringify(raw.substring(0, 10)),
    sanitized_starts_with:   JSON.stringify(sanitized.substring(0, 40)),
    sanitized_ends_with:     JSON.stringify(sanitized.slice(-40)),
    newline_count:           (sanitized.match(/\n/g) || []).length,
  });
});

// ── Test Paynecta key ─────────────────────────────────────────────────────────
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
      data:    response.data,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── POST /pay — Initiate STK Push ─────────────────────────────────────────────
app.post('/pay', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ success: false, error: 'Phone number required' });

  if (!API_KEY || !USER_EMAIL || !MERCHANT_CODE) {
    return res.status(500).json({
      success: false,
      error: 'Server misconfigured — PAYNECTA_API_KEY, PAYNECTA_EMAIL, PAYNECTA_CODE must be set',
    });
  }

  const digits = phone.replace(/\D/g, '');
  if (digits.length < 9 || digits.length > 13) {
    return res.status(400).json({ success: false, error: 'Invalid phone number format' });
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

    // Extract txRef — handle all known Paynecta response shapes
    const txRef =
      response.data?.data?.transaction_reference ||
      response.data?.data?.CheckoutRequestID     ||
      response.data?.transaction_reference       ||
      response.data?.reference                   ||
      `BETT-${Date.now()}`;

    if (db) {
      try {
        await db.collection('proPayments').doc(txRef).set({
          phone:     mobile,
          amount:    PRO_PRICE,
          txRef,
          status:    'pending',
          createdAt: new Date().toISOString(),
        });
        console.log('[STK] Firestore record saved — txRef:', txRef);
      } catch (fsErr) {
        // Firebase write failed but STK push already sent — don't fail the request
        console.error('[STK] ⚠️  Firestore write failed (STK still sent):', fsErr.message);
      }
    }

    console.log('[STK] ✅ — txRef:', txRef);

    sendTelegram(
      `📱 <b>STK PUSH SENT</b>\n\n` +
      `📞 Phone: <code>${mobile}</code>\n` +
      `💰 Amount: Ksh ${PRO_PRICE}\n` +
      `🆔 txRef: <code>${txRef}</code>\n` +
      `⏰ ${new Date().toLocaleString('en-KE')}`
    );

    res.json({
      success:   true,
      reference: txRef,
      message:   'STK push sent. Enter M-Pesa PIN on your phone.',
    });

  } catch (err) {
    const errData = err.response?.data || err.message;
    console.error('[STK] Error:', errData);
    res.status(400).json({
      success: false,
      error:   err.response?.data?.message || 'Failed to initiate payment. Try again.',
    });
  }
});

// ── GET /pay/status/:txRef — Poll payment status ──────────────────────────────
app.get('/pay/status/:txRef', async (req, res) => {
  const { txRef } = req.params;
  if (!txRef || txRef.length < 5) {
    return res.status(400).json({ success: false, error: 'Invalid txRef' });
  }
  if (!db) return res.status(503).json({ success: false, error: 'Firebase not configured' });

  try {
    const snap = await db.collection('proPayments').doc(txRef).get();
    if (!snap.exists) return res.json({ success: true, status: 'pending' });

    const data   = snap.data();
    const status = (data.status === 'completed' || data.status === 'confirmed')
      ? 'completed'
      : data.status || 'pending';

    console.log('[STATUS]', status, '— txRef:', txRef);
    return res.json({ success: true, status, unlocked: status === 'completed' });
  } catch (err) {
    console.error('[STATUS] Error:', err.message);
    res.status(500).json({ success: false, error: 'Could not check status' });
  }
});

// ── POST /api/webhook — Paynecta callback ─────────────────────────────────────
app.post('/api/webhook', async (req, res) => {
  res.json({ received: true }); // ACK immediately

  try {
    const payload   = req.body;
    const data      = payload.data || {};
    const tx        = data.transaction || {};

    const txRef =
      tx.reference               ||
      tx.transaction_reference   ||
      data.reference             ||
      data.transaction_reference ||
      payload.reference          ||
      null;

    const rawStatus = tx.status || data.status || payload.status;
    const eventType = payload.event_type || payload.event || payload.type;
    const mpesaCode = data.MpesaReceiptNumber || data.mpesa_receipt || null;
    const amount    = data.Amount || data.amount || null;
    const mobile    = data.customer?.mobile_number || data.phone || null;

    console.log('[Webhook]', JSON.stringify({ eventType, txRef, rawStatus, mpesaCode }));

    if (!db || !txRef) {
      console.warn('[Webhook] Skipping — missing db or txRef');
      return;
    }

    const isCompleted =
      eventType === 'payment.completed' ||
      ['completed','confirmed','success','SUCCESS','COMPLETE'].includes(rawStatus);

    const isFailed =
      eventType === 'payment.failed' ||
      ['failed','FAILED','cancelled','CANCELLED','timeout','TIMEOUT'].includes(rawStatus);

    if (isCompleted) {
      try {
        await db.collection('proPayments').doc(txRef).set(
          { status: 'completed', mpesaCode, completedAt: new Date().toISOString() },
          { merge: true }
        );

        const paySnap   = await db.collection('proPayments').doc(txRef).get();
        const payData   = paySnap.exists ? paySnap.data() : {};
        const safePhone = (payData.phone || mobile || '').replace(/[^0-9]/g, '');

        if (safePhone) {
          await db.collection('proSubscribers').doc(safePhone).set({
            phone:      payData.phone || mobile,
            txRef,
            mpesaCode,
            unlockedAt: new Date().toISOString(),
            amount:     payData.amount || amount || PRO_PRICE,
          });
          console.log(`✅ Pro unlocked — phone: ${safePhone}`);
        }

        sendTelegram(
          `💚 <b>PAYMENT CONFIRMED</b> 💚\n\n` +
          `📞 Phone: <code>${payData.phone || mobile || '—'}</code>\n` +
          `💰 Amount: Ksh ${payData.amount || amount || PRO_PRICE}\n` +
          `🧾 M-Pesa Code: <b>${mpesaCode || '—'}</b>\n` +
          `🆔 txRef: <code>${txRef}</code>\n` +
          `⏰ ${new Date().toLocaleString('en-KE')}`
        );
      } catch (fsErr) {
        console.error('[Webhook] ⚠️  Firestore write failed on completed payment:', fsErr.message);
        // Still notify Telegram so payment can be manually recorded
        sendTelegram(
          `⚠️ <b>FIRESTORE ERROR — MANUAL ACTION NEEDED</b>\n\n` +
          `🆔 txRef: <code>${txRef}</code>\n` +
          `🧾 M-Pesa: <b>${mpesaCode || '—'}</b>\n` +
          `📞 Phone: <code>${mobile || '—'}</code>\n` +
          `❗ Error: ${fsErr.message}\n` +
          `⏰ ${new Date().toLocaleString('en-KE')}`
        );
      }

    } else if (isFailed) {
      try {
        await db.collection('proPayments').doc(txRef).set(
          { status: 'failed', failedAt: new Date().toISOString() },
          { merge: true }
        );
      } catch (fsErr) {
        console.error('[Webhook] ⚠️  Firestore write failed on failed payment:', fsErr.message);
      }
      console.log(`❌ Payment failed — ref: ${txRef}`);

      sendTelegram(
        `❌ <b>PAYMENT FAILED</b>\n\n` +
        `🆔 txRef: <code>${txRef}</code>\n` +
        `📞 Phone: <code>${mobile || '—'}</code>\n` +
        `⏰ ${new Date().toLocaleString('en-KE')}`
      );

    } else {
      try {
        await db.collection('proPayments').doc(txRef).set(
          { lastEvent: eventType, lastRawStatus: rawStatus },
          { merge: true }
        );
      } catch (fsErr) {
        console.error('[Webhook] ⚠️  Firestore write failed on unknown event:', fsErr.message);
      }
      console.log(`ℹ️  Unhandled event: ${eventType}/${rawStatus} — txRef: ${txRef}`);
    }

  } catch (err) {
    console.error('[Webhook] Error:', err.message);
  }
});

// ── GET /pro/check/:phone — Verify pro subscriber ─────────────────────────────
app.get('/pro/check/:phone', async (req, res) => {
  const phone = req.params.phone.replace(/[^0-9]/g, '');
  if (!phone) return res.status(400).json({ success: false, error: 'Invalid phone' });
  if (!db)    return res.status(503).json({ success: false, error: 'Firebase not configured' });
  try {
    const snap = await db.collection('proSubscribers').doc(phone).get();
    return res.json({ success: true, isPro: snap.exists, data: snap.exists ? snap.data() : null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Catch unhandled rejections ────────────────────────────────────────────────
process.on('unhandledRejection', (reason) => {
  console.error('⚠️  Unhandled Promise Rejection:', reason);
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Bett Officials server running on port ${PORT}`);
  console.log(`💰 Pro price: KES ${PRO_PRICE}`);
});
