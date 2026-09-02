# playwright-mobile-lib

**Status: 1.0.0 (beta).** The API is stable and the automated checks pass. A
general release follows a green real-device run on each platform.

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
| Design and internal module map | [docs/architecture.md](docs/architecture.md) |

## License

Playwright Mobile Library is released under version 2.0 of the
[Apache License](https://www.apache.org/licenses/LICENSE-2.0).

The distributed bundle contains only this project's own code. Playwright and the
optional Zebrunner reporter stay external dependencies and are not redistributed.
