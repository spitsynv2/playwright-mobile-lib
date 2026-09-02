'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  defineThrowing,
  defineCaveatWarning,
  blockUnsupportedContextAPIs,
} = require('../src/core/unsupported');

function captureWarnings(fn) {
  const warnings = [];
  const original = console.warn;
  console.warn = (...args) => warnings.push(args.join(' '));
  try {
    fn();
  } finally {
    console.warn = original;
  }
  return warnings;
}

test('defineThrowing installs throwers that name the kind, method, and reason', () => {
  const proto = {};
  defineThrowing(proto, 'Page', { setViewportSize: 'the device owns its viewport' });
  const target = Object.create(proto);
  assert.throws(
    () => target.setViewportSize({ width: 1, height: 1 }),
    /Page\.setViewportSize\(\) is unsupported on this device — the device owns its viewport\./,
  );
});

test('defineThrowing methods are non-writable so a test cannot silently restore them', () => {
  const proto = {};
  defineThrowing(proto, 'Mouse', { wheel: 'no wheel modality' });
  const descriptor = Object.getOwnPropertyDescriptor(proto, 'wheel');
  assert.equal(descriptor.writable, false);
  assert.equal(descriptor.configurable, true);
});

test('blockUnsupportedContextAPIs blocks methods with the BrowserContext kind', () => {
  const context = {};
  blockUnsupportedContextAPIs(context, { cookies: 'shared device cookie jar' });
  assert.throws(() => context.cookies(), /BrowserContext\.cookies\(\) is unsupported on this device/);
});

test('defineCaveatWarning warns once, forwards arguments, and returns the result', () => {
  const proto = {
    addInitScript(script, arg) { return `${script}:${arg}:${this.marker}`; },
  };
  defineCaveatWarning(proto, 'Page', 'addInitScript', 'runs after-load across a cross-origin hop');
  const target = Object.create(proto);
  target.marker = 'self';

  const warnings = captureWarnings(() => {
    assert.equal(target.addInitScript('a', 'b'), 'a:b:self', 'the original still runs with its receiver');
    target.addInitScript('c', 'd');
    target.addInitScript('e', 'f');
  });

  assert.deepEqual(warnings, ['Page.addInitScript() — runs after-load across a cross-origin hop']);
});

test('defineCaveatWarning ignores an absent member and does not double-wrap', () => {
  const proto = { present() { return 'ok'; } };
  assert.doesNotThrow(() => defineCaveatWarning(proto, 'Page', 'missing', 'why'));
  assert.equal('missing' in proto, false);

  defineCaveatWarning(proto, 'Page', 'present', 'why');
  const firstWrap = proto.present;
  defineCaveatWarning(proto, 'Page', 'present', 'why');
  assert.equal(proto.present, firstWrap, 'a second call leaves the single wrapper in place');
});
