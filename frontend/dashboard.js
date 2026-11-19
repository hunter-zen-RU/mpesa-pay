(() => {
  const keyName = "payflow_dashboard_key";
  const loginCard = document.getElementById("login-card");
  const paymentsSection = document.getElementById("payments-section");
  const refreshButton = document.getElementById("refresh-button");
  const paymentsList = document.getElementById("payments-list");
  const emptyState = document.getElementById("empty-state");
  let dashboardKey = sessionStorage.getItem(keyName) || "";

  async function loadPayments(key) {
    const data = await PaymentApi.request("/api/v1/dashboard/payments", {
      headers: { Authorization: `Bearer ${key}` },
    });
    paymentsList.innerHTML = "";
    emptyState.hidden = data.length > 0;
    for (const payment of data) {
      const row = document.createElement("tr");
      const date = payment.created_at
        ? new Date(payment.created_at).toLocaleString("en-KE")
        : "—";
      row.innerHTML = `
        <td><strong>${escapeHtml(payment.reference)}</strong><small>${escapeHtml(payment.receipt_number || "")}</small></td>
        <td>${PaymentApi.formatAmount(payment.amount, payment.currency)}</td>
        <td>${escapeHtml(payment.phone || "—")}</td>
        <td><span class="status-pill status-${escapeHtml(payment.status)}">${escapeHtml(payment.status)}</span></td>
        <td>${escapeHtml(date)}</td>
      `;
      paymentsList.append(row);
    }
    loginCard.hidden = true;
    paymentsSection.hidden = false;
    refreshButton.hidden = false;
  }

  document.getElementById("login-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const key = document.getElementById("dashboard-key").value.trim();
    const message = document.getElementById("login-message");
    message.textContent = "Loading payments…";
    message.dataset.kind = "info";
    try {
      await loadPayments(key);
      dashboardKey = key;
      sessionStorage.setItem(keyName, key);
    } catch (error) {
      message.textContent = error.message;
      message.dataset.kind = "error";
    }
  });

  refreshButton.addEventListener("click", async () => {
    if (!dashboardKey) return showLogin();
    refreshButton.disabled = true;
    try {
      await loadPayments(dashboardKey);
    } catch (error) {
      sessionStorage.removeItem(keyName);
      dashboardKey = "";
      showLogin(error.message);
    } finally {
      refreshButton.disabled = false;
    }
  });

  document.getElementById("logout-button").addEventListener("click", () => {
    sessionStorage.removeItem(keyName);
    dashboardKey = "";
    showLogin();
  });

  document.getElementById("create-payment-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const button = document.getElementById("create-payment-button");
    const message = document.getElementById("create-payment-message");
    const result = document.getElementById("payment-link-result");
    const payload = {
      amount: Number(form.elements.amount.value),
      currency: "KES",
      reference: form.elements.reference.value.trim(),
      description: form.elements.description.value.trim(),
    };
    if (!payload.reference) delete payload.reference;
    if (!payload.description) delete payload.description;
    button.disabled = true;
    message.textContent = "";
    result.hidden = true;

    try {
      const payment = await PaymentApi.request("/api/v1/dashboard/payment-intents", {
        method: "POST",
        headers: { Authorization: `Bearer ${dashboardKey}` },
        body: JSON.stringify(payload),
      });
      const link = document.getElementById("payment-link");
      link.href = payment.checkout_url;
      link.textContent = payment.checkout_url;
      result.hidden = false;
      message.textContent = "Payment link created.";
      message.dataset.kind = "success";
      form.reset();
      await loadPayments(dashboardKey);
    } catch (error) {
      message.textContent = error.message;
      message.dataset.kind = "error";
    } finally {
      button.disabled = false;
    }
  });

  document.getElementById("copy-link-button").addEventListener("click", async () => {
    const link = document.getElementById("payment-link");
    try {
      await navigator.clipboard.writeText(link.href);
      document.getElementById("copy-link-button").textContent = "Copied";
    } catch {
      link.focus();
      window.prompt("Copy this checkout link:", link.href);
    }
  });

  function showLogin(message = "") {
    paymentsSection.hidden = true;
    refreshButton.hidden = true;
    loginCard.hidden = false;
    const loginMessage = document.getElementById("login-message");
    loginMessage.textContent = message;
    loginMessage.dataset.kind = message ? "error" : "";
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    })[char]);
  }

  if (dashboardKey) {
    loadPayments(dashboardKey).catch((error) => {
      sessionStorage.removeItem(keyName);
      dashboardKey = "";
      showLogin(error.message);
    });
  }
})();
