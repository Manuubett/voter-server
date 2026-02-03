const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const cheerio = require("cheerio");
const admin = require("firebase-admin");

const app = express();
app.use(bodyParser.json());

// Root route
app.get("/", (req, res) => {
  res.json({
    status: "ok",
    message: "Voter verification server running 🚀"
  });
});

// Firebase Admin initialization using environment variables
const serviceAccount = {
  "type": "service_account",
  "project_id": process.env.FIREBASE_PROJECT_ID,
  "private_key_id": process.env.FIREBASE_PRIVATE_KEY_ID,
  "private_key": process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n"),
  "client_email": process.env.FIREBASE_CLIENT_EMAIL,
  "client_id": process.env.FIREBASE_CLIENT_ID,
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": process.env.FIREBASE_CLIENT_X509_CERT_URL
};

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// Verification API
app.post("/verify-voter", async (req, res) => {
  const { nationalId, yearOfBirth, email, password } = req.body;

  if (!nationalId || !yearOfBirth || !email || !password) {
    return res.status(400).json({ success: false, message: "Missing fields" });
  }

  try {
    // Replace with actual verification logic
    const response = await axios.get(`https://verify.iebc.or.ke/?id=${nationalId}&year=${yearOfBirth}`);
    const $ = cheerio.load(response.data);
    const result = $("#result").text().trim();

    if (result.toLowerCase().includes("registered")) {
      const user = await admin.auth().createUser({ email, password });
      await admin.firestore().collection("users").doc(user.uid).set({
        nationalId,
        yearOfBirth,
        verified: true,
        createdAt: new Date()
      });
      return res.json({ success: true, message: "Verification successful" });
    } else {
      return res.json({ success: false, message: "Voter not registered" });
    }
  } catch (err) {
    console.error(err.message);
    res.status(500).json({ success: false, message: "Server error" });
  }
});

// Start server on Render's assigned port
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
