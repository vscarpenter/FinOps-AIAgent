import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as cloudwatchActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';

export class SpendMonitorStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // CloudWatch Log Group with retention policy
    const logGroup = new logs.LogGroup(this, 'SpendMonitorLogGroup', {
      logGroupName: '/aws/lambda/spend-monitor-agent',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // SNS Topic for alerts
    const alertTopic = new sns.Topic(this, 'SpendAlertTopic', {
      displayName: 'AWS Spend Monitor Alerts',
      topicName: 'aws-spend-alerts'
    });

    // SNS Platform Application for APNS (iOS push notifications) - optional
    let iosPlatformApp: cdk.CfnResource | undefined;
    const apnsCertificate = this.node.tryGetContext('apnsCertificate');
    const apnsPrivateKey = this.node.tryGetContext('apnsPrivateKey');
    
    if (apnsCertificate && apnsPrivateKey) {
      iosPlatformApp = new cdk.CfnResource(this, 'iOSPlatformApplication', {
        type: 'AWS::SNS::PlatformApplication',
        properties: {
          Name: 'SpendMonitorAPNS',
          Platform: 'APNS_SANDBOX', // Use APNS_SANDBOX for development
          Attributes: {
            PlatformCredential: apnsCertificate,
            PlatformPrincipal: apnsPrivateKey
          }
        }
      });
    }

    // Optional DynamoDB table for device token storage
    const deviceTokenTable = new dynamodb.Table(this, 'DeviceTokenTable', {
      tableName: 'spend-monitor-device-tokens',
      partitionKey: {
        name: 'deviceToken',
        type: dynamodb.AttributeType.STRING
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true
      }
    });

    // Lambda function for the Strands agent
    const agentFunction = new lambda.Function(this, 'SpendMonitorAgent', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset('dist'),
      timeout: cdk.Duration.minutes(5),
      memorySize: 512, // Increased memory for iOS processing
      logGroup: logGroup,
      environment: {
        SNS_TOPIC_ARN: alertTopic.topicArn,
        SPEND_THRESHOLD: this.node.tryGetContext('spendThreshold') || '10',
        CHECK_PERIOD_DAYS: this.node.tryGetContext('checkPeriodDays') || '1',
        RETRY_ATTEMPTS: this.node.tryGetContext('retryAttempts') || '3',
        MIN_SERVICE_COST: this.node.tryGetContext('minServiceCost') || '1',
        IOS_PLATFORM_APP_ARN: iosPlatformApp?.ref || '',
        IOS_BUNDLE_ID: this.node.tryGetContext('iosBundleId') || 'com.example.spendmonitor',
        APNS_SANDBOX: this.node.tryGetContext('apnsSandbox') || 'true',
        DEVICE_TOKEN_TABLE_NAME: deviceTokenTable.tableName
      }
    });

    // IAM permissions for Cost Explorer
    agentFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ce:GetCostAndUsage',
        'ce:GetUsageReport',
        'ce:GetDimensionValues',
        'ce:GetReservationCoverage',
        'ce:GetReservationPurchaseRecommendation',
        'ce:GetReservationUtilization'
      ],
      resources: ['*']
    }));

    // Grant SNS publish permissions
    alertTopic.grantPublish(agentFunction);

    // Grant SNS platform application permissions for iOS push notifications (if platform app exists)
    if (iosPlatformApp) {
      agentFunction.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'sns:CreatePlatformEndpoint',
          'sns:DeleteEndpoint',
          'sns:GetEndpointAttributes',
          'sns:SetEndpointAttributes',
          'sns:ListEndpointsByPlatformApplication',
          'sns:GetPlatformApplicationAttributes'
        ],
        resources: [
          iosPlatformApp.ref,
          `${iosPlatformApp.ref}/*`
        ]
      }));
    }

    // Grant DynamoDB permissions for device token management
    deviceTokenTable.grantReadWriteData(agentFunction);

    // Device Registration API Lambda Function
    const deviceRegistrationFunction = new lambda.Function(this, 'DeviceRegistrationFunction', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'device-registration-index.handler',
      code: lambda.Code.fromAsset('dist'),
      timeout: cdk.Duration.seconds(30),
      memorySize: 256,
      environment: {
        IOS_PLATFORM_APP_ARN: iosPlatformApp?.ref || '',
        DEVICE_TOKEN_TABLE_NAME: deviceTokenTable.tableName,
        IOS_BUNDLE_ID: this.node.tryGetContext('iosBundleId') || 'com.example.spendmonitor'
      }
    });

    // Grant permissions for device registration function
    deviceTokenTable.grantReadWriteData(deviceRegistrationFunction);

    // Grant SNS platform application permissions for device registration
    if (iosPlatformApp) {
      deviceRegistrationFunction.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: [
          'sns:CreatePlatformEndpoint',
          'sns:DeleteEndpoint',
          'sns:GetEndpointAttributes',
          'sns:SetEndpointAttributes',
          'sns:ListEndpointsByPlatformApplication',
          'sns:GetPlatformApplicationAttributes'
        ],
        resources: [
          iosPlatformApp.ref,
          `${iosPlatformApp.ref}/*`
        ]
      }));
    }

    // API Gateway for device registration
    const deviceRegistrationApi = new apigateway.RestApi(this, 'DeviceRegistrationApi', {
      restApiName: 'iOS Device Registration API',
      description: 'API for managing iOS device registrations for spend monitor notifications',
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key', 'X-Amz-Security-Token']
      },
      deployOptions: {
        stageName: 'v1',
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        metricsEnabled: true
      }
    });

    // Lambda integration for device registration
    const deviceRegistrationIntegration = new apigateway.LambdaIntegration(deviceRegistrationFunction, {
      requestTemplates: { 'application/json': '{ "statusCode": "200" }' }
    });

    // API Gateway resources and methods
    const devicesResource = deviceRegistrationApi.root.addResource('devices');
    
    // POST /devices - Register new device
    devicesResource.addMethod('POST', deviceRegistrationIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE,
      apiKeyRequired: true,
      requestValidator: new apigateway.RequestValidator(this, 'DeviceRegistrationValidator', {
        restApi: deviceRegistrationApi,
        requestValidatorName: 'device-registration-validator',
        validateRequestBody: true,
        validateRequestParameters: false
      }),
      requestModels: {
        'application/json': new apigateway.Model(this, 'DeviceRegistrationModel', {
          restApi: deviceRegistrationApi,
          modelName: 'DeviceRegistrationRequest',
          schema: {
            type: apigateway.JsonSchemaType.OBJECT,
            properties: {
              deviceToken: {
                type: apigateway.JsonSchemaType.STRING,
                pattern: '^[0-9a-fA-F]{64}$'
              },
              userId: {
                type: apigateway.JsonSchemaType.STRING
              },
              bundleId: {
                type: apigateway.JsonSchemaType.STRING
              }
            },
            required: ['deviceToken']
          }
        })
      }
    });

    // PUT /devices - Update device token
    devicesResource.addMethod('PUT', deviceRegistrationIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE,
      apiKeyRequired: true
    });

    // GET /devices - List user devices
    devicesResource.addMethod('GET', deviceRegistrationIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE,
      apiKeyRequired: true,
      requestParameters: {
        'method.request.querystring.userId': true,
        'method.request.querystring.limit': false,
        'method.request.querystring.nextToken': false
      }
    });

    // DELETE /devices/{deviceToken} - Delete device registration
    const deviceTokenResource = devicesResource.addResource('{deviceToken}');
    deviceTokenResource.addMethod('DELETE', deviceRegistrationIntegration, {
      authorizationType: apigateway.AuthorizationType.NONE,
      apiKeyRequired: true,
      requestParameters: {
        'method.request.path.deviceToken': true
      }
    });

    // API Key for rate limiting and access control
    const apiKey = new apigateway.ApiKey(this, 'DeviceRegistrationApiKey', {
      apiKeyName: 'spend-monitor-device-registration-key',
      description: 'API key for iOS device registration endpoints'
    });

    // Usage plan for rate limiting
    const usagePlan = new apigateway.UsagePlan(this, 'DeviceRegistrationUsagePlan', {
      name: 'device-registration-usage-plan',
      description: 'Usage plan for device registration API',
      throttle: {
        rateLimit: 100,
        burstLimit: 200
      },
      quota: {
        limit: 10000,
        period: apigateway.Period.DAY
      }
    });

    usagePlan.addApiKey(apiKey);
    usagePlan.addApiStage({
      api: deviceRegistrationApi,
      stage: deviceRegistrationApi.deploymentStage
    });

    // Grant CloudWatch permissions for custom metrics
    agentFunction.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'cloudwatch:PutMetricData'
      ],
      resources: ['*']
    }));

    // EventBridge rule to trigger daily at configurable time
    const scheduleHour = this.node.tryGetContext('scheduleHour') || '9';
    const scheduleRule = new events.Rule(this, 'SpendCheckSchedule', {
      schedule: events.Schedule.cron({
        minute: '0',
        hour: scheduleHour,
        day: '*',
        month: '*',
        year: '*'
      }),
      description: `Daily AWS spend check at ${scheduleHour}:00 UTC`
    });

    // Add Lambda as target
    scheduleRule.addTarget(new targets.LambdaFunction(agentFunction));

    // Create SNS topic for operational alerts
    const operationalAlertTopic = new sns.Topic(this, 'OperationalAlertTopic', {
      displayName: 'Spend Monitor Operational Alerts',
      topicName: 'spend-monitor-ops-alerts'
    });

    // CloudWatch Alarms for monitoring
    
    // Lambda function errors alarm
    const errorAlarm = new cloudwatch.Alarm(this, 'LambdaErrorAlarm', {
      alarmName: 'SpendMonitor-LambdaErrors',
      alarmDescription: 'Alarm for Lambda function errors in spend monitor',
      metric: agentFunction.metricErrors({
        period: cdk.Duration.minutes(5),
        statistic: 'Sum'
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    errorAlarm.addAlarmAction(new cloudwatchActions.SnsAction(operationalAlertTopic));

    // Lambda function duration alarm
    const durationAlarm = new cloudwatch.Alarm(this, 'LambdaDurationAlarm', {
      alarmName: 'SpendMonitor-LambdaDuration',
      alarmDescription: 'Alarm for Lambda function execution duration',
      metric: agentFunction.metricDuration({
        period: cdk.Duration.minutes(5),
        statistic: 'Average'
      }),
      threshold: 240000, // 4 minutes (timeout is 5 minutes)
      evaluationPeriods: 2,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    durationAlarm.addAlarmAction(new cloudwatchActions.SnsAction(operationalAlertTopic));

    // Custom metric alarms for agent execution
    const executionFailureAlarm = new cloudwatch.Alarm(this, 'ExecutionFailureAlarm', {
      alarmName: 'SpendMonitor-ExecutionFailures',
      alarmDescription: 'Alarm for spend monitor execution failures',
      metric: new cloudwatch.Metric({
        namespace: 'SpendMonitor/Agent',
        metricName: 'ErrorRate',
        dimensionsMap: {
          Operation: 'SpendMonitoring'
        },
        period: cdk.Duration.minutes(5),
        statistic: 'Sum'
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    executionFailureAlarm.addAlarmAction(new cloudwatchActions.SnsAction(operationalAlertTopic));

    // Alert delivery failure alarm
    const alertDeliveryFailureAlarm = new cloudwatch.Alarm(this, 'AlertDeliveryFailureAlarm', {
      alarmName: 'SpendMonitor-AlertDeliveryFailures',
      alarmDescription: 'Alarm for alert delivery failures',
      metric: new cloudwatch.Metric({
        namespace: 'SpendMonitor/Agent',
        metricName: 'AlertDeliveryCount',
        dimensionsMap: {
          Status: 'Failure'
        },
        period: cdk.Duration.minutes(5),
        statistic: 'Sum'
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    alertDeliveryFailureAlarm.addAlarmAction(new cloudwatchActions.SnsAction(operationalAlertTopic));

    // iOS-specific CloudWatch Alarms
    
    // iOS notification failure alarm
    const iosNotificationFailureAlarm = new cloudwatch.Alarm(this, 'iOSNotificationFailureAlarm', {
      alarmName: 'SpendMonitor-iOSNotificationFailures',
      alarmDescription: 'Alarm for iOS push notification delivery failures',
      metric: new cloudwatch.Metric({
        namespace: 'SpendMonitor/iOS',
        metricName: 'iOSNotificationCount',
        dimensionsMap: {
          Status: 'Failure'
        },
        period: cdk.Duration.minutes(5),
        statistic: 'Sum'
      }),
      threshold: 1,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    iosNotificationFailureAlarm.addAlarmAction(new cloudwatchActions.SnsAction(operationalAlertTopic));

    // iOS invalid token alarm (high rate of invalid tokens)
    const iosInvalidTokenAlarm = new cloudwatch.Alarm(this, 'iOSInvalidTokenAlarm', {
      alarmName: 'SpendMonitor-iOSInvalidTokens',
      alarmDescription: 'Alarm for high rate of invalid iOS device tokens',
      metric: new cloudwatch.Metric({
        namespace: 'SpendMonitor/iOS',
        metricName: 'iOSInvalidTokens',
        period: cdk.Duration.minutes(15),
        statistic: 'Sum'
      }),
      threshold: 5, // Alert if more than 5 invalid tokens in 15 minutes
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    iosInvalidTokenAlarm.addAlarmAction(new cloudwatchActions.SnsAction(operationalAlertTopic));

    // APNS certificate health alarm (based on validation failures)
    const apnsCertificateHealthAlarm = new cloudwatch.Alarm(this, 'APNSCertificateHealthAlarm', {
      alarmName: 'SpendMonitor-APNSCertificateHealth',
      alarmDescription: 'Alarm for APNS certificate validation failures',
      metric: new cloudwatch.Metric({
        namespace: 'SpendMonitor/iOS',
        metricName: 'ExecutionCount',
        dimensionsMap: {
          Operation: 'APNSCertificateValidation',
          Status: 'Failure'
        },
        period: cdk.Duration.minutes(5),
        statistic: 'Sum'
      }),
      threshold: 1,
      evaluationPeriods: 2, // Alert after 2 consecutive failures
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    apnsCertificateHealthAlarm.addAlarmAction(new cloudwatchActions.SnsAction(operationalAlertTopic));

    // APNS certificate expiration warning alarm (30 days)
    const apnsCertificateExpirationWarningAlarm = new cloudwatch.Alarm(this, 'APNSCertificateExpirationWarningAlarm', {
      alarmName: 'SpendMonitor-APNSCertificateExpirationWarning',
      alarmDescription: 'Warning alarm for APNS certificate expiring within 30 days',
      metric: new cloudwatch.Metric({
        namespace: 'SpendMonitor/iOS',
        metricName: 'APNSCertificateDaysUntilExpiration',
        period: cdk.Duration.hours(6),
        statistic: 'Minimum'
      }),
      threshold: 30,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    apnsCertificateExpirationWarningAlarm.addAlarmAction(new cloudwatchActions.SnsAction(operationalAlertTopic));

    // APNS certificate expiration critical alarm (7 days)
    const apnsCertificateExpirationCriticalAlarm = new cloudwatch.Alarm(this, 'APNSCertificateExpirationCriticalAlarm', {
      alarmName: 'SpendMonitor-APNSCertificateExpirationCritical',
      alarmDescription: 'Critical alarm for APNS certificate expiring within 7 days',
      metric: new cloudwatch.Metric({
        namespace: 'SpendMonitor/iOS',
        metricName: 'APNSCertificateDaysUntilExpiration',
        period: cdk.Duration.hours(1),
        statistic: 'Minimum'
      }),
      threshold: 7,
      comparisonOperator: cloudwatch.ComparisonOperator.LESS_THAN_THRESHOLD,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    apnsCertificateExpirationCriticalAlarm.addAlarmAction(new cloudwatchActions.SnsAction(operationalAlertTopic));

    // iOS fallback usage alarm (high fallback rate indicates iOS issues)
    const iosFallbackUsageAlarm = new cloudwatch.Alarm(this, 'iOSFallbackUsageAlarm', {
      alarmName: 'SpendMonitor-iOSFallbackUsage',
      alarmDescription: 'Alarm for high iOS notification fallback usage rate',
      metric: new cloudwatch.Metric({
        namespace: 'SpendMonitor/iOS',
        metricName: 'iOSFallbackUsed',
        period: cdk.Duration.minutes(15),
        statistic: 'Sum'
      }),
      threshold: 3, // Alert if fallback is used 3 times in 15 minutes
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    iosFallbackUsageAlarm.addAlarmAction(new cloudwatchActions.SnsAction(operationalAlertTopic));

    // iOS device registration failure alarm
    const iosRegistrationFailureAlarm = new cloudwatch.Alarm(this, 'iOSRegistrationFailureAlarm', {
      alarmName: 'SpendMonitor-iOSRegistrationFailures',
      alarmDescription: 'Alarm for iOS device registration failures',
      metric: new cloudwatch.Metric({
        namespace: 'SpendMonitor/iOS',
        metricName: 'ExecutionCount',
        dimensionsMap: {
          Operation: 'RegisterDevice',
          Status: 'Failure'
        },
        period: cdk.Duration.minutes(5),
        statistic: 'Sum'
      }),
      threshold: 3, // Alert after 3 registration failures
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING
    });
    iosRegistrationFailureAlarm.addAlarmAction(new cloudwatchActions.SnsAction(operationalAlertTopic));

    // CloudWatch Dashboard for monitoring
    const dashboard = new cloudwatch.Dashboard(this, 'SpendMonitorDashboard', {
      dashboardName: 'SpendMonitorAgent',
      widgets: [
        [
          new cloudwatch.GraphWidget({
            title: 'Lambda Function Metrics',
            left: [
              agentFunction.metricInvocations({ period: cdk.Duration.minutes(5) }),
              agentFunction.metricErrors({ period: cdk.Duration.minutes(5) })
            ],
            right: [
              agentFunction.metricDuration({ period: cdk.Duration.minutes(5) })
            ],
            width: 12,
            height: 6
          })
        ],
        [
          new cloudwatch.GraphWidget({
            title: 'Spend Monitoring Metrics',
            left: [
              new cloudwatch.Metric({
                namespace: 'SpendMonitor/Agent',
                metricName: 'CurrentSpend',
                period: cdk.Duration.hours(1),
                statistic: 'Average'
              }),
              new cloudwatch.Metric({
                namespace: 'SpendMonitor/Agent',
                metricName: 'ProjectedMonthlySpend',
                period: cdk.Duration.hours(1),
                statistic: 'Average'
              })
            ],
            width: 12,
            height: 6
          })
        ],
        [
          new cloudwatch.GraphWidget({
            title: 'Alert Delivery Metrics',
            left: [
              new cloudwatch.Metric({
                namespace: 'SpendMonitor/Agent',
                metricName: 'AlertDeliveryCount',
                dimensionsMap: { Status: 'Success' },
                period: cdk.Duration.minutes(5),
                statistic: 'Sum'
              }),
              new cloudwatch.Metric({
                namespace: 'SpendMonitor/Agent',
                metricName: 'AlertDeliveryCount',
                dimensionsMap: { Status: 'Failure' },
                period: cdk.Duration.minutes(5),
                statistic: 'Sum'
              })
            ],
            width: 12,
            height: 6
          })
        ],
        [
          new cloudwatch.GraphWidget({
            title: 'iOS Notification Metrics',
            left: [
              new cloudwatch.Metric({
                namespace: 'SpendMonitor/iOS',
                metricName: 'iOSNotificationCount',
                dimensionsMap: { Status: 'Success' },
                period: cdk.Duration.minutes(5),
                statistic: 'Sum'
              }),
              new cloudwatch.Metric({
                namespace: 'SpendMonitor/iOS',
                metricName: 'iOSNotificationCount',
                dimensionsMap: { Status: 'Failure' },
                period: cdk.Duration.minutes(5),
                statistic: 'Sum'
              })
            ],
            right: [
              new cloudwatch.Metric({
                namespace: 'SpendMonitor/iOS',
                metricName: 'iOSInvalidTokens',
                period: cdk.Duration.minutes(15),
                statistic: 'Sum'
              })
            ],
            width: 12,
            height: 6
          })
        ],
        [
          new cloudwatch.GraphWidget({
            title: 'iOS System Health Metrics',
            left: [
              new cloudwatch.Metric({
                namespace: 'SpendMonitor/iOS',
                metricName: 'ExecutionCount',
                dimensionsMap: { 
                  Operation: 'APNSCertificateValidation',
                  Status: 'Success'
                },
                period: cdk.Duration.hours(1),
                statistic: 'Sum'
              }),
              new cloudwatch.Metric({
                namespace: 'SpendMonitor/iOS',
                metricName: 'ExecutionCount',
                dimensionsMap: { 
                  Operation: 'APNSCertificateValidation',
                  Status: 'Failure'
                },
                period: cdk.Duration.hours(1),
                statistic: 'Sum'
              })
            ],
            right: [
              new cloudwatch.Metric({
                namespace: 'SpendMonitor/iOS',
                metricName: 'iOSDeviceCount',
                period: cdk.Duration.hours(1),
                statistic: 'Average'
              })
            ],
            width: 12,
            height: 6
          })
        ],
        [
          new cloudwatch.GraphWidget({
            title: 'APNS Certificate Health',
            left: [
              new cloudwatch.Metric({
                namespace: 'SpendMonitor/iOS',
                metricName: 'APNSCertificateDaysUntilExpiration',
                period: cdk.Duration.hours(6),
                statistic: 'Minimum'
              }),
              new cloudwatch.Metric({
                namespace: 'SpendMonitor/iOS',
                metricName: 'APNSCertificateValid',
                period: cdk.Duration.hours(1),
                statistic: 'Average'
              })
            ],
            right: [
              new cloudwatch.Metric({
                namespace: 'SpendMonitor/iOS',
                metricName: 'APNSCertificateWarnings',
                period: cdk.Duration.hours(1),
                statistic: 'Sum'
              }),
              new cloudwatch.Metric({
                namespace: 'SpendMonitor/iOS',
                metricName: 'APNSCertificateErrors',
                period: cdk.Duration.hours(1),
                statistic: 'Sum'
              })
            ],
            width: 12,
            height: 6
          })
        ],
        [
          new cloudwatch.GraphWidget({
            title: 'iOS Fallback and Error Recovery',
            left: [
              new cloudwatch.Metric({
                namespace: 'SpendMonitor/iOS',
                metricName: 'iOSFallbackUsed',
                dimensionsMap: { Status: 'Success' },
                period: cdk.Duration.minutes(15),
                statistic: 'Sum'
              }),
              new cloudwatch.Metric({
                namespace: 'SpendMonitor/iOS',
                metricName: 'iOSFallbackUsed',
                dimensionsMap: { Status: 'Failure' },
                period: cdk.Duration.minutes(15),
                statistic: 'Sum'
              })
            ],
            right: [
              new cloudwatch.Metric({
                namespace: 'SpendMonitor/iOS',
                metricName: 'iOSPayloadSize',
                period: cdk.Duration.minutes(15),
                statistic: 'Average'
              }),
              new cloudwatch.Metric({
                namespace: 'SpendMonitor/iOS',
                metricName: 'iOSNotificationDeliveryTime',
                period: cdk.Duration.minutes(15),
                statistic: 'Average'
              })
            ],
            width: 12,
            height: 6
          })
        ]
      ]
    });

    // Outputs
    new cdk.CfnOutput(this, 'SNSTopicArn', {
      value: alertTopic.topicArn,
      description: 'SNS Topic ARN for spend alerts'
    });

    new cdk.CfnOutput(this, 'AgentFunctionName', {
      value: agentFunction.functionName,
      description: 'Lambda function name for the spend monitor agent'
    });

    if (iosPlatformApp) {
      new cdk.CfnOutput(this, 'iOSPlatformApplicationArn', {
        value: iosPlatformApp.ref,
        description: 'SNS Platform Application ARN for iOS push notifications'
      });
    }

    new cdk.CfnOutput(this, 'DeviceTokenTableName', {
      value: deviceTokenTable.tableName,
      description: 'DynamoDB table name for device token storage'
    });

    new cdk.CfnOutput(this, 'LogGroupName', {
      value: logGroup.logGroupName,
      description: 'CloudWatch Log Group for the spend monitor agent'
    });

    new cdk.CfnOutput(this, 'OperationalAlertTopicArn', {
      value: operationalAlertTopic.topicArn,
      description: 'SNS Topic ARN for operational alerts'
    });

    new cdk.CfnOutput(this, 'DashboardURL', {
      value: `https://${this.region}.console.aws.amazon.com/cloudwatch/home?region=${this.region}#dashboards:name=${dashboard.dashboardName}`,
      description: 'CloudWatch Dashboard URL for monitoring'
    });

    new cdk.CfnOutput(this, 'DeviceRegistrationApiUrl', {
      value: deviceRegistrationApi.url,
      description: 'Device Registration API Gateway URL'
    });

    new cdk.CfnOutput(this, 'DeviceRegistrationApiKeyId', {
      value: apiKey.keyId,
      description: 'API Key ID for device registration (retrieve value from AWS Console)'
    });

    new cdk.CfnOutput(this, 'DeviceRegistrationFunctionName', {
      value: deviceRegistrationFunction.functionName,
      description: 'Lambda function name for device registration API'
    });
  }
}