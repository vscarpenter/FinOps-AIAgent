// Jest setup file for AWS Spend Monitor Agent tests

// Mock AWS SDK modules
jest.mock('@aws-sdk/client-cost-explorer', () => ({
  CostExplorerClient: jest.fn().mockImplementation(() => ({
    send: jest.fn()
  })),
  GetCostAndUsageCommand: jest.fn()
}));

jest.mock('@aws-sdk/client-sns', () => ({
  SNSClient: jest.fn().mockImplementation(() => ({
    send: jest.fn()
  })),
  PublishCommand: jest.fn()
}));

// Mock strands-agents framework
jest.mock('strands-agents', () => ({
  Agent: class MockAgent {
    protected tools: Map<string, any> = new Map();
    protected tasks: Map<string, any> = new Map();
    
    constructor(protected config: any) {}
    
    registerTool(tool: any) {
      this.tools.set(tool.name, tool);
    }
    
    registerTask(task: any) {
      this.tasks.set(task.name, task);
    }
    
    getTool(name: string) {
      return this.tools.get(name);
    }
    
    getTask(name: string) {
      return this.tasks.get(name);
    }
  },
  Tool: class MockTool {
    constructor(public name: string, public description: string) {}
  },
  Task: class MockTask {
    constructor(public name: string, public description: string) {}
  }
}), { virtual: true });

// Set up environment variables for tests
process.env.AWS_REGION = 'us-east-1';
process.env.SNS_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:test-topic';
process.env.SPEND_THRESHOLD = '10';
process.env.CHECK_PERIOD_DAYS = '1';

// Global test utilities
global.console = {
  ...console,
  // Suppress console.log in tests unless explicitly needed
  log: jest.fn(),
  error: console.error,
  warn: console.warn,
  info: console.info,
  debug: console.debug,
};
