import { Router } from 'express';
import { z } from 'zod';
import { checkPassword, hashPassword, signToken } from '../auth';
import { isUniqueViolation, prisma } from '../db';
import { httpError, parse, wrap } from '../lib/http';
import { grantPoints, WELCOME_POINTS } from './points';
import { buildMe } from './users';

const email = z.string().trim().toLowerCase().email('Некорректный email');

const registerSchema = z.object({
  email,
  password: z.string().min(6, 'Пароль — минимум 6 символов').max(100),
  name: z.string().trim().min(1, 'Введите имя').max(40),
  role: z.enum(['customer', 'courier'], { message: 'Выберите роль' }),
});

const loginSchema = z.object({ email, password: z.string().min(1, 'Введите пароль') });

export const authRouter = Router();

authRouter.post('/auth/register', wrap(async (req, res) => {
  const data = parse(registerSchema, req.body);
  try {
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: { email: data.email, name: data.name, role: data.role, passwordHash: await hashPassword(data.password) },
      });
      await grantPoints(tx, { userId: created.id, amount: WELCOME_POINTS[data.role], kind: 'welcome', reason: 'Приветственные баллы' });
      return created;
    });
    res.status(201).json({ token: signToken(user), user: await buildMe(user.id) });
  } catch (e) {
    if (isUniqueViolation(e)) throw httpError(409, 'Пользователь с таким email уже есть');
    throw e;
  }
}));

authRouter.post('/auth/login', wrap(async (req, res) => {
  const { email, password } = parse(loginSchema, req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  // Одинаковый ответ для «нет пользователя» и «неверный пароль» — не раскрываем, какие email зарегистрированы.
  if (!user || !(await checkPassword(password, user.passwordHash))) throw httpError(401, 'Неверный email или пароль');
  res.json({ token: signToken(user), user: await buildMe(user.id) });
}));
