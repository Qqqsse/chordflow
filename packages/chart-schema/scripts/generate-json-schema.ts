import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildJsonSchemas, serializeJsonSchema } from '../src/json-schema';
import { buildOpenApi } from '../src/openapi';

const outDir = fileURLToPath(new URL('../json-schema/', import.meta.url));
mkdirSync(outDir, { recursive: true });
for (const [file, schema] of Object.entries(buildJsonSchemas())) {
  writeFileSync(new URL(file, `file://${outDir}`), serializeJsonSchema(schema));
  console.log(`wrote json-schema/${file}`);
}

const openapiDir = fileURLToPath(new URL('../openapi/', import.meta.url));
mkdirSync(openapiDir, { recursive: true });
writeFileSync(`${openapiDir}openapi.v1.json`, `${JSON.stringify(buildOpenApi(), null, 2)}\n`);
console.log('wrote openapi/openapi.v1.json');
