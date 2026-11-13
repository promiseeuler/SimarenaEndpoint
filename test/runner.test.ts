import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { compileSceneToMjcf } from '../src/runner/mjcf.js';
import { inspectScene, loadScene, simArenaSceneSchema } from '../src/runner/scene.js';

const fixture = fileURLToPath(new URL('./fixtures/basic.scene.json', import.meta.url));

describe('SimArena scene importer', () => {
  it('loads and summarizes a real scene@1.0-shaped export', async () => {
    const scene = await loadScene(fixture);
    expect(inspectScene(scene)).toEqual({
      format: 'simarena/scene@1.0',
      name: 'basic',
      entityCount: 2,
      geometryCount: 2,
      dynamicEntityCount: 1,
      lightCount: 0,
      sensorEntityCount: 0,
      robotEntityCount: 0,
    });
  });

  it('rejects unsupported format versions', () => {
    expect(simArenaSceneSchema.safeParse({ _format: 'simarena/scene@2.0', name: 'future', entities: [] }).success).toBe(false);
  });
});

describe('MJCF compiler', () => {
  it('converts primitive entities and dynamic bodies', async () => {
    const { xml, warnings } = compileSceneToMjcf(await loadScene(fixture));
    expect(warnings).toEqual([]);
    expect(xml).toContain('<mujoco model="basic">');
    expect(xml).toContain('<geom name="floor_geom_0" type="plane" size="10 10"');
    expect(xml).toContain('<body name="cube" pos="0 0 0.1">');
    expect(xml).toContain('<freejoint />');
  });
});
