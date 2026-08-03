// Instance-level newPage wrap so pages a consumer opens off the fixture context
// get the same prototype patches (bridge/appium/guards) that createPage applies.

function patchContextNewPage(context, ensurePatched) {
  if (typeof context.newPage !== 'function') return;
  const original = context.newPage.bind(context);
  context.newPage = async (...args) => {
    const page = await original(...args);
    ensurePatched(page);
    return page;
  };
}

// A test that closes the context itself runs before the fixture's teardown hook,
// which then sees an empty page list; wrapping close is the only pre-close point.
function patchContextClose(context, beforeClose) {
  if (typeof context.close !== 'function') return;
  const original = context.close.bind(context);
  context.close = async (...args) => {
    try {
      await beforeClose();
    } catch {}
    return original(...args);
  };
}

module.exports = { patchContextNewPage, patchContextClose };
