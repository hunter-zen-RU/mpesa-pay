require("dotenv").config();

const crypto = require("node:crypto");
const path = require("node:path");
const axios = require("axios");
const cors = require("cors");
const express = require("express");
const mongoose = require("mongoose");
const Payment = require("./models/paymentModel");

const app = express();
const port = Number(process.env.PORT || 3000);
const apiBaseUrl = (process.env.API_BASE_URL || "").replace(/\/+$/, "");
const frontendUrl = (process.env.FRONTEND_URL || "").replace(/\/+$/, "");
const mpesaBaseUrl =
  process.env.MPESA_ENV === "production"
    ? "https://api.safaricom.co.ke"
    : "https://sandbox.safaricom.co.ke";

app.disable("x-powered-by");
app.use(express.json({ limit: "16kb" }));
app.use(
  cors({
    origin(origin, callback) {
      if (!origin) return callback(null, true);

      const allowedOrigins = new Set(
        [frontendUrl, `http://localhost:${port}`, `http://127.0.0.1:${port}`]
          .filter(Boolean)
          .map((url) => {
            try {
              return new URL(url).origin;
            } catch {
              return null;
            }
          })
          .filter(Boolean),
      );

      return callback(null, allowedOrigins.has(origin));
    },
  }),
);
app.use(express.static(path.join(__dirname, "frontend")));

function constantTimeEqual(actual, expected) {
  if (typeof actual !== "string" || typeof expected !== "string") return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function requireSecret(secretName) {
  return (req, res, next) => {
    const expected = process.env[secretName];
    const authorization = req.get("authorization") || "";
    const supplied = authorization.startsWith("Bearer ")
      ? authorization.slice(7)
      : "";

    if (!expected) {
      return res.status(503).json({ error: `${secretName} is not configured` });
    }
    if (!constantTimeEqual(supplied, expected)) {
      return res.status(401).json({ error: "Unauthorized" });
    }
    return next();
  };
}

function normalizePhone(phone) {
  if (typeof phone !== "string") return null;
  const digits = phone.replace(/[\s()-]/g, "").replace(/^\+/, "");
  const normalized = digits.startsWith("0")
    ? `254${digits.slice(1)}`
    : digits.startsWith("254")
      ? digits
      : `254${digits}`;
  return /^254[17]\d{8}$/.test(normalized) ? normalized : null;
}

function getTimestamp() {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Africa/Nairobi",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}${values.month}${values.day}${values.hour}${values.minute}${values.second}`;
}

async function getMpesaToken() {
  const key = process.env.MPESA_CONSUMER_KEY;
  const secret = process.env.MPESA_CONSUMER_SECRET;
  if (!key || !secret) {
    throw new Error("M-Pesa API credentials are not configured");
  }

  const credentials = Buffer.from(`${key}:${secret}`).toString("base64");
  const response = await axios.get(
    `${mpesaBaseUrl}/oauth/v1/generate?grant_type=client_credentials`,
    { headers: { Authorization: `Basic ${credentials}` }, timeout: 15000 },
  );
  return response.data.access_token;
}

function getCheckoutUrl(checkoutId) {
  const base = frontendUrl || `${apiBaseUrl || `http://localhost:${port}`}`;
  const page = frontendUrl ? "checkout.html" : "/checkout.html";
  return `${base}${page.startsWith("/") ? "" : "/"}${page}?id=${encodeURIComponent(checkoutId)}`;
}

app.get("/api/health", (_req, res) => {
  res.json({ status: "ok" });
});

async function createPaymentIntent(req, res) {
  const { amount, currency = "KES", reference, description } = req.body || {};
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    return res.status(400).json({ error: "amount must be a positive whole number in KES" });
  }
  if (currency !== "KES") {
    return res.status(400).json({ error: "Only KES payments are supported" });
  }
  if (reference !== undefined && (typeof reference !== "string" || reference.length > 100)) {
    return res.status(400).json({ error: "reference must be a string of at most 100 characters" });
  }
  if (description !== undefined && (typeof description !== "string" || description.length > 200)) {
    return res.status(400).json({ error: "description must be a string of at most 200 characters" });
  }

  try {
    const checkoutId = crypto.randomUUID();
    const payment = await Payment.create({
      checkoutId,
      reference: reference || `MP-${crypto.randomBytes(6).toString("hex").toUpperCase()}`,
      amount,
      currency,
      description: description || "",
      status: "pending",
    });

    return res.status(201).json({
      id: payment.checkoutId,
      reference: payment.reference,
      amount: payment.amount,
      currency: payment.currency,
      status: payment.status,
      checkout_url: getCheckoutUrl(payment.checkoutId),
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: "That payment reference already exists" });
    }
    console.error("Could not create payment intent:", error.message);
    return res.status(500).json({ error: "Could not create payment intent" });
  }
}

app.post("/api/v1/payment-intents", requireSecret("API_SECRET_KEY"), createPaymentIntent);
app.post("/api/v1/dashboard/payment-intents", requireSecret("DASHBOARD_API_KEY"), createPaymentIntent);

app.get("/api/v1/checkout/:id", async (req, res) => {
  try {
    const payment = await Payment.findOne({ checkoutId: req.params.id }).lean();
    if (!payment) return res.status(404).json({ error: "Payment link not found" });
    return res.json({
      id: payment.checkoutId,
      reference: payment.reference,
      amount: payment.amount,
      currency: payment.currency,
      description: payment.description,
      status: payment.status,
    });
  } catch (error) {
    console.error("Could not load checkout:", error.message);
    return res.status(500).json({ error: "Could not load checkout" });
  }
});

app.post("/api/v1/checkout/:id/pay", async (req, res) => {
  const phone = normalizePhone(req.body?.phone);
  if (!phone) {
    return res.status(400).json({ error: "Enter a valid Kenyan mobile number" });
  }

  const requiredConfig = [
    "MPESA_CONSUMER_KEY",
    "MPESA_CONSUMER_SECRET",
    "MPESA_PAYBILL",
    "MPESA_PASSKEY",
    "MPESA_CALLBACK_URL",
  ];
  const missingConfig = requiredConfig.filter((key) => !process.env[key]);
  if (missingConfig.length) {
    return res.status(503).json({ error: `M-Pesa is not configured: ${missingConfig.join(", ")}` });
  }

  let mpesaRequestAttempted = false;
  try {
    const payment = await Payment.findOneAndUpdate(
      { checkoutId: req.params.id, status: "pending" },
      { $set: { phone, status: "processing" } },
      { new: true },
    );
    if (!payment) {
      const exists = await Payment.exists({ checkoutId: req.params.id });
      return res.status(exists ? 409 : 404).json({
        error: exists ? "This payment is already being processed or is complete" : "Payment link not found",
      });
    }

    const timestamp = getTimestamp();
    const shortcode = process.env.MPESA_PAYBILL;
    const password = Buffer.from(
      `${shortcode}${process.env.MPESA_PASSKEY}${timestamp}`,
    ).toString("base64");
    const token = await getMpesaToken();
    mpesaRequestAttempted = true;
    const response = await axios.post(
      `${mpesaBaseUrl}/mpesa/stkpush/v1/processrequest`,
      {
        BusinessShortCode: shortcode,
        Password: password,
        Timestamp: timestamp,
        TransactionType: process.env.MPESA_TRANSACTION_TYPE || "CustomerPayBillOnline",
        Amount: payment.amount,
        PartyA: phone,
        PartyB: shortcode,
        PhoneNumber: phone,
        CallBackURL: process.env.MPESA_CALLBACK_URL,
        AccountReference: payment.reference.slice(0, 12),
        TransactionDesc: (payment.description || payment.reference).slice(0, 13),
      },
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 20000,
      },
    );

    if (String(response.data?.ResponseCode) !== "0" || !response.data?.CheckoutRequestID) {
      await Payment.updateOne(
        { _id: payment._id, status: "processing" },
        { $set: { status: "failed", resultDescription: response.data?.ResponseDescription || "M-Pesa rejected the request" } },
      );
      return res.status(502).json({ error: response.data?.ResponseDescription || "M-Pesa rejected the request" });
    }

    await Payment.updateOne(
      { _id: payment._id },
      {
        $set: {
          providerCheckoutRequestId: response.data.CheckoutRequestID,
          providerMerchantRequestId: response.data.MerchantRequestID,
        },
      },
    );
    return res.json({ status: "processing", message: "Check your phone and enter your M-Pesa PIN" });
  } catch (error) {
    console.error("Could not start M-Pesa payment:", error.response?.data || error.message);
    if (mpesaRequestAttempted) {
      return res.status(202).json({
        status: "processing",
        message: "We could not confirm the M-Pesa response yet. Wait for a status update before trying again.",
      });
    }
    await Payment.updateOne(
      { checkoutId: req.params.id, status: "processing" },
      { $set: { status: "failed", resultDescription: "Could not start M-Pesa payment" } },
    ).catch((updateError) => console.error("Could not update payment status:", updateError.message));
    return res.status(502).json({ error: "Could not start the M-Pesa payment. Please try again." });
  }
});

app.post("/api/v1/mpesa/callback", async (req, res) => {
  const callback = req.body?.Body?.stkCallback;
  const checkoutRequestId = callback?.CheckoutRequestID;
  if (!callback || !checkoutRequestId) {
    return res.status(400).json({ error: "Invalid M-Pesa callback" });
  }

  const success = Number(callback.ResultCode) === 0;
  const metadata = callback.CallbackMetadata?.Item || [];
  const receipt = metadata.find((item) => item.Name === "MpesaReceiptNumber")?.Value;
  try {
    const result = await Payment.updateOne(
      { providerCheckoutRequestId: checkoutRequestId, status: "processing" },
      {
        $set: {
          status: success ? "succeeded" : "failed",
          resultDescription: String(callback.ResultDesc || "").slice(0, 200),
          ...(receipt ? { receiptNumber: String(receipt) } : {}),
        },
      },
    );
    if (!result.matchedCount) {
      console.warn("Received an unmatched M-Pesa callback");
    }
    return res.json({ ResultCode: 0, ResultDesc: "Accepted" });
  } catch (error) {
    console.error("Could not process M-Pesa callback:", error.message);
    return res.status(500).json({ error: "Could not process callback" });
  }
});

app.get(
  "/api/v1/payment-intents/:id",
  requireSecret("API_SECRET_KEY"),
  async (req, res) => {
    try {
      const payment = await Payment.findOne({ checkoutId: req.params.id }).lean();
      if (!payment) return res.status(404).json({ error: "Payment link not found" });
      return res.json({
        id: payment.checkoutId,
        reference: payment.reference,
        amount: payment.amount,
        currency: payment.currency,
        status: payment.status,
        receipt_number: payment.receiptNumber || null,
        created_at: payment.createdAt,
      });
    } catch (error) {
      console.error("Could not load payment intent:", error.message);
      return res.status(500).json({ error: "Could not load payment intent" });
    }
  },
);

app.get(
  "/api/v1/dashboard/payments",
  requireSecret("DASHBOARD_API_KEY"),
  async (_req, res) => {
    try {
      const payments = await Payment.find({ checkoutId: { $exists: true } })
        .sort({ createdAt: -1 })
        .limit(100)
        .select("reference amount currency status phone receiptNumber createdAt resultDescription")
        .lean();
      return res.json(
        payments.map((payment) => ({
          reference: payment.reference,
          amount: payment.amount,
          currency: payment.currency,
          status: payment.status,
          phone: payment.phone ? `${payment.phone.slice(0, 6)}••••${payment.phone.slice(-2)}` : "",
          receipt_number: payment.receiptNumber || "",
          created_at: payment.createdAt,
          message: payment.resultDescription || "",
        })),
      );
    } catch (error) {
      console.error("Could not load dashboard payments:", error.message);
      return res.status(500).json({ error: "Could not load payments" });
    }
  },
);

app.use((error, _req, res, _next) => {
  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({ error: "Request body must be valid JSON" });
  }
  console.error("Unexpected request error:", error.message);
  return res.status(500).json({ error: "Internal server error" });
});

async function start() {
  const mongoUri = process.env.MONGODB_URI || process.env.URI;
  if (!mongoUri) throw new Error("MONGODB_URI is required");

  await mongoose.connect(mongoUri);
  app.listen(port, () => {
    console.log(`Payment API listening on port ${port}`);
  });
}

if (require.main === module) {
  start().catch((error) => {
    console.error("Could not start payment API:", error.message);
    process.exitCode = 1;
  });
}

module.exports = app;
