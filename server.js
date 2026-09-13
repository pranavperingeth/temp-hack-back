
const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const authRoutes = require("./routes/auth");
const devRoutes = require("./routes/dev");
const paymentRoutes = require("./routes/payments");
const webhookRoutes = require("./routes/webhooks");
const { authenticate } = require("./middleware/auth");
const prisma = require("./services/prisma");

const app = express();
const PORT = process.env.PORT || 8080;

app.use(
  cors({
    origin: "http://localhost:3000",
    credentials: true,
  })
);

// Webhook route must come BEFORE express.json() so we get the raw body
// for Razorpay signature verification
app.use("/api/webhooks", express.raw({ type: "application/json" }), webhookRoutes);

app.use(express.json());

app.use("/api/auth", authRoutes);
app.use("/api/auth", devRoutes);
app.use("/api/payments", paymentRoutes);

app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Server is running!" });
});

app.get("/test", (req, res) => {
  res.sendFile(path.join(__dirname, "test.html"));
});

app.get("/test-payment", (req, res) => {
  res.sendFile(path.join(__dirname, "test-payment.html"));
});

app.get("/api/profile", authenticate, (req, res) => {
  res.json({
    message: "You are authenticated! Here is your profile.",
    user: req.user,
  });
});

const server = app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/api/health`);
});

const shutdown = async (signal) => {
  console.log(`\n${signal} received. Shutting down...`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
};

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

module.exports = app;
