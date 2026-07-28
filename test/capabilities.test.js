'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { gateFlag, effectiveCapabilities } = require('../src/core/capabilities');

test('resolves booleans unchanged', () => {
  assert.equal(gateFlag(true), true);
  assert.equal(gateFlag(false), false);
});

test('resolves the string forms the orchestrator accepts', () => {
  assert.equal(gateFlag('true'), true);
  assert.equal(gateFlag('TRUE'), true);
  assert.equal(gateFlag(' true '), true);
  assert.equal(gateFlag('1'), true);
  assert.equal(gateFlag('false'), false);
  assert.equal(gateFlag('False'), false);
  assert.equal(gateFlag('0'), false);
});

test('treats unset and unparseable values as unset', () => {
  assert.equal(gateFlag(undefined), undefined);
  assert.equal(gateFlag(null), undefined);
  assert.equal(gateFlag(''), undefined);
  assert.equal(gateFlag('maybe'), undefined);
});

test('accepts every browsing mode the servers recognize', () => {
  for (const mode of ['public', 'private', 'single-tab-public', 'single-tab-private', 'single-tab']) {
    assert.equal(effectiveCapabilities({ platformName: 'iOS', browsingMode: mode }).browsingMode, mode);
  }
  assert.equal(effectiveCapabilities({ browsingMode: ' Private ' }).browsingMode, ' Private ');
});

test('leaves an unset browsing mode to the server default', () => {
  assert.deepEqual(effectiveCapabilities(undefined), {});
  assert.doesNotThrow(() => effectiveCapabilities({ platformName: 'iOS' }));
  assert.doesNotThrow(() => effectiveCapabilities({ browsingMode: '' }));
  assert.doesNotThrow(() => effectiveCapabilities({ browsingMode: undefined }));
});

test('rejects an unknown browsing mode instead of silently defaulting', () => {
  assert.throws(
    () => effectiveCapabilities({ platformName: 'iOS', browsingMode: 'incognito' }),
    /unknown capabilities.browsingMode 'incognito'/,
  );
});
