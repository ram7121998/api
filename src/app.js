import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { Server } from "socket.io";
import multer from "multer";
import swaggerUi from "swagger-ui-express";
import fs from "fs";
import http from "http";   // <- Add this
import adminRouter from "./routes/adminRoutes.js";
import usersRouter from "./routes/userRoutes.js";
// import autoCloseDisputes from "./controller/cronJobs/autoCloseDisputes.js";


BigInt.prototype.toJSON = function () {
  return this.toString();
};

dotenv.config();

const app = express();
const server = http.createServer(app);   // <- REAL SERVER
const io = new Server(server, {
  cors: { origin: "*" },                // <- Allow frontend
});

// 🔥 Save IO globally (so you can use it anywhere)
global.io = io;
// index.js ya server.js
// backend/socket.js
io.on("connection", (socket) => {
  console.log("User connected:", socket.id);

  const { userId } = socket.handshake.query;
  if (userId) {
    socket.join(userId); // user-specific room
    console.log("User joined room:", userId);
  }

  socket.on("disconnect", () => {
    console.log("User disconnected:", socket.id);
  });
});



// 🧩 Setup multer to handle multipart/form-data (no files)
const upload = multer();

// Static files
app.use("/storage", express.static(path.join(process.cwd(), "storage", "app", "public")));

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Swagger setup
const swaggerPath = path.resolve("storage/api-docs/api-docs.json");
const swaggerDocument = JSON.parse(fs.readFileSync(swaggerPath, "utf8"));

app.use("/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

app.get("/docs/api-docs.json", (req, res) => {
  if (!fs.existsSync(swaggerPath)) {
    return res.status(404).json({ message: "Swagger JSON not found." });
  }
  res.sendFile(swaggerPath);
});

// Test route
app.get("/", (req, res) => {
  res.send("API is running...");
});

// All your routes
app.use("/api", adminRouter);
app.use("/api", usersRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ status: false, message: "Route not found" });
});

// Error handler
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ status: false, message: "Server error", errors: err.message });
});



const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});

export default app;
