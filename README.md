# Auto WebMCP

[![CI](https://github.com/pauloportella/auto-webmcp-chrome/actions/workflows/ci.yml/badge.svg)](https://github.com/pauloportella/auto-webmcp-chrome/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Auto WebMCP turns ordinary forms, standalone inputs, and supported widgets into structured WebMCP tools. Compatible browser agents can populate fields, open controls, select options, and run supported searches directly from the page.

## Demo

[![Auto WebMCP upgrading a normal form and allowing an agent to fill 27 fields in one call](artwork/demo.gif)](artwork/demo.mp4)

The recording shows the original native-form workflow. The local playground now also includes inputs outside forms, custom widgets, and URL-based searches.

## Capabilities

Supported inputs include text fields, text areas, selects, multi-selects, radio groups, checkboxes, dates, times, and numbers. Their labels, ARIA references, choices, and validation constraints supply the generated JSON Schemas. Hidden, disabled, read-only, inert, and file-upload controls are excluded from fill tools.

Standalone inputs and semantic groups outside `<form>` tags are discoverable too, including unnamed controls. Their native form ownership and names remain intact. Supported disclosures and currently rendered single-select listboxes expose separate tools, with readable labels for option tokens.

As the page changes, Auto WebMCP refreshes its tools and checks live controls during filling. Results identify fields whose values could not be verified. Existing site-declared form tools are preserved, and generated names are checked against existing registrations to avoid collisions.

The toolbar popup shows input-group counts and the actual registered tool list.

### Tool behavior

| Tool | Effect when called |
| --- | --- |
| `fill_*` | Populates supported fields and dispatches edit events. Omitted fields stay unchanged. Does not call form submission. |
| `show_*` | Activates a supported disclosure or popup trigger. Discover tools again to see newly available controls. |
| `choose_*` | Activates a currently rendered listbox option. Reports whether the resulting selection was verified. |
| `search_*` | Constructs a supported search URL and navigates the current tab, sending search parameters to the website. |

Discovery reads page structure without opening controls or making search requests. Website handlers can react to tool-triggered edits and clicks, including by navigating or sending data. A widget result with `verified: false` means activation occurred but the final state could not be confirmed; inspect the page before continuing.

### Search support

Generic search tools support native GET forms identified by search semantics, such as `role="search"` or an `input[type="search"]`. The declared route must stay on the same origin and have unambiguous submission behavior. Forms with password fields, file/image inputs, multiple enabled submit buttons, or submit-route overrides are excluded.

A search tool serializes the requested values without editing the original controls or dispatching form events. Omitted fields use current values; successful hidden fields and the supported submit button are included in the URL. The returned `navigationScheduled` result confirms that navigation was scheduled. Inspect the destination to confirm the search results.

Willhaben marketplace pages also receive a small site-specific `search_willhaben` tool. It supports a query, minimum/maximum price, any/used condition, newest/cheapest sorting, and the verified areas **all, Styria, Graz, and Graz-Umgebung**. Its omitted filters reset to defaults. These URL mappings are explicit in the code.

### Limits

Custom calendars, arbitrary JavaScript widgets, shadow-root controls, and options that have not been rendered are not generally supported. Standalone replacement controls are verified only when a unique match exists within their original parent. Search support does not imply that every site's JavaScript submission flow can be reproduced.

Auto WebMCP runs on top-level HTTP and HTTPS pages. Chrome protects internal pages, including `chrome://` pages and the Chrome Web Store, from extension content scripts.

## Compatibility

Chrome 149 or later is required. Auto WebMCP uses Chrome's native `document.modelContext` API when available and otherwise uses a packaged compatibility runtime. No experimental Chrome flag is required to expose the page API; end-to-end discovery and invocation still depend on the browser agent or client.

WebMCP is an emerging browser API. A compatible browser agent or client is required to discover and invoke the generated tools.

To support agents that inspect semantic page snapshots, Auto WebMCP adds a visually hidden availability note to annotated pages. It does not alter the visible layout, but assistive-technology browse modes may encounter the note.

## Privacy

Form analysis runs locally in the browser. Auto WebMCP does not operate analytics, advertising, telemetry, accounts, or remote services. Fill and widget tools can trigger the website's own event handlers. Search tools send parameters to the destination website through URL navigation, where they may also appear in browser history and website logs.

The current [privacy policy](PRIVACY.md) predates search navigation and must be updated before these changes are released.

## Build from source

Use Node.js 24 and the pinned pnpm version in `package.json`. Install the locked dependencies and create a production build:

```sh
pnpm install --frozen-lockfile --ignore-scripts
pnpm build
```

Load `dist/` from `chrome://extensions` using **Load unpacked**.

## Development

```sh
pnpm dev
```

The development command rebuilds `dist/` and serves these local pages:

| Page | What to try |
| --- | --- |
| [Form Lab](http://127.0.0.1:4173/) | Native input types, grouped choices, conditional fields, and manual review. |
| [Widgets](http://127.0.0.1:4173/widgets) | Standalone inputs, disclosures, and a custom destination picker. |
| [Search](http://127.0.0.1:4173/search) | GET navigation with a readable display of received parameters and event diagnostics. |
| [Regressions](http://127.0.0.1:4173/regressions) | Run browser regression cases through the installed extension. |

The three playgrounds share a responsive stylesheet and use synthetic data. Load the development `dist/` as the unpacked extension and keep a playground tab open so changes under `src/` reload the extension and affected tabs automatically. Refresh the page for changes to `mock/`; restart `pnpm dev` for changes to the development server itself.

## Verification and packaging

Stop `pnpm dev` before production checks or packaging: both use the same `dist/` directory.

```sh
# macOS: include the installed Chrome browser tests
CHROME_BIN="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" pnpm check

# Linux with google-chrome installed
CHROME_BIN="$(command -v google-chrome)" pnpm check

pnpm package
```

Set `CHROME_BIN` to a valid installed Chrome executable. Without it, `pnpm check` skips the browser suite. The current full check runs 14 Node test cases, including 21 real-Chrome regression scenarios and an isolated ZIP test for stale artifacts. CI supplies `CHROME_BIN`; no browser download is part of the test runner.

`pnpm package` creates `release/auto-webmcp-0.10.1.zip`, using the manifest version for the filename. Production builds clear old output and exclude development reload code. Restart `pnpm dev` to return to the development build.

## Contributing and security

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and [SECURITY.md](SECURITY.md) for private vulnerability reporting.

## License

Auto WebMCP is available under the [MIT License](LICENSE).
Third-party software notices are listed in [THIRD_PARTY_NOTICES.txt](THIRD_PARTY_NOTICES.txt).
