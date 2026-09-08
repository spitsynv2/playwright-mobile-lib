/** Throw or warn helpers for unsupported and unexpected device APIs. */
const CAVEAT_WRAPPED = Symbol('playwright-mobile-lib.caveat-wrapped');

/** Install methods that throw when a test calls an unsupported API. */
function defineThrowing(target, kind, methods) {
  for (const [name, why] of Object.entries(methods)) {
    Object.defineProperty(target, name, {
      configurable: true,
      writable: false,
      value: () => {
        throw new Error(`${kind}.${name}() is unsupported on this device — ${why}.`);
      },
    });
  }
}

/** Install a one-time warning on a method with unexpected device behavior. */
function defineCaveatWarning(proto, kind, name, why) {
  const original = proto[name];
  if (typeof original !== 'function' || original[CAVEAT_WRAPPED]) return;
  let warned = false;
  const wrapped = function (...args) {
    if (!warned) {
      warned = true;
      console.warn(`${kind}.${name}() — ${why}`);
    }
    return original.apply(this, args);
  };
  Object.defineProperty(wrapped, CAVEAT_WRAPPED, { value: true });
  Object.defineProperty(proto, name, { configurable: true, writable: true, value: wrapped });
}

function blockUnsupportedContextAPIs(context, methods) {
  defineThrowing(context, 'BrowserContext', methods);
}

module.exports = {
  defineThrowing,
  defineCaveatWarning,
  blockUnsupportedContextAPIs,
};
