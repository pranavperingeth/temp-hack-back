const express = require("express");
const jwt = require("jsonwebtoken");

const router = express.Router();

// DEV-ONLY: Generate a fake JWT for testing without Google auth
// REMOVE THIS before production
router.post("/dev-token", (req, res) => {
  if (process.env.NODE_ENV === "production") {
    return res.status(403).json({ error: "Not available in production" });
  }

  const { email, name } = req.body;

  if (!email || !name) {
    return res.status(400).json({ error: "email and name are required" });
  }

  const token = jwt.sign(
    { googleId: "dev_" + Date.now(), email, name },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.json({ token, user: { email, name } });
});

module.exports = router;
