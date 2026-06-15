'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const reporting = require('../src/reporting');
const { makeAppiumProxy } = require('../src/appium');
const { ensureAppiumPrototypesPatched, makeBridgeProxy } = require('../src/bridge-proxy');
const { recordAction, sanitizeMethodParams, summarize } = require('../src/telemetry');

const originalAttachAction = reporting.attachAction;
const originalAvailability = reporting.isActionReportingAvailable;

test.beforeEach(() => {
  reporting.isActionReportingAvailable = () => true;
});

test.afterEach(() => {
  reporting.attachAction = originalAttachAction;
  reporting.isActionReportingAvailable = originalAvailability;
});

test('records successful and failed actions with runtime parameters', async () => {
  const actions = [];
  reporting.attachAction = (action) => actions.push(action);

  assert.equal(await recordAction('fixture', 'fixture.ready', { value: 7 }, async () => 'ok'), 'ok');
  await assert.rejects(
    recordAction('bridge', 'page.bridge.fail', { password: 'secret' }, async () => {
      throw new Error('failed');
    }),
    /failed/,
  );

  assert.equal(actions.length, 4);
  assert.equal(actions[0].status, 'started');
  assert.deepEqual(actions[0].params, { value: 7 });
  assert.equal(actions[1].method, 'fixture.ready');
  assert.equal('params' in actions[1], false);
  assert.match(actions[0].source.file, /telemetry\.test\.js$/);
  assert.equal(actions[3].status, 'failed');
  assert.match(actions[3].error, /failed/);
});

test('summarizes circular and oversized parameters safely', () => {
  const value = { text: 'x'.repeat(2100) };
  value.self = value;
  const result = summarize(value);
  assert.match(result.text, /truncated/);
  assert.equal(result.self, '[Circular]');
  assert.equal(summarize(Buffer.alloc(1024 * 1024)), '[Buffer 1048576 bytes]');
  const bounded = sanitizeMethodParams('page.bridge.large', {
    values: Array.from({ length: 50 }, (_, index) => `${index}:${'x'.repeat(2000)}`),
  });
  assert.equal(bounded.truncated, true);
  assert.equal(JSON.stringify(bounded).length < 5000, true);
});

test('redacts method-specific input values and authentication URLs', () => {
  assert.deepEqual(
    sanitizeMethodParams('page.bridge.nativeInput', {
      actions: [{ type: 'fill', value: 'pass_123', xpath: '//SecureTextField' }],
    }),
    { actions: [{ type: 'fill', value: '[REDACTED]', xpath: '//SecureTextField' }] },
  );
  assert.deepEqual(
    sanitizeMethodParams('locator.appium.fill', { args: ['pass_123', { timeout: 10 }] }),
    { args: ['[REDACTED]', { timeout: 10 }] },
  );
  assert.deepEqual(
    sanitizeMethodParams('page.appium.fill', { args: ['#password', 'pass_123', { timeout: 10 }] }),
    { args: ['#password', '[REDACTED]', { timeout: 10 }] },
  );
  assert.deepEqual(
    sanitizeMethodParams('page.appium.keyboard.insertText', { args: ['pass_123'] }),
    { args: ['[REDACTED]'] },
  );
  assert.equal(
    sanitizeMethodParams('page.goto', { url: 'https://httpbin.org/basic-auth/user/pass' }).url,
    'https://httpbin.org/basic-auth/[REDACTED]/[REDACTED]',
  );
});

test('telemetry serialization cannot change a successful action result', async () => {
  const actions = [];
  reporting.attachAction = (action) => actions.push(action);
  const hostile = {};
  let getterCalls = 0;
  Object.defineProperty(hostile, 'value', {
    enumerable: true,
    get() {
      getterCalls += 1;
      throw new Error('getter failed');
    },
  });

  assert.equal(await recordAction('bridge', 'page.bridge.safe', hostile, async () => 'result'), 'result');
  assert.deepEqual(actions[0].params, { value: '[Accessor]' });
  assert.equal(actions[1].status, 'passed');
  assert.equal(getterCalls, 0);
});

test('reports bridge and Appium proxy methods at their public abstraction', async () => {
  const actions = [];
  reporting.attachAction = (action) => actions.push(action);
  const page = {
    evaluate: async (payload) => {
      const request = JSON.parse(payload.split(':').slice(1).join(':'));
      return request.op === 'setInputMode' ? 'js' : { ok: true };
    },
    waitForTimeout: async () => {},
  };

  assert.deepEqual(await makeBridgeProxy(page).getSessionId({ detail: true }), { ok: true });
  const receiver = { click: async (options) => options };
  assert.deepEqual(await makeAppiumProxy(receiver, page, 'locator.appium').click({ force: true }), { force: true });

  const completed = actions.filter((action) => action.status === 'passed');
  assert.equal(completed[0].method, 'page.bridge.getSessionId');
  assert.equal(completed[1].method, 'locator.appium.click');
});

test('enriches page navigation with its full runtime URL and options', async () => {
  const actions = [];
  reporting.attachAction = (action) => actions.push(action);
  const contextProto = { addInitScript: async () => {} };
  const context = Object.create(contextProto);
  context.waitForEvent = async () => ({});
  const mouse = Object.create({});
  const locatorProto = {
    page() {
      return page;
    },
  };
  const locator = Object.create(locatorProto);
  const pageProto = {
    goto: async (url) => url,
    reload: async () => {},
    goBack: async () => {},
    goForward: async () => {},
    screenshot: async () => Buffer.alloc(0),
    addInitScript: async () => {},
    context: () => context,
    locator: () => locator,
  };
  const page = Object.create(pageProto);
  page.mouse = mouse;

  ensureAppiumPrototypesPatched(page);
  ensureAppiumPrototypesPatched(page);
  const result = await page.goto('https://example.com/', { waitUntil: 'domcontentloaded' });

  assert.equal(result, 'https://example.com/');
  const navigation = actions.find((action) => action.method === 'page.goto' && action.status === 'started');
  assert.deepEqual(navigation.params, {
    url: 'https://example.com/',
    options: { waitUntil: 'domcontentloaded' },
  });
  assert.equal(actions.filter((action) => action.method === 'page.goto' && action.status === 'passed').length, 1);
});
