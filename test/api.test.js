const assert = require("node:assert/strict");
const { after, before, test } = require("node:test");

process.env.API_SECRET_KEY = "test-api-secret";
process.env.DASHBOARD_API_KEY = "test-dashboard-secret";
process.env.FRONTEND_URL = "https://owner.github.io/mpesa-pay";

const Payment = require("../models/paymentModel");
const payments = new Map();
Payment.create = async (data) => {
  const payment = { ...data, createdAt: new Date() };
  payments.set(payment.checkoutId, payment);
  return payment;
};
Payment.findOne = (query) => ({
  lean: async () => payments.get(query.checkoutId) || null,
});

const app = require("../index");
let server;
let baseUrl;

before(async () => {
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
});

test("merchant API creates payment links and serves public checkout", async () => {
  const unauthorized = await fetch(`${baseUrl}/api/v1/payment-intents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: 2450 }),
  });
  assert.equal(unauthorized.status, 401);

  const invalidAmount = await fetch(`${baseUrl}/api/v1/payment-intents`, {
    method: "POST",
    headers: {
      Authorization: "Bearer test-api-secret",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ amount: 2.5 }),
  });
  assert.equal(invalidAmount.status, 400);

  const createdResponse = await fetch(`${baseUrl}/api/v1/payment-intents`, {
    method: "POST",
    headers: {
      Authorization: "Bearer test-api-secret",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: 2450,
      currency: "KES",
      reference: "TEST-1042",
    }),
  });
  assert.equal(createdResponse.status, 201);
  const created = await createdResponse.json();
  assert.match(created.checkout_url, new RegExp(`/checkout\\.html\\?id=${created.id}$`));

  const checkoutResponse = await fetch(`${baseUrl}/api/v1/checkout/${created.id}`);
  assert.equal(checkoutResponse.status, 200);
  const checkout = await checkoutResponse.json();
  assert.equal(checkout.amount, 2450);
  assert.equal(checkout.reference, "TEST-1042");

  const dashboardUnauthorized = await fetch(`${baseUrl}/api/v1/dashboard/payments`);
  assert.equal(dashboardUnauthorized.status, 401);

  const dashboardCreated = await fetch(`${baseUrl}/api/v1/dashboard/payment-intents`, {
    method: "POST",
    headers: {
      Authorization: "Bearer test-dashboard-secret",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ amount: 500, currency: "KES" }),
  });
  assert.equal(dashboardCreated.status, 201);

  const homePage = await fetch(`${baseUrl}/`);
  assert.equal(homePage.status, 200);
  assert.match(await homePage.text(), /Payments that fit/);
});
