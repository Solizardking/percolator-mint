import { readFileSync } from 'node:fs';
import { turboUpload } from '../src/arweave.js';
const bytes = new Uint8Array(readFileSync(process.argv[2]));
JSON.parse(new TextDecoder().decode(bytes));
console.log(JSON.stringify(await turboUpload(bytes, 'application/json', [{ name: 'Title', value: 'Percolator agent registration v3 (tokens: $CLAWD)' }])));
