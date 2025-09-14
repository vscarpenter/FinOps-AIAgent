import { SpendMonitorTask, SpendMonitorTaskResult, SpendMonitorTaskMetadata } from '../src/tasks/spend-monitor-task';
import { SpendMonitorConfig, CostAnalysis, AlertContext } from '../src/types';
import { ValidationError } from '../src/validation';

// Mock the validation module
jest.mock('../src/validation', () => ({
  validateSpendMonitorConfig: jest.fn(),
  ValidationError: class ValidationError extends Error {
    constructor(message: string, public field?: string) {
      super(message);
      this.name = 'ValidationError';
    }
  }
}));

const { validateSpendMonitorConfig } = require('../src/validation');

describe('SpendMonitorTask', () => {
  let task: SpendMonitorTask;
  let mockConfig: SpendMonitorConfig;

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

    task = new SpendMonitorTask(mockConfig);
  });

  describe('constructor', () => {
    it('should initialize task with correct metadata', () => {
      const metadata = task.getMetadata();

      expect(metadata.taskType).toBe('spend-monitor');
      expect(metadata.threshold).toBe(mockConfig.spendThreshold);
      expect(metadata.region).toBe(mockConfig.region);
      expect(metadata.checkPeriodDays).toBe(mockConfig.checkPeriodDays);
      expect(metadata.status).toBe('pending');
      expect(metadata.executionCount).toBe(0);
      expect(metadata.taskId).toMatch(/^spend-monitor-\d+-[a-z0-9]+$/);
      expect(new Date(metadata.createdAt)).toBeInstanceOf(Date);
    });

    it('should generate unique task IDs', () => {
      const task1 = new SpendMonitorTask(mockConfig);
      const task2 = new SpendMonitorTask(mockConfig);

      expect(task1.getMetadata().taskId).not.toBe(task2.getMetadata().taskId);
    });
  });

  describe('validate', () => {
    it('should validate configuration successfully', async () => {
      validateSpendMonitorConfig.mockImplementation(() => {});

      await expect(task.validate(mockConfig)).resolves.not.toThrow();
      expect(validateSpendMonitorConfig).toHaveBeenCalledWith(mockConfig);
    });

    it('should throw error for invalid configuration', async () => {
      const error = new ValidationError('Invalid configuration');
      validateSpendMonitorConfig.mockImplementation(() => {
        throw error;
      });

      await expect(task.validate(mockConfig)).rejects.toThrow('Invalid configuration');
    });

    it('should throw error for zero spend threshold', async () => {
      validateSpendMonitorConfig.mockImplementation(() => {});
      const invalidConfig = { ...mockConfig, spendThreshold: 0 };

      await expect(task.validate(invalidConfig)).rejects.toThrow('Spend threshold must be greater than 0');
    });

    it('should throw error for negative spend threshold', async () => {
      validateSpendMonitorConfig.mockImplementation(() => {});
      const invalidConfig = { ...mockConfig, spendThreshold: -5 };

      await expect(task.validate(invalidConfig)).rejects.toThrow('Spend threshold must be greater than 0');
    });

    it('should throw error for zero check period days', async () => {
      validateSpendMonitorConfig.mockImplementation(() => {});
      const invalidConfig = { ...mockConfig, checkPeriodDays: 0 };

      await expect(task.validate(invalidConfig)).rejects.toThrow('Check period days must be greater than 0');
    });

    it('should throw error for negative check period days', async () => {
      validateSpendMonitorConfig.mockImplementation(() => {});
      const invalidConfig = { ...mockConfig, checkPeriodDays: -1 };

      await expect(task.validate(invalidConfig)).rejects.toThrow('Check period days must be greater than 0');
    });
  });

  describe('execute', () => {
    beforeEach(() => {
      validateSpendMonitorConfig.mockImplementation(() => {});
    });

    it('should execute task successfully', async () => {
      const result = await task.execute(mockConfig);

      expect(result.success).toBe(true);
      expect(result.executionId).toMatch(/^exec-\d+-[a-z0-9]+$/);
      expect(result.alertSent).toBe(false);
      expect(result.thresholdExceeded).toBe(false);
      expect(result.duration).toBeGreaterThan(0);
      expect(new Date(result.startTime)).toBeInstanceOf(Date);
      expect(new Date(result.endTime)).toBeInstanceOf(Date);
      expect(result.progressSteps).toHaveLength(5);
      expect(result.progressSteps.every(step => step.status === 'completed')).toBe(true);
    });

    it('should update metadata during execution', async () => {
      const initialMetadata = task.getMetadata();
      expect(initialMetadata.executionCount).toBe(0);
      expect(initialMetadata.status).toBe('pending');

      await task.execute(mockConfig);

      const updatedMetadata = task.getMetadata();
      expect(updatedMetadata.executionCount).toBe(1);
      expect(updatedMetadata.status).toBe('completed');
      expect(updatedMetadata.lastExecuted).toBeDefined();
    });

    it('should track progress steps correctly', async () => {
      const result = await task.execute(mockConfig);

      const expectedSteps = ['validation', 'cost-analysis', 'threshold-check', 'alert-processing', 'cleanup'];
      expect(result.progressSteps.map(s => s.step)).toEqual(expectedSteps);

      result.progressSteps.forEach(step => {
        expect(step.status).toBe('completed');
        expect(step.startTime).toBeDefined();
        expect(step.endTime).toBeDefined();
        expect(new Date(step.startTime!)).toBeInstanceOf(Date);
        expect(new Date(step.endTime!)).toBeInstanceOf(Date);
      });
    });

    it('should handle validation failure', async () => {
      const validationError = new ValidationError('Configuration invalid');
      validateSpendMonitorConfig.mockImplementation(() => {
        throw validationError;
      });

      const result = await task.execute(mockConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Configuration invalid');
      expect(result.metadata.status).toBe('failed');

      const validationStep = result.progressSteps.find(s => s.step === 'validation');
      expect(validationStep?.status).toBe('failed');
      expect(validationStep?.error).toBe('Configuration invalid');
    });

    it('should handle execution errors gracefully', async () => {
      // Mock console.log to throw an error during one of the steps
      const originalConsoleLog = console.log;
      console.log = jest.fn().mockImplementation((message) => {
        if (message.includes('Cost analysis step')) {
          throw new Error('Simulated execution error');
        }
      });

      const result = await task.execute(mockConfig);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Simulated execution error');
      expect(result.metadata.status).toBe('failed');

      // Restore console.log
      console.log = originalConsoleLog;
    });

    it('should generate unique execution IDs', async () => {
      const result1 = await task.execute(mockConfig);
      const result2 = await task.execute(mockConfig);

      expect(result1.executionId).not.toBe(result2.executionId);
    });

    it('should increment execution count on multiple runs', async () => {
      await task.execute(mockConfig);
      await task.execute(mockConfig);
      await task.execute(mockConfig);

      const metadata = task.getMetadata();
      expect(metadata.executionCount).toBe(3);
    });
  });

  describe('context management', () => {
    it('should set and get cost analysis', () => {
      const costAnalysis: CostAnalysis = {
        totalCost: 15.50,
        serviceBreakdown: { 'EC2-Instance': 10.00, 'S3': 5.50 },
        period: { start: '2023-01-01', end: '2023-01-31' },
        projectedMonthly: 31.00,
        currency: 'USD',
        lastUpdated: '2023-01-15T10:00:00Z'
      };

      task.setCostAnalysis(costAnalysis);
      
      // Context is only available during execution
      expect(task.getContext()).toBeUndefined();
    });

    it('should set and get alert context', () => {
      const alertContext: AlertContext = {
        threshold: 10,
        exceedAmount: 5.50,
        percentageOver: 55,
        topServices: [
          { serviceName: 'EC2-Instance', cost: 10.00, percentage: 64.5 },
          { serviceName: 'S3', cost: 5.50, percentage: 35.5 }
        ],
        alertLevel: 'WARNING'
      };

      task.setAlertContext(alertContext);
      
      // Context is only available during execution
      expect(task.getContext()).toBeUndefined();
    });

    it('should provide context during execution', async () => {
      validateSpendMonitorConfig.mockImplementation(() => {});

      // Mock the executeStep method to capture context
      let capturedContext: any = null;
      const originalExecuteStep = (task as any).executeStep;
      (task as any).executeStep = async function(stepName: string, stepFunction: () => Promise<void>) {
        if (stepName === 'cost-analysis') {
          capturedContext = this.getContext();
        }
        return originalExecuteStep.call(this, stepName, stepFunction);
      };

      await task.execute(mockConfig);

      expect(capturedContext).toBeDefined();
      expect(capturedContext.config).toEqual(mockConfig);
      expect(capturedContext.executionStartTime).toBeDefined();
      expect(capturedContext.progressSteps).toHaveLength(5);
    });
  });

  describe('progress tracking', () => {
    it('should return correct progress before execution', () => {
      const progress = task.getProgress();

      expect(progress.completed).toBe(0);
      expect(progress.total).toBe(0);
      expect(progress.currentStep).toBeUndefined();
    });

    it('should track progress during execution', async () => {
      validateSpendMonitorConfig.mockImplementation(() => {});

      // Mock executeStep to capture progress at different points
      const progressSnapshots: any[] = [];
      const originalExecuteStep = (task as any).executeStep;
      (task as any).executeStep = async function(stepName: string, stepFunction: () => Promise<void>) {
        const result = await originalExecuteStep.call(this, stepName, stepFunction);
        progressSnapshots.push(this.getProgress());
        return result;
      };

      await task.execute(mockConfig);

      expect(progressSnapshots).toHaveLength(5);
      expect(progressSnapshots[0].completed).toBe(1); // After validation
      expect(progressSnapshots[4].completed).toBe(5); // After cleanup
    });
  });

  describe('reset', () => {
    it('should reset task state', async () => {
      validateSpendMonitorConfig.mockImplementation(() => {});
      
      await task.execute(mockConfig);
      
      const metadataBeforeReset = task.getMetadata();
      expect(metadataBeforeReset.status).toBe('completed');
      expect(metadataBeforeReset.executionCount).toBe(1);

      task.reset();

      const metadataAfterReset = task.getMetadata();
      expect(metadataAfterReset.status).toBe('pending');
      expect(metadataAfterReset.executionCount).toBe(1); // Execution count should not reset
      expect(task.getContext()).toBeUndefined();
    });
  });

  describe('statistics', () => {
    it('should provide correct statistics', async () => {
      validateSpendMonitorConfig.mockImplementation(() => {});

      const initialStats = task.getStatistics();
      expect(initialStats.totalExecutions).toBe(0);
      expect(initialStats.lastExecuted).toBeUndefined();
      expect(initialStats.currentStatus).toBe('pending');
      expect(initialStats.createdAt).toBeDefined();

      await task.execute(mockConfig);

      const updatedStats = task.getStatistics();
      expect(updatedStats.totalExecutions).toBe(1);
      expect(updatedStats.lastExecuted).toBeDefined();
      expect(updatedStats.currentStatus).toBe('completed');
    });

    it('should track multiple executions in statistics', async () => {
      validateSpendMonitorConfig.mockImplementation(() => {});

      await task.execute(mockConfig);
      await task.execute(mockConfig);

      const stats = task.getStatistics();
      expect(stats.totalExecutions).toBe(2);
    });
  });

  describe('error handling', () => {
    it('should handle missing context gracefully', async () => {
      // Try to execute a step without proper context initialization
      await expect((task as any).executeStep('test', async () => {})).rejects.toThrow('Task context not initialized');
    });

    it('should handle unknown step names', async () => {
      validateSpendMonitorConfig.mockImplementation(() => {});

      // Mock the context to be initialized
      (task as any).context = {
        config: mockConfig,
        executionStartTime: new Date().toISOString(),
        progressSteps: []
      };

      await expect((task as any).executeStep('unknown-step', async () => {})).rejects.toThrow('Step not found: unknown-step');
    });

    it('should capture step errors correctly', async () => {
      validateSpendMonitorConfig.mockImplementation(() => {
        throw new Error('Validation failed');
      });

      const result = await task.execute(mockConfig);

      expect(result.success).toBe(false);
      const validationStep = result.progressSteps.find(s => s.step === 'validation');
      expect(validationStep?.status).toBe('failed');
      expect(validationStep?.error).toBe('Validation failed');
      expect(validationStep?.startTime).toBeDefined();
      expect(validationStep?.endTime).toBeDefined();
    });
  });
});