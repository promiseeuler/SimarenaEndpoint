#!/usr/bin/env node
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { compileSceneToMjcf } from './mjcf.js';
import { inspectScene, loadScene } from './scene.js';

const [input, output] = process.argv.slice(2);
if (!input) {
  console.error('Usage: simarena-compile <scene.scene.json> [output.xml]');
  process.exitCode = 1;
} else {
  try {
    const scene = await loadScene(resolve(input));
    const result = compileSceneToMjcf(scene);
    const destination = resolve(output ?? `${scene.name}.xml`);
    await writeFile(destination, result.xml, 'utf8');
    console.log(JSON.stringify({ ...inspectScene(scene), output: destination, warnings: result.warnings }, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
