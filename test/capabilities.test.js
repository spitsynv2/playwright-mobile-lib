'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const { gateFlag } = require('../src/core/capabilities');

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
