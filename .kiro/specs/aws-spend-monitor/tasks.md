# Implementation Plan

- [x] 1. Update project dependencies and configuration
  - Update package.json with latest AWS SDK v3 dependencies
  - Configure TypeScript compilation settings for Strands framework
  - Add necessary AWS SDK client packages for Cost Explorer and SNS
  - _Requirements: 6.1, 6.2_

- [x] 2. Implement core data models and interfaces
  - Create TypeScript interfaces for CostAnalysis, AlertContext, and ServiceCost
  - Define SpendMonitorConfig interface extending AgentConfig with iOS configuration
  - Add iOSPushConfig, iOSDeviceRegistration, and APNSPayload interfaces
  - Implement validation functions for configuration parameters including iOS settings
  - Write unit tests for data model validation including iOS-specific models
  - _Requirements: 4.3, 6.1, 6.5, 7.2, 7.3_

- [x] 3. Implement CostAnalysisTool class
  - Create CostAnalysisTool extending base Tool class from Strands
  - Implement getCurrentMonthCosts() method using Cost Explorer API
  - Add cost calculation and service breakdown logic
  - Implement projected monthly cost calculation based on elapsed days
  - Add error handling with exponential backoff for API rate limits
  - Write comprehensive unit tests with mocked Cost Explorer responses
  - _Requirements: 1.1, 1.2, 1.3, 5.1, 5.2, 5.3, 6.2, 6.4_

- [x] 4. Implement AlertTool class with multi-channel support
  - Create AlertTool extending base Tool class from Strands
  - Implement sendSpendAlert() method with SNS integration for all channels
  - Create formatAlertMessage() method for email/SMS with detailed cost breakdown
  - Add formatIOSPayload() method to create APNS-compatible JSON payload
  - Add retry logic for failed SNS deliveries (up to 3 attempts)
  - Implement service cost sorting and formatting for alert messages
  - Add channel validation and fallback logic for notification failures
  - Write unit tests with mocked SNS client and delivery scenarios for all channels
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 5.4, 6.2, 6.4, 6.7, 6.8_

- [x] 5. Implement iOSManagementTool class
  - Create iOSManagementTool extending base Tool class from Strands
  - Implement registerDevice() method to create SNS platform endpoints
  - Add updateDeviceToken() method for token refresh scenarios
  - Create removeInvalidTokens() method to clean up expired tokens
  - Implement validateAPNSConfig() method to check certificate validity
  - Add device token format validation (64-character hex string)
  - Write unit tests with mocked SNS platform operations
  - _Requirements: 7.3, 7.4, 7.5, 7.6_

- [x] 6. Implement SpendMonitorTask class
  - Create SpendMonitorTask extending base Task class from Strands
  - Implement execute() method with task metadata and validation
  - Add task progress tracking and result reporting
  - Write unit tests for task execution and metadata handling
  - _Requirements: 8.3, 8.5_

- [x] 7. Implement SpendMonitorAgent class with iOS support
  - Create SpendMonitorAgent extending base Agent class from Strands
  - Implement initialize() method to register all tools including iOSManagementTool
  - Create execute() method orchestrating cost analysis and multi-channel alerting
  - Add configuration validation for iOS settings and AWS client initialization
  - Implement proper error handling and logging throughout agent execution
  - Add iOS-specific error handling for APNS certificate and token issues
  - Write integration tests for agent orchestration with mocked tools including iOS
  - _Requirements: 1.4, 3.3, 4.1, 4.2, 7.7, 8.1, 8.4, 8.5_

- [x] 8. Create Lambda handler and entry point with iOS support
  - Implement Lambda handler function in index.ts
  - Add configuration loading from environment variables including iOS settings
  - Create agent initialization and execution logic for serverless environment
  - Add proper error handling and response formatting for Lambda
  - Write tests for Lambda handler with various event scenarios including iOS
  - _Requirements: 3.1, 3.3, 4.4, 7.2_

- [x] 9. Update CDK infrastructure code with iOS support
  - Update infrastructure.ts with correct AWS CDK v2 imports and patterns
  - Configure Lambda function with increased memory (512MB) for iOS processing
  - Set up EventBridge rule for daily execution at configurable time
  - Create SNS topic with proper naming and configuration
  - Add SNS Platform Application for APNS with certificate configuration
  - Add comprehensive IAM permissions for Cost Explorer, SNS, and platform applications
  - Configure environment variables for all configuration parameters including iOS
  - Add CloudWatch log group with retention policy
  - Create optional DynamoDB table for device token storage
  - _Requirements: 3.1, 3.2, 4.1, 4.2, 4.3, 7.1, 7.2_

- [x] 10. Add monitoring and observability features
  - Implement structured logging with correlation IDs throughout the agent
  - Add CloudWatch custom metrics for execution duration and success rates
  - Create CloudWatch alarms for Lambda errors and execution failures
  - Add detailed logging for cost analysis results and alert delivery status
  - Write tests for logging and metrics functionality
  - _Requirements: 1.4, 2.5, 3.3_

- [x] 11. Implement comprehensive error handling and resilience
  - Add exponential backoff retry logic for Cost Explorer API calls
  - Implement circuit breaker pattern for external service failures
  - Create graceful degradation for partial service failures
  - Add validation for all configuration parameters with clear error messages
  - Write tests for all error scenarios and recovery mechanisms
  - _Requirements: 1.2, 1.3, 2.4, 4.3, 8.4_

- [ ] 12. Create end-to-end integration tests
  - Write integration tests using real AWS services in test environment
  - Create test scenarios for under-threshold, over-threshold, and edge cases
  - Implement test data setup and cleanup for Cost Explorer API testing
  - Add tests for SNS message delivery and formatting for all channels
  - Create performance tests for Lambda execution duration
  - _Requirements: 1.1, 2.1, 3.1, 5.1_

- [ ] 13. Create iOS device registration API (Optional)
  - Create API Gateway REST API for device token registration
  - Implement Lambda function for device registration endpoint
  - Add authentication and rate limiting for registration API
  - Create device token validation and SNS endpoint creation logic
  - Add device management endpoints (update, delete, list)
  - Write unit tests for API endpoints and device management
  - _Requirements: 7.3, 7.4_

- [ ] 14. Implement iOS notification testing and validation
  - Create test utilities for APNS payload validation
  - Add integration tests for iOS push notification delivery
  - Implement test device registration and notification scenarios
  - Create APNS sandbox testing configuration
  - Add tests for invalid token handling and cleanup
  - Write performance tests for iOS notification processing
  - _Requirements: 6.5, 6.6, 6.9, 7.5_

- [ ] 15. Add iOS-specific monitoring and error handling
  - Implement APNS feedback service processing for invalid tokens
  - Add CloudWatch metrics for iOS notification success/failure rates
  - Create alarms for APNS certificate expiration warnings
  - Add structured logging for iOS device registration and notifications
  - Implement graceful fallback when iOS notifications fail
  - Write tests for iOS-specific error scenarios and recovery
  - _Requirements: 6.8, 7.5, 7.7_

- [ ] 16. Create iOS setup documentation and scripts
  - Create step-by-step guide for Apple Developer account setup
  - Add APNS certificate generation and configuration instructions
  - Create scripts for SNS platform application setup
  - Add device registration examples and testing procedures
  - Create troubleshooting guide for common iOS notification issues
  - Write deployment validation for iOS configuration
  - _Requirements: 6.9, 7.1, 7.2_

- [ ] 17. Add configuration validation and deployment scripts
  - Create deployment validation script to check IAM permissions including iOS
  - Add configuration validation for SNS topic ARN, threshold values, and iOS settings
  - Implement pre-deployment checks for required AWS services and APNS certificates
  - Create deployment documentation with configuration examples including iOS
  - Write tests for deployment validation logic including iOS components
  - _Requirements: 4.1, 4.2, 4.3, 4.4, 7.1, 7.2_