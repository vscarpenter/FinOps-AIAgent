import { SpendMonitorAgent } from '../src/agent';
import { SpendMonitorConfig, CostAnalysis, AlertContext } from '../src/types';
import { ValidationError } from '../src/validation';
import { CostAnalysisTool } from '../src/tools/cost-analysis-tool';
import { AlertTool } from '../src/tools/alert-tool';
import { iOSManagementTool } from '../src/tools/ios-management-tool';
import { SpendMonitorTask } from '../src/tasks/spend-monitor-task';

// Mock all the dependencies
jest.mock('../src/validation');
jest.mock('../src/tools/cost-analysis-tool');
jest.mock('../src/tools/alert-tool');
jest.mock('../src/tools/ios-management-tool');
jest.mock('../src/tasks/spend-monitor-task');
jest.mock('@aws-sdk/client-cost-explorer');
jest.mock('@aws-sdk/client-sns');

const mockValidateSpendMonitorConfig = require('../src/validation').validateSpendMonitorConfig;

describe('SpendMonitorAgent', () => {
  let agent: SpendMonitorAgent;
  let mockConfig: SpendMonitorConfig;
  let mockCostAnalysis: CostAnalysis;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockConfig = {
      spendThreshold: 10,
      snsTopicArn: 'arn:aws:sns:us-east-1:123456789012:spend-alerts',
      checkPeriodDays: 1,
      region: 'us-east-1',
      retryAttempts: 3,
      minServiceCostThreshold: 1
    };

    mockCostAnalysis = {
      totalCost: 15.50,
      serviceBreakdown: {
        'EC2-Instance': 10.00,
        'S3': 3.50,
        'Lambda': 2.00
      },
      period: {
        start: '2023-01-01',
        end: '2023-01-31'
      },
      projectedMonthly: 31.00,
      currency: 'USD',
      lastUpdated: '2023-01-15T10:00:00Z'
    };

    // Mock validation to pass by default
    mockValidateSpendMonitorConfig.mockImplementation(() => {});

    agent = new SpendMonitorAgent(mockConfig);
  });

  describe('constructor', () => {
    it('should initialize with correct configuration', () => {
      expect(agent.getConfig()).toEqual(mockConfig);
    });

    it('should initialize AWS clients with correct region', () => {
      const config = agent.getConfig();
      expect(config.region).toBe('us-east-1');
    });
  });

  describe('initialize', () => {
    let mockCostAnalysisTool: jest.Mocked<CostAnalysisTool>;
    let mockAlertTool: jest.Mocked<AlertTool>;
    let mockSpendMonitorTask: jest.Mocked<SpendMonitorTask>;

    beforeEach(() => {
      mockCostAnalysisTool = {
        getCurrentMonthCosts: jest.fn()
      } as any;

      mockAlertTool = {
        sendSpendAlert: jest.fn(),
        sendSimpleAlert: jest.fn()
      } as any;

      mockSpendMonitorTask = {
        execute: jest.fn(),
        setCostAnalysis: jest.fn(),
        setAlertContext: jest.fn(),
        getStatistics: jest.fn().mockReturnValue({ lastExecuted: undefined })
      } as any;

      (CostAnalysisTool as jest.Mock).mockImplementation(() => mockCostAnalysisTool);
      (AlertTool as jest.Mock).mockImplementation(() => mockAlertTool);
      (SpendMonitorTask as jest.Mock).mockImplementation(() => mockSpendMonitorTask);

      // Mock agent methods
      agent.registerTool = jest.fn();
      agent.registerTask = jest.fn();
    });

    it('should initialize successfully without iOS config', async () => {
      await agent.initialize();

      expect(mockValidateSpendMonitorConfig).toHaveBeenCalledWith(mockConfig);
      expect(CostAnalysisTool).toHaveBeenCalledWith(
        expect.any(Object), // CostExplorerClient
        mockConfig.region,
        mockConfig.retryAttempts
      );
      expect(AlertTool).toHaveBeenCalledWith(
        expect.any(Object), // SNSClient
        mockConfig.snsTopicArn,
        mockConfig.retryAttempts,
        undefined // No iOS config
      );
      expect(SpendMonitorTask).toHaveBeenCalledWith(mockConfig);
      expect(agent.registerTool).toHaveBeenCalledTimes(2);
      expect(agent.registerTask).toHaveBeenCalledTimes(1);
    });

    it('should initialize successfully with iOS config', async () => {
      const iosConfig = {
        platformApplicationArn: 'arn:aws:sns:us-east-1:123456789012:app/APNS/TestApp',
        bundleId: 'com.example.spendmonitor',
        sandbox: true
      };

      const configWithiOS = { ...mockConfig, iosConfig };
      const agentWithiOS = new SpendMonitorAgent(configWithiOS);
      agentWithiOS.registerTool = jest.fn();
      agentWithiOS.registerTask = jest.fn();

      const mockiOSManagementTool = {
        validateAPNSConfig: jest.fn().mockResolvedValue(true)
      } as any;

      (iOSManagementTool as jest.Mock).mockImplementation(() => mockiOSManagementTool);

      await agentWithiOS.initialize();

      expect(iOSManagementTool).toHaveBeenCalledWith(iosConfig, configWithiOS.region);
      expect(mockiOSManagementTool.validateAPNSConfig).toHaveBeenCalled();
      expect(agentWithiOS.registerTool).toHaveBeenCalledTimes(3); // Including iOS tool
    });

    it('should handle iOS APNS validation failure gracefully', async () => {
      const iosConfig = {
        platformApplicationArn: 'arn:aws:sns:us-east-1:123456789012:app/APNS/TestApp',
        bundleId: 'com.example.spendmonitor',
        sandbox: true
      };

      const configWithiOS = { ...mockConfig, iosConfig };
      const agentWithiOS = new SpendMonitorAgent(configWithiOS);
      agentWithiOS.registerTool = jest.fn();
      agentWithiOS.registerTask = jest.fn();

      const mockiOSManagementTool = {
        validateAPNSConfig: jest.fn().mockResolvedValue(false)
      } as any;

      (iOSManagementTool as jest.Mock).mockImplementation(() => mockiOSManagementTool);

      // Should not throw, just warn
      await expect(agentWithiOS.initialize()).resolves.not.toThrow();
      expect(mockiOSManagementTool.validateAPNSConfig).toHaveBeenCalled();
    });

    it('should throw error on configuration validation failure', async () => {
      const validationError = new ValidationError('Invalid configuration');
      mockValidateSpendMonitorConfig.mockImplementation(() => {
        throw validationError;
      });

      await expect(agent.initialize()).rejects.toThrow('Invalid configuration');
    });

    it('should throw error on tool initialization failure', async () => {
      (CostAnalysisTool as jest.Mock).mockImplementation(() => {
        throw new Error('Tool initialization failed');
      });

      await expect(agent.initialize()).rejects.toThrow('Tool initialization failed');
    });
  });

  describe('execute', () => {
    let mockCostAnalysisTool: jest.Mocked<CostAnalysisTool>;
    let mockAlertTool: jest.Mocked<AlertTool>;
    let mockSpendMonitorTask: jest.Mocked<SpendMonitorTask>;

    beforeEach(async () => {
      mockCostAnalysisTool = {
        getCurrentMonthCosts: jest.fn().mockResolvedValue(mockCostAnalysis)
      } as any;

      mockAlertTool = {
        sendSpendAlert: jest.fn().mockResolvedValue(undefined),
        sendSimpleAlert: jest.fn().mockResolvedValue(undefined)
      } as any;

      mockSpendMonitorTask = {
        execute: jest.fn().mockResolvedValue({ success: true }),
        setCostAnalysis: jest.fn(),
        setAlertContext: jest.fn(),
        getStatistics: jest.fn().mockReturnValue({ lastExecuted: undefined })
      } as any;

      (CostAnalysisTool as jest.Mock).mockImplementation(() => mockCostAnalysisTool);
      (AlertTool as jest.Mock).mockImplementation(() => mockAlertTool);
      (SpendMonitorTask as jest.Mock).mockImplementation(() => mockSpendMonitorTask);

      agent.registerTool = jest.fn();
      agent.registerTask = jest.fn();

      await agent.initialize();
    });

    it('should execute successfully when spending exceeds threshold', async () => {
      await agent.execute();

      expect(mockSpendMonitorTask.execute).toHaveBeenCalledWith(mockConfig);
      expect(mockCostAnalysisTool.getCurrentMonthCosts).toHaveBeenCalled();
      expect(mockSpendMonitorTask.setCostAnalysis).toHaveBeenCalledWith(mockCostAnalysis);
      expect(mockSpendMonitorTask.setAlertContext).toHaveBeenCalledWith(
        expect.objectContaining({
          threshold: mockConfig.spendThreshold,
          exceedAmount: mockCostAnalysis.totalCost - mockConfig.spendThreshold,
          alertLevel: 'WARNING'
        })
      );
      expect(mockAlertTool.sendSpendAlert).toHaveBeenCalled();
    });

    it('should execute successfully when spending is within threshold', async () => {
      const lowCostAnalysis = { ...mockCostAnalysis, totalCost: 5.00 };
      mockCostAnalysisTool.getCurrentMonthCosts.mockResolvedValue(lowCostAnalysis);

      await agent.execute();

      expect(mockSpendMonitorTask.execute).toHaveBeenCalledWith(mockConfig);
      expect(mockCostAnalysisTool.getCurrentMonthCosts).toHaveBeenCalled();
      expect(mockSpendMonitorTask.setCostAnalysis).toHaveBeenCalledWith(lowCostAnalysis);
      expect(mockSpendMonitorTask.setAlertContext).not.toHaveBeenCalled();
      expect(mockAlertTool.sendSpendAlert).not.toHaveBeenCalled();
    });

    it('should determine CRITICAL alert level for high overage', async () => {
      const highCostAnalysis = { ...mockCostAnalysis, totalCost: 20.00 }; // 100% over threshold
      mockCostAnalysisTool.getCurrentMonthCosts.mockResolvedValue(highCostAnalysis);

      await agent.execute();

      expect(mockSpendMonitorTask.setAlertContext).toHaveBeenCalledWith(
        expect.objectContaining({
          alertLevel: 'CRITICAL'
        })
      );
    });

    it('should handle task execution failure', async () => {
      mockSpendMonitorTask.execute.mockResolvedValue({ 
        success: false, 
        error: 'Task failed' 
      });

      await expect(agent.execute()).rejects.toThrow('Task execution failed: Task failed');
    });

    it('should handle cost analysis failure', async () => {
      mockCostAnalysisTool.getCurrentMonthCosts.mockRejectedValue(new Error('Cost analysis failed'));

      await expect(agent.execute()).rejects.toThrow('Cost analysis failed');
    });

    it('should handle alert sending failure with fallback', async () => {
      mockAlertTool.sendSpendAlert.mockRejectedValue(new Error('Alert failed'));
      mockAlertTool.sendSimpleAlert.mockResolvedValue(undefined);

      await agent.execute();

      expect(mockAlertTool.sendSpendAlert).toHaveBeenCalled();
      expect(mockAlertTool.sendSimpleAlert).toHaveBeenCalledWith(
        expect.stringContaining('AWS Spend Alert')
      );
    });

    it('should handle both alert and fallback failure', async () => {
      mockAlertTool.sendSpendAlert.mockRejectedValue(new Error('Alert failed'));
      mockAlertTool.sendSimpleAlert.mkRejectedValue(new Error('Fallback failed'));

      await expect(agent.execute()).rejects.toThrow('Alert failed');
    });

    it('should throw error when task not initialized', async () => {
      const uninitializedAgent = new SpendMonitorAgent(mockConfig);

      await expect(uninitializedAgent.execute()).rejects.toThrow('Spend Monitor Task not initialized');
    });

    it('should handle iOS-specific errors', async () => {
      const iosError = new Error('APNS certificate expired');
      mockCostAnalysisTool.getCurrentMonthCosts.mockRejectedValue(iosError);

      const configWithiOS = { 
        ...mockConfig, 
        iosConfig: {
          platformApplicationArn: 'arn:aws:sns:us-east-1:123456789012:app/APNS/TestApp',
          bundleId: 'com.example.spendmonitor',
          sandbox: true
        }
      };
      const agentWithiOS = new SpendMonitorAgent(configWithiOS);

      await expect(agentWithiOS.execute()).rejects.toThrow('APNS certificate expired');
    });
  });

  describe('getTopServices', () => {
    beforeEach(async () => {
      agent.registerTool = jest.fn();
      agent.registerTask = jest.fn();
      await agent.initialize();
    });

    it('should return top services sorted by cost', () => {
      const serviceBreakdown = {
        'EC2-Instance': 10.00,
        'S3': 3.50,
        'Lambda': 2.00,
        'CloudWatch': 0.50
      };

      const topServices = (agent as any).getTopServices(serviceBreakdown);

      expect(topServices).toHaveLength(3); // Only services >= minServiceCostThreshold (1.00)
      expect(topServices[0].serviceName).toBe('EC2-Instance');
      expect(topServices[0].cost).toBe(10.00);
      expect(topServices[1].serviceName).toBe('S3');
      expect(topServices[2].serviceName).toBe('Lambda');
    });

    it('should calculate correct percentages', () => {
      const serviceBreakdown = {
        'EC2-Instance': 8.00,
        'S3': 2.00
      };

      const topServices = (agent as any).getTopServices(serviceBreakdown);

      expect(topServices[0].percentage).toBe(80);
      expect(topServices[1].percentage).toBe(20);
    });

    it('should limit to top 5 services', () => {
      const serviceBreakdown = {
        'Service1': 10.00,
        'Service2': 9.00,
        'Service3': 8.00,
        'Service4': 7.00,
        'Service5': 6.00,
        'Service6': 5.00,
        'Service7': 4.00
      };

      const topServices = (agent as any).getTopServices(serviceBreakdown);

      expect(topServices).toHaveLength(5);
      expect(topServices.map(s => s.serviceName)).toEqual([
        'Service1', 'Service2', 'Service3', 'Service4', 'Service5'
      ]);
    });
  });

  describe('determineAlertLevel', () => {
    it('should return WARNING for moderate overage', () => {
      const level = (agent as any).determineAlertLevel(12, 10); // 20% over
      expect(level).toBe('WARNING');
    });

    it('should return CRITICAL for high overage', () => {
      const level = (agent as any).determineAlertLevel(20, 10); // 100% over
      expect(level).toBe('CRITICAL');
    });

    it('should return WARNING for exactly 50% overage', () => {
      const level = (agent as any).determineAlertLevel(15, 10); // 50% over
      expect(level).toBe('WARNING');
    });

    it('should return CRITICAL for just over 50% overage', () => {
      const level = (agent as any).determineAlertLevel(15.1, 10); // 51% over
      expect(level).toBe('CRITICAL');
    });
  });

  describe('getStatus', () => {
    it('should return correct status when not initialized', () => {
      const status = agent.getStatus();

      expect(status.initialized).toBe(false);
      expect(status.iosEnabled).toBe(false);
    });

    it('should return correct status when initialized', async () => {
      agent.registerTool = jest.fn();
      agent.registerTask = jest.fn();
      agent.getRegisteredTools = jest.fn().mockReturnValue(['tool1', 'tool2']);
      agent.getRegisteredTasks = jest.fn().mockReturnValue(['task1']);

      await agent.initialize();

      const status = agent.getStatus();

      expect(status.initialized).toBe(true);
      expect(status.toolsRegistered).toBe(2);
      expect(status.tasksRegistered).toBe(1);
      expect(status.iosEnabled).toBe(false);
    });

    it('should return correct status with iOS enabled', () => {
      const configWithiOS = { 
        ...mockConfig, 
        iosConfig: {
          platformApplicationArn: 'arn:aws:sns:us-east-1:123456789012:app/APNS/TestApp',
          bundleId: 'com.example.spendmonitor',
          sandbox: true
        }
      };
      const agentWithiOS = new SpendMonitorAgent(configWithiOS);

      const status = agentWithiOS.getStatus();

      expect(status.iosEnabled).toBe(true);
    });
  });

  describe('healthCheck', () => {
    beforeEach(async () => {
      agent.registerTool = jest.fn();
      agent.registerTask = jest.fn();
      await agent.initialize();
    });

    it('should return healthy status when all components are working', async () => {
      const health = await agent.healthCheck();

      expect(health.overall).toBe('healthy');
      expect(health.components.costAnalysis).toBe('healthy');
      expect(health.components.alerts).toBe('healthy');
      expect(health.components.tasks).toBe('healthy');
      expect(health.errors).toHaveLength(0);
    });

    it('should return degraded status with one unhealthy component', async () => {
      // Simulate uninitialized agent
      const uninitializedAgent = new SpendMonitorAgent(mockConfig);
      
      const health = await uninitializedAgent.healthCheck();

      expect(health.overall).toBe('unhealthy'); // All components uninitialized
      expect(health.errors.length).toBeGreaterThan(0);
    });

    it('should check iOS component when enabled', async () => {
      const iosConfig = {
        platformApplicationArn: 'arn:aws:sns:us-east-1:123456789012:app/APNS/TestApp',
        bundleId: 'com.example.spendmonitor',
        sandbox: true
      };

      const configWithiOS = { ...mockConfig, iosConfig };
      const agentWithiOS = new SpendMonitorAgent(configWithiOS);
      agentWithiOS.registerTool = jest.fn();
      agentWithiOS.registerTask = jest.fn();

      const mockiOSManagementTool = {
        validateAPNSConfig: jest.fn().mockResolvedValue(true)
      } as any;

      (iOSManagementTool as jest.Mock).mockImplementation(() => mockiOSManagementTool);

      await agentWithiOS.initialize();
      const health = await agentWithiOS.healthCheck();

      expect(health.components.ios).toBe('healthy');
      expect(mockiOSManagementTool.validateAPNSConfig).toHaveBeenCalled();
    });
  });

  describe('updateConfig', () => {
    it('should update configuration', () => {
      const updates = { spendThreshold: 20 };
      
      agent.updateConfig(updates);
      
      const updatedConfig = agent.getConfig();
      expect(updatedConfig.spendThreshold).toBe(20);
      expect(updatedConfig.snsTopicArn).toBe(mockConfig.snsTopicArn); // Other values preserved
    });

    it('should not modify original config object', () => {
      const originalThreshold = mockConfig.spendThreshold;
      
      agent.updateConfig({ spendThreshold: 20 });
      
      expect(mockConfig.spendThreshold).toBe(originalThreshold);
    });
  });
});