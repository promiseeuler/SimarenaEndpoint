import WebSocket from 'ws';
import { actionMessage, PROTOCOL_VERSION, resetMessage, type ClientMessage } from '../protocol.js';

export interface SimulatorClientOptions {
  url: string;
  name?: string;
  version?: string;
  capabilities?: string[];
  actionTimeoutMs?: number;
}

export type Action = Extract<ClientMessage, { type: 'action' }>;
export type Reset = Extract<ClientMessage, { type: 'reset' }>;

export class SimulatorClient {
  private socket?: WebSocket;
  private readonly pending = new Map<string, { resolve: (action: Action) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }>();
  private resetHandler?: (message: Reset) => void | Promise<void>;

  constructor(private readonly options: SimulatorClientOptions) {}

  async connect(): Promise<void> {
    if (this.socket) throw new Error('Simulator client is already connected.');
    const socket = new WebSocket(this.options.url);
    this.socket = socket;
    socket.on('message', (raw) => this.handleMessage(raw.toString()));
    socket.on('close', () => this.rejectPending(new Error('Brain connection closed.')));
    socket.on('error', (error) => this.rejectPending(error));

    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    this.send({
      type: 'hello',
      protocolVersion: PROTOCOL_VERSION,
      client: { name: this.options.name ?? 'simarena-companion-runner', version: this.options.version ?? '0.1.0' },
      capabilities: this.options.capabilities ?? ['joint_position'],
    });
  }

  onReset(handler: (message: Reset) => void | Promise<void>) {
    this.resetHandler = handler;
  }

  async observe(input: {
    episodeId: string;
    stepId: number;
    observation: Record<string, unknown>;
  }): Promise<Action> {
    const key = `${input.episodeId}:${input.stepId}`;
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error('Simulator client is not connected.');
    if (this.pending.has(key)) throw new Error(`Observation ${key} is already waiting for an action.`);

    const result = new Promise<Action>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(key);
        reject(new Error(`Action timed out for ${key}.`));
      }, this.options.actionTimeoutMs ?? 5000);
      this.pending.set(key, { resolve, reject, timer });
    });
    this.send({ ...input, type: 'observation', protocolVersion: PROTOCOL_VERSION, timestamp: new Date().toISOString() });
    return result;
  }

  episodeResult(input: Omit<Extract<ClientMessage, { type: 'episode_result' }>, 'type' | 'protocolVersion'>) {
    this.send({ ...input, type: 'episode_result', protocolVersion: PROTOCOL_VERSION });
  }

  close() {
    this.socket?.close(1000, 'Runner stopped');
    this.socket = undefined;
  }

  private send(message: ClientMessage) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) throw new Error('Simulator client is not connected.');
    this.socket.send(JSON.stringify(message));
  }

  private handleMessage(raw: string) {
    let message: unknown;
    try { message = JSON.parse(raw); } catch { return; }
    const action = actionMessage.safeParse(message);
    if (action.success) {
      const key = `${action.data.episodeId}:${action.data.stepId}`;
      const pending = this.pending.get(key);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(key);
      pending.resolve(action.data);
      return;
    }
    const reset = resetMessage.safeParse(message);
    if (reset.success) void this.resetHandler?.(reset.data);
  }

  private rejectPending(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
