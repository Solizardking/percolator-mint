import { buildAndQuote, sendSigned, confirm, CLUSTERS, NAME, URI, PROGRAMS } from './mint-core.js';
import { getWallets } from '@wallet-standard/app';
import { VersionedTransaction } from '@solana/web3.js';

const $ = (id) => document.getElementById(id);
const SOL = (l) => (Number(l) / 1e9).toFixed(9).replace(/0+$/, '').replace(/\.$/, '') + ' SOL';
const CHAIN = { 'mainnet-beta': 'solana:mainnet', devnet: 'solana:devnet' };
let wallet = null;   // { name, address, sign(bytes)->bytes }
let pending = null;  // { built, quote, at, cluster, rpc }

function cluster() { return document.querySelector('input[name=cluster]:checked').value; }
function rpcUrl() { return $('rpc').value.trim() || CLUSTERS[cluster()].rpc; }
function log(m) { $('log').textContent += m + '\n'; }
function resetQuote() { pending = null; $('quote').hidden = true; $('approve').checked = false; $('sign').disabled = true; }

function discover() {
  const list = [];
  for (const w of getWallets().get()) {
    if (w.features['standard:connect'] && w.features['solana:signTransaction'] && w.chains.some((c) => c.startsWith('solana:')))
      list.push({ kind: 'standard', name: w.name, w });
  }
  const inj = [['Phantom', window.phantom?.solana], ['Backpack', window.backpack], ['Solflare', window.solflare]];
  for (const [name, p] of inj) if (p && !list.some((x) => x.name === name)) list.push({ kind: 'injected', name, p });
  const sel = $('wallets'); sel.innerHTML = '';
  list.forEach((x, i) => { const o = document.createElement('option'); o.value = i; o.textContent = x.name + (x.kind === 'standard' ? '' : ' (injected)'); sel.appendChild(o); });
  $('connect').disabled = !list.length;
  if (!list.length) $('wstatus').textContent = 'No Solana wallet found. Install Phantom, Backpack or Solflare.';
  return list;
}
let found = [];
getWallets().on('register', () => { found = discover(); });

async function connect() {
  const x = found[Number($('wallets').value)];
  if (x.kind === 'standard') {
    const { accounts } = await x.w.features['standard:connect'].connect();
    const account = accounts.find((a) => a.chains?.some((c) => c.startsWith('solana:'))) || accounts[0];
    wallet = { name: x.name, address: account.address, sign: async (bytes) => {
      const [out] = await x.w.features['solana:signTransaction'].signTransaction({ account, transaction: bytes, chain: CHAIN[cluster()] });
      return out.signedTransaction; } };
  } else {
    const r = await x.p.connect();
    const address = (r?.publicKey || x.p.publicKey).toString();
    wallet = { name: x.name, address, sign: async (bytes) => {
      const signed = await x.p.signTransaction(VersionedTransaction.deserialize(bytes));
      return signed.serialize(); } };
  }
  $('wstatus').textContent = `Connected ${wallet.name}: ${wallet.address}`;
  $('quoteBtn').disabled = false; resetQuote();
}

async function doQuote() {
  resetQuote(); $('log').textContent = '';
  const c = cluster(), rpc = rpcUrl();
  log(`Simulating on ${c} via ${rpc} …`);
  const built = await buildAndQuote({ rpcUrl: rpc, wallet: wallet.address, cluster: c });
  const q = built.quote;
  const d = q.decoded || {};
  const ua = d.updateAuthority ? `${d.updateAuthority.type} ${d.updateAuthority.address ?? ''}` : '?';
  const checks = [
    ['Simulation succeeded', q.ok],
    ['RPC genesis matches selected cluster', q.genesis === CLUSTERS[c].genesis],
    ['Owner = connected wallet', d.owner === wallet.address],
    ['Update authority = connected wallet (no extra authority)', d.updateAuthority?.type === 'Address' && d.updateAuthority.address === wallet.address],
    ['Only AgentIdentity plugin', JSON.stringify(d.pluginKeys) === JSON.stringify(['pluginHeader', 'agentIdentities'])],
    ['AgentIdentity URI = Arweave registration', d.agentIdentities?.[0]?.uri === URI],
    ['Name / URI match', d.name === NAME && d.uri === URI],
    ['Wallet balance covers total', q.walletBalanceLamports >= (q.totalLamports || Infinity)],
  ];
  $('qtable').innerHTML = [
    ['Cluster', c.toUpperCase()], ['Payer / owner', wallet.address], ['New asset address', q.asset],
    ['Agent Identity PDA', q.agentIdentityPda], ['Name', d.name], ['URI', d.uri], ['Update authority', ua],
    ['Asset rent', SOL(q.assetRentLamports ?? 0)], ['Agent Identity PDA rent', SOL(q.identityRentLamports ?? 0)],
    ['Network fee', SOL(q.feeLamports ?? 0)], ['TOTAL cost', SOL(q.totalLamports ?? 0)],
    ['Wallet balance', SOL(q.walletBalanceLamports)], ['Compute units (simulated)', q.unitsConsumed],
    ['Programs', `Core ${PROGRAMS.core} · Agent Identity ${PROGRAMS.agentIdentity}`],
  ].map(([k, v]) => `<tr><th>${k}</th><td>${v ?? ''}</td></tr>`).join('');
  $('checks').innerHTML = checks.map(([k, ok]) => `<li class="${ok ? 'ok' : 'bad'}">${ok ? '✓' : '✗'} ${k}</li>`).join('');
  if (!q.ok) log('Simulation error: ' + JSON.stringify(q.err) + '\n' + (q.logs || []).slice(-10).join('\n'));
  $('quote').hidden = false;
  const allOk = checks.every(([, ok]) => ok);
  pending = allOk ? { built, quote: q, at: Date.now(), cluster: c, rpc } : null;
  $('approveLabel').textContent = `I approve: ${c.toUpperCase()} mint of "${NAME}" to ${wallet.address.slice(0, 6)}…, total ≈ ${SOL(q.totalLamports ?? 0)}`;
  log(allOk ? 'Quote OK. Tick the box to enable signing. Quote expires in 60 s.' : 'A check failed; signing is disabled.');
}

async function doSign() {
  if (!pending || !$('approve').checked) return;
  if (Date.now() - pending.at > 60000 || pending.cluster !== cluster()) { log('Quote expired or cluster changed. Re-quote.'); resetQuote(); return; }
  $('sign').disabled = true;
  try {
    const signed = await wallet.sign(pending.built.wire);        // the wallet shows its own prompt
    const sig = await sendSigned(pending.rpc, signed);
    log('Sent: ' + sig + ' … confirming');
    await confirm(pending.rpc, sig);
    const ex = CLUSTERS[pending.cluster].explorer;
    $('result').hidden = false;
    $('result').innerHTML = `<h2>Minted ✓</h2><p>Asset: <code>${pending.quote.asset}</code></p>
      <p><a target="_blank" href="https://explorer.solana.com/address/${pending.quote.asset}${ex}">Explorer: asset</a> ·
      <a target="_blank" href="https://explorer.solana.com/tx/${sig}${ex}">Explorer: tx</a></p>
      <p>Send the asset address to your agent to verify and update the registration file.</p>`;
  } catch (e) { log('Not sent: ' + (e?.message || e)); }
  pending = null;
}

window.addEventListener('DOMContentLoaded', () => {
  $('uri').textContent = URI; found = discover();
  $('connect').onclick = () => connect().catch((e) => ($('wstatus').textContent = 'Connect failed: ' + e.message));
  $('quoteBtn').onclick = () => doQuote().catch((e) => log('Quote failed: ' + e.message));
  $('approve').onchange = () => ($('sign').disabled = !($('approve').checked && pending));
  $('sign').onclick = doSign;
  document.querySelectorAll('input[name=cluster]').forEach((r) => (r.onchange = () => { $('rpc').value = ''; $('banner').className = cluster() === 'devnet' ? 'dev' : 'main'; $('banner').textContent = cluster() === 'devnet' ? 'DEVNET (rehearsal)' : 'MAINNET-BETA (real SOL)'; resetQuote(); }));
});
