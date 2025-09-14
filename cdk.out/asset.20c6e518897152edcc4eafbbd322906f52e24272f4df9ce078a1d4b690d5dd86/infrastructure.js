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
    }
}
exports.SpendMonitorStack = SpendMonitorStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5mcmFzdHJ1Y3R1cmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvaW5mcmFzdHJ1Y3R1cmUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLCtEQUFpRDtBQUNqRCwrREFBaUQ7QUFDakQsd0VBQTBEO0FBQzFELHlEQUEyQztBQUMzQyx5REFBMkM7QUFDM0MsMkRBQTZDO0FBQzdDLG1FQUFxRDtBQUNyRCx1RUFBeUQ7QUFDekQsc0ZBQXdFO0FBR3hFLE1BQWEsaUJBQWtCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDOUMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFzQjtRQUM5RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4Qiw2Q0FBNkM7UUFDN0MsTUFBTSxRQUFRLEdBQUcsSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxzQkFBc0IsRUFBRTtZQUMvRCxZQUFZLEVBQUUsaUNBQWlDO1lBQy9DLFNBQVMsRUFBRSxJQUFJLENBQUMsYUFBYSxDQUFDLFNBQVM7WUFDdkMsYUFBYSxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsT0FBTztTQUN6QyxDQUFDLENBQUM7UUFFSCx1QkFBdUI7UUFDdkIsTUFBTSxVQUFVLEdBQUcsSUFBSSxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxpQkFBaUIsRUFBRTtZQUN4RCxXQUFXLEVBQUUsMEJBQTBCO1lBQ3ZDLFNBQVMsRUFBRSxrQkFBa0I7U0FDOUIsQ0FBQyxDQUFDO1FBRUgsd0VBQXdFO1FBQ3hFLElBQUksY0FBMkMsQ0FBQztRQUNoRCxNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxpQkFBaUIsQ0FBQyxDQUFDO1FBQ25FLE1BQU0sY0FBYyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsYUFB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QyxZQUFZO1lBQzVCLFdBQVcsRUFBRSxrREFBa0Q7U0FDaEUsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSwwQkFBMEIsRUFBRTtZQUNsRCxLQUFLLEVBQUUscUJBQXFCLENBQUMsUUFBUTtZQUNyQyxXQUFXLEVBQUUsc0NBQXNDO1NBQ3BELENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQ3RDLEtBQUssRUFBRSxXQUFXLElBQUksQ0FBQyxNQUFNLGtEQUFrRCxJQUFJLENBQUMsTUFBTSxvQkFBb0IsU0FBUyxDQUFDLGFBQWEsRUFBRTtZQUN2SSxXQUFXLEVBQUUseUNBQXlDO1NBQ3ZELENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQXRURCw4Q0FzVEMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0ICogYXMgZXZlbnRzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1ldmVudHMnO1xuaW1wb3J0ICogYXMgdGFyZ2V0cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZXZlbnRzLXRhcmdldHMnO1xuaW1wb3J0ICogYXMgc25zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zbnMnO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xuaW1wb3J0ICogYXMgY2xvdWR3YXRjaCBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWR3YXRjaCc7XG5pbXBvcnQgKiBhcyBjbG91ZHdhdGNoQWN0aW9ucyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWR3YXRjaC1hY3Rpb25zJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuXG5leHBvcnQgY2xhc3MgU3BlbmRNb25pdG9yU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IGNkay5TdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICAvLyBDbG91ZFdhdGNoIExvZyBHcm91cCB3aXRoIHJldGVudGlvbiBwb2xpY3lcbiAgICBjb25zdCBsb2dHcm91cCA9IG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsICdTcGVuZE1vbml0b3JMb2dHcm91cCcsIHtcbiAgICAgIGxvZ0dyb3VwTmFtZTogJy9hd3MvbGFtYmRhL3NwZW5kLW1vbml0b3ItYWdlbnQnLFxuICAgICAgcmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX01PTlRILFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWVxuICAgIH0pO1xuXG4gICAgLy8gU05TIFRvcGljIGZvciBhbGVydHNcbiAgICBjb25zdCBhbGVydFRvcGljID0gbmV3IHNucy5Ub3BpYyh0aGlzLCAnU3BlbmRBbGVydFRvcGljJywge1xuICAgICAgZGlzcGxheU5hbWU6ICdBV1MgU3BlbmQgTW9uaXRvciBBbGVydHMnLFxuICAgICAgdG9waWNOYW1lOiAnYXdzLXNwZW5kLWFsZXJ0cydcbiAgICB9KTtcblxuICAgIC8vIFNOUyBQbGF0Zm9ybSBBcHBsaWNhdGlvbiBmb3IgQVBOUyAoaU9TIHB1c2ggbm90aWZpY2F0aW9ucykgLSBvcHRpb25hbFxuICAgIGxldCBpb3NQbGF0Zm9ybUFwcDogY2RrLkNmblJlc291cmNlIHwgdW5kZWZpbmVkO1xuICAgIGNvbnN0IGFwbnNDZXJ0aWZpY2F0ZSA9IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdhcG5zQ2VydGlmaWNhdGUnKTtcbiAgICBjb25zdCBhcG5zUHJpdmF0ZUtleSA9IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdhcG5zUHJpdmF0ZUtleScpO1xuICAgIFxuICAgIGlmIChhcG5zQ2VydGlmaWNhdGUgJiYgYXBuc1ByaXZhdGVLZXkpIHtcbiAgICAgIGlvc1BsYXRmb3JtQXBwID0gbmV3IGNkay5DZm5SZXNvdXJjZSh0aGlzLCAnaU9TUGxhdGZvcm1BcHBsaWNhdGlvbicsIHtcbiAgICAgICAgdHlwZTogJ0FXUzo6U05TOjpQbGF0Zm9ybUFwcGxpY2F0aW9uJyxcbiAgICAgICAgcHJvcGVydGllczoge1xuICAgICAgICAgIE5hbWU6ICdTcGVuZE1vbml0b3JBUE5TJyxcbiAgICAgICAgICBQbGF0Zm9ybTogJ0FQTlNfU0FOREJPWCcsIC8vIFVzZSBBUE5TX1NBTkRCT1ggZm9yIGRldmVsb3BtZW50XG4gICAgICAgICAgQXR0cmlidXRlczoge1xuICAgICAgICAgICAgUGxhdGZvcm1DcmVkZW50aWFsOiBhcG5zQ2VydGlmaWNhdGUsXG4gICAgICAgICAgICBQbGF0Zm9ybVByaW5jaXBhbDogYXBuc1ByaXZhdGVLZXlcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH0pO1xuICAgIH1cblxuICAgIC8vIE9wdGlvbmFsIER5bmFtb0RCIHRhYmxlIGZvciBkZXZpY2UgdG9rZW4gc3RvcmFnZVxuICAgIGNvbnN0IGRldmljZVRva2VuVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ0RldmljZVRva2VuVGFibGUnLCB7XG4gICAgICB0YWJsZU5hbWU6ICdzcGVuZC1tb25pdG9yLWRldmljZS10b2tlbnMnLFxuICAgICAgcGFydGl0aW9uS2V5OiB7XG4gICAgICAgIG5hbWU6ICdkZXZpY2VUb2tlbicsXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HXG4gICAgICB9LFxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlXG4gICAgfSk7XG5cbiAgICAvLyBMYW1iZGEgZnVuY3Rpb24gZm9yIHRoZSBTdHJhbmRzIGFnZW50XG4gICAgY29uc3QgYWdlbnRGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1NwZW5kTW9uaXRvckFnZW50Jywge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXG4gICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJ2Rpc3QnKSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgbWVtb3J5U2l6ZTogNTEyLCAvLyBJbmNyZWFzZWQgbWVtb3J5IGZvciBpT1MgcHJvY2Vzc2luZ1xuICAgICAgbG9nR3JvdXA6IGxvZ0dyb3VwLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgU05TX1RPUElDX0FSTjogYWxlcnRUb3BpYy50b3BpY0FybixcbiAgICAgICAgU1BFTkRfVEhSRVNIT0xEOiB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnc3BlbmRUaHJlc2hvbGQnKSB8fCAnMTAnLFxuICAgICAgICBDSEVDS19QRVJJT0RfREFZUzogdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2NoZWNrUGVyaW9kRGF5cycpIHx8ICcxJyxcbiAgICAgICAgUkVUUllfQVRURU1QVFM6IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdyZXRyeUF0dGVtcHRzJykgfHwgJzMnLFxuICAgICAgICBNSU5fU0VSVklDRV9DT1NUOiB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnbWluU2VydmljZUNvc3QnKSB8fCAnMScsXG4gICAgICAgIElPU19QTEFURk9STV9BUFBfQVJOOiBpb3NQbGF0Zm9ybUFwcD8ucmVmIHx8ICcnLFxuICAgICAgICBJT1NfQlVORExFX0lEOiB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnaW9zQnVuZGxlSWQnKSB8fCAnY29tLmV4YW1wbGUuc3BlbmRtb25pdG9yJyxcbiAgICAgICAgQVBOU19TQU5EQk9YOiB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnYXBuc1NhbmRib3gnKSB8fCAndHJ1ZScsXG4gICAgICAgIERFVklDRV9UT0tFTl9UQUJMRV9OQU1FOiBkZXZpY2VUb2tlblRhYmxlLnRhYmxlTmFtZVxuICAgICAgfVxuICAgIH0pO1xuXG4gICAgLy8gSUFNIHBlcm1pc3Npb25zIGZvciBDb3N0IEV4cGxvcmVyXG4gICAgYWdlbnRGdW5jdGlvbi5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgZWZmZWN0OiBpYW0uRWZmZWN0LkFMTE9XLFxuICAgICAgYWN0aW9uczogW1xuICAgICAgICAnY2U6R2V0Q29zdEFuZFVzYWdlJyxcbiAgICAgICAgJ2NlOkdldFVzYWdlUmVwb3J0JyxcbiAgICAgICAgJ2NlOkdldERpbWVuc2lvblZhbHVlcycsXG4gICAgICAgICdjZTpHZXRSZXNlcnZhdGlvbkNvdmVyYWdlJyxcbiAgICAgICAgJ2NlOkdldFJlc2VydmF0aW9uUHVyY2hhc2VSZWNvbW1lbmRhdGlvbicsXG4gICAgICAgICdjZTpHZXRSZXNlcnZhdGlvblV0aWxpemF0aW9uJ1xuICAgICAgXSxcbiAgICAgIHJlc291cmNlczogWycqJ11cbiAgICB9KSk7XG5cbiAgICAvLyBHcmFudCBTTlMgcHVibGlzaCBwZXJtaXNzaW9uc1xuICAgIGFsZXJ0VG9waWMuZ3JhbnRQdWJsaXNoKGFnZW50RnVuY3Rpb24pO1xuXG4gICAgLy8gR3JhbnQgU05TIHBsYXRmb3JtIGFwcGxpY2F0aW9uIHBlcm1pc3Npb25zIGZvciBpT1MgcHVzaCBub3RpZmljYXRpb25zIChpZiBwbGF0Zm9ybSBhcHAgZXhpc3RzKVxuICAgIGlmIChpb3NQbGF0Zm9ybUFwcCkge1xuICAgICAgYWdlbnRGdW5jdGlvbi5hZGRUb1JvbGVQb2xpY3kobmV3IGlhbS5Qb2xpY3lTdGF0ZW1lbnQoe1xuICAgICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAnc25zOkNyZWF0ZVBsYXRmb3JtRW5kcG9pbnQnLFxuICAgICAgICAgICdzbnM6RGVsZXRlRW5kcG9pbnQnLFxuICAgICAgICAgICdzbnM6R2V0RW5kcG9pbnRBdHRyaWJ1dGVzJyxcbiAgICAgICAgICAnc25zOlNldEVuZHBvaW50QXR0cmlidXRlcycsXG4gICAgICAgICAgJ3NuczpMaXN0RW5kcG9pbnRzQnlQbGF0Zm9ybUFwcGxpY2F0aW9uJyxcbiAgICAgICAgICAnc25zOkdldFBsYXRmb3JtQXBwbGljYXRpb25BdHRyaWJ1dGVzJ1xuICAgICAgICBdLFxuICAgICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgICBpb3NQbGF0Zm9ybUFwcC5yZWYsXG4gICAgICAgICAgYCR7aW9zUGxhdGZvcm1BcHAucmVmfS8qYFxuICAgICAgICBdXG4gICAgICB9KSk7XG4gICAgfVxuXG4gICAgLy8gR3JhbnQgRHluYW1vREIgcGVybWlzc2lvbnMgZm9yIGRldmljZSB0b2tlbiBtYW5hZ2VtZW50XG4gICAgZGV2aWNlVG9rZW5UYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoYWdlbnRGdW5jdGlvbik7XG5cbiAgICAvLyBHcmFudCBDbG91ZFdhdGNoIHBlcm1pc3Npb25zIGZvciBjdXN0b20gbWV0cmljc1xuICAgIGFnZW50RnVuY3Rpb24uYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ2Nsb3Vkd2F0Y2g6UHV0TWV0cmljRGF0YSdcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFsnKiddXG4gICAgfSkpO1xuXG4gICAgLy8gRXZlbnRCcmlkZ2UgcnVsZSB0byB0cmlnZ2VyIGRhaWx5IGF0IGNvbmZpZ3VyYWJsZSB0aW1lXG4gICAgY29uc3Qgc2NoZWR1bGVIb3VyID0gdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ3NjaGVkdWxlSG91cicpIHx8ICc5JztcbiAgICBjb25zdCBzY2hlZHVsZVJ1bGUgPSBuZXcgZXZlbnRzLlJ1bGUodGhpcywgJ1NwZW5kQ2hlY2tTY2hlZHVsZScsIHtcbiAgICAgIHNjaGVkdWxlOiBldmVudHMuU2NoZWR1bGUuY3Jvbih7XG4gICAgICAgIG1pbnV0ZTogJzAnLFxuICAgICAgICBob3VyOiBzY2hlZHVsZUhvdXIsXG4gICAgICAgIGRheTogJyonLFxuICAgICAgICBtb250aDogJyonLFxuICAgICAgICB5ZWFyOiAnKidcbiAgICAgIH0pLFxuICAgICAgZGVzY3JpcHRpb246IGBEYWlseSBBV1Mgc3BlbmQgY2hlY2sgYXQgJHtzY2hlZHVsZUhvdXJ9OjAwIFVUQ2BcbiAgICB9KTtcblxuICAgIC8vIEFkZCBMYW1iZGEgYXMgdGFyZ2V0XG4gICAgc2NoZWR1bGVSdWxlLmFkZFRhcmdldChuZXcgdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbihhZ2VudEZ1bmN0aW9uKSk7XG5cbiAgICAvLyBDcmVhdGUgU05TIHRvcGljIGZvciBvcGVyYXRpb25hbCBhbGVydHNcbiAgICBjb25zdCBvcGVyYXRpb25hbEFsZXJ0VG9waWMgPSBuZXcgc25zLlRvcGljKHRoaXMsICdPcGVyYXRpb25hbEFsZXJ0VG9waWMnLCB7XG4gICAgICBkaXNwbGF5TmFtZTogJ1NwZW5kIE1vbml0b3IgT3BlcmF0aW9uYWwgQWxlcnRzJyxcbiAgICAgIHRvcGljTmFtZTogJ3NwZW5kLW1vbml0b3Itb3BzLWFsZXJ0cydcbiAgICB9KTtcblxuICAgIC8vIENsb3VkV2F0Y2ggQWxhcm1zIGZvciBtb25pdG9yaW5nXG4gICAgXG4gICAgLy8gTGFtYmRhIGZ1bmN0aW9uIGVycm9ycyBhbGFybVxuICAgIGNvbnN0IGVycm9yQWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnTGFtYmRhRXJyb3JBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogJ1NwZW5kTW9uaXRvci1MYW1iZGFFcnJvcnMnLFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0FsYXJtIGZvciBMYW1iZGEgZnVuY3Rpb24gZXJyb3JzIGluIHNwZW5kIG1vbml0b3InLFxuICAgICAgbWV0cmljOiBhZ2VudEZ1bmN0aW9uLm1ldHJpY0Vycm9ycyh7XG4gICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIHN0YXRpc3RpYzogJ1N1bSdcbiAgICAgIH0pLFxuICAgICAgdGhyZXNob2xkOiAxLFxuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElOR1xuICAgIH0pO1xuICAgIGVycm9yQWxhcm0uYWRkQWxhcm1BY3Rpb24obmV3IGNsb3Vkd2F0Y2hBY3Rpb25zLlNuc0FjdGlvbihvcGVyYXRpb25hbEFsZXJ0VG9waWMpKTtcblxuICAgIC8vIExhbWJkYSBmdW5jdGlvbiBkdXJhdGlvbiBhbGFybVxuICAgIGNvbnN0IGR1cmF0aW9uQWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnTGFtYmRhRHVyYXRpb25BbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogJ1NwZW5kTW9uaXRvci1MYW1iZGFEdXJhdGlvbicsXG4gICAgICBhbGFybURlc2NyaXB0aW9uOiAnQWxhcm0gZm9yIExhbWJkYSBmdW5jdGlvbiBleGVjdXRpb24gZHVyYXRpb24nLFxuICAgICAgbWV0cmljOiBhZ2VudEZ1bmN0aW9uLm1ldHJpY0R1cmF0aW9uKHtcbiAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgc3RhdGlzdGljOiAnQXZlcmFnZSdcbiAgICAgIH0pLFxuICAgICAgdGhyZXNob2xkOiAyNDAwMDAsIC8vIDQgbWludXRlcyAodGltZW91dCBpcyA1IG1pbnV0ZXMpXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMixcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HXG4gICAgfSk7XG4gICAgZHVyYXRpb25BbGFybS5hZGRBbGFybUFjdGlvbihuZXcgY2xvdWR3YXRjaEFjdGlvbnMuU25zQWN0aW9uKG9wZXJhdGlvbmFsQWxlcnRUb3BpYykpO1xuXG4gICAgLy8gQ3VzdG9tIG1ldHJpYyBhbGFybXMgZm9yIGFnZW50IGV4ZWN1dGlvblxuICAgIGNvbnN0IGV4ZWN1dGlvbkZhaWx1cmVBbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdFeGVjdXRpb25GYWlsdXJlQWxhcm0nLCB7XG4gICAgICBhbGFybU5hbWU6ICdTcGVuZE1vbml0b3ItRXhlY3V0aW9uRmFpbHVyZXMnLFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0FsYXJtIGZvciBzcGVuZCBtb25pdG9yIGV4ZWN1dGlvbiBmYWlsdXJlcycsXG4gICAgICBtZXRyaWM6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgIG5hbWVzcGFjZTogJ1NwZW5kTW9uaXRvci9BZ2VudCcsXG4gICAgICAgIG1ldHJpY05hbWU6ICdFcnJvclJhdGUnLFxuICAgICAgICBkaW1lbnNpb25zTWFwOiB7XG4gICAgICAgICAgT3BlcmF0aW9uOiAnU3BlbmRNb25pdG9yaW5nJ1xuICAgICAgICB9LFxuICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICBzdGF0aXN0aWM6ICdTdW0nXG4gICAgICB9KSxcbiAgICAgIHRocmVzaG9sZDogMSxcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAxLFxuICAgICAgdHJlYXRNaXNzaW5nRGF0YTogY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkdcbiAgICB9KTtcbiAgICBleGVjdXRpb25GYWlsdXJlQWxhcm0uYWRkQWxhcm1BY3Rpb24obmV3IGNsb3Vkd2F0Y2hBY3Rpb25zLlNuc0FjdGlvbihvcGVyYXRpb25hbEFsZXJ0VG9waWMpKTtcblxuICAgIC8vIEFsZXJ0IGRlbGl2ZXJ5IGZhaWx1cmUgYWxhcm1cbiAgICBjb25zdCBhbGVydERlbGl2ZXJ5RmFpbHVyZUFsYXJtID0gbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ0FsZXJ0RGVsaXZlcnlGYWlsdXJlQWxhcm0nLCB7XG4gICAgICBhbGFybU5hbWU6ICdTcGVuZE1vbml0b3ItQWxlcnREZWxpdmVyeUZhaWx1cmVzJyxcbiAgICAgIGFsYXJtRGVzY3JpcHRpb246ICdBbGFybSBmb3IgYWxlcnQgZGVsaXZlcnkgZmFpbHVyZXMnLFxuICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdTcGVuZE1vbml0b3IvQWdlbnQnLFxuICAgICAgICBtZXRyaWNOYW1lOiAnQWxlcnREZWxpdmVyeUNvdW50JyxcbiAgICAgICAgZGltZW5zaW9uc01hcDoge1xuICAgICAgICAgIFN0YXR1czogJ0ZhaWx1cmUnXG4gICAgICAgIH0sXG4gICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIHN0YXRpc3RpYzogJ1N1bSdcbiAgICAgIH0pLFxuICAgICAgdGhyZXNob2xkOiAxLFxuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElOR1xuICAgIH0pO1xuICAgIGFsZXJ0RGVsaXZlcnlGYWlsdXJlQWxhcm0uYWRkQWxhcm1BY3Rpb24obmV3IGNsb3Vkd2F0Y2hBY3Rpb25zLlNuc0FjdGlvbihvcGVyYXRpb25hbEFsZXJ0VG9waWMpKTtcblxuICAgIC8vIENsb3VkV2F0Y2ggRGFzaGJvYXJkIGZvciBtb25pdG9yaW5nXG4gICAgY29uc3QgZGFzaGJvYXJkID0gbmV3IGNsb3Vkd2F0Y2guRGFzaGJvYXJkKHRoaXMsICdTcGVuZE1vbml0b3JEYXNoYm9hcmQnLCB7XG4gICAgICBkYXNoYm9hcmROYW1lOiAnU3BlbmRNb25pdG9yQWdlbnQnLFxuICAgICAgd2lkZ2V0czogW1xuICAgICAgICBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICAgICAgdGl0bGU6ICdMYW1iZGEgRnVuY3Rpb24gTWV0cmljcycsXG4gICAgICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgICAgIGFnZW50RnVuY3Rpb24ubWV0cmljSW52b2NhdGlvbnMoeyBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpIH0pLFxuICAgICAgICAgICAgICBhZ2VudEZ1bmN0aW9uLm1ldHJpY0Vycm9ycyh7IHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSkgfSlcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICByaWdodDogW1xuICAgICAgICAgICAgICBhZ2VudEZ1bmN0aW9uLm1ldHJpY0R1cmF0aW9uKHsgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSB9KVxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgICAgIGhlaWdodDogNlxuICAgICAgICAgIH0pXG4gICAgICAgIF0sXG4gICAgICAgIFtcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgICAgICB0aXRsZTogJ1NwZW5kIE1vbml0b3JpbmcgTWV0cmljcycsXG4gICAgICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICAgICAgbmFtZXNwYWNlOiAnU3BlbmRNb25pdG9yL0FnZW50JyxcbiAgICAgICAgICAgICAgICBtZXRyaWNOYW1lOiAnQ3VycmVudFNwZW5kJyxcbiAgICAgICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5ob3VycygxKSxcbiAgICAgICAgICAgICAgICBzdGF0aXN0aWM6ICdBdmVyYWdlJ1xuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICBuYW1lc3BhY2U6ICdTcGVuZE1vbml0b3IvQWdlbnQnLFxuICAgICAgICAgICAgICAgIG1ldHJpY05hbWU6ICdQcm9qZWN0ZWRNb250aGx5U3BlbmQnLFxuICAgICAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLmhvdXJzKDEpLFxuICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogJ0F2ZXJhZ2UnXG4gICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICAgICAgaGVpZ2h0OiA2XG4gICAgICAgICAgfSlcbiAgICAgICAgXSxcbiAgICAgICAgW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgICAgIHRpdGxlOiAnQWxlcnQgRGVsaXZlcnkgTWV0cmljcycsXG4gICAgICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICAgICAgbmFtZXNwYWNlOiAnU3BlbmRNb25pdG9yL0FnZW50JyxcbiAgICAgICAgICAgICAgICBtZXRyaWNOYW1lOiAnQWxlcnREZWxpdmVyeUNvdW50JyxcbiAgICAgICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7IFN0YXR1czogJ1N1Y2Nlc3MnIH0sXG4gICAgICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICAgIG5hbWVzcGFjZTogJ1NwZW5kTW9uaXRvci9BZ2VudCcsXG4gICAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ0FsZXJ0RGVsaXZlcnlDb3VudCcsXG4gICAgICAgICAgICAgICAgZGltZW5zaW9uc01hcDogeyBTdGF0dXM6ICdGYWlsdXJlJyB9LFxuICAgICAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJ1xuICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgICAgIGhlaWdodDogNlxuICAgICAgICAgIH0pXG4gICAgICAgIF1cbiAgICAgIF1cbiAgICB9KTtcblxuICAgIC8vIE91dHB1dHNcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnU05TVG9waWNBcm4nLCB7XG4gICAgICB2YWx1ZTogYWxlcnRUb3BpYy50b3BpY0FybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnU05TIFRvcGljIEFSTiBmb3Igc3BlbmQgYWxlcnRzJ1xuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FnZW50RnVuY3Rpb25OYW1lJywge1xuICAgICAgdmFsdWU6IGFnZW50RnVuY3Rpb24uZnVuY3Rpb25OYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdMYW1iZGEgZnVuY3Rpb24gbmFtZSBmb3IgdGhlIHNwZW5kIG1vbml0b3IgYWdlbnQnXG4gICAgfSk7XG5cbiAgICBpZiAoaW9zUGxhdGZvcm1BcHApIHtcbiAgICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdpT1NQbGF0Zm9ybUFwcGxpY2F0aW9uQXJuJywge1xuICAgICAgICB2YWx1ZTogaW9zUGxhdGZvcm1BcHAucmVmLFxuICAgICAgICBkZXNjcmlwdGlvbjogJ1NOUyBQbGF0Zm9ybSBBcHBsaWNhdGlvbiBBUk4gZm9yIGlPUyBwdXNoIG5vdGlmaWNhdGlvbnMnXG4gICAgICB9KTtcbiAgICB9XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRGV2aWNlVG9rZW5UYWJsZU5hbWUnLCB7XG4gICAgICB2YWx1ZTogZGV2aWNlVG9rZW5UYWJsZS50YWJsZU5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0R5bmFtb0RCIHRhYmxlIG5hbWUgZm9yIGRldmljZSB0b2tlbiBzdG9yYWdlJ1xuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0xvZ0dyb3VwTmFtZScsIHtcbiAgICAgIHZhbHVlOiBsb2dHcm91cC5sb2dHcm91cE5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0Nsb3VkV2F0Y2ggTG9nIEdyb3VwIGZvciB0aGUgc3BlbmQgbW9uaXRvciBhZ2VudCdcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdPcGVyYXRpb25hbEFsZXJ0VG9waWNBcm4nLCB7XG4gICAgICB2YWx1ZTogb3BlcmF0aW9uYWxBbGVydFRvcGljLnRvcGljQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdTTlMgVG9waWMgQVJOIGZvciBvcGVyYXRpb25hbCBhbGVydHMnXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRGFzaGJvYXJkVVJMJywge1xuICAgICAgdmFsdWU6IGBodHRwczovLyR7dGhpcy5yZWdpb259LmNvbnNvbGUuYXdzLmFtYXpvbi5jb20vY2xvdWR3YXRjaC9ob21lP3JlZ2lvbj0ke3RoaXMucmVnaW9ufSNkYXNoYm9hcmRzOm5hbWU9JHtkYXNoYm9hcmQuZGFzaGJvYXJkTmFtZX1gLFxuICAgICAgZGVzY3JpcHRpb246ICdDbG91ZFdhdGNoIERhc2hib2FyZCBVUkwgZm9yIG1vbml0b3JpbmcnXG4gICAgfSk7XG4gIH1cbn0iXX0=