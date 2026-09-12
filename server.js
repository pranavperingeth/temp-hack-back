

const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

const authRoutes = require("./routes/auth");
const { authenticate } = require("./middleware/auth");

const app = express();
const PORT = process.env.PORT || 5000;


app.use(
  cors({
    origin: "http://localhost:3000", 
    credentials: true, 
  })
);


app.use(express.json());


app.use("/api/auth", authRoutes);


app.get("/api/health", (req, res) => {
  res.json({ status: "ok", message: "Server is running!" });
});

app.get("/test", (req, res) => {
  res.sendFile(path.join(__dirname, "test.html"));
});


app.get("/api/profile", authenticate, (req, res) => {

  res.json({
    message: "You are authenticated! Here is your profile.",
    user: req.user,
  });
});


app.listen(PORT, () => {
  console.log(`🚀 Server is running on http://localhost:${PORT}`);
  console.log(`   Health check: http://localhost:${PORT}/api/health`);
});
