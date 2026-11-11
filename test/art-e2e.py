# One real art generation through the live page: generate -> browser WebP compression -> Turbo free upload (throwaway signer) -> metadata upload.
import json, sys
from playwright.sync_api import sync_playwright
URL = sys.argv[1] if len(sys.argv) > 1 else "https://mint.percolator.tech/"
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_context(bypass_csp=True).new_page()
    logs = []
    pg.on("console", lambda m: logs.append(m.text))
    pg.goto(URL, wait_until="networkidle")
    pg.wait_for_function("document.getElementById('artBudget').textContent.includes('left')", timeout=20000)
    print("budget:", pg.inner_text("#artBudget"))
    pg.select_option("#artPreset", "badge"); pg.click("#artBtn")
    pg.wait_for_function("!document.getElementById('artUpload').disabled || document.getElementById('artOut').textContent.includes('failed')", timeout=180000)
    print("art:", pg.inner_text("#artOut"))
    if pg.is_disabled("#artUpload"): print(json.dumps(logs[-5:])); sys.exit(1)
    pg.screenshot(path="test/art-generated.png", full_page=False)
    pg.click("#artUpload")
    pg.wait_for_function("document.getElementById('artLinks').textContent.includes('Metadata') || document.getElementById('artLinks').textContent.includes('failed')", timeout=120000)
    print("links:", pg.inner_text("#artLinks")); print("uri field:", pg.input_value("#uri")); print("log:", pg.inner_text("#log"))
    pg.locator("#artOut img").screenshot(path="test/art-image.png")
    b.close()
