(() => {
  const content = document.getElementById("checkout-content");
  const paymentId = new URLSearchParams(window.location.search).get("id");
  let polling;

  function showMessage(message, kind = "error") {
    let element = document.getElementById("checkout-message");
    if (!element) {
      element = document.createElement("p");
      element.id = "checkout-message";
      element.className = "form-message";
      content.append(element);
    }
    element.textContent = message;
    element.dataset.kind = kind;
  }

  async function loadPayment() {
    if (!paymentId) throw new Error("This payment link is incomplete.");
    const payment = await PaymentApi.request(`/api/v1/checkout/${encodeURIComponent(paymentId)}`);
    content.innerHTML = `
      <div class="checkout-reference">${escapeHtml(payment.reference)}</div>
      <h1 class="checkout-amount">${PaymentApi.formatAmount(payment.amount, payment.currency)}</h1>
      <p class="checkout-description">${escapeHtml(payment.description || "Complete your payment with M-Pesa.")}</p>
      <div class="checkout-rule"></div>
      <div class="checkout-status-line"><span>Payment status</span><span id="payment-status" class="status-pill status-${payment.status}">${labelStatus(payment.status)}</span></div>
      <form id="payment-form" class="payment-form">
        <label for="phone">M-Pesa phone number</label>
        <div class="phone-input"><span>🇰🇪 +254</span><input id="phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" placeholder="7XX XXX XXX" required></div>
        <button class="button button-primary button-full" id="pay-button" type="submit">Pay with M-Pesa <span aria-hidden="true">→</span></button>
      </form>
      <p class="form-message" id="checkout-message" aria-live="polite"></p>
    `;

    if (payment.status !== "pending") {
      document.getElementById("payment-form").hidden = true;
      showMessage(statusMessage(payment.status), payment.status === "succeeded" ? "success" : "info");
    }

    document.getElementById("payment-form").addEventListener("submit", startPayment);
    if (payment.status === "processing") watchStatus();
  }

  async function startPayment(event) {
    event.preventDefault();
    const button = document.getElementById("pay-button");
    const phone = document.getElementById("phone").value.trim();
    button.disabled = true;
    button.textContent = "Sending M-Pesa prompt…";
    try {
      const result = await PaymentApi.request(
        `/api/v1/checkout/${encodeURIComponent(paymentId)}/pay`,
        { method: "POST", body: JSON.stringify({ phone }) },
      );
      showMessage(result.message, "info");
      document.getElementById("payment-form").hidden = true;
      setStatus("processing");
      watchStatus();
    } catch (error) {
      showMessage(error.message);
      button.disabled = false;
      button.innerHTML = 'Pay with M-Pesa <span aria-hidden="true">→</span>';
    }
  }

  function watchStatus() {
    clearInterval(polling);
    polling = setInterval(async () => {
      try {
        const payment = await PaymentApi.request(`/api/v1/checkout/${encodeURIComponent(paymentId)}`);
        setStatus(payment.status);
        if (payment.status === "succeeded" || payment.status === "failed") {
          clearInterval(polling);
          showMessage(statusMessage(payment.status), payment.status === "succeeded" ? "success" : "error");
        }
      } catch {
        showMessage("Waiting for payment confirmation…", "info");
      }
    }, 4000);
  }

  function setStatus(status) {
    const badge = document.getElementById("payment-status");
    if (!badge) return;
    badge.className = `status-pill status-${status}`;
    badge.textContent = labelStatus(status);
  }

  function labelStatus(status) {
    return status.charAt(0).toUpperCase() + status.slice(1);
  }

  function statusMessage(status) {
    if (status === "succeeded") return "Payment received. You can close this page.";
    if (status === "failed") return "This payment did not complete. Contact the merchant for a new link.";
    return "An M-Pesa prompt was sent. Enter your PIN on your phone to finish.";
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[char]);
  }

  loadPayment().catch((error) => {
    content.innerHTML = "";
    showMessage(error.message);
  });
})();
