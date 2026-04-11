const express = require('express');
const cors = require('cors');
const axios = require('axios');
const admin = require('firebase-admin');

const app = express();
app.use(cors({ origin: '*' }));
app.use(express.json());

// ─── FIREBASE ADMIN INIT ───────────────────────────────────────────────────
// Option A: FIREBASE_SERVICE_ACCOUNT = full JSON string (one line, no spaces)
// Option B: individual env vars FB_PROJECT_ID, FB_CLIENT_EMAIL, FB_PRIVATE_KEY
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
  console.error('❌ No Firebase credentials found. Set FIREBASE_SERVICE_ACCOUNT or FB_PROJECT_ID + FB_CLIENT_EMAIL + FB_PRIVATE_KEY');
  process.exit(1);
}

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
  databaseURL: 'https://community-caa4a-default-rtdb.firebaseio.com'
});
const db = admin.database();

// ─── CONFIG ────────────────────────────────────────────────────────────────
const PAYCENTA_API_KEY = process.env.PAYCENTA_API_KEY || 'hmp_SHkWZCN5hVe46NEZr7QA1gIfcHLJ7LeSjLFyELTw';
const PAYCENTA_INIT_URL = 'https://paynecta.co.ke/api/v1/payment/initialize';
const PRO_PRICE_KES = 49;

// ─── HEALTH CHECK ──────────────────────────────────────────────────────────
app.get('/', (req, res) => {
  res.json({ status: 'ok', service: 'Bett Officials API', time: new Date().toISOString() });
});

// ─── INITIATE STK PUSH ─────────────────────────────────────────────────────
// POST /pay
// Body: { phone: "0712345678" }
app.post('/pay', async (req, res) => {
  const { phone, email } = req.body;

  if (!phone) {
    return res.status(400).json({ success: false, error: 'Phone number required' });
  }

  // Normalize phone: strip leading 0, add 254
  let normalizedPhone = phone.toString().trim();
  if (normalizedPhone.startsWith('0')) {
    normalizedPhone = '254' + normalizedPhone.slice(1);
  } else if (normalizedPhone.startsWith('+')) {
    normalizedPhone = normalizedPhone.slice(1);
  }

  // Generate unique reference
  const reference = `BETT-${Date.now()}-${Math.random().toString(36).slice(2,7).toUpperCase()}`;

  try {
    const payload = {
      amount: PRO_PRICE_KES,
      phone_number: normalizedPhone,
      email: email || 'bettemanuel49@gmail.com',
      reference: reference,
      description: 'Bett Officials Pro Tips Unlock',
      callback_url: `${process.env.SERVER_URL || 'https://voter-server-fmfr.onrender.com'}/webhook/paycenta`
    };

    const response = await axios.post(PAYCENTA_INIT_URL, payload, {
      headers: {
        'X-API-Key': PAYCENTA_API_KEY,
        'X-User-Email': 'bettemanuel49@gmail.com',
        'Content-Type': 'application/json'
      },
      timeout: 15000
    });

    const data = response.data;

    // Store pending payment in Firebase so webhook can match it
    await db.ref(`proPayments/${reference}`).set({
      phone: normalizedPhone,
      amount: PRO_PRICE_KES,
      reference,
      status: 'pending',
      createdAt: Date.now(),
      paycenta: data
    });

    return res.json({
      success: true,
      reference,
      message: 'STK push sent. Enter M-Pesa PIN on your phone.',
      data
    });

  } catch (err) {
    console.error('STK push error:', err?.response?.data || err.message);
    return res.status(500).json({
      success: false,
      error: err?.response?.data?.message || 'Failed to initiate payment. Try again.'
    });
  }
});

// ─── CHECK PAYMENT STATUS (polled by frontend) ────────────────────────────
// GET /pay/status/:reference
app.get('/pay/status/:reference', async (req, res) => {
  const { reference } = req.params;
  try {
    const snap = await db.ref(`proPayments/${reference}`).get();
    if (!snap.exists()) {
      return res.status(404).json({ success: false, error: 'Reference not found' });
    }
    const payment = snap.val();
    return res.json({
      success: true,
      status: payment.status,
      unlocked: payment.status === 'completed'
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── PAYCENTA WEBHOOK ──────────────────────────────────────────────────────
// POST /webhook/paycenta
// Paycenta posts payment events here
app.post('/webhook/paycenta', async (req, res) => {
  const event = req.body;
  console.log('Paycenta webhook received:', JSON.stringify(event));

  // Acknowledge immediately
  res.status(200).json({ received: true });

  try {
    const reference = event?.reference || event?.data?.reference || event?.payment?.reference;
    const eventType = event?.event || event?.type || event?.status;

    if (!reference) {
      console.warn('Webhook missing reference:', event);
      return;
    }

    const snap = await db.ref(`proPayments/${reference}`).get();
    if (!snap.exists()) {
      console.warn('No payment record for reference:', reference);
      return;
    }

    const payment = snap.val();

    // Handle payment completed
    if (
      eventType === 'payment.completed' ||
      eventType === 'Payment Completed' ||
      eventType === 'completed' ||
      event?.status === 'success' ||
      event?.status === 'COMPLETE'
    ) {
      // Update payment status
      await db.ref(`proPayments/${reference}`).update({
        status: 'completed',
        completedAt: Date.now(),
        webhookPayload: event
      });

      // Store phone as a pro subscriber
      const phone = payment.phone;
      const safePhone = phone.replace(/[^0-9]/g, '');
      await db.ref(`proSubscribers/${safePhone}`).set({
        phone,
        reference,
        unlockedAt: Date.now(),
        amount: payment.amount
      });

      console.log(`✅ Pro unlocked for phone: ${phone}, ref: ${reference}`);

    } else if (
      eventType === 'payment.failed' ||
      eventType === 'Payment Failed' ||
      eventType === 'failed' ||
      event?.status === 'FAILED'
    ) {
      await db.ref(`proPayments/${reference}`).update({
        status: 'failed',
        failedAt: Date.now(),
        webhookPayload: event
      });
      console.log(`❌ Payment failed for ref: ${reference}`);

    } else if (
      eventType === 'payment.pending' ||
      eventType === 'Payment Pending' ||
      eventType === 'pending'
    ) {
      await db.ref(`proPayments/${reference}`).update({
        status: 'pending',
        webhookPayload: event
      });

    } else {
      // Log unknown events
      await db.ref(`proPayments/${reference}`).update({
        lastEvent: eventType,
        webhookPayload: event
      });
      console.log(`ℹ️ Unhandled event type: ${eventType}`);
    }

  } catch (err) {
    console.error('Webhook processing error:', err.message);
  }
});

// ─── VERIFY PRO BY PHONE (optional - frontend can call this on login) ──────
// GET /pro/check/:phone
app.get('/pro/check/:phone', async (req, res) => {
  let phone = req.params.phone.replace(/[^0-9]/g, '');
  try {
    const snap = await db.ref(`proSubscribers/${phone}`).get();
    return res.json({
      success: true,
      isPro: snap.exists(),
      data: snap.exists() ? snap.val() : null
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── START ─────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`✅ Bett Officials server running on port ${PORT}`));
