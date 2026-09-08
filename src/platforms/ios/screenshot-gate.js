/** Returns a blank PNG when `page.screenshot` cannot capture a background Safari tab. */
const fs = require('fs');
const { resolveWsEndpoint } = require('../../core/capabilities');

const BLANK_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// Bound for the foreground probe. A dead tab times out here, not in teardown.
const FOREGROUND_PROBE_TIMEOUT_MS = 1200;

function blankScreenshot(options) {
  const blank = Buffer.from(BLANK_PNG_BASE64, 'base64');
  if (options && options.path) {
    try { fs.writeFileSync(options.path, blank); } catch {}
  }
  return blank;
}

function isUnavailableScreenshotError(error) {
  const message = error && error.message ? error.message : String(error);
  return error?.name === 'TimeoutError'
    || String(error).startsWith('TimeoutError:')
    || /Target (page, context or browser has been|closed)|has been closed/i.test(message);
}

/**
 * Returns true only when the Safari tab is in the foreground within the bound.
 * A timeout or error returns false. This function does not throw.
 */
async function isForegroundBounded(page, timeoutMs = FOREGROUND_PROBE_TIMEOUT_MS) {
  try {
    if (typeof page.isClosed === 'function' && page.isClosed()) return false;
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve('__timeout__'), timeoutMs);
    });
    // Catch a late probe rejection. An abandoned probe must not reject later.
    const probe = page.bridge.isForeground().catch(() => '__error__');
    const res = await Promise.race([probe, timeout]);
    clearTimeout(timer);
    return res === true || res === 'true';
  } catch {
    return false;
  }
}

/** Gate `page.screenshot`. An unavailable iOS capture returns a blank PNG. */
function installForegroundScreenshotGate(PageProto) {
  const originalScreenshot = PageProto.screenshot;
  if (!resolveWsEndpoint('iOS') || typeof originalScreenshot !== 'function' || originalScreenshot.__iosForegroundGated) {
    return;
  }
  const gated = async function screenshot(options = {}) {
    if (await isForegroundBounded(this)) {
      try {
        return await originalScreenshot.call(this, options);
      } catch (error) {
        if (!isUnavailableScreenshotError(error)) throw error;
        return blankScreenshot(options);
      }
    }
    return blankScreenshot(options);
  };
  gated.__iosForegroundGated = true;
  Object.defineProperty(PageProto, 'screenshot', {
    configurable: true,
    writable: true,
    value: gated,
  });
}

module.exports = { installForegroundScreenshotGate, isForegroundBounded };
