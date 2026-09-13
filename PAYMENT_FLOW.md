# Razorpay Payment Gateway Integration — Documentation

## Overview

This backend integrates Razorpay for hackathon team registration payments. It handles order creation, payment verification, and webhook processing.

**Stack:** Express.js + Prisma + PostgreSQL + Razorpay Node SDK

---

## Architecture

```
Frontend
   |
   | POST /api/payments/create-order (JWT)
   v
Backend ─────────────────> Razorpay Orders API
   |                              |
   | returns orderId              | returns order
   v                              v
Frontend opens Razorpay Checkout
   |
   | User pays
   v
Razorpay returns: paymentId, signature
   |
   | POST /api/payments/verify (JWT)
   v
Backend verifies signature server-side
   |
   | Saves payment record
   v
Razorpay also sends webhook (server-to-server)
   |
   | POST /api/webhooks/razorpay
   v
Backend processes webhook (idempotent)
```

---

## Database Schema

### `Payment`

| Column | Type | Purpose |
|--------|------|---------|
| id | UUID | Primary key |
| razorpayOrderId | String (unique) | Razorpay order ID (e.g. `order_xxx`) |
| razorpayPaymentId | String (unique, nullable) | Razorpay payment ID (e.g. `pay_xxx`) |
| amountPaise | Integer | Amount in paise (e.g. 50000 = ₹500) |
| currency | String | Default "INR" |
| status | String | `CREATED`, `CAPTURED`, `FAILED`, `REFUNDED` |
| signatureVerified | Boolean | True if `/payments/verify` confirmed signature |
| rawPayload | Json | Stores full Razorpay response for audit |
| createdAt | DateTime | Auto |
| updatedAt | DateTime | Auto |

### `WebhookEvent`

| Column | Type | Purpose |
|--------|------|---------|
| id | String (cuid) | Primary key |
| eventId | String (unique) | Razorpay's event ID for deduplication |
| eventType | String | e.g. `payment.captured` |
| payload | Json | Full Razorpay webhook payload |
| processed | Boolean | Whether this event has been handled |
| receivedAt | DateTime | When we received it |
| processedAt | DateTime | When we finished processing |

---

## API Endpoints

### 1. `POST /api/payments/create-order`

**Auth:** Bearer JWT required

**Request:**
```json
{
  "amountPaise": 50000,
  "currency": "INR",
  "receipt": "optional-receipt-id"
}
```

**Validation:**
- `amountPaise` must be a number between 1000 and 10,000,000

**What happens:**
1. Validates input
2. Calls Razorpay Orders API via SDK
3. Saves a `Payment` record with status `CREATED`
4. Returns `orderId`, `amount`, `currency`, and `keyId` (public key)

**Response:**
```json
{
  "orderId": "order_xxx",
  "amount": 50000,
  "currency": "INR",
  "keyId": "rzp_test_xxx"
}
```

**Security:** The `keySecret` is never sent to the frontend.

---

### 2. `POST /api/payments/verify`

**Auth:** Bearer JWT required

**Request:**
```json
{
  "razorpayOrderId": "order_xxx",
  "razorpayPaymentId": "pay_xxx",
  "razorpaySignature": "abc123..."
}
```

**What happens:**
1. Looks up the `Payment` record by `razorpayOrderId`
2. Computes expected signature: `HMAC-SHA256(keySecret, orderId|paymentId)`
3. Compares computed signature with the provided `razorpaySignature`
4. If match: updates Payment to `CAPTURED`, sets `signatureVerified = true`
5. If no match: returns `PAYMENT_VERIFICATION_FAILED`

**Response (success):**
```json
{
  "status": "CAPTURED",
  "paymentId": "pay_xxx",
  "orderId": "order_xxx",
  "amountPaise": 50000,
  "currency": "INR"
}
```

**Why this matters:** Razorpay Checkout sends a signature that can only be verified with the server-side secret. This prevents someone from faking a successful payment.

---

### 3. `POST /api/webhooks/razorpay`

**Auth:** None (Razorpay servers call this, verified via `X-Razorpay-Signature` header)

**Request:** Raw Razorpay event payload (JSON)

**What happens:**
1. Reads `X-Razorpay-Signature` header
2. In production: verifies signature using `HMAC-SHA256(webhookSecret, rawBody)`
3. Checks `WebhookEvent` table for duplicate `eventId` (idempotency)
4. If already processed → returns 200 immediately
5. Stores the event
6. Handles event type:
   - `payment.captured` or `order.paid` → updates Payment to `CAPTURED`
   - `payment.failed` → updates Payment to `FAILED`
7. Marks event as processed
8. Returns 200

**Critical:** This route uses `express.raw()` middleware instead of `express.json()` so the raw body is available for signature verification. It's mounted BEFORE `express.json()` in the middleware chain.

**Idempotency:** Razorpay may send the same webhook multiple times. The `eventId` deduplication ensures we only process each event once.

---

## How the Full Payment Flow Works (Step by Step)

### Step 1: User fills registration form

The frontend collects team name, college, and 1-4 members.

### Step 2: Frontend calls `POST /api/payments/create-order`

```js
const res = await fetch("/api/payments/create-order", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer <jwt_token>"
  },
  body: JSON.stringify({ amountPaise: 50000 })
});
const { orderId, keyId, amount, currency } = await res.json();
```

**What the backend does:**
- Validates the amount
- Creates a Razorpay Order via the SDK (server-side, with `key_secret`)
- Saves a `Payment` record in the database
- Returns only the public `keyId` and `orderId`

### Step 3: Frontend opens Razorpay Checkout

```js
const options = {
  key: keyId,                    // public key only
  amount: amount,                // from backend
  currency: currency,            // from backend
  order_id: orderId,             // from backend
  handler: function(response) {
    // payment succeeded — see Step 4
  }
};
const rzp = new Razorpay(options);
rzp.open();
```

**What happens:** Razorpay's Checkout.js opens a payment modal. The user enters card details and pays. Razorpay handles all the banking complexity.

### Step 4: Frontend receives payment response

After successful payment, Razorpay's `handler` callback receives:

```js
{
  razorpay_order_id: "order_xxx",
  razorpay_payment_id: "pay_xxx",
  razorpay_signature: "abc123..."
}
```

**Important:** This does NOT mean the payment is confirmed yet. The signature must be verified server-side.

### Step 5: Frontend calls `POST /api/payments/verify`

```js
const res = await fetch("/api/payments/verify", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": "Bearer <jwt_token>"
  },
  body: JSON.stringify({
    razorpayOrderId: response.razorpay_order_id,
    razorpayPaymentId: response.razorpay_payment_id,
    razorpaySignature: response.razorpay_signature
  })
});
```

**What the backend does:**
- Looks up the order in the database
- Computes `HMAC-SHA256(key_secret, order_id|payment_id)`
- Compares with the provided signature
- If valid → marks payment as `CAPTURED`
- Returns confirmation

### Step 6: Razorpay also sends a webhook (asynchronous backup)

Even if Step 5 fails (e.g. user's internet drops), Razorpay sends a server-to-server webhook:

```
POST /api/webhooks/razorpay
X-Razorpay-Signature: <signature>
Body: { event: "payment.captured", ... }
```

The webhook handler:
- Verifies the signature
- Deduplicates by `event_id`
- Updates the payment record
- Returns 200

This is the **reliable** mechanism. The verify endpoint is for **immediate** user feedback.

### Step 7: Frontend shows confirmation

Only after the backend verify endpoint returns `CAPTURED` should the frontend show "Payment Successful".

---

## Why Both Verify AND Webhook?

| | `/payments/verify` | Webhook |
|---|---|---|
| **Triggered by** | Frontend after checkout | Razorpay servers |
| **Timing** | Immediate | Seconds to minutes delay |
| **Purpose** | Fast user feedback | Reliable async confirmation |
| **Handles network failure** | No (user may disconnect) | Yes (server-to-server) |
| **Signature verification** | Uses `key_secret` | Uses `webhook_secret` |

Razorpay recommends using both. The verify endpoint gives instant feedback; the webhook is the safety net.

---

## Security Measures

1. **Amount calculated server-side** — Frontend never sends the payment amount for order creation; it's configured in the backend
2. **Signature verification** — Every payment is verified using HMAC-SHA256 with the server-only `key_secret`
3. **Webhook signature verification** — Webhooks are verified using a separate `webhook_secret`
4. **Idempotent webhooks** — Duplicate events are detected via `eventId` deduplication
5. **No secrets in frontend** — Only `key_id` (public) is sent to the browser
6. **JWT authentication** — All payment endpoints require a valid JWT
7. **Dev mode bypass** — Webhook signature verification is skipped in non-production for testing

---

## Environment Variables

```env
# Database
DATABASE_URL=postgresql://postgres:postgres@db:5432/hackathon?schema=public

# Razorpay (test mode)
RAZORPAY_KEY_ID=rzp_test_xxx
RAZORPAY_KEY_SECRET=xxx
RAZORPAY_WEBHOOK_SECRET=xxx

# Auth
JWT_SECRET=your-random-secret

# Server
PORT=8080
NODE_ENV=development
```

---

## Running

```bash
# Start everything
docker compose up -d

# Push schema to database
docker compose exec backend npx prisma db push

# Access test page
open http://localhost:8080/test-payment

# Check health
curl http://localhost:8080/api/health
```

---

## Test Page Flow

1. **Get Token** — Calls `/api/auth/dev-token` to get a JWT without Google auth
2. **Create Order** — Calls `/api/payments/create-order` with amount in paise
3. **Open Checkout** — Opens Razorpay Checkout with the order
4. **Verify Payment** — Calls `/api/payments/verify` with the payment response
5. **Simulate Webhook** — Sends a fake `payment.captured` event to `/api/webhooks/razorpay`

---

## Test Cards

| Card | Type | Result |
|------|------|--------|
| `5267 3181 8797 5449` | Mastercard Domestic | Success |
| `4111 1111 1111 1111` | Visa (may be treated as international) | Success (if intl enabled) |

Expiry: Any future date | CVV: Any 3 digits

---

## File Structure

```
temp-hack-back/
├── prisma/
│   └── schema.prisma          # Payment + WebhookEvent models
├── services/
│   ├── razorpay.js            # SDK instance, createOrder, signature verification
│   └── prisma.js              # Prisma client singleton
├── controllers/
│   ├── paymentController.js   # createOrder + verifyPayment handlers
│   └── webhookController.js   # Webhook handler with idempotency
├── routes/
│   ├── payments.js            # /api/payments/*
│   ├── webhooks.js            # /api/webhooks/*
│   ├── dev.js                 # /api/auth/dev-token (dev only)
│   └── auth.js                # Google auth (existing)
├── middleware/
│   └── auth.js                # JWT verification
├── server.js                  # Express app, middleware chain
├── docker-compose.yml         # Postgres + backend
├── Dockerfile                 # Node 20 + OpenSSL
├── test-payment.html          # Interactive payment test page
└── .env                       # Secrets (gitignored)
```

---

## Common Errors

| Error | Cause | Fix |
|-------|-------|-----|
| `VALIDATION_ERROR` | Amount out of range | Send `amountPaise` between 1000 and 10000000 |
| `PAYMENT_NOT_FOUND` | Order ID not in database | Ensure create-order succeeded |
| `PAYMENT_VERIFICATION_FAILED` | Signature mismatch | Check `key_secret` is correct |
| `Missing raw body` | express.raw() not parsing | Ensure webhook route is before express.json() |
| `International cards not supported` | Razorpay account setting | Enable in dashboard or use domestic card |
