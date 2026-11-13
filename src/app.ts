import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import websocket from '@fastify/websocket';
import Fastify, { type FastifyRequest } from 'fastify';
import type WebSocket from 'ws';
import { z } from 'zod';
import { clientMessage, messageDestination, PROTOCOL_VERSION, type Role, type ServerMessage } from './protocol.js';
import { SessionStore } from './sessions.js';

export interface AppOptions {
  logger?: boolean;
  apiKeys?: string[];
  sessionTtlSeconds?: number;
  maxMessageBytes?: number;
}

const createSessionBody = z.object({
  name: z.string().min(1).max(100).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
  ttlSeconds: z.number().int().min(30).max(86_400).optional(),
}).strict();

const send = (socket: WebSocket, message: ServerMessage | object) => {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
};

export async function buildApp(options: AppOptions = {}) {
  const app = Fastify({ logger: options.logger ?? false, bodyLimit: options.maxMessageBytes ?? 1_048_576 });
  const keys = new Set((options.apiKeys ?? []).filter(Boolean));
  const sessions = new SessionStore(options.sessionTtlSeconds ?? 3600);

  await app.register(cors, { origin: true });
  await app.register(websocket, { options: { maxPayload: options.maxMessageBytes ?? 1_048_576 } });
  await app.register(swagger, {
    openapi: {
      info: { title: 'SimArena External Brain API', version: PROTOCOL_VERSION, description: 'Connect an external robot policy to a SimArena simulation.' },
      components: { securitySchemes: { apiKey: { type: 'apiKey', in: 'header', name: 'x-api-key' } } },
    },
  });
  await app.register(swaggerUi, { routePrefix: '/docs' });

  const authorized = (request: FastifyRequest): boolean => {
    if (keys.size === 0) return true;
    const header = request.headers['x-api-key'];
    const queryKey = (request.query as { apiKey?: string } | undefined)?.apiKey;
    return (typeof header === 'string' && keys.has(header)) || (typeof queryKey === 'string' && keys.has(queryKey));
  };

  app.addHook('onRequest', async (request, reply) => {
    if (request.url === '/health' || request.url.startsWith('/docs')) return;
    if (!authorized(request)) return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'A valid API key is required.' } });
  });

  app.get('/health', { schema: { tags: ['system'] } }, async () => ({ status: 'ok', protocolVersion: PROTOCOL_VERSION }));

  app.post('/v1/sessions', { schema: { tags: ['sessions'] } }, async (request, reply) => {
    const parsed = createSessionBody.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: { code: 'INVALID_REQUEST', message: 'Invalid session request.', details: parsed.error.issues } });
    const session = sessions.create(parsed.data);
    const base = `${request.protocol === 'https' ? 'wss' : 'ws'}://${request.host}`;
    return reply.code(201).send({
      ...sessions.view(session),
      connections: {
        simulator: `${base}/v1/sessions/${session.id}/connect?role=simulator`,
        brain: `${base}/v1/sessions/${session.id}/connect?role=brain`,
      },
    });
  });

  app.get('/v1/sessions/:id', { schema: { tags: ['sessions'] } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = sessions.get(id);
    if (!session) return reply.code(404).send({ error: { code: 'SESSION_NOT_FOUND', message: 'Session not found.' } });
    return sessions.view(session);
  });

  app.delete('/v1/sessions/:id', { schema: { tags: ['sessions'] } }, async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!sessions.close(id)) return reply.code(404).send({ error: { code: 'SESSION_NOT_FOUND', message: 'Active session not found.' } });
    return reply.code(204).send();
  });

  app.get('/v1/sessions/:id/connect', { websocket: true }, (socket, request) => {
    const { id } = request.params as { id: string };
    const { role } = request.query as { role?: Role };
    const session = sessions.get(id);

    if (!session || session.closedAt) return socket.close(4404, 'Session not found or closed');
    if (role !== 'brain' && role !== 'simulator') return socket.close(4400, 'role must be brain or simulator');
    if (session.peers[role]) return socket.close(4409, `A ${role} is already connected`);

    const peerRole: Role = role === 'brain' ? 'simulator' : 'brain';
    session.peers[role] = socket;
    send(socket, { type: 'connected', protocolVersion: PROTOCOL_VERSION, sessionId: id, role, peerConnected: Boolean(session.peers[peerRole]) });
    if (session.peers[peerRole]) send(session.peers[peerRole]!, { type: 'peer_status', protocolVersion: PROTOCOL_VERSION, role, connected: true });

    socket.on('message', (raw, isBinary) => {
      if (isBinary) return send(socket, { type: 'error', protocolVersion: PROTOCOL_VERSION, code: 'BINARY_NOT_SUPPORTED', message: 'Send UTF-8 JSON messages. Put large sensor data behind a signed URL.' });
      let input: unknown;
      try { input = JSON.parse(raw.toString()); } catch {
        return send(socket, { type: 'error', protocolVersion: PROTOCOL_VERSION, code: 'INVALID_JSON', message: 'Message is not valid JSON.' });
      }
      const parsed = clientMessage.safeParse(input);
      if (!parsed.success) return send(socket, { type: 'error', protocolVersion: PROTOCOL_VERSION, code: 'INVALID_MESSAGE', message: 'Message does not match protocol 1.0.', details: parsed.error.issues });

      const destination = messageDestination(parsed.data);
      if (!destination) return send(socket, parsed.data);
      if (destination === role) return send(socket, { type: 'error', protocolVersion: PROTOCOL_VERSION, code: 'INVALID_DIRECTION', message: `${parsed.data.type} cannot be sent by the ${role} role.` });
      const peer = session.peers[destination];
      if (!peer) return send(socket, { type: 'error', protocolVersion: PROTOCOL_VERSION, code: 'PEER_NOT_CONNECTED', message: `The ${destination} is not connected.` });
      send(peer, parsed.data);
    });

    socket.on('close', () => {
      if (session.peers[role] === socket) delete session.peers[role];
      const peer = session.peers[peerRole];
      if (peer) send(peer, { type: 'peer_status', protocolVersion: PROTOCOL_VERSION, role, connected: false });
    });
  });

  return app;
}
