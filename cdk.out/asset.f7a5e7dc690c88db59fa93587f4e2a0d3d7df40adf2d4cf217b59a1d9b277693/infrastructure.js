"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.SpendMonitorStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const events = __importStar(require("aws-cdk-lib/aws-events"));
const targets = __importStar(require("aws-cdk-lib/aws-events-targets"));
const sns = __importStar(require("aws-cdk-lib/aws-sns"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const dynamodb = __importStar(require("aws-cdk-lib/aws-dynamodb"));
const cloudwatch = __importStar(require("aws-cdk-lib/aws-cloudwatch"));
const cloudwatchActions = __importStar(require("aws-cdk-lib/aws-cloudwatch-actions"));
const apigateway = __importStar(require("aws-cdk-lib/aws-apigateway"));
class SpendMonitorStack extends cdk.Stack {
    constructor(scope, id, props) {
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
        let iosPlatformApp;
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
exports.SpendMonitorStack = SpendMonitorStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5mcmFzdHJ1Y3R1cmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvaW5mcmFzdHJ1Y3R1cmUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLCtEQUFpRDtBQUNqRCwrREFBaUQ7QUFDakQsd0VBQTBEO0FBQzFELHlEQUEyQztBQUMzQyx5REFBMkM7QUFDM0MsMkRBQTZDO0FBQzdDLG1FQUFxRDtBQUNyRCx1RUFBeUQ7QUFDekQsc0ZBQXdFO0FBQ3hFLHVFQUF5RDtBQUd6RCxNQUFhLGlCQUFrQixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQzlDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsNkNBQTZDO1FBQzdDLE1BQU0sUUFBUSxHQUFHLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsc0JBQXNCLEVBQUU7WUFDL0QsWUFBWSxFQUFFLGlDQUFpQztZQUMvQyxTQUFTLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxTQUFTO1lBQ3ZDLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE9BQU87U0FDekMsQ0FBQyxDQUFDO1FBRUgsdUJBQXVCO1FBQ3ZCLE1BQU0sVUFBVSxHQUFHLElBQUksR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsaUJBQWlCLEVBQUU7WUFDeEQsV0FBVyxFQUFFLDBCQUEwQjtZQUN2QyxTQUFTLEVBQUUsa0JBQWtCO1NBQzlCLENBQUMsQ0FBQztRQUVILHdFQUF3RTtRQUN4RSxJQUFJLGNBQTJDLENBQUM7UUFDaEQsTUFBTSxlQUFlLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsaUJBQWlCLENBQUMsQ0FBQztRQUNuRSxNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMs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QUMsUUFBUTtZQUNyQyxXQUFXLEVBQUUsc0NBQXNDO1NBQ3BELENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQ3RDLEtBQUssRUFBRSxXQUFXLElBQUksQ0FBQyxNQUFNLGtEQUFrRCxJQUFJLENBQUMsTUFBTSxvQkFBb0IsU0FBUyxDQUFDLGFBQWEsRUFBRTtZQUN2SSxXQUFXLEVBQUUseUNBQXlDO1NBQ3ZELENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsMEJBQTBCLEVBQUU7WUFDbEQsS0FBSyxFQUFFLHFCQUFxQixDQUFDLEdBQUc7WUFDaEMsV0FBVyxFQUFFLHFDQUFxQztTQUNuRCxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLDRCQUE0QixFQUFFO1lBQ3BELEtBQUssRUFBRSxNQUFNLENBQUMsS0FBSztZQUNuQixXQUFXLEVBQUUsc0VBQXNFO1NBQ3BGLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsZ0NBQWdDLEVBQUU7WUFDeEQsS0FBSyxFQUFFLDBCQUEwQixDQUFDLFlBQVk7WUFDOUMsV0FBVyxFQUFFLGtEQUFrRDtTQUNoRSxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUF0dUJELDhDQXN1QkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0ICogYXMgZXZlbnRzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1ldmVudHMnO1xuaW1wb3J0ICogYXMgdGFyZ2V0cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZXZlbnRzLXRhcmdldHMnO1xuaW1wb3J0ICogYXMgc25zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zbnMnO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xuaW1wb3J0ICogYXMgY2xvdWR3YXRjaCBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWR3YXRjaCc7XG5pbXBvcnQgKiBhcyBjbG91ZHdhdGNoQWN0aW9ucyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWR3YXRjaC1hY3Rpb25zJztcbmltcG9ydCAqIGFzIGFwaWdhdGV3YXkgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5cbmV4cG9ydCBjbGFzcyBTcGVuZE1vbml0b3JTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogY2RrLlN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIC8vIENsb3VkV2F0Y2ggTG9nIEdyb3VwIHdpdGggcmV0ZW50aW9uIHBvbGljeVxuICAgIGNvbnN0IGxvZ0dyb3VwID0gbmV3IGxvZ3MuTG9nR3JvdXAodGhpcywgJ1NwZW5kTW9uaXRvckxvZ0dyb3VwJywge1xuICAgICAgbG9nR3JvdXBOYW1lOiAnL2F3cy9sYW1iZGEvc3BlbmQtbW9uaXRvci1hZ2VudCcsXG4gICAgICByZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfTU9OVEgsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZXG4gICAgfSk7XG5cbiAgICAvLyBTTlMgVG9waWMgZm9yIGFsZXJ0c1xuICAgIGNvbnN0IGFsZXJ0VG9waWMgPSBuZXcgc25zLlRvcGljKHRoaXMsICdTcGVuZEFsZXJ0VG9waWMnLCB7XG4gICAgICBkaXNwbGF5TmFtZTogJ0FXUyBTcGVuZCBNb25pdG9yIEFsZXJ0cycsXG4gICAgICB0b3BpY05hbWU6ICdhd3Mtc3BlbmQtYWxlcnRzJ1xuICAgIH0pO1xuXG4gICAgLy8gU05TIFBsYXRmb3JtIEFwcGxpY2F0aW9uIGZvciBBUE5TIChpT1MgcHVzaCBub3RpZmljYXRpb25zKSAtIG9wdGlvbmFsXG4gICAgbGV0IGlvc1BsYXRmb3JtQXBwOiBjZGsuQ2ZuUmVzb3VyY2UgfCB1bmRlZmluZWQ7XG4gICAgY29uc3QgYXBuc0NlcnRpZmljYXRlID0gdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2FwbnNDZXJ0aWZpY2F0ZScpO1xuICAgIGNvbnN0IGFwbnNQcml2YXRlS2V5ID0gdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2FwbnNQcml2YXRlS2V5Jyk7XG4gICAgXG4gICAgaWYgKGFwbnNDZXJ0aWZpY2F0ZSAmJiBhcG5zUHJpdmF0ZUtleSkge1xuICAgICAgaW9zUGxhdGZvcm1BcHAgPSBuZXcgY2RrLkNmblJlc291cmNlKHRoaXMsICdpT1NQbGF0Zm9ybUFwcGxpY2F0aW9uJywge1xuICAgICAgICB0eXBlOiAnQVdTOjpTTlM6OlBsYXRmb3JtQXBwbGljYXRpb24nLFxuICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgTmFtZTogJ1NwZW5kTW9uaXRvckFQTlMnLFxuICAgICAgICAgIFBsYXRmb3JtOiAnQVBOU19TQU5EQk9YJywgLy8gVXNlIEFQTlNfU0FOREJPWCBmb3IgZGV2ZWxvcG1lbnRcbiAgICAgICAgICBBdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgICBQbGF0Zm9ybUNyZWRlbnRpYWw6IGFwbnNDZXJ0aWZpY2F0ZSxcbiAgICAgICAgICAgIFBsYXRmb3JtUHJpbmNpcGFsOiBhcG5zUHJpdmF0ZUtleVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gT3B0aW9uYWwgRHluYW1vREIgdGFibGUgZm9yIGRldmljZSB0b2tlbiBzdG9yYWdlXG4gICAgY29uc3QgZGV2aWNlVG9rZW5UYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnRGV2aWNlVG9rZW5UYWJsZScsIHtcbiAgICAgIHRhYmxlTmFtZTogJ3NwZW5kLW1vbml0b3ItZGV2aWNlLXRva2VucycsXG4gICAgICBwYXJ0aXRpb25LZXk6IHtcbiAgICAgICAgbmFtZTogJ2RldmljZVRva2VuJyxcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkdcbiAgICAgIH0sXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIHBvaW50SW5UaW1lUmVjb3ZlcnlTcGVjaWZpY2F0aW9uOiB7XG4gICAgICAgIHBvaW50SW5UaW1lUmVjb3ZlcnlFbmFibGVkOiB0cnVlXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBMYW1iZGEgZnVuY3Rpb24gZm9yIHRoZSBTdHJhbmRzIGFnZW50XG4gICAgY29uc3QgYWdlbnRGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1NwZW5kTW9uaXRvckFnZW50Jywge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXG4gICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJ2Rpc3QnKSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgbWVtb3J5U2l6ZTogNTEyLCAvLyBJbmNyZWFzZWQgbWVtb3J5IGZvciBpT1MgcHJvY2Vzc2luZ1xuICAgICAgbG9nR3JvdXA6IGxvZ0dyb3VwLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgU05TX1RPUElDX0FSTjogYWxlcnRUb3BpYy50b3BpY0FybixcbiAgICAgICAgU1BFTkRfVEhSRVNIT0xEOiB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnc3BlbmRUaHJlc2hvbGQnKSB8fCAnMTAnLFxuICAgICAgICBDSEVDS19QRVJJT0RfREFZUzogdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2NoZWNrUGVyaW9kRGF5cycpIHx8ICcxJyxcbiAgICAgICAgUkVUUllfQVRURU1QVFM6IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdyZXRyeUF0dGVtcHRzJykgfHwgJzMnLFxuICAgICAgICBNSU5fU0VSVklDRV9DT1NUOiB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnbWluU2VydmljZUNvc3QnKSB8fCAnMScsXG4gICAgICAgIElPU19QTEFURk9STV9BUFBfQVJOOiBpb3NQbGF0Zm9ybUFwcD8ucmVmIHx8ICcnLFxuICAgICAgICBJT1NfQlVORExFX0lEOiB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnaW9zQnVuZGxlSWQnKSB8fCAnY29tLmV4YW1wbGUuc3BlbmRtb25pdG9yJyxcbiAgICAgICAgQVBOU19TQU5EQk9YOiB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnYXBuc1NhbmRib3gnKSB8fCAndHJ1ZScsXG4gICAgICAgIERFVklDRV9UT0tFTl9UQUJMRV9OQU1FOiBkZXZpY2VUb2tlblRhYmxlLnRhYmxlTmFtZVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gSUFNIHBlcm1pc3Npb25zIGZvciBDb3N0IEV4cGxvcmVyXG4gICAgYWdlbnRGdW5jdGlvbi5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnY2U6R2V0Q29zdEFuZFVzYWdlJyxcbiAgICAgICAgJ2NlOkdldFVzYWdlUmVwb3J0JyxcbiAgICAgICAgJ2NlOkdldERpbWVuc2lvblZhbHVlcycsXG4gICAgICAgICdjZTpHZXRSZXNlcnZhdGlvbkNvdmVyYWdlJyxcbiAgICAgICAgJ2NlOkdldFJlc2VydmF0aW9uUHVyY2hhc2VSZWNvbW1lbmRhdGlvbicsXG4gICAgICAgICdjZTpHZXRSZXNlcnZhdGlvblV0aWxpemF0aW9uJ1xuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogWycqJ11cbiAgICB9KSk7XG5cbiAgICAvLyBHcmFudCBTTlMgcHVibGlzaCBwZXJtaXNzaW9uc1xuICAgIGFsZXJ0VG9waWMuZ3JhbnRQdWJsaXNoKGFnZW50RnVuY3Rpb24pO1xuXG4gICAgLy8gR3JhbnQgU05TIHBsYXRmb3JtIGFwcGxpY2F0aW9uIHBlcm1pc3Npb25zIGZvciBpT1MgcHVzaCBub3RpZmljYXRpb25zIChpZiBwbGF0Zm9ybSBhcHAgZXhpc3RzKVxuICAgIGlmIChpb3NQbGF0Zm9ybUFwcCkge1xuICAgICAgYWdlbnRGdW5jdGlvbi5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAnc25zOkNyZWF0ZVBsYXRmb3JtRW5kcG9pbnQnLFxuICAgICAgICAgICdzbnM6RGVsZXRlRW5kcG9pbnQnLFxuICAgICAgICAgICdzbnM6R2V0RW5kcG9pbnRBdHRyaWJ1dGVzJyxcbiAgICAgICAgICAnc25zOlNldEVuZHBvaW50QXR0cmlidXRlcycsXG4gICAgICAgICAgJ3NuczpMaXN0RW5kcG9pbnRzQnlQbGF0Zm9ybUFwcGxpY2F0aW9uJyxcbiAgICAgICAgICAnc25zOkdldFBsYXRmb3JtQXBwbGljYXRpb25BdHRyaWJ1dGVzJ1xuICAgICAgICBdLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICBpb3NQbGF0Zm9ybUFwcC5yZWYsXG4gICAgICAgICAgYCR7aW9zUGxhdGZvcm1BcHAucmVmfS8qYFxuICAgICAgICBdXG4gICAgICB9KSk7XG4gICAgfVxuXG4gICAgLy8gR3JhbnQgRHluYW1vREIgcGVybWlzc2lvbnMgZm9yIGRldmljZSB0b2tlbiBtYW5hZ2VtZW50XG4gICAgZGV2aWNlVG9rZW5UYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoYWdlbnRGdW5jdGlvbik7XG5cbiAgICAvLyBEZXZpY2UgUmVnaXN0cmF0aW9uIEFQSSBMYW1iZGEgRnVuY3Rpb25cbiAgICBjb25zdCBkZXZpY2VSZWdpc3RyYXRpb25GdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ0RldmljZVJlZ2lzdHJhdGlvbkZ1bmN0aW9uJywge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXG4gICAgICBoYW5kbGVyOiAnZGV2aWNlLXJlZ2lzdHJhdGlvbi1pbmRleC5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnZGlzdCcpLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgbWVtb3J5U2l6ZTogMjU2LFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgSU9TX1BMQVRGT1JNX0FQUF9BUk46IGlvc1BsYXRmb3JtQXBwPy5yZWYgfHwgJycsXG4gICAgICAgIERFVklDRV9UT0tFTl9UQUJMRV9OQU1FOiBkZXZpY2VUb2tlblRhYmxlLnRhYmxlTmFtZSxcbiAgICAgICAgSU9TX0JVTkRMRV9JRDogdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2lvc0J1bmRsZUlkJykgfHwgJ2NvbS5leGFtcGxlLnNwZW5kbW9uaXRvcidcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIEdyYW50IHBlcm1pc3Npb25zIGZvciBkZXZpY2UgcmVnaXN0cmF0aW9uIGZ1bmN0aW9uXG4gICAgZGV2aWNlVG9rZW5UYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoZGV2aWNlUmVnaXN0cmF0aW9uRnVuY3Rpb24pO1xuXG4gICAgLy8gR3JhbnQgU05TIHBsYXRmb3JtIGFwcGxpY2F0aW9uIHBlcm1pc3Npb25zIGZvciBkZXZpY2UgcmVnaXN0cmF0aW9uXG4gICAgaWYgKGlvc1BsYXRmb3JtQXBwKSB7XG4gICAgICBkZXZpY2VSZWdpc3RyYXRpb25GdW5jdGlvbi5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAnc25zOkNyZWF0ZVBsYXRmb3JtRW5kcG9pbnQnLFxuICAgICAgICAgICdzbnM6RGVsZXRlRW5kcG9pbnQnLFxuICAgICAgICAgICdzbnM6R2V0RW5kcG9pbnRBdHRyaWJ1dGVzJyxcbiAgICAgICAgICAnc25zOlNldEVuZHBvaW50QXR0cmlidXRlcycsXG4gICAgICAgICAgJ3NuczpMaXN0RW5kcG9pbnRzQnlQbGF0Zm9ybUFwcGxpY2F0aW9uJyxcbiAgICAgICAgICAnc25zOkdldFBsYXRmb3JtQXBwbGljYXRpb25BdHRyaWJ1dGVzJ1xuICAgICAgICBdLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICBpb3NQbGF0Zm9ybUFwcC5yZWYsXG4gICAgICAgICAgYCR7aW9zUGxhdGZvcm1BcHAucmVmfS8qYFxuICAgICAgICBdXG4gICAgICB9KSk7XG4gICAgfVxuXG4gICAgLy8gQVBJIEdhdGV3YXkgZm9yIGRldmljZSByZWdpc3RyYXRpb25cbiAgICBjb25zdCBkZXZpY2VSZWdpc3RyYXRpb25BcGkgPSBuZXcgYXBpZ2F0ZXdheS5SZXN0QXBpKHRoaXMsICdEZXZpY2VSZWdpc3RyYXRpb25BcGknLCB7XG4gICAgICByZXN0QXBpTmFtZTogJ2lPUyBEZXZpY2UgUmVnaXN0cmF0aW9uIEFQSScsXG4gICAgICBkZXNjcmlwdGlvbjogJ0FQSSBmb3IgbWFuYWdpbmcgaU9TIGRldmljZSByZWdpc3RyYXRpb25zIGZvciBzcGVuZCBtb25pdG9yIG5vdGlmaWNhdGlvbnMnLFxuICAgICAgZGVmYXVsdENvcnNQcmVmbGlnaHRPcHRpb25zOiB7XG4gICAgICAgIGFsbG93T3JpZ2luczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9PUklHSU5TLFxuICAgICAgICBhbGxvd01ldGhvZHM6IGFwaWdhdGV3YXkuQ29ycy5BTExfTUVUSE9EUyxcbiAgICAgICAgYWxsb3dIZWFkZXJzOiBbJ0NvbnRlbnQtVHlwZScsICdYLUFtei1EYXRlJywgJ0F1dGhvcml6YXRpb24nLCAnWC1BcGktS2V5JywgJ1gtQW16LVNlY3VyaXR5LVRva2VuJ11cbiAgICAgIH0sXG4gICAgICBkZXBsb3lPcHRpb25zOiB7XG4gICAgICAgIHN0YWdlTmFtZTogJ3YxJyxcbiAgICAgICAgbG9nZ2luZ0xldmVsOiBhcGlnYXRld2F5Lk1ldGhvZExvZ2dpbmdMZXZlbC5JTkZPLFxuICAgICAgICBkYXRhVHJhY2VFbmFibGVkOiB0cnVlLFxuICAgICAgICBtZXRyaWNzRW5hYmxlZDogdHJ1ZVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gTGFtYmRhIGludGVncmF0aW9uIGZvciBkZXZpY2UgcmVnaXN0cmF0aW9uXG4gICAgY29uc3QgZGV2aWNlUmVnaXN0cmF0aW9uSW50ZWdyYXRpb24gPSBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihkZXZpY2VSZWdpc3RyYXRpb25GdW5jdGlvbiwge1xuICAgICAgcmVxdWVzdFRlbXBsYXRlczogeyAnYXBwbGljYXRpb24vanNvbic6ICd7IFwic3RhdHVzQ29kZVwiOiBcIjIwMFwiIH0nIH1cbiAgICB9KTtcblxuICAgIC8vIEFQSSBHYXRld2F5IHJlc291cmNlcyBhbmQgbWV0aG9kc1xuICAgIGNvbnN0IGRldmljZXNSZXNvdXJjZSA9IGRldmljZVJlZ2lzdHJhdGlvbkFwaS5yb290LmFkZFJlc291cmNlKCdkZXZpY2VzJyk7XG4gICAgXG4gICAgLy8gUE9TVCAvZGV2aWNlcyAtIFJlZ2lzdGVyIG5ldyBkZXZpY2VcbiAgICBkZXZpY2VzUmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgZGV2aWNlUmVnaXN0cmF0aW9uSW50ZWdyYXRpb24sIHtcbiAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLk5PTkUsXG4gICAgICBhcGlLZXlSZXF1aXJlZDogdHJ1ZSxcbiAgICAgIHJlcXVlc3RWYWxpZGF0b3I6IG5ldyBhcGlnYXRld2F5LlJlcXVlc3RWYWxpZGF0b3IodGhpcywgJ0RldmljZVJlZ2lzdHJhdGlvblZhbGlkYXRvcicsIHtcbiAgICAgICAgcmVzdEFwaTogZGV2aWNlUmVnaXN0cmF0aW9uQXBpLFxuICAgICAgICByZXF1ZXN0VmFsaWRhdG9yTmFtZTogJ2RldmljZS1yZWdpc3RyYXRpb24tdmFsaWRhdG9yJyxcbiAgICAgICAgdmFsaWRhdGVSZXF1ZXN0Qm9keTogdHJ1ZSxcbiAgICAgICAgdmFsaWRhdGVSZXF1ZXN0UGFyYW1ldGVyczogZmFsc2VcbiAgICAgIH0pLFxuICAgICAgcmVxdWVzdE1vZGVsczoge1xuICAgICAgICAnYXBwbGljYXRpb24vanNvbic6IG5ldyBhcGlnYXRld2F5Lk1vZGVsKHRoaXMsICdEZXZpY2VSZWdpc3RyYXRpb25Nb2RlbCcsIHtcbiAgICAgICAgICByZXN0QXBpOiBkZXZpY2VSZWdpc3RyYXRpb25BcGksXG4gICAgICAgICAgbW9kZWxOYW1lOiAnRGV2aWNlUmVnaXN0cmF0aW9uUmVxdWVzdCcsXG4gICAgICAgICAgc2NoZW1hOiB7XG4gICAgICAgICAgICB0eXBlOiBhcGlnYXRld2F5Lkpzb25TY2hlbWFUeXBlLk9CSkVDVCxcbiAgICAgICAgICAgIHByb3BlcnRpZXM6IHtcbiAgICAgICAgICAgICAgZGV2aWNlVG9rZW46IHtcbiAgICAgICAgICAgICAgICB0eXBlOiBhcGlnYXRld2F5Lkpzb25TY2hlbWFUeXBlLlNUUklORyxcbiAgICAgICAgICAgICAgICBwYXR0ZXJuOiAnXlswLTlhLWZBLUZdezY0fSQnXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIHVzZXJJZDoge1xuICAgICAgICAgICAgICAgIHR5cGU6IGFwaWdhdGV3YXkuSnNvblNjaGVtYVR5cGUuU1RSSU5HXG4gICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgIGJ1bmRsZUlkOiB7XG4gICAgICAgICAgICAgICAgdHlwZTogYXBpZ2F0ZXdheS5Kc29uU2NoZW1hVHlwZS5TVFJJTkdcbiAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSxcbiAgICAgICAgICAgIHJlcXVpcmVkOiBbJ2RldmljZVRva2VuJ11cbiAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBQVVQgL2RldmljZXMgLSBVcGRhdGUgZGV2aWNlIHRva2VuXG4gICAgZGV2aWNlc1Jlc291cmNlLmFkZE1ldGhvZCgnUFVUJywgZGV2aWNlUmVnaXN0cmF0aW9uSW50ZWdyYXRpb24sIHtcbiAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLk5PTkUsXG4gICAgICBhcGlLZXlSZXF1aXJlZDogdHJ1ZVxuICAgIH0pO1xuXG4gICAgLy8gR0VUIC9kZXZpY2VzIC0gTGlzdCB1c2VyIGRldmljZXNcbiAgICBkZXZpY2VzUmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBkZXZpY2VSZWdpc3RyYXRpb25JbnRlZ3JhdGlvbiwge1xuICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuTk9ORSxcbiAgICAgIGFwaUtleVJlcXVpcmVkOiB0cnVlLFxuICAgICAgcmVxdWVzdFBhcmFtZXRlcnM6IHtcbiAgICAgICAgJ21ldGhvZC5yZXF1ZXN0LnF1ZXJ5c3RyaW5nLnVzZXJJZCc6IHRydWUsXG4gICAgICAgICdtZXRob2QucmVxdWVzdC5xdWVyeXN0cmluZy5saW1pdCc6IGZhbHNlLFxuICAgICAgICAnbWV0aG9kLnJlcXVlc3QucXVlcnlzdHJpbmcubmV4dFRva2VuJzogZmFsc2VcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIERFTEVURSAvZGV2aWNlcy97ZGV2aWNlVG9rZW59IC0gRGVsZXRlIGRldmljZSByZWdpc3RyYXRpb25cbiAgICBjb25zdCBkZXZpY2VUb2tlblJlc291cmNlID0gZGV2aWNlc1Jlc291cmNlLmFkZFJlc291cmNlKCd7ZGV2aWNlVG9rZW59Jyk7XG4gICAgZGV2aWNlVG9rZW5SZXNvdXJjZS5hZGRNZXRob2QoJ0RFTEVURScsIGRldmljZVJlZ2lzdHJhdGlvbkludGVncmF0aW9uLCB7XG4gICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5OT05FLFxuICAgICAgYXBpS2V5UmVxdWlyZWQ6IHRydWUsXG4gICAgICByZXF1ZXN0UGFyYW1ldGVyczoge1xuICAgICAgICAnbWV0aG9kLnJlcXVlc3QucGF0aC5kZXZpY2VUb2tlbic6IHRydWVcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIEFQSSBLZXkgZm9yIHJhdGUgbGltaXRpbmcgYW5kIGFjY2VzcyBjb250cm9sXG4gICAgY29uc3QgYXBpS2V5ID0gbmV3IGFwaWdhdGV3YXkuQXBpS2V5KHRoaXMsICdEZXZpY2VSZWdpc3RyYXRpb25BcGlLZXknLCB7XG4gICAgICBhcGlLZXlOYW1lOiAnc3BlbmQtbW9uaXRvci1kZXZpY2UtcmVnaXN0cmF0aW9uLWtleScsXG4gICAgICBkZXNjcmlwdGlvbjogJ0FQSSBrZXkgZm9yIGlPUyBkZXZpY2UgcmVnaXN0cmF0aW9uIGVuZHBvaW50cydcbiAgICB9KTtcblxuICAgIC8vIFVzYWdlIHBsYW4gZm9yIHJhdGUgbGltaXRpbmdcbiAgICBjb25zdCB1c2FnZVBsYW4gPSBuZXcgYXBpZ2F0ZXdheS5Vc2FnZVBsYW4odGhpcywgJ0RldmljZVJlZ2lzdHJhdGlvblVzYWdlUGxhbicsIHtcbiAgICAgIG5hbWU6ICdkZXZpY2UtcmVnaXN0cmF0aW9uLXVzYWdlLXBsYW4nLFxuICAgICAgZGVzY3JpcHRpb246ICdVc2FnZSBwbGFuIGZvciBkZXZpY2UgcmVnaXN0cmF0aW9uIEFQSScsXG4gICAgICB0aHJvdHRsZToge1xuICAgICAgICByYXRlTGltaXQ6IDEwMCxcbiAgICAgICAgYnVyc3RMaW1pdDogMjAwXG4gICAgICB9LFxuICAgICAgcXVvdGE6IHtcbiAgICAgICAgbGltaXQ6IDEwMDAwLFxuICAgICAgICBwZXJpb2Q6IGFwaWdhdGV3YXkuUGVyaW9kLkRBWVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgdXNhZ2VQbGFuLmFkZEFwaUtleShhcGlLZXkpO1xuICAgIHVzYWdlUGxhbi5hZGRBcGlTdGFnZSh7XG4gICAgICBhcGk6IGRldmljZVJlZ2lzdHJhdGlvbkFwaSxcbiAgICAgIHN0YWdlOiBkZXZpY2VSZWdpc3RyYXRpb25BcGkuZGVwbG95bWVudFN0YWdlXG4gICAgfSk7XG5cbiAgICAvLyBHcmFudCBDbG91ZFdhdGNoIHBlcm1pc3Npb25zIGZvciBjdXN0b20gbWV0cmljc1xuICAgIGFnZW50RnVuY3Rpb24uYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ2Nsb3Vkd2F0Y2g6UHV0TWV0cmljRGF0YSdcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFsnKiddXG4gICAgfSkpO1xuXG4gICAgLy8gRXZlbnRCcmlkZ2UgcnVsZSB0byB0cmlnZ2VyIGRhaWx5IGF0IGNvbmZpZ3VyYWJsZSB0aW1lXG4gICAgY29uc3Qgc2NoZWR1bGVIb3VyID0gdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ3NjaGVkdWxlSG91cicpIHx8ICc5JztcbiAgICBjb25zdCBzY2hlZHVsZVJ1bGUgPSBuZXcgZXZlbnRzLlJ1bGUodGhpcywgJ1NwZW5kQ2hlY2tTY2hlZHVsZScsIHtcbiAgICAgIHNjaGVkdWxlOiBldmVudHMuU2NoZWR1bGUuY3Jvbih7XG4gICAgICAgIG1pbnV0ZTogJzAnLFxuICAgICAgICBob3VyOiBzY2hlZHVsZUhvdXIsXG4gICAgICAgIGRheTogJyonLFxuICAgICAgICBtb250aDogJyonLFxuICAgICAgICB5ZWFyOiAnKidcbiAgICAgIH0pLFxuICAgICAgZGVzY3JpcHRpb246IGBEYWlseSBBV1Mgc3BlbmQgY2hlY2sgYXQgJHtzY2hlZHVsZUhvdXJ9OjAwIFVUQ2BcbiAgICB9KTtcblxuICAgIC8vIEFkZCBMYW1iZGEgYXMgdGFyZ2V0XG4gICAgc2NoZWR1bGVSdWxlLmFkZFRhcmdldChuZXcgdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbihhZ2VudEZ1bmN0aW9uKSk7XG5cbiAgICAvLyBDcmVhdGUgU05TIHRvcGljIGZvciBvcGVyYXRpb25hbCBhbGVydHNcbiAgICBjb25zdCBvcGVyYXRpb25hbEFsZXJ0VG9waWMgPSBuZXcgc25zLlRvcGljKHRoaXMsICdPcGVyYXRpb25hbEFsZXJ0VG9waWMnLCB7XG4gICAgICBkaXNwbGF5TmFtZTogJ1NwZW5kIE1vbml0b3IgT3BlcmF0aW9uYWwgQWxlcnRzJyxcbiAgICAgIHRvcGljTmFtZTogJ3NwZW5kLW1vbml0b3Itb3BzLWFsZXJ0cydcbiAgICB9KTtcblxuICAgIC8vIENsb3VkV2F0Y2ggQWxhcm1zIGZvciBtb25pdG9yaW5nXG4gICAgXG4gICAgLy8gTGFtYmRhIGZ1bmN0aW9uIGVycm9ycyBhbGFybVxuICAgIGNvbnN0IGVycm9yQWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnTGFtYmRhRXJyb3JBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogJ1NwZW5kTW9uaXRvci1MYW1iZGFFcnJvcnMnLFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0FsYXJtIGZvciBMYW1iZGEgZnVuY3Rpb24gZXJyb3JzIGluIHNwZW5kIG1vbml0b3InLFxuICAgICAgbWV0cmljOiBhZ2VudEZ1bmN0aW9uLm1ldHJpY0Vycm9ycyh7XG4gICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIHN0YXRpc3RpYzogJ1N1bSdcbiAgICAgIH0pLFxuICAgICAgdGhyZXNob2xkOiAxLFxuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElOR1xuICAgIH0pO1xuICAgIGVycm9yQWxhcm0uYWRkQWxhcm1BY3Rpb24obmV3IGNsb3Vkd2F0Y2hBY3Rpb25zLlNuc0FjdGlvbihvcGVyYXRpb25hbEFsZXJ0VG9waWMpKTtcblxuICAgIC8vIExhbWJkYSBmdW5jdGlvbiBkdXJhdGlvbiBhbGFybVxuICAgIGNvbnN0IGR1cmF0aW9uQWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnTGFtYmRhRHVyYXRpb25BbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogJ1NwZW5kTW9uaXRvci1MYW1iZGFEdXJhdGlvbicsXG4gICAgICBhbGFybURlc2NyaXB0aW9uOiAnQWxhcm0gZm9yIExhbWJkYSBmdW5jdGlvbiBleGVjdXRpb24gZHVyYXRpb24nLFxuICAgICAgbWV0cmljOiBhZ2VudEZ1bmN0aW9uLm1ldHJpY0R1cmF0aW9uKHtcbiAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgc3RhdGlzdGljOiAnQXZlcmFnZSdcbiAgICAgIH0pLFxuICAgICAgdGhyZXNob2xkOiAyNDAwMDAsIC8vIDQgbWludXRlcyAodGltZW91dCBpcyA1IG1pbnV0ZXMpXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMixcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HXG4gICAgfSk7XG4gICAgZHVyYXRpb25BbGFybS5hZGRBbGFybUFjdGlvbihuZXcgY2xvdWR3YXRjaEFjdGlvbnMuU25zQWN0aW9uKG9wZXJhdGlvbmFsQWxlcnRUb3BpYykpO1xuXG4gICAgLy8gQ3VzdG9tIG1ldHJpYyBhbGFybXMgZm9yIGFnZW50IGV4ZWN1dGlvblxuICAgIGNvbnN0IGV4ZWN1dGlvbkZhaWx1cmVBbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdFeGVjdXRpb25GYWlsdXJlQWxhcm0nLCB7XG4gICAgICBhbGFybU5hbWU6ICdTcGVuZE1vbml0b3ItRXhlY3V0aW9uRmFpbHVyZXMnLFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0FsYXJtIGZvciBzcGVuZCBtb25pdG9yIGV4ZWN1dGlvbiBmYWlsdXJlcycsXG4gICAgICBtZXRyaWM6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgIG5hbWVzcGFjZTogJ1NwZW5kTW9uaXRvci9BZ2VudCcsXG4gICAgICAgIG1ldHJpY05hbWU6ICdFcnJvclJhdGUnLFxuICAgICAgICBkaW1lbnNpb25zTWFwOiB7XG4gICAgICAgICAgT3BlcmF0aW9uOiAnU3BlbmRNb25pdG9yaW5nJ1xuICAgICAgICB9LFxuICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICBzdGF0aXN0aWM6ICdTdW0nXG4gICAgICB9KSxcbiAgICAgIHRocmVzaG9sZDogMSxcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAxLFxuICAgICAgdHJlYXRNaXNzaW5nRGF0YTogY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkdcbiAgICB9KTtcbiAgICBleGVjdXRpb25GYWlsdXJlQWxhcm0uYWRkQWxhcm1BY3Rpb24obmV3IGNsb3Vkd2F0Y2hBY3Rpb25zLlNuc0FjdGlvbihvcGVyYXRpb25hbEFsZXJ0VG9waWMpKTtcblxuICAgIC8vIEFsZXJ0IGRlbGl2ZXJ5IGZhaWx1cmUgYWxhcm1cbiAgICBjb25zdCBhbGVydERlbGl2ZXJ5RmFpbHVyZUFsYXJtID0gbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ0FsZXJ0RGVsaXZlcnlGYWlsdXJlQWxhcm0nLCB7XG4gICAgICBhbGFybU5hbWU6ICdTcGVuZE1vbml0b3ItQWxlcnREZWxpdmVyeUZhaWx1cmVzJyxcbiAgICAgIGFsYXJtRGVzY3JpcHRpb246ICdBbGFybSBmb3IgYWxlcnQgZGVsaXZlcnkgZmFpbHVyZXMnLFxuICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdTcGVuZE1vbml0b3IvQWdlbnQnLFxuICAgICAgICBtZXRyaWNOYW1lOiAnQWxlcnREZWxpdmVyeUNvdW50JyxcbiAgICAgICAgZGltZW5zaW9uc01hcDoge1xuICAgICAgICAgIFN0YXR1czogJ0ZhaWx1cmUnXG4gICAgICAgIH0sXG4gICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIHN0YXRpc3RpYzogJ1N1bSdcbiAgICAgIH0pLFxuICAgICAgdGhyZXNob2xkOiAxLFxuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElOR1xuICAgIH0pO1xuICAgIGFsZXJ0RGVsaXZlcnlGYWlsdXJlQWxhcm0uYWRkQWxhcm1BY3Rpb24obmV3IGNsb3Vkd2F0Y2hBY3Rpb25zLlNuc0FjdGlvbihvcGVyYXRpb25hbEFsZXJ0VG9waWMpKTtcblxuICAgIC8vIGlPUy1zcGVjaWZpYyBDbG91ZFdhdGNoIEFsYXJtc1xuICAgIFxuICAgIC8vIGlPUyBub3RpZmljYXRpb24gZmFpbHVyZSBhbGFybVxuICAgIGNvbnN0IGlvc05vdGlmaWNhdGlvbkZhaWx1cmVBbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdpT1NOb3RpZmljYXRpb25GYWlsdXJlQWxhcm0nLCB7XG4gICAgICBhbGFybU5hbWU6ICdTcGVuZE1vbml0b3ItaU9TTm90aWZpY2F0aW9uRmFpbHVyZXMnLFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0FsYXJtIGZvciBpT1MgcHVzaCBub3RpZmljYXRpb24gZGVsaXZlcnkgZmFpbHVyZXMnLFxuICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdTcGVuZE1vbml0b3IvaU9TJyxcbiAgICAgICAgbWV0cmljTmFtZTogJ2lPU05vdGlmaWNhdGlvbkNvdW50JyxcbiAgICAgICAgZGltZW5zaW9uc01hcDoge1xuICAgICAgICAgIFN0YXR1czogJ0ZhaWx1cmUnXG4gICAgICAgIH0sXG4gICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIHN0YXRpc3RpYzogJ1N1bSdcbiAgICAgIH0pLFxuICAgICAgdGhyZXNob2xkOiAxLFxuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElOR1xuICAgIH0pO1xuICAgIGlvc05vdGlmaWNhdGlvbkZhaWx1cmVBbGFybS5hZGRBbGFybUFjdGlvbihuZXcgY2xvdWR3YXRjaEFjdGlvbnMuU25zQWN0aW9uKG9wZXJhdGlvbmFsQWxlcnRUb3BpYykpO1xuXG4gICAgLy8gaU9TIGludmFsaWQgdG9rZW4gYWxhcm0gKGhpZ2ggcmF0ZSBvZiBpbnZhbGlkIHRva2VucylcbiAgICBjb25zdCBpb3NJbnZhbGlkVG9rZW5BbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdpT1NJbnZhbGlkVG9rZW5BbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogJ1NwZW5kTW9uaXRvci1pT1NJbnZhbGlkVG9rZW5zJyxcbiAgICAgIGFsYXJtRGVzY3JpcHRpb246ICdBbGFybSBmb3IgaGlnaCByYXRlIG9mIGludmFsaWQgaU9TIGRldmljZSB0b2tlbnMnLFxuICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdTcGVuZE1vbml0b3IvaU9TJyxcbiAgICAgICAgbWV0cmljTmFtZTogJ2lPU0ludmFsaWRUb2tlbnMnLFxuICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDE1KSxcbiAgICAgICAgc3RhdGlzdGljOiAnU3VtJ1xuICAgICAgfSksXG4gICAgICB0aHJlc2hvbGQ6IDUsIC8vIEFsZXJ0IGlmIG1vcmUgdGhhbiA1IGludmFsaWQgdG9rZW5zIGluIDE1IG1pbnV0ZXNcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAxLFxuICAgICAgdHJlYXRNaXNzaW5nRGF0YTogY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkdcbiAgICB9KTtcbiAgICBpb3NJbnZhbGlkVG9rZW5BbGFybS5hZGRBbGFybUFjdGlvbihuZXcgY2xvdWR3YXRjaEFjdGlvbnMuU25zQWN0aW9uKG9wZXJhdGlvbmFsQWxlcnRUb3BpYykpO1xuXG4gICAgLy8gQVBOUyBjZXJ0aWZpY2F0ZSBoZWFsdGggYWxhcm0gKGJhc2VkIG9uIHZhbGlkYXRpb24gZmFpbHVyZXMpXG4gICAgY29uc3QgYXBuc0NlcnRpZmljYXRlSGVhbHRoQWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnQVBOU0NlcnRpZmljYXRlSGVhbHRoQWxhcm0nLCB7XG4gICAgICBhbGFybU5hbWU6ICdTcGVuZE1vbml0b3ItQVBOU0NlcnRpZmljYXRlSGVhbHRoJyxcbiAgICAgIGFsYXJtRGVzY3JpcHRpb246ICdBbGFybSBmb3IgQVBOUyBjZXJ0aWZpY2F0ZSB2YWxpZGF0aW9uIGZhaWx1cmVzJyxcbiAgICAgIG1ldHJpYzogbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgbmFtZXNwYWNlOiAnU3BlbmRNb25pdG9yL2lPUycsXG4gICAgICAgIG1ldHJpY05hbWU6ICdFeGVjdXRpb25Db3VudCcsXG4gICAgICAgIGRpbWVuc2lvbnNNYXA6IHtcbiAgICAgICAgICBPcGVyYXRpb246ICdBUE5TQ2VydGlmaWNhdGVWYWxpZGF0aW9uJyxcbiAgICAgICAgICBTdGF0dXM6ICdGYWlsdXJlJ1xuICAgICAgICB9LFxuICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICBzdGF0aXN0aWM6ICdTdW0nXG4gICAgICB9KSxcbiAgICAgIHRocmVzaG9sZDogMSxcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAyLCAvLyBBbGVydCBhZnRlciAyIGNvbnNlY3V0aXZlIGZhaWx1cmVzXG4gICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElOR1xuICAgIH0pO1xuICAgIGFwbnNDZXJ0aWZpY2F0ZUhlYWx0aEFsYXJtLmFkZEFsYXJtQWN0aW9uKG5ldyBjbG91ZHdhdGNoQWN0aW9ucy5TbnNBY3Rpb24ob3BlcmF0aW9uYWxBbGVydFRvcGljKSk7XG5cbiAgICAvLyBBUE5TIGNlcnRpZmljYXRlIGV4cGlyYXRpb24gd2FybmluZyBhbGFybSAoMzAgZGF5cylcbiAgICBjb25zdCBhcG5zQ2VydGlmaWNhdGVFeHBpcmF0aW9uV2FybmluZ0FsYXJtID0gbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ0FQTlNDZXJ0aWZpY2F0ZUV4cGlyYXRpb25XYXJuaW5nQWxhcm0nLCB7XG4gICAgICBhbGFybU5hbWU6ICdTcGVuZE1vbml0b3ItQVBOU0NlcnRpZmljYXRlRXhwaXJhdGlvbldhcm5pbmcnLFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ1dhcm5pbmcgYWxhcm0gZm9yIEFQTlMgY2VydGlmaWNhdGUgZXhwaXJpbmcgd2l0aGluIDMwIGRheXMnLFxuICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdTcGVuZE1vbml0b3IvaU9TJyxcbiAgICAgICAgbWV0cmljTmFtZTogJ0FQTlNDZXJ0aWZpY2F0ZURheXNVbnRpbEV4cGlyYXRpb24nLFxuICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5ob3Vycyg2KSxcbiAgICAgICAgc3RhdGlzdGljOiAnTWluaW11bSdcbiAgICAgIH0pLFxuICAgICAgdGhyZXNob2xkOiAzMCxcbiAgICAgIGNvbXBhcmlzb25PcGVyYXRvcjogY2xvdWR3YXRjaC5Db21wYXJpc29uT3BlcmF0b3IuTEVTU19USEFOX1RIUkVTSE9MRCxcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAxLFxuICAgICAgdHJlYXRNaXNzaW5nRGF0YTogY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkdcbiAgICB9KTtcbiAgICBhcG5zQ2VydGlmaWNhdGVFeHBpcmF0aW9uV2FybmluZ0FsYXJtLmFkZEFsYXJtQWN0aW9uKG5ldyBjbG91ZHdhdGNoQWN0aW9ucy5TbnNBY3Rpb24ob3BlcmF0aW9uYWxBbGVydFRvcGljKSk7XG5cbiAgICAvLyBBUE5TIGNlcnRpZmljYXRlIGV4cGlyYXRpb24gY3JpdGljYWwgYWxhcm0gKDcgZGF5cylcbiAgICBjb25zdCBhcG5zQ2VydGlmaWNhdGVFeHBpcmF0aW9uQ3JpdGljYWxBbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdBUE5TQ2VydGlmaWNhdGVFeHBpcmF0aW9uQ3JpdGljYWxBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogJ1NwZW5kTW9uaXRvci1BUE5TQ2VydGlmaWNhdGVFeHBpcmF0aW9uQ3JpdGljYWwnLFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0NyaXRpY2FsIGFsYXJtIGZvciBBUE5TIGNlcnRpZmljYXRlIGV4cGlyaW5nIHdpdGhpbiA3IGRheXMnLFxuICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdTcGVuZE1vbml0b3IvaU9TJyxcbiAgICAgICAgbWV0cmljTmFtZTogJ0FQTlNDZXJ0aWZpY2F0ZURheXNVbnRpbEV4cGlyYXRpb24nLFxuICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5ob3VycygxKSxcbiAgICAgICAgc3RhdGlzdGljOiAnTWluaW11bSdcbiAgICAgIH0pLFxuICAgICAgdGhyZXNob2xkOiA3LFxuICAgICAgY29tcGFyaXNvbk9wZXJhdG9yOiBjbG91ZHdhdGNoLkNvbXBhcmlzb25PcGVyYXRvci5MRVNTX1RIQU5fVEhSRVNIT0xELFxuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElOR1xuICAgIH0pO1xuICAgIGFwbnNDZXJ0aWZpY2F0ZUV4cGlyYXRpb25Dcml0aWNhbEFsYXJtLmFkZEFsYXJtQWN0aW9uKG5ldyBjbG91ZHdhdGNoQWN0aW9ucy5TbnNBY3Rpb24ob3BlcmF0aW9uYWxBbGVydFRvcGljKSk7XG5cbiAgICAvLyBpT1MgZmFsbGJhY2sgdXNhZ2UgYWxhcm0gKGhpZ2ggZmFsbGJhY2sgcmF0ZSBpbmRpY2F0ZXMgaU9TIGlzc3VlcylcbiAgICBjb25zdCBpb3NGYWxsYmFja1VzYWdlQWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnaU9TRmFsbGJhY2tVc2FnZUFsYXJtJywge1xuICAgICAgYWxhcm1OYW1lOiAnU3BlbmRNb25pdG9yLWlPU0ZhbGxiYWNrVXNhZ2UnLFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0FsYXJtIGZvciBoaWdoIGlPUyBub3RpZmljYXRpb24gZmFsbGJhY2sgdXNhZ2UgcmF0ZScsXG4gICAgICBtZXRyaWM6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgIG5hbWVzcGFjZTogJ1NwZW5kTW9uaXRvci9pT1MnLFxuICAgICAgICBtZXRyaWNOYW1lOiAnaU9TRmFsbGJhY2tVc2VkJyxcbiAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcygxNSksXG4gICAgICAgIHN0YXRpc3RpYzogJ1N1bSdcbiAgICAgIH0pLFxuICAgICAgdGhyZXNob2xkOiAzLCAvLyBBbGVydCBpZiBmYWxsYmFjayBpcyB1c2VkIDMgdGltZXMgaW4gMTUgbWludXRlc1xuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElOR1xuICAgIH0pO1xuICAgIGlvc0ZhbGxiYWNrVXNhZ2VBbGFybS5hZGRBbGFybUFjdGlvbihuZXcgY2xvdWR3YXRjaEFjdGlvbnMuU25zQWN0aW9uKG9wZXJhdGlvbmFsQWxlcnRUb3BpYykpO1xuXG4gICAgLy8gaU9TIGRldmljZSByZWdpc3RyYXRpb24gZmFpbHVyZSBhbGFybVxuICAgIGNvbnN0IGlvc1JlZ2lzdHJhdGlvbkZhaWx1cmVBbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdpT1NSZWdpc3RyYXRpb25GYWlsdXJlQWxhcm0nLCB7XG4gICAgICBhbGFybU5hbWU6ICdTcGVuZE1vbml0b3ItaU9TUmVnaXN0cmF0aW9uRmFpbHVyZXMnLFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0FsYXJtIGZvciBpT1MgZGV2aWNlIHJlZ2lzdHJhdGlvbiBmYWlsdXJlcycsXG4gICAgICBtZXRyaWM6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgIG5hbWVzcGFjZTogJ1NwZW5kTW9uaXRvci9pT1MnLFxuICAgICAgICBtZXRyaWNOYW1lOiAnRXhlY3V0aW9uQ291bnQnLFxuICAgICAgICBkaW1lbnNpb25zTWFwOiB7XG4gICAgICAgICAgT3BlcmF0aW9uOiAnUmVnaXN0ZXJEZXZpY2UnLFxuICAgICAgICAgIFN0YXR1czogJ0ZhaWx1cmUnXG4gICAgICAgIH0sXG4gICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIHN0YXRpc3RpYzogJ1N1bSdcbiAgICAgIH0pLFxuICAgICAgdGhyZXNob2xkOiAzLCAvLyBBbGVydCBhZnRlciAzIHJlZ2lzdHJhdGlvbiBmYWlsdXJlc1xuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElOR1xuICAgIH0pO1xuICAgIGlvc1JlZ2lzdHJhdGlvbkZhaWx1cmVBbGFybS5hZGRBbGFybUFjdGlvbihuZXcgY2xvdWR3YXRjaEFjdGlvbnMuU25zQWN0aW9uKG9wZXJhdGlvbmFsQWxlcnRUb3BpYykpO1xuXG4gICAgLy8gQ2xvdWRXYXRjaCBEYXNoYm9hcmQgZm9yIG1vbml0b3JpbmdcbiAgICBjb25zdCBkYXNoYm9hcmQgPSBuZXcgY2xvdWR3YXRjaC5EYXNoYm9hcmQodGhpcywgJ1NwZW5kTW9uaXRvckRhc2hib2FyZCcsIHtcbiAgICAgIGRhc2hib2FyZE5hbWU6ICdTcGVuZE1vbml0b3JBZ2VudCcsXG4gICAgICB3aWRnZXRzOiBbXG4gICAgICAgIFtcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgICAgICB0aXRsZTogJ0xhbWJkYSBGdW5jdGlvbiBNZXRyaWNzJyxcbiAgICAgICAgICAgIGxlZnQ6IFtcbiAgICAgICAgICAgICAgYWdlbnRGdW5jdGlvbi5tZXRyaWNJbnZvY2F0aW9ucyh7IHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSkgfSksXG4gICAgICAgICAgICAgIGFnZW50RnVuY3Rpb24ubWV0cmljRXJyb3JzKHsgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSB9KVxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHJpZ2h0OiBbXG4gICAgICAgICAgICAgIGFnZW50RnVuY3Rpb24ubWV0cmljRHVyYXRpb24oeyBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpIH0pXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICAgICAgaGVpZ2h0OiA2XG4gICAgICAgICAgfSlcbiAgICAgICAgXSxcbiAgICAgICAgW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgICAgIHRpdGxlOiAnU3BlbmQgTW9uaXRvcmluZyBNZXRyaWNzJyxcbiAgICAgICAgICAgIGxlZnQ6IFtcbiAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICBuYW1lc3BhY2U6ICdTcGVuZE1vbml0b3IvQWdlbnQnLFxuICAgICAgICAgICAgICAgIG1ldHJpY05hbWU6ICdDdXJyZW50U3BlbmQnLFxuICAgICAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLmhvdXJzKDEpLFxuICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogJ0F2ZXJhZ2UnXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICAgIG5hbWVzcGFjZTogJ1NwZW5kTW9uaXRvci9BZ2VudCcsXG4gICAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ1Byb2plY3RlZE1vbnRobHlTcGVuZCcsXG4gICAgICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24uaG91cnMoMSksXG4gICAgICAgICAgICAgICAgc3RhdGlzdGljOiAnQXZlcmFnZSdcbiAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgICAgICBoZWlnaHQ6IDZcbiAgICAgICAgICB9KVxuICAgICAgICBdLFxuICAgICAgICBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICAgICAgdGl0bGU6ICdBbGVydCBEZWxpdmVyeSBNZXRyaWNzJyxcbiAgICAgICAgICAgIGxlZnQ6IFtcbiAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICBuYW1lc3BhY2U6ICdTcGVuZE1vbml0b3IvQWdlbnQnLFxuICAgICAgICAgICAgICAgIG1ldHJpY05hbWU6ICdBbGVydERlbGl2ZXJ5Q291bnQnLFxuICAgICAgICAgICAgICAgIGRpbWVuc2lvbnNNYXA6IHsgU3RhdHVzOiAnU3VjY2VzcycgfSxcbiAgICAgICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bSdcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICAgICAgbmFtZXNwYWNlOiAnU3BlbmRNb25pdG9yL0FnZW50JyxcbiAgICAgICAgICAgICAgICBtZXRyaWNOYW1lOiAnQWxlcnREZWxpdmVyeUNvdW50JyxcbiAgICAgICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7IFN0YXR1czogJ0ZhaWx1cmUnIH0sXG4gICAgICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nXG4gICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICAgICAgaGVpZ2h0OiA2XG4gICAgICAgICAgfSlcbiAgICAgICAgXSxcbiAgICAgICAgW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgICAgIHRpdGxlOiAnaU9TIE5vdGlmaWNhdGlvbiBNZXRyaWNzJyxcbiAgICAgICAgICAgIGxlZnQ6IFtcbiAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICBuYW1lc3BhY2U6ICdTcGVuZE1vbml0b3IvaU9TJyxcbiAgICAgICAgICAgICAgICBtZXRyaWNOYW1lOiAnaU9TTm90aWZpY2F0aW9uQ291bnQnLFxuICAgICAgICAgICAgICAgIGRpbWVuc2lvbnNNYXA6IHsgU3RhdHVzOiAnU3VjY2VzcycgfSxcbiAgICAgICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bSdcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICAgICAgbmFtZXNwYWNlOiAnU3BlbmRNb25pdG9yL2lPUycsXG4gICAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ2lPU05vdGlmaWNhdGlvbkNvdW50JyxcbiAgICAgICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7IFN0YXR1czogJ0ZhaWx1cmUnIH0sXG4gICAgICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nXG4gICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgcmlnaHQ6IFtcbiAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICBuYW1lc3BhY2U6ICdTcGVuZE1vbml0b3IvaU9TJyxcbiAgICAgICAgICAgICAgICBtZXRyaWNOYW1lOiAnaU9TSW52YWxpZFRva2VucycsXG4gICAgICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcygxNSksXG4gICAgICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJ1xuICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgICAgIGhlaWdodDogNlxuICAgICAgICAgIH0pXG4gICAgICAgIF0sXG4gICAgICAgIFtcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgICAgICB0aXRsZTogJ2lPUyBTeXN0ZW0gSGVhbHRoIE1ldHJpY3MnLFxuICAgICAgICAgICAgbGVmdDogW1xuICAgICAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICAgIG5hbWVzcGFjZTogJ1NwZW5kTW9uaXRvci9pT1MnLFxuICAgICAgICAgICAgICAgIG1ldHJpY05hbWU6ICdFeGVjdXRpb25Db3VudCcsXG4gICAgICAgICAgICAgICAgZGltZW5zaW9uc01hcDogeyBcbiAgICAgICAgICAgICAgICAgIE9wZXJhdGlvbjogJ0FQTlNDZXJ0aWZpY2F0ZVZhbGlkYXRpb24nLFxuICAgICAgICAgICAgICAgICAgU3RhdHVzOiAnU3VjY2VzcydcbiAgICAgICAgICAgICAgICB9LFxuICAgICAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLmhvdXJzKDEpLFxuICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bSdcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICAgICAgbmFtZXNwYWNlOiAnU3BlbmRNb25pdG9yL2lPUycsXG4gICAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ0V4ZWN1dGlvbkNvdW50JyxcbiAgICAgICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7IFxuICAgICAgICAgICAgICAgICAgT3BlcmF0aW9uOiAnQVBOU0NlcnRpZmljYXRlVmFsaWRhdGlvbicsXG4gICAgICAgICAgICAgICAgICBTdGF0dXM6ICdGYWlsdXJlJ1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24uaG91cnMoMSksXG4gICAgICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJ1xuICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHJpZ2h0OiBbXG4gICAgICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICAgICAgbmFtZXNwYWNlOiAnU3BlbmRNb25pdG9yL2lPUycsXG4gICAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ2lPU0RldmljZUNvdW50JyxcbiAgICAgICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5ob3VycygxKSxcbiAgICAgICAgICAgICAgICBzdGF0aXN0aWM6ICdBdmVyYWdlJ1xuICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgICAgIGhlaWdodDogNlxuICAgICAgICAgIH0pXG4gICAgICAgIF0sXG4gICAgICAgIFtcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgICAgICB0aXRsZTogJ0FQTlMgQ2VydGlmaWNhdGUgSGVhbHRoJyxcbiAgICAgICAgICAgIGxlZnQ6IFtcbiAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICBuYW1lc3BhY2U6ICdTcGVuZE1vbml0b3IvaU9TJyxcbiAgICAgICAgICAgICAgICBtZXRyaWNOYW1lOiAnQVBOU0NlcnRpZmljYXRlRGF5c1VudGlsRXhwaXJhdGlvbicsXG4gICAgICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24uaG91cnMoNiksXG4gICAgICAgICAgICAgICAgc3RhdGlzdGljOiAnTWluaW11bSdcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICAgICAgbmFtZXNwYWNlOiAnU3BlbmRNb25pdG9yL2lPUycsXG4gICAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ0FQTlNDZXJ0aWZpY2F0ZVZhbGlkJyxcbiAgICAgICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5ob3VycygxKSxcbiAgICAgICAgICAgICAgICBzdGF0aXN0aWM6ICdBdmVyYWdlJ1xuICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHJpZ2h0OiBbXG4gICAgICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICAgICAgbmFtZXNwYWNlOiAnU3BlbmRNb25pdG9yL2lPUycsXG4gICAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ0FQTlNDZXJ0aWZpY2F0ZVdhcm5pbmdzJyxcbiAgICAgICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5ob3VycygxKSxcbiAgICAgICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICAgIG5hbWVzcGFjZTogJ1NwZW5kTW9uaXRvci9pT1MnLFxuICAgICAgICAgICAgICAgIG1ldHJpY05hbWU6ICdBUE5TQ2VydGlmaWNhdGVFcnJvcnMnLFxuICAgICAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLmhvdXJzKDEpLFxuICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bSdcbiAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgICAgICBoZWlnaHQ6IDZcbiAgICAgICAgICB9KVxuICAgICAgICBdLFxuICAgICAgICBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICAgICAgdGl0bGU6ICdpT1MgRmFsbGJhY2sgYW5kIEVycm9yIFJlY292ZXJ5JyxcbiAgICAgICAgICAgIGxlZnQ6IFtcbiAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICBuYW1lc3BhY2U6ICdTcGVuZE1vbml0b3IvaU9TJyxcbiAgICAgICAgICAgICAgICBtZXRyaWNOYW1lOiAnaU9TRmFsbGJhY2tVc2VkJyxcbiAgICAgICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7IFN0YXR1czogJ1N1Y2Nlc3MnIH0sXG4gICAgICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcygxNSksXG4gICAgICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJ1xuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICBuYW1lc3BhY2U6ICdTcGVuZE1vbml0b3IvaU9TJyxcbiAgICAgICAgICAgICAgICBtZXRyaWNOYW1lOiAnaU9TRmFsbGJhY2tVc2VkJyxcbiAgICAgICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7IFN0YXR1czogJ0ZhaWx1cmUnIH0sXG4gICAgICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcygxNSksXG4gICAgICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJ1xuICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHJpZ2h0OiBbXG4gICAgICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICAgICAgbmFtZXNwYWNlOiAnU3BlbmRNb25pdG9yL2lPUycsXG4gICAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ2lPU1BheWxvYWRTaXplJyxcbiAgICAgICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDE1KSxcbiAgICAgICAgICAgICAgICBzdGF0aXN0aWM6ICdBdmVyYWdlJ1xuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICBuYW1lc3BhY2U6ICdTcGVuZE1vbml0b3IvaU9TJyxcbiAgICAgICAgICAgICAgICBtZXRyaWNOYW1lOiAnaU9TTm90aWZpY2F0aW9uRGVsaXZlcnlUaW1lJyxcbiAgICAgICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDE1KSxcbiAgICAgICAgICAgICAgICBzdGF0aXN0aWM6ICdBdmVyYWdlJ1xuICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgICAgIGhlaWdodDogNlxuICAgICAgICAgIH0pXG4gICAgICAgIF1cbiAgICAgIF1cbiAgICB9KTtcblxuICAgIC8vIE91dHB1dHNcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnU05TVG9waWNBcm4nLCB7XG4gICAgICB2YWx1ZTogYWxlcnRUb3BpYy50b3BpY0FybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnU05TIFRvcGljIEFSTiBmb3Igc3BlbmQgYWxlcnRzJ1xuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FnZW50RnVuY3Rpb25OYW1lJywge1xuICAgICAgdmFsdWU6IGFnZW50RnVuY3Rpb24uZnVuY3Rpb25OYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdMYW1iZGEgZnVuY3Rpb24gbmFtZSBmb3IgdGhlIHNwZW5kIG1vbml0b3IgYWdlbnQnXG4gICAgfSk7XG5cbiAgICBpZiAoaW9zUGxhdGZvcm1BcHApIHtcbiAgICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdpT1NQbGF0Zm9ybUFwcGxpY2F0aW9uQXJuJywge1xuICAgICAgICB2YWx1ZTogaW9zUGxhdGZvcm1BcHAucmVmLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ1NOUyBQbGF0Zm9ybSBBcHBsaWNhdGlvbiBBUk4gZm9yIGlPUyBwdXNoIG5vdGlmaWNhdGlvbnMnXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRGV2aWNlVG9rZW5UYWJsZU5hbWUnLCB7XG4gICAgICB2YWx1ZTogZGV2aWNlVG9rZW5UYWJsZS50YWJsZU5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0R5bmFtb0RCIHRhYmxlIG5hbWUgZm9yIGRldmljZSB0b2tlbiBzdG9yYWdlJ1xuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0xvZ0dyb3VwTmFtZScsIHtcbiAgICAgIHZhbHVlOiBsb2dHcm91cC5sb2dHcm91cE5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0Nsb3VkV2F0Y2ggTG9nIEdyb3VwIGZvciB0aGUgc3BlbmQgbW9uaXRvciBhZ2VudCdcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdPcGVyYXRpb25hbEFsZXJ0VG9waWNBcm4nLCB7XG4gICAgICB2YWx1ZTogb3BlcmF0aW9uYWxBbGVydFRvcGljLnRvcGljQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdTTlMgVG9waWMgQVJOIGZvciBvcGVyYXRpb25hbCBhbGVydHMnXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRGFzaGJvYXJkVVJMJywge1xuICAgICAgdmFsdWU6IGBodHRwczovLyR7dGhpcy5yZWdpb259LmNvbnNvbGUuYXdzLmFtYXpvbi5jb20vY2xvdWR3YXRjaC9ob21lP3JlZ2lvbj0ke3RoaXMucmVnaW9ufSNkYXNoYm9hcmRzOm5hbWU9JHtkYXNoYm9hcmQuZGFzaGJvYXJkTmFtZX1gLFxuICAgICAgZGVzY3JpcHRpb246ICdDbG91ZFdhdGNoIERhc2hib2FyZCBVUkwgZm9yIG1vbml0b3JpbmcnXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRGV2aWNlUmVnaXN0cmF0aW9uQXBpVXJsJywge1xuICAgICAgdmFsdWU6IGRldmljZVJlZ2lzdHJhdGlvbkFwaS51cmwsXG4gICAgICBkZXNjcmlwdGlvbjogJ0RldmljZSBSZWdpc3RyYXRpb24gQVBJIEdhdGV3YXkgVVJMJ1xuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0RldmljZVJlZ2lzdHJhdGlvbkFwaUtleUlkJywge1xuICAgICAgdmFsdWU6IGFwaUtleS5rZXlJZCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVBJIEtleSBJRCBmb3IgZGV2aWNlIHJlZ2lzdHJhdGlvbiAocmV0cmlldmUgdmFsdWUgZnJvbSBBV1MgQ29uc29sZSknXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRGV2aWNlUmVnaXN0cmF0aW9uRnVuY3Rpb25OYW1lJywge1xuICAgICAgdmFsdWU6IGRldmljZVJlZ2lzdHJhdGlvbkZ1bmN0aW9uLmZ1bmN0aW9uTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnTGFtYmRhIGZ1bmN0aW9uIG5hbWUgZm9yIGRldmljZSByZWdpc3RyYXRpb24gQVBJJ1xuICAgIH0pO1xuICB9XG59Il19