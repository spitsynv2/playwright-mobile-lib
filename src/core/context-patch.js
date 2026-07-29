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

module.exports = { patchContextNewPage };
