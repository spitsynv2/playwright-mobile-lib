// Per-run connection knobs (endpoint + slowMo) from env. Capabilities themselves
// come from each project's `use: { capabilities }` and are sent to the orchestrator
// as the x-pwm-capabilities connect header; it pool-matches a free device against
// them. There are no single-env capability fallbacks: multi-device/multi-launch
// runs declare one project per device, so a global env can't address them.

// Component sources for the farm's combined session.log. Verbosity is controlled
// per source via capabilities.logLevels (e.g. { bridge: 'debug',
// inspector: 'off' }); a level of 'off' disables that component's configured
// debug logging, though launcher/lifecycle lines may remain. An unset level
// keeps the orchestrator default.
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

function activeSessionLogs(capabilities) {
  const levels = (capabilities && capabilities.logLevels) || {};
  return SESSION_LOG_NAMES.filter((name) => !logLevelOff(name, levels[name]));
}

function platformKey(platform) {
  return String(platform || '').toLowerCase() === 'android' ? 'android' : 'ios';
}

// Endpoint as configured, userinfo included. Explicit per-platform env
// (IOS_WS_ENDPOINT / ANDROID_WS_ENDPOINT) wins for back-compat and direct-server
// runs; otherwise PWM_ORCHESTRATOR is the full session endpoint (e.g.
// wss://host:7465/sessions). Empty string means "no farm" (local webkit.launch /
// ADB devices). Capabilities ride the connect header, so any legacy ?query on
// the endpoint is stripped; the orchestrator pool-matches on the header instead.
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

// Userinfo in the endpoint (wss://user:pass@host) is a convenience form for an
// orchestrator behind a basic-auth proxy; it becomes an Authorization header and
// must never reach Playwright's connect URL.
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

function resolveWsEndpoint(platform) {
  return splitEndpointCredentials(rawWsEndpoint(platform)).endpoint;
}

// Default for runs that omit per-project capabilities. Real device/farm runs must
// declare platformName (plus deviceName / deviceUuid / browsingMode /
// logLevels) in `use: { capabilities }`.
const defaultCapabilities = { platformName: 'iOS' };

const BROWSING_MODES = new Set([
  'public', 'private', 'single-tab-public', 'single-tab-private', 'single-tab',
]);

// The orchestrator and the Android launcher both fall back to their default mode
// on an unrecognized value, so a typo has to fail here to stay visible.
function assertBrowsingMode(value) {
  if (value === undefined || value === null || value === '') return;
  if (BROWSING_MODES.has(String(value).trim().toLowerCase())) return;
  throw new Error(
    `playwright-mobile-lib: unknown capabilities.browsingMode '${value}'. Expected one of `
    + 'public, private, single-tab-public, single-tab-private.',
  );
}

function effectiveCapabilities(capabilities) {
  const caps = capabilities || {};
  assertBrowsingMode(caps.browsingMode);
  return caps;
}

// Gate capabilities ride the connect header, where the orchestrator also accepts
// the quoted 'true'/'false' forms; a local reader must resolve them the same way
// or an env-driven string would land on the wrong branch. undefined = unset.
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

// Optional Authorization for an orchestrator behind an auth proxy. Precedence:
// a raw header override, then a bearer token, then basic user/password, then
// userinfo carried by the endpoint URL.
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

// Orchestrator connect headers: capabilities JSON for pool-matching, the stable
// client id for device-pinning across a reconnect, and optional Authorization.
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

// connect timeout. Must cover a cold container start (orchestrator
// ORCH_HEALTH_START_TIMEOUT) so a reconnect after a wedge can wait out a restart.
const connectTimeoutMs = (() => {
  const raw = parseInt(process.env.PWM_CONNECT_TIMEOUT_MS || process.env.IOS_CONNECT_TIMEOUT_MS || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 120_000;
})();

// TEST_PARALLEL_INDEX + runner PID: stable across worker recycle, unique across concurrent runs.
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
