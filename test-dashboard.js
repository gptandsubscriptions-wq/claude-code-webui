import puppeteer from 'puppeteer';
import fs from 'fs';

const DASHBOARD_URL = 'http://100.96.197.39:3420';

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[36m',
  bold: '\x1b[1m'
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logTest(testName, passed) {
  const icon = passed ? '✓' : '✗';
  const color = passed ? 'green' : 'red';
  log(`${icon} ${testName}`, color);
  return passed;
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function testDashboard() {
  log('\n🚀 Starting Claude Code WebUI Browser Tests', 'bold');
  log('=' .repeat(50), 'blue');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu']
  });

  const results = [];

  try {
    // Test 1: Page loads
    log('\n[Test 1] Loading dashboard...', 'blue');
    const page = await browser.newPage();
    await page.goto(DASHBOARD_URL, { waitUntil: 'networkidle2', timeout: 15000 });
    results.push(await logTest('Dashboard page loads', true));

    // Test 2: Check for welcome screen
    log('\n[Test 2] Checking welcome screen...', 'blue');
    const welcomeVisible = await page.evaluate(() => {
      const welcome = document.getElementById('welcomeScreen');
      return welcome && !welcome.classList.contains('hidden');
    });
    results.push(await logTest('Welcome screen is visible', welcomeVisible));

    // Test 3: Create new session
    log('\n[Test 3] Creating new session...', 'blue');
    await page.evaluate(() => {
      const newTabBtn = document.getElementById('newTabBtn');
      if (newTabBtn) newTabBtn.click();
    });
    await sleep(3000); // Wait for session creation

    // Check if tab was created
    const tabCreated = await page.evaluate(() => {
      const tabs = document.querySelectorAll('.tab');
      return tabs.length > 0;
    });
    results.push(await logTest('New tab created', tabCreated));

    // Test 4: Check terminal is visible
    log('\n[Test 4] Checking terminal visibility...', 'blue');
    const terminalVisible = await page.evaluate(() => {
      const terminalView = document.getElementById('terminalView');
      const welcome = document.getElementById('welcomeScreen');
      return terminalView && !terminalView.classList.contains('hidden') &&
             welcome && welcome.classList.contains('hidden');
    });
    results.push(await logTest('Terminal view is visible', terminalVisible));

    // Test 5: Wait for Claude Code to start and check output
    log('\n[Test 5] Waiting for Claude Code to start...', 'blue');
    await sleep(5000); // Give Claude Code time to start

    // Take a screenshot for inspection
    const screenshot1 = await page.screenshot({ encoding: 'base64' });
    fs.writeFileSync('/tmp/claude-dashboard-test-1.png', Buffer.from(screenshot1, 'base64'));
    log('Screenshot saved to /tmp/claude-dashboard-test-1.png', 'yellow');

    // Get terminal content
    const terminalOutput = await page.evaluate(() => {
      // xterm.js renders to canvas, but we can check if terminal exists
      const terminalContainers = document.querySelectorAll('.xterm-container');
      const hasTerminal = terminalContainers.length > 0;

      // Try to get text from terminal rows
      let text = '';
      terminalContainers.forEach(container => {
        const rows = container.querySelectorAll('.xterm-rows');
        rows.forEach(row => {
          text += row.textContent + ' ';
        });
      });

      return {
        hasTerminal,
        text: text.slice(0, 500),
        containerCount: terminalContainers.length
      };
    });

    log(`Terminal containers: ${terminalOutput.containerCount}`, 'blue');
    log(`Terminal text sample: ${terminalOutput.text.slice(0, 200)}`, 'blue');

    // Check if login/setup screen is shown (this should NOT happen)
    const outputLower = terminalOutput.text.toLowerCase();
    const hasLoginScreen = outputLower.includes('press enter') ||
                           outputLower.includes('setup') ||
                           outputLower.includes('login');

    results.push(await logTest('No login/setup screen shown', !hasLoginScreen));
    results.push(await logTest('Terminal containers exist', terminalOutput.hasTerminal));

    // Test 6: Create second session
    log('\n[Test 6] Creating second session...', 'blue');
    await page.evaluate(() => {
      const newTabBtn = document.getElementById('newTabBtn');
      if (newTabBtn) newTabBtn.click();
    });
    await sleep(3000);

    const tabsCount = await page.evaluate(() => {
      return document.querySelectorAll('.tab').length;
    });
    results.push(await logTest('Multiple tabs can be created', tabsCount >= 2));

    // Take final screenshot
    const screenshot2 = await page.screenshot({ encoding: 'base64' });
    fs.writeFileSync('/tmp/claude-dashboard-test-2.png', Buffer.from(screenshot2, 'base64'));
    log('\nFinal screenshot saved to /tmp/claude-dashboard-test-2.png', 'yellow');

    // Test 7: Check health endpoint
    log('\n[Test 7] Checking health endpoint...', 'blue');
    const healthResponse = await page.evaluate(async () => {
      try {
        const response = await fetch('/health');
        const data = await response.json();
        return { ok: response.ok, data };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    });
    results.push(await logTest('Health endpoint works', healthResponse.ok));

    await page.close();

  } catch (error) {
    log(`\n❌ Error during testing: ${error.message}`, 'red');
    console.error(error);
  }

  await browser.close();

  // Summary
  log('\n' + '='.repeat(50), 'blue');
  log('\n📊 Test Summary', 'bold');
  const passed = results.filter(r => r).length;
  const total = results.length;
  log(`${passed}/${total} tests passed`, passed === total ? 'green' : 'yellow');

  if (passed === total) {
    log('\n✨ All tests passed!', 'green');
  } else {
    log('\n⚠️  Some tests failed. Check the screenshots at /tmp/claude-dashboard-test-*.png', 'yellow');
  }

  return passed === total;
}

// Run tests
testDashboard()
  .then(success => {
    process.exit(success ? 0 : 1);
  })
  .catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
