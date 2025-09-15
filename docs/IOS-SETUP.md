# iOS Push Notifications Setup Guide

This guide provides step-by-step instructions for setting up iOS push notifications for the AWS Spend Monitor Agent.

## Prerequisites

- Apple Developer Account (paid membership required)
- AWS Account with appropriate permissions
- AWS CLI configured
- Node.js 18+ and npm installed
- Xcode (for iOS app development)

## Table of Contents

1. [Apple Developer Account Setup](#apple-developer-account-setup)
2. [APNS Certificate Generation](#apns-certificate-generation)
3. [AWS SNS Platform Application Setup](#aws-sns-platform-application-setup)
4. [Device Registration](#device-registration)
5. [Testing Procedures](#testing-procedures)
6. [Troubleshooting](#troubleshooting)
7. [Deployment Validation](#deployment-validation)

## Apple Developer Account Setup

### Step 1: Create App ID

1. Log in to [Apple Developer Portal](https://developer.apple.com/account/)
2. Navigate to **Certificates, Identifiers & Profiles**
3. Click **Identifiers** → **App IDs**
4. Click the **+** button to create a new App ID
5. Fill in the details:
   - **Description**: AWS Spend Monitor
   - **Bundle ID**: `com.yourcompany.aws-spend-monitor` (use your own domain)
   - **Capabilities**: Check **Push Notifications**
6. Click **Continue** and **Register**

### Step 2: Enable Push Notifications

1. Select your newly created App ID
2. Click **Edit**
3. Scroll to **Push Notifications** and click **Configure**
4. You'll configure certificates in the next section

## APNS Certificate Generation

### Development Certificate (Sandbox)

1. In the App ID configuration, under **Push Notifications**:
2. Click **Create Certificate** under **Development SSL Certificate**
3. Follow the instructions to create a Certificate Signing Request (CSR):
   ```bash
   # Open Keychain Access on macOS
   # Go to Keychain Access > Certificate Assistant > Request a Certificate From a Certificate Authority
   # Enter your email and name, select "Saved to disk"
   ```
4. Upload the CSR file
5. Download the certificate (`aps_development.cer`)
6. Double-click to install in Keychain Access

### Production Certificate

1. Click **Create Certificate** under **Production SSL Certificate**
2. Follow the same CSR process
3. Download the certificate (`aps.cer`)
4. Double-click to install in Keychain Access

### Export Certificates and Keys

1. Open **Keychain Access**
2. Find your APNS certificates in **My Certificates**
3. Export each certificate:
   ```bash
   # Right-click certificate → Export
   # Save as .p12 file with a password
   ```
4. Convert to PEM format:
   ```bash
   # Development certificate
   openssl pkcs12 -in aps_development.p12 -out apns-dev-cert.pem -clcerts -nokeys
   openssl pkcs12 -in aps_development.p12 -out apns-dev-key.pem -nocerts -nodes
   
   # Production certificate
   openssl pkcs12 -in aps_production.p12 -out apns-prod-cert.pem -clcerts -nokeys
   openssl pkcs12 -in aps_production.p12 -out apns-prod-key.pem -nocerts -nodes
   ```

## AWS SNS Platform Application Setup

### Using AWS CLI

Use the provided setup script:

```bash
# Make the script executable
chmod +x scripts/setup-ios-platform.sh

# Run the setup script
./scripts/setup-ios-platform.sh
```

### Manual Setup

1. Create the platform application:
   ```bash
   aws sns create-platform-application \
     --name "SpendMonitorAPNS-Dev" \
     --platform APNS_SANDBOX \
     --attributes PlatformCredential="$(cat apns-dev-cert.pem)",PlatformPrincipal="$(cat apns-dev-key.pem)"
   ```

2. For production:
   ```bash
   aws sns create-platform-application \
     --name "SpendMonitorAPNS-Prod" \
     --platform APNS \
     --attributes PlatformCredential="$(cat apns-prod-cert.pem)",PlatformPrincipal="$(cat apns-prod-key.pem)"
   ```

3. Note the returned `PlatformApplicationArn` for configuration

## Device Registration

### API Endpoint

The spend monitor provides a REST API for device registration:

```bash
# Register a new device
curl -X POST https://your-api-gateway-url/devices \
  -H "Content-Type: application/json" \
  -d '{
    "deviceToken": "your-64-char-hex-device-token",
    "bundleId": "com.yourcompany.aws-spend-monitor",
    "userId": "optional-user-id"
  }'
```

### iOS App Integration

Add this code to your iOS app:

```swift
import UserNotifications

class NotificationManager {
    func registerForPushNotifications() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, error in
            guard granted else { return }
            
            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }
    
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let tokenString = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        
        // Send token to your registration API
        registerDeviceToken(tokenString)
    }
    
    private func registerDeviceToken(_ token: String) {
        // Implementation to call your registration API
        let url = URL(string: "https://your-api-gateway-url/devices")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        let body = [
            "deviceToken": token,
            "bundleId": Bundle.main.bundleIdentifier ?? "",
            "userId": "user-identifier"
        ]
        
        request.httpBody = try? JSONSerialization.data(withJSONObject: body)
        
        URLSession.shared.dataTask(with: request) { data, response, error in
            // Handle response
        }.resume()
    }
}
```

## Testing Procedures

### 1. Test Certificate Configuration

```bash
# Run the validation script
./scripts/validate-ios-config.sh

# Test APNS connectivity
./scripts/test-apns-connection.sh
```

### 2. Test Device Registration

```bash
# Use the test script with a sample device token
node examples/test-device-registration-api.js
```

### 3. Test Push Notification Delivery

```bash
# Run integration tests
npm run test:ios-integration

# Manual test with curl
curl -X POST https://your-api-gateway-url/test-notification \
  -H "Content-Type: application/json" \
  -d '{
    "deviceToken": "your-device-token",
    "message": "Test notification"
  }'
```

### 4. Monitor Logs

```bash
# Check CloudWatch logs
aws logs tail /aws/lambda/spend-monitor-agent --follow

# Check SNS delivery status
aws sns get-platform-application-attributes \
  --platform-application-arn your-platform-app-arn
```

## Troubleshooting

### Common Issues

#### 1. Invalid Device Token Format
**Error**: "Invalid device token format"
**Solution**: 
- Ensure token is 64-character hexadecimal string
- Remove any spaces or special characters
- Verify token is from the correct app and environment

#### 2. APNS Certificate Expired
**Error**: "SSL certificate expired"
**Solution**:
- Generate new certificate in Apple Developer Portal
- Update SNS platform application with new certificate
- Redeploy the application

#### 3. Platform Application Not Found
**Error**: "Platform application does not exist"
**Solution**:
- Verify the platform application ARN in configuration
- Check AWS region matches where platform app was created
- Ensure IAM permissions include SNS platform operations

#### 4. Push Notification Not Received
**Troubleshooting Steps**:
1. Check device token is valid and registered
2. Verify app is in foreground/background as expected
3. Check APNS environment (sandbox vs production)
4. Review CloudWatch logs for delivery errors
5. Test with APNS HTTP/2 API directly

#### 5. Bundle ID Mismatch
**Error**: "Bundle ID does not match"
**Solution**:
- Ensure iOS app bundle ID matches certificate
- Update configuration with correct bundle ID
- Regenerate certificate if necessary

### Debug Commands

```bash
# Check platform application status
aws sns get-platform-application-attributes \
  --platform-application-arn arn:aws:sns:region:account:app/APNS/AppName

# List platform endpoints
aws sns list-endpoints-by-platform-application \
  --platform-application-arn arn:aws:sns:region:account:app/APNS/AppName

# Test SNS publish
aws sns publish \
  --target-arn arn:aws:sns:region:account:endpoint/APNS/AppName/endpoint-id \
  --message '{"APNS":"{\"aps\":{\"alert\":\"Test message\"}}"}'

# Check CloudWatch logs
aws logs describe-log-groups --log-group-name-prefix "/aws/lambda/spend-monitor"
```

## Deployment Validation

### Pre-Deployment Checklist

- [ ] Apple Developer account configured
- [ ] APNS certificates generated and exported
- [ ] SNS platform application created
- [ ] IAM permissions configured
- [ ] Environment variables set
- [ ] Bundle ID matches certificate

### Post-Deployment Validation

Run the deployment validation script:

```bash
./scripts/validate-deployment.sh
```

This script checks:
- SNS platform application exists and is active
- APNS certificates are valid and not expired
- Lambda function has correct environment variables
- IAM roles have required permissions
- API Gateway endpoints are accessible

### Configuration Verification

```bash
# Verify environment variables
aws lambda get-function-configuration \
  --function-name spend-monitor-agent \
  --query 'Environment.Variables'

# Test API endpoints
curl -X GET https://your-api-gateway-url/health

# Validate SNS topic configuration
aws sns get-topic-attributes \
  --topic-arn your-topic-arn
```

## Security Considerations

1. **Certificate Storage**: Store APNS certificates securely, never commit to version control
2. **Device Token Privacy**: Treat device tokens as sensitive data
3. **API Authentication**: Implement proper authentication for device registration API
4. **Rate Limiting**: Configure rate limiting on registration endpoints
5. **Data Encryption**: Ensure all data transmission is encrypted (HTTPS/TLS)

## Next Steps

After completing the iOS setup:

1. Deploy the updated infrastructure with iOS configuration
2. Test device registration and notification delivery
3. Monitor CloudWatch logs and metrics
4. Set up alerts for certificate expiration
5. Document any custom configuration for your environment

For additional support, refer to:
- [Apple Push Notification Service Documentation](https://developer.apple.com/documentation/usernotifications)
- [AWS SNS Mobile Push Documentation](https://docs.aws.amazon.com/sns/latest/dg/sns-mobile-push-notifications.html)
- [Project Troubleshooting Guide](./TROUBLESHOOTING.md)