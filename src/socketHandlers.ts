// src/socketHandlers.ts
import { Server, Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { query } from "./config/database";
import { logger } from "./utils/logger";

interface SocketWithAuth extends Socket {
  userId?: number;
  userEmail?: string;
  meetingId?: string;
}

export const registerSocketHandlers = (io: Server) => {
  // Socket authentication middleware
  io.use(async (socket: SocketWithAuth, next) => {
    try {
      const token = socket.handshake.auth.token;

      if (!token) {
        return next(new Error("Authentication token required"));
      }

      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as {
        userId: number;
        email: string;
      };

      const result = await query(
        "SELECT id, email, is_verified FROM users WHERE id = $1",
        [decoded.userId]
      );

      if (result.rows.length === 0 || !result.rows[0].is_verified) {
        return next(new Error("Invalid or unverified user"));
      }

      socket.userId = decoded.userId;
      socket.userEmail = decoded.email;
      next();
    } catch (error) {
      next(new Error("Invalid authentication token"));
    }
  });

  io.on("connection", (socket: SocketWithAuth) => {
    logger.info(`User Connected: ${socket.id} (User ID: ${socket.userId})`);

    // Join room with authorization check
    socket.on("join-room", async (roomId: string) => {
      try {
        // Verify meeting exists and user is authorized
        const meetingResult = await query(
          `SELECT m.*, 
           (SELECT COUNT(*) FROM meeting_participants WHERE meeting_id = m.id AND left_at IS NULL) as current_participants
           FROM meetings m WHERE m.id = $1`,
          [roomId]
        );

        if (meetingResult.rows.length === 0) {
          socket.emit("error", { message: "Meeting not found" });
          return;
        }

        const meeting = meetingResult.rows[0];

        if (meeting.status === "ended") {
          socket.emit("error", { message: "Meeting has ended" });
          return;
        }

        const currentParticipants = parseInt(meeting.current_participants);
        if (currentParticipants >= meeting.max_participants) {
          socket.emit("error", { message: "Meeting is full" });
          return;
        }

        // Check if user is a participant or host
        const participantResult = await query(
          "SELECT * FROM meeting_participants WHERE meeting_id = $1 AND user_id = $2",
          [roomId, socket.userId]
        );

        const isHost = meeting.host_id === socket.userId;

        if (participantResult.rows.length === 0 && !isHost) {
          socket.emit("error", { message: "Not authorized to join this meeting" });
          return;
        }

        // Update socket_id for the participant
        await query(
          `INSERT INTO meeting_participants (meeting_id, user_id, socket_id) 
           VALUES ($1, $2, $3)
           ON CONFLICT (meeting_id, user_id) 
           DO UPDATE SET socket_id = $3, joined_at = NOW(), left_at = NULL`,
          [roomId, socket.userId, socket.id]
        );

        socket.join(roomId);
        socket.meetingId = roomId;

        // Get all users in room
        const participantsResult = await query(
          `SELECT socket_id, user_id FROM meeting_participants 
           WHERE meeting_id = $1 AND left_at IS NULL AND socket_id != $2`,
          [roomId, socket.id]
        );

        const otherUsers = participantsResult.rows.map((p) => p.socket_id);
        
        socket.emit("all-users", otherUsers);
        socket.to(roomId).emit("user-joined", socket.id);

        logger.info(`User ${socket.userId} joined room ${roomId}`);
      } catch (error) {
        logger.error("Join room error:", error);
        socket.emit("error", { message: "Failed to join room" });
      }
    });

    // WebRTC signaling events
    socket.on("offer", (payload) => {
      io.to(payload.target).emit("offer", {
        ...payload,
        caller: socket.id,
      });
      logger.info(`Offer sent from ${socket.id} to ${payload.target}`);
    });

    socket.on("answer", (payload) => {
      io.to(payload.target).emit("answer", {
        ...payload,
        caller: socket.id,
      });
      logger.info(`Answer sent from ${socket.id} to ${payload.target}`);
    });

    socket.on("ice-candidate", (incoming) => {
      io.to(incoming.target).emit("ice-candidate", {
        ...incoming,
        caller: socket.id,
      });
      logger.info(`ICE candidate sent from ${socket.id} to ${incoming.target}`);
    });

    // Screen sharing events
    socket.on("screen-sharing-started", (data) => {
      socket.to(data.roomId).emit("screen-sharing-started", {
        userId: socket.id,
        ...data,
      });
      logger.info(
        `User ${socket.id} started screen sharing in room ${data.roomId}`
      );
    });

    socket.on("screen-sharing-stopped", (data) => {
      socket.to(data.roomId).emit("screen-sharing-stopped", {
        userId: socket.id,
        ...data,
      });
      logger.info(
        `User ${socket.id} stopped screen sharing in room ${data.roomId}`
      );
    });

    // Kick user (host only)
    socket.on("kick-user", async (data: { targetSocketId: string }) => {
      try {
        if (!socket.meetingId) return;

        const meetingResult = await query(
          "SELECT host_id FROM meetings WHERE id = $1",
          [socket.meetingId]
        );

        if (
          meetingResult.rows.length === 0 ||
          meetingResult.rows[0].host_id !== socket.userId
        ) {
          socket.emit("error", { message: "Not authorized to kick users" });
          return;
        }

        io.to(data.targetSocketId).emit("kicked", {
          message: "You have been removed from the meeting",
        });

        const targetSocket = io.sockets.sockets.get(data.targetSocketId);
        if (targetSocket) {
          targetSocket.leave(socket.meetingId);
        }

        logger.info(`User ${data.targetSocketId} kicked by host ${socket.id}`);
      } catch (error) {
        logger.error("Kick user error:", error);
      }
    });

    socket.on("disconnect", async () => {
      try {
        if (socket.meetingId) {
          await query(
            "UPDATE meeting_participants SET left_at = NOW() WHERE socket_id = $1",
            [socket.id]
          );

          socket.to(socket.meetingId).emit("user-left", socket.id);
        }

        logger.info(`User Disconnected ${socket.id}`);
      } catch (error) {
        logger.error("Disconnect error:", error);
      }
    });
  });
};