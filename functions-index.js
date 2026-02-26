const functions = require("firebase-functions");
const https     = require("https");

const MERCHANT_API_KEY      = "6c48d74081e0421bb1afce2edc9b4dde";
const MERCHANT_SITE_API_KEY = "1b8ba011df7b45e09c107e35aa70710c";
const MERCHANT_ID           = "76032";
const DEFAULT_SITE_ID       = "96013";  // resident subscriptions

const AUTH_HEADER = "Basic " + Buffer.from(
    `${MERCHANT_API_KEY}:${MERCHANT_SITE_API_KEY}`
).toString("base64");

exports.createZapperInvoice = functions.https.onRequest((req, res) => {
    res.set("Access-Control-Allow-Origin", "https://gerhardcoetzeersa.github.io");
    res.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.set("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") { res.status(204).send(""); return; }
    if (req.method !== "POST")   { res.status(405).json({ error: "Method not allowed" }); return; }

    const { amountCents, reference, successUrl, siteId } = req.body;
    if (!amountCents || !reference) { res.status(400).json({ error: "Missing fields" }); return; }

    // Allow caller to override siteId (e.g. 96037 for biz/ad payments)
    const activeSiteId = siteId || DEFAULT_SITE_ID;

    const payload = JSON.stringify({
        currencyISOCode: "ZAR",
        amount:          amountCents,
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
                res.status(502).json({ error: "Zapper API error", status: apiRes.statusCode, details: responseData });
            }
        });
    });
    apiReq.on("error", (e) => res.status(500).json({ error: "Network error", details: e.message }));
    apiReq.write(payload);
    apiReq.end();
});
