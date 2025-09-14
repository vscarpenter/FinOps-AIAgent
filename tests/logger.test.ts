import { Logger, createLogger } from '../src/utils/logger';

// Mock console methods
const mockConsoleLog = jest.fn();
const mockConsoleError = jest.fn();
const mockConsoleWarn = jest.fn();
const mockConsoleDebug = jest.fn();

beforeAll(() => {
  global.console = {
    ...console,
    log: mockConsoleLog,
    error: mockConsoleError,
    warn: mockConsoleWarn,
    debug: mockConsoleDebug
  };
});

beforeEach(() => {
  jest.clearAllMocks();
});

describe('Logger', () => {
  describe('constructor', () => {
    it('should create logger with context and auto-generated correlation ID', () => {
      const logger = new Logger('TestContext');
      
      expect(logger.getCorrelationId()).toBeDefined();
      expect(logger.getCorrelationId()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    });

    it('should create logger with provided correlation ID', () => {
      const correlationId = 'test-correlation-id';
      const logger = new Logger('TestContext', correlationId);
      
      expect(logger.getCorrelationId()).toBe(correlationId);
    });
  });

  describe('child logger', () => {
    it('should create child logger with same correlation ID', () => {
      const parentLogger = new Logger('ParentContext');
      const childLogger = parentLogger.child('ChildContext');
      
      expect(childLogger.getCorrelationId()).toBe(parentLogger.getCorrelationId());
    });
  });

  describe('info logging', () => {
    it('should log info message with structured format', () => {
      const logger = new Logger('TestContext', 'test-id');
      logger.info('Test message');

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('"level":"INFO"')
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('"message":"Test message"')
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('"correlationId":"test-id"')
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('"context":"TestContext"')
      );
    });

    it('should log info message with metadata', () => {
      const logger = new Logger('TestContext', 'test-id');
      const metadata = { key1: 'value1', key2: 42 };
      
      logger.info('Test message', metadata);

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('"key1":"value1"')
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('"key2":42')
      );
    });
  });

  describe('error logging', () => {
    it('should log error message with error details', () => {
      const logger = new Logger('TestContext', 'test-id');
      const error = new Error('Test error');
      error.stack = 'Error stack trace';
      
      logger.error('Error occurred', error);

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('"level":"ERROR"')
      );
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('"errorName":"Error"')
      );
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('"errorMessage":"Test error"')
      );
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('"errorStack":"Error stack trace"')
      );
    });

    it('should log error message without error object', () => {
      const logger = new Logger('TestContext', 'test-id');
      
      logger.error('Error occurred');

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('"level":"ERROR"')
      );
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('"message":"Error occurred"')
      );
    });
  });

  describe('warn logging', () => {
    it('should log warning message', () => {
      const logger = new Logger('TestContext', 'test-id');
      
      logger.warn('Warning message');

      expect(mockConsoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('"level":"WARN"')
      );
      expect(mockConsoleWarn).toHaveBeenCalledWith(
        expect.stringContaining('"message":"Warning message"')
      );
    });
  });

  describe('debug logging', () => {
    it('should log debug message when LOG_LEVEL is DEBUG', () => {
      process.env.LOG_LEVEL = 'DEBUG';
      const logger = new Logger('TestContext', 'test-id');
      
      logger.debug('Debug message');

      expect(mockConsoleDebug).toHaveBeenCalledWith(
        expect.stringContaining('"level":"DEBUG"')
      );
      expect(mockConsoleDebug).toHaveBeenCalledWith(
        expect.stringContaining('"message":"Debug message"')
      );
      
      delete process.env.LOG_LEVEL;
    });

    it('should not log debug message when LOG_LEVEL is not DEBUG', () => {
      const logger = new Logger('TestContext', 'test-id');
      
      logger.debug('Debug message');

      expect(mockConsoleDebug).not.toHaveBeenCalled();
    });
  });

  describe('logDuration', () => {
    it('should log operation duration', () => {
      const logger = new Logger('TestContext', 'test-id');
      const startTime = Date.now() - 1000; // 1 second ago
      
      logger.logDuration('TestOperation', startTime);

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('"operation":"TestOperation"')
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('"durationMs"')
      );
    });
  });

  describe('logCostAnalysis', () => {
    it('should log cost analysis results', () => {
      const logger = new Logger('TestContext', 'test-id');
      const costAnalysis = {
        totalCost: 15.50,
        projectedMonthly: 25.00,
        serviceBreakdown: {
          'EC2': 10.00,
          'S3': 3.50,
          'Lambda': 2.00
        },
        period: { start: '2023-01-01', end: '2023-01-15' }
      };
      
      logger.logCostAnalysis(costAnalysis);

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('"totalCost":15.5')
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('"projectedMonthly":25')
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('"serviceCount":3')
      );
    });
  });

  describe('logAlertDelivery', () => {
    it('should log successful alert delivery', () => {
      const logger = new Logger('TestContext', 'test-id');
      const channels = ['email', 'sms', 'ios'];
      
      logger.logAlertDelivery(true, channels);

      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('"message":"Alert delivered successfully"')
      );
      expect(mockConsoleLog).toHaveBeenCalledWith(
        expect.stringContaining('"channelCount":3')
      );
    });

    it('should log failed alert delivery', () => {
      const logger = new Logger('TestContext', 'test-id');
      const channels = ['email', 'sms'];
      
      logger.logAlertDelivery(false, channels);

      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('"message":"Alert delivery failed"')
      );
      expect(mockConsoleError).toHaveBeenCalledWith(
        expect.stringContaining('"channelCount":2')
      );
    });
  });
});

describe('createLogger', () => {
  it('should create logger instance', () => {
    const logger = createLogger('TestContext');
    
    expect(logger).toBeInstanceOf(Logger);
    expect(logger.getCorrelationId()).toBeDefined();
  });

  it('should create logger with correlation ID', () => {
    const correlationId = 'test-correlation-id';
    const logger = createLogger('TestContext', correlationId);
    
    expect(logger.getCorrelationId()).toBe(correlationId);
  });
});