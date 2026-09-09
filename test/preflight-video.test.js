'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  normalizeVideoMode,
  shouldCaptureVideo,
  preflightVideoOptions,
  installPreflightVideoCapture,
} = require('../src/core/preflight-video');
const { withConnectEnv } = require('./helpers/connect-env');

function fakeTestInfo(overrides = {}) {
  return {
    retry: 0,
    status: 'passed',
    expectedStatus: 'passed',
    attachments: [],
    outputPath: (name) => `/tmp/pwm-out/${name}`,
    ...overrides,
  };
}

test('normalizeVideoMode maps the string and object forms', () => {
  assert.equal(normalizeVideoMode('on'), 'on');
  assert.equal(normalizeVideoMode({ mode: 'retain-on-failure' }), 'retain-on-failure');
  assert.equal(normalizeVideoMode('retry-with-video'), 'on-first-retry');
  assert.equal(normalizeVideoMode(undefined), 'off');
});

test('shouldCaptureVideo follows the mode and retry index', () => {
  assert.equal(shouldCaptureVideo('on', fakeTestInfo()), true);
  assert.equal(shouldCaptureVideo('retain-on-failure', fakeTestInfo()), true);
  assert.equal(shouldCaptureVideo('on-first-retry', fakeTestInfo({ retry: 0 })), false);
  assert.equal(shouldCaptureVideo('on-first-retry', fakeTestInfo({ retry: 1 })), true);
  assert.equal(shouldCaptureVideo('off', fakeTestInfo()), false);
});

test('preflightVideoOptions returns recordVideo only on a local pre-flight', async () => {
  await withConnectEnv({ PLAYWRIGHT_MOBILE_ORCHESTRATOR_ENDPOINT: 'wss://farm:7465/sessions' }, () => {
    assert.equal(preflightVideoOptions('iOS', { video: 'on' }, {}, fakeTestInfo()), null);
  });
  await withConnectEnv({}, () => {
    const opts = preflightVideoOptions('iOS', { video: 'on' }, {}, fakeTestInfo());
    assert.equal(opts.mode, 'on');
    assert.ok(opts.recordVideo && typeof opts.recordVideo.dir === 'string');

    assert.equal(preflightVideoOptions('iOS', { video: 'off' }, {}, fakeTestInfo()), null);
    assert.equal(
      preflightVideoOptions('iOS', { video: 'on' }, { recordVideo: { dir: 'x' } }, fakeTestInfo()),
      null,
      'an explicit extraContextOptions.recordVideo opts out',
    );
  });
});

test('installPreflightVideoCapture saves and attaches videos after close', async () => {
  const saved = [];
  const page = { video: () => ({ saveAs: async (dest) => saved.push(dest) }) };
  let closed = false;
  const listeners = [];
  const context = {
    on: (event, cb) => { if (event === 'page') listeners.push(cb); },
    close: async () => { closed = true; },
  };
  const testInfo = fakeTestInfo({ status: 'passed', expectedStatus: 'passed' });

  installPreflightVideoCapture(context, testInfo, 'on');
  listeners.forEach((cb) => cb(page));
  await context.close();

  assert.equal(closed, true, 'the original close still runs');
  assert.deepEqual(saved, ['/tmp/pwm-out/video.webm']);
  assert.equal(testInfo.attachments.length, 1);
  assert.equal(testInfo.attachments[0].name, 'video');
  assert.equal(testInfo.attachments[0].contentType, 'video/webm');
});

test('installPreflightVideoCapture does not preserve a passing retain-on-failure video', async () => {
  const saved = [];
  const page = { video: () => ({ saveAs: async (dest) => saved.push(dest) }) };
  const listeners = [];
  const context = {
    on: (event, cb) => { if (event === 'page') listeners.push(cb); },
    close: async () => {},
  };
  const testInfo = fakeTestInfo({ status: 'passed', expectedStatus: 'passed' });

  installPreflightVideoCapture(context, testInfo, 'retain-on-failure');
  listeners.forEach((cb) => cb(page));
  await context.close();

  assert.deepEqual(saved, []);
  assert.equal(testInfo.attachments.length, 0);
});
