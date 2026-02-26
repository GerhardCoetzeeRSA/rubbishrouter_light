/* eslint-disable max-len */
const { onRequest } = require("firebase-functions/v2/https");
const functionsLogger = require("firebase-functions/logger");
const admin = require("firebase-admin");
const Stripe = require("stripe");

require("dotenv").config();

admin.initializeApp();

// -----------------------------
// CONFIG
// -----------------------------
const STRIPE_SECRET_KEY = process.env.STRIPE_SECRET_KEY;
if (!STRIPE_SECRET_KEY) {
  throw new Error("Missing STRIPE_SECRET_KEY in functions/.env");
}

const stripe = new Stripe(STRIPE_SECRET_KEY, {
  apiVersion: "2024-06-20",
});

const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

// -----------------------------
// Helpers: CORS allowlist
// -----------------------------
function corsAllowlist(req, res) {
  const origin = req.headers.origin;

  // Allow curl/postman (no origin) and allowed origins
  if (!origin || ALLOWED_ORIGINS.includes(origin)) {
    if (origin) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return true;
  }

  return false;
}

function handlePreflight(req, res) {
  if (req.method === "OPTIONS") {
    res.status(204).send("");
    return true;
  }
  return false;
}

// -----------------------------
// Helpers: Auth (Firebase ID token)
// -----------------------------
async function requireFirebaseAuth(req, res) {
  const authHeader = req.headers.authorization || "";
  if (!authHeader.startsWith("Bearer ")) {
    res.status(401).json({ error: "Missing Authorization Bearer token" });
    return null;
  }

  const token = authHeader.substring("Bearer ".length);
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    return decoded; // { uid, ... }
  } catch (e) {
    functionsLogger.warn("Invalid token", e);
    res.status(401).json({ error: "Invalid token" });
    return null;
  }
}

// -----------------------------
// Helpers: Safe URL validation
// (prevents javascript: and blocks non-https unless localhost)
// -----------------------------
function validateExternalUrl(urlStr) {
  if (!urlStr || typeof urlStr !== "string") return null;

  let u;
  try {
    u = new URL(urlStr.trim());
  } catch {
    return null;
  }

  const protocol = u.protocol.toLowerCase();

  // Only allow http/https
  if (protocol !== "https:" && protocol !== "http:") return null;

  // Strongly prefer https; allow http only for localhost
  const host = u.hostname.toLowerCase();
  if (protocol === "http:" && host !== "localhost" && host !== "127.0.0.1") {
    return null;
  }

  // Strip username/password if present
  u.username = "";
  u.password = "";

  return u.toString();
}

// -----------------------------
// Helpers: Basic input validation
// -----------------------------
function requireField(obj, key) {
  if (!obj || obj[key] === undefined || obj[key] === null || obj[key] === "") {
    throw new Error(`Missing field: ${key}`);
  }
}

function safeString(v, maxLen = 200) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  return s.length > maxLen ? s.substring(0, maxLen) : s;
}

// -----------------------------
// MAIN FUNCTION: createAdPaymentLink
// - requires Firebase login
// - creates Stripe Payment Link
// - writes ad request to Firestore
// -----------------------------
exports.createAdPaymentLink = onRequest(async (req, res) => {
  try {
    // CORS
    if (!corsAllowlist(req, res)) {
      return res.status(403).json({ error: "Origin not allowed" });
    }
    if (handlePreflight(req, res)) return;

    // Only POST
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Use POST" });
    }

    // Auth
    const user = await requireFirebaseAuth(req, res);
    if (!user) return;

    // Parse JSON body
    const body = req.body || {};
    requireField(body, "town");
    requireField(body, "type");
    requireField(body, "name");
    requireField(body, "msg");

    // Optional URLs
    const imageUrl = body.imageUrl ? validateExternalUrl(body.imageUrl) : null;
    const linkUrl = body.linkUrl ? validateExternalUrl(body.linkUrl) : null;

    if (body.imageUrl && !imageUrl) {
      return res.status(400).json({ error: "Invalid imageUrl (must be https, or http://localhost in dev)" });
    }
    if (body.linkUrl && !linkUrl) {
      return res.status(400).json({ error: "Invalid linkUrl (must be https, or http://localhost in dev)" });
    }

    // Sanitize strings
    const town = safeString(body.town, 60);
    const type = safeString(body.type, 40); // e.g. rotating / banner / etc
    const name = safeString(body.name, 80);
    const msg = safeString(body.msg, 180);

    // Price logic (edit these values)
    let amountCents = 9900; // R99.00 default
    if (type.toLowerCase() === "rotating") amountCents = 9900;
    if (type.toLowerCase() === "banner") amountCents = 19900;

    // Create a Firestore record first (pending)
    const docRef = await admin.firestore().collection("adRequests").add({
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
      status: "pending_payment",
      uid: user.uid,
      town,
      type,
      name,
      msg,
      imageUrl: imageUrl || null,
      linkUrl: linkUrl || null,
      amountCents,
      currency: "zar",
    });

    // Create Stripe product + price + payment link
    const product = await stripe.products.create({
      name: `RubbishRouter Ad (${type}) - ${town}`,
      description: `${name}: ${msg}`,
      metadata: {
        uid: user.uid,
        requestId: docRef.id,
        town,
        type,
      },
    });

    const price = await stripe.prices.create({
      product: product.id,
      currency: "zar",
      unit_amount: amountCents,
    });

    const paymentLink = await stripe.paymentLinks.create({
      line_items: [{ price: price.id, quantity: 1 }],
      metadata: {
        uid: user.uid,
        requestId: docRef.id,
      },
    });

    // Update record with payment link
    await docRef.update({
      stripeProductId: product.id,
      stripePriceId: price.id,
      stripePaymentLinkId: paymentLink.id,
      paymentUrl: paymentLink.url,
    });

    functionsLogger.info("Payment link created", {
      uid: user.uid,
      requestId: docRef.id,
      town,
      type,
    });

    return res.status(200).json({
      requestId: docRef.id,
      paymentUrl: paymentLink.url,
    });
  } catch (e) {
    functionsLogger.error("createAdPaymentLink failed", e);
    return res.status(500).json({ error: "Server error", details: String(e.message || e) });
  }
});

// -----------------------------
// OPTIONAL: Stripe webhook (recommended for production)
// This marks adRequests as paid when Stripe confirms payment.
// -----------------------------
exports.stripeWebhook = onRequest(async (req, res) => {
  // NOTE: Webhooks need raw body signature verification.
  // If you want this, tell me and I’ll give you the full raw-body webhook setup.
  return res.status(501).json({ error: "Not enabled yet. Ask me for the full Stripe webhook code." });
});