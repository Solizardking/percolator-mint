// Simulate-only devnet run. No signing by any wallet, nothing is sent.
import { buildAndQuote, CLUSTERS } from '../src/mint-core.js';
const wallet = process.argv[2] || 'CstbLXKvpVDLGcF1enknDUshmg5m2kWAxSkhjiPGkwwq'; // public devnet address, used only as simulated fee payer
const cluster = process.argv[3] || 'devnet';
const { quote } = await buildAndQuote({ rpcUrl: CLUSTERS[cluster].rpc, wallet, cluster });
const { logs, ...rest } = quote;
console.log(JSON.stringify(rest, null, 2));
console.log('logs (tail):\n' + (logs || []).slice(-8).join('\n'));
