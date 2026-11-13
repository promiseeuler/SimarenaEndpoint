import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { buildApp } from '../src/app.js';
import { SimulatorClient } from '../src/runner/simulator-client.js';

const apps: Array<Awaited<ReturnType<typeof buildApp>>> = [];
afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe('SimulatorClient', () => {
  it('correlates a brain action with the observation step', async () => {
    const app = await buildApp();
    apps.push(app);
    const address = await app.listen({ host: '127.0.0.1', port: 0 });
    const created = await app.inject({ method: 'POST', url: '/v1/sessions', payload: {} });
    const { id } = created.json();
    const wsBase = address.replace('http', 'ws');
    const brain = new WebSocket(`${wsBase}/v1/sessions/${id}/connect?role=brain`);
    await new Promise<void>((resolve, reject) => { brain.once('open', resolve); brain.once('error', reject); });

    brain.on('message', (raw) => {
      const message = JSON.parse(raw.toString());
      if (message.type !== 'observation') return;
      brain.send(JSON.stringify({
        type: 'action', protocolVersion: '1.0', episodeId: message.episodeId, stepId: message.stepId,
        timestamp: new Date().toISOString(), action: { jointPositions: [0.25] },
      }));
    });

    const simulator = new SimulatorClient({
      url: `${wsBase}/v1/sessions/${id}/connect?role=simulator`,
      actionTimeoutMs: 1000,
    });
    await simulator.connect();
    const action = await simulator.observe({ episodeId: 'episode-1', stepId: 3, observation: { jointPositions: [0] } });
    expect(action).toMatchObject({ episodeId: 'episode-1', stepId: 3, action: { jointPositions: [0.25] } });
    simulator.close();
    brain.close();
  });
});
