import { Server, Socket } from "socket.io";
import { addUserToRoom, removeUserFromRoom } from "./utils/roomManager";
import { logger } from "./utils/logger";

export const registerSocketHandlers = (io: Server) => {
  io.on("connection", (socket: Socket) => {
    logger.info("User Connected :", socket.id);
    
    // Join room
    socket.on("join-room", (roomId: string, userId: string) => {
      socket.join(roomId);
      const otherUser = addUserToRoom(roomId, socket.id);
      socket.emit("all-users", otherUser);
      socket.to(roomId).emit("user-joined", socket.id);
    });
    
    // WebRTC signaling events
    socket.on("offer", (payload) => {
      io.to(payload.target).emit("offer", {
        ...payload,
        caller: socket.id
      });
      logger.info(`Offer sent from ${socket.id} to ${payload.target}`);
    });
    
    socket.on("answer", (payload) => {
      io.to(payload.target).emit("answer", {
        ...payload,
        caller: socket.id
      });
      logger.info(`Answer sent from ${socket.id} to ${payload.target}`);
    });
    
    socket.on("ice-candidate", (incoming) => {
      io.to(incoming.target).emit("ice-candidate", {
        ...incoming,
        caller: socket.id
      });
      logger.info(`ICE candidate sent from ${socket.id} to ${incoming.target}`);
    });
    
    // Screen sharing events
    socket.on("screen-sharing-started", (data) => {
      socket.to(data.roomId).emit("screen-sharing-started", {
        userId: socket.id,
        ...data
      });
      logger.info(`User ${socket.id} started screen sharing in room ${data.roomId}`);
    });
    
    socket.on("screen-sharing-stopped", (data) => {
      socket.to(data.roomId).emit("screen-sharing-stopped", {
        userId: socket.id,
        ...data
      });
      logger.info(`User ${socket.id} stopped screen sharing in room ${data.roomId}`);
    });
    
    socket.on("disconnect", () => {
      removeUserFromRoom(socket.id);
      socket.broadcast.emit("user-left", socket.id);
      logger.info(`User Disconnected ${socket.id}`);
    });
  });
};