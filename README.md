# playwright-mobile-lib

**Current release: 0.1.0 beta.**

The public API can change between beta releases.

Cross-platform Playwright fixtures for mobile web testing on real devices:

- iOS Safari, or local WebKit for pre-flight runs
- Android Chrome, or local Chromium for pre-flight runs

The package exports one standard Playwright `test`. Its driver is selected from
`capabilities.platformName` (`'iOS'` or `'Android'`), so the same tests, page
objects, and fixture extensions run on both platforms.

```js
const { test, expect } = require('playwright-mobile-lib');

test('opens a page', async ({ page }) => {
  await page.goto('https://example.com');
  await expect(page).toHaveTitle(/Example/);
});
```

## Documentation

| Topic | Document |
| --- | --- |
| Install, quickstart, and where tests run | [docs/getting-started.md](docs/getting-started.md) |
| Capabilities, context options, and environment variables | [docs/configuration.md](docs/configuration.md) |
| Fixtures, platform-specific and blocked APIs, and extending `test` | [docs/api.md](docs/api.md) |
| Design and contributor module map | [docs/architecture.md](docs/architecture.md) |

## Publishing the beta release

Use the package version `0.1.0`. Keep the version in `package.json` and both
root version fields in `package-lock.json` in sync.

The package currently has `"private": true`. Before public publication, remove
that field and configure the repository secret `NPM_TOKEN` with npm publish
access. Run the manual **Publish package to NPM** workflow from the release
commit. The workflow runs the package checks before publication.

For a manual release, run the same checks before publishing:

```bash
npm ci
npm run lint
npm run test
npm run test:coverage
npm run test:pack
npm publish --access public
```

After publication, install the release with `playwright-mobile-lib@0.1.0`.
Update Git-pinned consumers to the release commit and regenerate their
lockfiles. Keep each lockfile dependency version consistent with its resolved
commit.

## License

Playwright Mobile Library is released under version 2.0 of the
[Apache License](https://www.apache.org/licenses/LICENSE-2.0).

The distributed bundle contains only this project's code. Runtime dependencies
are not redistributed.
