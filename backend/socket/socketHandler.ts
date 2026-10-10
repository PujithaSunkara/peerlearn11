import { Server as HttpServer } from 'node:http';
import { Server, Socket } from 'socket.io';
import jwt from 'jsonwebtoken';
import { ChatMessage } from '../models/ChatMessage.js';
import { LearningSession } from '../models/LearningSession.js';
import { User } from '../models/User.js';

const JWT_SECRET = process.env.JWT_SECRET || 'peerconnect_ai_default_jwt_secret_2026';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  userName?: string;
}

let ioInstance: Server | null = null;

export function getSocketIo(): Server | null {
  return ioInstance;
}

// Track active video call participants per session room so joining peers immediately know who is already in the video call
const videoRoomParticipants = new Map<string, Set<string>>();

export function initializeSocketServer(httpServer: HttpServer): Server {
  const io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });
  ioInstance = io;

  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      if (!token) {
        return next(new Error('Authentication error'));
      }
      const decoded = jwt.verify(token, JWT_SECRET) as { id: string };
      const user = await User.findById(decoded.id).select('name');
      if (!user) {
        return next(new Error('User not found'));
      }
      socket.userId = user._id.toString();
      socket.userName = user.name;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: AuthenticatedSocket) => {
    if (socket.userId) {
      socket.join(`user:${socket.userId}`);
    }

    socket.on('session:join', async ({ sessionId }: { sessionId: string }) => {
      if (!sessionId) return;
      const cleanSessionId = String(sessionId);
      socket.join(`session:${cleanSessionId}`);
      io.to(`session:${cleanSessionId}`).emit('session:presence', {
        userId: socket.userId,
        userName: socket.userName,
        status: 'online',
      });

      // Notify joining socket if the connected peer is already waiting in the 1-on-1 video call
      const activeVideoUsers = videoRoomParticipants.get(cleanSessionId);
      if (activeVideoUsers && activeVideoUsers.size > 0) {
        const otherPeersInVideo = Array.from(activeVideoUsers).filter(
          (id) => id !== socket.userId
        );
        if (otherPeersInVideo.length > 0) {
          socket.emit('webrtc:peer-in-call', {
            sessionId: cleanSessionId,
            peerUserIds: otherPeersInVideo,
          });
        }
      }
    });

    socket.on(
      'chat:send',
      async (payload: {
        sessionId: string;
        content: string;
        messageType?: 'text' | 'code';
        codeLanguage?: string;
      }) => {
        try {
          const { sessionId, content, messageType, codeLanguage } = payload;
          if (!sessionId || !content || !content.trim() || !socket.userId) return;

          const cleanSessionId = String(sessionId);
          const session = await LearningSession.findById(cleanSessionId);
          if (!session) return;

          const savedMsg = await ChatMessage.create({
            session: session._id,
            sender: socket.userId,
            senderName: socket.userName || 'Peer Student',
            messageType: messageType === 'code' ? 'code' : 'text',
            content: content.trim(),
            codeLanguage: codeLanguage || 'javascript',
          });

          const plainMsg = savedMsg.toObject();
          // Broadcast to the session room AND both participants' user rooms so neither peer ever misses a message
          io.to(`session:${cleanSessionId}`)
            .to(`user:${session.learner.toString()}`)
            .to(`user:${session.mentor.toString()}`)
            .emit('chat:message', plainMsg);
        } catch (err) {
          console.error('[Socket chat:send error]:', (err as Error).message);
        }
      }
    );

    socket.on(
      'notes:update',
      async (payload: { sessionId: string; sharedNotes: string }) => {
        try {
          const { sessionId, sharedNotes } = payload;
          if (!sessionId || typeof sharedNotes !== 'string') return;
          const cleanSessionId = String(sessionId);
          await LearningSession.findByIdAndUpdate(cleanSessionId, { sharedNotes });
          socket.to(`session:${cleanSessionId}`).emit('notes:synced', {
            sessionId: cleanSessionId,
            sharedNotes,
            updatedBy: socket.userName,
          });
        } catch (err) {
          console.error('[Socket notes:update error]:', (err as Error).message);
        }
      }
    );

    // WebRTC 1-on-1 Video Call Signaling Events (Invite, Ready, Offer, Answer, ICE Candidate, Call Hangup)
    socket.on('webrtc:ready', ({ sessionId }: { sessionId: string }) => {
      if (!sessionId || !socket.userId) return;
      const cleanSessionId = String(sessionId);
      socket.join(`session:${cleanSessionId}`);

      if (!videoRoomParticipants.has(cleanSessionId)) {
        videoRoomParticipants.set(cleanSessionId, new Set());
      }
      const roomSet = videoRoomParticipants.get(cleanSessionId)!;
      roomSet.add(socket.userId);

      // Tell the other peer in the session that this user is ready in the video call
      socket.to(`session:${cleanSessionId}`).emit('webrtc:peer-ready', {
        sessionId: cleanSessionId,
        userId: socket.userId,
        userName: socket.userName,
      });

      // Also broadcast incoming video call notification to the session room
      socket.to(`session:${cleanSessionId}`).emit('webrtc:incoming-call', {
        sessionId: cleanSessionId,
        callerId: socket.userId,
        callerName: socket.userName,
      });
    });

    socket.on(
      'webrtc:offer',
      (payload: { sessionId: string; offer: RTCSessionDescriptionInit }) => {
        if (!payload?.sessionId) return;
        const cleanSessionId = String(payload.sessionId);
        socket.to(`session:${cleanSessionId}`).emit('webrtc:offer', {
          sessionId: cleanSessionId,
          offer: payload.offer,
          fromUser: socket.userName,
          fromUserId: socket.userId,
        });
      }
    );

    socket.on(
      'webrtc:answer',
      (payload: { sessionId: string; answer: RTCSessionDescriptionInit }) => {
        if (!payload?.sessionId) return;
        const cleanSessionId = String(payload.sessionId);
        socket.to(`session:${cleanSessionId}`).emit('webrtc:answer', {
          sessionId: cleanSessionId,
          answer: payload.answer,
          fromUser: socket.userName,
          fromUserId: socket.userId,
        });
      }
    );

    socket.on(
      'webrtc:ice-candidate',
      (payload: { sessionId: string; candidate: RTCIceCandidateInit }) => {
        if (!payload?.sessionId || !payload?.candidate) return;
        const cleanSessionId = String(payload.sessionId);
        socket.to(`session:${cleanSessionId}`).emit('webrtc:ice-candidate', {
          sessionId: cleanSessionId,
          candidate: payload.candidate,
          fromUserId: socket.userId,
        });
      }
    );

    socket.on('webrtc:leave', ({ sessionId }: { sessionId: string }) => {
      if (!sessionId) return;
      const cleanSessionId = String(sessionId);
      if (socket.userId && videoRoomParticipants.has(cleanSessionId)) {
        videoRoomParticipants.get(cleanSessionId)!.delete(socket.userId);
      }
      socket.to(`session:${cleanSessionId}`).emit('webrtc:peer-left', {
        sessionId: cleanSessionId,
        userId: socket.userId,
        userName: socket.userName,
      });
    });

    socket.on('disconnect', () => {
      if (socket.userId) {
        for (const [sessId, participants] of videoRoomParticipants.entries()) {
          if (participants.has(socket.userId)) {
            participants.delete(socket.userId);
            socket.to(`session:${sessId}`).emit('webrtc:peer-left', {
              sessionId: sessId,
              userId: socket.userId,
              userName: socket.userName,
            });
          }
        }
      }
    });
  });

  return io;
}
