// Per-run connection knobs (endpoint + slowMo) from env. Capabilities themselves
// come from each project's `use: { capabilities }` and are sent to the orchestrator
// as the x-pwm-capabilities connect header; it pool-matches a free device against
// them. There are no single-env capability fallbacks: multi-device/multi-launch
// runs declare one project per device, so a global env can't address them.

// Per-session container logs uploaded alongside video.mp4. Names match the bridge
// op arg / S3 object basename and become the attached <name>.log filename. Inclusion
// is controlled per type via capabilities.logLevels (e.g. { bridge: 'debug',
// inspector: 'off' }); a level of 'off' drops that log type from reporting. An unset
// level keeps the prior "attach all three" behavior.
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

// Orchestrator WS path per platform; the orchestrator routes /safari to the iOS
// bridge and /playwright to the Android server. Overridable to match a server
// configured with non-default ORCH_*_WS_PATH values.
const WS_PATHS = {
  ios: (process.env.PWM_IOS_WS_PATH || '/safari'),
  android: (process.env.PWM_ANDROID_WS_PATH || '/playwright'),
};

function platformKey(platform) {
  return String(platform || '').toLowerCase() === 'android' ? 'android' : 'ios';
}

// Resolve the orchestrator WS endpoint for a platform. Explicit per-platform env
// (IOS_WS_ENDPOINT / ANDROID_WS_ENDPOINT) wins for back-compat and direct-server
// runs; otherwise it is derived from a single PWM_ORCHESTRATOR base + platform
// path. Empty string means "no farm" (local webkit.launch / ADB devices).
// Capabilities ride the connect header, so any legacy ?query on the endpoint is
// stripped; the orchestrator pool-matches on the header instead.
function resolveWsEndpoint(platform) {
  const key = platformKey(platform);
  const explicit = key === 'android' ? process.env.ANDROID_WS_ENDPOINT : process.env.IOS_WS_ENDPOINT;
  if (explicit) return explicit.split('?')[0];
  const base = (process.env.PWM_ORCHESTRATOR || '').replace(/\/+$/, '');
  if (!base) return '';
  return `${base}${WS_PATHS[key]}`.split('?')[0];
}

// Default for runs that omit per-project capabilities. Real device/farm runs must
// declare platformName (plus deviceName and any osVersion / browsingMode /
// logLevels) in `use: { capabilities }`.
const defaultCapabilities = { platformName: 'iOS' };

function effectiveCapabilities(capabilities) {
  return capabilities || {};
}

// Optional Authorization for an orchestrator behind an auth proxy. Precedence:
// a raw header override, then a bearer token, then basic user/password.
function buildAuthHeader() {
  const explicit = (process.env.PWM_AUTH_HEADER || '').trim();
  if (explicit) return explicit;
  const token = (process.env.PWM_AUTH_TOKEN || '').trim();
  if (token) return `Bearer ${token}`;
  const user = process.env.PWM_AUTH_USER;
  const password = process.env.PWM_AUTH_PASSWORD;
  if (user || password) {
    return `Basic ${Buffer.from(`${user || ''}:${password || ''}`).toString('base64')}`;
  }
  return '';
}

// Orchestrator connect headers: capabilities JSON for pool-matching, the stable
// client id for device-pinning across a reconnect, and optional Authorization.
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

// connect timeout. Must cover a cold container start (orchestrator
// ORCH_HEALTH_START_TIMEOUT) so a reconnect after a wedge can wait out a restart.
const connectTimeoutMs = (() => {
  const raw = parseInt(process.env.PWM_CONNECT_TIMEOUT_MS || process.env.IOS_CONNECT_TIMEOUT_MS || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 120_000;
})();

// Client identity sent as x-pwm-client-id; the orchestrator pins a device to this
// id across a wedge restart. Resolved once at module load so it stays stable for
// the worker's whole lifetime (every per-test reconnect keeps device priority)
// while being unique per worker process. Override with PWM_CLIENT_ID (or the
// legacy IOS_CLIENT_ID) to pin an explicit id (e.g. a shared run id across workers).
const clientId = (() => {
  const explicit = (process.env.PWM_CLIENT_ID || process.env.IOS_CLIENT_ID || '').trim();
  if (explicit) return explicit;
  const worker = (process.env.TEST_WORKER_INDEX || '').trim();
  let rand;
  try {
    rand = require('crypto').randomUUID();
  } catch {
    rand = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
  return worker ? `pwm-w${worker}-${rand}` : `pwm-${rand}`;
})();

module.exports = {
  resolveWsEndpoint,
  buildConnectHeaders,
  defaultCapabilities,
  effectiveCapabilities,
  activeSessionLogs,
  slowMoMs,
  connectTimeoutMs,
  clientId,
};
