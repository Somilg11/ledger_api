/**
 * Writes the OpenAPI document to docs/openapi.json for importing into Postman,
 * Insomnia or a client generator.
 *
 *   npm run docs:openapi
 */
import fs from 'node:fs';
import path from 'node:path';
import { openapiSpec } from '../src/docs/openapi';

const target = path.join(__dirname, '..', 'docs', 'openapi.json');
fs.writeFileSync(target, `${JSON.stringify(openapiSpec, null, 2)}\n`);

const paths = Object.keys(openapiSpec.paths).length;
console.log(`Wrote ${target} — ${paths} paths`);
