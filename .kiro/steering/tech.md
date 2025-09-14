# Technology Stack

## Core Technologies
- **Runtime**: Node.js 18+ with TypeScript 5.0
- **Framework**: AWS Strands (AI agent framework)
- **Infrastructure**: AWS CDK v2.100+ for Infrastructure as Code
- **Testing**: Jest with ts-jest preset
- **Linting**: ESLint for code quality

## AWS Services
- **Lambda**: Serverless agent execution
- **Cost Explorer**: Cost analysis and reporting
- **SNS**: Alert notifications (email/SMS)
- **EventBridge**: Scheduled triggers (daily at 9 AM UTC)
- **IAM**: Permissions and security policies
- **CloudWatch**: Logging and monitoring

## Key Dependencies
- `strands-agents`: Core AI agent framework
- `@aws-sdk/client-cost-explorer`: Cost analysis
- `@aws-sdk/client-sns`: Notification delivery
- `@aws-cdk/*`: Infrastructure deployment
- `aws-sdk`: Legacy AWS SDK compatibility

## Build System

### Common Commands
```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Run tests
npm run test

# Lint code
npm run lint

# Deploy infrastructure
npm run deploy
# or
cdk deploy

# Local testing
npm run test:local
# or
node dist/index.js
```

### Development Workflow
1. Write TypeScript code in `src/`
2. Build with `npm run build` (outputs to `dist/`)
3. Test with `npm run test`
4. Deploy with `cdk deploy`

## Configuration Management
- Environment variables for runtime config
- CDK context for deployment settings
- TypeScript interfaces for type safety
- Default values with override capability

## Code Quality Standards
- Strict TypeScript configuration
- Jest for unit testing with mocks
- ESLint for consistent code style
- 100% TypeScript (no JavaScript files)
- Comprehensive error handling