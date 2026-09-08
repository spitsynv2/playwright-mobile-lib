/** Patch context.newPage. A consumer page must get the same prototype patches. */
function patchContextNewPage(context, ensurePatched) {
  if (typeof context.newPage !== 'function') return;
  const original = context.newPage.bind(context);
  context.newPage = async (...args) => {
    const page = await original(...args);
    ensurePatched(page);
    return page;
  };
}

/** Run cleanup before context.close when a test closes the context. */
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
