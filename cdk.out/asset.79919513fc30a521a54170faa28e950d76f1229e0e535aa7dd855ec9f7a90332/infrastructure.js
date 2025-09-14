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
        // SNS Platform Application for APNS (iOS push notifications)
        const iosPlatformApp = new cdk.CfnResource(this, 'iOSPlatformApplication', {
            type: 'AWS::SNS::PlatformApplication',
            properties: {
                Name: 'SpendMonitorAPNS',
                Platform: 'APNS',
                Attributes: {
                    // These will be set via environment variables or CDK context
                    PlatformCredential: this.node.tryGetContext('apnsCertificate') || '',
                    PlatformPrincipal: this.node.tryGetContext('apnsPrivateKey') || ''
                }
            }
        });
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
                IOS_PLATFORM_APP_ARN: iosPlatformApp.ref,
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
        // Grant SNS platform application permissions for iOS push notifications
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
        new cdk.CfnOutput(this, 'iOSPlatformApplicationArn', {
            value: iosPlatformApp.ref,
            description: 'SNS Platform Application ARN for iOS push notifications'
        });
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5mcmFzdHJ1Y3R1cmUuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyIuLi9zcmMvaW5mcmFzdHJ1Y3R1cmUudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7O0FBQUEsaURBQW1DO0FBQ25DLCtEQUFpRDtBQUNqRCwrREFBaUQ7QUFDakQsd0VBQTBEO0FBQzFELHlEQUEyQztBQUMzQyx5REFBMkM7QUFDM0MsMkRBQTZDO0FBQzdDLG1FQUFxRDtBQUNyRCx1RUFBeUQ7QUFDekQsc0ZBQXdFO0FBR3hFLE1BQWEsaUJBQWtCLFNBQVEsR0FBRyxDQUFDLEtBQUs7SUFDOUMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUFzQjtRQUM5RCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4Qiw2Q0FBNkM7UUFDN0MsTUFBTSxRQUFRLEdBQUcsSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxzQkFBc0IsRUFBRTtZQUMvRCxZQUFZLEVBQUUsaUNBQWlDO1lBQy9DLFNBQVMsRUFBRSxJQUFJLENBQUMsYUFBYSxDQUFDLFNBQVM7WUFDdkMsYUFBYSxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsT0FBTztTQUN6QyxDQUFDLENBQUM7UUFFSCx1QkFBdUI7UUFDdkIsTUFBTSxVQUFVLEdBQUcsSUFBSSxHQUFHLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxpQkFBaUIsRUFBRTtZQUN4RCxXQUFXLEVBQUUsMEJBQTBCO1lBQ3ZDLFNBQVMsRUFBRSxrQkFBa0I7U0FDOUIsQ0FBQyxDQUFDO1FBRUgsNkRBQTZEO1FBQzdELE1BQU0sY0FBYyxHQUFHLElBQUksR0FBRyxDQUFDLFdBQVcsQ0FBQyxJQUFJLEVBQUUsd0JBQXdCLEVBQUU7WUFDekUsSUFBSSxFQUFFLCtCQUErQjtZQUNyQyxVQUFVLEVBQUU7Z0JBQ1YsSUFBSSxFQUFFLGtCQUFrQjtnQkFDeEIsUUFBUSxFQUFFLE1BQU07Z0JBQ2hCLFVBQVUsRUFBRTtvQkFDViw2REFBNkQ7b0JBQzdELGtCQUFrQixFQUFFLElBQUksQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLGlCQUFpQixDQUFDLElBQUksRUFBRTtvQkFDcEUsaUJBQWlCLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsZ0JBQWdCLENBQUMsSUFBSSxFQUFFO2lCQUNuRTthQUNGO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsbURBQW1EO1FBQ25ELE1BQU0sZ0JBQWdCLEdBQUcsSUFBSSxRQUFRLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRTtZQUNwRSxTQUFTLEVBQUUsNkJBQTZCO1lBQ3hDLFlBQVksRUFBRTtnQkFDWixJQUFJLEVBQUUsYUFBYTtnQkFDbkIsSUFBSSxFQUFFLFFBQVEsQ0FBQyxhQUFhLENBQUMsTUFBTTthQUNwQztZQUNELFdBQVcsRUFBRSxRQUFRLENBQUMsV0FBVyxDQUFDLGVBQWU7WUFDakQsYUFBYSxFQUFFLEdBQUcsQ0FBQyxhQUFhLENBQUMsT0FBTztZQUN4QyxtQkFBbUIsRUFBRSxJQUFJO1NBQzFCLENBQUMsQ0FBQztRQUVILHdDQUF3QztRQUN4QyxNQUFNLGFBQWEsR0FBRyxJQUFJLE1BQU0sQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLG1CQUFtQixFQUFFO1lBQ25FLE9BQU8sRUFBRSxNQUFNLENBQUMsT0FBTyxDQUFDLFdBQVc7WUFDbkMsT0FBTyxFQUFFLGVBQWU7WUFDeEIsSUFBSSxFQUFFLE1BQU0sQ0FBQyxJQUFJLENBQUMsU0FBUyxDQUFDLE1BQU0sQ0FBQztZQUNuQyxPQUFPLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDO1lBQ2hDLFVBQVUsRUFBRSxHQUFHLEVBQUUsc0NBQXNDO1lBQ3ZELFFBQVEsRUFBRSxRQUFRO1lBQ2xCLFdBQVcsRUFBRTtnQkFDWCxhQUFhLEVBQUUsVUFBVSxDQUFDLFFBQVE7Z0JBQ2xDLGVBQWUsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLElBQUk7Z0JBQ2xFLGlCQUFpQixFQUFFLElBQUksQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLGlCQUFpQixDQUFDLElBQUksR0FBRztnQkFDcEUsY0FBYyxFQUFFLElBQUksQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLGVBQWUsQ0FBQyxJQUFJLEdBQUc7Z0JBQy9ELGdCQUFnQixFQUFFLElBQUksQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLGdCQUFnQixDQUFDLElBQUksR0FBRztnQkFDbEUsb0JBQW9CLEVBQUUsY0FBYyxDQUFDLEdBQUc7Z0JBQ3hDLGFBQWEsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxhQUFhLENBQUMsSUFBSSwwQkFBMEI7Z0JBQ25GLFlBQVksRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxhQUFhLENBQUMsSUFBSSxNQUFNO2dCQUM5RCx1QkFBdUIsRUFBRSxnQkFBZ0IsQ0FBQyxTQUFTO2FBQ3BEO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsb0NBQW9DO1FBQ3BDLGFBQWEsQ0FBQyxlQUFlLENBQUMsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDO1lBQ3BELE1BQU0sRUFBRSxHQUFHLENBQUMsTUFBTSxDQUFDLEtBQUs7WUFDeEIsT0FBTyxFQUFFO2dCQUNQLG9CQUFvQjtnQkFDcEIsbUJBQW1CO2dCQUNuQix1QkFBdUI7Z0JBQ3ZCLDJCQUEyQjtnQkFDM0IseUNBQXlDO2dCQUN6Qyw4QkFBOEI7YUFDL0I7WUFDRCxTQUFTLEVBQUUsQ0FBQyxHQUFHLENBQUM7U0FDakIsQ0FBQyxDQUFDLENBQUM7UUFFSixnQ0FBZ0M7UUFDaEMsVUFBVSxDQUFDLFlBQVksQ0FBQyxhQUFhLENBQUMsQ0FBQztRQUV2Qyx3RUFBd0U7UUFDeEUsYUFBYSxDQUFDLGVBQWUsQ0FBQyxJQUFJLEdBQUcsQ0FBQyxlQUFlLENBQUM7WUFDcEQsTUFBTSxFQUFFLEdBQUcsQ0FBQyxNQUFNLENBQUMsS0FBSztZQUN4QixPQUFPLEVBQUU7Z0JBQ1AsNEJBQTRCO2dCQUM1QixvQkFBb0I7Z0JBQ3BCLDJCQUEyQjtnQkFDM0IsMkJBQTJCO2dCQUMzQix3Q0FBd0M7Z0JBQ3hDLHNDQUFzQzthQUN2QztZQUNELFNBQVMsRUFBRTtnQkFDVCxjQUFjLENBQUMsR0FBRztnQkFDbEIsR0FBRyxjQUFjLENBQUMsR0FBRyxJQUFJO2FBQzFCO1NBQ0YsQ0FBQyxDQUFDLENBQUM7UUFFSix5REFBeUQ7UUFDekQsZ0JBQWdCLENBQUMsa0JBQWtCLENBQUMsYUFBYSxDQUFDLENBQUM7UUFFbkQsa0RBQWtEO1FBQ2xELGFBQWEsQ0FBQyxlQUFlLENBQUMsSUFBSSxHQUFHLENBQUMsZUFBZSxDQUFDO1lBQ3BELE1BQU0sRUFBRSxHQUFHLENBQUMsTUFBTSxDQUFDLEtBQUs7WUFDeEIsT0FBTyxFQUFFO2dCQUNQLDBCQUEwQjthQUMzQjtZQUNELFNBQVMsRUFBRSxDQUFDLEdBQUcsQ0FBQztTQUNqQixDQUFDLENBQUMsQ0FBQztRQUVKLHlEQUF5RDtRQUN6RCxNQUFNLFlBQVksR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxjQUFjLENBQUMsSUFBSSxHQUFHLENBQUM7UUFDcEUsTUFBTSxZQUFZLEdBQUcsSUFBSSxNQUFNLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxvQkFBb0IsRUFBRTtZQUMvRCxRQUFRLEVBQUUsTUFBTSxDQUFDLFFBQVEsQ0FBQyxJQUFJLENBQUM7Z0JBQzdCLE1BQU0sRUFBRSxHQUFHO2dCQUNYLElBQUksRUFBRSxZQUFZO2dCQUNsQixHQUFHLEVBQUUsR0FBRztnQkFDUixLQUFLLEVBQUUsR0FBRztnQkFDVixJQUFJLEVBQUUsR0FBRzthQUNWLENBQUM7WUFDRixXQUFXLEVBQUUsNEJBQTRCLFlBQVksU0FBUztTQUMvRCxDQUFDLENBQUM7UUFFSCx1QkFBdUI7UUFDdkIsWUFBWSxDQUFDLFNBQVMsQ0FBQyxJQUFJLE9BQU8sQ0FBQyxjQUFjLENBQUMsYUFBYSxDQUFDLENBQUMsQ0FBQztRQUVsRSwwQ0FBMEM7UUFDMUMsTUFBTSxxQkFBcUIsR0FBRyxJQUFJLEdBQUcsQ0FBQyxLQUFLLENBQUMsSUFBSSxFQUFFLHVCQUF1QixFQUFFO1lBQ3pFLFdBQVcsRUFBRSxrQ0FBa0M7WUFDL0MsU0FBUyxFQUFFLDBCQUEwQjtTQUN0QyxDQUFDLENBQUM7UUFFSCxtQ0FBbUM7UUFFbkMsK0JBQStCO1FBQy9CLE1BQU0sVUFBVSxHQUFHLElBQUksVUFBVSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsa0JBQWtCLEVBQUU7WUFDaEUsU0FBUyxFQUFFLDJCQUEyQjtZQUN0QyxnQkFBZ0IsRUFBRSxtREFBbUQ7WUFDckUsTUFBTSxFQUFFLGFBQWEsQ0FBQyxZQUFZLENBQUM7Z0JBQ2pDLE1BQU0sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7Z0JBQy9CLFNBQVMsRUFBRSxLQUFLO2FBQ2pCLENBQUM7WUFDRixTQUFTLEVBQUUsQ0FBQztZQUNaLGlCQUFpQixFQUFFLENBQUM7WUFDcEIsZ0JBQWdCLEVBQUUsVUFBVSxDQUFDLGdCQUFnQixDQUFDLGFBQWE7U0FDNUQsQ0FBQyxDQUFDO1FBQ0gsVUFBVSxDQUFDLGNBQWMsQ0FBQyxJQUFJLGlCQUFpQixDQUFDLFNBQVMsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLENBQUM7UUFFbEYsaUNBQWlDO1FBQ2pDLE1BQU0sYUFBYSxHQUFHLElBQUksVUFBVSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUscUJBQXFCLEVBQUU7WUFDdEUsU0FBUyxFQUFFLDZCQUE2QjtZQUN4QyxnQkFBZ0IsRUFBRSw4Q0FBOEM7WUFDaEUsTUFBTSxFQUFFLGFBQWEsQ0FBQyxjQUFjLENBQUM7Z0JBQ25DLE1BQU0sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7Z0JBQy9CLFNBQVMsRUFBRSxTQUFTO2FBQ3JCLENBQUM7WUFDRixTQUFTLEVBQUUsTUFBTSxFQUFFLG1DQUFtQztZQUN0RCxpQkFBaUIsRUFBRSxDQUFDO1lBQ3BCLGdCQUFnQixFQUFFLFVBQVUsQ0FBQyxnQkFBZ0IsQ0FBQyxhQUFhO1NBQzVELENBQUMsQ0FBQztRQUNILGFBQWEsQ0FBQyxjQUFjLENBQUMsSUFBSSxpQkFBaUIsQ0FBQyxTQUFTLENBQUMscUJBQXFCLENBQUMsQ0FBQyxDQUFDO1FBRXJGLDJDQUEyQztRQUMzQyxNQUFNLHFCQUFxQixHQUFHLElBQUksVUFBVSxDQUFDLEtBQUssQ0FBQyxJQUFJLEVBQUUsdUJBQXVCLEVBQUU7WUFDaEYsU0FBUyxFQUFFLGdDQUFnQztZQUMzQyxnQkFBZ0IsRUFBRSw0Q0FBNEM7WUFDOUQsTUFBTSxFQUFFLElBQUksVUFBVSxDQUFDLE1BQU0sQ0FBQztnQkFDNUIsU0FBUyxFQUFFLG9CQUFvQjtnQkFDL0IsVUFBVSxFQUFFLFdBQVc7Z0JBQ3ZCLGFBQWEsRUFBRTtvQkFDYixTQUFTLEVBQUUsaUJBQWlCO2lCQUM3QjtnQkFDRCxNQUFNLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDO2dCQUMvQixTQUFTLEVBQUUsS0FBSzthQUNqQixDQUFDO1lBQ0YsU0FBUyxFQUFFLENBQUM7WUFDWixpQkFBaUIsRUFBRSxDQUFDO1lBQ3BCLGdCQUFnQixFQUFFLFVBQVUsQ0FBQyxnQkFBZ0IsQ0FBQyxhQUFhO1NBQzVELENBQUMsQ0FBQztRQUNILHFCQUFxQixDQUFDLGNBQWMsQ0FBQyxJQUFJLGlCQUFpQixDQUFDLFNBQVMsQ0FBQyxxQkFBcUIsQ0FBQyxDQUFDLENBQUM7UUFFN0YsK0JBQStCO1FBQy9CLE1BQU0seUJBQXlCLEdBQUcsSUFBSSxVQUFVLENBQUMsS0FBSyxDQUFDLElBQUksRUFBRSwyQkFBMkIsRUFBRTtZQUN4RixTQUFTLEVBQUUsb0NBQW9DO1lBQy9DLGdCQUFnQixFQUFFLG1DQUFtQztZQUNyRCxNQUFNLEVBQUUsSUFBSSxVQUFVLENBQUMsTUFBTSxDQUFDO2dCQUM1QixTQUFTLEVBQUUsb0JBQW9CO2dCQUMvQixVQUFVLEVBQUUsb0JBQW9CO2dCQUNoQyxhQUFhLEVBQUU7b0JBQ2IsTUFBTSxFQUFFLFNBQVM7aUJBQ2xCO2dCQUNELE1BQU0sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7Z0JBQy9CLFNBQVMsRUFBRSxLQUFLO2FBQ2pCLENBQUM7WUFDRixTQUFTLEVBQUUsQ0FBQztZQUNaLGlCQUFpQixFQUFFLENBQUM7WUFDcEIsZ0JBQWdCLEVBQUUsVUFBVSxDQUFDLGdCQUFnQixDQUFDLGFBQWE7U0FDNUQsQ0FBQyxDQUFDO1FBQ0gseUJBQXlCLENBQUMsY0FBYyxDQUFDLElBQUksaUJBQWlCLENBQUMsU0FBUyxDQUFDLHFCQUFxQixDQUFDLENBQUMsQ0FBQztRQUVqRyxzQ0FBc0M7UUFDdEMsTUFBTSxTQUFTLEdBQUcsSUFBSSxVQUFVLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSx1QkFBdUIsRUFBRTtZQUN4RSxhQUFhLEVBQUUsbUJBQW1CO1lBQ2xDLE9BQU8sRUFBRTtnQkFDUDtvQkFDRSxJQUFJLFVBQVUsQ0FBQyxXQUFXLENBQUM7d0JBQ3pCLEtBQUssRUFBRSx5QkFBeUI7d0JBQ2hDLElBQUksRUFBRTs0QkFDSixhQUFhLENBQUMsaUJBQWlCLENBQUMsRUFBRSxNQUFNLEVBQUUsR0FBRyxDQUFDLFFBQVEsQ0FBQyxPQUFPLENBQUMsQ0FBQyxDQUFDLEVBQUUsQ0FBQzs0QkFDcEUsYUFBYSxDQUFDLFlBQVksQ0FBQyxFQUFFLE1BQU0sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO3lCQUNoRTt3QkFDRCxLQUFLLEVBQUU7NEJBQ0wsYUFBYSxDQUFDLGNBQWMsQ0FBQyxFQUFFLE1BQU0sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUMsRUFBRSxDQUFDO3lCQUNsRTt3QkFDRCxLQUFLLEVBQUUsRUFBRTt3QkFDVCxNQUFNLEVBQUUsQ0FBQztxQkFDVixDQUFDO2lCQUNIO2dCQUNEO29CQUNFLElBQUksVUFBVSxDQUFDLFdBQVcsQ0FBQzt3QkFDekIsS0FBSyxFQUFFLDBCQUEwQjt3QkFDakMsSUFBSSxFQUFFOzRCQUNKLElBQUksVUFBVSxDQUFDLE1BQU0sQ0FBQztnQ0FDcEIsU0FBUyxFQUFFLG9CQUFvQjtnQ0FDL0IsVUFBVSxFQUFFLGNBQWM7Z0NBQzFCLE1BQU0sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUM7Z0NBQzdCLFNBQVMsRUFBRSxTQUFTOzZCQUNyQixDQUFDOzRCQUNGLElBQUksVUFBVSxDQUFDLE1BQU0sQ0FBQztnQ0FDcEIsU0FBUyxFQUFFLG9CQUFvQjtnQ0FDL0IsVUFBVSxFQUFFLHVCQUF1QjtnQ0FDbkMsTUFBTSxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsS0FBSyxDQUFDLENBQUMsQ0FBQztnQ0FDN0IsU0FBUyxFQUFFLFNBQVM7NkJBQ3JCLENBQUM7eUJBQ0g7d0JBQ0QsS0FBSyxFQUFFLEVBQUU7d0JBQ1QsTUFBTSxFQUFFLENBQUM7cUJBQ1YsQ0FBQztpQkFDSDtnQkFDRDtvQkFDRSxJQUFJLFVBQVUsQ0FBQyxXQUFXLENBQUM7d0JBQ3pCLEtBQUssRUFBRSx3QkFBd0I7d0JBQy9CLElBQUksRUFBRTs0QkFDSixJQUFJLFVBQVUsQ0FBQyxNQUFNLENBQUM7Z0NBQ3BCLFNBQVMsRUFBRSxvQkFBb0I7Z0NBQy9CLFVBQVUsRUFBRSxvQkFBb0I7Z0NBQ2hDLGFBQWEsRUFBRSxFQUFFLE1BQU0sRUFBRSxTQUFTLEVBQUU7Z0NBQ3BDLE1BQU0sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxDQUFDLENBQUM7Z0NBQy9CLFNBQVMsRUFBRSxLQUFLOzZCQUNqQixDQUFDOzRCQUNGLElBQUksVUFBVSxDQUFDLE1BQU0sQ0FBQztnQ0FDcEIsU0FBUyxFQUFFLG9CQUFvQjtnQ0FDL0IsVUFBVSxFQUFFLG9CQUFvQjtnQ0FDaEMsYUFBYSxFQUFFLEVBQUUsTUFBTSxFQUFFLFNBQVMsRUFBRTtnQ0FDcEMsTUFBTSxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQztnQ0FDL0IsU0FBUyxFQUFFLEtBQUs7NkJBQ2pCLENBQUM7eUJBQ0g7d0JBQ0QsS0FBSyxFQUFFLEVBQUU7d0JBQ1QsTUFBTSxFQUFFLENBQUM7cUJBQ1YsQ0FBQztpQkFDSDthQUNGO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsVUFBVTtRQUNWLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsYUFBYSxFQUFFO1lBQ3JDLEtBQUssRUFBRSxVQUFVLENBQUMsUUFBUTtZQUMxQixXQUFXLEVBQUUsZ0NBQWdDO1NBQzlDLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsbUJBQW1CLEVBQUU7WUFDM0MsS0FBSyxFQUFFLGFBQWEsQ0FBQyxZQUFZO1lBQ2pDLFdBQVcsRUFBRSxrREFBa0Q7U0FDaEUsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSwyQkFBMkIsRUFBRTtZQUNuRCxLQUFLLEVBQUUsY0FBYyxDQUFDLEdBQUc7WUFDekIsV0FBVyxFQUFFLHlEQUF5RDtTQUN2RSxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLHNCQUFzQixFQUFFO1lBQzlDLEtBQUssRUFBRSxnQkFBZ0IsQ0FBQyxTQUFTO1lBQ2pDLFdBQVcsRUFBRSw4Q0FBOEM7U0FDNUQsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxjQUFjLEVBQUU7WUFDdEMsS0FBSyxFQUFFLFFBQVEsQ0FBQyxZQUFZO1lBQzVCLFdBQVcsRUFBRSxrREFBa0Q7U0FDaEUsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSwwQkFBMEIsRUFBRTtZQUNsRCxLQUFLLEVBQUUscUJBQXFCLENBQUMsUUFBUTtZQUNyQyxXQUFXLEVBQUUsc0NBQXNDO1NBQ3BELENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsY0FBYyxFQUFFO1lBQ3RDLEtBQUssRUFBRSxXQUFXLElBQUksQ0FBQyxNQUFNLGtEQUFrRCxJQUFJLENBQUMsTUFBTSxvQkFBb0IsU0FBUyxDQUFDLGFBQWEsRUFBRTtZQUN2SSxXQUFXLEVBQUUseUNBQXlDO1NBQ3ZELENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQTdTRCw4Q0E2U0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0ICogYXMgZXZlbnRzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1ldmVudHMnO1xuaW1wb3J0ICogYXMgdGFyZ2V0cyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZXZlbnRzLXRhcmdldHMnO1xuaW1wb3J0ICogYXMgc25zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zbnMnO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgKiBhcyBkeW5hbW9kYiBmcm9tICdhd3MtY2RrLWxpYi9hd3MtZHluYW1vZGInO1xuaW1wb3J0ICogYXMgY2xvdWR3YXRjaCBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWR3YXRjaCc7XG5pbXBvcnQgKiBhcyBjbG91ZHdhdGNoQWN0aW9ucyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWR3YXRjaC1hY3Rpb25zJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuXG5leHBvcnQgY2xhc3MgU3BlbmRNb25pdG9yU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wcz86IGNkay5TdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICAvLyBDbG91ZFdhdGNoIExvZyBHcm91cCB3aXRoIHJldGVudGlvbiBwb2xpY3lcbiAgICBjb25zdCBsb2dHcm91cCA9IG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsICdTcGVuZE1vbml0b3JMb2dHcm91cCcsIHtcbiAgICAgIGxvZ0dyb3VwTmFtZTogJy9hd3MvbGFtYmRhL3NwZW5kLW1vbml0b3ItYWdlbnQnLFxuICAgICAgcmV0ZW50aW9uOiBsb2dzLlJldGVudGlvbkRheXMuT05FX01PTlRILFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWVxuICAgIH0pO1xuXG4gICAgLy8gU05TIFRvcGljIGZvciBhbGVydHNcbiAgICBjb25zdCBhbGVydFRvcGljID0gbmV3IHNucy5Ub3BpYyh0aGlzLCAnU3BlbmRBbGVydFRvcGljJywge1xuICAgICAgZGlzcGxheU5hbWU6ICdBV1MgU3BlbmQgTW9uaXRvciBBbGVydHMnLFxuICAgICAgdG9waWNOYW1lOiAnYXdzLXNwZW5kLWFsZXJ0cydcbiAgICB9KTtcblxuICAgIC8vIFNOUyBQbGF0Zm9ybSBBcHBsaWNhdGlvbiBmb3IgQVBOUyAoaU9TIHB1c2ggbm90aWZpY2F0aW9ucylcbiAgICBjb25zdCBpb3NQbGF0Zm9ybUFwcCA9IG5ldyBjZGsuQ2ZuUmVzb3VyY2UodGhpcywgJ2lPU1BsYXRmb3JtQXBwbGljYXRpb24nLCB7XG4gICAgICB0eXBlOiAnQVdTOjpTTlM6OlBsYXRmb3JtQXBwbGljYXRpb24nLFxuICAgICAgcHJvcGVydGllczoge1xuICAgICAgICBOYW1lOiAnU3BlbmRNb25pdG9yQVBOUycsXG4gICAgICAgIFBsYXRmb3JtOiAnQVBOUycsXG4gICAgICAgIEF0dHJpYnV0ZXM6IHtcbiAgICAgICAgICAvLyBUaGVzZSB3aWxsIGJlIHNldCB2aWEgZW52aXJvbm1lbnQgdmFyaWFibGVzIG9yIENESyBjb250ZXh0XG4gICAgICAgICAgUGxhdGZvcm1DcmVkZW50aWFsOiB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnYXBuc0NlcnRpZmljYXRlJykgfHwgJycsXG4gICAgICAgICAgUGxhdGZvcm1QcmluY2lwYWw6IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdhcG5zUHJpdmF0ZUtleScpIHx8ICcnXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcblxuICAgIC8vIE9wdGlvbmFsIER5bmFtb0RCIHRhYmxlIGZvciBkZXZpY2UgdG9rZW4gc3RvcmFnZVxuICAgIGNvbnN0IGRldmljZVRva2VuVGFibGUgPSBuZXcgZHluYW1vZGIuVGFibGUodGhpcywgJ0RldmljZVRva2VuVGFibGUnLCB7XG4gICAgICB0YWJsZU5hbWU6ICdzcGVuZC1tb25pdG9yLWRldmljZS10b2tlbnMnLFxuICAgICAgcGFydGl0aW9uS2V5OiB7XG4gICAgICAgIG5hbWU6ICdkZXZpY2VUb2tlbicsXG4gICAgICAgIHR5cGU6IGR5bmFtb2RiLkF0dHJpYnV0ZVR5cGUuU1RSSU5HXG4gICAgICB9LFxuICAgICAgYmlsbGluZ01vZGU6IGR5bmFtb2RiLkJpbGxpbmdNb2RlLlBBWV9QRVJfUkVRVUVTVCxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICBwb2ludEluVGltZVJlY292ZXJ5OiB0cnVlXG4gICAgfSk7XG5cbiAgICAvLyBMYW1iZGEgZnVuY3Rpb24gZm9yIHRoZSBTdHJhbmRzIGFnZW50XG4gICAgY29uc3QgYWdlbnRGdW5jdGlvbiA9IG5ldyBsYW1iZGEuRnVuY3Rpb24odGhpcywgJ1NwZW5kTW9uaXRvckFnZW50Jywge1xuICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTXzE4X1gsXG4gICAgICBoYW5kbGVyOiAnaW5kZXguaGFuZGxlcicsXG4gICAgICBjb2RlOiBsYW1iZGEuQ29kZS5mcm9tQXNzZXQoJ2Rpc3QnKSxcbiAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgbWVtb3J5U2l6ZTogNTEyLCAvLyBJbmNyZWFzZWQgbWVtb3J5IGZvciBpT1MgcHJvY2Vzc2luZ1xuICAgICAgbG9nR3JvdXA6IGxvZ0dyb3VwLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgU05TX1RPUElDX0FSTjogYWxlcnRUb3BpYy50b3BpY0FybixcbiAgICAgICAgU1BFTkRfVEhSRVNIT0xEOiB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnc3BlbmRUaHJlc2hvbGQnKSB8fCAnMTAnLFxuICAgICAgICBDSEVDS19QRVJJT0RfREFZUzogdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ2NoZWNrUGVyaW9kRGF5cycpIHx8ICcxJyxcbiAgICAgICAgUkVUUllfQVRURU1QVFM6IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdyZXRyeUF0dGVtcHRzJykgfHwgJzMnLFxuICAgICAgICBNSU5fU0VSVklDRV9DT1NUOiB0aGlzLm5vZGUudHJ5R2V0Q29udGV4dCgnbWluU2VydmljZUNvc3QnKSB8fCAnMScsXG4gICAgICAgIElPU19QTEFURk9STV9BUFBfQVJOOiBpb3NQbGF0Zm9ybUFwcC5yZWYsXG4gICAgICAgIElPU19CVU5ETEVfSUQ6IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdpb3NCdW5kbGVJZCcpIHx8ICdjb20uZXhhbXBsZS5zcGVuZG1vbml0b3InLFxuICAgICAgICBBUE5TX1NBTkRCT1g6IHRoaXMubm9kZS50cnlHZXRDb250ZXh0KCdhcG5zU2FuZGJveCcpIHx8ICd0cnVlJyxcbiAgICAgICAgREVWSUNFX1RPS0VOX1RBQkxFX05BTUU6IGRldmljZVRva2VuVGFibGUudGFibGVOYW1lXG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBJQU0gcGVybWlzc2lvbnMgZm9yIENvc3QgRXhwbG9yZXJcbiAgICBhZ2VudEZ1bmN0aW9uLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdjZTpHZXRDb3N0QW5kVXNhZ2UnLFxuICAgICAgICAnY2U6R2V0VXNhZ2VSZXBvcnQnLFxuICAgICAgICAnY2U6R2V0RGltZW5zaW9uVmFsdWVzJyxcbiAgICAgICAgJ2NlOkdldFJlc2VydmF0aW9uQ292ZXJhZ2UnLFxuICAgICAgICAnY2U6R2V0UmVzZXJ2YXRpb25QdXJjaGFzZVJlY29tbWVuZGF0aW9uJyxcbiAgICAgICAgJ2NlOkdldFJlc2VydmF0aW9uVXRpbGl6YXRpb24nXG4gICAgICBdLFxuICAgICAgcmVzb3VyY2VzOiBbJyonXVxuICAgIH0pKTtcblxuICAgIC8vIEdyYW50IFNOUyBwdWJsaXNoIHBlcm1pc3Npb25zXG4gICAgYWxlcnRUb3BpYy5ncmFudFB1Ymxpc2goYWdlbnRGdW5jdGlvbik7XG5cbiAgICAvLyBHcmFudCBTTlMgcGxhdGZvcm0gYXBwbGljYXRpb24gcGVybWlzc2lvbnMgZm9yIGlPUyBwdXNoIG5vdGlmaWNhdGlvbnNcbiAgICBhZ2VudEZ1bmN0aW9uLmFkZFRvUm9sZVBvbGljeShuZXcgaWFtLlBvbGljeVN0YXRlbWVudCh7XG4gICAgICBlZmZlY3Q6IGlhbS5FZmZlY3QuQUxMT1csXG4gICAgICBhY3Rpb25zOiBbXG4gICAgICAgICdzbnM6Q3JlYXRlUGxhdGZvcm1FbmRwb2ludCcsXG4gICAgICAgICdzbnM6RGVsZXRlRW5kcG9pbnQnLFxuICAgICAgICAnc25zOkdldEVuZHBvaW50QXR0cmlidXRlcycsXG4gICAgICAgICdzbnM6U2V0RW5kcG9pbnRBdHRyaWJ1dGVzJyxcbiAgICAgICAgJ3NuczpMaXN0RW5kcG9pbnRzQnlQbGF0Zm9ybUFwcGxpY2F0aW9uJyxcbiAgICAgICAgJ3NuczpHZXRQbGF0Zm9ybUFwcGxpY2F0aW9uQXR0cmlidXRlcydcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFtcbiAgICAgICAgaW9zUGxhdGZvcm1BcHAucmVmLFxuICAgICAgICBgJHtpb3NQbGF0Zm9ybUFwcC5yZWZ9LypgXG4gICAgICBdXG4gICAgfSkpO1xuXG4gICAgLy8gR3JhbnQgRHluYW1vREIgcGVybWlzc2lvbnMgZm9yIGRldmljZSB0b2tlbiBtYW5hZ2VtZW50XG4gICAgZGV2aWNlVG9rZW5UYWJsZS5ncmFudFJlYWRXcml0ZURhdGEoYWdlbnRGdW5jdGlvbik7XG5cbiAgICAvLyBHcmFudCBDbG91ZFdhdGNoIHBlcm1pc3Npb25zIGZvciBjdXN0b20gbWV0cmljc1xuICAgIGFnZW50RnVuY3Rpb24uYWRkVG9Sb2xlUG9saWN5KG5ldyBpYW0uUG9saWN5U3RhdGVtZW50KHtcbiAgICAgIGVmZmVjdDogaWFtLkVmZmVjdC5BTExPVyxcbiAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgJ2Nsb3Vkd2F0Y2g6UHV0TWV0cmljRGF0YSdcbiAgICAgIF0sXG4gICAgICByZXNvdXJjZXM6IFsnKiddXG4gICAgfSkpO1xuXG4gICAgLy8gRXZlbnRCcmlkZ2UgcnVsZSB0byB0cmlnZ2VyIGRhaWx5IGF0IGNvbmZpZ3VyYWJsZSB0aW1lXG4gICAgY29uc3Qgc2NoZWR1bGVIb3VyID0gdGhpcy5ub2RlLnRyeUdldENvbnRleHQoJ3NjaGVkdWxlSG91cicpIHx8ICc5JztcbiAgICBjb25zdCBzY2hlZHVsZVJ1bGUgPSBuZXcgZXZlbnRzLlJ1bGUodGhpcywgJ1NwZW5kQ2hlY2tTY2hlZHVsZScsIHtcbiAgICAgIHNjaGVkdWxlOiBldmVudHMuU2NoZWR1bGUuY3Jvbih7XG4gICAgICAgIG1pbnV0ZTogJzAnLFxuICAgICAgICBob3VyOiBzY2hlZHVsZUhvdXIsXG4gICAgICAgIGRheTogJyonLFxuICAgICAgICBtb250aDogJyonLFxuICAgICAgICB5ZWFyOiAnKidcbiAgICAgIH0pLFxuICAgICAgZGVzY3JpcHRpb246IGBEYWlseSBBV1Mgc3BlbmQgY2hlY2sgYXQgJHtzY2hlZHVsZUhvdXJ9OjAwIFVUQ2BcbiAgICB9KTtcblxuICAgIC8vIEFkZCBMYW1iZGEgYXMgdGFyZ2V0XG4gICAgc2NoZWR1bGVSdWxlLmFkZFRhcmdldChuZXcgdGFyZ2V0cy5MYW1iZGFGdW5jdGlvbihhZ2VudEZ1bmN0aW9uKSk7XG5cbiAgICAvLyBDcmVhdGUgU05TIHRvcGljIGZvciBvcGVyYXRpb25hbCBhbGVydHNcbiAgICBjb25zdCBvcGVyYXRpb25hbEFsZXJ0VG9waWMgPSBuZXcgc25zLlRvcGljKHRoaXMsICdPcGVyYXRpb25hbEFsZXJ0VG9waWMnLCB7XG4gICAgICBkaXNwbGF5TmFtZTogJ1NwZW5kIE1vbml0b3IgT3BlcmF0aW9uYWwgQWxlcnRzJyxcbiAgICAgIHRvcGljTmFtZTogJ3NwZW5kLW1vbml0b3Itb3BzLWFsZXJ0cydcbiAgICB9KTtcblxuICAgIC8vIENsb3VkV2F0Y2ggQWxhcm1zIGZvciBtb25pdG9yaW5nXG4gICAgXG4gICAgLy8gTGFtYmRhIGZ1bmN0aW9uIGVycm9ycyBhbGFybVxuICAgIGNvbnN0IGVycm9yQWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnTGFtYmRhRXJyb3JBbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogJ1NwZW5kTW9uaXRvci1MYW1iZGFFcnJvcnMnLFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0FsYXJtIGZvciBMYW1iZGEgZnVuY3Rpb24gZXJyb3JzIGluIHNwZW5kIG1vbml0b3InLFxuICAgICAgbWV0cmljOiBhZ2VudEZ1bmN0aW9uLm1ldHJpY0Vycm9ycyh7XG4gICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIHN0YXRpc3RpYzogJ1N1bSdcbiAgICAgIH0pLFxuICAgICAgdGhyZXNob2xkOiAxLFxuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElOR1xuICAgIH0pO1xuICAgIGVycm9yQWxhcm0uYWRkQWxhcm1BY3Rpb24obmV3IGNsb3Vkd2F0Y2hBY3Rpb25zLlNuc0FjdGlvbihvcGVyYXRpb25hbEFsZXJ0VG9waWMpKTtcblxuICAgIC8vIExhbWJkYSBmdW5jdGlvbiBkdXJhdGlvbiBhbGFybVxuICAgIGNvbnN0IGR1cmF0aW9uQWxhcm0gPSBuZXcgY2xvdWR3YXRjaC5BbGFybSh0aGlzLCAnTGFtYmRhRHVyYXRpb25BbGFybScsIHtcbiAgICAgIGFsYXJtTmFtZTogJ1NwZW5kTW9uaXRvci1MYW1iZGFEdXJhdGlvbicsXG4gICAgICBhbGFybURlc2NyaXB0aW9uOiAnQWxhcm0gZm9yIExhbWJkYSBmdW5jdGlvbiBleGVjdXRpb24gZHVyYXRpb24nLFxuICAgICAgbWV0cmljOiBhZ2VudEZ1bmN0aW9uLm1ldHJpY0R1cmF0aW9uKHtcbiAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgc3RhdGlzdGljOiAnQXZlcmFnZSdcbiAgICAgIH0pLFxuICAgICAgdGhyZXNob2xkOiAyNDAwMDAsIC8vIDQgbWludXRlcyAodGltZW91dCBpcyA1IG1pbnV0ZXMpXG4gICAgICBldmFsdWF0aW9uUGVyaW9kczogMixcbiAgICAgIHRyZWF0TWlzc2luZ0RhdGE6IGNsb3Vkd2F0Y2guVHJlYXRNaXNzaW5nRGF0YS5OT1RfQlJFQUNISU5HXG4gICAgfSk7XG4gICAgZHVyYXRpb25BbGFybS5hZGRBbGFybUFjdGlvbihuZXcgY2xvdWR3YXRjaEFjdGlvbnMuU25zQWN0aW9uKG9wZXJhdGlvbmFsQWxlcnRUb3BpYykpO1xuXG4gICAgLy8gQ3VzdG9tIG1ldHJpYyBhbGFybXMgZm9yIGFnZW50IGV4ZWN1dGlvblxuICAgIGNvbnN0IGV4ZWN1dGlvbkZhaWx1cmVBbGFybSA9IG5ldyBjbG91ZHdhdGNoLkFsYXJtKHRoaXMsICdFeGVjdXRpb25GYWlsdXJlQWxhcm0nLCB7XG4gICAgICBhbGFybU5hbWU6ICdTcGVuZE1vbml0b3ItRXhlY3V0aW9uRmFpbHVyZXMnLFxuICAgICAgYWxhcm1EZXNjcmlwdGlvbjogJ0FsYXJtIGZvciBzcGVuZCBtb25pdG9yIGV4ZWN1dGlvbiBmYWlsdXJlcycsXG4gICAgICBtZXRyaWM6IG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgIG5hbWVzcGFjZTogJ1NwZW5kTW9uaXRvci9BZ2VudCcsXG4gICAgICAgIG1ldHJpY05hbWU6ICdFcnJvclJhdGUnLFxuICAgICAgICBkaW1lbnNpb25zTWFwOiB7XG4gICAgICAgICAgT3BlcmF0aW9uOiAnU3BlbmRNb25pdG9yaW5nJ1xuICAgICAgICB9LFxuICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpLFxuICAgICAgICBzdGF0aXN0aWM6ICdTdW0nXG4gICAgICB9KSxcbiAgICAgIHRocmVzaG9sZDogMSxcbiAgICAgIGV2YWx1YXRpb25QZXJpb2RzOiAxLFxuICAgICAgdHJlYXRNaXNzaW5nRGF0YTogY2xvdWR3YXRjaC5UcmVhdE1pc3NpbmdEYXRhLk5PVF9CUkVBQ0hJTkdcbiAgICB9KTtcbiAgICBleGVjdXRpb25GYWlsdXJlQWxhcm0uYWRkQWxhcm1BY3Rpb24obmV3IGNsb3Vkd2F0Y2hBY3Rpb25zLlNuc0FjdGlvbihvcGVyYXRpb25hbEFsZXJ0VG9waWMpKTtcblxuICAgIC8vIEFsZXJ0IGRlbGl2ZXJ5IGZhaWx1cmUgYWxhcm1cbiAgICBjb25zdCBhbGVydERlbGl2ZXJ5RmFpbHVyZUFsYXJtID0gbmV3IGNsb3Vkd2F0Y2guQWxhcm0odGhpcywgJ0FsZXJ0RGVsaXZlcnlGYWlsdXJlQWxhcm0nLCB7XG4gICAgICBhbGFybU5hbWU6ICdTcGVuZE1vbml0b3ItQWxlcnREZWxpdmVyeUZhaWx1cmVzJyxcbiAgICAgIGFsYXJtRGVzY3JpcHRpb246ICdBbGFybSBmb3IgYWxlcnQgZGVsaXZlcnkgZmFpbHVyZXMnLFxuICAgICAgbWV0cmljOiBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICBuYW1lc3BhY2U6ICdTcGVuZE1vbml0b3IvQWdlbnQnLFxuICAgICAgICBtZXRyaWNOYW1lOiAnQWxlcnREZWxpdmVyeUNvdW50JyxcbiAgICAgICAgZGltZW5zaW9uc01hcDoge1xuICAgICAgICAgIFN0YXR1czogJ0ZhaWx1cmUnXG4gICAgICAgIH0sXG4gICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgIHN0YXRpc3RpYzogJ1N1bSdcbiAgICAgIH0pLFxuICAgICAgdGhyZXNob2xkOiAxLFxuICAgICAgZXZhbHVhdGlvblBlcmlvZHM6IDEsXG4gICAgICB0cmVhdE1pc3NpbmdEYXRhOiBjbG91ZHdhdGNoLlRyZWF0TWlzc2luZ0RhdGEuTk9UX0JSRUFDSElOR1xuICAgIH0pO1xuICAgIGFsZXJ0RGVsaXZlcnlGYWlsdXJlQWxhcm0uYWRkQWxhcm1BY3Rpb24obmV3IGNsb3Vkd2F0Y2hBY3Rpb25zLlNuc0FjdGlvbihvcGVyYXRpb25hbEFsZXJ0VG9waWMpKTtcblxuICAgIC8vIENsb3VkV2F0Y2ggRGFzaGJvYXJkIGZvciBtb25pdG9yaW5nXG4gICAgY29uc3QgZGFzaGJvYXJkID0gbmV3IGNsb3Vkd2F0Y2guRGFzaGJvYXJkKHRoaXMsICdTcGVuZE1vbml0b3JEYXNoYm9hcmQnLCB7XG4gICAgICBkYXNoYm9hcmROYW1lOiAnU3BlbmRNb25pdG9yQWdlbnQnLFxuICAgICAgd2lkZ2V0czogW1xuICAgICAgICBbXG4gICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guR3JhcGhXaWRnZXQoe1xuICAgICAgICAgICAgdGl0bGU6ICdMYW1iZGEgRnVuY3Rpb24gTWV0cmljcycsXG4gICAgICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgICAgIGFnZW50RnVuY3Rpb24ubWV0cmljSW52b2NhdGlvbnMoeyBwZXJpb2Q6IGNkay5EdXJhdGlvbi5taW51dGVzKDUpIH0pLFxuICAgICAgICAgICAgICBhZ2VudEZ1bmN0aW9uLm1ldHJpY0Vycm9ycyh7IHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSkgfSlcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgICByaWdodDogW1xuICAgICAgICAgICAgICBhZ2VudEZ1bmN0aW9uLm1ldHJpY0R1cmF0aW9uKHsgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSB9KVxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgICAgIGhlaWdodDogNlxuICAgICAgICAgIH0pXG4gICAgICAgIF0sXG4gICAgICAgIFtcbiAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5HcmFwaFdpZGdldCh7XG4gICAgICAgICAgICB0aXRsZTogJ1NwZW5kIE1vbml0b3JpbmcgTWV0cmljcycsXG4gICAgICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICAgICAgbmFtZXNwYWNlOiAnU3BlbmRNb25pdG9yL0FnZW50JyxcbiAgICAgICAgICAgICAgICBtZXRyaWNOYW1lOiAnQ3VycmVudFNwZW5kJyxcbiAgICAgICAgICAgICAgICBwZXJpb2Q6IGNkay5EdXJhdGlvbi5ob3VycygxKSxcbiAgICAgICAgICAgICAgICBzdGF0aXN0aWM6ICdBdmVyYWdlJ1xuICAgICAgICAgICAgICB9KSxcbiAgICAgICAgICAgICAgbmV3IGNsb3Vkd2F0Y2guTWV0cmljKHtcbiAgICAgICAgICAgICAgICBuYW1lc3BhY2U6ICdTcGVuZE1vbml0b3IvQWdlbnQnLFxuICAgICAgICAgICAgICAgIG1ldHJpY05hbWU6ICdQcm9qZWN0ZWRNb250aGx5U3BlbmQnLFxuICAgICAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLmhvdXJzKDEpLFxuICAgICAgICAgICAgICAgIHN0YXRpc3RpYzogJ0F2ZXJhZ2UnXG4gICAgICAgICAgICAgIH0pXG4gICAgICAgICAgICBdLFxuICAgICAgICAgICAgd2lkdGg6IDEyLFxuICAgICAgICAgICAgaGVpZ2h0OiA2XG4gICAgICAgICAgfSlcbiAgICAgICAgXSxcbiAgICAgICAgW1xuICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLkdyYXBoV2lkZ2V0KHtcbiAgICAgICAgICAgIHRpdGxlOiAnQWxlcnQgRGVsaXZlcnkgTWV0cmljcycsXG4gICAgICAgICAgICBsZWZ0OiBbXG4gICAgICAgICAgICAgIG5ldyBjbG91ZHdhdGNoLk1ldHJpYyh7XG4gICAgICAgICAgICAgICAgbmFtZXNwYWNlOiAnU3BlbmRNb25pdG9yL0FnZW50JyxcbiAgICAgICAgICAgICAgICBtZXRyaWNOYW1lOiAnQWxlcnREZWxpdmVyeUNvdW50JyxcbiAgICAgICAgICAgICAgICBkaW1lbnNpb25zTWFwOiB7IFN0YXR1czogJ1N1Y2Nlc3MnIH0sXG4gICAgICAgICAgICAgICAgcGVyaW9kOiBjZGsuRHVyYXRpb24ubWludXRlcyg1KSxcbiAgICAgICAgICAgICAgICBzdGF0aXN0aWM6ICdTdW0nXG4gICAgICAgICAgICAgIH0pLFxuICAgICAgICAgICAgICBuZXcgY2xvdWR3YXRjaC5NZXRyaWMoe1xuICAgICAgICAgICAgICAgIG5hbWVzcGFjZTogJ1NwZW5kTW9uaXRvci9BZ2VudCcsXG4gICAgICAgICAgICAgICAgbWV0cmljTmFtZTogJ0FsZXJ0RGVsaXZlcnlDb3VudCcsXG4gICAgICAgICAgICAgICAgZGltZW5zaW9uc01hcDogeyBTdGF0dXM6ICdGYWlsdXJlJyB9LFxuICAgICAgICAgICAgICAgIHBlcmlvZDogY2RrLkR1cmF0aW9uLm1pbnV0ZXMoNSksXG4gICAgICAgICAgICAgICAgc3RhdGlzdGljOiAnU3VtJ1xuICAgICAgICAgICAgICB9KVxuICAgICAgICAgICAgXSxcbiAgICAgICAgICAgIHdpZHRoOiAxMixcbiAgICAgICAgICAgIGhlaWdodDogNlxuICAgICAgICAgIH0pXG4gICAgICAgIF1cbiAgICAgIF1cbiAgICB9KTtcblxuICAgIC8vIE91dHB1dHNcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnU05TVG9waWNBcm4nLCB7XG4gICAgICB2YWx1ZTogYWxlcnRUb3BpYy50b3BpY0FybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnU05TIFRvcGljIEFSTiBmb3Igc3BlbmQgYWxlcnRzJ1xuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FnZW50RnVuY3Rpb25OYW1lJywge1xuICAgICAgdmFsdWU6IGFnZW50RnVuY3Rpb24uZnVuY3Rpb25OYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdMYW1iZGEgZnVuY3Rpb24gbmFtZSBmb3IgdGhlIHNwZW5kIG1vbml0b3IgYWdlbnQnXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnaU9TUGxhdGZvcm1BcHBsaWNhdGlvbkFybicsIHtcbiAgICAgIHZhbHVlOiBpb3NQbGF0Zm9ybUFwcC5yZWYsXG4gICAgICBkZXNjcmlwdGlvbjogJ1NOUyBQbGF0Zm9ybSBBcHBsaWNhdGlvbiBBUk4gZm9yIGlPUyBwdXNoIG5vdGlmaWNhdGlvbnMnXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRGV2aWNlVG9rZW5UYWJsZU5hbWUnLCB7XG4gICAgICB2YWx1ZTogZGV2aWNlVG9rZW5UYWJsZS50YWJsZU5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0R5bmFtb0RCIHRhYmxlIG5hbWUgZm9yIGRldmljZSB0b2tlbiBzdG9yYWdlJ1xuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0xvZ0dyb3VwTmFtZScsIHtcbiAgICAgIHZhbHVlOiBsb2dHcm91cC5sb2dHcm91cE5hbWUsXG4gICAgICBkZXNjcmlwdGlvbjogJ0Nsb3VkV2F0Y2ggTG9nIEdyb3VwIGZvciB0aGUgc3BlbmQgbW9uaXRvciBhZ2VudCdcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdPcGVyYXRpb25hbEFsZXJ0VG9waWNBcm4nLCB7XG4gICAgICB2YWx1ZTogb3BlcmF0aW9uYWxBbGVydFRvcGljLnRvcGljQXJuLFxuICAgICAgZGVzY3JpcHRpb246ICdTTlMgVG9waWMgQVJOIGZvciBvcGVyYXRpb25hbCBhbGVydHMnXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnRGFzaGJvYXJkVVJMJywge1xuICAgICAgdmFsdWU6IGBodHRwczovLyR7dGhpcy5yZWdpb259LmNvbnNvbGUuYXdzLmFtYXpvbi5jb20vY2xvdWR3YXRjaC9ob21lP3JlZ2lvbj0ke3RoaXMucmVnaW9ufSNkYXNoYm9hcmRzOm5hbWU9JHtkYXNoYm9hcmQuZGFzaGJvYXJkTmFtZX1gLFxuICAgICAgZGVzY3JpcHRpb246ICdDbG91ZFdhdGNoIERhc2hib2FyZCBVUkwgZm9yIG1vbml0b3JpbmcnXG4gICAgfSk7XG4gIH1cbn0iXX0=