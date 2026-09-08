/** Records and attaches a page video on a local pre-flight run. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveWsEndpoint } = require('./capabilities');

// Match Playwright's use.video modes. A device run has no local video; the farm records it.
function normalizeVideoMode(video) {
  const mode = typeof video === 'string' ? video : video && video.mode;
  if (mode === 'retry-with-video') return 'on-first-retry';
  return mode || 'off';
}

function shouldCaptureVideo(mode, testInfo) {
  if (!testInfo) return false;
  return mode === 'on'
    || mode === 'retain-on-failure'
    || (mode === 'on-first-retry' && testInfo.retry === 1);
}

function shouldPreserveVideo(mode, testInfo) {
  const failed = testInfo.status !== testInfo.expectedStatus;
  return mode === 'on'
    || (mode === 'retain-on-failure' && failed)
    || (mode === 'on-first-retry' && testInfo.retry === 1);
}

/**
 * Returns { mode, recordVideo } for a local pre-flight, or null.
 * A farm run and an explicit extraContextOptions.recordVideo both opt out.
 */
function preflightVideoOptions(platform, useOptions, extraContextOptions, testInfo) {
  if (resolveWsEndpoint(platform)) return null;
  if (extraContextOptions && extraContextOptions.recordVideo) return null;
  const video = (useOptions || {}).video;
  const mode = normalizeVideoMode(video);
  if (!shouldCaptureVideo(mode, testInfo)) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwm-video-'));
  const size = typeof video === 'string' ? undefined : video && video.size;
  return { mode, recordVideo: size ? { dir, size } : { dir } };
}

async function saveContextVideos(pages, testInfo, mode) {
  if (!shouldPreserveVideo(mode, testInfo)) return;
  let counter = 0;
  for (const page of pages) {
    const video = typeof page.video === 'function' ? page.video() : null;
    if (!video) continue;
    try {
      const dest = testInfo.outputPath(`video${counter ? `-${counter}` : ''}.webm`);
      counter += 1;
      await video.saveAs(dest);
      testInfo.attachments.push({ name: 'video', path: dest, contentType: 'video/webm' });
    } catch {}
  }
}

/**
 * Wraps context.close so each page video is saved and attached after the context closes.
 */
function installPreflightVideoCapture(context, testInfo, mode) {
  const pages = [];
  if (typeof context.on === 'function') context.on('page', (page) => pages.push(page));
  const originalClose = context.close.bind(context);
  context.close = async function (...args) {
    try {
      return await originalClose(...args);
    } finally {
      await saveContextVideos(pages, testInfo, mode);
    }
  };
}

module.exports = {
  normalizeVideoMode,
  shouldCaptureVideo,
  preflightVideoOptions,
  installPreflightVideoCapture,
};
