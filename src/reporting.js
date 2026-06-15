// Reports the bridge's per-test session id to Zebrunner. The agent reporter uses
// that id to presign video/log artifacts through the orchestrator after contexts
// close and the farm uploader has published the objects, so no AWS creds are
// shared with the test process.
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

// Hand a presigned URL to the agent reporter. The current fixture normally lets
// the reporter resolve URLs by session id through the orchestrator; this helper
// remains for callers that already have a URL.
function attachVideoUrl(sessionId, presignedUrl, capabilities) {
  if (!reportingEnabled || !currentTest || !sessionId || !presignedUrl) return;
  try {
    currentTest.attachVideoUrl(presignedUrl, sessionId, capabilities);
    //console.log(`reporting-agent: registered video url session=${sessionId} urlLen=${presignedUrl.length}`);
  } catch (err) {
    console.warn(`reporting-agent: failed to register video url session=${sessionId}: ${err.message}`);
  }
}

// Register a per-session container-log artifact (bridge / Playwright server / inspector proxy).
// The log slice rides the same S3 upload rail as video; the agent reporter downloads the
// presigned URL in onTestEnd and uploads the actual file (no AWS creds / download in the test
// process), so it shows up as a downloadable artifact instead of a clickable link.
function attachLogUrl(name, presignedUrl) {
  if (!reportingEnabled || !currentTest || !name || !presignedUrl) return;
  try {
    currentTest.attachLogUrl(name, presignedUrl);
  } catch (err) {
    console.warn(`reporting-agent: failed to register log url ${name}: ${err.message}`);
  }
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

function buildIOSCapabilities(deviceInfo = {}) {
  const caps = {
    browserName: 'Safari',
    platformName: deviceInfo.platformName || 'iOS',
  };
  if (deviceInfo.deviceName) caps.deviceName = deviceInfo.deviceName;
  if (deviceInfo.osVersion) caps.browserVersion = deviceInfo.osVersion;
  return caps;
}

module.exports = {
  attachAction,
  isActionReportingAvailable,
  attachTestSession,
  attachSessionCapabilities,
  attachVideoUrl,
  attachLogUrl,
  buildIOSCapabilities,
};
