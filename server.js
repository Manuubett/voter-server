require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const axios   = require('axios');
const admin   = require('firebase-admin');

// ── Firebase init (matches working server pattern) ────────────────────────────
let db;
if (process.env.FIREBASE_PROJECT_ID) {
  admin.initializeApp({
    credential: admin.credential.cert({
      projectId:   process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey:  process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    }),
    databaseURL: 'https://community-caa4a-default-rtdb.firebaseio.com',
  });
  db = admin.firestore();
  console.log('✅ Firebase connected');
} else {
  console.warn('⚠️  Firebase env vars not set — payment routes will not persist data');
}

// ── Telegram notifier ─────────────────────────────────────────────────────────
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID   = process.env.TELEGRAM_CHAT_ID;

if (!TELEGRAM_BOT_TOKEN) console.warn('⚠️  TELEGRAM_BOT_TOKEN not set — notifications disabled');
if (!TELEGRAM_CHAT_ID)   console.warn('⚠️  TELEGRAM_CHAT_ID not set — notifications disabled');

async function sendTelegram(text) {
  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    const res = await axios.post(
      `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`,
      { chat_id: TELEGRAM_CHAT_ID, text, parse_mode: 'HTML', disable_web_page_preview: true }
    );
    if (res.data?.ok) console.log('[Telegram] ✅ Sent — message_id:', res.data.result?.message_id);
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
const BASE_URL      = process.env.SERVER_URL || 'https://voter-server-fmfr.onrender.com';
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
  if (p.startsWith('0'))    p = '254' + p.slice(1);
  if (!p.startsWith('254')) p = '254' + p;
  return p;
}

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Bett Officials API', time: new Date().toISOString() });
});

// ── Test Paynecta API key ─────────────────────────────────────────────────────
app.get('/api/test', async (req, res) => {
  if (!API_KEY) return res.status(500).json({ success: false, message: 'PAYNECTA_API_KEY not set' });
  try {
    const response = await axios.get(`${PAYNECTA_URL}/me`, {
      headers: paynectaHeaders(),
      validateStatus: () => true,
    });
    const ok = response.status < 400;
    res.status(ok ? 200 : 400).json({
      success: ok,
      status:  response.status,
      message: ok ? 'API Key valid ✅' : 'API Key rejected ❌',
      data:    response.data,
    });
  } catch (err) {
    res.status(500).json({ success: false, message: err.message });
  }
});

// ── Initiate STK push ─────────────────────────────────────────────────────────
// POST /pay  { phone: "0712345678" }
app.post('/pay', async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ success: false, error: 'Phone number required' });

  if (!API_KEY || !USER_EMAIL || !MERCHANT_CODE) {
    return res.status(500).json({
      success: false,
      error: 'Server misconfigured — set PAYNECTA_API_KEY, PAYNECTA_EMAIL, PAYNECTA_CODE in Render env vars',
    });
  }

  const mobile    = normalisePhone(phone);
  const reference = `BETT-${Date.now()}-${Math.random().toString(36).slice(2,7).toUpperCase()}`;

  try {
    const payload = {
      code:          MERCHANT_CODE,
      mobile_number: mobile,
      amount:        PRO_PRICE,
      reference,
      description:   'Bett Officials Pro Tips Unlock',
      callback_url:  `${BASE_URL}/api/webhook`,
    };

    console.log('[STK] Sending:', { mobile, amount: PRO_PRICE, reference });

    const response = await axios.post(`${PAYNECTA_URL}/payment/initialize`, payload, {
      headers: paynectaHeaders(),
    });

    const txRef = response.data?.data?.transaction_reference
               || response.data?.data?.CheckoutRequestID
               || reference;

    if (db) {
      await db.collection('proPayments').doc(txRef).set({
        phone:     mobile,
        amount:    PRO_PRICE,
        reference,
        txRef,
        status:    'pending',
        createdAt: new Date().toISOString(),
        paynecta:  response.data,
      });
    }

    console.log('[STK] ✅ Success — txRef:', txRef);

    sendTelegram(
      `📱 <b>STK PUSH SENT</b>\n\n` +
      `📞 Phone: <code>${mobile}</code>\n` +
      `💰 Amount: Ksh ${PRO_PRICE}\n` +
      `🆔 txRef: <code>${txRef}</code>\n` +
      `⏰ ${new Date().toLocaleString('en-KE')}`
    );

    res.json({ success: true, reference: txRef, message: 'STK push sent. Enter M-Pesa PIN on your phone.', data: response.data });

  } catch (err) {
    const errData = err.response?.data || err.message;
    console.error('[STK] Error:', errData);
    res.status(400).json({ success: false, error: err.response?.data?.message || 'Failed to initiate payment. Try again.' });
  }
});

// ── Check payment status (polled by frontend) ─────────────────────────────────
// GET /pay/status/:txRef
app.get('/pay/status/:txRef', async (req, res) => {
  const { txRef } = req.params;
  console.log('[STATUS] Hit — txRef:', txRef);

  if (!db) return res.status(503).json({ success: false, error: 'Firebase not configured' });

  try {
    const snap = await db.collection('proPayments').doc(txRef).get();
    if (!snap.exists) return res.json({ success: true, status: 'pending' });

    const data   = snap.data();
    const status = (data.status === 'completed' || data.status === 'confirmed') ? 'completed' : data.status;

    console.log('[STATUS] Returning:', status, 'for txRef:', txRef);
    return res.json({ success: true, status, unlocked: status === 'completed' });
  } catch (err) {
    console.error('[STATUS] Error:', err.message);
    res.status(500).json({ success: false, error: 'Could not check status' });
  }
});

// ── Paynecta webhook ──────────────────────────────────────────────────────────
// POST /api/webhook
// Confirmed Paynecta payload structure:
// {
//   event_type: "payment.completed",
//   data: {
//     transaction: { reference: "BETT-...", status: "completed" },
//     MpesaReceiptNumber: "UCULOAXIKR",
//     Amount: 49,
//     customer: { mobile_number: "254..." }
//   }
// }
app.post('/api/webhook', async (req, res) => {
  res.json({ received: true }); // ack immediately

  try {
    const payload   = req.body;
    const data      = payload.data || {};
    const tx        = data.transaction || {};

    const txRef     = tx.reference || data.reference || payload.reference;
    const rawStatus = tx.status    || data.status;
    const eventType = payload.event_type || payload.event || payload.type;
    const mpesaCode = data.MpesaReceiptNumber || null;
    const amount    = data.Amount || null;
    const mobile    = data.customer?.mobile_number || null;

    console.log('[Webhook]', { eventType, txRef, rawStatus, mpesaCode });

    if (!db || !txRef) {
      console.warn('[Webhook] Skipping — missing db or txRef');
      return;
    }

    const isCompleted =
      eventType === 'payment.completed' ||
      rawStatus === 'completed'         ||
      rawStatus === 'confirmed'         ||
      rawStatus === 'success'           ||
      rawStatus === 'COMPLETE';

    const isFailed =
      eventType === 'payment.failed' ||
      rawStatus === 'failed'         ||
      rawStatus === 'FAILED'         ||
      rawStatus === 'cancelled'      ||
      rawStatus === 'CANCELLED';

    if (isCompleted) {
      await db.collection('proPayments').doc(txRef).set(
        { status: 'completed', mpesaCode, completedAt: new Date().toISOString(), webhookPayload: payload },
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
        console.log(`✅ Pro unlocked — phone: ${safePhone}, ref: ${txRef}`);
      }

      sendTelegram(
        `💚 <b>PAYMENT CONFIRMED</b> 💚\n\n` +
        `📞 Phone: <code>${payData.phone || mobile || '—'}</code>\n` +
        `💰 Amount: Ksh ${payData.amount || amount || PRO_PRICE}\n` +
        `🧾 M-Pesa Code: <b>${mpesaCode || '—'}</b>\n` +
        `🆔 txRef: <code>${txRef}</code>\n` +
        `⏰ ${new Date().toLocaleString('en-KE')}`
      );

    } else if (isFailed) {
      await db.collection('proPayments').doc(txRef).set(
        { status: 'failed', failedAt: new Date().toISOString(), webhookPayload: payload },
        { merge: true }
      );
      console.log(`❌ Payment failed — ref: ${txRef}`);

      sendTelegram(
        `❌ <b>PAYMENT FAILED</b>\n\n` +
        `🆔 txRef: <code>${txRef}</code>\n` +
        `📞 Phone: <code>${mobile || '—'}</code>\n` +
        `⏰ ${new Date().toLocaleString('en-KE')}`
      );

    } else {
      await db.collection('proPayments').doc(txRef).set(
        { lastEvent: eventType, lastRawStatus: rawStatus, webhookPayload: payload },
        { merge: true }
      );
      console.log(`ℹ️  Unhandled event: ${eventType} / ${rawStatus}`);
    }

  } catch (err) {
    console.error('[Webhook] Error:', err.message);
  }
});

// ── Verify pro by phone ───────────────────────────────────────────────────────
// GET /pro/check/:phone
app.get('/pro/check/:phone', async (req, res) => {
  const phone = req.params.phone.replace(/[^0-9]/g, '');
  if (!db) return res.status(503).json({ success: false, error: 'Firebase not configured' });
  try {
    const snap = await db.collection('proSubscribers').doc(phone).get();
    return res.json({ success: true, isPro: snap.exists, data: snap.exists ? snap.data() : null });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Bett Officials server running on port ${PORT}`);
  console.log(`📍 ${BASE_URL}`);
});
