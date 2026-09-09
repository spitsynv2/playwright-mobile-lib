/** Resolve farm connection settings and connect headers from environment and capabilities. */
const SESSION_LOG_NAMES = ['bridge', 'pwserver', 'inspector'];
const VALID_LOG_LEVELS = new Set(['off', 'fatal', 'error', 'warn', 'info', 'debug', 'trace']);

function logLevelOff(name, level) {
  if (level === undefined || level === null || level === '') return false;
  const v = String(level).trim().toLowerCase();
  if (!VALID_LOG_LEVELS.has(v)) {
    console.warn(`reporting-agent: unknown logLevels.${name}='${level}', treating as on`);
    return false;
  }
  return v === 'off';
}

/** Return session log names that are not set to off. Launcher lines can still appear. */
function activeSessionLogs(capabilities) {
  const levels = (capabilities && capabilities.logLevels) || {};
  return SESSION_LOG_NAMES.filter((name) => !logLevelOff(name, levels[name]));
}

// Strip a query string. An empty value means no farm.
function rawWsEndpoint() {
  return (process.env.PLAYWRIGHT_MOBILE_ORCHESTRATOR_ENDPOINT || '').split('?')[0];
}

function decodeUserinfo(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

// Move URL userinfo into Authorization. Playwright connect must not receive credentials.
function splitEndpointCredentials(endpoint) {
  const empty = { endpoint: endpoint || '', username: '', password: '' };
  if (!endpoint) return empty;
  let parsed;
  try {
    parsed = new URL(endpoint);
  } catch {
    return empty;
  }
  if (!parsed.username && !parsed.password) return empty;
  const username = decodeUserinfo(parsed.username);
  const password = decodeUserinfo(parsed.password);
  parsed.username = '';
  parsed.password = '';
  return { endpoint: parsed.toString(), username, password };
}

/** Return the remote WebSocket endpoint without credentials. */
function resolveWsEndpoint() {
  return splitEndpointCredentials(rawWsEndpoint()).endpoint;
}

// Do not add env fallbacks for capabilities. Each project declares its own device.
const defaultCapabilities = { platformName: 'iOS' };

const BROWSING_MODES = new Set([
  'public', 'private', 'single-tab-public', 'single-tab-private', 'single-tab',
]);

// Reject an unknown browsingMode. The orchestrator silently uses its default for a bad value.
function assertBrowsingMode(value) {
  if (value === undefined || value === null || value === '') return;
  if (BROWSING_MODES.has(String(value).trim().toLowerCase())) return;
  throw new Error(
    `playwright-mobile-lib: unknown capabilities.browsingMode '${value}'. Expected one of `
    + 'public, private, single-tab-public, single-tab-private.',
  );
}

// Reject a negative or non-integer sessionIdleTimeoutMs. The orchestrator drops an invalid value.
function assertSessionIdleTimeoutMs(value) {
  if (value === undefined || value === null) return;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(
      'playwright-mobile-lib: capabilities.sessionIdleTimeoutMs must be a non-negative integer of '
      + `milliseconds (0 disables the orchestrator idle timeout), got ${JSON.stringify(value)}.`,
    );
  }
}

function effectiveCapabilities(capabilities) {
  const caps = capabilities || {};
  assertBrowsingMode(caps.browsingMode);
  assertSessionIdleTimeoutMs(caps.sessionIdleTimeoutMs);
  return caps;
}

// Parse boolean and the quoted true or false forms. Match the orchestrator.
function gateFlag(value) {
  if (typeof value === 'boolean') return value;
  const v = String(value === undefined || value === null ? '' : value).trim().toLowerCase();
  if (v === 'true' || v === '1') return true;
  if (v === 'false' || v === '0') return false;
  return undefined;
}

function basicAuthHeader(user, password) {
  return `Basic ${Buffer.from(`${user || ''}:${password || ''}`).toString('base64')}`;
}

/** Build an optional Authorization header from endpoint userinfo. */
function buildAuthHeader() {
  const fromUrl = splitEndpointCredentials(rawWsEndpoint());
  if (fromUrl.username || fromUrl.password) {
    return basicAuthHeader(fromUrl.username, fromUrl.password);
  }
  return '';
}

/** Build orchestrator connect headers from capabilities and optional auth. */
function buildConnectHeaders(capabilities, id = clientId) {
  const headers = { 'x-pwm-capabilities': JSON.stringify(effectiveCapabilities(capabilities)) };
  if (id) headers['x-pwm-client-id'] = id;
  const authorization = buildAuthHeader();
  if (authorization) headers['Authorization'] = authorization;
  return headers;
}

const slowMoMs = (() => {
  const raw = parseInt(process.env.PLAYWRIGHT_SLOW_MO_MS || '', 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
})();

// Must cover a cold container start. A reconnect can wait for a restart.
const connectTimeoutMs = (() => {
  const raw = parseInt(
    process.env.PLAYWRIGHT_MOBILE_CONNECT_TIMEOUT_MS || process.env.IOS_CONNECT_TIMEOUT_MS || '',
    10,
  );
  return Number.isFinite(raw) && raw > 0 ? raw : 120_000;
})();

/** Build a client id that stays stable across a worker recycle. */
function resolveClientId(env = process.env, ppid = process.ppid) {
  const explicit = (env.PLAYWRIGHT_MOBILE_CLIENT_ID || env.IOS_CLIENT_ID || '').trim();
  if (explicit) return explicit;
  const parallel = (env.TEST_PARALLEL_INDEX || '').trim();
  if (parallel !== '') return `pwm-p${parallel}-r${ppid}`;
  let rand;
  try {
    rand = require('crypto').randomUUID();
  } catch {
    rand = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  const worker = (env.TEST_WORKER_INDEX || '').trim();
  return worker ? `pwm-w${worker}-${rand}` : `pwm-${rand}`;
}

const clientId = resolveClientId();

module.exports = {
  resolveWsEndpoint,
  buildConnectHeaders,
  defaultCapabilities,
  effectiveCapabilities,
  gateFlag,
  activeSessionLogs,
  slowMoMs,
  connectTimeoutMs,
  clientId,
  resolveClientId,
};
