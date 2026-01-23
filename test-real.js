import puppeteer from 'puppeteer';

const DASHBOARD_URL = 'http://100.96.197.39:3420';

async function test() {
  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.goto(DASHBOARD_URL, { waitUntil: 'networkidle2' });

  // Create a session
  await page.evaluate(() => {
    const newTabBtn = document.getElementById('newTabBtn');
    if (newTabBtn) newTabBtn.click();
  });

  // Wait for session to start and theme to be auto-selected
  await new Promise(resolve => setTimeout(resolve, 8000));

  // Take screenshot
  const screenshot = await page.screenshot({ encoding: 'base64' });
  require('fs').writeFileSync('/tmp/claude-real-test.png', Buffer.from(screenshot, 'base64'));
  console.log('Screenshot saved to /tmp/claude-real-test.png');

  // Get terminal text using xterm.js API
  const terminalText = await page.evaluate(() => {
    const terminals = window.terminals || {};
    for (const [id, term] of Object.entries(terminals)) {
      if (term && term.buffer) {
        return term.buffer.getLine(0)?.translateToString(true) || '';
      }
    }
    return '';
  });
  console.log('Terminal first line:', terminalText);

  await browser.close();
}

test().catch(console.error);
