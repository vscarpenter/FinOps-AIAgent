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
  PublishCommand: jest.fn(),
  CreatePlatformEndpointCommand: jest.fn(),
  SetEndpointAttributesCommand: jest.fn(),
  GetEndpointAttributesCommand: jest.fn(),
  DeleteEndpointCommand: jest.fn(),
  ListEndpointsByPlatformApplicationCommand: jest.fn(),
  GetPlatformApplicationAttributesCommand: jest.fn()
}));

// Mock strands-agents framework - use our mock implementation
jest.mock('strands-agents', () => {
  const mockStrandsAgent = require('../src/mock-strands-agent');
  return mockStrandsAgent;
});

jest.mock('@aws-sdk/client-cloudwatch', () => ({
  CloudWatchClient: jest.fn().mockImplementation(() => ({
    send: jest.fn()
  })),
  PutMetricDataCommand: jest.fn()
}));

jest.mock('@aws-sdk/client-dynamodb', () => ({
  DynamoDBClient: jest.fn().mockImplementation(() => ({
    send: jest.fn()
  })),
  PutItemCommand: jest.fn(),
  GetItemCommand: jest.fn(),
  UpdateItemCommand: jest.fn(),
  DeleteItemCommand: jest.fn(),
  ScanCommand: jest.fn(),
  QueryCommand: jest.fn()
}));

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