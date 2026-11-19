# Payflow M-Pesa starter

A small, server-side M-Pesa payment platform starter with:

- A merchant API for creating KES payment intents and hosted checkout links.
- A customer checkout page that starts an M-Pesa STK Push.
- A transaction dashboard protected by a separate dashboard key.
- A Safaricom callback endpoint that records payment success or failure.
- A static frontend that can be deployed to GitHub Pages; the API must run on a separate server.

This is a single-merchant MVP, not a complete Paystack replacement. It does not include merchant onboarding, card payments, refunds, settlement, or production-grade user accounts. Test the complete flow with Safaricom sandbox credentials before enabling live payments.

## Run locally

1. Use Node.js 18 or newer and MongoDB.
2. Copy `.env.example` to `.env` and set MongoDB, API/dashboard keys, and M-Pesa sandbox values.
3. Set `MPESA_CALLBACK_URL` to a publicly reachable HTTPS URL for `/api/v1/mpesa/callback` when testing STK Push callbacks. A local server needs a secure tunnel.
4. Install dependencies with `npm install`, then run `npm start`.
5. Open `http://localhost:3000`. The checkout page and dashboard are served by the API in local development.

Generate distinct secret keys, for example with `openssl rand -hex 32`. Never commit `.env`, expose `API_SECRET_KEY` in browser code, or use the dashboard key as an API key.

## Create a payment link

Call the create endpoint from your **server**, not from browser JavaScript:

```sh
curl -X POST http://localhost:3000/api/v1/payment-intents \
  -H "Authorization: Bearer $API_SECRET_KEY" \
  -H "Content-Type: application/json" \
  -d '{"amount":2450,"currency":"KES","reference":"ORD-1042","description":"Order 1042"}'
```

The response contains a `checkout_url`. Redirect the customer to it or share the link. Amounts are whole KES (not cents). Supply a unique order reference for each payment. Check a payment's final status server-side with:

```sh
curl http://localhost:3000/api/v1/payment-intents/PAYMENT_ID \
  -H "Authorization: Bearer $API_SECRET_KEY"
```

The customer enters their Kenyan mobile number on hosted checkout. Safaricom then sends the STK prompt. The API key must be kept on your server; use the hosted page only as the customer-facing checkout.

## Deploy

### Backend

Deploy this Node.js service to a host that supports persistent server processes and set the variables in `.env.example` in the host's secret/configuration settings. Use a managed MongoDB instance, set `MPESA_ENV` to `sandbox` until the end-to-end sandbox flow works, and set `MPESA_CALLBACK_URL` to the backend's public HTTPS URL plus `/api/v1/mpesa/callback`.

Set `FRONTEND_URL` to the exact GitHub Pages site URL (for a project site, typically `https://OWNER.github.io/REPOSITORY`). This controls the checkout links returned by the API and the browser origin allowed by CORS.

### GitHub Pages frontend

The workflow in `.github/workflows/pages.yml` publishes only `frontend/`. In repository settings, enable **Pages → GitHub Actions** and add a repository variable named `API_BASE_URL` containing the backend's public origin, for example `https://your-api.example.com` (no trailing slash). Push to `main` or run the workflow manually. The dashboard can then be opened from the Pages site.

Alternatively, edit `frontend/config.js` to set `window.MPESA_API_BASE_URL` to your backend URL before publishing the static files. Do not put either secret key or M-Pesa credentials in this frontend.

## Environment variables

See `.env.example` for the required configuration. `API_SECRET_KEY` authenticates merchant API requests; `DASHBOARD_API_KEY` authenticates dashboard requests. Keep both distinct and rotate them if exposed.

## API overview

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Service health |
| `POST` | `/api/v1/payment-intents` | Create an intent (API secret required) |
| `GET` | `/api/v1/payment-intents/:id` | Read an intent (API secret required) |
| `GET` | `/api/v1/checkout/:id` | Read public checkout details/status |
| `POST` | `/api/v1/checkout/:id/pay` | Start M-Pesa STK Push |
| `POST` | `/api/v1/mpesa/callback` | Safaricom payment callback |
| `POST` | `/api/v1/dashboard/payment-intents` | Create an intent in the dashboard (dashboard key required) |
| `GET` | `/api/v1/dashboard/payments` | Latest transactions (dashboard key required) |
