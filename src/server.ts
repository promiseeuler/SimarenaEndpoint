import { buildApp } from './app.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '0.0.0.0';
const apiKeys = (process.env.SIMARENA_API_KEYS ?? '').split(',').map((key) => key.trim()).filter(Boolean);

const app = await buildApp({
  logger: true,
  apiKeys,
  sessionTtlSeconds: Number(process.env.SESSION_TTL_SECONDS ?? 3600),
  maxMessageBytes: Number(process.env.MAX_MESSAGE_BYTES ?? 1_048_576),
});

await app.listen({ port, host });
