'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const driver = require('../src/platforms/android/driver');

test('parseChromiumVersions reads the Android and Chrome versions Playwright reports', () => {
  // A real Chromium preset UA. The Android token is frozen per device model and
  // the Chrome token tracks the bundled Chromium, so the pre-flight versions
  // must be derived from this string rather than hard-coded.
  const ua = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/145.0.7632.6 Mobile Safari/537.36';
  assert.deepEqual(driver.parseChromiumVersions(ua), {
    osVersion: '14',
    browserVersion: '145.0.7632.6',
  });
});

test('parseChromiumVersions handles a dotted Android version', () => {
  const ua = 'Mozilla/5.0 (Linux; Android 8.0.0; SM-G965U Build/R16NW) AppleWebKit/537.36 '
    + '(KHTML, like Gecko) Chrome/145.0.7632.6 Mobile Safari/537.36';
  assert.deepEqual(driver.parseChromiumVersions(ua), {
    osVersion: '8.0.0',
    browserVersion: '145.0.7632.6',
  });
});

test('parseChromiumVersions returns empty strings for a missing or unparsable user agent', () => {
  assert.deepEqual(driver.parseChromiumVersions(undefined), { osVersion: '', browserVersion: '' });
  assert.deepEqual(driver.parseChromiumVersions('not a ua'), { osVersion: '', browserVersion: '' });
});
