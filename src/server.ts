// import express from "express";
// import {createServer} from "http";
// import {Server} from "socket.io";
// import cors from "cors";
// import dotenv from "dotenv";
// import {registerSocketHandlers} from "./socketHandlers";

// dotenv.config();

// const app = express();
// app.use(cors());

// app.get('/', (req, res) => {
//     res.send('BACKEND is running 🚀');
// });

// const server = createServer(app);
// const io = new Server(server, {
//     cors:{origin:"*"}
// });

// registerSocketHandlers(io);

// const PORT = process.env.PORT || 5000;
// server.listen(PORT, () =>{
//     console.log(`Server Running on port ${PORT}`);
// });



// server.ts
import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { registerSocketHandlers } from "./socketHandlers";

const app = express();
const server = createServer(app);

// Configure CORS for Express
app.use(cors({
  origin: ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000", "http://127.0.0.1:3000"], // Vite dev server (5173) + Create React App (3000)
  credentials: true
}));

// Configure Socket.IO with CORS
const io = new Server(server, {
  cors: {
    origin: ["http://localhost:5173", "http://127.0.0.1:5173", "http://localhost:3000", "http://127.0.0.1:3000"],
    methods: ["GET", "POST"],
    credentials: true
  },
  transports: ['websocket', 'polling']
});

// Register socket event handlers
registerSocketHandlers(io);

// Basic health check endpoint
app.get('/', (req, res) => {
  res.json({ message: 'WebRTC Signaling Server is running!' });
});

app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    connectedClients: io.sockets.sockets.size
  });
});

const PORT = process.env.PORT || 5000;

server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📡 Socket.IO server ready for connections`);
});

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n🛑 Shutting down server...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

export { io, app, server };