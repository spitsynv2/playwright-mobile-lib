'use strict';

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.IOS_WS_ENDPOINT = 'ws://test/safari';

const { installForegroundScreenshotGate } = require('../src/screenshot-gate');

function makePage(screenshot, foreground = true) {
  const proto = { screenshot };
  installForegroundScreenshotGate(proto);
  const page = Object.create(proto);
  page.bridge = { isForeground: async () => foreground };
  return page;
}

async function main() {
  const timeout = new Error('page.screenshot: Timeout 20000ms exceeded.');
  timeout.name = 'TimeoutError';
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-screenshot-gate-'));
  const outputPath = path.join(dir, 'fallback.png');
  const timeoutPage = makePage(async () => { throw timeout; });

  const fallback = await timeoutPage.screenshot({ path: outputPath });
  assert.deepStrictEqual(fs.readFileSync(outputPath), fallback);
  assert.strictEqual(fallback.subarray(1, 4).toString(), 'PNG');

  const failure = new Error('invalid screenshot options');
  const failurePage = makePage(async () => { throw failure; });
  await assert.rejects(() => failurePage.screenshot(), (error) => error === failure);

  let called = false;
  const backgroundPage = makePage(async () => {
    called = true;
    return Buffer.alloc(0);
  }, false);
  const backgroundFallback = await backgroundPage.screenshot();
  assert.strictEqual(called, false);
  assert.strictEqual(backgroundFallback.subarray(1, 4).toString(), 'PNG');

  fs.rmSync(dir, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
