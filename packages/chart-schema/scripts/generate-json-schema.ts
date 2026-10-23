import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildJsonSchemas, serializeJsonSchema } from '../src/json-schema';

const outDir = fileURLToPath(new URL('../json-schema/', import.meta.url));
mkdirSync(outDir, { recursive: true });
for (const [file, schema] of Object.entries(buildJsonSchemas())) {
  writeFileSync(new URL(file, `file://${outDir}`), serializeJsonSchema(schema));
  console.log(`wrote json-schema/${file}`);
}
