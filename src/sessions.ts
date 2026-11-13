import { randomUUID } from 'node:crypto';
import type WebSocket from 'ws';
import type { Role } from './protocol.js';

export type SessionStatus = 'waiting' | 'connected' | 'closed';

export interface Session {
  id: string;
  name?: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  expiresAt: string;
  closedAt?: string;
  peers: Partial<Record<Role, WebSocket>>;
}

export class SessionStore {
  private readonly sessions = new Map<string, Session>();

  constructor(private readonly ttlSeconds: number) {}

  create(input: { name?: string; metadata?: Record<string, unknown>; ttlSeconds?: number }): Session {
    const now = Date.now();
    const ttl = Math.min(input.ttlSeconds ?? this.ttlSeconds, 86_400);
    const session: Session = {
      id: randomUUID(),
      name: input.name,
      metadata: input.metadata ?? {},
      createdAt: new Date(now).toISOString(),
      expiresAt: new Date(now + ttl * 1000).toISOString(),
      peers: {},
    };
    this.sessions.set(session.id, session);
    return session;
  }

  get(id: string): Session | undefined {
    const session = this.sessions.get(id);
    if (!session || session.closedAt) return session;
    if (Date.parse(session.expiresAt) <= Date.now()) this.close(id, 4001, 'Session expired');
    return session;
  }

  status(session: Session): SessionStatus {
    if (session.closedAt) return 'closed';
    return session.peers.brain && session.peers.simulator ? 'connected' : 'waiting';
  }

  close(id: string, code = 1000, reason = 'Session closed'): boolean {
    const session = this.sessions.get(id);
    if (!session || session.closedAt) return false;
    session.closedAt = new Date().toISOString();
    for (const peer of Object.values(session.peers)) peer?.close(code, reason);
    session.peers = {};
    return true;
  }

  view(session: Session) {
    return {
      id: session.id,
      name: session.name,
      metadata: session.metadata,
      status: this.status(session),
      createdAt: session.createdAt,
      expiresAt: session.expiresAt,
      closedAt: session.closedAt,
      connections: { brain: Boolean(session.peers.brain), simulator: Boolean(session.peers.simulator) },
    };
  }
}
