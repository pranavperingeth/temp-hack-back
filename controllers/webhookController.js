const prisma = require("../services/prisma");
const { verifyWebhookSignature } = require("../services/razorpay");

async function handleRazorpayWebhook(req, res) {
  try {
    const signature = req.headers["x-razorpay-signature"];

    if (!signature) {
      return res.status(400).json({ error: "Missing webhook signature" });
    }

    // express.raw() stores Buffer in req.body
    const rawBody = Buffer.isBuffer(req.body)
      ? req.body.toString("utf8")
      : typeof req.body === "string"
        ? req.body
        : JSON.stringify(req.body);

    if (process.env.NODE_ENV === "production") {
      const isValid = verifyWebhookSignature(rawBody, signature);
      if (!isValid) {
        console.error("Webhook signature verification failed");
        return res.status(401).json({ error: "Invalid webhook signature" });
      }
    } else {
      console.warn("Dev mode: skipping webhook signature verification");
    }

    const event = typeof req.body === "object" && !Buffer.isBuffer(req.body)
      ? req.body
      : JSON.parse(rawBody);

    const existing = await prisma.webhookEvent.findUnique({
      where: { eventId: event.event_id },
    });

    if (existing && existing.processed) {
      return res.status(200).json({ status: "already processed" });
    }

    if (!existing) {
      await prisma.webhookEvent.create({
        data: {
          eventId: event.event_id,
          eventType: event.event,
          payload: event,
          processed: false,
        },
      });
    }

    const eventType = event.event;
    const paymentEntity = event.payload?.payment?.entity;

    if (paymentEntity && (eventType === "payment.captured" || eventType === "order.paid")) {
      const orderId = paymentEntity.order_id;
      const paymentId = paymentEntity.id;

      await prisma.payment.update({
        where: { razorpayOrderId: orderId },
        data: {
          razorpayPaymentId: paymentId,
          status: "CAPTURED",
          signatureVerified: true,
          rawPayload: event,
        },
      }).catch(() => {
        console.warn(`Webhook: no payment found for order ${orderId}`);
      });
    }

    if (eventType === "payment.failed" && paymentEntity) {
      await prisma.payment.update({
        where: { razorpayOrderId: paymentEntity.order_id },
        data: {
          status: "FAILED",
          rawPayload: event,
        },
      }).catch(() => {
        console.warn(`Webhook: no payment found for order ${paymentEntity.order_id}`);
      });
    }

    await prisma.webhookEvent.update({
      where: { eventId: event.event_id },
      data: { processed: true, processedAt: new Date() },
    });

    res.status(200).json({ status: "ok" });
  } catch (err) {
    console.error("Webhook processing error:", err);
    res.status(200).json({ status: "error logged" });
  }
}

module.exports = { handleRazorpayWebhook };
