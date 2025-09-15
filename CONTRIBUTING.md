# Contributing

Thanks for your interest in contributing! This project is open to community contributions with a maintainer-driven merge policy: contributions are reviewed via Pull Requests and merged by the maintainer only.

## Quick Start

- Node.js LTS and npm installed
- Install deps: `npm ci`
- Build: `npm run build`
- Lint: `npm run lint`
- Unit tests: `npm run test:unit`
- Integration tests (may require AWS):
  - Setup: `npm run test:integration:setup`
  - Run: `npm run test:integration:run`

Follow repository conventions:
- Source in `src/` (entry `index.ts`); tests in `tests/`
- Prefer `src/utils/logger.ts` over `console` for runtime logs
- Use TypeScript with 2-space indentation

## Branching and Commits

- Create feature branches from `main` (e.g., `feature/xyz-improvement`)
- Use Conventional Commits for messages (e.g., `feat: add cost analyzer`)
- Keep PRs focused and small when possible

## Pull Request Guidelines

- Include what/why, linked issues, and testing instructions
- Add/adjust unit tests; target ≥80% coverage for new code
- Update docs when behavior or public APIs change
- CI must be green: lint, build, and unit tests must pass
- Code Owners review is required; only the maintainer merges PRs

## Security

Do not report security issues in public issues or PRs. Use the process in `SECURITY.md`.

## CI Notes for External Contributors

- CI runs `lint`, `build`, and `test:unit` on PRs
- Integration tests are not run on untrusted forks

## Releasing

Releases are manual. See `docs/RELEASING.md`.

