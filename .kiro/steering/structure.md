# Project Structure

## Directory Organization

```
├── .kiro/                    # Kiro IDE configuration
│   ├── steering/            # AI assistant guidance rules
│   └── specs/               # Feature specifications
├── docs/                    # Project documentation
│   ├── DEPLOYMENT.md        # Deployment instructions
│   └── STRANDS-CONCEPTS.md  # Framework concepts guide
├── examples/                # Usage examples and demos
│   ├── custom-config.ts     # Configuration examples
│   └── local-test.ts        # Local testing scripts
├── src/                     # Source code (TypeScript)
│   ├── agent.ts            # Main agent implementation
│   ├── app.ts              # CDK application entry point
│   ├── index.ts            # Lambda handler entry point
│   └── infrastructure.ts    # CDK stack definition
├── tests/                   # Test files
│   ├── agent.test.ts       # Agent unit tests
│   └── setup.ts            # Test configuration
├── dist/                    # Compiled JavaScript (generated)
├── coverage/                # Test coverage reports (generated)
└── node_modules/            # Dependencies (generated)
```

## File Naming Conventions
- **TypeScript files**: kebab-case or camelCase (`.ts`)
- **Test files**: `*.test.ts` or `*.spec.ts`
- **Documentation**: UPPERCASE.md for important docs
- **Configuration**: lowercase with extensions (`.json`, `.js`)

## Source Code Organization

### Core Components
- `agent.ts`: Contains the main `SpendMonitorAgent` class and related tools
- `infrastructure.ts`: CDK stack with all AWS resources
- `index.ts`: Lambda entry point and handler function
- `app.ts`: CDK application bootstrap

### AWS Strands Patterns
- **Agent**: Main orchestrator class extending base `Agent`
- **Tools**: Reusable components for specific actions (Cost analysis, Alerts)
- **Tasks**: Structured work units for the agent
- **Config**: TypeScript interfaces for type-safe configuration

## Architecture Layers

### 1. Entry Points
- `index.ts`: Lambda handler for AWS execution
- `app.ts`: CDK deployment entry point

### 2. Business Logic
- `agent.ts`: Core agent logic, tools, and tasks
- Configuration interfaces and implementations

### 3. Infrastructure
- `infrastructure.ts`: AWS resources and permissions
- CDK stack with Lambda, SNS, EventBridge, IAM

### 4. Supporting Files
- `examples/`: Demonstration and testing utilities
- `tests/`: Comprehensive unit tests with mocks
- `docs/`: Technical documentation and guides

## Import Patterns
- Relative imports within the project: `./agent`, `../utils`
- External dependencies: Direct package imports
- AWS SDK: Specific client imports for tree-shaking
- Strands framework: Import specific classes and interfaces

## Configuration Files
- `package.json`: Dependencies and npm scripts
- `tsconfig.json`: TypeScript compiler configuration
- `jest.config.js`: Test framework setup
- `cdk.json`: CDK application configuration

## Generated Directories
- `dist/`: TypeScript compilation output
- `coverage/`: Jest test coverage reports
- `node_modules/`: npm dependencies
- `cdk.out/`: CDK synthesis output (temporary)