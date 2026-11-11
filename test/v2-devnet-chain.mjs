// Prove register -> delegate -> revoke instruction chain in a single simulated (unsigned, never sent) devnet tx.
import { CLUSTERS, DEVNET_REHEARSAL_ASSET as ASSET } from '../src/agent-config.js';
import { simulate } from '../src/txsim.js';
import * as F from '../src/flows.js';
import { publicKey as pk } from '@metaplex-foundation/umi';
import { registerExecutiveV1, delegateExecutionV1, revokeExecutionV1 } from '@metaplex-foundation/mpl-agent-registry';
const DEV = 'GKKmEVjHbAp4jePLJRqALYLjTLbT4rHNQA6c394dKC91', RPC = CLUSTERS.devnet.rpc;
const umi = F.makeUmi(RPC, DEV);
const p = F.pdas(umi, { asset: ASSET, executiveAuthority: DEV });
const two = await simulate(RPC, await F.buildRegisterAndDelegate(umi, { asset: ASSET }), [DEV, p.executiveProfile, p.delegateRecord]);
const b = registerExecutiveV1(umi, { payer: umi.payer })
  .add(delegateExecutionV1(umi, { agentAsset: pk(ASSET), agentIdentity: pk(p.agentIdentity), executiveProfile: pk(p.executiveProfile) }))
  .add(revokeExecutionV1(umi, { executionDelegateRecord: pk(p.delegateRecord), agentAsset: pk(ASSET), destination: pk(DEV) }));
const three = await simulate(RPC, umi.transactions.serialize(await b.buildWithLatestBlockhash(umi)), [DEV, p.executiveProfile, p.delegateRecord]);
const fmt = (s) => ({ ok: s.ok, err: s.err, fee: s.feeLamports, cu: s.unitsConsumed,
  accounts: s.accounts.map((a) => `${a.address} ${a.pre} -> ${a.post}`), logs: s.logs.filter((l) => /Instruction:|failed|success/.test(l)) });
console.log(JSON.stringify({ pdas: p, registerPlusDelegate: fmt(two), registerDelegateRevoke: fmt(three) }, null, 1));
