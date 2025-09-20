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
- `npm run test:integration:ai` - Run AI/Bedrock integration tests using script
- `npm run test:integration:ai-performance` - Run AI integration tests with performance monitoring
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
- `npm run verify:lambda-bundle` - Verify deployed Lambda bundle
- `npm run test:deployment` - Test deployment functionality
- `npm run validate:all` - Run all validation checks

### Local Testing
- `npm run test:local` - Run the agent locally
- `npm run test:device-api` - Test device registration API

### Documentation Generation
- `npm run diagram:build` - Generate architecture diagrams from Mermaid files

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
- `bedrock-analysis-tool.ts` - AI-enhanced cost analysis using AWS Bedrock and Titan models
- `cost-insights-tool.ts` - Bedrock-powered cost insights generation

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
- `bedrock-monitoring.ts` - Bedrock service monitoring, health checks, and cost tracking

**Additional Components** (`src/`)
- `types.ts` - Comprehensive type definitions for cost analysis, AI results, and configuration
- `validation.ts` - Input validation and data sanitization
- `device-registration-handler.ts` - Lambda handler for device registration API
- `device-registration-index.ts` - Device registration entry point
- `mock-strands-agent.ts` - Mock implementation for testing and development

### Key Features

1. **AWS Cost Monitoring**: Daily monitoring of AWS spending using Cost Explorer API
2. **AI-Enhanced Cost Analysis**: Bedrock-powered spending pattern analysis, anomaly detection, and optimization recommendations
3. **Smart Alerting**: SNS-based notifications when spending exceeds thresholds ($10 default)
4. **iOS Device Management**: Comprehensive iOS device registration, monitoring, and management
5. **Event-Driven Architecture**: Uses EventBridge for scheduled execution
6. **Serverless Deployment**: Fully serverless using AWS Lambda and CDK
7. **Comprehensive Monitoring**: CloudWatch alarms, health checks, and metrics collection for all services
8. **Cost Optimization**: AI-driven recommendations for rightsizing, reserved instances, and storage optimization

### Testing Strategy

The project uses Jest with separate configurations for comprehensive testing:

**Unit Tests** (`jest.config.js`)
- Excludes integration tests for fast feedback
- Tests individual components in isolation
- Coverage reporting for source files

**Integration Tests** (`jest.integration.config.js`)
- Real AWS service calls with 60-second timeout
- Sequential execution to avoid rate limits
- Specialized environment setup and teardown
- JUnit XML reporting for CI/CD integration

**Test Categories:**
- Unit tests: Fast, isolated component testing
- Integration tests: Real AWS API testing with `RUN_INTEGRATION_TESTS=true`
- iOS integration: Device management testing with `TEST_IOS_INTEGRATION=true`
- AI integration: Bedrock testing with `TEST_BEDROCK_INTEGRATION=true`
- Performance tests: Load testing with `RUN_PERFORMANCE_TESTS=true`

**Scripts and Utilities:**
- Automated test scripts in `scripts/` directory
- Environment validation and setup
- Cost estimation and billing warnings for AI tests
- Health check validation for all AWS services

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
- **Testing**: Jest with ts-jest, jest-junit for CI/CD
- **AI/ML**: AWS Bedrock with Titan Text models
- **AWS Services**:
  - **Core**: Lambda, Cost Explorer, SNS, EventBridge, CloudWatch, DynamoDB
  - **AI**: Bedrock Runtime for cost analysis and insights
  - **Monitoring**: CloudWatch Alarms, Custom Metrics
  - **Mobile**: iOS device registration and push notifications

### Configuration

The agent is configured through environment variables and AWS CDK context. Key configurations include:

- **Cost Monitoring**: Spend thresholds, alert frequencies, and SNS topic ARNs
- **AI/Bedrock**: Model selection, cost thresholds, rate limiting, and fallback configurations
- **iOS Integration**: Device registration, push notification settings, and monitoring
- **Validation**: Configuration validation is enforced through `config-validator.ts`

### Documentation

Comprehensive documentation is available in the `docs/` directory:

- **Setup Guides**: `BEDROCK-SETUP.md`, `IOS-SETUP.md`, `IOS-GETTING-STARTED.md`
- **Operations**: `BEDROCK-OPERATIONS.md`, `DEPLOYMENT.md`, `DEPLOYMENT-VALIDATION.md`
- **Development**: `BEDROCK-AI-EXAMPLES.md`, `DEVICE-REGISTRATION-API.md`, `STRANDS-CONCEPTS.md`
- **Troubleshooting**: `BEDROCK-TROUBLESHOOTING.md`, `IOS-TROUBLESHOOTING.md`
- **Architecture**: `architecture.mmd` (Mermaid diagram) and generated `architecture.png`

### Dependencies

**Core AWS SDK Dependencies:**
- `@aws-sdk/client-bedrock-runtime` - AI analysis with Bedrock
- `@aws-sdk/client-cloudwatch` - Metrics and alarms
- `@aws-sdk/client-cost-explorer` - Cost data retrieval
- `@aws-sdk/client-dynamodb` - Data persistence
- `@aws-sdk/client-lambda` - Function management
- `@aws-sdk/client-sns` - Notification system

**Development Dependencies:**
- `aws-cdk-lib` - Infrastructure as Code
- `constructs` - CDK constructs
- TypeScript ecosystem: `typescript`, `ts-jest`, ESLint with TypeScript support