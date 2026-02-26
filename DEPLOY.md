# Deploy RubbishRouter Zapper Cloud Function

## Prerequisites
- Node.js installed (v18+) — check with: `node --version`
- A Google account that has access to the `rubbishrouter-688b2` Firebase project

## Step 1 — Install Firebase CLI
```
npm install -g firebase-tools
```

## Step 2 — Log in to Firebase
```
firebase login
```
A browser window will open. Log in with the Google account that owns the project.

## Step 3 — Go into this folder
```
cd rubbishrouter-deploy
```

## Step 4 — Install function dependencies
```
cd functions
npm install
cd ..
```

## Step 5 — Deploy
```
firebase deploy --only functions
```

## Expected output
```
✔  functions: Finished running predeploy script.
i  functions: ensuring required API cloudfunctions.googleapis.com is enabled...
✔  functions[createZapperInvoice(us-central1)]: Successful create operation.

Function URL (createZapperInvoice(us-central1)):
https://us-central1-rubbishrouter-688b2.cloudfunctions.net/createZapperInvoice

✔  Deploy complete!
```

## Verify it's working
Open this URL in your browser — you should get:
```
{"error":"Method not allowed"}
```
That's correct — it only accepts POST requests. It means the function is live.

## What happens next
When a resident taps PAY in the app:
1. pay.html calls this function with { amountCents: 1500, reference: "RR_..." }
2. Function calls Zapper API server-side and gets back a deep link
3. pay.html redirects the user to the deep link
4. On mobile → opens Zapper app directly to payment screen
5. On desktop → opens Zapper hosted payment page
6. After payment → Zapper redirects to success.html which activates the account

## Troubleshooting
- "Permission denied" → make sure you're logged in as the project owner
- "Billing not enabled" → Cloud Functions requires Blaze (pay-as-you-go) plan.
  Go to console.firebase.google.com → your project → Upgrade plan.
  At your scale the cost will be ~R0/month (free tier covers millions of invocations).
- "Node version" error → run `nvm use 18` or install Node 18 from nodejs.org
