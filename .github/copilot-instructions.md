# Copilot Instructions for FinOps-AIAgent

## Project Overview
This repository implements an enterprise-grade FinOps AI agent using AWS Strands, TypeScript, and AWS CDK. It provides cost monitoring, iOS device management, multi-channel alerting, and automated recovery.

## Architecture & Key Components
- **Agent Definition:** `src/agent.ts` orchestrates agent logic and capabilities.
- **Tasks:** Domain logic in `src/tasks/` (e.g., `spend-monitor-task.ts`).
- **Tools:** AWS and iOS integrations in `src/tools/` (e.g., `cost-analysis-tool.ts`, `alert-tool.ts`, `ios-management-tool.ts`).
- **Infrastructure:** AWS CDK resources in `src/infrastructure.ts` and `src/app.ts`.
- **Utilities:** Logging, config validation, error handling, metrics, and retry logic in `src/utils/`.
- **Types:** Shared types in `src/types/`.

## Developer Workflows
- **Build:** `npm run build` (TypeScript → `dist/`)
- **Lint:** `npm run lint` (ESLint)
- **Unit Tests:** `npm run test:unit` (Jest)
- **Integration Tests:** `npm run test:integration:run` (real AWS, see `tests/integration/README.md`)
- **Performance Tests:** `npm run test:performance`
- **Local Run:** `npm run test:local` (executes built agent)
- **Validation:** `npm run validate:config`, `npm run validate:pre-deploy`, `npm run validate:deployment`
- **Deploy:** `npm run deploy` (AWS CDK)

## Conventions & Patterns
- **TypeScript, 2-space indent, kebab-case files.**
- **Classes/Types:** PascalCase; **functions/vars:** camelCase; **constants:** UPPER_SNAKE_CASE.
- **Logging:** Use `src/utils/logger.ts` (not raw `console`).
- **Config:** Validate with `scripts/validate-config.ts` before deploy. Required: `AWS_REGION`, `SPEND_THRESHOLD`, `SNS_TOPIC_ARN`.
- **Tests:** Unit in `tests/`, integration in `tests/integration/`. Coverage ≥80% for new code.
- **Commits:** Conventional Commits (`feat:`, `fix:`, etc.). PRs must include rationale, test steps, and config validation output.

## Integration & External Dependencies
- **AWS Services:** Cost Explorer, SNS, Lambda, EventBridge, IAM.
- **iOS:** APNS integration for device management and push notifications.
- **Serverless:** All infra defined via CDK, deployed via `npm run deploy`.

## Examples & References
- **Architecture diagram:** `docs/architecture.png` (source: `docs/architecture.mmd`)
- **Config examples:** `examples/`
- **Integration test patterns:** `tests/integration/README.md`

## Security & Secrets
- Store secrets outside VCS. Validate config before deploy.

---

_If any section is unclear or missing, please request clarification or provide feedback for improvement._
