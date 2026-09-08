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

function platformKey(platform) {
  return String(platform || '').toLowerCase() === 'android' ? 'android' : 'ios';
}

// Platform env wins over PWM_ORCHESTRATOR. Strip a query string. An empty value means no farm.
function rawWsEndpoint(platform) {
  const key = platformKey(platform);
  const explicit = key === 'android' ? process.env.ANDROID_WS_ENDPOINT : process.env.IOS_WS_ENDPOINT;
  if (explicit) return explicit.split('?')[0];
  return (process.env.PWM_ORCHESTRATOR || '').split('?')[0];
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

/** Return the farm WebSocket endpoint for a platform without credentials. */
function resolveWsEndpoint(platform) {
  return splitEndpointCredentials(rawWsEndpoint(platform)).endpoint;
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

// Reject a negative or non-integer idleTimeoutMs. The orchestrator drops an invalid value.
function assertIdleTimeoutMs(value) {
  if (value === undefined || value === null) return;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new Error(
      'playwright-mobile-lib: capabilities.idleTimeoutMs must be a non-negative integer of '
      + `milliseconds (0 disables the orchestrator idle timeout), got ${JSON.stringify(value)}.`,
    );
  }
}

function effectiveCapabilities(capabilities) {
  const caps = capabilities || {};
  assertBrowsingMode(caps.browsingMode);
  assertIdleTimeoutMs(caps.idleTimeoutMs);
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

/**
 * Build an optional Authorization header for an auth proxy.
 * Precedence: PWM_AUTH_HEADER, then PWM_AUTH_TOKEN, then user and password, then URL userinfo.
 */
function buildAuthHeader(platform) {
  const explicit = (process.env.PWM_AUTH_HEADER || '').trim();
  if (explicit) return explicit;
  const token = (process.env.PWM_AUTH_TOKEN || '').trim();
  if (token) return `Bearer ${token}`;
  const user = process.env.PWM_AUTH_USER;
  const password = process.env.PWM_AUTH_PASSWORD;
  if (user || password) {
    return basicAuthHeader(user, password);
  }
  const fromUrl = splitEndpointCredentials(rawWsEndpoint(platform));
  if (fromUrl.username || fromUrl.password) {
    return basicAuthHeader(fromUrl.username, fromUrl.password);
  }
  return '';
}

/** Build orchestrator connect headers from capabilities and optional auth. */
function buildConnectHeaders(capabilities, platform, id = clientId) {
  const headers = { 'x-pwm-capabilities': JSON.stringify(effectiveCapabilities(capabilities)) };
  if (id) headers['x-pwm-client-id'] = id;
  const authorization = buildAuthHeader(platform);
  if (authorization) headers['Authorization'] = authorization;
  return headers;
}

const slowMoMs = (() => {
  const raw = parseInt(process.env.PLAYWRIGHT_SLOW_MO_MS || '', 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
})();

// Must cover a cold container start. A reconnect can wait for a restart.
const connectTimeoutMs = (() => {
  const raw = parseInt(process.env.PWM_CONNECT_TIMEOUT_MS || process.env.IOS_CONNECT_TIMEOUT_MS || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 120_000;
})();

/** Build a client id that stays stable across a worker recycle. */
function resolveClientId(env = process.env, ppid = process.ppid) {
  const explicit = (env.PWM_CLIENT_ID || env.IOS_CLIENT_ID || '').trim();
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
