const express = require('express');
const cors = require('cors');
const axios = require('axios');
const admin = require('firebase-admin');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// ─── FIREBASE ADMIN INIT ───────────────────────────────────────────────────
let serviceAccount;
if (process.env.FIREBASE_SERVICE_ACCOUNT) {
  try {
    serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  } catch (e) {
    console.error('❌ Failed to parse FIREBASE_SERVICE_ACCOUNT JSON:', e.message);
    process.exit(1);
  }
} else if (process.env.FB_PROJECT_ID) {
  serviceAccount = {
    type: 'service_account',
    project_id: process.env.FB_PROJECT_ID,
    private_key_id: process.env.FB_PRIVATE_KEY_ID || '',
    private_key: (process.env.FB_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    client_email: process.env.FB_CLIENT_EMAIL,
    client_id: process.env.FB_CLIENT_ID || '',
    auth_uri: 'https://accounts.google.com/o/oauth2/auth',
    token_uri: 'https://oauth2.googleapis.com/token',
  };
} else {
  console.error('❌ No Firebase credentials found.');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://community-caa4a-default-rtdb.firebaseio.com'
});
const db = admin.database();

// ─── CONFIG ────────────────────────────────────────────────────────────────
const PAYCENTA_API_KEY  = process.env.PAYCENTA_API_KEY  || 'hmp_SHkWZCN5hVe46NEZr7QA1gIfcHLJ7LeSjLFyELTw';
const PAYCENTA_EMAIL    = process.env.PAYCENTA_EMAIL    || 'bettemanuel49@gmail.com';
const PAYCENTA_CODE     = process.env.PAYCENTA_CODE     || '';
const WEBHOOK_SECRET    = process.env.WEBHOOK_SECRET    || '';
const PAYCENTA_INIT_URL = 'https://paynecta.co.ke/api/v1/payment/initialize';
const PRO_PRICE_KES     = Number(process.env.PRO_PRICE_KES) || 1;
const BASE_URL          = process.env.SERVER_URL || 'https://voter-server-fmfr.onrender.com';

// ─── HEALTH CHECK ──────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Bett Officials API', time: new Date().toISOString() });
});

// ─── INITIATE STK PUSH ─────────────────────────────────────────────────────
app.post('/pay', async (req, res) => {
  const { phone, email } = req.body;
  if (!phone) return res.status(400).json({ success: false, error: 'Phone number required' });

  let normalizedPhone = phone.toString().trim();
  if (normalizedPhone.startsWith('0'))       normalizedPhone = '254' + normalizedPhone.slice(1);
  else if (normalizedPhone.startsWith('+'))  normalizedPhone = normalizedPhone.slice(1);

  const reference = `BETT-${Date.now()}-${Math.random().toString(36).slice(2,7).toUpperCase()}`;

  try {
    const payload = {
      amount: PRO_PRICE_KES,
      mobile_number: normalizedPhone,
      email: email || PAYCENTA_EMAIL,
      reference,
      description: 'Bett Officials Pro Tips Unlock',
      ...(PAYCENTA_CODE && { code: PAYCENTA_CODE }),
      callback_url: `${BASE_URL}/webhook/paycenta`
    };

    const response = await axios.post(PAYCENTA_INIT_URL, payload, {
      headers: {
        'X-API-Key': PAYCENTA_API_KEY,
        'X-User-Email': PAYCENTA_EMAIL,
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    await db.ref(`proPayments/${reference}`).set({
      phone: normalizedPhone,
      amount: PRO_PRICE_KES,
      reference,
      status: 'pending',
      createdAt: Date.now(),
      paycenta: response.data
    });

    return res.json({
      success: true,
      reference,
      message: 'STK push sent. Enter M-Pesa PIN on your phone.',
      data: response.data
    });

  } catch (err) {
    console.error('STK push error:', err?.response?.data || err.message);
    return res.status(500).json({
      success: false,
      error: err?.response?.data?.message || 'Failed to initiate payment. Try again.'
    });
  }
});

// ─── CHECK PAYMENT STATUS ──────────────────────────────────────────────────
app.get('/pay/status/:reference', async (req, res) => {
  const { reference } = req.params;
  try {
    const snap = await db.ref(`proPayments/${reference}`).get();
    if (!snap.exists()) return res.status(404).json({ success: false, error: 'Reference not found' });
    const payment = snap.val();
    return res.json({ success: true, status: payment.status, unlocked: payment.status === 'completed' });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── PAYCENTA WEBHOOK ──────────────────────────────────────────────────────
app.post('/webhook/paycenta', async (req, res) => {
  if (WEBHOOK_SECRET) {
    const incoming = req.headers['x-webhook-secret'] || req.headers['x-api-key'] || '';
    if (incoming !== WEBHOOK_SECRET) {
      console.warn('⚠️ Webhook unauthorized attempt');
      return res.status(401).json({ error: 'Unauthorized' });
    }
  }

  const event = req.body;
  console.log('Paycenta webhook received:', JSON.stringify(event));
  res.status(200).json({ received: true });

  try {
    const reference =
      event?.reference ||
      event?.data?.reference ||
      event?.payment?.reference ||
      event?.data?.payment?.reference;

    const eventType =
      event?.event ||
      event?.type ||
      event?.status ||
      event?.data?.status ||
      event?.data?.event;

    if (!reference) { console.warn('Webhook missing reference:', event); return; }

    const snap = await db.ref(`proPayments/${reference}`).get();
    if (!snap.exists()) { console.warn('No payment record for ref:', reference); return; }

    const payment = snap.val();

    const isCompleted =
      ['payment.completed','Payment Completed','completed','success','COMPLETE','SUCCESS']
        .includes(eventType);
    const isFailed =
      ['payment.failed','Payment Failed','failed','FAILED','CANCELLED','cancelled']
        .includes(eventType);

    if (isCompleted) {
      await db.ref(`proPayments/${reference}`).update({
        status: 'completed', completedAt: Date.now(), webhookPayload: event
      });
      const safePhone = payment.phone.replace(/[^0-9]/g, '');
      await db.ref(`proSubscribers/${safePhone}`).set({
        phone: payment.phone, reference,
        unlockedAt: Date.now(), amount: payment.amount
      });
      console.log(`✅ Pro unlocked — phone: ${payment.phone}, ref: ${reference}`);

    } else if (isFailed) {
      await db.ref(`proPayments/${reference}`).update({
        status: 'failed', failedAt: Date.now(), webhookPayload: event
      });
      console.log(`❌ Payment failed — ref: ${reference}`);

    } else {
      await db.ref(`proPayments/${reference}`).update({
        lastEvent: eventType, webhookPayload: event
      });
      console.log(`ℹ️ Unhandled event type: ${eventType}`);
    }

  } catch (err) {
    console.error('Webhook processing error:', err.message);
  }
});

// ─── VERIFY PRO BY PHONE ───────────────────────────────────────────────────
app.get('/pro/check/:phone', async (req, res) => {
  const phone = req.params.phone.replace(/[^0-9]/g, '');
  try {
    const snap = await db.ref(`proSubscribers/${phone}`).get();
    return res.json({ success: true, isPro: snap.exists(), data: snap.exists() ? snap.val() : null });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── START ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Bett Officials server running on port ${PORT}`));
