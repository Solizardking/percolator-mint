import { buildDataItem } from '../src/arweave.js';
const ab = await import('@dha-team/arbundles').catch(()=>import('arbundles'));
const { DataItem } = ab.default ?? ab;
const it = buildDataItem(new TextEncoder().encode('{"hello":"percolator"}'), [{name:'Content-Type',value:'application/json'}]);
const di = new DataItem(Buffer.from(it.bytes));
console.log('id match', di.id === it.id, 'sigType', di.signatureType, 'tags', JSON.stringify(di.tags), 'verify', await DataItem.verify(Buffer.from(it.bytes)));
