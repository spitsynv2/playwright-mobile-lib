const reporting = require('./reporting');

const sensitiveKeys = new Set([
  'password',
  'passwd',
  'secret',
  'token',
  'accesstoken',
  'refreshtoken',
  'apikey',
  'xapikey',
  'authorization',
  'cookie',
  'setcookie',
  'clientsecret',
]);
const MAX_ACTION_PARAMS_BYTES = 8 * 1024;
let actionSequence = 0;

function isSensitiveKey(key) {
  return sensitiveKeys.has(String(key).toLowerCase().replace(/[^a-z0-9]/g, ''));
}

function summarize(value, depth = 0, seen = new WeakSet()) {
  try {
    if (value === null || value === undefined || typeof value === 'boolean' || typeof value === 'number') return value;
    if (typeof value === 'string') return value.length > 2000 ? `${value.slice(0, 1986)}… [truncated]` : value;
    if (typeof value === 'function') return `[Function ${value.name || 'anonymous'}]`;
    if (typeof value !== 'object') return String(value);
    if (Buffer.isBuffer(value)) return `[Buffer ${value.length} bytes]`;
    if (ArrayBuffer.isView(value)) return `[${value.constructor.name} ${value.byteLength} bytes]`;
    if (value instanceof ArrayBuffer) return `[ArrayBuffer ${value.byteLength} bytes]`;
    if (seen.has(value)) return '[Circular]';
    if (depth >= 4) return '[Object]';
    seen.add(value);
    if (Array.isArray(value)) {
      const values = value.slice(0, 50).map((entry) => summarize(entry, depth + 1, seen));
      if (value.length > values.length) values.push(`[${value.length - values.length} more items]`);
      return values;
    }
    const propertyKeys = Reflect.ownKeys(value);
    const entries = propertyKeys
      .slice(0, 100)
      .map((key) => [String(key), Object.getOwnPropertyDescriptor(value, key)]);
    const result = Object.fromEntries(
      entries
        .filter(([, descriptor]) => descriptor && 'value' in descriptor && typeof descriptor.value !== 'function')
        .map(([key, descriptor]) => [
          key,
          isSensitiveKey(key) ? '[REDACTED]' : summarize(descriptor.value, depth + 1, seen),
        ]),
    );
    const accessorKeys = entries
      .filter(([, descriptor]) => descriptor && !('value' in descriptor))
      .map(([key]) => key);
    for (const key of accessorKeys) result[key] = '[Accessor]';
    const propertyCount = propertyKeys.length;
    if (propertyCount > entries.length) {
      result.__truncated__ = `${propertyCount - entries.length} more properties`;
    }
    return result;
  } catch {
    return '[Unserializable]';
  }
}

function boundPayload(value, maxBytes = MAX_ACTION_PARAMS_BYTES) {
  try {
    const serialized = JSON.stringify(value);
    if (!serialized || Buffer.byteLength(serialized) <= maxBytes) return value;
    return {
      truncated: true,
      originalBytes: Buffer.byteLength(serialized),
      preview: `${serialized.slice(0, Math.floor(maxBytes / 2))}… [truncated]`,
    };
  } catch {
    return '[Unserializable]';
  }
}

function captureSource() {
  const stack = new Error().stack || '';
  for (const line of stack.split('\n').slice(1)) {
    const match = line.match(/\((.+):(\d+):(\d+)\)$/) || line.match(/\s+at (.+):(\d+):(\d+)$/);
    if (!match) continue;
    const file = match[1].replace(/^async\s+/, '');
    if (file.includes('/playwright-mobile-lib/src/') || file.startsWith('node:') || file.includes('/node_modules/')) continue;
    return { file, line: Number(match[2]), column: Number(match[3]) };
  }
  return undefined;
}

function sanitizeUrl(value) {
  if (typeof value !== 'string') return value;
  try {
    const url = new URL(value);
    if (url.username) url.username = '[REDACTED]';
    if (url.password) url.password = '[REDACTED]';
    for (const key of url.searchParams.keys()) {
      if (isSensitiveKey(key)) url.searchParams.set(key, '[REDACTED]');
    }
    url.pathname = url.pathname.replace(
      /(\/basic-auth\/)[^/]+\/[^/]+/i,
      '$1[REDACTED]/[REDACTED]',
    );
    return url.toString();
  } catch {
    return value.replace(
      /([?&](?:password|secret|token|access[_-]?token|api[_-]?key)=)[^&#\s]+/gi,
      '$1[REDACTED]',
    );
  }
}

function sanitizeMethodParams(method, params) {
  const safe = summarize(params);
  if (!safe || typeof safe !== 'object') return safe;
  if (method === 'page.goto' && typeof safe.url === 'string') {
    safe.url = sanitizeUrl(safe.url);
  }
  if (method === 'page.bridge.nativeInput' && Array.isArray(safe.actions)) {
    safe.actions = safe.actions.map((entry) => {
      if (!entry || typeof entry !== 'object' || !/^(fill|type)$/i.test(entry.type)) return entry;
      return { ...entry, value: entry.value === undefined ? undefined : '[REDACTED]' };
    });
  }
  if (
    /\.appium\.(?:.*\.)?(?:fill|type|insertText|pressSequentially)$/i.test(method) &&
    Array.isArray(safe.args)
  ) {
    const pageSelectorMethod = /^page\.appium\.(?:fill|type)$/i.test(method);
    const sensitiveIndex = pageSelectorMethod ? 1 : 0;
    safe.args = safe.args.map((entry, index) => (index === sensitiveIndex ? '[REDACTED]' : entry));
  }
  return boundPayload(safe);
}

function emitAction(action) {
  try {
    reporting.attachAction(action);
  } catch {}
}

async function recordAction(kind, method, params, action) {
  const startedAt = Date.now();
  let reportingAvailable = false;
  try {
    reportingAvailable = reporting.isActionReportingAvailable();
  } catch {}
  const id = `pwm-${process.pid}-${startedAt}-${++actionSequence}`;
  let source;
  let safeParams;
  if (reportingAvailable) {
    try {
      source = captureSource();
      safeParams = sanitizeMethodParams(method, params);
    } catch {
      safeParams = '[Unserializable]';
    }
    emitAction({ id, kind, method, params: safeParams, startedAt, status: 'started', source });
  }
  try {
    const result = await action();
    if (reportingAvailable) {
      emitAction({ id, kind, method, startedAt, endedAt: Date.now(), status: 'passed' });
    }
    return result;
  } catch (error) {
    if (reportingAvailable) {
      emitAction({
        id,
        kind,
        method,
        startedAt,
        endedAt: Date.now(),
        status: 'failed',
        error: summarize(error && error.stack ? error.stack : String(error)),
      });
    }
    throw error;
  }
}

module.exports = { boundPayload, captureSource, recordAction, sanitizeMethodParams, summarize };
