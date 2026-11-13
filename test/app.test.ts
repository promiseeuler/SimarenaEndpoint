import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { buildApp } from '../src/app.js';

const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];
const inboxes = new WeakMap<WebSocket, { queue: Array<Record<string, unknown>>; waiters: Array<(message: Record<string, unknown>) => void> }>();

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

const nextMessage = (socket: WebSocket): Promise<Record<string, unknown>> => {
  const inbox = inboxes.get(socket)!;
  const queued = inbox.queue.shift();
  if (queued) return Promise.resolve(queued);
  return new Promise((resolve) => inbox.waiters.push(resolve));
};

const openSocket = (url: string): Promise<WebSocket> =>
  new Promise((resolve, reject) => {
    const socket = new WebSocket(url);
    const inbox = { queue: [] as Array<Record<string, unknown>>, waiters: [] as Array<(message: Record<string, unknown>) => void> };
    inboxes.set(socket, inbox);
    socket.on('message', (data) => {
      const message = JSON.parse(data.toString());
      const waiter = inbox.waiters.shift();
      if (waiter) waiter(message);
      else inbox.queue.push(message);
    });
    socket.once('open', () => resolve(socket));
    socket.once('error', reject);
  });

describe('REST API', () => {
  it('creates and closes a session', async () => {
    const app = await buildApp();
    apps.push(app);

    const created = await app.inject({ method: 'POST', url: '/v1/sessions', payload: { name: 'test' } });
    expect(created.statusCode).toBe(201);
    const session = created.json();
    expect(session.status).toBe('waiting');
    expect(session.connections.brain).toContain(`/v1/sessions/${session.id}/connect?role=brain`);

    const fetched = await app.inject({ method: 'GET', url: `/v1/sessions/${session.id}` });
    expect(fetched.json()).toMatchObject({ id: session.id, name: 'test', status: 'waiting' });

    const closed = await app.inject({ method: 'DELETE', url: `/v1/sessions/${session.id}` });
    expect(closed.statusCode).toBe(204);
  });

  it('enforces configured API keys', async () => {
    const app = await buildApp({ apiKeys: ['secret'] });
    apps.push(app);
    expect((await app.inject({ method: 'POST', url: '/v1/sessions', payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/v1/sessions', headers: { 'x-api-key': 'secret' }, payload: {} })).statusCode).toBe(201);
  });
});

describe('WebSocket bridge', () => {
  it('relays observations and actions to the correct peer', async () => {
    const app = await buildApp();
    apps.push(app);
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const created = await app.inject({ method: 'POST', url: '/v1/sessions', payload: {} });
    const { id } = created.json();
    const wsBase = address.replace('http', 'ws');

    const brain = await openSocket(`${wsBase}/v1/sessions/${id}/connect?role=brain`);
    expect(await nextMessage(brain)).toMatchObject({ type: 'connected', role: 'brain', peerConnected: false });
    const brainPeerStatus = nextMessage(brain);
    const simulator = await openSocket(`${wsBase}/v1/sessions/${id}/connect?role=simulator`);
    expect(await nextMessage(simulator)).toMatchObject({ type: 'connected', role: 'simulator', peerConnected: true });
    expect(await brainPeerStatus).toMatchObject({ type: 'peer_status', role: 'simulator', connected: true });

    const brainObservation = nextMessage(brain);
    simulator.send(JSON.stringify({
      type: 'observation', protocolVersion: '1.0', episodeId: 'ep-1', stepId: 0,
      timestamp: new Date().toISOString(), observation: { jointPositions: [0, 1] },
    }));
    expect(await brainObservation).toMatchObject({ type: 'observation', episodeId: 'ep-1', stepId: 0 });

    const simulatorAction = nextMessage(simulator);
    brain.send(JSON.stringify({
      type: 'action', protocolVersion: '1.0', episodeId: 'ep-1', stepId: 0,
      timestamp: new Date().toISOString(), action: { jointPositions: [0.1, 0.9] },
    }));
    expect(await simulatorAction).toMatchObject({ type: 'action', episodeId: 'ep-1', stepId: 0 });

    brain.close();
    simulator.close();
  });

  it('rejects messages sent in the wrong direction', async () => {
    const app = await buildApp();
    apps.push(app);
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const created = await app.inject({ method: 'POST', url: '/v1/sessions', payload: {} });
    const brain = await openSocket(`${address.replace('http', 'ws')}/v1/sessions/${created.json().id}/connect?role=brain`);
    await nextMessage(brain);
    const errorMessage = nextMessage(brain);
    brain.send(JSON.stringify({
      type: 'observation', protocolVersion: '1.0', episodeId: 'ep-1', stepId: 0,
      timestamp: new Date().toISOString(), observation: {},
    }));
    expect(await errorMessage).toMatchObject({ type: 'error', code: 'INVALID_DIRECTION' });
    brain.close();
  });
});
