// Чат клиента и курьера по заказу. Писать можно, пока заказ в пути; читать историю — всегда.
import type { Message, OrderStatus } from '@prisma/client';
import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../auth';
import { prisma } from '../db';
import { httpError, parse, wrap } from '../lib/http';
import { emitToUser } from '../realtime';

const OPEN: OrderStatus[] = ['accepted', 'picked'];

export const serializeMessage = (m: Message) => ({
  id: m.id,
  orderId: m.orderId,
  fromId: m.fromId,
  text: m.text,
  createdAt: +m.createdAt,
  readAt: m.readAt ? +m.readAt : null,
});

// Заказ, в котором пользователь — клиент или курьер. Посторонним — 404, чтобы не выдавать существование заказа.
async function loadChatOrder(userId: string, orderId: string) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { id: true, status: true, customerId: true, courierId: true } });
  if (!order || (order.customerId !== userId && order.courierId !== userId)) throw httpError(404, 'Заказ не найден');
  return order;
}

const messageSchema = z.object({
  text: z.string({ message: 'Напишите сообщение' }).trim().min(1, 'Напишите сообщение').max(500, 'Сообщение длиннее 500 символов'),
});

export async function sendMessage(fromId: string, orderId: string, input: unknown) {
  const { text } = parse(messageSchema, input);
  const order = await loadChatOrder(fromId, orderId);
  if (!OPEN.includes(order.status)) throw httpError(409, 'Чат доступен, только пока заказ в пути');
  const message = serializeMessage(await prisma.message.create({ data: { orderId, fromId, text } }));
  emitToUser(order.customerId, 'chat:message', message);
  emitToUser(order.courierId, 'chat:message', message);
  return message;
}

export const chatRouter = Router();

chatRouter.get('/orders/:id/messages', requireAuth, wrap(async (req, res) => {
  const order = await loadChatOrder(req.user.id, req.params.id);
  const messages = await prisma.message.findMany({ where: { orderId: order.id }, orderBy: { createdAt: 'asc' } });
  res.json({ canWrite: OPEN.includes(order.status), messages: messages.map(serializeMessage) });
}));

chatRouter.post('/orders/:id/messages', requireAuth, wrap(async (req, res) => {
  res.status(201).json(await sendMessage(req.user.id, req.params.id, req.body));
}));

// Отмечает входящие сообщения прочитанными и сообщает об этом собеседнику.
chatRouter.post('/orders/:id/messages/read', requireAuth, wrap(async (req, res) => {
  const order = await loadChatOrder(req.user.id, req.params.id);
  const { count } = await prisma.message.updateMany({ where: { orderId: order.id, fromId: { not: req.user.id }, readAt: null }, data: { readAt: new Date() } });
  if (count) emitToUser(order.customerId === req.user.id ? order.courierId : order.customerId, 'chat:read', { orderId: order.id });
  res.json({ read: count });
}));
