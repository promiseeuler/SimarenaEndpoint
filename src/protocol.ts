import { z } from 'zod';

export const PROTOCOL_VERSION = '1.0' as const;

const id = z.string().min(1).max(128);
const timestamp = z.string().datetime({ offset: true });
const numericArray = z.array(z.number().finite());

export const helloMessage = z.object({
  type: z.literal('hello'),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  client: z.object({
    name: z.string().min(1).max(100),
    version: z.string().min(1).max(50),
  }),
  capabilities: z.array(z.string().min(1).max(100)).default([]),
}).strict();

export const observationMessage = z.object({
  type: z.literal('observation'),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  episodeId: id,
  stepId: z.number().int().nonnegative(),
  timestamp,
  observation: z.object({
    jointPositions: numericArray.optional(),
    jointVelocities: numericArray.optional(),
    endEffectorPose: numericArray.length(7).optional(),
    sensors: z.record(z.string(), z.unknown()).optional(),
    task: z.record(z.string(), z.unknown()).optional(),
  }).passthrough(),
}).strict();

export const actionMessage = z.object({
  type: z.literal('action'),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  episodeId: id,
  stepId: z.number().int().nonnegative(),
  timestamp,
  action: z.object({
    jointPositions: numericArray.optional(),
    jointVelocities: numericArray.optional(),
    jointTorques: numericArray.optional(),
    gripper: z.number().finite().optional(),
  }).passthrough(),
}).strict();

export const resetMessage = z.object({
  type: z.literal('reset'),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  episodeId: id,
  seed: z.number().int().optional(),
  options: z.record(z.string(), z.unknown()).optional(),
}).strict();

export const episodeResultMessage = z.object({
  type: z.literal('episode_result'),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  episodeId: id,
  success: z.boolean(),
  reward: z.number().finite().optional(),
  steps: z.number().int().nonnegative(),
  metrics: z.record(z.string(), z.number().finite()).optional(),
  reason: z.enum(['success', 'failure', 'timeout', 'cancelled']).optional(),
}).strict();

export const heartbeatMessage = z.object({
  type: z.literal('heartbeat'),
  protocolVersion: z.literal(PROTOCOL_VERSION),
  timestamp,
}).strict();

export const clientMessage = z.discriminatedUnion('type', [
  helloMessage,
  observationMessage,
  actionMessage,
  resetMessage,
  episodeResultMessage,
  heartbeatMessage,
]);

export type ClientMessage = z.infer<typeof clientMessage>;
export type Role = 'brain' | 'simulator';

export type ServerMessage =
  | { type: 'connected'; protocolVersion: typeof PROTOCOL_VERSION; sessionId: string; role: Role; peerConnected: boolean }
  | { type: 'peer_status'; protocolVersion: typeof PROTOCOL_VERSION; role: Role; connected: boolean }
  | { type: 'error'; protocolVersion: typeof PROTOCOL_VERSION; code: string; message: string; details?: unknown };

export const messageDestination = (message: ClientMessage): Role | null => {
  if (message.type === 'observation' || message.type === 'episode_result') return 'brain';
  if (message.type === 'action' || message.type === 'reset') return 'simulator';
  return null;
};
