require("dotenv").config();

const express = require("express");
const Razorpay = require("razorpay");
const cors = require("cors");
const crypto = require("crypto");
const admin = require("firebase-admin");

const app = express();

// 🔥 CORS FIX
app.use(cors({ origin: "*" }));
app.use(express.json());

// =============================
// 🔥 FIREBASE ADMIN SETUP
// =============================

// ⚠️ CHANGE THIS FILE NAME
const serviceAccount = JSON.parse(process.env.FIREBASE_ADMIN_JSON);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});

const db = admin.firestore();

// =============================
// 🔥 RAZORPAY SETUP
// =============================

console.log("🔑 KEY ID:", process.env.RAZORPAY_KEY_ID);

const razorpay = new Razorpay({
  key_id: process.env.RAZORPAY_KEY_ID,
  key_secret: process.env.RAZORPAY_KEY_SECRET
});

// =============================
// 💰 PLAN PRICES
// =============================

const PLAN_PRICES = {
  basic: 49900,
  pro: 99900
};

// =============================
// 🟢 TEST ROUTE
// =============================

app.get("/", (req, res) => {
  res.send("Backend is running ✅");
});

// =============================
// 🧪 TEST CREATE ORDER (GET)
// =============================

app.get("/test-order", async (req, res) => {
  try {
    const order = await razorpay.orders.create({
      amount: 100,
      currency: "INR",
      receipt: "test_receipt"
    });

    res.json(order);

  } catch (err) {
    console.error("TEST ORDER ERROR:", err);
    res.status(500).json(err);
  }
});

// =============================
// ✅ CREATE ORDER (MAIN)
// =============================

app.post("/create-order", async (req, res) => {
  try {
    console.log("🔥 Incoming request:", req.body);

    const { uid, plan } = req.body;

    if (!uid || !plan) {
      console.log("❌ Missing uid or plan");
      return res.status(400).json({ error: "Missing uid or plan" });
    }

    const amount = PLAN_PRICES[plan];

    if (!amount) {
      console.log("❌ Invalid plan");
      return res.status(400).json({ error: "Invalid plan" });
    }

    console.log("💰 Creating Razorpay order...");

    const order = await razorpay.orders.create({
      amount,
      currency: "INR",
      receipt: `rcpt_${Date.now()}`
    });

    console.log("✅ Order created:", order.id);

    // 🔥 Save order ID in Firestore
    try {
      await db.collection("users").doc(uid).update({
        razorpayOrderId: order.id
      });
      console.log("📦 Firestore updated");
    } catch (err) {
      console.log("⚠️ Firestore update failed:", err.message);
    }

    res.json({
      orderId: order.id,
      amount: order.amount,
      key: process.env.RAZORPAY_KEY_ID
    });

  } catch (err) {
    console.error("🔥 CREATE ORDER ERROR:", err);

    res.status(500).json({
      error: "Create order failed",
      details: err.message
    });
  }
});

// =============================
// ✅ VERIFY PAYMENT
// =============================

app.post("/verify-payment", async (req, res) => {
  try {
    console.log("🔍 Verify request:", req.body);

    const {
      uid,
      razorpay_order_id,
      razorpay_payment_id,
      razorpay_signature
    } = req.body;

    const userDoc = await db.collection("users").doc(uid).get();

    if (!userDoc.exists) {
      return res.status(404).json({ error: "User not found" });
    }

    const userData = userDoc.data();

    // 🔥 Verify signature
    const expectedSignature = crypto
      .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
      .update(userData.razorpayOrderId + "|" + razorpay_payment_id)
      .digest("hex");

    if (expectedSignature !== razorpay_signature) {
      console.log("❌ Signature mismatch");
      return res.status(400).json({ error: "Invalid signature" });
    }

    console.log("✅ Payment verified");

    // 🔥 Activate user
    await db.collection("users").doc(uid).update({
      accountStatus: "active",
      paymentStatus: "paid",
      razorpayPaymentId: razorpay_payment_id,
      updatedAt: new Date().toISOString()
    });

    res.json({ success: true });

  } catch (err) {
    console.error("🔥 VERIFY ERROR:", err);

    res.status(500).json({
      error: "Verification failed",
      details: err.message
    });
  }
});

// =============================
// 🚀 START SERVER
// =============================

const PORT = 5001;

app.listen(PORT, () => {
  console.log(`🚀 Server running on http://localhost:${PORT}`);
});