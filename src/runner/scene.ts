import { readFile } from 'node:fs/promises';
import { z } from 'zod';

const finiteVector = (length: number) => z.array(z.number().finite()).length(length);

const transformSchema = z.object({
  pos: finiteVector(3).default([0, 0, 0]),
  rot: finiteVector(3).optional(),
  quat: finiteVector(4).optional(),
  scale: finiteVector(3).optional(),
}).passthrough();

const geomSchema = z.object({
  type: z.enum(['plane', 'box', 'sphere', 'cylinder', 'capsule', 'mesh']),
  size: z.array(z.number().finite().positive()).optional(),
  color: z.string().optional(),
  group: z.string().optional(),
  mesh: z.string().optional(),
}).passthrough();

const entitySchema = z.object({
  name: z.string().min(1),
  transform: transformSchema.default({ pos: [0, 0, 0] }),
  geoms: z.array(geomSchema).optional(),
  physics: z.object({
    dynamic: z.boolean().optional(),
    type: z.string().optional(),
    motion: z.string().optional(),
    mass: z.number().finite().positive().optional(),
  }).passthrough().optional(),
  light: z.record(z.string(), z.unknown()).optional(),
  sensor: z.unknown().optional(),
  sensors: z.unknown().optional(),
  robot: z.unknown().optional(),
}).passthrough();

export const simArenaSceneSchema = z.object({
  _format: z.literal('simarena/scene@1.0'),
  name: z.string().min(1),
  entities: z.array(entitySchema),
}).passthrough();

export type SimArenaScene = z.infer<typeof simArenaSceneSchema>;
export type SimArenaEntity = SimArenaScene['entities'][number];

export async function loadScene(path: string): Promise<SimArenaScene> {
  let input: unknown;
  try {
    input = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new Error(`Could not read SimArena scene ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }

  const parsed = simArenaSceneSchema.safeParse(input);
  if (!parsed.success) {
    const details = parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ');
    throw new Error(`Invalid SimArena scene: ${details}`);
  }
  return parsed.data;
}

export function inspectScene(scene: SimArenaScene) {
  return {
    format: scene._format,
    name: scene.name,
    entityCount: scene.entities.length,
    geometryCount: scene.entities.reduce((total, entity) => total + (entity.geoms?.length ?? 0), 0),
    dynamicEntityCount: scene.entities.filter((entity) => entity.physics?.dynamic === true || entity.physics?.motion === 'dynamic').length,
    lightCount: scene.entities.filter((entity) => entity.light).length,
    sensorEntityCount: scene.entities.filter((entity) => entity.sensor || entity.sensors).length,
    robotEntityCount: scene.entities.filter((entity) => entity.robot).length,
  };
}
