// `device.<method>` proxy over the AndroidDevice a farm/ADB run connects as, so
// UIAutomator + adb work shows up in the reported step list like bridge/appium calls.
const { recordAction } = require('../../core/telemetry');

// The reporter validates action kinds against a fixed set and logs an error per
// rejected action; 'fixture' is the only valid kind whose title aliasing cannot
// suppress an unrelated concurrent Playwright step.
const ACTION_KIND = 'fixture';

// Fixture-owned lifecycle: calling these from a test breaks the rest of the worker.
const BLOCKED_METHODS = {
  close: 'the connection is worker-scoped and the fixture closes it at teardown',
  launchBrowser: 'the `context` fixture owns the browser context — use `context` / `page`',
};

// Synchronous members; recording them would hand the caller a promise instead.
const PASSTHROUGH_MEMBERS = new Set([
  'model', 'serial', 'setDefaultTimeout', 'webViews',
  'on', 'once', 'off', 'addListener', 'removeListener', 'prependListener',
]);

// Sub-objects that are themselves an API surface. Everything else (channel and
// connection internals) is handed back untouched.
const PROXIED_NAMESPACES = new Set(['input']);

function makeDeviceProxy(receiver, path = 'device') {
  return new Proxy({}, {
    get(_, prop) {
      if (typeof prop !== 'string') return undefined;
      if (path === 'device' && Object.hasOwn(BLOCKED_METHODS, prop)) {
        return () => {
          throw new Error(`device.${prop}() is not available from a test — ${BLOCKED_METHODS[prop]}.`);
        };
      }
      const target = receiver[prop];
      if (typeof target === 'function') {
        // Object.prototype members must stay synchronous or string coercion breaks.
        if (PASSTHROUGH_MEMBERS.has(prop) || Object.prototype[prop] === target) return target.bind(receiver);
        const methodPath = `${path}.${prop}`;
        return (...args) => recordAction(ACTION_KIND, methodPath, { args }, () => target.apply(receiver, args));
      }
      if (PROXIED_NAMESPACES.has(prop) && target && typeof target === 'object') {
        return makeDeviceProxy(target, `${path}.${prop}`);
      }
      return target;
    },
  });
}

module.exports = { makeDeviceProxy };
