'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { warnUnsupportedUseOptions } = require('../src/core/use-guard');
const { UNSUPPORTED_USE_OPTIONS: IOS_OPTIONS } = require('../src/platforms/ios/unsupported-ios');
const { UNSUPPORTED_USE_OPTIONS: ANDROID_OPTIONS } = require('../src/platforms/android/unsupported-android');

function captureWarnings(fn) {
  const original = console.warn;
  const lines = [];
  console.warn = (line) => lines.push(String(line));
  try {
    return { result: fn(), lines };
  } finally {
    console.warn = original;
  }
}

test('flags launch options no farm run can honor, on either platform', () => {
  const { result, lines } = captureWarnings(() => warnUnsupportedUseOptions({
    browserName: 'firefox',
    headless: false,
    baseURL: 'https://example.com',
    trace: 'on',
    screenshot: 'only-on-failure',
    testIdAttribute: 'data-qa',
  }, ANDROID_OPTIONS));
  assert.deepEqual(result, ['use.browserName', 'use.headless']);
  assert.equal(lines.length, 2);
  for (const line of lines) assert.match(line, /is ignored on a real device run/);
});

test('iOS flags the context options the bridge cannot honor', () => {
  const { result } = captureWarnings(() => warnUnsupportedUseOptions({
    viewport: { width: 390, height: 844 },
    httpCredentials: { username: 'u', password: 'p' },
    extraHTTPHeaders: { 'x-test': '1' },
    baseURL: 'https://example.com',
  }, IOS_OPTIONS));
  assert.deepEqual(result, ['use.httpCredentials', 'use.viewport']);
});

test('Android accepts the same options because the driver forwards them', () => {
  const { result } = captureWarnings(() => warnUnsupportedUseOptions({
    viewport: { width: 390, height: 844 },
    httpCredentials: { username: 'u', password: 'p' },
    locale: 'en-US',
    geolocation: { latitude: 1, longitude: 2 },
    permissions: ['geolocation'],
  }, ANDROID_OPTIONS));
  assert.deepEqual(result, []);
});

test('Android still flags what the launched context cannot take', () => {
  const { result } = captureWarnings(() => warnUnsupportedUseOptions({
    storageState: 'playwright/.auth/user.json',
    video: 'on',
  }, ANDROID_OPTIONS));
  assert.deepEqual(result, ['use.storageState', 'use.video']);
});

test('reaches into the raw contextOptions escape hatch', () => {
  const { result, lines } = captureWarnings(() => warnUnsupportedUseOptions({
    contextOptions: { reducedMotion: 'reduce', baseURL: 'https://example.com' },
  }, IOS_OPTIONS));
  assert.deepEqual(result, ['use.contextOptions.reducedMotion']);
  assert.match(lines[0], /use\.contextOptions\.reducedMotion/);
});

test('warns once per option but keeps reporting it', () => {
  const first = captureWarnings(() => warnUnsupportedUseOptions({ timezoneId: 'UTC' }, IOS_OPTIONS));
  assert.deepEqual(first.result, ['use.timezoneId']);
  assert.equal(first.lines.length, 1);

  const second = captureWarnings(() => warnUnsupportedUseOptions({ timezoneId: 'CET' }, IOS_OPTIONS));
  assert.deepEqual(second.result, ['use.timezoneId']);
  assert.deepEqual(second.lines, []);
});

test('ignores an absent or explicitly undefined option', () => {
  const { result, lines } = captureWarnings(() => warnUnsupportedUseOptions({ offline: undefined }, IOS_OPTIONS));
  assert.deepEqual(result, []);
  assert.deepEqual(lines, []);
});

test('tolerates a project without `use` and a driver without a table', () => {
  for (const value of [undefined, null, {}, 'nonsense']) {
    assert.deepEqual(warnUnsupportedUseOptions(value, IOS_OPTIONS), []);
  }
  assert.deepEqual(warnUnsupportedUseOptions({ viewport: { width: 1, height: 1 } }), []);
});

test('names an alternative for every flagged option', () => {
  for (const table of [IOS_OPTIONS, ANDROID_OPTIONS]) {
    for (const [key, alternative] of Object.entries(table)) {
      assert.equal(typeof alternative, 'string', `expected an alternative for use.${key}`);
      assert.ok(alternative.length > 0, `expected an alternative for use.${key}`);
    }
  }
});
