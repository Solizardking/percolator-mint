// Percolator agent console v2. Every transaction is simulated and quoted first, then signed ONLY by the
// connected browser wallet after an explicit tick. No wallet keys in the page; no server keys.
import { getWallets } from '@wallet-standard/app';
import { VersionedTransaction, PublicKey } from '@solana/web3.js';
import { walletAdapterIdentity } from '@metaplex-foundation/umi-signer-wallet-adapters';
import { NAME, URI_V2, PROGRAMS, CLUSTERS, DEVNET_REHEARSAL_ASSET, CLAWD, agentMetadata } from './agent-config.js';
import { simulate, sendSigned, confirm, assertCluster, rpc } from './txsim.js';
import * as F from './flows.js';
import { turboUpload, FREE_LIMIT } from './arweave.js';
import REG_V2 from './registration-v2.json';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SOL = (l) => (Number(l) / 1e9).toFixed(9).replace(/0+$/, '').replace(/\.$/, '') + ' SOL';
const short = (a) => (a ? a.slice(0, 4) + '…' + a.slice(-4) : '');
const ex = (kind, id) => `https://explorer.solana.com/${kind}/${id}${CLUSTERS[cluster()].explorer}`;
let wallet = null;
let state = { uri: URI_V2, lastAsset: null, art: null };

const cluster = () => document.querySelector('input[name=cluster]:checked').value;
const rpcUrl = () => $('rpc').value.trim() || CLUSTERS[cluster()].rpc;
const log = (m) => { $('log').textContent += `[${new Date().toLocaleTimeString()}] ${m}\n`; };
const need = () => { if (!wallet) throw new Error('Connect a wallet first.'); };
const umiFor = (withAdapter) => F.makeUmi(rpcUrl(), wallet?.address || '11111111111111111111111111111111', withAdapter && wallet ? walletAdapterIdentity(adapter()) : null);
const assetInput = () => { const v = $('agentAsset').value.trim(); new PublicKey(v); return v; };

// ---------- wallet ----------
let found = [];
function discover() {
  const list = [];
  for (const w of getWallets().get())
    if (w.features['standard:connect'] && w.features['solana:signTransaction'] && w.chains.some((c) => c.startsWith('solana:'))) list.push({ kind: 'standard', name: w.name, w });
  for (const [name, p] of [['Phantom', window.phantom?.solana], ['Backpack', window.backpack], ['Solflare', window.solflare]])
    if (p && !list.some((x) => x.name === name)) list.push({ kind: 'injected', name, p });
  const sel = $('wallets'); sel.innerHTML = '';
  list.forEach((x, i) => sel.add(new Option(x.name + (x.kind === 'standard' ? '' : ' (injected)'), i)));
  $('connect').disabled = !list.length;
  if (!list.length) $('wstatus').textContent = 'No Solana wallet found. Install Phantom, Backpack or Solflare.';
  return list;
}
async function connect() {
  const x = found[Number($('wallets').value)];
  if (x.kind === 'standard') {
    const { accounts } = await x.w.features['standard:connect'].connect();
    const account = accounts.find((a) => a.chains?.some((c) => c.startsWith('solana:'))) || accounts[0];
    wallet = { name: x.name, address: account.address,
      sign: async (bytes) => (await x.w.features['solana:signTransaction'].signTransaction({ account, transaction: bytes, chain: CLUSTERS[cluster()].chain }))[0].signedTransaction,
      signMessage: x.w.features['solana:signMessage'] ? async (m) => (await x.w.features['solana:signMessage'].signMessage({ account, message: m }))[0].signature : null };
  } else {
    const r = await x.p.connect();
    wallet = { name: x.name, address: (r?.publicKey || x.p.publicKey).toString(),
      sign: async (bytes) => (await x.p.signTransaction(VersionedTransaction.deserialize(bytes))).serialize(),
      signMessage: x.p.signMessage ? async (m) => { const o = await x.p.signMessage(m); return o.signature || o; } : null };
  }
  $('wstatus').textContent = `Connected ${wallet.name}: ${wallet.address}`;
  if (!$('execAuth').value) $('execAuth').value = wallet.address;
  document.querySelectorAll('.needs-wallet').forEach((b) => (b.disabled = false));
}
// wallet-adapter shaped object for Umi's walletAdapterIdentity (used by the Metaplex API mint mode)
function adapter() {
  return { publicKey: new PublicKey(wallet.address),
    signTransaction: async (tx) => VersionedTransaction.deserialize(await wallet.sign(tx.serialize())),
    signAllTransactions: async (txs) => { const o = []; for (const t of txs) o.push(VersionedTransaction.deserialize(await wallet.sign(t.serialize()))); return o; },
    signMessage: async (m) => { if (!wallet.signMessage) throw new Error('wallet cannot sign messages'); return wallet.signMessage(m); } };
}

// ---------- generic simulate -> quote -> tick -> wallet sign ----------
const ALLOW = new Set([PROGRAMS.system, PROGRAMS.computeBudget, PROGRAMS.core, PROGRAMS.agentIdentity, PROGRAMS.agentTools]);
async function quoteFlow(box, { title, build, watch = () => [], extraChecks = () => [], extraRows = () => [], signWith, allow = ALLOW, onDone }) {
  need(); box.innerHTML = `<p>Simulating <b>${esc(title)}</b> on ${cluster()} …</p>`;
  const c = cluster(), url = rpcUrl();
  const genesis = await assertCluster(url, c);
  const built = await build();
  const sim = await simulate(url, built.wire, [wallet.address, ...watch(built)]);
  const me = sim.accounts[0];
  const spend = sim.ok ? Math.max(0, me.pre - me.post) : 0;
  const rows = [['Action', title], ['Cluster', c.toUpperCase()], ['Fee payer', sim.feePayer], ['Network fee', SOL(sim.feeLamports || 0)],
    ['Compute units', sim.unitsConsumed], ['Programs', sim.programs.join('<br>')],
    ['Signers', sim.signersRequired.map((k, i) => `${k} ${sim.presentSigs[i] ? '(pre-signed)' : k === wallet.address ? '(your wallet)' : '(MISSING)'}`).join('<br>')],
    ...(sim.ok ? sim.accounts.map((a) => [a.address === wallet.address ? 'Your wallet' : short(a.address) + (a.existedBefore ? '' : ' (new)'), `${SOL(a.pre)} → ${SOL(a.post)}`]) : []),
    ['TOTAL from your wallet', sim.ok ? SOL(spend) : 'n/a'], ...extraRows(built, sim)];
  const checks = [['Simulation succeeded', sim.ok], ['RPC genesis matches ' + c, genesis === CLUSTERS[c].genesis],
    ['Fee payer = your wallet', sim.feePayer === wallet.address], ['No address lookup tables (all accounts visible)', !sim.usesLookupTables],
    ['Only expected programs', !allow || sim.programs.every((p) => allow.has(p))],
    ['Only your wallet still needs to sign', sim.signersRequired.every((k, i) => sim.presentSigs[i] || k === wallet.address)],
    ['Wallet balance covers it', me.pre >= spend + (sim.feeLamports || 0)], ...extraChecks(built, sim)];
  const ok = checks.every(([, v]) => v);
  box.innerHTML = `<table>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${typeof v === 'string' && v.includes('<br>') ? v : esc(v)}</td></tr>`).join('')}</table>
    <ul>${checks.map(([k, v]) => `<li class="${v ? 'ok' : 'bad'}">${v ? '✓' : '✗'} ${esc(k)}</li>`).join('')}</ul>
    ${sim.ok ? '' : `<pre>${esc(JSON.stringify(sim.err))}\n${esc(sim.logs.slice(-8).join('\n'))}</pre>`}
    <label><input type="checkbox" class="approve" ${ok ? '' : 'disabled'}> I approve: ${esc(title)} on ${c.toUpperCase()}, ≈ ${SOL(spend)} from ${short(wallet.address)}</label><br>
    <button class="sign" disabled>Sign in wallet &amp; send</button> <span class="exp"></span><div class="res"></div>`;
  const at = Date.now(), cb = box.querySelector('.approve'), sb = box.querySelector('.sign');
  cb.onchange = () => (sb.disabled = !cb.checked);
  sb.onclick = async () => {
    if (Date.now() - at > 60000 || cluster() !== c) { box.querySelector('.res').textContent = 'Quote expired or cluster changed. Re-quote.'; sb.disabled = true; return; }
    sb.disabled = true; cb.disabled = true;
    try {
      const signed = signWith ? await signWith(built) : await wallet.sign(built.wire);
      const sig = await sendSigned(url, signed); log(`${title}: sent ${sig}`);
      await confirm(url, sig);
      box.querySelector('.res').innerHTML = `<p class="ok">Confirmed ✓ <a target="_blank" href="${ex('tx', sig)}">tx</a></p>`;
      onDone?.(built, sig);
    } catch (e) { box.querySelector('.res').textContent = 'Not sent: ' + (e?.message || e); }
  };
  if (!ok) log(`${title}: a check failed; signing disabled.`);
  return { sim, built, ok };
}

// ---------- 1 · art ----------
async function artBudget() {
  try { const j = await (await fetch('/api/art')).json(); $('artBudget').textContent = `${j.remainingToday}/${j.dailyCap} generations left today (UTC) · ${j.perIpPerHour}/hour and ${j.perIpPerDay}/day per network · model ${j.model}`; }
  catch { $('artBudget').textContent = 'Art service unavailable.'; }
}
async function compress(blob) {
  const bmp = await createImageBitmap(blob);
  for (const size of [1024, 768, 640, 512, 384]) for (const q of [0.86, 0.76, 0.66, 0.56]) {
    const cv = Object.assign(document.createElement('canvas'), { width: size, height: Math.round((size * bmp.height) / bmp.width) });
    cv.getContext('2d').drawImage(bmp, 0, 0, cv.width, cv.height);
    const out = await new Promise((r) => cv.toBlob(r, 'image/webp', q));
    if (out && out.type === 'image/webp' && out.size < FREE_LIMIT - 2048) return { blob: out, size, q };
    const jpg = await new Promise((r) => cv.toBlob(r, 'image/jpeg', q));
    if (jpg && jpg.size < FREE_LIMIT - 2048) return { blob: jpg, size, q };
  }
  throw new Error('Could not compress under the free limit.');
}
async function generateArt() {
  $('artBtn').disabled = true; $('artOut').textContent = 'Generating … (10–40 s)';
  try {
    const r = await fetch('/api/art', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ preset: $('artPreset').value }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.status);
    const raw = await (await fetch(`data:${j.mime};base64,${j.image}`)).blob();
    const c = await compress(raw);
    state.art = { blob: c.blob, type: c.blob.type, raw: raw.size };
    $('artOut').innerHTML = `<img src="${URL.createObjectURL(c.blob)}" width="256" alt="generated art"><br>${esc(j.mode)} · ${raw.size} B → ${c.blob.size} B ${esc(c.blob.type)} (${c.size}px, q${c.q})`;
    $('artUpload').disabled = false;
  } catch (e) { $('artOut').textContent = 'Generation failed: ' + e.message; }
  $('artBtn').disabled = false; artBudget();
}
async function uploadArt() {
  $('artUpload').disabled = true;
  try {
    const img = await turboUpload(new Uint8Array(await state.art.blob.arrayBuffer()), state.art.type, [{ name: 'Title', value: 'Percolator agent art' }]);
    log('image uploaded: ' + img.url);
    const base = structuredClone(REG_V2); // bundled copy of the v2 Arweave registration (new items can take minutes to appear on gateways)
    const services = [...(base.services || []).filter((x) => x.name !== 'token'), { name: 'token', endpoint: CLAWD.url }];
    const meta = { ...base, image: img.url, services, token: { ...CLAWD }, properties: { category: 'image', files: [{ uri: img.url, type: state.art.type }] } };
    const mj = await turboUpload(new TextEncoder().encode(JSON.stringify(meta, null, 2)), 'application/json', [{ name: 'Title', value: 'Percolator agent registration' }]);
    log('metadata uploaded: ' + mj.url);
    state.uri = mj.url; $('uri').value = mj.url;
    $('artLinks').innerHTML = `Image: <a target="_blank" href="${img.url}">${img.url}</a><br>Metadata: <a target="_blank" href="${mj.url}">${mj.url}</a><br>
      The mint URI below now uses this metadata. (Arweave can take a few minutes to serve new items.)`;
  } catch (e) { $('artLinks').textContent = 'Upload failed: ' + e.message; $('artUpload').disabled = false; }
}

// ---------- 2 · mint ----------
function mintChecks(b, s) {
  const acc = s.accounts.find((a) => a.address === b.assetAddress);
  let d = null; try { d = F.decodeAsset(b.assetAddress, acc?.postAccount); } catch {}
  const api = $('mintMode').value === 'api';
  const idUri = d?.agentIdentities?.[0]?.uri || '';
  return [['Asset: owner = your wallet', d?.owner === wallet.address],
    ['Asset: update authority = your wallet (no extra authority)', d?.updateAuthority?.type === 'Address' && d.updateAuthority.address === wallet.address],
    ['Asset: name "Percolator" and URI = chosen metadata', d?.name === NAME && d?.uri === $('uri').value.trim()],
    ['Asset: only the AgentIdentity plugin', JSON.stringify(d?.pluginKeys) === JSON.stringify(['pluginHeader', 'agentIdentities'])],
    [api ? 'AgentIdentity URI = Metaplex API record for this asset' : 'AgentIdentity URI = chosen metadata',
      api ? idUri.startsWith(`https://api.metaplex.com/v1/agents/${b.assetAddress}`) : idUri === $('uri').value.trim()]];
}
async function quoteMint() {
  const uri = $('uri').value.trim(); new URL(uri);
  const api = $('mintMode').value === 'api';
  const umi = umiFor(api);
  await quoteFlow($('mintQuote'), {
    title: `Mint "${NAME}" (${api ? 'Metaplex API mintAgent' : 'direct Core + registerIdentityV1'})`,
    build: () => (api ? F.buildApiMint(umi, { wallet: wallet.address, cluster: cluster(), uri }) : F.buildDirectMint(umi, { wallet: wallet.address, uri })),
    watch: (b) => [b.assetAddress, b.identityPda],
    extraRows: (b) => [['New asset', b.assetAddress], ['Agent Identity PDA', b.identityPda], ['Metadata URI', uri],
      ...(api ? [['agentMetadata (stored by Metaplex API)', JSON.stringify(agentMetadata())]] : [])],
    extraChecks: mintChecks,
    signWith: api ? async (b) => umi.transactions.serialize(await umi.identity.signTransaction(b.transaction)) : undefined, // walletAdapterIdentity
    onDone: (b) => { state.lastAsset = b.assetAddress; $('agentAsset').value = b.assetAddress;
      $('mintQuote').querySelector('.res').innerHTML += `<p>Asset: <code>${b.assetAddress}</code> · <a target="_blank" href="${ex('address', b.assetAddress)}">explorer</a></p>`; },
  });
}

// ---------- 3 · run an agent ----------
async function execStatus() {
  const s = await F.delegationStatus(rpcUrl(), umiFor(false), { asset: assetInput(), executiveAuthority: $('execAuth').value.trim() });
  $('execOut').innerHTML = `<table>${[['Asset exists', s.assetExists], ['Agent identity registered', s.identityRegistered], ['Asset signer PDA', s.assetSigner],
    ['Executive profile', `${s.executiveProfile} (${s.executiveProfileExists ? 'exists' : 'not registered'})`],
    ['Delegation record', `${s.delegateRecord} (${s.delegated ? 'ACTIVE' : 'none'})`]].map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join('')}</table>`;
}
const execAuth = () => { const v = $('execAuth').value.trim(); new PublicKey(v); return v; };
async function execFlow(kind) {
  const umi = umiFor(false), asset = kind === 'register' ? null : assetInput(), auth = execAuth();
  const p = asset ? F.pdas(umi, { asset, executiveAuthority: auth }) : F.pdas(umi, { asset: DEVNET_REHEARSAL_ASSET, executiveAuthority: wallet.address });
  const map = {
    register: ['registerExecutiveV1 (executive profile for your wallet)', () => F.buildRegisterExecutive(umi), [p.executiveProfile]],
    both: ['registerExecutiveV1 + delegateExecutionV1 to your own wallet', () => F.buildRegisterAndDelegate(umi, { asset }), [p.executiveProfile, p.delegateRecord]],
    delegate: [`delegateExecutionV1 → executive ${short(auth)}`, () => F.buildDelegate(umi, { asset, executiveAuthority: auth }), [p.delegateRecord]],
    revoke: [`revokeExecutionV1 (executive ${short(auth)})`, () => F.buildRevoke(umi, { asset, executiveAuthority: auth }), [p.delegateRecord]],
  }[kind];
  if ((kind === 'delegate' || kind === 'both') && !$('execAck').checked) throw new Error('Tick the delegate warning first.');
  await quoteFlow($('execQuote'), { title: map[0], build: async () => ({ wire: await map[1]() }), watch: () => map[2], onDone: () => execStatus().catch(() => {}) });
}

// ---------- 4 · x402 payments ----------
async function x402Read() {
  const asset = assetInput(), c = cluster();
  const b = await F.signerBalances(rpcUrl(), umiFor(false), { asset, cluster: c });
  let mech = 'n/a'; try { const m = await F.fetchMechStatus(asset); mech = `${m.isDelegated ? 'DELEGATED to Mech' : 'not delegated'} · record ${m.executionDelegateRecord}`; } catch (e) { mech = 'status error: ' + e.message; }
  $('x402Out').innerHTML = `<table>${[['Agent signer PDA (findAssetSignerPda)', b.signerPda], ['SOL in signer PDA', SOL(b.sol)],
    ['USDC ATA (classic SPL)', `${b.usdcAta} ${b.ataExists ? '' : '(not created)'}`], ['USDC balance', `${b.usdc} (mint ${b.usdcMint})`],
    ['Mech delegate status (fetchMetaplexCoreExecuteDelegateStatus, Metaplex hosted API)', mech]].map(([k, v]) => `<tr><th>${k}</th><td>${esc(v)}</td></tr>`).join('')}</table>`;
}
async function mechFlow(kind) {
  if (!$('mechAck').checked) throw new Error('Tick the Mech warning (devnet rehearsal first) before building.');
  if (cluster() !== 'mainnet-beta') throw new Error('Metaplex\'s hosted Mech delegate API builds mainnet transactions only (it rejects devnet assets as "Invalid Core Asset"). Rehearse delegation on devnet with section 3, then switch to mainnet.');
  const asset = assetInput();
  await quoteFlow($('x402Quote'), { title: `${kind === 'approve' ? 'Approve' : 'Revoke'} Mech x402 delegation for ${short(asset)}`,
    build: async () => ({ wire: await F.buildMech(kind, { asset, owner: wallet.address }) }), onDone: () => x402Read().catch(() => {}) });
}

// ---------- 5 · x402m (read-only) ----------
async function x402mRead() {
  const [d, a] = await Promise.all(['discovery', 'agents'].map(async (w) => (await fetch('/api/x402m?what=' + w)).json()));
  $('x402mOut').innerHTML = `<p>Protocol <b>${esc(d.protocol)}</b> (${esc(d.status)}), ${esc(d.transport)}, delivery ${esc(d.delivery)}, retention ${Math.round((d.retentionSeconds || 0) / 86400)} days, federation ${esc(d.federation)}.</p>
    <p>Capabilities: ${(d.capabilities || []).map((c) => `<code>${esc(c.name)}</code>`).join(' ')}</p>
    <table><tr><th>Handle</th><td><b>Name</b> · agent id</td></tr>${(a.agents || []).map((x) => `<tr><th>@${esc(x.handle)}</th><td>${esc(x.name)} · <code>${esc(x.agent_id)}</code></td></tr>`).join('')}</table>
    <p>${(a.agents || []).some((x) => x.handle === 'percolator') ? '@percolator is registered.' : '<b>@percolator is not registered yet.</b>'} Inbox reads need the agent\'s own signed JWT, so there is no public inbox view.</p>`;
}

// ---------- wiring ----------
const guard = (fn, out) => () => fn().catch((e) => { (out ? $(out) : $('log')).textContent = (out ? '' : $('log').textContent) + 'Error: ' + (e?.message || e) + '\n'; });
function onCluster() {
  const dev = cluster() === 'devnet';
  $('rpc').value = ''; $('banner').className = dev ? 'dev' : 'main';
  $('banner').textContent = dev ? 'DEVNET (rehearsal)' : 'MAINNET-BETA (real SOL)';
  $('agentAsset').value = dev ? (state.lastAsset || DEVNET_REHEARSAL_ASSET) : (state.lastAsset || '');
  document.querySelectorAll('.quotebox').forEach((b) => (b.innerHTML = ''));
}
window.addEventListener('DOMContentLoaded', () => {
  found = discover(); getWallets().on('register', () => (found = discover()));
  $('uri').value = state.uri; $('agentAsset').value = DEVNET_REHEARSAL_ASSET;
  $('metaPreview').textContent = JSON.stringify(agentMetadata(), null, 1);
  $('connect').onclick = () => connect().catch((e) => ($('wstatus').textContent = 'Connect failed: ' + e.message));
  $('artBtn').onclick = generateArt; $('artUpload').onclick = uploadArt; artBudget();
  $('mintBtn').onclick = guard(quoteMint, 'mintQuote');
  $('execStatus').onclick = guard(execStatus, 'execOut');
  for (const k of ['register', 'both', 'delegate', 'revoke']) $('exec_' + k).onclick = guard(() => execFlow(k), 'execQuote');
  $('x402Read').onclick = guard(x402Read, 'x402Out');
  $('mechApprove').onclick = guard(() => mechFlow('approve'), 'x402Quote'); $('mechRevoke').onclick = guard(() => mechFlow('revoke'), 'x402Quote');
  $('x402mRead').onclick = guard(x402mRead, 'x402mOut');
  document.querySelectorAll('input[name=cluster]').forEach((r) => (r.onchange = onCluster)); onCluster();
});
