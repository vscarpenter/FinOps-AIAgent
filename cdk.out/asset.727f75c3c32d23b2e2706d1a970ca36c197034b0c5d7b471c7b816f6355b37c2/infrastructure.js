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
            pointInTimeRecovery: true
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5mcmFzdHJ1Y3R1cmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvaW5mcmFzdHJ1Y3R1cmUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLCtEQUFpRDtBQUNqRCwrREFBaUQ7QUFDakQsd0VBQTBEO0FBQzFELHlEQUEyQztBQUMzQyx5REFBMkM7QUFDM0MsMkRBQTZDO0FBQzdDLG1FQUFxRDtBQUNyRCx1RUFBeUQ7QUFDekQsc0ZBQXdFO0FBQ3hFLHVFQUF5RDtBQUd6RCxNQUFhLGlCQUFrQixTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQzlDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBc0I7UUFDOUQsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsNkNBQTZDO1FBQzdDLE1BQU0sUUFBUSxHQUFHLElBQUksSUFBSSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsc0JBQXNCLEVBQUU7WUFDL0QsWUFBWSxFQUFFLGlDQUFpQztZQUMvQyxTQUFTLEVBQUUsSUFBSSxDQUFDLGFBQWEsQ0FBQyxTQUFTO1lBQ3ZDLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE9BQU87U0FDekMsQ0FBQyxDQUFDO1FBRUgsdUJBQXVCO1FBQ3ZCLE1BQU0sVUFBVSxHQUFHLElBQUksR0FBRyxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsaUJBQWlCLEVBQUU7WUFDeEQsV0FBVyxFQUFFLDBCQUEwQjtZQUN2QyxTQUFTLEVBQUUsa0JBQWtCO1NBQzlCLENBQUMsQ0FBQztRQUVILHdFQUF3RTtRQUN4RSxJQUFJLGNBQTJDLENBQUM7UUFDaEQsTUFBTSxlQUFlLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsaUJBQWlCLENBQUMsQ0FBQztRQUNuRSxNQUFNLGNBQWMsR0FBRyxJQUFJLENBQUMs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c0NBQXNDO1NBQ3BELENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQ3RDLEtBQUssRUFBRSxXQUFXLElBQUksQ0FBQyxNQUFNLGtEQUFrRCxJQUFJLENBQUMsTUFBTSxvQkFBb0IsU0FBUyxDQUFDLGFBQWEsRUFBRTtZQUN2SSxXQUFXLEVBQUUseUNBQXlDO1NBQ3ZELENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsMEJBQTBCLEVBQUU7WUFDbEQsS0FBSyxFQUFFLHFCQUFxQixDQUFDLEdBQUc7WUFDaEMsV0FBVyxFQUFFLHFDQUFxQztTQUNuRCxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLDRCQUE0QixFQUFFO1lBQ3BELEtBQUssRUFBRSxNQUFNLENBQUMsS0FBSztZQUNuQixXQUFXLEVBQUUsc0VBQXNFO1NBQ3BGLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsZ0NBQWdDLEVBQUU7WUFDeEQsS0FBSyxFQUFFLDBCQUEwQixDQUFDLFlBQVk7WUFDOUMsV0FBVyxFQUFFLGtEQUFrRDtTQUNoRSxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFwdUJELDhDQW91QkMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0ICogYXMgZXZlbnRzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1ldmVudHMnO1xuaW1wb3J0ICogYXMgdGFyZ2V0cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZXZlbnRzLXRhcmdldHMnO1xuaW1wb3J0ICogYXMgc25zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zbnMnO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xuaW1wb3J0ICogYXMgY2xvdWR3YXRjaCBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWR3YXRjaCc7XG5pbXBvcnQgKiBhcyBjbG91ZHdhdGNoQWN0aW9ucyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWR3YXRjaC1hY3Rpb25zJztcbmltcG9ydCAqIGFzIGFwaWdhdGV3YXkgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5cbmV4cG9ydCBjbGFzcyBTcGVuZE1vbml0b3JTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzPzogY2RrLlN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIC8vIENsb3VkV2F0Y2ggTG9nIEdyb3VwIHdpdGggcmV0ZW50aW9uIHBvbGljeVxuICAgIGNvbnN0IGxvZ0dyb3VwID0gbmV3IGxvZ3MuTG9nR3JvdXAodGhpcywgJ1NwZW5kTW9uaXRvckxvZ0dyb3VwJywge1xuICAgICAgbG9nR3JvdXBOYW1lOiAnL2F3cy9sYW1iZGEvc3BlbmQtbW9uaXRvci1hZ2VudCcsXG4gICAgICByZXRlbnRpb246IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfTU9OVEgsXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZXG4gICAgfSk7XG5cbiAgICAvLyBTTlMgVG9waWMgZm9yIGFsZXJ0c1xuICAgIGNvbnN0IGFsZXJ0VG9waWMgPSBuZXcgc25zLlRvcGljKHRoaXMsICdTcGVuZEFsZXJ0VG9waWMnLCB7XG4gICAgICBkaXNwbGF5TmFtZTogJ0FXUyBTcGVuZCBNb25pdG9yIEFsZXJ0cycsXG4gICAgICB0b3BpY05hbWU6ICdhd3Mtc3BlbmQtYWxlcnRzJ1xuICAgIH0pO1xuXG4gICAgLy8gU05TIFBsYXRmb3JtIEFwcGxpY2F0aW9uIGZvciBBUE5TIChpT1MgcHVzaCBub3RpZmljYXRpb25zKSAtIG9wdGlvbmFsXG4gICAgbGV0IGlvc1BsYXRmb3JtQXBwOiBjZGsuQ2ZuUmVzb3VyY2UgfCB1bmRlZmluZWQ7XG4gICAgY29uc3QgYXBuc0NlcnRpZmljYXRlID0gdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2FwbnNDZXJ0aWZpY2F0ZScpO1xuICAgIGNvbnN0IGFwbnNQcml2YXRlS2V5ID0gdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2FwbnNQcml2YXRlS2V5Jyk7XG4gICAgXG4gICAgaWYgKGFwbnNDZXJ0aWZpY2F0ZSAmJiBhcG5zUHJpdmF0ZUtleSkge1xuICAgICAgaW9zUGxhdGZvcm1BcHAgPSBuZXcgY2RrLkNmblJlc291cmNlKHRoaXMsICdpT1NQbGF0Zm9ybUFwcGxpY2F0aW9uJywge1xuICAgICAgICB0eXBlOiAnQVdTOjpTTlM6OlBsYXRmb3JtQXBwbGljYXRpb24nLFxuICAgICAgICBwcm9wZXJ0aWVzOiB7XG4gICAgICAgICAgTmFtZTogJ1NwZW5kTW9uaXRvckFQTlMnLFxuICAgICAgICAgIFBsYXRmb3JtOiAnQVBOU19TQU5EQk9YJywgLy8gVXNlIEFQTlNfU0FOREJPWCBmb3IgZGV2ZWxvcG1lbnRcbiAgICAgICAgICBBdHRyaWJ1dGVzOiB7XG4gICAgICAgICAgICBQbGF0Zm9ybUNyZWRlbnRpYWw6IGFwbnNDZXJ0aWZpY2F0ZSxcbiAgICAgICAgICAgIFBsYXRmb3JtUHJpbmNpcGFsOiBhcG5zUHJpdmF0ZUtleVxuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgfSk7XG4gICAgfVxuXG4gICAgLy8gT3B0aW9uYWwgRHluYW1vREIgdGFibGUgZm9yIGRldmljZSB0b2tlbiBzdG9yYWdlXG4gICAgY29uc3QgZGV2aWNlVG9rZW5UYWJsZSA9IG5ldyBkeW5hbW9kYi5UYWJsZSh0aGlzLCAnRGV2aWNlVG9rZW5UYWJsZScsIHtcbiAgICAgIHRhYmxlTmFtZTogJ3NwZW5kLW1vbml0b3ItZGV2aWNlLXRva2VucycsXG4gICAgICBwYXJ0aXRpb25LZXk6IHtcbiAgICAgICAgbmFtZTogJ2RldmljZVRva2VuJyxcbiAgICAgICAgdHlwZTogZHluYW1vZGIuQXR0cmlidXRlVHlwZS5TVFJJTkdcbiAgICAgIH0sXG4gICAgICBiaWxsaW5nTW9kZTogZHluYW1vZGIuQmlsbGluZ01vZGUuUEFZX1BFUl9SRVFVRVNULFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIHBvaW50SW5UaW1lUmVjb3Zlcnk6IHRydWVcbiAgICB9KTtcblxuICAgIC8vIExhbWJkYSBmdW5jdGlvbiBmb3IgdGhlIFN0cmFuZHMgYWdlbnRcbiAgICBjb25zdCBhZ2VudEZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnU3BlbmRNb25pdG9yQWdlbnQnLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIGhhbmRsZXI6ICdpbmRleC5oYW5kbGVyJyxcbiAgICAgIGNvZGU6IGxhbWJkYS5Db2RlLmZyb21Bc3NldCgnZGlzdCcpLFxuICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICBtZW1vcnlTaXplOiA1MTIsIC8vIEluY3JlYXNlZCBtZW1vcnkgZm9yIGlPUyBwcm9jZXNzaW5nXG4gICAgICBsb2dHcm91cDogbG9nR3JvdXAsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBTTlNfVE9QSUNfQVJOOiBhbGVydFRvcGljLnRvcGljQXJuLFxuICAgICAgICBTUEVORF9USFJFU0hPTEQ6IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdzcGVuZFRocmVzaG9sZCcpIHx8ICcxMCcsXG4gICAgICAgIENIRUNLX1BFUklPRF9EQVlTOiB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnY2hlY2tQZXJpb2REYXlzJykgfHwgJzEnLFxuICAgICAgICBSRVRSWV9BVFRFTVBUUzogdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ3JldHJ5QXR0ZW1wdHMnKSB8fCAnMycsXG4gICAgICAgIE1JTl9TRVJWSUNFX0NPU1Q6IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdtaW5TZXJ2aWNlQ29zdCcpIHx8ICcxJyxcbiAgICAgICAgSU9TX1BMQVRGT1JNX0FQUF9BUk46IGlvc1BsYXRmb3JtQXBwPy5yZWYgfHwgJycsXG4gICAgICAgIElPU19CVU5ETEVfSUQ6IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdpb3NCdW5kbGVJZCcpIHx8ICdjb20uZXhhbXBsZS5zcGVuZG1vbml0b3InLFxuICAgICAgICBBUE5TX1NBTkRCT1g6IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdhcG5zU2FuZGJveCcpIHx8ICd0cnVlJyxcbiAgICAgICAgREVWSUNFX1RPS0VOX1RBQkxFX05BTUU6IGRldmljZVRva2VuVGFibGUudGFibGVOYW1lXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBJQU0gcGVybWlzc2lvbnMgZm9yIENvc3QgRXhwbG9yZXJcbiAgICBhZ2VudEZ1bmN0aW9uLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdjZTpHZXRDb3N0QW5kVXNhZ2UnLFxuICAgICAgICAnY2U6R2V0VXNhZ2VSZXBvcnQnLFxuICAgICAgICAnY2U6R2V0RGltZW5zaW9uVmFsdWVzJyxcbiAgICAgICAgJ2NlOkdldFJlc2VydmF0aW9uQ292ZXJhZ2UnLFxuICAgICAgICAnY2U6R2V0UmVzZXJ2YXRpb25QdXJjaGFzZVJlY29tbWVuZGF0aW9uJyxcbiAgICAgICAgJ2NlOkdldFJlc2VydmF0aW9uVXRpbGl6YXRpb24nXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXVxuICAgIH0pKTtcblxuICAgIC8vIEdyYW50IFNOUyBwdWJsaXNoIHBlcm1pc3Npb25zXG4gICAgYWxlcnRUb3BpYy5ncmFudFB1Ymxpc2goYWdlbnRGdW5jdGlvbik7XG5cbiAgICAvLyBHcmFudCBTTlMgcGxhdGZvcm0gYXBwbGljYXRpb24gcGVybWlzc2lvbnMgZm9yIGlPUyBwdXNoIG5vdGlmaWNhdGlvbnMgKGlmIHBsYXRmb3JtIGFwcCBleGlzdHMpXG4gICAgaWYgKGlvc1BsYXRmb3JtQXBwKSB7XG4gICAgICBhZ2VudEZ1bmN0aW9uLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICdzbnM6Q3JlYXRlUGxhdGZvcm1FbmRwb2ludCcsXG4gICAgICAgICAgJ3NuczpEZWxldGVFbmRwb2ludCcsXG4gICAgICAgICAgJ3NuczpHZXRFbmRwb2ludEF0dHJpYnV0ZXMnLFxuICAgICAgICAgICdzbnM6U2V0RW5kcG9pbnRBdHRyaWJ1dGVzJyxcbiAgICAgICAgICAnc25zOkxpc3RFbmRwb2ludHNCeVBsYXRmb3JtQXBwbGljYXRpb24nLFxuICAgICAgICAgICdzbnM6R2V0UGxhdGZvcm1BcHBsaWNhdGlvbkF0dHJpYnV0ZXMnXG4gICAgICAgIF0sXG4gICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgIGlvc1BsYXRmb3JtQXBwLnJlZixcbiAgICAgICAgICBgJHtpb3NQbGF0Zm9ybUFwcC5yZWZ9LypgXG4gICAgICAgIF1cbiAgICAgIH0pKTtcbiAgICB9XG5cbiAgICAvLyBHcmFudCBEeW5hbW9EQiBwZXJtaXNzaW9ucyBmb3IgZGV2aWNlIHRva2VuIG1hbmFnZW1lbnRcbiAgICBkZXZpY2VUb2tlblRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShhZ2VudEZ1bmN0aW9uKTtcblxuICAgIC8vIERldmljZSBSZWdpc3RyYXRpb24gQVBJIExhbWJkYSBGdW5jdGlvblxuICAgIGNvbnN0IGRldmljZVJlZ2lzdHJhdGlvbkZ1bmN0aW9uID0gbmV3IGxhbWJkYS5GdW5jdGlvbih0aGlzLCAnRGV2aWNlUmVnaXN0cmF0aW9uRnVuY3Rpb24nLCB7XG4gICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfMThfWCxcbiAgICAgIGhhbmRsZXI6ICdkZXZpY2UtcmVnaXN0cmF0aW9uLWluZGV4LmhhbmRsZXInLFxuICAgICAgY29kZTogbGFtYmRhLkNvZGUuZnJvbUFzc2V0KCdkaXN0JyksXG4gICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICBtZW1vcnlTaXplOiAyNTYsXG4gICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICBJT1NfUExBVEZPUk1fQVBQX0FSTjogaW9zUGxhdGZvcm1BcHA/LnJlZiB8fCAnJyxcbiAgICAgICAgREVWSUNFX1RPS0VOX1RBQkxFX05BTUU6IGRldmljZVRva2VuVGFibGUudGFibGVOYW1lLFxuICAgICAgICBJT1NfQlVORExFX0lEOiB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnaW9zQnVuZGxlSWQnKSB8fCAnY29tLmV4YW1wbGUuc3BlbmRtb25pdG9yJ1xuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gR3JhbnQgcGVybWlzc2lvbnMgZm9yIGRldmljZSByZWdpc3RyYXRpb24gZnVuY3Rpb25cbiAgICBkZXZpY2VUb2tlblRhYmxlLmdyYW50UmVhZFdyaXRlRGF0YShkZXZpY2VSZWdpc3RyYXRpb25GdW5jdGlvbik7XG5cbiAgICAvLyBHcmFudCBTTlMgcGxhdGZvcm0gYXBwbGljYXRpb24gcGVybWlzc2lvbnMgZm9yIGRldmljZSByZWdpc3RyYXRpb25cbiAgICBpZiAoaW9zUGxhdGZvcm1BcHApIHtcbiAgICAgIGRldmljZVJlZ2lzdHJhdGlvbkZ1bmN0aW9uLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgICAgYWN0aW9uczogW1xuICAgICAgICAgICdzbnM6Q3JlYXRlUGxhdGZvcm1FbmRwb2ludCcsXG4gICAgICAgICAgJ3NuczpEZWxldGVFbmRwb2ludCcsXG4gICAgICAgICAgJ3NuczpHZXRFbmRwb2ludEF0dHJpYnV0ZXMnLFxuICAgICAgICAgICdzbnM6U2V0RW5kcG9pbnRBdHRyaWJ1dGVzJyxcbiAgICAgICAgICAnc25zOkxpc3RFbmRwb2ludHNCeVBsYXRmb3JtQXBwbGljYXRpb24nLFxuICAgICAgICAgICdzbnM6R2V0UGxhdGZvcm1BcHBsaWNhdGlvbkF0dHJpYnV0ZXMnXG4gICAgICAgIF0sXG4gICAgICAgIHJlc291cmNlczogW1xuICAgICAgICAgIGlvc1BsYXRmb3JtQXBwLnJlZixcbiAgICAgICAgICBgJHtpb3NQbGF0Zm9ybUFwcC5yZWZ9LypgXG4gICAgICAgIF1cbiAgICAgIH0pKTtcbiAgICB9XG5cbiAgICAvLyBBUEkgR2F0ZXdheSBmb3IgZGV2aWNlIHJlZ2lzdHJhdGlvblxuICAgIGNvbnN0IGRldmljZVJlZ2lzdHJhdGlvbkFwaSA9IG5ldyBhcGlnYXRld2F5LlJlc3RBcGkodGhpcywgJ0RldmljZVJlZ2lzdHJhdGlvbkFwaScsIHtcbiAgICAgIHJlc3RBcGlOYW1lOiAnaU9TIERldmljZSBSZWdpc3RyYXRpb24gQVBJJyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVBJIGZvciBtYW5hZ2luZyBpT1MgZGV2aWNlIHJlZ2lzdHJhdGlvbnMgZm9yIHNwZW5kIG1vbml0b3Igbm90aWZpY2F0aW9ucycsXG4gICAgICBkZWZhdWx0Q29yc1ByZWZsaWdodE9wdGlvbnM6IHtcbiAgICAgICAgYWxsb3dPcmlnaW5zOiBhcGlnYXRld2F5LkNvcnMuQUxMX09SSUdJTlMsXG4gICAgICAgIGFsbG93TWV0aG9kczogYXBpZ2F0ZXdheS5Db3JzLkFMTF9NRVRIT0RTLFxuICAgICAgICBhbGxvd0hlYWRlcnM6IFsnQ29udGVudC1UeXBlJywgJ1gtQW16LURhdGUnLCAnQXV0aG9yaXphdGlvbicsICdYLUFwaS1LZXknLCAnWC1BbXotU2VjdXJpdHktVG9rZW4nXVxuICAgICAgfSxcbiAgICAgIGRlcGxveU9wdGlvbnM6IHtcbiAgICAgICAgc3RhZ2VOYW1lOiAndjEnLFxuICAgICAgICBsb2dnaW5nTGV2ZWw6IGFwaWdhdGV3YXkuTWV0aG9kTG9nZ2luZ0xldmVsLklORk8sXG4gICAgICAgIGRhdGFUcmFjZUVuYWJsZWQ6IHRydWUsXG4gICAgICAgIG1ldHJpY3NFbmFibGVkOiB0cnVlXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBMYW1iZGEgaW50ZWdyYXRpb24gZm9yIGRldmljZSByZWdpc3RyYXRpb25cbiAgICBjb25zdCBkZXZpY2VSZWdpc3RyYXRpb25JbnRlZ3JhdGlvbiA9IG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGRldmljZVJlZ2lzdHJhdGlvbkZ1bmN0aW9uLCB7XG4gICAgICByZXF1ZXN0VGVtcGxhdGVzOiB7ICdhcHBsaWNhdGlvbi9qc29uJzogJ3sgXCJzdGF0dXNDb2RlXCI6IFwiMjAwXCIgfScgfVxuICAgIH0pO1xuXG4gICAgLy8gQVBJIEdhdGV3YXkgcmVzb3VyY2VzIGFuZCBtZXRob2RzXG4gICAgY29uc3QgZGV2aWNlc1Jlc291cmNlID0gZGV2aWNlUmVnaXN0cmF0aW9uQXBpLnJvb3QuYWRkUmVzb3VyY2UoJ2RldmljZXMnKTtcbiAgICBcbiAgICAvLyBQT1NUIC9kZXZpY2VzIC0gUmVnaXN0ZXIgbmV3IGRldmljZVxuICAgIGRldmljZXNSZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCBkZXZpY2VSZWdpc3RyYXRpb25JbnRlZ3JhdGlvbiwge1xuICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuTk9ORSxcbiAgICAgIGFwaUtleVJlcXVpcmVkOiB0cnVlLFxuICAgICAgcmVxdWVzdFZhbGlkYXRvcjogbmV3IGFwaWdhdGV3YXkuUmVxdWVzdFZhbGlkYXRvcih0aGlzLCAnRGV2aWNlUmVnaXN0cmF0aW9uVmFsaWRhdG9yJywge1xuICAgICAgICByZXN0QXBpOiBkZXZpY2VSZWdpc3RyYXRpb25BcGksXG4gICAgICAgIHJlcXVlc3RWYWxpZGF0b3JOYW1lOiAnZGV2aWNlLXJlZ2lzdHJhdGlvbi12YWxpZGF0b3InLFxuICAgICAgICB2YWxpZGF0ZVJlcXVlc3RCb2R5OiB0cnVlLFxuICAgICAgICB2YWxpZGF0ZVJlcXVlc3RQYXJhbWV0ZXJzOiBmYWxzZVxuICAgICAgfSksXG4gICAgICByZXF1ZXN0TW9kZWxzOiB7XG4gICAgICAgICdhcHBsaWNhdGlvbi9qc29uJzogbmV3IGFwaWdhdGV3YXkuTW9kZWwodGhpcywgJ0RldmljZVJlZ2lzdHJhdGlvbk1vZGVsJywge1xuICAgICAgICAgIHJlc3RBcGk6IGRldmljZVJlZ2lzdHJhdGlvbkFwaSxcbiAgICAgICAgICBtb2RlbE5hbWU6ICdEZXZpY2VSZWdpc3RyYXRpb25SZXF1ZXN0JyxcbiAgICAgICAgICBzY2hlbWE6IHtcbiAgICAgICAgICAgIHR5cGU6IGFwaWdhdGV3YXkuSnNvblNjaGVtYVR5cGUuT0JKRUNULFxuICAgICAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgICAgICBkZXZpY2VUb2tlbjoge1xuICAgICAgICAgICAgICAgIHR5cGU6IGFwaWdhdGV3YXkuSnNvblNjaGVtYVR5cGUuU1RSSU5HLFxuICAgICAgICAgICAgICAgIHBhdHRlcm46ICdeWzAtOWEtZkEtRl17NjR9JCdcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgdXNlcklkOiB7XG4gICAgICAgICAgICAgICAgdHlwZTogYXBpZ2F0ZXdheS5Kc29uU2NoZW1hVHlwZS5TVFJJTkdcbiAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgYnVuZGxlSWQ6IHtcbiAgICAgICAgICAgICAgICB0eXBlOiBhcGlnYXRld2F5Lkpzb25TY2hlbWFUeXBlLlNUUklOR1xuICAgICAgICAgICAgICB9XG4gICAgICAgICAgICB9LFxuICAgICAgICAgICAgcmVxdWlyZWQ6IFsnZGV2aWNlVG9rZW4nXVxuICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIFBVVCAvZGV2aWNlcyAtIFVwZGF0ZSBkZXZpY2UgdG9rZW5cbiAgICBkZXZpY2VzUmVzb3VyY2UuYWRkTWV0aG9kKCdQVVQnLCBkZXZpY2VSZWdpc3RyYXRpb25JbnRlZ3JhdGlvbiwge1xuICAgICAgYXV0aG9yaXphdGlvblR5cGU6IGFwaWdhdGV3YXkuQXV0aG9yaXphdGlvblR5cGUuTk9ORSxcbiAgICAgIGFwaUtleVJlcXVpcmVkOiB0cnVlXG4gICAgfSk7XG5cbiAgICAvLyBHRVQgL2RldmljZXMgLSBMaXN0IHVzZXIgZGV2aWNlc1xuICAgIGRldmljZXNSZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIGRldmljZVJlZ2lzdHJhdGlvbkludGVncmF0aW9uLCB7XG4gICAgICBhdXRob3JpemF0aW9uVHlwZTogYXBpZ2F0ZXdheS5BdXRob3JpemF0aW9uVHlwZS5OT05FLFxuICAgICAgYXBpS2V5UmVxdWlyZWQ6IHRydWUsXG4gICAgICByZXF1ZXN0UGFyYW1ldGVyczoge1xuICAgICAgICAnbWV0aG9kLnJlcXVlc3QucXVlcnlzdHJpbmcudXNlcklkJzogdHJ1ZSxcbiAgICAgICAgJ21ldGhvZC5yZXF1ZXN0LnF1ZXJ5c3RyaW5nLmxpbWl0JzogZmFsc2UsXG4gICAgICAgICdtZXRob2QucmVxdWVzdC5xdWVyeXN0cmluZy5uZXh0VG9rZW4nOiBmYWxzZVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gREVMRVRFIC9kZXZpY2VzL3tkZXZpY2VUb2tlbn0gLSBEZWxldGUgZGV2aWNlIHJlZ2lzdHJhdGlvblxuICAgIGNvbnN0IGRldmljZVRva2VuUmVzb3VyY2UgPSBkZXZpY2VzUmVzb3VyY2UuYWRkUmVzb3VyY2UoJ3tkZXZpY2VUb2tlbn0nKTtcbiAgICBkZXZpY2VUb2tlblJlc291cmNlLmFkZE1ldGhvZCgnREVMRVRFJywgZGV2aWNlUmVnaXN0cmF0aW9uSW50ZWdyYXRpb24sIHtcbiAgICAgIGF1dGhvcml6YXRpb25UeXBlOiBhcGlnYXRld2F5LkF1dGhvcml6YXRpb25UeXBlLk5PTkUsXG4gICAgICBhcGlLZXlSZXF1aXJlZDogdHJ1ZSxcbiAgICAgIHJlcXVlc3RQYXJhbWV0ZXJzOiB7XG4gICAgICAgICdtZXRob2QucmVxdWVzdC5wYXRoLmRldmljZVRva2VuJzogdHJ1ZVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gQVBJIEtleSBmb3IgcmF0ZSBsaW1pdGluZyBhbmQgYWNjZXNzIGNvbnRyb2xcbiAgICBjb25zdCBhcGlLZXkgPSBuZXcgYXBpZ2F0ZXdheS5BcGlLZXkodGhpcywgJ0RldmljZVJlZ2lzdHJhdGlvbkFwaUtleScsIHtcbiAgICAgIGFwaUtleU5hbWU6ICdzcGVuZC1tb25pdG9yLWRldmljZS1yZWdpc3RyYXRpb24ta2V5JyxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVBJIGtleSBmb3IgaU9TIGRldmljZSByZWdpc3RyYXRpb24gZW5kcG9pbnRzJ1xuICAgIH0pO1xuXG4gICAgLy8gVXNhZ2UgcGxhbiBmb3IgcmF0ZSBsaW1pdGluZ1xuICAgIGNvbnN0IHVzYWdlUGxhbiA9IG5ldyBhcGlnYXRld2F5LlVzYWdlUGxhbih0aGlzLCAnRGV2aWNlUmVnaXN0cmF0aW9uVXNhZ2VQbGFuJywge1xuICAgICAgbmFtZTogJ2RldmljZS1yZWdpc3RyYXRpb24tdXNhZ2UtcGxhbicsXG4gICAgICBkZXNjcmlwdGlvbjogJ1VzYWdlIHBsYW4gZm9yIGRldmljZSByZWdpc3RyYXRpb24gQVBJJyxcbiAgICAgIHRocm90dGxlOiB7XG4gICAgICAgIHJhdGVMaW1pdDogMTAwLFxuICAgICAgICBidXJzdExpbWl0OiAyMDBcbiAgICAgIH0sXG4gICAgICBxdW90YToge1xuICAgICAgICBsaW1pdDogMTAwMDAsXG4gICAgICAgIHBlcmlvZDogYXBpZ2F0ZXdheS5QZXJpb2QuREFZXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICB1c2FnZVBsYW4uYWRkQXBpS2V5KGFwaUtleSk7XG4gICAgdXNhZ2VQbGFuLmFkZEFwaVN0YWdlKHtcbiAgICAgIGFwaTogZGV2aWNlUmVnaXN0cmF0aW9uQXBpLFxuICAgICAgc3RhZ2U6IGRldmljZVJlZ2lzdHJhdGlvbkFwaS5kZXBsb3ltZW50U3RhZ2VcbiAgICB9KTtcblxuICAgIC8vIEdyYW50IENsb3VkV2F0Y2ggcGVybWlzc2lvbnMgZm9yIGN1c3RvbSBtZXRyaWNzXG4gICAgYWdlbnRGdW5jdGlvbi5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnY2xvdWR3YXRjaDpQdXRNZXRyaWNEYXRhJ1xuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogWycqJ11cbiAgICB9KSk7XG5cbiAgICAvLyBFdmVudEJyaWRnZSBydWxlIHRvIHRyaWdnZXIgZGFpbHkgYXQgY29uZmlndXJhYmxlIHRpbWVcbiAgICBjb25zdCBzY2hlZHVsZUhvdXIgPSB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnc2NoZWR1bGVIb3VyJykgfHwgJzknO1xuICAgIGNvbnN0IHNjaGVkdWxlUnVsZSA9IG5ldyBldmVudHMuUnVsZSh0aGlzLCAnU3BlbmRDaGVja1NjaGVkdWxlJywge1xuICAgICAgc2NoZWR1bGU6IGV2ZW50cy5TY2hlZHVsZS5jcm9uKHtcbiAgICAgICAgbWludXRlOiAnMCcsXG4gICAgICAgIGhvdXI6IHNjaGVkdWxlSG91cixcbiAgICAgICAgZGF5OiAnKicsXG4gICAgICAgIG1vbnRoOiAnKicsXG4gICAgICAgIHllYXI6ICcqJ1xuICAgICAgfSksXG4gICAgICBkZXNjcmlwdGlvbjogYERhaWx5IEFXUyBzcGVuZCBjaGVjayBhdCAke3NjaGVkdWxlSG91cn06MDAgVVRDYFxuICAgIH0pO1xuXG4gICAgLy8gQWRkIExhbWJkYSBhcyB0YXJnZXRcbiAgICBzY2hlZHVsZVJ1bGUuYWRkVGFyZ2V0KG5ldyB0YXJnZXRzLkxhbWJkYUZ1bmN0aW9uKGFnZW50RnVuY3Rpb24pKTtcblxuICAgIC8vIENyZWF0ZSBTTlMgdG9waWMgZm9yIG9wZXJhdGlvbmFsIGFsZXJ0c1xuICAgIGNvbnN0IG9wZXJhdGlvbmFsQWxlcnRUb3BpYyA9IG5ldyBzbnMuVG9waWModGhpcywgJ09wZXJhdGlvbmFsQWxlcnRUb3BpYycsIHtcbiAgICAgIGRpc3BsYXlOYW1lOiAnU3BlbmQgTW9uaXRvciBPcGVyYXRpb25hbCBBbGVydHMnLFxuICAgICAgdG9waWNOYW1lOiAnc3BlbmQtbW9uaXRvci1vcHMtYWxlcnRzJ1xuICAgIH0pO1xuXG4gICAgLy8gQ2xvdWRXYXRjaCBBbGFybXMgZm9yIG1vbml0b3JpbmdcbiAgICBcbiAgICAvLyBMYW1iZGEgZnVuY3Rpb24gZXJyb3JzIGFsYXJtXG4gICAgY29uc3QgZXJyb3JBbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdMYW1iZGFFcnJvckFsYXJtJywge1xuICAgICAgYWxhcm1OYW1lOiAnU3BlbmRNb25pdG9yLUxhbWJkYUVycm9ycycsXG4gICAgICBhbGFybURlc2NyaXB0aW9uOiAnQWxhcm0gZm9yIExhbWJkYSBmdW5jdGlvbiBlcnJvcnMgaW4gc3BlbmQgbW9uaXRvcicsXG4gICAgICBtZXRyaWM6IGFnZW50RnVuY3Rpb24ubWV0cmljRXJyb3JzKHtcbiAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgc3RhdGlzdGljOiAnU3VtJ1xuICAgICAgfSksXG4gICAgICB0aHJlc2hvbGQ6IDEsXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HXG4gICAgfSk7XG4gICAgZXJyb3JBbGFybS5hZGRBbGFybUFjdGlvbihuZXcgY2xvdWR3YXRjaEFjdGlvbnMuU25zQWN0aW9uKG9wZXJhdGlvbmFsQWxlcnRUb3BpYykpO1xuXG4gICAgLy8gTGFtYmRhIGZ1bmN0aW9uIGR1cmF0aW9uIGFsYXJtXG4gICAgY29uc3QgZHVyYXRpb25BbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdMYW1iZGFEdXJhdGlvbkFsYXJtJywge1xuICAgICAgYWxhcm1OYW1lOiAnU3BlbmRNb25pdG9yLUxhbWJkYUR1cmF0aW9uJyxcbiAgICAgIGFsYXJtRGVzY3JpcHRpb246ICdBbGFybSBmb3IgTGFtYmRhIGZ1bmN0aW9uIGV4ZWN1dGlvbiBkdXJhdGlvbicsXG4gICAgICBtZXRyaWM6IGFnZW50RnVuY3Rpb24ubWV0cmljRHVyYXRpb24oe1xuICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICBzdGF0aXN0aWM6ICdBdmVyYWdlJ1xuICAgICAgfSksXG4gICAgICB0aHJlc2hvbGQ6IDI0MDAwMCwgLy8gNCBtaW51dGVzICh0aW1lb3V0IGlzIDUgbWludXRlcylcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAyLFxuICAgICAgdHJlYXRNaXNzaW5nRGF0YTogY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkdcbiAgICB9KTtcbiAgICBkdXJhdGlvbkFsYXJtLmFkZEFsYXJtQWN0aW9uKG5ldyBjbG91ZHdhdGNoQWN0aW9ucy5TbnNBY3Rpb24ob3BlcmF0aW9uYWxBbGVydFRvcGljKSk7XG5cbiAgICAvLyBDdXN0b20gbWV0cmljIGFsYXJtcyBmb3IgYWdlbnQgZXhlY3V0aW9uXG4gICAgY29uc3QgZXhlY3V0aW9uRmFpbHVyZUFsYXJtID0gbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ0V4ZWN1dGlvbkZhaWx1cmVBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogJ1NwZW5kTW9uaXRvci1FeGVjdXRpb25GYWlsdXJlcycsXG4gICAgICBhbGFybURlc2NyaXB0aW9uOiAnQWxhcm0gZm9yIHNwZW5kIG1vbml0b3IgZXhlY3V0aW9uIGZhaWx1cmVzJyxcbiAgICAgIG1ldHJpYzogbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgbmFtZXNwYWNlOiAnU3BlbmRNb25pdG9yL0FnZW50JyxcbiAgICAgICAgbWV0cmljTmFtZTogJ0Vycm9yUmF0ZScsXG4gICAgICAgIGRpbWVuc2lvbnNNYXA6IHtcbiAgICAgICAgICBPcGVyYXRpb246ICdTcGVuZE1vbml0b3JpbmcnXG4gICAgICAgIH0sXG4gICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIHN0YXRpc3RpYzogJ1N1bSdcbiAgICAgIH0pLFxuICAgICAgdGhyZXNob2xkOiAxLFxuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElOR1xuICAgIH0pO1xuICAgIGV4ZWN1dGlvbkZhaWx1cmVBbGFybS5hZGRBbGFybUFjdGlvbihuZXcgY2xvdWR3YXRjaEFjdGlvbnMuU25zQWN0aW9uKG9wZXJhdGlvbmFsQWxlcnRUb3BpYykpO1xuXG4gICAgLy8gQWxlcnQgZGVsaXZlcnkgZmFpbHVyZSBhbGFybVxuICAgIGNvbnN0IGFsZXJ0RGVsaXZlcnlGYWlsdXJlQWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnQWxlcnREZWxpdmVyeUZhaWx1cmVBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogJ1NwZW5kTW9uaXRvci1BbGVydERlbGl2ZXJ5RmFpbHVyZXMnLFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0FsYXJtIGZvciBhbGVydCBkZWxpdmVyeSBmYWlsdXJlcycsXG4gICAgICBtZXRyaWM6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgIG5hbWVzcGFjZTogJ1NwZW5kTW9uaXRvci9BZ2VudCcsXG4gICAgICAgIG1ldHJpY05hbWU6ICdBbGVydERlbGl2ZXJ5Q291bnQnLFxuICAgICAgICBkaW1lbnNpb25zTWFwOiB7XG4gICAgICAgICAgU3RhdHVzOiAnRmFpbHVyZSdcbiAgICAgICAgfSxcbiAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgc3RhdGlzdGljOiAnU3VtJ1xuICAgICAgfSksXG4gICAgICB0aHJlc2hvbGQ6IDEsXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HXG4gICAgfSk7XG4gICAgYWxlcnREZWxpdmVyeUZhaWx1cmVBbGFybS5hZGRBbGFybUFjdGlvbihuZXcgY2xvdWR3YXRjaEFjdGlvbnMuU25zQWN0aW9uKG9wZXJhdGlvbmFsQWxlcnRUb3BpYykpO1xuXG4gICAgLy8gaU9TLXNwZWNpZmljIENsb3VkV2F0Y2ggQWxhcm1zXG4gICAgXG4gICAgLy8gaU9TIG5vdGlmaWNhdGlvbiBmYWlsdXJlIGFsYXJtXG4gICAgY29uc3QgaW9zTm90aWZpY2F0aW9uRmFpbHVyZUFsYXJtID0gbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ2lPU05vdGlmaWNhdGlvbkZhaWx1cmVBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogJ1NwZW5kTW9uaXRvci1pT1NOb3RpZmljYXRpb25GYWlsdXJlcycsXG4gICAgICBhbGFybURlc2NyaXB0aW9uOiAnQWxhcm0gZm9yIGlPUyBwdXNoIG5vdGlmaWNhdGlvbiBkZWxpdmVyeSBmYWlsdXJlcycsXG4gICAgICBtZXRyaWM6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgIG5hbWVzcGFjZTogJ1NwZW5kTW9uaXRvci9pT1MnLFxuICAgICAgICBtZXRyaWNOYW1lOiAnaU9TTm90aWZpY2F0aW9uQ291bnQnLFxuICAgICAgICBkaW1lbnNpb25zTWFwOiB7XG4gICAgICAgICAgU3RhdHVzOiAnRmFpbHVyZSdcbiAgICAgICAgfSxcbiAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgc3RhdGlzdGljOiAnU3VtJ1xuICAgICAgfSksXG4gICAgICB0aHJlc2hvbGQ6IDEsXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HXG4gICAgfSk7XG4gICAgaW9zTm90aWZpY2F0aW9uRmFpbHVyZUFsYXJtLmFkZEFsYXJtQWN0aW9uKG5ldyBjbG91ZHdhdGNoQWN0aW9ucy5TbnNBY3Rpb24ob3BlcmF0aW9uYWxBbGVydFRvcGljKSk7XG5cbiAgICAvLyBpT1MgaW52YWxpZCB0b2tlbiBhbGFybSAoaGlnaCByYXRlIG9mIGludmFsaWQgdG9rZW5zKVxuICAgIGNvbnN0IGlvc0ludmFsaWRUb2tlbkFsYXJtID0gbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ2lPU0ludmFsaWRUb2tlbkFsYXJtJywge1xuICAgICAgYWxhcm1OYW1lOiAnU3BlbmRNb25pdG9yLWlPU0ludmFsaWRUb2tlbnMnLFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0FsYXJtIGZvciBoaWdoIHJhdGUgb2YgaW52YWxpZCBpT1MgZGV2aWNlIHRva2VucycsXG4gICAgICBtZXRyaWM6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgIG5hbWVzcGFjZTogJ1NwZW5kTW9uaXRvci9pT1MnLFxuICAgICAgICBtZXRyaWNOYW1lOiAnaU9TSW52YWxpZFRva2VucycsXG4gICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTUpLFxuICAgICAgICBzdGF0aXN0aWM6ICdTdW0nXG4gICAgICB9KSxcbiAgICAgIHRocmVzaG9sZDogNSwgLy8gQWxlcnQgaWYgbW9yZSB0aGFuIDUgaW52YWxpZCB0b2tlbnMgaW4gMTUgbWludXRlc1xuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElOR1xuICAgIH0pO1xuICAgIGlvc0ludmFsaWRUb2tlbkFsYXJtLmFkZEFsYXJtQWN0aW9uKG5ldyBjbG91ZHdhdGNoQWN0aW9ucy5TbnNBY3Rpb24ob3BlcmF0aW9uYWxBbGVydFRvcGljKSk7XG5cbiAgICAvLyBBUE5TIGNlcnRpZmljYXRlIGhlYWx0aCBhbGFybSAoYmFzZWQgb24gdmFsaWRhdGlvbiBmYWlsdXJlcylcbiAgICBjb25zdCBhcG5zQ2VydGlmaWNhdGVIZWFsdGhBbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdBUE5TQ2VydGlmaWNhdGVIZWFsdGhBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogJ1NwZW5kTW9uaXRvci1BUE5TQ2VydGlmaWNhdGVIZWFsdGgnLFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0FsYXJtIGZvciBBUE5TIGNlcnRpZmljYXRlIHZhbGlkYXRpb24gZmFpbHVyZXMnLFxuICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdTcGVuZE1vbml0b3IvaU9TJyxcbiAgICAgICAgbWV0cmljTmFtZTogJ0V4ZWN1dGlvbkNvdW50JyxcbiAgICAgICAgZGltZW5zaW9uc01hcDoge1xuICAgICAgICAgIE9wZXJhdGlvbjogJ0FQTlNDZXJ0aWZpY2F0ZVZhbGlkYXRpb24nLFxuICAgICAgICAgIFN0YXR1czogJ0ZhaWx1cmUnXG4gICAgICAgIH0sXG4gICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIHN0YXRpc3RpYzogJ1N1bSdcbiAgICAgIH0pLFxuICAgICAgdGhyZXNob2xkOiAxLFxuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDIsIC8vIEFsZXJ0IGFmdGVyIDIgY29uc2VjdXRpdmUgZmFpbHVyZXNcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HXG4gICAgfSk7XG4gICAgYXBuc0NlcnRpZmljYXRlSGVhbHRoQWxhcm0uYWRkQWxhcm1BY3Rpb24obmV3IGNsb3Vkd2F0Y2hBY3Rpb25zLlNuc0FjdGlvbihvcGVyYXRpb25hbEFsZXJ0VG9waWMpKTtcblxuICAgIC8vIEFQTlMgY2VydGlmaWNhdGUgZXhwaXJhdGlvbiB3YXJuaW5nIGFsYXJtICgzMCBkYXlzKVxuICAgIGNvbnN0IGFwbnNDZXJ0aWZpY2F0ZUV4cGlyYXRpb25XYXJuaW5nQWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnQVBOU0NlcnRpZmljYXRlRXhwaXJhdGlvbldhcm5pbmdBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogJ1NwZW5kTW9uaXRvci1BUE5TQ2VydGlmaWNhdGVFeHBpcmF0aW9uV2FybmluZycsXG4gICAgICBhbGFybURlc2NyaXB0aW9uOiAnV2FybmluZyBhbGFybSBmb3IgQVBOUyBjZXJ0aWZpY2F0ZSBleHBpcmluZyB3aXRoaW4gMzAgZGF5cycsXG4gICAgICBtZXRyaWM6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgIG5hbWVzcGFjZTogJ1NwZW5kTW9uaXRvci9pT1MnLFxuICAgICAgICBtZXRyaWNOYW1lOiAnQVBOU0NlcnRpZmljYXRlRGF5c1VudGlsRXhwaXJhdGlvbicsXG4gICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLmhvdXJzKDYpLFxuICAgICAgICBzdGF0aXN0aWM6ICdNaW5pbXVtJ1xuICAgICAgfSksXG4gICAgICB0aHJlc2hvbGQ6IDMwLFxuICAgICAgY29tcGFyaXNvbk9wZXJhdG9yOiBjbG91ZHdhdGNoLkNvbXBhcmlzb25PcGVyYXRvci5MRVNTX1RIQU5fVEhSRVNIT0xELFxuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElOR1xuICAgIH0pO1xuICAgIGFwbnNDZXJ0aWZpY2F0ZUV4cGlyYXRpb25XYXJuaW5nQWxhcm0uYWRkQWxhcm1BY3Rpb24obmV3IGNsb3Vkd2F0Y2hBY3Rpb25zLlNuc0FjdGlvbihvcGVyYXRpb25hbEFsZXJ0VG9waWMpKTtcblxuICAgIC8vIEFQTlMgY2VydGlmaWNhdGUgZXhwaXJhdGlvbiBjcml0aWNhbCBhbGFybSAoNyBkYXlzKVxuICAgIGNvbnN0IGFwbnNDZXJ0aWZpY2F0ZUV4cGlyYXRpb25Dcml0aWNhbEFsYXJtID0gbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ0FQTlNDZXJ0aWZpY2F0ZUV4cGlyYXRpb25Dcml0aWNhbEFsYXJtJywge1xuICAgICAgYWxhcm1OYW1lOiAnU3BlbmRNb25pdG9yLUFQTlNDZXJ0aWZpY2F0ZUV4cGlyYXRpb25Dcml0aWNhbCcsXG4gICAgICBhbGFybURlc2NyaXB0aW9uOiAnQ3JpdGljYWwgYWxhcm0gZm9yIEFQTlMgY2VydGlmaWNhdGUgZXhwaXJpbmcgd2l0aGluIDcgZGF5cycsXG4gICAgICBtZXRyaWM6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgIG5hbWVzcGFjZTogJ1NwZW5kTW9uaXRvci9pT1MnLFxuICAgICAgICBtZXRyaWNOYW1lOiAnQVBOU0NlcnRpZmljYXRlRGF5c1VudGlsRXhwaXJhdGlvbicsXG4gICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLmhvdXJzKDEpLFxuICAgICAgICBzdGF0aXN0aWM6ICdNaW5pbXVtJ1xuICAgICAgfSksXG4gICAgICB0aHJlc2hvbGQ6IDcsXG4gICAgICBjb21wYXJpc29uT3BlcmF0b3I6IGNsb3Vkd2F0Y2guQ29tcGFyaXNvbk9wZXJhdG9yLkxFU1NfVEhBTl9USFJFU0hPTEQsXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HXG4gICAgfSk7XG4gICAgYXBuc0NlcnRpZmljYXRlRXhwaXJhdGlvbkNyaXRpY2FsQWxhcm0uYWRkQWxhcm1BY3Rpb24obmV3IGNsb3Vkd2F0Y2hBY3Rpb25zLlNuc0FjdGlvbihvcGVyYXRpb25hbEFsZXJ0VG9waWMpKTtcblxuICAgIC8vIGlPUyBmYWxsYmFjayB1c2FnZSBhbGFybSAoaGlnaCBmYWxsYmFjayByYXRlIGluZGljYXRlcyBpT1MgaXNzdWVzKVxuICAgIGNvbnN0IGlvc0ZhbGxiYWNrVXNhZ2VBbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdpT1NGYWxsYmFja1VzYWdlQWxhcm0nLCB7XG4gICAgICBhbGFybU5hbWU6ICdTcGVuZE1vbml0b3ItaU9TRmFsbGJhY2tVc2FnZScsXG4gICAgICBhbGFybURlc2NyaXB0aW9uOiAnQWxhcm0gZm9yIGhpZ2ggaU9TIG5vdGlmaWNhdGlvbiBmYWxsYmFjayB1c2FnZSByYXRlJyxcbiAgICAgIG1ldHJpYzogbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgbmFtZXNwYWNlOiAnU3BlbmRNb25pdG9yL2lPUycsXG4gICAgICAgIG1ldHJpY05hbWU6ICdpT1NGYWxsYmFja1VzZWQnLFxuICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDE1KSxcbiAgICAgICAgc3RhdGlzdGljOiAnU3VtJ1xuICAgICAgfSksXG4gICAgICB0aHJlc2hvbGQ6IDMsIC8vIEFsZXJ0IGlmIGZhbGxiYWNrIGlzIHVzZWQgMyB0aW1lcyBpbiAxNSBtaW51dGVzXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HXG4gICAgfSk7XG4gICAgaW9zRmFsbGJhY2tVc2FnZUFsYXJtLmFkZEFsYXJtQWN0aW9uKG5ldyBjbG91ZHdhdGNoQWN0aW9ucy5TbnNBY3Rpb24ob3BlcmF0aW9uYWxBbGVydFRvcGljKSk7XG5cbiAgICAvLyBpT1MgZGV2aWNlIHJlZ2lzdHJhdGlvbiBmYWlsdXJlIGFsYXJtXG4gICAgY29uc3QgaW9zUmVnaXN0cmF0aW9uRmFpbHVyZUFsYXJtID0gbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ2lPU1JlZ2lzdHJhdGlvbkZhaWx1cmVBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogJ1NwZW5kTW9uaXRvci1pT1NSZWdpc3RyYXRpb25GYWlsdXJlcycsXG4gICAgICBhbGFybURlc2NyaXB0aW9uOiAnQWxhcm0gZm9yIGlPUyBkZXZpY2UgcmVnaXN0cmF0aW9uIGZhaWx1cmVzJyxcbiAgICAgIG1ldHJpYzogbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgbmFtZXNwYWNlOiAnU3BlbmRNb25pdG9yL2lPUycsXG4gICAgICAgIG1ldHJpY05hbWU6ICdFeGVjdXRpb25Db3VudCcsXG4gICAgICAgIGRpbWVuc2lvbnNNYXA6IHtcbiAgICAgICAgICBPcGVyYXRpb246ICdSZWdpc3RlckRldmljZScsXG4gICAgICAgICAgU3RhdHVzOiAnRmFpbHVyZSdcbiAgICAgICAgfSxcbiAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgc3RhdGlzdGljOiAnU3VtJ1xuICAgICAgfSksXG4gICAgICB0aHJlc2hvbGQ6IDMsIC8vIEFsZXJ0IGFmdGVyIDMgcmVnaXN0cmF0aW9uIGZhaWx1cmVzXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMSxcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HXG4gICAgfSk7XG4gICAgaW9zUmVnaXN0cmF0aW9uRmFpbHVyZUFsYXJtLmFkZEFsYXJtQWN0aW9uKG5ldyBjbG91ZHdhdGNoQWN0aW9ucy5TbnNBY3Rpb24ob3BlcmF0aW9uYWxBbGVydFRvcGljKSk7XG5cbiAgICAvLyBDbG91ZFdhdGNoIERhc2hib2FyZCBmb3IgbW9uaXRvcmluZ1xuICAgIGNvbnN0IGRhc2hib2FyZCA9IG5ldyBjbG91ZHdhdGNoLkRhc2hib2FyZCh0aGlzLCAnU3BlbmRNb25pdG9yRGFzaGJvYXJkJywge1xuICAgICAgZGFzaGJvYXJkTmFtZTogJ1NwZW5kTW9uaXRvckFnZW50JyxcbiAgICAgIHdpZGdldHM6IFtcbiAgICAgICAgW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgICAgIHRpdGxlOiAnTGFtYmRhIEZ1bmN0aW9uIE1ldHJpY3MnLFxuICAgICAgICAgICAgbGVmdDogW1xuICAgICAgICAgICAgICBhZ2VudEZ1bmN0aW9uLm1ldHJpY0ludm9jYXRpb25zKHsgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSB9KSxcbiAgICAgICAgICAgICAgYWdlbnRGdW5jdGlvbi5tZXRyaWNFcnJvcnMoeyBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpIH0pXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgcmlnaHQ6IFtcbiAgICAgICAgICAgICAgYWdlbnRGdW5jdGlvbi5tZXRyaWNEdXJhdGlvbih7IHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSkgfSlcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgICAgICBoZWlnaHQ6IDZcbiAgICAgICAgICB9KVxuICAgICAgICBdLFxuICAgICAgICBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICAgICAgdGl0bGU6ICdTcGVuZCBNb25pdG9yaW5nIE1ldHJpY3MnLFxuICAgICAgICAgICAgbGVmdDogW1xuICAgICAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICAgIG5hbWVzcGFjZTogJ1NwZW5kTW9uaXRvci9BZ2VudCcsXG4gICAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ0N1cnJlbnRTcGVuZCcsXG4gICAgICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24uaG91cnMoMSksXG4gICAgICAgICAgICAgICAgc3RhdGlzdGljOiAnQXZlcmFnZSdcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICAgICAgbmFtZXNwYWNlOiAnU3BlbmRNb25pdG9yL0FnZW50JyxcbiAgICAgICAgICAgICAgICBtZXRyaWNOYW1lOiAnUHJvamVjdGVkTW9udGhseVNwZW5kJyxcbiAgICAgICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5ob3VycygxKSxcbiAgICAgICAgICAgICAgICBzdGF0aXN0aWM6ICdBdmVyYWdlJ1xuICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgICAgIGhlaWdodDogNlxuICAgICAgICAgIH0pXG4gICAgICAgIF0sXG4gICAgICAgIFtcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgICAgICB0aXRsZTogJ0FsZXJ0IERlbGl2ZXJ5IE1ldHJpY3MnLFxuICAgICAgICAgICAgbGVmdDogW1xuICAgICAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICAgIG5hbWVzcGFjZTogJ1NwZW5kTW9uaXRvci9BZ2VudCcsXG4gICAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ0FsZXJ0RGVsaXZlcnlDb3VudCcsXG4gICAgICAgICAgICAgICAgZGltZW5zaW9uc01hcDogeyBTdGF0dXM6ICdTdWNjZXNzJyB9LFxuICAgICAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJ1xuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICBuYW1lc3BhY2U6ICdTcGVuZE1vbml0b3IvQWdlbnQnLFxuICAgICAgICAgICAgICAgIG1ldHJpY05hbWU6ICdBbGVydERlbGl2ZXJ5Q291bnQnLFxuICAgICAgICAgICAgICAgIGRpbWVuc2lvbnNNYXA6IHsgU3RhdHVzOiAnRmFpbHVyZScgfSxcbiAgICAgICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bSdcbiAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICB3aWR0aDogMTIsXG4gICAgICAgICAgICBoZWlnaHQ6IDZcbiAgICAgICAgICB9KVxuICAgICAgICBdLFxuICAgICAgICBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICAgICAgdGl0bGU6ICdpT1MgTm90aWZpY2F0aW9uIE1ldHJpY3MnLFxuICAgICAgICAgICAgbGVmdDogW1xuICAgICAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICAgIG5hbWVzcGFjZTogJ1NwZW5kTW9uaXRvci9pT1MnLFxuICAgICAgICAgICAgICAgIG1ldHJpY05hbWU6ICdpT1NOb3RpZmljYXRpb25Db3VudCcsXG4gICAgICAgICAgICAgICAgZGltZW5zaW9uc01hcDogeyBTdGF0dXM6ICdTdWNjZXNzJyB9LFxuICAgICAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJ1xuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICBuYW1lc3BhY2U6ICdTcGVuZE1vbml0b3IvaU9TJyxcbiAgICAgICAgICAgICAgICBtZXRyaWNOYW1lOiAnaU9TTm90aWZpY2F0aW9uQ291bnQnLFxuICAgICAgICAgICAgICAgIGRpbWVuc2lvbnNNYXA6IHsgU3RhdHVzOiAnRmFpbHVyZScgfSxcbiAgICAgICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bSdcbiAgICAgICAgICAgICAgfSlcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICByaWdodDogW1xuICAgICAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICAgIG5hbWVzcGFjZTogJ1NwZW5kTW9uaXRvci9pT1MnLFxuICAgICAgICAgICAgICAgIG1ldHJpY05hbWU6ICdpT1NJbnZhbGlkVG9rZW5zJyxcbiAgICAgICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDE1KSxcbiAgICAgICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nXG4gICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICAgICAgaGVpZ2h0OiA2XG4gICAgICAgICAgfSlcbiAgICAgICAgXSxcbiAgICAgICAgW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgICAgIHRpdGxlOiAnaU9TIFN5c3RlbSBIZWFsdGggTWV0cmljcycsXG4gICAgICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICAgICAgbmFtZXNwYWNlOiAnU3BlbmRNb25pdG9yL2lPUycsXG4gICAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ0V4ZWN1dGlvbkNvdW50JyxcbiAgICAgICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7IFxuICAgICAgICAgICAgICAgICAgT3BlcmF0aW9uOiAnQVBOU0NlcnRpZmljYXRlVmFsaWRhdGlvbicsXG4gICAgICAgICAgICAgICAgICBTdGF0dXM6ICdTdWNjZXNzJ1xuICAgICAgICAgICAgICAgIH0sXG4gICAgICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24uaG91cnMoMSksXG4gICAgICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJ1xuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICBuYW1lc3BhY2U6ICdTcGVuZE1vbml0b3IvaU9TJyxcbiAgICAgICAgICAgICAgICBtZXRyaWNOYW1lOiAnRXhlY3V0aW9uQ291bnQnLFxuICAgICAgICAgICAgICAgIGRpbWVuc2lvbnNNYXA6IHsgXG4gICAgICAgICAgICAgICAgICBPcGVyYXRpb246ICdBUE5TQ2VydGlmaWNhdGVWYWxpZGF0aW9uJyxcbiAgICAgICAgICAgICAgICAgIFN0YXR1czogJ0ZhaWx1cmUnXG4gICAgICAgICAgICAgICAgfSxcbiAgICAgICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5ob3VycygxKSxcbiAgICAgICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nXG4gICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgcmlnaHQ6IFtcbiAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICBuYW1lc3BhY2U6ICdTcGVuZE1vbml0b3IvaU9TJyxcbiAgICAgICAgICAgICAgICBtZXRyaWNOYW1lOiAnaU9TRGV2aWNlQ291bnQnLFxuICAgICAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLmhvdXJzKDEpLFxuICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogJ0F2ZXJhZ2UnXG4gICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICAgICAgaGVpZ2h0OiA2XG4gICAgICAgICAgfSlcbiAgICAgICAgXSxcbiAgICAgICAgW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgICAgIHRpdGxlOiAnQVBOUyBDZXJ0aWZpY2F0ZSBIZWFsdGgnLFxuICAgICAgICAgICAgbGVmdDogW1xuICAgICAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICAgIG5hbWVzcGFjZTogJ1NwZW5kTW9uaXRvci9pT1MnLFxuICAgICAgICAgICAgICAgIG1ldHJpY05hbWU6ICdBUE5TQ2VydGlmaWNhdGVEYXlzVW50aWxFeHBpcmF0aW9uJyxcbiAgICAgICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5ob3Vycyg2KSxcbiAgICAgICAgICAgICAgICBzdGF0aXN0aWM6ICdNaW5pbXVtJ1xuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICBuYW1lc3BhY2U6ICdTcGVuZE1vbml0b3IvaU9TJyxcbiAgICAgICAgICAgICAgICBtZXRyaWNOYW1lOiAnQVBOU0NlcnRpZmljYXRlVmFsaWQnLFxuICAgICAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLmhvdXJzKDEpLFxuICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogJ0F2ZXJhZ2UnXG4gICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgcmlnaHQ6IFtcbiAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICBuYW1lc3BhY2U6ICdTcGVuZE1vbml0b3IvaU9TJyxcbiAgICAgICAgICAgICAgICBtZXRyaWNOYW1lOiAnQVBOU0NlcnRpZmljYXRlV2FybmluZ3MnLFxuICAgICAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLmhvdXJzKDEpLFxuICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogJ1N1bSdcbiAgICAgICAgICAgICAgfSksXG4gICAgICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICAgICAgbmFtZXNwYWNlOiAnU3BlbmRNb25pdG9yL2lPUycsXG4gICAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ0FQTlNDZXJ0aWZpY2F0ZUVycm9ycycsXG4gICAgICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24uaG91cnMoMSksXG4gICAgICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJ1xuICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgICAgIGhlaWdodDogNlxuICAgICAgICAgIH0pXG4gICAgICAgIF0sXG4gICAgICAgIFtcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgICAgICB0aXRsZTogJ2lPUyBGYWxsYmFjayBhbmQgRXJyb3IgUmVjb3ZlcnknLFxuICAgICAgICAgICAgbGVmdDogW1xuICAgICAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICAgIG5hbWVzcGFjZTogJ1NwZW5kTW9uaXRvci9pT1MnLFxuICAgICAgICAgICAgICAgIG1ldHJpY05hbWU6ICdpT1NGYWxsYmFja1VzZWQnLFxuICAgICAgICAgICAgICAgIGRpbWVuc2lvbnNNYXA6IHsgU3RhdHVzOiAnU3VjY2VzcycgfSxcbiAgICAgICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDE1KSxcbiAgICAgICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICAgIG5hbWVzcGFjZTogJ1NwZW5kTW9uaXRvci9pT1MnLFxuICAgICAgICAgICAgICAgIG1ldHJpY05hbWU6ICdpT1NGYWxsYmFja1VzZWQnLFxuICAgICAgICAgICAgICAgIGRpbWVuc2lvbnNNYXA6IHsgU3RhdHVzOiAnRmFpbHVyZScgfSxcbiAgICAgICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDE1KSxcbiAgICAgICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nXG4gICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgcmlnaHQ6IFtcbiAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICBuYW1lc3BhY2U6ICdTcGVuZE1vbml0b3IvaU9TJyxcbiAgICAgICAgICAgICAgICBtZXRyaWNOYW1lOiAnaU9TUGF5bG9hZFNpemUnLFxuICAgICAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTUpLFxuICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogJ0F2ZXJhZ2UnXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICAgIG5hbWVzcGFjZTogJ1NwZW5kTW9uaXRvci9pT1MnLFxuICAgICAgICAgICAgICAgIG1ldHJpY05hbWU6ICdpT1NOb3RpZmljYXRpb25EZWxpdmVyeVRpbWUnLFxuICAgICAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoMTUpLFxuICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogJ0F2ZXJhZ2UnXG4gICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICAgICAgaGVpZ2h0OiA2XG4gICAgICAgICAgfSlcbiAgICAgICAgXVxuICAgICAgXVxuICAgIH0pO1xuXG4gICAgLy8gT3V0cHV0c1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdTTlNUb3BpY0FybicsIHtcbiAgICAgIHZhbHVlOiBhbGVydFRvcGljLnRvcGljQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdTTlMgVG9waWMgQVJOIGZvciBzcGVuZCBhbGVydHMnXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQWdlbnRGdW5jdGlvbk5hbWUnLCB7XG4gICAgICB2YWx1ZTogYWdlbnRGdW5jdGlvbi5mdW5jdGlvbk5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0xhbWJkYSBmdW5jdGlvbiBuYW1lIGZvciB0aGUgc3BlbmQgbW9uaXRvciBhZ2VudCdcbiAgICB9KTtcblxuICAgIGlmIChpb3NQbGF0Zm9ybUFwcCkge1xuICAgICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ2lPU1BsYXRmb3JtQXBwbGljYXRpb25Bcm4nLCB7XG4gICAgICAgIHZhbHVlOiBpb3NQbGF0Zm9ybUFwcC5yZWYsXG4gICAgICAgIGRlc2NyaXB0aW9uOiAnU05TIFBsYXRmb3JtIEFwcGxpY2F0aW9uIEFSTiBmb3IgaU9TIHB1c2ggbm90aWZpY2F0aW9ucydcbiAgICAgIH0pO1xuICAgIH1cblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdEZXZpY2VUb2tlblRhYmxlTmFtZScsIHtcbiAgICAgIHZhbHVlOiBkZXZpY2VUb2tlblRhYmxlLnRhYmxlTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRHluYW1vREIgdGFibGUgbmFtZSBmb3IgZGV2aWNlIHRva2VuIHN0b3JhZ2UnXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnTG9nR3JvdXBOYW1lJywge1xuICAgICAgdmFsdWU6IGxvZ0dyb3VwLmxvZ0dyb3VwTmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ2xvdWRXYXRjaCBMb2cgR3JvdXAgZm9yIHRoZSBzcGVuZCBtb25pdG9yIGFnZW50J1xuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ09wZXJhdGlvbmFsQWxlcnRUb3BpY0FybicsIHtcbiAgICAgIHZhbHVlOiBvcGVyYXRpb25hbEFsZXJ0VG9waWMudG9waWNBcm4sXG4gICAgICBkZXNjcmlwdGlvbjogJ1NOUyBUb3BpYyBBUk4gZm9yIG9wZXJhdGlvbmFsIGFsZXJ0cydcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdEYXNoYm9hcmRVUkwnLCB7XG4gICAgICB2YWx1ZTogYGh0dHBzOi8vJHt0aGlzLnJlZ2lvbn0uY29uc29sZS5hd3MuYW1hem9uLmNvbS9jbG91ZHdhdGNoL2hvbWU/cmVnaW9uPSR7dGhpcy5yZWdpb259I2Rhc2hib2FyZHM6bmFtZT0ke2Rhc2hib2FyZC5kYXNoYm9hcmROYW1lfWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ0Nsb3VkV2F0Y2ggRGFzaGJvYXJkIFVSTCBmb3IgbW9uaXRvcmluZydcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdEZXZpY2VSZWdpc3RyYXRpb25BcGlVcmwnLCB7XG4gICAgICB2YWx1ZTogZGV2aWNlUmVnaXN0cmF0aW9uQXBpLnVybCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnRGV2aWNlIFJlZ2lzdHJhdGlvbiBBUEkgR2F0ZXdheSBVUkwnXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRGV2aWNlUmVnaXN0cmF0aW9uQXBpS2V5SWQnLCB7XG4gICAgICB2YWx1ZTogYXBpS2V5LmtleUlkLFxuICAgICAgZGVzY3JpcHRpb246ICdBUEkgS2V5IElEIGZvciBkZXZpY2UgcmVnaXN0cmF0aW9uIChyZXRyaWV2ZSB2YWx1ZSBmcm9tIEFXUyBDb25zb2xlKSdcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdEZXZpY2VSZWdpc3RyYXRpb25GdW5jdGlvbk5hbWUnLCB7XG4gICAgICB2YWx1ZTogZGV2aWNlUmVnaXN0cmF0aW9uRnVuY3Rpb24uZnVuY3Rpb25OYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdMYW1iZGEgZnVuY3Rpb24gbmFtZSBmb3IgZGV2aWNlIHJlZ2lzdHJhdGlvbiBBUEknXG4gICAgfSk7XG4gIH1cbn0iXX0=