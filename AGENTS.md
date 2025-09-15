# Repository Guidelines

## Project Structure & Module Organization
- Source: `src/` (entry `index.ts`, infra `infrastructure.ts`, core `agent.ts`, domain `tasks/`, tools in `tools/`, helpers in `utils/`, types in `types/`).
- Tests: `tests/` (unit in root, integration in `tests/integration/`).
- Scripts: `scripts/` (validation, iOS/dev tooling, pre‑deploy checks).
- Docs & examples: `docs/`, `examples/`. Build artifacts: `dist/`.

## Build, Test, and Development Commands
- Build: `npm run build` — compile TypeScript to `dist/`.
- Lint: `npm run lint` — ESLint on `src/**/*.ts`.
- Unit tests: `npm run test:unit` — Jest unit suite.
- Integration tests: `npm run test:integration:run` — runs `tests/integration` (sequential; may require AWS).
  - Setup: `npm run test:integration:setup` (build + env prep).
  - Performance: `npm run test:performance`.
- Local run: `npm run test:local` — executes `dist/index.js`.
- Validation: `npm run validate:config`, `npm run validate:pre-deploy`, `npm run validate:deployment`.
- Deploy: `npm run deploy` — `cdk deploy` to the configured AWS account.

Examples:
- "Quick check": `npm ci && npm run build && npm test`.
- Validate config only: `npx ts-node scripts/validate-config.ts --help`.

## Coding Style & Naming Conventions
- Language: TypeScript. Indentation: 2 spaces.
- Files: kebab-case (e.g., `device-registration-handler.ts`).
- Classes/Types: PascalCase; functions/vars: camelCase; constants: UPPER_SNAKE_CASE.
- Linting: ESLint (`.eslintrc.js`). Prefer `src/utils/logger.ts` over raw `console` for runtime logs.

## Testing Guidelines
- Framework: Jest + ts-jest. Unit tests: `*.test.ts` alongside `tests/` root; integration under `tests/integration/`.
- Coverage output: `coverage/` and `coverage/integration/`. Target ≥80% lines for new code.
- Integration flags: many tests hit AWS; set required env vars (e.g., `AWS_REGION`, `SNS_TOPIC_ARN`) and run via `npm run test:integration:run`.

## Commit & Pull Request Guidelines
- Commits: prefer Conventional Commits (`feat:`, `fix:`, `chore:`). Keep scoped and descriptive.
- PRs must include:
  - Summary, rationale, and linked issues.
  - How to test (unit/integration commands) and expected outcomes.
  - Any CDK/IaC impact and rollback considerations.
  - For config changes, include `npm run validate:config` output.

## Security & Configuration Tips
- Before deploy: `npm run validate:pre-deploy` then `npm run deploy`.
- Required config commonly includes `AWS_REGION`, `SPEND_THRESHOLD`, `SNS_TOPIC_ARN` (see `scripts/validate-config.ts`). Store secrets outside VCS.
