// Reports the bridge's per-test session id to Zebrunner. The agent reporter
// registers a Zebrunner test session with that id; farm artifacts (video.mp4,
// session.log) stay on S3 and are not downloaded or uploaded by the test process.
const reportingEnabled = String(process.env.REPORTING_ENABLED).toLowerCase() === 'true';

let currentTest;
let actionWarningEmitted = false;
if (reportingEnabled) {
  try {
    ({ currentTest } = require('@zebrunner/javascript-agent-playwright'));
  } catch (error) {
    const missingModule = error.message && error.message.match(/^Cannot find module '([^']+)'/);
    if (
      error.code !== 'MODULE_NOT_FOUND' ||
      !missingModule ||
      missingModule[1] !== '@zebrunner/javascript-agent-playwright'
    ) {
      throw error;
    }
    console.warn('reporting-agent: Zebrunner reporter package is unavailable; reporting is disabled.');
  }
}

function attachTestSession(sessionId) {
  if (!reportingEnabled || !sessionId || !currentTest) return;
  try {
    currentTest.attachLabel('sessionId', sessionId);
  } catch (err) {
    console.warn(`reporting-agent: failed to attach session to Zebrunner: ${err.message}`);
  }
}

function attachAction(action) {
  if (!isActionReportingAvailable()) return false;
  try {
    currentTest.attachAction(action);
    return true;
  } catch (err) {
    console.warn(`reporting-agent: failed to attach action ${action && action.method}: ${err.message}`);
    return false;
  }
}

function isActionReportingAvailable() {
  const available = reportingEnabled && currentTest && typeof currentTest.attachAction === 'function';
  if (reportingEnabled && currentTest && !available && !actionWarningEmitted) {
    actionWarningEmitted = true;
    console.warn('reporting-agent: installed Zebrunner reporter does not support structured actions.');
  }
  return Boolean(available);
}

// Attach the device session capabilities (Browser/Platform) independently of any video, so
// Zebrunner shows them even when the recording is missing (hang/timeout) or a retry's video
// is not ready. Without a session carrying caps, Zebrunner falls back to "n/a / host OS".
function attachSessionCapabilities(sessionId, capabilities) {
  if (!reportingEnabled || !currentTest || !capabilities) return;
  try {
    currentTest.attachSessionCapabilities(capabilities, sessionId);
  } catch (err) {
    console.warn(`reporting-agent: failed to attach session capabilities session=${sessionId}: ${err.message}`);
  }
}

// Attach a `device:<name>` label so mobile tests are searchable by device in Zebrunner.
function attachDeviceLabel(deviceName) {
  if (!reportingEnabled || !currentTest || !deviceName) return;
  try {
    currentTest.attachLabel('device', deviceName);
  } catch (err) {
    console.warn(`reporting-agent: failed to attach device label: ${err.message}`);
  }
}

function buildSessionCapabilities(platform, deviceInfo = {}) {
  const isAndroid = String(platform || deviceInfo.platformName || '').toLowerCase() === 'android';
  const caps = {
    browserName: isAndroid ? 'Chrome' : 'Safari',
    platformName: deviceInfo.platformName || (isAndroid ? 'Android' : 'iOS'),
  };
  if (deviceInfo.deviceName) caps.deviceName = deviceInfo.deviceName;
  if (deviceInfo.osVersion) caps.platformVersion = deviceInfo.osVersion;
  return caps;
}

module.exports = {
  attachAction,
  isActionReportingAvailable,
  attachTestSession,
  attachSessionCapabilities,
  attachDeviceLabel,
  buildSessionCapabilities,
};
