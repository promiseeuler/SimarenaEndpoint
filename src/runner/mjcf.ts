import type { SimArenaEntity, SimArenaScene } from './scene.js';

export interface CompileResult {
  xml: string;
  warnings: string[];
}

const escapeXml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&apos;');

const numbers = (values: number[] | undefined, fallback: number[]) => (values ?? fallback).join(' ');

const rgba = (hex: string | undefined): string | undefined => {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return undefined;
  const values = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  return `${values.map((value) => value.toFixed(4)).join(' ')} 1`;
};

const isDynamic = (entity: SimArenaEntity) => entity.physics?.dynamic === true || entity.physics?.motion === 'dynamic';

export function compileSceneToMjcf(scene: SimArenaScene): CompileResult {
  const warnings: string[] = [];
  const bodies: string[] = [];

  for (const entity of scene.entities) {
    if (!entity.geoms?.length) continue;
    const geoms: string[] = [];
    for (const [index, geom] of entity.geoms.entries()) {
      if (geom.type === 'mesh') {
        warnings.push(`${entity.name}.geoms[${index}]: mesh assets require the native SimArena MJCF export and were skipped`);
        continue;
      }
      const attrs = [`name="${escapeXml(`${entity.name}_geom_${index}`)}"`, `type="${geom.type}"`];
      if (geom.size) attrs.push(`size="${numbers(geom.size, [])}"`);
      const color = rgba(geom.color);
      if (color) attrs.push(`rgba="${color}"`);
      attrs.push(`contype="1"`, `conaffinity="1"`);
      geoms.push(`      <geom ${attrs.join(' ')} />`);
    }
    if (!geoms.length) continue;

    const transform = entity.transform;
    const bodyAttrs = [`name="${escapeXml(entity.name)}"`, `pos="${numbers(transform.pos, [0, 0, 0])}"`];
    if (transform.quat) bodyAttrs.push(`quat="${numbers(transform.quat, [])}"`);
    else if (transform.rot) bodyAttrs.push(`euler="${numbers(transform.rot, [])}"`);
    const joint = isDynamic(entity) ? '      <freejoint />\n' : '';
    bodies.push(`    <body ${bodyAttrs.join(' ')}>\n${joint}${geoms.join('\n')}\n    </body>`);
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<mujoco model="${escapeXml(scene.name)}">
  <compiler angle="degree" coordinate="local" />
  <option timestep="0.002" gravity="0 0 -9.81" />
  <visual><global offwidth="1280" offheight="720" /></visual>
  <worldbody>
${bodies.join('\n')}
  </worldbody>
</mujoco>
`;
  return { xml, warnings };
}
