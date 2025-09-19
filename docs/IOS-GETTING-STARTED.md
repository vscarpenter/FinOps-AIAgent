# iOS Notifications - Getting Started Guide

This guide will walk you through setting up iOS push notifications for your FinOps AI Agent from start to finish.

## 📋 Prerequisites

Before you begin, ensure you have:

- ✅ **Apple Developer Account** - Required for APNS certificates
- ✅ **iOS App** - Your mobile app that will receive notifications
- ✅ **AWS Account** - With appropriate permissions
- ✅ **FinOps AI Agent** - Already deployed (basic version)
- ✅ **Node.js 18+** and npm installed

## 🚀 Quick Start (5 Minutes)

If you just want to test iOS notifications quickly:

```bash
# 1. Deploy with iOS support
npm run deploy

# 2. Set up basic iOS configuration
export IOS_BUNDLE_ID="com.vinny.aws.spendmonitor"
export APNS_SANDBOX="true"

# 3. Test device registration
npm run test:device-api

# 4. Trigger a test notification
npm run test:local
```

## 📱 Step-by-Step Setup

### Step 1: Apple Developer Setup

#### 1.1 Create APNS Certificate

1. **Log into Apple Developer Portal**
   - Go to [developer.apple.com](https://developer.apple.com)
   - Navigate to Certificates, Identifiers & Profiles

2. **Create App ID** (if not exists)
   ```
   Description: FinOps Notifications
   Bundle ID: com.yourcompany.finops (explicit)
   Capabilities: ✅ Push Notifications
   ```

3. **Generate APNS Certificate**
   ```
   Type: Apple Push Notification service SSL (Sandbox & Production)
   App ID: Select your FinOps app
   ```

4. **Download Certificate**
   - Download the `.cer` file
   - Double-click to install in Keychain Access

#### 1.2 Export Certificate and Key

1. **Open Keychain Access**
   - Find your APNS certificate
   - Right-click → Export

2. **Export as .p12**
   ```
   Format: Personal Information Exchange (.p12)
   Password: [create a secure password]
   ```

3. **Convert to PEM format**
   ```bash
   # Extract certificate
   openssl pkcs12 -in apns-cert.p12 -out apns-cert.pem -clcerts -nokeys
   
   # Extract private key
   openssl pkcs12 -in apns-cert.p12 -out apns-key.pem -nocerts -nodes
   ```

### Step 2: AWS SNS Platform Application Setup

#### 2.1 Create SNS Platform Application

```bash
# Using AWS CLI
aws sns create-platform-application \
  --name "FinOpsAPNS" \
  --platform "APNS_SANDBOX" \
  --attributes PlatformCredential="$(cat apns-cert.pem)",PlatformPrincipal="$(cat apns-key.pem)"
```

Or use the AWS Console:
1. Go to SNS → Mobile → Push notifications
2. Create platform application
3. Platform: Apple iOS (APNS_SANDBOX for testing)
4. Upload your certificate and key

#### 2.2 Note the Platform Application ARN

```bash
# The output will include your Platform Application ARN
arn:aws:sns:us-east-1:123456789012:app/APNS_SANDBOX/FinOpsAPNS
```

### Step 3: Configure Your FinOps Agent

#### 3.1 Update Environment Variables

Create or update `.env.ios`:

```bash
# Required iOS Configuration
IOS_PLATFORM_APPLICATION_ARN=arn:aws:sns:us-east-1:123456789012:app/APNS_SANDBOX/FinOpsAPNS
IOS_BUNDLE_ID=com.yourcompany.finops
APNS_SANDBOX=true

# Basic Agent Configuration
AWS_REGION=us-east-1
SPEND_THRESHOLD=10.00
SNS_TOPIC_ARN=arn:aws:sns:us-east-1:123456789012:spend-alerts
```

#### 3.2 Update CDK Context (Optional)

In `cdk.context.json`:

```json
{
  "iosBundleId": "com.yourcompany.finops",
  "apnsSandbox": "true",
  "apnsCertificate": "path/to/apns-cert.pem",
  "apnsPrivateKey": "path/to/apns-key.pem"
}
```

### Step 4: Deploy iOS-Enabled Infrastructure

#### 4.1 Validate Configuration

```bash
# Validate your iOS configuration
npm run validate:ios

# Expected output:
# ✅ iOS Bundle ID is configured
# ✅ APNS Platform Application ARN is set
# ✅ APNS certificate is valid
```

#### 4.2 Deploy to AWS

```bash
# Deploy with iOS support
npm run deploy

# This will create:
# - SNS Platform Application (if not exists)
# - Device Registration API
# - DynamoDB table for device tokens
# - CloudWatch alarms for certificate monitoring
```

#### 4.3 Verify Deployment

```bash
# Validate the deployment
npm run validate:deployment

# Expected output:
# ✅ CloudFormation stack found
# ✅ Lambda function found
# ✅ SNS topic found
# ✅ iOS platform application is accessible
# ✅ Device Registration API found
```

### Step 5: iOS App Integration

#### 5.1 Add Push Notification Capability

In your iOS app's `AppDelegate.swift`:

```swift
import UserNotifications

class AppDelegate: UIResponder, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        
        // Request notification permissions
        UNUserNotificationCenter.current().delegate = self
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, error in
            if granted {
                DispatchQueue.main.async {
                    application.registerForRemoteNotifications()
                }
            }
        }
        
        return true
    }
    
    // Handle successful registration
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let tokenString = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        print("Device Token: \(tokenString)")
        
        // Register with your FinOps API
        registerDeviceWithFinOpsAPI(deviceToken: tokenString)
    }
    
    // Handle registration failure
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        print("Failed to register for remote notifications: \(error)")
    }
}
```

#### 5.2 Register Device with FinOps API

```swift
func registerDeviceWithFinOpsAPI(deviceToken: String) {
    guard let url = URL(string: "https://your-api-gateway-url/v1/devices") else { return }
    
    var request = URLRequest(url: url)
    request.httpMethod = "POST"
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("your-api-key", forHTTPHeaderField: "X-API-Key")
    
    let body = [
        "deviceToken": deviceToken,
        "userId": "user123", // Optional
        "bundleId": "com.yourcompany.finops"
    ]
    
    request.httpBody = try? JSONSerialization.data(withJSONObject: body)
    
    URLSession.shared.dataTask(with: request) { data, response, error in
        if let error = error {
            print("Registration failed: \(error)")
            return
        }
        
        if let httpResponse = response as? HTTPURLResponse, httpResponse.statusCode == 200 {
            print("Device registered successfully!")
        }
    }.resume()
}
```

### Step 6: Testing Your Setup

#### 6.1 Test Device Registration

```bash
# Test the device registration API
npm run test:device-api

# This will:
# - Test device token validation
# - Test API endpoint accessibility
# - Verify database storage
```

#### 6.2 Test APNS Connection

```bash
# Test APNS connectivity
npm run test:apns-connection

# Expected output:
# ✅ APNS platform application is accessible
# ✅ Certificate is valid
# ✅ Test notification sent successfully
```

#### 6.3 Trigger Test Notification

```bash
# Trigger a test spending alert
npm run test:local

# This will:
# - Simulate spending threshold exceeded
# - Send iOS push notification
# - Fall back to email/SMS if iOS fails
```

#### 6.4 Manual Device Registration Test

```bash
# Register a test device manually
curl -X POST https://your-api-gateway-url/v1/devices \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "deviceToken": "your-64-character-hex-device-token",
    "userId": "test-user",
    "bundleId": "com.yourcompany.finops"
  }'
```

## 🔍 Monitoring & Troubleshooting

### CloudWatch Metrics

Monitor your iOS notifications in CloudWatch:

```bash
# View iOS notification metrics
aws cloudwatch get-metric-statistics \
  --namespace "SpendMonitor/iOS" \
  --metric-name "iOSNotificationCount" \
  --dimensions Name=Status,Value=Success \
  --start-time 2024-01-01T00:00:00Z \
  --end-time 2024-01-02T00:00:00Z \
  --period 3600 \
  --statistics Sum
```

### Common Issues & Solutions

#### Issue: "Invalid device token format"
```bash
# Solution: Ensure device token is 64-character hex string
echo "Device token length: ${#DEVICE_TOKEN}"
# Should output: Device token length: 64
```

#### Issue: "Platform application not found"
```bash
# Solution: Verify platform application ARN
aws sns get-platform-application-attributes \
  --platform-application-arn $IOS_PLATFORM_APPLICATION_ARN
```

#### Issue: "Certificate expired"
```bash
# Solution: Check certificate expiration
npm run validate:ios
# Look for certificate expiration warnings
```

#### Issue: "No devices receiving notifications"
```bash
# Solution: Check device registration
curl -X GET "https://your-api-gateway-url/v1/devices?userId=test-user" \
  -H "X-API-Key: your-api-key"
```

### Health Monitoring

```bash
# Check overall iOS system health
aws logs filter-log-events \
  --log-group-name /aws/lambda/spend-monitor-agent \
  --filter-pattern "iOS health check"
```

## 🚀 Production Deployment

### Step 1: Switch to Production APNS

1. **Create Production Certificate**
   - Use "Apple Push Notification service SSL (Production)" in Apple Developer Portal

2. **Update Platform Application**
   ```bash
   aws sns set-platform-application-attributes \
     --platform-application-arn $IOS_PLATFORM_APPLICATION_ARN \
     --attributes Platform=APNS
   ```

3. **Update Environment**
   ```bash
   export APNS_SANDBOX=false
   ```

### Step 2: Configure Monitoring

```bash
# Set up CloudWatch alarms
aws cloudwatch put-metric-alarm \
  --alarm-name "iOS-Notification-Failures" \
  --alarm-description "Alert on iOS notification failures" \
  --metric-name iOSNotificationCount \
  --namespace SpendMonitor/iOS \
  --statistic Sum \
  --period 300 \
  --threshold 5 \
  --comparison-operator GreaterThanThreshold
```

### Step 3: Load Testing

```bash
# Run performance tests
npm run test:performance

# Test with multiple devices
npm run test:integration:ios
```

## 📚 Additional Resources

- **[iOS Setup Documentation](./IOS-SETUP.md)** - Detailed setup instructions
- **[Device Registration API](./DEVICE-REGISTRATION-API.md)** - Complete API reference
- **[iOS Troubleshooting](./IOS-TROUBLESHOOTING.md)** - Common issues and solutions
- **[Swift Integration Example](../examples/ios-app-integration.swift)** - Complete iOS app code
- **[JavaScript Examples](../examples/ios-device-registration.js)** - Device registration examples

## 🎯 Next Steps

Once iOS notifications are working:

1. **Scale Testing** - Test with multiple devices and users
2. **Custom Notifications** - Customize notification content and formatting
3. **Advanced Features** - Implement notification categories and actions
4. **Analytics** - Set up detailed notification analytics and reporting
5. **Automation** - Automate device registration and management

---

**🎉 Congratulations!** Your FinOps AI Agent now supports iOS push notifications with enterprise-grade reliability and monitoring.

For additional help, check the troubleshooting guide or review the CloudWatch logs for detailed error information.