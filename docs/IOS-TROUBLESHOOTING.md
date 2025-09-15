# iOS Push Notifications Troubleshooting Guide

This guide helps you diagnose and resolve common issues with iOS push notifications in the AWS Spend Monitor.

## Table of Contents

1. [Quick Diagnostics](#quick-diagnostics)
2. [Certificate Issues](#certificate-issues)
3. [Device Registration Problems](#device-registration-problems)
4. [Notification Delivery Issues](#notification-delivery-issues)
5. [AWS Configuration Problems](#aws-configuration-problems)
6. [Network and Connectivity Issues](#network-and-connectivity-issues)
7. [Development vs Production Issues](#development-vs-production-issues)
8. [Debugging Tools and Commands](#debugging-tools-and-commands)

## Quick Diagnostics

### Run Automated Diagnostics

Start with these automated diagnostic scripts:

```bash
# Validate overall iOS configuration
./scripts/validate-ios-config.sh

# Test APNS connectivity
./scripts/test-apns-connection.sh

# Test device registration
./scripts/test-device-registration.sh

# Validate complete deployment
./scripts/validate-deployment.sh
```

### Check System Status

```bash
# Check AWS credentials
aws sts get-caller-identity

# Check platform application status
aws sns get-platform-application-attributes \
  --platform-application-arn "your-platform-app-arn"

# Check recent Lambda logs
aws logs tail /aws/lambda/spend-monitor-agent --follow
```

## Certificate Issues

### Problem: Certificate Expired or Invalid

**Symptoms:**
- SSL certificate expired errors
- APNS connection failures
- Platform application disabled

**Solutions:**

1. **Check certificate expiration:**
   ```bash
   openssl x509 -in apns-cert.pem -noout -enddate
   ```

2. **Generate new certificate:**
   - Go to Apple Developer Portal
   - Revoke old certificate
   - Create new APNS certificate
   - Download and convert to PEM format

3. **Update platform application:**
   ```bash
   ./scripts/setup-ios-platform.sh --update-existing
   ```

### Problem: Certificate and Key Mismatch

**Symptoms:**
- SSL handshake failures
- Authentication errors

**Solutions:**

1. **Verify certificate and key match:**
   ```bash
   # Check certificate modulus
   openssl x509 -noout -modulus -in apns-cert.pem | openssl md5
   
   # Check key modulus (should match above)
   openssl rsa -noout -modulus -in apns-key.pem | openssl md5
   ```

2. **Re-export certificate and key together:**
   - Export from Keychain as .p12 file
   - Convert both certificate and key from same .p12 file

### Problem: Wrong Certificate Type

**Symptoms:**
- Certificate works in development but not production
- Wrong APNS environment errors

**Solutions:**

1. **Check certificate type:**
   ```bash
   openssl x509 -in apns-cert.pem -noout -text | grep -A 5 "Subject:"
   ```

2. **Ensure correct certificate for environment:**
   - Development: Use APNS Development certificate with APNS_SANDBOX
   - Production: Use APNS Production certificate with APNS

## Device Registration Problems

### Problem: Invalid Device Token Format

**Symptoms:**
- "Invalid device token" errors
- Registration API returns 400 errors

**Solutions:**

1. **Validate token format:**
   ```bash
   # Token should be 64-character hex string
   echo "your-token" | grep -E '^[0-9a-fA-F]{64}$'
   ```

2. **Check iOS app token generation:**
   ```swift
   func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
       let tokenString = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
       // tokenString should be 64 characters, lowercase hex
   }
   ```

### Problem: Bundle ID Mismatch

**Symptoms:**
- Certificate validation failures
- Push notifications not received

**Solutions:**

1. **Verify bundle ID matches:**
   - iOS app bundle ID
   - APNS certificate bundle ID
   - Configuration bundle ID

2. **Check certificate bundle ID:**
   ```bash
   openssl x509 -in apns-cert.pem -noout -text | grep -A 10 "Subject:"
   ```

### Problem: Duplicate Device Registrations

**Symptoms:**
- Multiple endpoints for same device
- Inconsistent notification delivery

**Solutions:**

1. **Clean up duplicate endpoints:**
   ```bash
   # List endpoints for platform application
   aws sns list-endpoints-by-platform-application \
     --platform-application-arn "your-platform-app-arn"
   
   # Delete duplicate endpoints
   aws sns delete-endpoint --endpoint-arn "duplicate-endpoint-arn"
   ```

2. **Implement proper token management in iOS app:**
   - Check if token changed before registering
   - Update existing registration instead of creating new

## Notification Delivery Issues

### Problem: Notifications Not Received

**Symptoms:**
- SNS publish succeeds but no notification on device
- No errors in logs

**Diagnostic Steps:**

1. **Check device token validity:**
   ```bash
   # Test with a simple notification
   aws sns publish \
     --target-arn "your-endpoint-arn" \
     --message '{"APNS":"{\"aps\":{\"alert\":\"Test\"}}"}'
   ```

2. **Verify iOS app notification permissions:**
   ```swift
   UNUserNotificationCenter.current().getNotificationSettings { settings in
       print("Notification authorization status: \(settings.authorizationStatus)")
   }
   ```

3. **Check APNS feedback service:**
   - Invalid tokens are reported through APNS feedback
   - AWS SNS automatically processes feedback and disables invalid endpoints

### Problem: Malformed Notification Payload

**Symptoms:**
- Notifications sent but not displayed correctly
- iOS app crashes on notification

**Solutions:**

1. **Validate payload format:**
   ```json
   {
     "APNS": "{\"aps\":{\"alert\":{\"title\":\"Title\",\"body\":\"Body\"},\"badge\":1,\"sound\":\"default\"}}"
   }
   ```

2. **Check payload size limits:**
   - APNS payload limit: 4KB for regular notifications
   - Use shorter messages or remove unnecessary data

3. **Test payload with APNS HTTP/2 API:**
   ```bash
   curl -v --http2 \
     --cert apns-cert.pem --key apns-key.pem \
     -H "apns-topic: your.bundle.id" \
     -H "apns-push-type: alert" \
     -d '{"aps":{"alert":"Test"}}' \
     https://api.sandbox.push.apple.com/3/device/your-device-token
   ```

### Problem: Notifications Delayed or Batched

**Symptoms:**
- Notifications arrive minutes or hours late
- Multiple notifications arrive at once

**Causes and Solutions:**

1. **iOS Power Management:**
   - iOS may delay notifications for battery optimization
   - Use `apns-priority: 10` for immediate delivery
   - Set `content-available: 1` for background updates

2. **APNS Throttling:**
   - Apple throttles notifications for inactive apps
   - Encourage users to open app regularly
   - Use appropriate `apns-expiration` headers

## AWS Configuration Problems

### Problem: SNS Platform Application Not Found

**Symptoms:**
- "Platform application does not exist" errors
- Cannot create endpoints

**Solutions:**

1. **Verify platform application ARN:**
   ```bash
   aws sns list-platform-applications --region your-region
   ```

2. **Check region consistency:**
   - Ensure all resources are in same AWS region
   - Update configuration with correct region

3. **Recreate platform application:**
   ```bash
   ./scripts/setup-ios-platform.sh
   ```

### Problem: IAM Permission Errors

**Symptoms:**
- Access denied errors
- Cannot create or manage endpoints

**Solutions:**

1. **Check required IAM permissions:**
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       {
         "Effect": "Allow",
         "Action": [
           "sns:CreatePlatformEndpoint",
           "sns:DeleteEndpoint",
           "sns:GetEndpointAttributes",
           "sns:SetEndpointAttributes",
           "sns:Publish",
           "sns:GetPlatformApplicationAttributes"
         ],
         "Resource": "*"
       }
     ]
   }
   ```

2. **Test permissions:**
   ```bash
   # Test SNS permissions
   aws sns list-platform-applications
   aws sns get-platform-application-attributes --platform-application-arn "your-arn"
   ```

### Problem: Lambda Function Errors

**Symptoms:**
- Lambda timeouts
- Memory errors
- Configuration errors

**Solutions:**

1. **Check Lambda configuration:**
   ```bash
   aws lambda get-function-configuration --function-name spend-monitor-agent
   ```

2. **Increase memory and timeout:**
   - Recommended: 512MB memory, 300s timeout
   - iOS processing requires additional resources

3. **Check environment variables:**
   ```bash
   # Required variables
   IOS_PLATFORM_APP_ARN=arn:aws:sns:...
   IOS_BUNDLE_ID=com.your.app
   APNS_SANDBOX=true/false
   ```

## Network and Connectivity Issues

### Problem: Cannot Connect to APNS

**Symptoms:**
- Connection timeouts
- SSL handshake failures

**Solutions:**

1. **Check firewall rules:**
   - Allow HTTPS (443) to *.push.apple.com
   - Whitelist APNS endpoints:
     - api.push.apple.com (production)
     - api.sandbox.push.apple.com (development)

2. **Test connectivity:**
   ```bash
   # Test basic connectivity
   curl -v https://api.sandbox.push.apple.com
   
   # Test with certificate
   curl -v --cert apns-cert.pem --key apns-key.pem \
     https://api.sandbox.push.apple.com
   ```

3. **Check corporate proxy settings:**
   - Configure proxy for APNS traffic
   - Ensure proxy supports HTTP/2

### Problem: DNS Resolution Issues

**Symptoms:**
- Cannot resolve APNS hostnames
- Intermittent connection failures

**Solutions:**

1. **Test DNS resolution:**
   ```bash
   nslookup api.push.apple.com
   nslookup api.sandbox.push.apple.com
   ```

2. **Use alternative DNS servers:**
   - Configure 8.8.8.8 or 1.1.1.1 as DNS
   - Check /etc/resolv.conf configuration

## Development vs Production Issues

### Problem: Works in Development but Not Production

**Common Causes:**

1. **Wrong certificate environment:**
   - Using development certificate with production APNS
   - Using production certificate with sandbox APNS

2. **Bundle ID mismatch:**
   - Development and production apps have different bundle IDs
   - Certificate generated for wrong bundle ID

3. **Device token environment mismatch:**
   - Development device tokens don't work with production APNS
   - Need separate tokens for each environment

**Solutions:**

1. **Use correct certificate for environment:**
   ```bash
   # Development
   PLATFORM_TYPE="APNS_SANDBOX"
   APNS_ENDPOINT="api.sandbox.push.apple.com"
   
   # Production
   PLATFORM_TYPE="APNS"
   APNS_ENDPOINT="api.push.apple.com"
   ```

2. **Separate platform applications:**
   - Create separate SNS platform applications for dev/prod
   - Use environment-specific configuration

### Problem: TestFlight vs App Store Differences

**Symptoms:**
- Notifications work in TestFlight but not App Store
- Different behavior between beta and release

**Solutions:**

1. **Use production APNS for TestFlight:**
   - TestFlight apps use production APNS environment
   - Ensure production certificates are configured

2. **Check app review guidelines:**
   - Ensure notifications comply with Apple guidelines
   - Test notification content and frequency

## Debugging Tools and Commands

### AWS CLI Commands

```bash
# List platform applications
aws sns list-platform-applications --region us-east-1

# Get platform application details
aws sns get-platform-application-attributes \
  --platform-application-arn "arn:aws:sns:us-east-1:123456789012:app/APNS/MyApp"

# List endpoints
aws sns list-endpoints-by-platform-application \
  --platform-application-arn "arn:aws:sns:us-east-1:123456789012:app/APNS/MyApp"

# Get endpoint details
aws sns get-endpoint-attributes \
  --endpoint-arn "arn:aws:sns:us-east-1:123456789012:endpoint/APNS/MyApp/12345"

# Send test notification
aws sns publish \
  --target-arn "endpoint-arn" \
  --message '{"APNS":"{\"aps\":{\"alert\":\"Test\"}}"}'

# Check CloudWatch logs
aws logs tail /aws/lambda/spend-monitor-agent --follow
```

### OpenSSL Commands

```bash
# Check certificate details
openssl x509 -in apns-cert.pem -noout -text

# Check certificate expiration
openssl x509 -in apns-cert.pem -noout -enddate

# Verify certificate and key match
openssl x509 -noout -modulus -in apns-cert.pem | openssl md5
openssl rsa -noout -modulus -in apns-key.pem | openssl md5

# Test APNS connection
openssl s_client -connect api.sandbox.push.apple.com:443 \
  -cert apns-cert.pem -key apns-key.pem
```

### cURL Commands for APNS Testing

```bash
# Test APNS HTTP/2 connection
curl -v --http2 \
  --cert apns-cert.pem --key apns-key.pem \
  -H "apns-topic: com.your.bundle.id" \
  -H "apns-push-type: alert" \
  -H "apns-priority: 10" \
  -d '{"aps":{"alert":"Test notification"}}' \
  https://api.sandbox.push.apple.com/3/device/your-device-token

# Test with production APNS
curl -v --http2 \
  --cert apns-cert.pem --key apns-key.pem \
  -H "apns-topic: com.your.bundle.id" \
  -H "apns-push-type: alert" \
  -d '{"aps":{"alert":"Production test"}}' \
  https://api.push.apple.com/3/device/your-device-token
```

### iOS Debugging Code

```swift
// Check notification authorization status
UNUserNotificationCenter.current().getNotificationSettings { settings in
    print("Authorization status: \(settings.authorizationStatus.rawValue)")
    print("Alert setting: \(settings.alertSetting.rawValue)")
    print("Badge setting: \(settings.badgeSetting.rawValue)")
    print("Sound setting: \(settings.soundSetting.rawValue)")
}

// Log device token registration
func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
    let tokenString = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
    print("Device token: \(tokenString)")
    print("Token length: \(tokenString.count)")
    
    // Validate token format
    let isValid = tokenString.count == 64 && tokenString.range(of: "^[0-9a-fA-F]+$", options: .regularExpression) != nil
    print("Token is valid: \(isValid)")
}

// Handle registration failures
func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
    print("Failed to register for remote notifications: \(error)")
}

// Handle received notifications
func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
    print("Received notification: \(response.notification.request.content.userInfo)")
    completionHandler()
}
```

## Getting Help

If you're still experiencing issues after following this guide:

1. **Check the main setup guide:** [docs/IOS-SETUP.md](./IOS-SETUP.md)
2. **Run all diagnostic scripts** and collect their output
3. **Check CloudWatch logs** for detailed error messages
4. **Review Apple's APNS documentation** for the latest requirements
5. **Test with a minimal iOS app** to isolate configuration issues

### Useful Resources

- [Apple Push Notification Service Documentation](https://developer.apple.com/documentation/usernotifications)
- [AWS SNS Mobile Push Documentation](https://docs.aws.amazon.com/sns/latest/dg/sns-mobile-push-notifications.html)
- [APNS HTTP/2 API Reference](https://developer.apple.com/documentation/usernotifications/setting_up_a_remote_notification_server)
- [iOS Notification Troubleshooting](https://developer.apple.com/documentation/usernotifications/handling_notification_responses_from_the_user)

### Common Error Codes

| Error Code | Description | Solution |
|------------|-------------|----------|
| 400 | Bad device token | Verify token format and validity |
| 403 | Certificate error | Check certificate and bundle ID |
| 410 | Device token inactive | Remove token from endpoints |
| 413 | Payload too large | Reduce notification payload size |
| 429 | Too many requests | Implement rate limiting |
| 500 | APNS server error | Retry with exponential backoff |