// Completes the art pipeline for the image generated + uploaded by the page: same metadata shape the page builds.
import { readFileSync } from 'node:fs';
import { turboUpload } from '../src/arweave.js';
import { CLAWD } from '../src/agent-config.js';
const img = process.argv[2];
const base = JSON.parse(readFileSync('src/registration-v2.json', 'utf8'));
const services = [...base.services.filter((x) => x.name !== 'token'), { name: 'token', endpoint: CLAWD.url }];
const meta = { ...base, image: img, services, token: { ...CLAWD }, properties: { category: 'image', files: [{ uri: img, type: 'image/webp' }] } };
const r = await turboUpload(new TextEncoder().encode(JSON.stringify(meta, null, 2)), 'application/json', [{ name: 'Title', value: 'Percolator agent registration (art)' }]);
console.log(r.url, r.receipt.winc);
