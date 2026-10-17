import type http from 'node:http';
import { Server } from 'socket.io';
import { verifyToken } from './auth';

let io: Server | null = null;

export function attachRealtime(server: http.Server) {
  io = new Server(server, { cors: { origin: '*' } });
  io.use((socket, next) => {
    const payload = verifyToken(socket.handshake.auth?.token);
    if (!payload) return next(new Error('unauthorized'));
    socket.data.user = payload;
    next();
  });
  io.on('connection', (socket) => {
    const { sub, role } = socket.data.user;
    socket.join(`user:${sub}`);
    if (role === 'courier') socket.join('couriers');
  });
}

// В тестах сокет-сервера нет — все рассылки становятся no-op.
export const emitToUser = (userId: string | null | undefined, event: string, payload?: unknown) => {
  if (userId) io?.to(`user:${userId}`).emit(event, payload);
};

export const emitToCouriers = (event: string, payload?: unknown) => io?.to('couriers').emit(event, payload);
