# Contributing to Auto WebMCP

Thank you for contributing.

## Development

Requirements:

- Node.js 24 or later
- pnpm 11.24.0
- Chrome 149 or later for browser validation

Install dependencies and run the automated checks:

```sh
pnpm install --frozen-lockfile
pnpm check
```

For live extension development, run `pnpm dev`, load `dist/` as an unpacked extension, and use the form lab at <http://127.0.0.1:4173>.

## Pull requests

- Keep each pull request focused on one change.
- Add or update the smallest relevant test for behavior changes.
- Run `pnpm check` before opening the pull request.
- Do not weaken the no-submission behavior, local-only processing, or permission boundary without explaining the reason and impact.
- Update public documentation when behavior, permissions, privacy, compatibility, or release steps change.

Use [GitHub Security Advisories](SECURITY.md) instead of a public issue for vulnerabilities.
