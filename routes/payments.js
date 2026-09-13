const express = require("express");
const { createRazorpayOrder, verifyPayment } = require("../controllers/paymentController");
const { authenticate } = require("../middleware/auth");

const router = express.Router();

router.post("/create-order", authenticate, createRazorpayOrder);
router.post("/verify", authenticate, verifyPayment);

module.exports = router;
