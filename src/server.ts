// src/server.ts
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import { registerSocketHandlers } from "./socketHandlers";
import { initializeDatabase } from "./config/database";
import authRoutes from "./routes/auth";
import meetingRoutes from "./routes/meeting";
import { generalLimiter } from "./middleware/rateLimiter";

dotenv.config();

const app = express();
const server = createServer(app);

// Middleware
app.use(express.json());
app.use(
  cors({
    origin: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ],
    credentials: true,
  })
);
app.use(generalLimiter);

// Configure Socket.IO with CORS
const io = new Server(server, {
  cors: {
    origin: [
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:3000",
      "http://127.0.0.1:3000",
    ],
    methods: ["GET", "POST"],
    credentials: true,
  },
  transports: ["websocket", "polling"],
});

// Routes
app.use("/api/auth", authRoutes);
app.use("/api/meeting", meetingRoutes);

// Health check
app.get("/", (req, res) => {
  res.json({ message: "WebRTC Signaling Server is running!" });
});

app.get("/health", (req, res) => {
  res.json({
    status: "OK",
    timestamp: new Date().toISOString(),
    connectedClients: io.sockets.sockets.size,
  });
});

// Initialize database and start server
const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await initializeDatabase();
    registerSocketHandlers(io);

    server.listen(PORT, () => {
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📡 Socket.IO server ready for connections`);
      console.log(`🗄️  Database connected and initialized`);
    });
  } catch (error) {
    console.error("❌ Failed to start server:", error);
    process.exit(1);
  }
};

startServer();

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down server...");
  server.close(() => {
    console.log("✅ Server closed");
    process.exit(0);
  });
});

export { io, app, server };