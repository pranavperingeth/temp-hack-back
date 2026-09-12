


const express = require("express");
const { OAuth2Client } = require("google-auth-library");
const jwt = require("jsonwebtoken");

const router = express.Router();

const googleClient = new OAuth2Client(process.env.GOOGLE_CLIENT_ID);


// In-memory user store (can be replaced with MongoDB / PostgreSQL later)
const users = new Map();

// Helper function to verify Google token
async function verifyGoogleToken(token) {
  const ticket = await googleClient.verifyIdToken({
    idToken: token,
    audience: process.env.GOOGLE_CLIENT_ID,
  });

  const payload = ticket.getPayload();
  if (!payload) {
    throw new Error("Invalid token payload from Google");
  }

  return {
    googleId: payload.sub,
    email: payload.email,
    name: payload.name,
    picture: payload.picture,
    emailVerified: payload.email_verified,
  };
}

// Helper function to generate JWT
function generateToken(user) {
  return jwt.sign(
    {
      googleId: user.googleId,
      email: user.email,
      name: user.name,
    },
    process.env.JWT_SECRET,
    { expiresIn: "20d" }
  );
}

// -------------------------------------------------------------
// 1. Google SIGN UP Route: POST /api/auth/google/signup
// -------------------------------------------------------------
router.post("/google/signup", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: "Google token is required" });
    }

    const googleUser = await verifyGoogleToken(token);

    // Check if user already exists
    if (users.has(googleUser.email)) {
      return res.status(409).json({
        error: "Account already exists",
        message: "An account with this email is already registered. Please sign in instead.",
      });
    }

    // Create and save new user
    const newUser = {
      ...googleUser,
      createdAt: new Date().toISOString(),
    };
    users.set(googleUser.email, newUser);

    console.log(`🎉 New user registered: ${newUser.email}`);

    const ourToken = generateToken(newUser);

    res.status(201).json({
      message: "Account created successfully!",
      isNewUser: true,
      token: ourToken,
      user: newUser,
    });
  } catch (error) {
    console.error("❌ Google signup error:", error.message);
    res.status(401).json({
      error: "Google signup failed",
      details: error.message,
    });
  }
});

// -------------------------------------------------------------
// 2. Google SIGN IN Route: POST /api/auth/google/signin
// -------------------------------------------------------------
router.post("/google/signin", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: "Google token is required" });
    }

    const googleUser = await verifyGoogleToken(token);

    // Check if user exists
    const existingUser = users.get(googleUser.email);
    if (!existingUser) {
      return res.status(404).json({
        error: "User not found",
        message: "No account found with this Google account. Please sign up first.",
      });
    }

    console.log(`✅ User signed in: ${existingUser.email}`);

    const ourToken = generateToken(existingUser);

    res.json({
      message: "Signed in successfully!",
      isNewUser: false,
      token: ourToken,
      user: existingUser,
    });
  } catch (error) {
    console.error("❌ Google signin error:", error.message);
    res.status(401).json({
      error: "Google signin failed",
      details: error.message,
    });
  }
});

// -------------------------------------------------------------
// 3. Fallback Unified Route: POST /api/auth/google
//    (Signs in if exists, creates if new)
// -------------------------------------------------------------
router.post("/google", async (req, res) => {
  try {
    const { token } = req.body;
    if (!token) {
      return res.status(400).json({ error: "Google token is required" });
    }

    const googleUser = await verifyGoogleToken(token);
    let user = users.get(googleUser.email);
    let isNewUser = false;

    if (!user) {
      user = { ...googleUser, createdAt: new Date().toISOString() };
      users.set(googleUser.email, user);
      isNewUser = true;
      console.log(`🎉 User auto-registered: ${user.email}`);
    } else {
      console.log(`✅ User signed in: ${user.email}`);
    }

    const ourToken = generateToken(user);

    res.json({
      message: isNewUser ? "Account created successfully!" : "Signed in successfully!",
      isNewUser,
      token: ourToken,
      user,
    });
  } catch (error) {
    console.error("❌ Google auth error:", error.message);
    res.status(401).json({
      error: "Invalid Google token",
      details: error.message,
    });
  }
});

module.exports = router;
