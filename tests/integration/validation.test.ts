/**
 * Integration Test Validation
 * 
 * This test validates that the integration test environment is properly configured
 * and can connect to AWS services.
 */

import { CostExplorerClient, GetCostAndUsageCommand } from '@aws-sdk/client-cost-explorer';
import { SNSClient, ListTopicsCommand } from '@aws-sdk/client-sns';
import { 
  DEFAULT_INTEGRATION_CONFIG, 
  shouldRunIntegrationTests,
  validateIntegrationTestEnvironment 
} from './test-config';

describe('Integration Test Environment Validation', () => {
  beforeEach(() => {
    if (!shouldRunIntegrationTests()) {
      pending('Integration tests disabled');
    }
  });

  it('should validate integration test environment configuration', () => {
    expect(() => validateIntegrationTestEnvironment()).not.toThrow();
    
    // Validate required environment variables are set
    expect(process.env.AWS_REGION).toBeDefined();
    expect(process.env.AWS_ACCESS_KEY_ID).toBeDefined();
    expect(process.env.AWS_SECRET_ACCESS_KEY).toBeDefined();
    
    console.log('Integration test environment validated successfully');
  });

  it('should connect to AWS Cost Explorer service', async () => {
    const client = new CostExplorerClient({ 
      region: DEFAULT_INTEGRATION_CONFIG.region 
    });

    // Test basic connectivity with a minimal request
    const command = new GetCostAndUsageCommand({
      TimePeriod: {
        Start: new Date(Date.now() - 86400000).toISOString().split('T')[0], // Yesterday
        End: new Date().toISOString().split('T')[0] // Today
      },
      Granularity: 'DAILY',
      Metrics: ['BlendedCost']
    });

    await expect(client.send(command)).resolves.not.toThrow();
    
    console.log('Cost Explorer connectivity validated');
  }, 15000);

  it('should connect to AWS SNS service', async () => {
    const client = new SNSClient({ 
      region: DEFAULT_INTEGRATION_CONFIG.region 
    });

    // Test basic connectivity
    const command = new ListTopicsCommand({});
    
    await expect(client.send(command)).resolves.not.toThrow();
    
    console.log('SNS connectivity validated');
  }, 10000);

  it('should validate test configuration values', () => {
    expect(DEFAULT_INTEGRATION_CONFIG.region).toBe(process.env.AWS_REGION || 'us-east-1');
    expect(DEFAULT_INTEGRATION_CONFIG.testTimeout).toBeGreaterThan(0);
    expect(DEFAULT_INTEGRATION_CONFIG.performanceThreshold).toBeGreaterThan(0);
    expect(DEFAULT_INTEGRATION_CONFIG.costThresholds.under).toBeLessThan(DEFAULT_INTEGRATION_CONFIG.costThresholds.over);
    
    console.log('Test configuration validated:', {
      region: DEFAULT_INTEGRATION_CONFIG.region,
      timeout: DEFAULT_INTEGRATION_CONFIG.testTimeout,
      performanceThreshold: DEFAULT_INTEGRATION_CONFIG.performanceThreshold
    });
  });

  it('should validate AWS permissions for required services', async () => {
    const costExplorerClient = new CostExplorerClient({ 
      region: DEFAULT_INTEGRATION_CONFIG.region 
    });
    
    const snsClient = new SNSClient({ 
      region: DEFAULT_INTEGRATION_CONFIG.region 
    });

    // Test Cost Explorer permissions
    const costCommand = new GetCostAndUsageCommand({
      TimePeriod: {
        Start: new Date(Date.now() - 86400000).toISOString().split('T')[0],
        End: new Date().toISOString().split('T')[0]
      },
      Granularity: 'DAILY',
      Metrics: ['BlendedCost'],
      GroupBy: [{ Type: 'DIMENSION', Key: 'SERVICE' }]
    });

    await expect(costExplorerClient.send(costCommand)).resolves.not.toThrow();

    // Test SNS permissions
    const snsCommand = new ListTopicsCommand({});
    await expect(snsClient.send(snsCommand)).resolves.not.toThrow();

    console.log('AWS service permissions validated');
  }, 20000);
});