/** Report the farm session id to Zebrunner. Farm artifacts stay on S3. */
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

/** Attach device capabilities to the Zebrunner session even when video is missing. */
function attachSessionCapabilities(sessionId, capabilities) {
  if (!reportingEnabled || !currentTest || !capabilities) return;
  try {
    currentTest.attachSessionCapabilities(capabilities, sessionId);
  } catch (err) {
    console.warn(`reporting-agent: failed to attach session capabilities session=${sessionId}: ${err.message}`);
  }
}

/** Attach a device label for Zebrunner device search. */
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
  if (deviceInfo.browserVersion) caps.browserVersion = deviceInfo.browserVersion;
  return caps;
}

module.exports = {
  attachAction,
  isActionReportingAvailable,
  attachSessionCapabilities,
  attachDeviceLabel,
  buildSessionCapabilities,
};
