/** AndroidDevice proxy that records UIAutomator and ADB calls as fixture steps. */
const { recordAction } = require('../../core/telemetry');

// Use fixture as the action kind. The reporter rejects other kinds.
const ACTION_KIND = 'fixture';

// These methods belong to the fixture. A test must not call them.
const BLOCKED_METHODS = {
  close: 'the connection is worker-scoped and the fixture closes it at teardown',
  launchBrowser: 'the `context` fixture owns the browser context — use `context` / `page`',
};

// These members are synchronous. recordAction would return a promise instead.
const PASSTHROUGH_MEMBERS = new Set([
  'model', 'serial', 'setDefaultTimeout', 'webViews',
  'on', 'once', 'off', 'addListener', 'removeListener', 'prependListener',
]);

// Nested API surfaces. Other members pass through without a proxy.
const PROXIED_NAMESPACES = new Set(['input']);

/**
 * Returns a device proxy that records AndroidDevice calls as fixture steps.
 */
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
        // Object.prototype members must stay synchronous. String coercion fails otherwise.
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
