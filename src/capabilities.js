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

// Capabilities are sent as a connect header now, so any legacy ?device= query on
// the endpoint is stripped; the orchestrator pool-matches on the header instead.
const wsEndpoint = (process.env.IOS_WS_ENDPOINT || '').split('?')[0];

// Default for runs that omit per-project capabilities. Real device/farm runs must
// declare deviceName (plus any osVersion / browsingMode / logLevels) in
// `use: { capabilities }`; platformName is always iOS for this fixture's /safari route.
const defaultCapabilities = { platformName: 'iOS' };

function effectiveCapabilities(capabilities) {
  return capabilities || {};
}

const slowMoMs = (() => {
  const raw = parseInt(process.env.PLAYWRIGHT_SLOW_MO_MS || '', 10);
  return Number.isFinite(raw) && raw >= 0 ? raw : 0;
})();

// webkit.connect timeout. Must cover a cold container start (orchestrator
// ORCH_HEALTH_START_TIMEOUT) so a reconnect after a wedge can wait out a restart.
const connectTimeoutMs = (() => {
  const raw = parseInt(process.env.IOS_CONNECT_TIMEOUT_MS || '', 10);
  return Number.isFinite(raw) && raw > 0 ? raw : 120_000;
})();

// Client identity sent as x-pwm-client-id; the orchestrator pins a device to this
// id across a wedge restart. Resolved once at module load so it stays stable for
// the worker's whole lifetime (every per-test reconnect keeps device priority)
// while being unique per worker process. Override with IOS_CLIENT_ID to pin an
// explicit id (e.g. a shared run id across workers).
const clientId = (() => {
  const explicit = (process.env.IOS_CLIENT_ID || '').trim();
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
  wsEndpoint,
  defaultCapabilities,
  effectiveCapabilities,
  activeSessionLogs,
  slowMoMs,
  connectTimeoutMs,
  clientId,
};
