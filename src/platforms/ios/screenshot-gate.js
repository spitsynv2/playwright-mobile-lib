// Foreground-gated page.screenshot with timeout fallback for the iOS bridge. Playwright's
// screenshot:'on' captures EVERY page in the context at test end via the public
// page.screenshot(); a backgrounded iOS Safari tab can't answer Page.snapshotRect,
// so this gate skips the capture entirely for any non-foreground tab and returns
// a blank instead (the bridge keeps its own visibility gate as a backstop for
// anything that slips through). No-op on local webkit.launch runs (no page.bridge).
const fs = require('fs');
const { resolveWsEndpoint } = require('../../core/capabilities');

// 1x1 PNG returned in place of a real capture for a backgrounded tab.
const BLANK_PNG_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// Worst-case wait for the foreground probe; a foreground tab answers in well
// under this, a dead/background tab times out here instead of hanging teardown.
const FOREGROUND_PROBE_TIMEOUT_MS = 1200;

function blankScreenshot(options) {
  const blank = Buffer.from(BLANK_PNG_BASE64, 'base64');
  if (options && options.path) {
    try { fs.writeFileSync(options.path, blank); } catch {}
  }
  return blank;
}

function isTimeoutError(error) {
  return error?.name === 'TimeoutError' || String(error).startsWith('TimeoutError:');
}

// Resolves true only if this page's Safari tab is confirmed foreground within
// the bound. Any failure/timeout (e.g. a dead background tab that never answers)
// resolves false so the caller skips it. Never throws.
async function isForegroundBounded(page, timeoutMs = FOREGROUND_PROBE_TIMEOUT_MS) {
  try {
    if (typeof page.isClosed === 'function' && page.isClosed()) return false;
    let timer;
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve('__timeout__'), timeoutMs);
    });
    // Swallow a late rejection (e.g. the page/context closing after the race has
    // already timed out) so the abandoned probe never surfaces as an unhandled
    // rejection. The bridge always answers within SnapshotShimTimeout otherwise.
    const probe = page.bridge.isForeground().catch(() => '__error__');
    const res = await Promise.race([probe, timeout]);
    clearTimeout(timer);
    return res === true || res === 'true';
  } catch {
    return false;
  }
}

// Wraps page.screenshot so unavailable iOS captures return a blank PNG.
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
        if (!isTimeoutError(error)) throw error;
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
