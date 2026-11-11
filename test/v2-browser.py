# v2 live-page test with a MOCK wallet that refuses to sign. Nothing is ever signed or sent.
import json, sys
from playwright.sync_api import sync_playwright
DEV = 'GKKmEVjHbAp4jePLJRqALYLjTLbT4rHNQA6c394dKC91'
mock = """window.__signCalls=0;window.phantom={solana:{isPhantom:true,publicKey:{toString:()=>'%s'},connect:async()=>({publicKey:{toString:()=>'%s'}}),signTransaction:async()=>{window.__signCalls++;throw new Error('MOCK WALLET: signing refused (test)')}}};""" % (DEV, DEV)
url = sys.argv[1] if len(sys.argv) > 1 else 'https://mint.percolator.tech/'
def box(pg, sel):
    pg.wait_for_function(f"document.querySelector('{sel}').innerText.includes('Wallet balance covers') || document.querySelector('{sel}').innerText.includes('Error')", timeout=90000)
    return [l for l in pg.inner_text(sel).splitlines() if l.startswith(('✓','✗','TOTAL','Error','Action'))]
out = {}
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(bypass_csp=True).new_page(); pg.add_init_script(mock); pg.goto(url, wait_until='networkidle')
    pg.click('#connect'); pg.wait_for_function("document.getElementById('wstatus').textContent.includes('Connected')")
    for mode in ['api', 'direct']:
        pg.select_option('#mintMode', mode); pg.click('#mintBtn'); out['mint_'+mode] = box(pg, '#mintQuote')
    pg.check('#mintQuote .approve'); pg.click('#mintQuote .sign'); pg.wait_for_timeout(1500); out['mint_sign_attempt'] = pg.inner_text('#mintQuote .res')
    pg.click('#execStatus'); pg.wait_for_selector('#execOut table'); out['execStatus'] = pg.inner_text('#execOut')
    pg.click('#exec_register'); out['register'] = box(pg, '#execQuote')
    pg.check('#execAck'); pg.click('#exec_both'); out['register_delegate'] = box(pg, '#execQuote')
    pg.click('#exec_revoke'); pg.wait_for_timeout(4000); out['revoke(no record yet)'] = pg.inner_text('#execQuote').splitlines()[:3] + [l for l in pg.inner_text('#execQuote').splitlines() if l.startswith('✗')]
    pg.click('#x402Read'); pg.wait_for_selector('#x402Out table', timeout=60000); out['x402'] = pg.inner_text('#x402Out')
    pg.check('#mechAck'); pg.click('#mechApprove'); pg.wait_for_timeout(1500); out['mech_on_devnet'] = pg.inner_text('#x402Quote')
    pg.click('#x402mRead'); pg.wait_for_selector('#x402mOut table', timeout=60000); out['x402m'] = pg.inner_text('#x402mOut')[:700]
    out['signCalls'] = pg.evaluate('window.__signCalls')
    pg.screenshot(path='test/v2-console.png', full_page=True); b.close()
print(json.dumps(out, indent=1, ensure_ascii=False))
