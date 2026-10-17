import http from 'node:http';
import { createApp } from './app';
import { config } from './config';
import { prisma } from './db';
import { ensureDemo } from './demo';
import { attachRealtime } from './realtime';

const server = http.createServer(createApp());
attachRealtime(server);

try {
  await prisma.$connect();
  await ensureDemo();
} catch (e) {
  console.error('Не удалось подключиться к PostgreSQL. Проверьте DATABASE_URL в server/.env и что миграции применены (npm run db:deploy).');
  console.error((e as Error).message);
  process.exit(1);
}

server.listen(config.port, () => console.log(`Мигом API: http://localhost:${config.port}`));

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}
