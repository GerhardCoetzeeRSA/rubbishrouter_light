/**
 * Firebase Cloud Function: createZapperInvoice
 * 
 * Deploy with:
 *   firebase deploy --only functions
 * 
 * This function lives server-side so your API keys are never
 * exposed in the browser. It calls the Zapper Business API,
 * creates an invoice, and returns the deep-link app URL.
 */

const functions = require("firebase-functions");
const https     = require("https");

// ── YOUR CREDENTIALS (set via Firebase env config) ──────────
// Run once: firebase functions:config:set zapper.merchant_api_key="..." zapper.site_api_key="..."
// OR hardcode here for now and deploy — you can env-protect later.
const MERCHANT_API_KEY      = "6c48d74081e0421bb1afce2edc9b4dde";
const MERCHANT_SITE_API_KEY = "1b8ba011df7b45e09c107e35aa70710c";
const MERCHANT_ID           = "76032";
const SITE_ID               = "96013";

// Basic auth = Base64(merchantApiKey:siteApiKey)
const AUTH_HEADER = "Basic " + Buffer.from(
    `${MERCHANT_API_KEY}:${MERCHANT_SITE_API_KEY}`
).toString("base64");

exports.createZapperInvoice = functions.https.onRequest((req, res) => {

    // Allow calls from GitHub Pages
    res.set("Access-Control-Allow-Origin", "https://gerhardcoetzeersa.github.io");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");

    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }
    if (req.method !== "POST") {
        res.status(405).json({ error: "Method not allowed" });
        return;
    }

    const { amountCents, reference, successUrl } = req.body;

    if (!amountCents || !reference) {
        res.status(400).json({ error: "Missing amountCents or reference" });
        return;
    }

    // ── Build Zapper invoice payload ────────────────────────
    // Docs: POST /business/api/v1/merchants/{merchantId}/sites/{siteId}/invoices
    // Representation-Type: deeplink/zappercode/v2  → returns app deep link string
    const payload = JSON.stringify({
        currencyISOCode: "ZAR",
        amount:          amountCents,          // in cents, e.g. 1500 = R15.00
        siteReference:   reference,            // echoed back in payment notification
        reference:       reference,
    });

    const options = {
        hostname: "api.zapper.com",
        path:     `/business/api/v1/merchants/${MERCHANT_ID}/sites/${SITE_ID}/invoices`,
        method:   "POST",
        headers: {
            "Authorization":       AUTH_HEADER,
            "Content-Type":        "application/json",
            "Accept":              "text/plain",          // returns the code string
            "Representation-Type": "deeplink/zappercode/v2",  // returns app deep link
            "Content-Length":      Buffer.byteLength(payload),
        }
    };

    let responseData = "";
    const apiReq = https.request(options, (apiRes) => {
        apiRes.on("data", chunk => responseData += chunk);
        apiRes.on("end", () => {
            if (apiRes.statusCode >= 200 && apiRes.statusCode < 300) {
                // responseData is the deep link string, e.g.:
                // https://www.zapper.com/payWithZapper?qr=http...
                const appLink = responseData.trim();

                // Optionally append successUrl so Zapper redirects back after payment
                const finalLink = successUrl
                    ? `${appLink}&successCallbackURL=${encodeURIComponent(successUrl)}`
                    : appLink;

                res.status(200).json({ appLink: finalLink, reference });
            } else {
                console.error("Zapper API error:", apiRes.statusCode, responseData);
                res.status(502).json({
                    error:   "Zapper API error",
                    status:  apiRes.statusCode,
                    details: responseData
                });
            }
        });
    });

    apiReq.on("error", (e) => {
        console.error("Network error calling Zapper:", e);
        res.status(500).json({ error: "Network error", details: e.message });
    });

    apiReq.write(payload);
    apiReq.end();
});
