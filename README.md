# RubbishRouter — Zapper Payment Cloud Function

## What this does
Calls the Zapper Business API (v2) server-side to create a payment invoice
and return a deep-link that opens the Zapper app directly to the payment screen.
Keeps your API keys off the browser entirely.

## One-time setup (5 minutes)

### 1. Install Firebase CLI
```
npm install -g firebase-tools
firebase login
```

### 2. Place files
Copy this folder's contents into your Firebase project's `functions/` folder.
Your project ID is already set: `rubbishrouter-688b2`

### 3. Install dependencies
```
cd functions
npm install
```

### 4. Deploy
```
firebase deploy --only functions
```

### 5. Your Cloud Function URL will be:
```
https://us-central1-rubbishrouter-688b2.cloudfunctions.net/createZapperInvoice
```
This URL is already set in pay.html — no further changes needed.

## How it works
1. pay.html calls this function with `{ amountCents: 1500, reference: "RR_..." }`
2. Function calls `POST https://api.zapper.com/business/api/v1/merchants/76032/sites/96013/invoices`
   with `Representation-Type: deeplink/zappercode/v2`
3. Zapper returns a deep link: `https://www.zapper.com/payWithZapper?qr=...`
4. Function returns link to pay.html which redirects the user
5. On mobile → opens Zapper app to payment screen
6. On desktop → opens Zapper hosted payment page
7. After payment → Zapper redirects to success.html?reference=RR_...

## Payment confirmation
Once a user pays, Zapper will POST to your webhook URL.
Set this up at: https://mp.zapper.com → Integrations → Webhook
Recommended URL: a second Cloud Function `onZapperWebhook` (can add later)
For now, success.html activates the account optimistically on redirect.

## Your credentials (already embedded in index.js)
- Merchant ID:           76032
- Site ID:               96013
- Merchant API Key:      6c48d74081e0421bb1afce2edc9b4dde
- Merchant Site API Key: 1b8ba011df7b45e09c107e35aa70710c
