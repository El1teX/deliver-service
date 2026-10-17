import { execSync } from 'node:child_process';
import { PrismaClient } from '@prisma/client';

// Готовит тестовую базу: применяет миграции и очищает таблицы. Основную базу не трогает.
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error('Задайте TEST_DATABASE_URL в server/.env (отдельная база для тестов, например migom_test)');
  const dbName = new URL(url).pathname.slice(1);
  if (url === process.env.DATABASE_URL || !dbName.includes('test')) {
    throw new Error(`TEST_DATABASE_URL должен указывать на отдельную тестовую базу (в имени должно быть «test»), сейчас: ${dbName}`);
  }

  execSync('npx prisma migrate deploy', { env: { ...process.env, DATABASE_URL: url }, stdio: 'inherit' });

  const prisma = new PrismaClient({ datasources: { db: { url } } });
  try {
    const tables = await prisma.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
    if (tables.length) await prisma.$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"${t.tablename}"`).join(', ')} CASCADE`);
  } finally {
    await prisma.$disconnect();
  }
}
