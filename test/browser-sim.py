# Headless browser test of the page on DEVNET with a MOCK wallet that can never sign.
import subprocess, time, sys, json
from playwright.sync_api import sync_playwright
PAYER = "CstbLXKvpVDLGcF1enknDUshmg5m2kWAxSkhjiPGkwwq"  # public devnet address; simulation only
srv = subprocess.Popen([sys.executable, "-m", "http.server", "8765", "-d", "public"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(1)
mock = """
window.__signCalls = 0;
window.phantom = { solana: {
  isPhantom: true, publicKey: { toString: () => '%s' },
  connect: async () => ({ publicKey: { toString: () => '%s' } }),
  signTransaction: async () => { window.__signCalls++; throw new Error('MOCK WALLET: signing refused (test)'); }
}};""" % (PAYER, PAYER)
try:
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(); pg.add_init_script(mock)
        pg.goto("http://127.0.0.1:8765/index.html"); pg.wait_for_timeout(800)
        pg.click("#connect"); pg.wait_for_function("document.getElementById('wstatus').textContent.includes('Connected')")
        pg.click("#quoteBtn"); pg.wait_for_selector("#quote:not([hidden])", timeout=60000); pg.wait_for_timeout(300)
        rows = pg.eval_on_selector_all("#qtable tr", "rs=>rs.map(r=>[r.children[0].textContent,r.children[1].textContent])")
        checks = pg.eval_on_selector_all("#checks li", "ls=>ls.map(l=>l.textContent)")
        pg.check("#approve"); pg.click("#sign"); pg.wait_for_timeout(1500)
        print(json.dumps({"rows": rows, "checks": checks, "signCalls": pg.evaluate("window.__signCalls"),
                          "log": pg.text_content("#log"), "resultShown": pg.is_visible("#result")}, indent=1))
        pg.screenshot(path="test/devnet-quote.png", full_page=True); b.close()
finally:
    srv.terminate()
