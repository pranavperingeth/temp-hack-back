const prisma = require("../services/prisma");
const { createOrder, verifyPaymentSignature } = require("../services/razorpay");

async function createRazorpayOrder(req, res) {
  try {
    const { amountPaise, currency, receipt } = req.body;

    if (!amountPaise || typeof amountPaise !== "number" || amountPaise < 1000 || amountPaise > 10000000) {
      return res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "amountPaise must be a number between 1000 and 10000000" },
      });
    }

    const order = await createOrder(amountPaise, currency || "INR", receipt);

    const payment = await prisma.payment.create({
      data: {
        razorpayOrderId: order.id,
        amountPaise,
        currency: order.currency,
        status: "CREATED",
      },
    });

    res.status(201).json({
      orderId: order.id,
      amount: payment.amountPaise,
      currency: payment.currency,
      keyId: process.env.RAZORPAY_KEY_ID,
    });
  } catch (err) {
    console.error("Create order error:", err);
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to create order" },
    });
  }
}

async function verifyPayment(req, res) {
  try {
    const { razorpayOrderId, razorpayPaymentId, razorpaySignature } = req.body;

    if (!razorpayOrderId || !razorpayPaymentId || !razorpaySignature) {
      return res.status(400).json({
        error: { code: "VALIDATION_ERROR", message: "razorpayOrderId, razorpayPaymentId, and razorpaySignature are required" },
      });
    }

    const payment = await prisma.payment.findUnique({
      where: { razorpayOrderId },
    });

    if (!payment) {
      return res.status(404).json({
        error: { code: "PAYMENT_NOT_FOUND", message: "No payment found for this order ID" },
      });
    }

    const isValid = verifyPaymentSignature(razorpayOrderId, razorpayPaymentId, razorpaySignature);

    if (!isValid) {
      return res.status(400).json({
        error: { code: "PAYMENT_VERIFICATION_FAILED", message: "Invalid payment signature" },
      });
    }

    const updated = await prisma.payment.update({
      where: { razorpayOrderId },
      data: {
        razorpayPaymentId,
        status: "CAPTURED",
        signatureVerified: true,
        rawPayload: req.body,
      },
    });

    res.json({
      status: "CAPTURED",
      paymentId: updated.razorpayPaymentId,
      orderId: updated.razorpayOrderId,
      amountPaise: updated.amountPaise,
      currency: updated.currency,
    });
  } catch (err) {
    console.error("Verify payment error:", err);
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Payment verification failed" },
    });
  }
}

module.exports = { createRazorpayOrder, verifyPayment };
