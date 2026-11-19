const mongoose = require("mongoose");

const paymentSchema = new mongoose.Schema(
  {
    checkoutId: { type: String, required: true, unique: true },
    reference: { type: String, required: true, unique: true, maxlength: 100 },
    amount: { type: Number, required: true, min: 1 },
    currency: { type: String, required: true, enum: ["KES"], default: "KES" },
    description: { type: String, default: "", maxlength: 200 },
    phone: { type: String, default: "" },
    status: {
      type: String,
      enum: ["pending", "processing", "succeeded", "failed"],
      default: "pending",
      required: true,
    },
    providerCheckoutRequestId: { type: String, default: "", index: true },
    providerMerchantRequestId: { type: String, default: "" },
    receiptNumber: { type: String, default: "" },
    resultDescription: { type: String, default: "", maxlength: 200 },
  },
  { timestamps: true },
);

module.exports = mongoose.model("Payment", paymentSchema);
