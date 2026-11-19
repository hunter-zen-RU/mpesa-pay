(() => {
  const configuredUrl = window.MPESA_API_BASE_URL.trim();
  const baseUrl = (configuredUrl || window.location.origin).replace(/\/+$/, "");

  async function request(path, options = {}) {
    let response;
    try {
      response = await fetch(`${baseUrl}${path}`, {
        ...options,
        headers: {
          ...(options.body ? { "Content-Type": "application/json" } : {}),
          ...options.headers,
        },
      });
    } catch {
      throw new Error("Cannot reach the payment server. Check your connection.");
    }

    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || "The request could not be completed.");
    return data;
  }

  window.PaymentApi = {
    request,
    formatAmount(amount, currency = "KES") {
      return new Intl.NumberFormat("en-KE", {
        style: "currency",
        currency,
        maximumFractionDigits: 0,
      }).format(amount);
    },
  };
})();
