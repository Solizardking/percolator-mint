// Transaction builders for every v2 console flow. All return wire bytes for the wallet to sign;
// nothing here signs with a wallet key or sends anything.
import { createUmi } from '@metaplex-foundation/umi-bundle-defaults';
import { createNoopSigner, publicKey as pk } from '@metaplex-foundation/umi';
import { mplCore, findAssetSignerPda, deserializeAssetV1, fetchAssetV1, addPlugin, updatePlugin } from '@metaplex-foundation/mpl-core';
import { mplAgentIdentity, mplAgentTools, mintAgent, registerExecutiveV1, delegateExecutionV1, revokeExecutionV1,
  findAgentIdentityV1Pda, findExecutiveProfileV1Pda, findExecutionDelegateRecordV1Pda } from '@metaplex-foundation/mpl-agent-registry';
import { findAssociatedTokenPda, mplToolbox } from '@metaplex-foundation/mpl-toolbox';
import { NAME, CLUSTERS, PROGRAMS, agentMetadata, CLAWD_ATTRIBUTES } from './agent-config.js';
import { rpc, unb64 } from './txsim.js';

export const METAPLEX_API = 'https://api.metaplex.com';
export function makeUmi(rpcUrl, walletAddress, identityPlugin) {
  const umi = createUmi(rpcUrl).use(mplToolbox()).use(mplCore()).use(mplAgentIdentity()).use(mplAgentTools());
  if (identityPlugin) umi.use(identityPlugin);           // walletAdapterIdentity(adapter) in the browser
  else { const s = createNoopSigner(pk(walletAddress)); umi.identity = s; umi.payer = s; }
  return umi;
}
const wireOf = async (umi, builder) => umi.transactions.serialize(await builder.buildWithLatestBlockhash(umi));

export function decodeAsset(address, simAccount) {
  if (!simAccount) return null;
  const d = deserializeAssetV1({ publicKey: pk(address), executable: false, owner: pk(PROGRAMS.core),
    lamports: { basisPoints: BigInt(simAccount.lamports), identifier: 'SOL', decimals: 9 }, data: unb64(simAccount.data[0]) });
  return { name: d.name, uri: d.uri, owner: d.owner.toString(),
    updateAuthority: { type: d.updateAuthority.type, address: d.updateAuthority.address?.toString() ?? null },
    agentIdentities: (d.agentIdentities || []).map((x) => ({ uri: x.uri, lifecycleChecks: x.lifecycleChecks })),
    pluginKeys: Object.keys(d).filter((k) => !['publicKey', 'header', 'key', 'owner', 'updateAuthority', 'name', 'uri', 'seq'].includes(k)) };
}

/** Metaplex API mode: POST /v1/agents/mint returns an unsigned tx (asset key pre-signed by the API). */
export async function buildApiMint(umi, { wallet, cluster, uri }) {
  const input = { wallet: pk(wallet), network: CLUSTERS[cluster].network, name: NAME, uri, agentMetadata: agentMetadata() };
  const res = await mintAgent(umi, {}, input);
  const wire = umi.transactions.serialize(res.transaction);
  const identityPda = findAgentIdentityV1Pda(umi, { asset: pk(res.assetAddress) })[0].toString();
  return { wire, transaction: res.transaction, assetAddress: res.assetAddress, identityPda, input };
}

export function pdas(umi, { asset, executiveAuthority }) {
  const out = { assetSigner: findAssetSignerPda(umi, { asset: pk(asset) })[0].toString(),
    agentIdentity: findAgentIdentityV1Pda(umi, { asset: pk(asset) })[0].toString() };
  if (executiveAuthority) {
    const ep = findExecutiveProfileV1Pda(umi, { authority: pk(executiveAuthority) });
    out.executiveProfile = ep[0].toString();
    out.delegateRecord = findExecutionDelegateRecordV1Pda(umi, { executiveProfile: ep[0], agentAsset: pk(asset) })[0].toString();
  }
  return out;
}

export async function buildRegisterExecutive(umi) {
  return wireOf(umi, registerExecutiveV1(umi, { payer: umi.payer }));
}
export async function buildDelegate(umi, { asset, executiveAuthority }) {
  const p = pdas(umi, { asset, executiveAuthority });
  return wireOf(umi, delegateExecutionV1(umi, { agentAsset: pk(asset), agentIdentity: pk(p.agentIdentity), executiveProfile: pk(p.executiveProfile) }));
}
export async function buildRevoke(umi, { asset, executiveAuthority }) {
  const p = pdas(umi, { asset, executiveAuthority });
  return wireOf(umi, revokeExecutionV1(umi, { executionDelegateRecord: pk(p.delegateRecord), agentAsset: pk(asset), destination: umi.identity.publicKey }));
}

export async function delegationStatus(rpcUrl, umi, { asset, executiveAuthority }) {
  const p = pdas(umi, { asset, executiveAuthority });
  const v = (await rpc(rpcUrl, 'getMultipleAccounts', [[asset, p.agentIdentity, p.executiveProfile, p.delegateRecord], { encoding: 'base64', dataSlice: { offset: 0, length: 0 } }])).value;
  return { ...p, assetExists: !!v[0], identityRegistered: !!v[1], executiveProfileExists: !!v[2], delegated: !!v[3] };
}

/** x402 panel reads: signer PDA balances (SOL + classic SPL USDC ATA). */
export async function signerBalances(rpcUrl, umi, { asset, cluster }) {
  const signer = findAssetSignerPda(umi, { asset: pk(asset) })[0];
  const ata = findAssociatedTokenPda(umi, { mint: pk(CLUSTERS[cluster].usdc), owner: signer })[0].toString();
  const sol = (await rpc(rpcUrl, 'getBalance', [signer.toString(), { commitment: 'confirmed' }])).value;
  let usdc = 0, ataExists = false;
  try { const t = await rpc(rpcUrl, 'getTokenAccountBalance', [ata, { commitment: 'confirmed' }]); usdc = Number(t.value.uiAmount || 0); ataExists = true; } catch {}
  return { signerPda: signer.toString(), sol, usdcAta: ata, usdc, ataExists, usdcMint: CLUSTERS[cluster].usdc };
}

/** Mech (Metaplex x402) delegation: hosted API builds the tx; we simulate, the wallet signs. Mainnet-only today. */
export async function fetchMechStatus(asset) {
  const r = await fetch(`${METAPLEX_API}/x402/core-execute-delegate/status?asset=${asset}`);
  const j = await r.json();
  if (!j.success) throw new Error(j.error || 'status failed');
  return { isDelegated: j.isDelegated, executionDelegateRecord: j.executionDelegateRecord };
}
export async function buildMech(kind, { asset, owner }) {
  const r = await fetch(`${METAPLEX_API}/x402/core-execute-delegate/${kind}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ asset, owner }) });
  const j = await r.json();
  if (!j.success) throw new Error((j.error || `${kind} build failed`).split('\n')[0]);
  return unb64(j.tx);
}

/** Register executive profile + delegate in ONE tx (for owners who run their own executive). */
export async function buildRegisterAndDelegate(umi, { asset }) {
  const me = umi.identity.publicKey.toString();
  const p = pdas(umi, { asset, executiveAuthority: me });
  return wireOf(umi, registerExecutiveV1(umi, { payer: umi.payer })
    .add(delegateExecutionV1(umi, { agentAsset: pk(asset), agentIdentity: pk(p.agentIdentity), executiveProfile: pk(p.executiveProfile) })));
}

/** Direct mode (v1): Core create + registerIdentityV1 in one tx. Ephemeral asset key signs only its own creation. */
import { generateSigner } from '@metaplex-foundation/umi';
import { create } from '@metaplex-foundation/mpl-core';
import { registerIdentityV1 } from '@metaplex-foundation/mpl-agent-registry';
export async function buildDirectMint(umi, { wallet, uri }) {
  const asset = generateSigner(umi);
  const identityPda = findAgentIdentityV1Pda(umi, { asset: asset.publicKey })[0].toString();
  const b = create(umi, { asset, name: NAME, uri, owner: pk(wallet) })
    .add(registerIdentityV1(umi, { asset: asset.publicKey, agentRegistrationUri: uri }));
  const signed = await asset.signTransaction(await b.buildWithLatestBlockhash(umi));
  return { wire: umi.transactions.serialize(signed), assetAddress: asset.publicKey.toString(), identityPda };
}

/** Core Attributes mirror of the $CLAWD pairing (on-asset, update authority signs). */
export async function attributesStatus(umi, { asset }) {
  const a = await fetchAssetV1(umi, pk(asset));
  const attributes = (a.attributes?.attributeList || []).map((x) => ({ key: x.key, value: x.value }));
  return { owner: a.owner.toString(), updateAuthorityType: a.updateAuthority.type, updateAuthority: a.updateAuthority.address?.toString() ?? null,
    hasAttributes: !!a.attributes, attributes,
    mirrored: CLAWD_ATTRIBUTES.every((c) => attributes.some((x) => x.key === c.key && x.value === c.value)) };
}
export function mergedAttributes(existing) {
  return [...existing.filter((x) => !CLAWD_ATTRIBUTES.some((c) => c.key === x.key)), ...CLAWD_ATTRIBUTES.map((c) => ({ ...c }))];
}
export async function buildAttributesMirror(umi, { asset }) {
  const a = await fetchAssetV1(umi, pk(asset));
  const collection = a.updateAuthority.type === 'Collection' ? a.updateAuthority.address : undefined;
  const attributeList = mergedAttributes((a.attributes?.attributeList || []).map((x) => ({ key: x.key, value: x.value })));
  const b = a.attributes
    ? updatePlugin(umi, { asset: pk(asset), collection, plugin: { type: 'Attributes', attributeList } })
    : addPlugin(umi, { asset: pk(asset), collection, plugin: { type: 'Attributes', attributeList } });
  return wireOf(umi, b);
}
export function decodeAttributes(address, simAccount) {
  if (!simAccount) return null;
  const d = deserializeAssetV1({ publicKey: pk(address), executable: false, owner: pk(PROGRAMS.core),
    lamports: { basisPoints: BigInt(simAccount.lamports), identifier: 'SOL', decimals: 9 }, data: unb64(simAccount.data[0]) });
  return { owner: d.owner.toString(), attributes: (d.attributes?.attributeList || []).map((x) => ({ key: x.key, value: x.value })),
    agentIdentities: (d.agentIdentities || []).length };
}
