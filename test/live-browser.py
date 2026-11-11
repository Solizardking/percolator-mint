# Live-page test with a MOCK wallet that refuses to sign. Nothing is ever signed or sent.
import json, sys
from playwright.sync_api import sync_playwright
def run(url, cluster, payer):
    mock = """window.__signCalls=0;window.phantom={solana:{isPhantom:true,publicKey:{toString:()=>'%s'},connect:async()=>({publicKey:{toString:()=>'%s'}}),signTransaction:async()=>{window.__signCalls++;throw new Error('MOCK WALLET: signing refused (test)')}}};""" % (payer, payer)
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(); pg.add_init_script(mock); pg.goto(url); pg.wait_for_timeout(800)
        if cluster == 'mainnet-beta': pg.check("input[value=mainnet-beta]")
        pg.click("#connect"); pg.wait_for_function("document.getElementById('wstatus').textContent.includes('Connected')")
        pg.click("#quoteBtn"); pg.wait_for_selector("#quote:not([hidden])", timeout=60000); pg.wait_for_timeout(300)
        rows = dict(pg.eval_on_selector_all("#qtable tr", "rs=>rs.map(r=>[r.children[0].textContent,r.children[1].textContent])"))
        checks = pg.eval_on_selector_all("#checks li", "ls=>ls.map(l=>l.textContent)")
        pg.check("#approve"); pg.click("#sign"); pg.wait_for_timeout(1500)
        out = {k: rows.get(k) for k in ['Cluster','Payer / owner','New asset address','Update authority','Asset rent','Agent Identity PDA rent','Network fee','TOTAL cost']}
        out.update(checks=checks, signCalls=pg.evaluate('window.__signCalls'), logTail=pg.text_content('#log').strip().splitlines()[-1], resultShown=pg.is_visible('#result'))
        pg.screenshot(path=f'test/live-{cluster}-quote.png', full_page=True); b.close(); return out
url = sys.argv[1] if len(sys.argv) > 1 else 'https://mint.percolator.tech/'
print(json.dumps({'devnet': run(url, 'devnet', 'CstbLXKvpVDLGcF1enknDUshmg5m2kWAxSkhjiPGkwwq'),
                  'mainnet-beta': run(url, 'mainnet-beta', '5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9')}, indent=1, ensure_ascii=False))
