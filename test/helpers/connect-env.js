'use strict';

const ENDPOINT_KEYS = ['PLAYWRIGHT_MOBILE_HUB_URL'];

async function withConnectEnv(vars, fn) {
  const saved = new Map();
  for (const key of ENDPOINT_KEYS) saved.set(key, process.env[key]);
  for (const key of ENDPOINT_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(vars)) process.env[key] = value;
  try {
    return await fn();
  } finally {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

module.exports = { withConnectEnv, ENDPOINT_KEYS };
