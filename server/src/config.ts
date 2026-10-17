import 'dotenv/config';

// --port из командной строки важнее переменной PORT (её могут выставить чужие dev-инструменты).
const argPort = process.argv.indexOf('--port');

if (!process.env.JWT_SECRET && process.env.NODE_ENV !== 'test') {
  console.warn('⚠️  JWT_SECRET не задан — используется небезопасный секрет для разработки.');
}

export const config = {
  port: Number(argPort > 0 ? process.argv[argPort + 1] : (process.env.PORT ?? 3001)),
  jwtSecret: process.env.JWT_SECRET ?? 'dev-only-secret-change-me',
  osrmUrl: process.env.OSRM_URL ?? 'https://router.project-osrm.org',
  // 'line' — прямые линии без сетевых запросов (используется в тестах).
  routing: process.env.ROUTING ?? 'osrm',
};
