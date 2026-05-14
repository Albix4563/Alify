const { spawn } = require('child_process');
const { chromium } = require('playwright');
const fs = require('fs');

const port = 3120;
const resultPath = 'tmp_page_smoke_result.json';
let finished = false;

function finish(server, code, result) {
  if (finished) return;
  finished = true;
  fs.writeFileSync(resultPath, JSON.stringify(result, null, 2));
  try { server.kill('SIGTERM'); } catch {}
  setTimeout(() => {
    try { server.kill('SIGKILL'); } catch {}
    process.exit(code);
  }, 1000);
}

const server = spawn('npm', ['run', 'dev', '--', '--port', String(port)], {
  cwd: process.cwd(),
  shell: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});

let logs = '';
server.stdout.on('data', (chunk) => {
  logs += String(chunk);
});
server.stderr.on('data', (chunk) => {
  logs += String(chunk);
});

async function waitForReady() {
  const started = Date.now();
  while (Date.now() - started < 45000) {
    if (/Ready in|Local:|ready/i.test(logs)) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error('dev server did not become ready');
}

(async () => {
  try {
    await waitForReady();
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const pageErrors = [];
    const consoleErrors = [];

    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    const response = await page.goto('http://127.0.0.1:' + port + '/', {
      waitUntil: 'networkidle',
      timeout: 30000,
    });
    const bodyText = await page.locator('body').innerText({ timeout: 10000 });
    const hasGlobalError = /Something went wrong|Try again/i.test(bodyText);
    await browser.close();

    finish(server, hasGlobalError || pageErrors.length ? 1 : 0, {
      status: response ? response.status() : null,
      hasGlobalError,
      bodyStart: bodyText.slice(0, 300),
      pageErrors,
      consoleErrors: consoleErrors.slice(0, 10),
    });
  } catch (error) {
    finish(server, 1, {
      error: error && error.message ? error.message : String(error),
      serverLogs: logs.slice(-2000),
    });
  }
})();
