# iOS Device Registration API

This document describes the iOS Device Registration API for the AWS Spend Monitor, which allows iOS devices to register for push notifications when spending thresholds are exceeded.

## Overview

The Device Registration API is a REST API built with AWS API Gateway and Lambda that manages iOS device tokens for push notifications. It provides endpoints for registering devices, updating tokens, listing user devices, and removing registrations.

## API Endpoints

### Base URL
```
https://{api-id}.execute-api.{region}.amazonaws.com/v1
```

### Authentication
All endpoints require an API key passed in the `X-API-Key` header.

### Endpoints

#### 1. Register Device
Register a new iOS device for push notifications.

**Endpoint:** `POST /devices`

**Headers:**
- `Content-Type: application/json`
- `X-API-Key: {your-api-key}`

**Request Body:**
```json
{
  "deviceToken": "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  "userId": "user123",
  "bundleId": "com.example.spendmonitor"
}
```

**Response (201 Created):**
```json
{
  "success": true,
  "platformEndpointArn": "arn:aws:sns:us-east-1:123456789012:endpoint/APNS_SANDBOX/SpendMonitorAPNS/12345678-1234-1234-1234-123456789012",
  "registrationDate": "2023-12-01T10:00:00.000Z"
}
```

**Response (400 Bad Request):**
```json
{
  "error": "Invalid device token format (must be 64-character hex string)"
}
```

#### 2. Update Device Token
Update an existing device token (e.g., when the app is reinstalled).

**Endpoint:** `PUT /devices`

**Headers:**
- `Content-Type: application/json`
- `X-API-Key: {your-api-key}`

**Request Body:**
```json
{
  "currentToken": "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
  "newToken": "abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
  "userId": "user123"
}
```

**Response (200 OK):**
```json
{
  "success": true,
  "platformEndpointArn": "arn:aws:sns:us-east-1:123456789012:endpoint/APNS_SANDBOX/SpendMonitorAPNS/12345678-1234-1234-1234-123456789012",
  "lastUpdated": "2023-12-01T10:30:00.000Z"
}
```

**Response (404 Not Found):**
```json
{
  "error": "Device not found"
}
```

#### 3. List User Devices
List all registered devices for a specific user.

**Endpoint:** `GET /devices?userId={userId}&limit={limit}&nextToken={token}`

**Headers:**
- `X-API-Key: {your-api-key}`

**Query Parameters:**
- `userId` (required): User identifier
- `limit` (optional): Maximum number of devices to return (default: 10)
- `nextToken` (optional): Pagination token for next page

**Response (200 OK):**
```json
{
  "success": true,
  "devices": [
    {
      "deviceToken": "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef",
      "platformEndpointArn": "arn:aws:sns:us-east-1:123456789012:endpoint/APNS_SANDBOX/SpendMonitorAPNS/12345678-1234-1234-1234-123456789012",
      "userId": "user123",
      "registrationDate": "2023-12-01T10:00:00.000Z",
      "lastUpdated": "2023-12-01T10:00:00.000Z",
      "active": true
    }
  ],
  "nextToken": "eyJkZXZpY2VUb2tlbiI6eyJTIjoiMTIzNDU2Nzg5MGFiY2RlZiJ9fQ=="
}
```

#### 4. Delete Device Registration
Remove a device registration and stop push notifications.

**Endpoint:** `DELETE /devices/{deviceToken}`

**Headers:**
- `X-API-Key: {your-api-key}`

**Path Parameters:**
- `deviceToken`: The device token to delete (URL-encoded)

**Response (200 OK):**
```json
{
  "success": true,
  "deletedAt": "2023-12-01T11:00:00.000Z"
}
```

**Response (404 Not Found):**
```json
{
  "error": "Device not found"
}
```

## Error Responses

All error responses include CORS headers and follow this format:

```json
{
  "error": "Error description",
  "message": "Additional error details (optional)"
}
```

### Common HTTP Status Codes
- `200 OK`: Request successful
- `201 Created`: Device registered successfully
- `400 Bad Request`: Invalid request data
- `404 Not Found`: Resource not found
- `500 Internal Server Error`: Server error

## Device Token Format

Device tokens must be 64-character hexadecimal strings (APNS device tokens). Example:
```
1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
```

## Rate Limiting

The API includes rate limiting:
- **Rate Limit:** 100 requests per second
- **Burst Limit:** 200 requests
- **Daily Quota:** 10,000 requests per API key

## CORS Support

The API supports Cross-Origin Resource Sharing (CORS) with the following configuration:
- **Allowed Origins:** `*` (all origins)
- **Allowed Methods:** `GET, POST, PUT, DELETE, OPTIONS`
- **Allowed Headers:** `Content-Type, X-Amz-Date, Authorization, X-Api-Key, X-Amz-Security-Token`

## iOS Integration Example

### Swift Code Example

```swift
import Foundation

class SpendMonitorAPI {
    private let baseURL = "https://your-api-id.execute-api.us-east-1.amazonaws.com/v1"
    private let apiKey = "your-api-key"
    
    func registerDevice(deviceToken: String, userId: String) async throws {
        let url = URL(string: "\(baseURL)/devices")!
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(apiKey, forHTTPHeaderField: "X-API-Key")
        
        let body = [
            "deviceToken": deviceToken,
            "userId": userId,
            "bundleId": Bundle.main.bundleIdentifier ?? ""
        ]
        
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (data, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 201 else {
            throw APIError.registrationFailed
        }
        
        // Handle successful registration
        let result = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        print("Device registered: \(result?["platformEndpointArn"] ?? "")")
    }
    
    func updateDeviceToken(currentToken: String, newToken: String, userId: String) async throws {
        let url = URL(string: "\(baseURL)/devices")!
        var request = URLRequest(url: url)
        request.httpMethod = "PUT"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(apiKey, forHTTPHeaderField: "X-API-Key")
        
        let body = [
            "currentToken": currentToken,
            "newToken": newToken,
            "userId": userId
        ]
        
        request.httpBody = try JSONSerialization.data(withJSONObject: body)
        
        let (_, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.updateFailed
        }
    }
    
    func deleteDevice(deviceToken: String) async throws {
        let encodedToken = deviceToken.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? ""
        let url = URL(string: "\(baseURL)/devices/\(encodedToken)")!
        var request = URLRequest(url: url)
        request.httpMethod = "DELETE"
        request.setValue(apiKey, forHTTPHeaderField: "X-API-Key")
        
        let (_, response) = try await URLSession.shared.data(for: request)
        
        guard let httpResponse = response as? HTTPURLResponse,
              httpResponse.statusCode == 200 else {
            throw APIError.deleteFailed
        }
    }
}

enum APIError: Error {
    case registrationFailed
    case updateFailed
    case deleteFailed
}
```

### Handling Push Notifications

```swift
import UserNotifications

class NotificationHandler: NSObject, UNUserNotificationCenterDelegate {
    
    func userNotificationCenter(_ center: UNUserNotificationCenter, 
                              didReceive response: UNNotificationResponse, 
                              withCompletionHandler completionHandler: @escaping () -> Void) {
        
        let userInfo = response.notification.request.content.userInfo
        
        if let customData = userInfo["customData"] as? [String: Any],
           let spendAmount = customData["spendAmount"] as? Double,
           let threshold = customData["threshold"] as? Double {
            
            // Handle spend alert notification
            print("Spend alert: $\(spendAmount) exceeds threshold of $\(threshold)")
            
            // Navigate to spending details or show alert
            showSpendingAlert(amount: spendAmount, threshold: threshold)
        }
        
        completionHandler()
    }
    
    private func showSpendingAlert(amount: Double, threshold: Double) {
        // Show spending alert UI
        DispatchQueue.main.async {
            // Update UI with spending information
        }
    }
}
```

## Deployment

The Device Registration API is deployed as part of the AWS Spend Monitor infrastructure. To deploy:

1. Ensure you have valid APNS certificates configured
2. Deploy the CDK stack:
   ```bash
   cdk deploy --context apnsCertificate="$(cat apns-cert.pem)" --context apnsPrivateKey="$(cat apns-key.pem)"
   ```
3. Note the API Gateway URL and API Key from the stack outputs
4. Configure your iOS app with the API URL and key

## Monitoring

The API includes CloudWatch monitoring for:
- Request count and latency
- Error rates and types
- DynamoDB read/write metrics
- SNS endpoint creation/deletion metrics

## Security Considerations

1. **API Key Management**: Store API keys securely in your iOS app
2. **Device Token Validation**: All device tokens are validated for format
3. **Rate Limiting**: API includes rate limiting to prevent abuse
4. **CORS Configuration**: Configured for web and mobile app access
5. **IAM Permissions**: Lambda functions have minimal required permissions
6. **Data Encryption**: All data is encrypted in transit and at rest

## Troubleshooting

### Common Issues

1. **Invalid Device Token Format**
   - Ensure device token is exactly 64 hexadecimal characters
   - Remove any spaces or special characters

2. **APNS Certificate Issues**
   - Verify certificate is valid and not expired
   - Ensure certificate matches the bundle ID
   - Check sandbox vs production environment

3. **API Key Issues**
   - Verify API key is included in X-API-Key header
   - Check that API key is associated with the usage plan

4. **Rate Limiting**
   - Implement exponential backoff for retries
   - Monitor usage against daily quota

### Logs and Debugging

- CloudWatch Logs: `/aws/lambda/device-registration-function`
- API Gateway Logs: Available in CloudWatch under API Gateway
- DynamoDB Metrics: Available in CloudWatch under DynamoDB
- SNS Metrics: Available in CloudWatch under SNS

For additional support, check the CloudWatch dashboard created with the infrastructure deployment.