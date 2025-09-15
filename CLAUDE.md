# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Common Commands

### Building and Testing
- `npm run build` - Compile TypeScript to JavaScript in dist/ directory
- `npm run test` or `npm run test:unit` - Run unit tests with Jest
- `npm run test:integration` - Run integration tests
- `npm run test:integration:setup` - Set up integration test environment
- `npm run test:integration:run` - Run integration tests with environment flag
- `npm run test:integration:ios` - Run iOS-specific integration tests
- `npm run test:all` - Run both unit and integration tests
- `npm run test:performance` - Run performance tests
- `npm run lint` - Run ESLint on TypeScript files
- `npm run clean` - Remove dist and coverage directories

### Deployment and Validation
- `npm run deploy` or `cdk deploy` - Deploy infrastructure using AWS CDK
- `npm run validate:config` - Validate configuration files
- `npm run validate:pre-deploy` - Run pre-deployment checks
- `npm run validate:ios` - Validate iOS configuration
- `npm run validate:deployment` - Validate deployment
- `npm run validate:all` - Run all validation checks

### Local Testing
- `npm run test:local` - Run the agent locally
- `npm run test:device-api` - Test device registration API

## Architecture Overview

This is an AWS Strands AI agent for FinOps (Financial Operations) that monitors AWS spending and sends alerts. The codebase follows a clean architecture pattern with clear separation of concerns:

### Core Components

**Agent Definition** (`src/agent.ts`)
- Main agent configuration using AWS Strands framework
- Defines agent capabilities, tools, and task orchestration

**Tasks** (`src/tasks/`)
- `spend-monitor-task.ts` - Core spending monitoring logic

**Tools** (`src/tools/`)
- `cost-analysis-tool.ts` - AWS Cost Explorer integration for spend analysis
- `alert-tool.ts` - SNS-based alerting system
- `ios-management-tool.ts` - iOS device management and monitoring

**Infrastructure** (`src/infrastructure.ts`, `src/app.ts`)
- AWS CDK infrastructure definitions for Lambda, SNS, EventBridge, IAM roles
- Serverless deployment configuration

**Utilities** (`src/utils/`)
- `logger.ts` - Centralized logging
- `config-validator.ts` - Configuration validation
- `errors.ts` - Custom error types
- `retry.ts` - Retry logic for AWS API calls
- `metrics.ts` - Metrics collection
- `ios-monitoring.ts` - iOS-specific monitoring utilities

### Key Features

1. **AWS Cost Monitoring**: Daily monitoring of AWS spending using Cost Explorer API
2. **Smart Alerting**: SNS-based notifications when spending exceeds thresholds ($10 default)
3. **iOS Device Management**: Comprehensive iOS device registration, monitoring, and management
4. **Event-Driven Architecture**: Uses EventBridge for scheduled execution
5. **Serverless Deployment**: Fully serverless using AWS Lambda and CDK

### Testing Strategy

The project uses Jest with separate configurations:
- Unit tests: `jest.config.js` (excludes integration tests)
- Integration tests: `jest.integration.config.js` (includes real AWS service calls)
- Environment flags: Use `RUN_INTEGRATION_TESTS=true` for integration testing
- iOS testing: Special flag `TEST_IOS_INTEGRATION=true` for iOS-specific tests

### Development Workflow

1. Make changes to TypeScript source files
2. Run `npm run build` to compile
3. Run `npm run lint` to check code quality
4. Run `npm run test:unit` for fast feedback
5. Run `npm run test:integration:run` for full testing
6. Use `npm run validate:all` before deployment
7. Deploy with `npm run deploy`

### Technology Stack

- **Language**: TypeScript with strict type checking
- **Runtime**: Node.js (AWS Lambda)
- **Framework**: AWS Strands (AI agent framework)
- **Infrastructure**: AWS CDK
- **Testing**: Jest with ts-jest
- **AWS Services**: Lambda, Cost Explorer, SNS, EventBridge, CloudWatch, DynamoDB

### Configuration

The agent is configured through environment variables and AWS CDK context. Key configurations include spend thresholds, alert frequencies, and SNS topic ARNs. Configuration validation is enforced through `config-validator.ts`.