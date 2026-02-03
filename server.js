const express = require("express");
const bodyParser = require("body-parser");
const axios = require("axios");
const cheerio = require("cheerio");
const admin = require("firebase-admin");
const path = require("path");

const app = express();
app.use(bodyParser.json());

// ───────── Root Route ─────────
app.get("/", (req, res) => {
  // Serve a simple HTML page
  res.send(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
      <title>Voter Verification Server</title>
      <style>
        body { font-family: Arial, sans-serif; background:#f7f7f7; display:flex; justify-content:center; align-items:center; height:100vh; margin:0; }
        .container { background:white; padding:2rem; border-radius:10px; box-shadow:0 0 20px rgba(0,0,0,0.1); text-align:center; }
        h1 { color:#0B3D2E; }
        p { color:#333; font-size:1.1rem; }
        a { color:#E0B21B; text-decoration:none; font-weight:bold; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Voter Verification Server 🚀</h1>
        <p>The server is running and ready to accept requests.</p>
        <p>Use your frontend or Postman to POST data to <code>/verify-voter</code>.</p>
        <p>Check your <a href="https://render.com">Render logs</a> for more details.</p>
      </div>
    </body>
    </html>
  `);
});

// ───────── Firebase Admin initialization ─────────
const serviceAccount = require("./firebaseServiceAccount.json");
admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

// ───────── Verification API ─────────
app.post("/verify-voter", async (req, res) => {
  const { nationalId, yearOfBirth, email, password } = req.body;

  if (!nationalId || !yearOfBirth || !email || !password) {
    return res.status(400).json({ success: false, message: "Missing fields" });
  }

  try {
    // Example verification logic
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

// ───────── Start server ─────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
