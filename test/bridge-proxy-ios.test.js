'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { ensureAppiumPrototypesPatched } = require('../src/platforms/ios/bridge-proxy');

const SENTINEL = '__pwm_bridge_call__:';

// Builds a fake iOS Safari page with the prototype chain
// ensureAppiumPrototypesPatched probes: Page, its Mouse, BrowserContext, and a
// Locator. `evalImpl` lets a test drive the in-process bridge RPC responses.
function makeIosPage({ evalImpl } = {}) {
  const calls = [];
  let closed = false;
  const newTab = { id: 'reopened-tab' };

  const contextProto = { async addInitScript() { return 'ctx-init'; } };
  const context = Object.create(contextProto);
  context.waitForEvent = async (event) => (event === 'page' ? newTab : null);

  const locatorProto = { page() { return page; } };
  const locator = Object.create(locatorProto);

  const pageProto = {
    async goto(url) { return url; },
    async reload() {},
    async goBack() {},
    async goForward() {},
    async screenshot() { return Buffer.from('\x89PNG\r\n'); },
    async addInitScript() { return 'page-init'; },
    context() { return context; },
    locator() { return locator; },
    async tap(options) { calls.push(['tap', options]); return 'tapped'; },
    async evaluate(payload) {
      const request = JSON.parse(payload.slice(SENTINEL.length));
      calls.push(['evaluate', request.op, request.args]);
      if (evalImpl) return evalImpl(request);
      return { ok: true, op: request.op };
    },
    async waitForTimeout() {},
    isClosed() { return closed; },
    async close() { closed = true; calls.push(['close']); },
  };

  const page = Object.create(pageProto);
  page.mouse = Object.create({});
  return { page, calls, locator };
}

function captureWarnings() {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  return { warnings, restore() { console.warn = original; } };
}

test('a page-invalidating bridge op closes the tab after the call', async () => {
  const { page, calls } = makeIosPage();
  ensureAppiumPrototypesPatched(page);

  const result = await page.bridge.clearSafariHistory();

  assert.deepEqual(result, { ok: true, op: 'clearSafariHistory' });
  assert.equal(page.isClosed(), true, 'the dead-inspector tab is closed so teardown skips it');
  assert.deepEqual(calls[calls.length - 1], ['close']);
});

test('a target-closed error during a page-invalidating op is treated as success', async () => {
  const { page } = makeIosPage({
    evalImpl(request) {
      if (request.op === 'clearSafariHistory') throw new Error('Target page, context or browser has been closed');
      return { ok: true };
    },
  });
  ensureAppiumPrototypesPatched(page);

  assert.equal(await page.bridge.clearSafariHistory(), 'ok');
  assert.equal(page.isClosed(), true);
});

test('a non-invalidating bridge op propagates its error and keeps the page open', async () => {
  const { page } = makeIosPage({
    evalImpl(request) {
      if (request.op === 'brokenOp') throw new Error('boom');
      return { ok: true };
    },
  });
  ensureAppiumPrototypesPatched(page);

  await assert.rejects(() => page.bridge.brokenOp(), /boom/);
  assert.equal(page.isClosed(), false);
});

test('setBrowsingMode returns the freshly adopted tab', async () => {
  const { page, locator } = makeIosPage();
  ensureAppiumPrototypesPatched(page);
  const reopened = await page.setBrowsingMode('public');
  assert.equal(reopened.id, 'reopened-tab');
  assert.ok(locator, 'the locator prototype was probed without error');
});

test('a forced pointer action wraps the call in a hit-test bypass', async () => {
  const { page, calls } = makeIosPage();
  ensureAppiumPrototypesPatched(page);

  await page.tap({ force: true });

  const sequence = calls.map((call) => (call[0] === 'evaluate' ? `bypass:${call[2].on}` : call[0]));
  assert.deepEqual(sequence, ['bypass:true', 'tap', 'bypass:false']);
});

test('an unforced pointer action does not touch the hit-test bypass', async () => {
  const { page, calls } = makeIosPage();
  ensureAppiumPrototypesPatched(page);

  await page.tap({ timeout: 1 });

  assert.deepEqual(calls, [['tap', { timeout: 1 }]]);
});

test('blocked page, locator, and mouse methods throw with an alternative', async () => {
  const { page, locator } = makeIosPage();
  ensureAppiumPrototypesPatched(page);

  assert.throws(() => page.setViewportSize({ width: 1, height: 1 }), /Page\.setViewportSize\(\) is unsupported/);
  assert.throws(() => page.hover('#x'), /Page\.hover\(\) is unsupported/);
  assert.throws(() => page.setInputFiles('#x', []), /Page\.setInputFiles\(\) is unsupported/);
  assert.throws(() => page.mouse.wheel(0, 100), /Mouse\.wheel\(\) is unsupported/);
  assert.throws(() => locator.hover(), /Locator\.hover\(\) is unsupported/);
  assert.throws(() => locator.setInputFiles([]), /Locator\.setInputFiles\(\) is unsupported/);
});

test('addInitScript still runs but warns once about the cross-origin caveat', async () => {
  const { page } = makeIosPage();
  ensureAppiumPrototypesPatched(page);
  const capture = captureWarnings();
  try {
    assert.equal(await page.addInitScript('script'), 'page-init');
    await page.addInitScript('again');
  } finally {
    capture.restore();
  }
  const caveats = capture.warnings.filter((line) => /Page\.addInitScript\(\) —/.test(line));
  assert.equal(caveats.length, 1, 'the caveat warns exactly once');
});
