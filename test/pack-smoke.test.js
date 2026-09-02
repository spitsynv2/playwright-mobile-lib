'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

// Packs the real tarball (npm pack runs prepack -> build), extracts it, and
// loads it exactly as a consumer would. This catches a broken `files`
// allowlist, `main`/`types`/`exports` map, or an unbundled require before publish.

const repoRoot = path.join(__dirname, '..');

function packAndExtract() {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pwm-pack-'));
  const output = execFileSync(
    'npm',
    ['pack', '--json', '--pack-destination', workDir],
    { cwd: repoRoot, encoding: 'utf8' },
  );
  const jsonStart = output.indexOf('[');
  const [manifest] = JSON.parse(output.slice(jsonStart));
  const tarball = path.join(workDir, manifest.filename);
  execFileSync('tar', ['-xzf', tarball, '-C', workDir]);
  return { workDir, packageDir: path.join(workDir, 'package'), manifest };
}

test('the packed tarball ships the built bundle and type declarations', () => {
  const { workDir, packageDir, manifest } = packAndExtract();
  try {
    const shipped = new Set(manifest.files.map((entry) => entry.path));
    assert.ok(shipped.has('dist/index.js'), 'the built bundle is packed');
    assert.ok(shipped.has('index.d.ts'), 'the public type declarations are packed');
    assert.ok(shipped.has('package.json'));

    const pkg = require(path.join(packageDir, 'package.json'));
    assert.ok(fs.existsSync(path.join(packageDir, pkg.main)), '`main` points at a packed file');
    assert.ok(fs.existsSync(path.join(packageDir, pkg.types)), '`types` points at a packed file');
    assert.ok(fs.existsSync(path.join(packageDir, pkg.exports['.'].default)), 'the export map default resolves');
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});

test('the packed bundle loads and exposes the public surface with peers resolved', () => {
  const { workDir, packageDir } = packAndExtract();
  const savedNodePath = process.env.NODE_PATH;
  try {
    // The bundle keeps `playwright` / `@playwright/test` external, so resolve
    // them from this repo's node_modules the way a consumer install would.
    process.env.NODE_PATH = path.join(repoRoot, 'node_modules');
    Module._initPaths();

    const entry = path.join(packageDir, 'dist', 'index.js');
    const bundle = require(entry);
    for (const name of ['test', 'expect', 'defineConfig', 'withAppiumInputMode', 'resolveIOSDevicePreset']) {
      assert.equal(typeof bundle[name], 'function', `expected ${name} to be exported from the packed bundle`);
    }
    assert.ok(bundle.devices && bundle.devices['iPhone 15'], 'the Playwright devices catalog is re-exported');
  } finally {
    if (savedNodePath === undefined) delete process.env.NODE_PATH;
    else process.env.NODE_PATH = savedNodePath;
    Module._initPaths();
    fs.rmSync(workDir, { recursive: true, force: true });
  }
});
