import { AgentConfig } from 'strands-agents';

/**
 * Core data model for cost analysis results
 */
export interface CostAnalysis {
  /** Current month-to-date total cost in USD */
  totalCost: number;
  /** Cost breakdown by AWS service */
  serviceBreakdown: { [service: string]: number };
  /** Time period for the cost data */
  period: {
    /** Period start date (ISO string) */
    start: string;
    /** Period end date (ISO string) */
    end: string;
  };
  /** Projected full month cost based on current usage */
  projectedMonthly: number;
  /** Currency code (e.g., 'USD') */
  currency: string;
  /** Timestamp when data was retrieved */
  lastUpdated: string;
}

/**
 * Context information for alert generation
 */
export interface AlertContext {
  /** Configured spending threshold */
  threshold: number;
  /** Amount over the threshold */
  exceedAmount: number;
  /** Percentage over threshold */
  percentageOver: number;
  /** Top cost-driving services */
  topServices: ServiceCost[];
  /** Alert severity level */
  alertLevel: 'WARNING' | 'CRITICAL';
}

/**
 * Individual service cost information
 */
export interface ServiceCost {
  /** AWS service name */
  serviceName: string;
  /** Cost amount for this service */
  cost: number;
  /** Percentage of total cost */
  percentage: number;
}

/**
 * iOS push notification configuration
 */
export interface iOSPushConfig {
  /** SNS platform application ARN for APNS */
  platformApplicationArn: string;
  /** Path to APNS certificate file */
  apnsCertificatePath?: string;
  /** Path to APNS private key file */
  apnsPrivateKeyPath?: string;
  /** iOS app bundle identifier */
  bundleId: string;
  /** Use APNS sandbox environment */
  sandbox: boolean;
}

/**
 * Configuration for the spend monitor agent
 */
export interface SpendMonitorConfig extends AgentConfig {
  /** Alert threshold in USD */
  spendThreshold: number;
  /** SNS topic ARN for notifications */
  snsTopicArn: string;
  /** Check frequency in days */
  checkPeriodDays: number;
  /** AWS region */
  region: string;
  /** Maximum retry attempts for failed operations */
  retryAttempts: number;
  /** Minimum cost threshold to show service in breakdown */
  minServiceCostThreshold: number;
  /** iOS push notification configuration (optional) */
  iosConfig?: iOSPushConfig;
}

/**
 * iOS device registration information
 */
export interface iOSDeviceRegistration {
  /** APNS device token */
  deviceToken: string;
  /** SNS platform endpoint ARN */
  platformEndpointArn: string;
  /** Optional user identifier */
  userId?: string;
  /** Registration timestamp */
  registrationDate: string;
  /** Last update timestamp */
  lastUpdated: string;
  /** Device active status */
  active: boolean;
}

/**
 * APNS payload structure for iOS push notifications
 */
export interface APNSPayload {
  /** Apple Push Notification Service payload */
  aps: {
    /** Alert content */
    alert: {
      /** Notification title */
      title: string;
      /** Notification body */
      body: string;
      /** Optional subtitle */
      subtitle?: string;
    };
    /** App badge count */
    badge: number;
    /** Notification sound */
    sound: string;
    /** Background update flag */
    'content-available': number;
  };
  /** Custom data for the app */
  customData: {
    /** Current spending amount */
    spendAmount: number;
    /** Configured threshold */
    threshold: number;
    /** Amount over threshold */
    exceedAmount: number;
    /** Highest cost service */
    topService: string;
    /** Unique alert identifier */
    alertId: string;
  };
}

/**
 * Retry configuration for failed operations
 */
export interface RetryConfig {
  /** Maximum number of retry attempts */
  maxAttempts: number;
  /** Base delay in milliseconds */
  baseDelay: number;
  /** Maximum delay in milliseconds */
  maxDelay: number;
  /** Backoff multiplier for exponential backoff */
  backoffMultiplier: number;
}

/**
 * Test data scenarios for cost analysis
 */
export interface TestCostData {
  scenarios: {
    underThreshold: CostAnalysis;
    overThreshold: CostAnalysis;
    exactThreshold: CostAnalysis;
    multipleServices: CostAnalysis;
    singleService: CostAnalysis;
  };
}

/**
 * API request/response types for device registration
 */

/**
 * Request to register a new iOS device
 */
export interface DeviceRegistrationRequest {
  /** APNS device token (64-character hex string) */
  deviceToken: string;
  /** Optional user identifier */
  userId?: string;
  /** iOS app bundle identifier */
  bundleId: string;
}

/**
 * Response from device registration
 */
export interface DeviceRegistrationResponse {
  /** Registration success status */
  success: boolean;
  /** SNS platform endpoint ARN if successful */
  platformEndpointArn?: string;
  /** Error message if failed */
  error?: string;
  /** Registration timestamp */
  registrationDate: string;
}

/**
 * Request to update device token
 */
export interface DeviceUpdateRequest {
  /** Current device token */
  currentToken: string;
  /** New device token */
  newToken: string;
  /** Optional user identifier */
  userId?: string;
}

/**
 * Response from device update
 */
export interface DeviceUpdateResponse {
  /** Update success status */
  success: boolean;
  /** Updated platform endpoint ARN if successful */
  platformEndpointArn?: string;
  /** Error message if failed */
  error?: string;
  /** Update timestamp */
  lastUpdated: string;
}

/**
 * Request to list user devices
 */
export interface DeviceListRequest {
  /** User identifier */
  userId: string;
  /** Optional pagination token */
  nextToken?: string;
  /** Maximum number of devices to return */
  limit?: number;
}

/**
 * Response from device list
 */
export interface DeviceListResponse {
  /** List success status */
  success: boolean;
  /** Array of registered devices */
  devices?: iOSDeviceRegistration[];
  /** Pagination token for next page */
  nextToken?: string;
  /** Error message if failed */
  error?: string;
}

/**
 * Request to delete a device registration
 */
export interface DeviceDeleteRequest {
  /** Device token to delete */
  deviceToken: string;
  /** Optional user identifier for authorization */
  userId?: string;
}

/**
 * Response from device deletion
 */
export interface DeviceDeleteResponse {
  /** Deletion success status */
  success: boolean;
  /** Error message if failed */
  error?: string;
  /** Deletion timestamp */
  deletedAt: string;
}

/**
 * API Gateway Lambda event context
 */
export interface APIGatewayEvent {
  /** HTTP method */
  httpMethod: string;
  /** Request path */
  path: string;
  /** Path parameters */
  pathParameters: { [key: string]: string } | null;
  /** Query string parameters */
  queryStringParameters: { [key: string]: string } | null;
  /** Request headers */
  headers: { [key: string]: string };
  /** Request body */
  body: string | null;
  /** Request context */
  requestContext: {
    /** Request ID */
    requestId: string;
    /** Source IP */
    identity: {
      sourceIp: string;
    };
  };
}

/**
 * API Gateway Lambda response
 */
export interface APIGatewayResponse {
  /** HTTP status code */
  statusCode: number;
  /** Response headers */
  headers: { [key: string]: string };
  /** Response body (JSON string) */
  body: string;
}