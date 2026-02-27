/**
 * RubbishRouter — Firebase Cloud Functions
 * 
 * 1. createZapperInvoice  — creates Zapper payment invoice, returns deep link
 * 2. onZapperWebhook      — receives payment confirmation from Zapper
 * 3. cleanOldRoutes       — deletes route data older than 14 days (runs 03:00 SAST daily)
 */

const functions = require("firebase-functions");
const https     = require("https");
const admin     = require("firebase-admin");
const crypto    = require("crypto");

admin.initializeApp();
const db = admin.database();

// ── CREDENTIALS ───────────────────────────────────────────────
const MERCHANT_ID           = "76032";
const DEFAULT_SITE_ID       = "96013";  // resident subscriptions
const BIZ_SITE_ID           = "96037";  // business/ad payments
const MERCHANT_API_KEY      = "6c48d74081e0421bb1afce2edc9b4dde";
const MERCHANT_SITE_API_KEY = "d0a399b1ee004f45b046e0de553d5fe1";

// Zapper Business API = Basic Base64(merchantApiKey:merchantSiteApiKey)
const AUTH_HEADER = "Basic " + Buffer.from(`${MERCHANT_API_KEY}:${MERCHANT_SITE_API_KEY}`).toString("base64");


// ════════════════════════════════════════════════════════════════
// 1. CREATE ZAPPER INVOICE
//    Called by pay.html and biz.html to get a Zapper deep link.
//    Keeps API keys off the browser entirely.
// ════════════════════════════════════════════════════════════════
exports.createZapperInvoice = functions.https.onRequest((req, res) => {

    res.set("Access-Control-Allow-Origin",  "https://gerhardcoetzeersa.github.io");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST")   { res.status(405).json({ error: "Method not allowed" }); return; }

    const { amountCents, reference, successUrl, siteId } = req.body;
    if (!amountCents || !reference) {
        res.status(400).json({ error: "Missing amountCents or reference" });
        return;
    }

    const activeSiteId = siteId || DEFAULT_SITE_ID;

    const payload = JSON.stringify({
        currencyISOCode: "ZAR",
        amount:          amountCents / 100,  // Zapper expects rands not cents
        siteReference:   reference,
        reference:       reference,
    });

    const options = {
        hostname: "api.zapper.com",
        path:     `/business/api/v1/merchants/${MERCHANT_ID}/sites/${activeSiteId}/invoices`,
        method:   "POST",
        headers: {
            "Authorization":       AUTH_HEADER,
            "Content-Type":        "application/json",
            "Accept":              "text/plain",
            "Representation-Type": "deeplink/zappercode/v2",
            "Content-Length":      Buffer.byteLength(payload),
        }
    };

    console.log("Calling Zapper API — siteId:", activeSiteId, "amount:", amountCents/100, "ref:", reference);
    let responseData = "";
    const apiReq = https.request(options, (apiRes) => {
        apiRes.on("data", chunk => responseData += chunk);
        apiRes.on("end", () => {
            if (apiRes.statusCode >= 200 && apiRes.statusCode < 300) {
                const appLink   = responseData.trim();
                const finalLink = successUrl
                    ? `${appLink}&successCallbackURL=${encodeURIComponent(successUrl)}`
                    : appLink;
                res.status(200).json({ appLink: finalLink, reference });
            } else {
                console.error("Zapper API error:", apiRes.statusCode, responseData);
                console.error("Zapper siteId used:", activeSiteId, "amountCents:", amountCents, "reference:", reference);
                res.status(502).json({ error: "Zapper API error", status: apiRes.statusCode, details: responseData });
            }
        });
    });
    apiReq.on("error", e => res.status(500).json({ error: "Network error", details: e.message }));
    apiReq.write(payload);
    apiReq.end();
});


// ════════════════════════════════════════════════════════════════
// 2. ZAPPER PAYMENT WEBHOOK
//    Zapper calls this URL when a payment is completed.
//    Set in Zapper Merchant Portal → Integrations → Webhook URL:
//    https://us-central1-rubbishrouter-688b2.cloudfunctions.net/onZapperWebhook
// ════════════════════════════════════════════════════════════════
exports.onZapperWebhook = functions.https.onRequest(async (req, res) => {

    if (req.method !== "POST") { res.status(405).send("Method not allowed"); return; }

    const { reference, status, amount, siteId } = req.body;
    console.log("Zapper webhook:", JSON.stringify(req.body));

    if (!reference || status === undefined) {
        res.status(400).send("Missing fields");
        return;
    }

    if (status === 2) {
        // ── Resident subscription payment ────────────────────
        if (String(siteId) === DEFAULT_SITE_ID && reference.startsWith("RR_")) {
            await db.ref(`payments/${reference}`).set({
                reference, amount,
                paidAt: Date.now(),
                siteId, status: "paid",
            });
            console.log(`Resident payment confirmed: ${reference}`);
        }

        // ── Business ad payment ───────────────────────────────
        if (String(siteId) === BIZ_SITE_ID && reference.startsWith("BIZ-")) {
            const snap = await db.ref(`pending_ads/${reference}`).once("value");
            if (snap.exists()) {
                await db.ref(`pending_ads/${reference}/status`).set("paid_pending_review");
                console.log(`Biz ad payment confirmed: ${reference}`);
            }
        }
    }

    res.status(200).send("OK");
});


// ════════════════════════════════════════════════════════════════
// 3. DAILY ROUTE CLEANUP
//    Deletes truck route data older than 14 days.
//    Runs at 03:00 SAST (01:00 UTC) every day.
//    Keeps 14 days so route-learning feature has history to work with.
// ════════════════════════════════════════════════════════════════
exports.cleanOldRoutes = functions.pubsub
    .schedule("0 1 * * *")
    .timeZone("Africa/Johannesburg")
    .onRun(async () => {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - 14);
        const cutoffStr = cutoff.toISOString().split("T")[0];

        const snap = await db.ref("routes").once("value");
        if (!snap.exists()) return null;

        const deletions = [];
        snap.forEach(muniSnap => {
            muniSnap.forEach(dateSnap => {
                if (dateSnap.key < cutoffStr) {
                    console.log(`Deleting routes/${muniSnap.key}/${dateSnap.key}`);
                    deletions.push(dateSnap.ref.remove());
                }
            });
        });

        await Promise.all(deletions);
        console.log(`Cleanup done — removed ${deletions.length} old date entries`);
        return null;
    });
