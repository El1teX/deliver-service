import bcrypt from 'bcryptjs';
import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import type { Role, User } from '@prisma/client';
import { config } from './config';
import { prisma } from './db';
import { httpError } from './lib/http';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user: User;
    }
  }
}

export type TokenPayload = { sub: string; role: Role };

export const hashPassword = (password: string) => bcrypt.hash(password, 10);
export const checkPassword = (password: string, hash: string) => bcrypt.compare(password, hash);

export const signToken = (user: Pick<User, 'id' | 'role'>) =>
  jwt.sign({ sub: user.id, role: user.role } satisfies TokenPayload, config.jwtSecret, { expiresIn: '30d' });

export function verifyToken(token: unknown): TokenPayload | null {
  if (typeof token !== 'string' || !token) return null;
  try {
    return jwt.verify(token, config.jwtSecret) as TokenPayload;
  } catch {
    return null;
  }
}

export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const header = req.header('authorization') ?? '';
    const payload = verifyToken(header.startsWith('Bearer ') ? header.slice(7) : null);
    const user = payload && (await prisma.user.findUnique({ where: { id: payload.sub } }));
    if (!user) throw httpError(401, 'Нужно войти');
    req.user = user;
    next();
  } catch (e) {
    next(e);
  }
};

export const requireRole =
  (role: Role): RequestHandler =>
  (req, _res, next) =>
    next(req.user.role === role ? undefined : httpError(403, 'Недоступно для вашей роли'));
