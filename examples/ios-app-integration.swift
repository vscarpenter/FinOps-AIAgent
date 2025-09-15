/**
 * iOS App Integration Examples for AWS Spend Monitor
 * 
 * This file contains Swift code examples for integrating iOS apps
 * with the AWS Spend Monitor push notification system.
 */

import UIKit
import UserNotifications
import Foundation

// MARK: - Configuration

struct SpendMonitorConfig {
    static let apiBaseURL = "https://your-api-gateway-url.amazonaws.com/prod"
    static let bundleId = Bundle.main.bundleIdentifier ?? "com.example.aws-spend-monitor"
    static let deviceRegistrationEndpoint = "\(apiBaseURL)/devices"
    static let notificationTestEndpoint = "\(apiBaseURL)/test-notification"
}

// MARK: - Data Models

struct DeviceRegistrationRequest: Codable {
    let deviceToken: String
    let bundleId: String
    let userId: String?
    let platform: String = "ios"
    let appVersion: String?
    let osVersion: String
    
    init(deviceToken: String, userId: String? = nil) {
        self.deviceToken = deviceToken
        self.bundleId = SpendMonitorConfig.bundleId
        self.userId = userId
        self.appVersion = Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String
        self.osVersion = UIDevice.current.systemVersion
    }
}

struct DeviceRegistrationResponse: Codable {
    let success: Bool
    let endpointArn: String?
    let message: String?
    let deviceToken: String?
}

struct SpendAlert: Codable {
    let currentSpend: Double
    let threshold: Double
    let exceedAmount: Double
    let topServices: [ServiceCost]
    let alertLevel: String
    let timestamp: String
}

struct ServiceCost: Codable {
    let serviceName: String
    let cost: Double
    let percentage: Double
}

// MARK: - Notification Manager

class SpendMonitorNotificationManager: NSObject {
    
    static let shared = SpendMonitorNotificationManager()
    
    private var currentDeviceToken: String?
    private var isRegistered = false
    
    private override init() {
        super.init()
    }
    
    // MARK: - Setup and Registration
    
    /**
     * Request notification permissions and register for remote notifications
     */
    func setupNotifications() {
        UNUserNotificationCenter.current().delegate = self
        
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { [weak self] granted, error in
            if let error = error {
                print("❌ Notification permission error: \(error.localizedDescription)")
                return
            }
            
            if granted {
                print("✅ Notification permissions granted")
                DispatchQueue.main.async {
                    UIApplication.shared.registerForRemoteNotifications()
                }
            } else {
                print("❌ Notification permissions denied")
                self?.handlePermissionDenied()
            }
        }
    }
    
    /**
     * Handle successful device token registration
     */
    func didRegisterForRemoteNotifications(with deviceToken: Data) {
        let tokenString = deviceToken.map { String(format: "%02.2hhx", $0) }.joined()
        
        print("📱 Device token received: \(tokenString.prefix(16))...")
        print("📱 Token length: \(tokenString.count)")
        
        // Validate token format
        guard isValidDeviceToken(tokenString) else {
            print("❌ Invalid device token format")
            return
        }
        
        // Check if token changed
        if currentDeviceToken != tokenString {
            print("🔄 Device token changed, updating registration...")
            currentDeviceToken = tokenString
            registerDeviceToken(tokenString)
        } else {
            print("✅ Device token unchanged")
        }
    }
    
    /**
     * Handle device token registration failure
     */
    func didFailToRegisterForRemoteNotifications(with error: Error) {
        print("❌ Failed to register for remote notifications: \(error.localizedDescription)")
        
        // Handle specific error cases
        if let nsError = error as NSError? {
            switch nsError.code {
            case 3010: // APNs is not available (simulator)
                print("💡 Running on simulator - push notifications not available")
            case 3000: // No valid signing identity
                print("💡 Check code signing and provisioning profile")
            default:
                print("💡 Error code: \(nsError.code)")
            }
        }
    }
    
    // MARK: - Device Registration
    
    /**
     * Register device token with the spend monitor backend
     */
    private func registerDeviceToken(_ token: String, userId: String? = nil) {
        let request = DeviceRegistrationRequest(deviceToken: token, userId: userId)
        
        guard let url = URL(string: SpendMonitorConfig.deviceRegistrationEndpoint) else {
            print("❌ Invalid registration URL")
            return
        }
        
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        do {
            urlRequest.httpBody = try JSONEncoder().encode(request)
        } catch {
            print("❌ Failed to encode registration request: \(error)")
            return
        }
        
        print("📤 Registering device token...")
        
        URLSession.shared.dataTask(with: urlRequest) { [weak self] data, response, error in
            DispatchQueue.main.async {
                self?.handleRegistrationResponse(data: data, response: response, error: error)
            }
        }.resume()
    }
    
    /**
     * Handle device registration response
     */
    private func handleRegistrationResponse(data: Data?, response: URLResponse?, error: Error?) {
        if let error = error {
            print("❌ Registration request failed: \(error.localizedDescription)")
            scheduleRetryRegistration()
            return
        }
        
        guard let httpResponse = response as? HTTPURLResponse else {
            print("❌ Invalid response type")
            return
        }
        
        print("📥 Registration response: HTTP \(httpResponse.statusCode)")
        
        guard let data = data else {
            print("❌ No response data")
            return
        }
        
        do {
            let registrationResponse = try JSONDecoder().decode(DeviceRegistrationResponse.self, from: data)
            
            if registrationResponse.success {
                print("✅ Device registration successful")
                if let endpointArn = registrationResponse.endpointArn {
                    print("📍 Endpoint ARN: \(endpointArn)")
                }
                isRegistered = true
                UserDefaults.standard.set(true, forKey: "SpendMonitorRegistered")
                UserDefaults.standard.set(currentDeviceToken, forKey: "SpendMonitorDeviceToken")
            } else {
                print("❌ Device registration failed: \(registrationResponse.message ?? "Unknown error")")
                scheduleRetryRegistration()
            }
            
        } catch {
            print("❌ Failed to decode registration response: \(error)")
            
            // Try to parse as plain text for debugging
            if let responseString = String(data: data, encoding: .utf8) {
                print("📄 Raw response: \(responseString)")
            }
            
            scheduleRetryRegistration()
        }
    }
    
    /**
     * Schedule retry for failed registration
     */
    private func scheduleRetryRegistration() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
            guard let self = self, let token = self.currentDeviceToken else { return }
            print("🔄 Retrying device registration...")
            self.registerDeviceToken(token)
        }
    }
    
    // MARK: - Notification Handling
    
    /**
     * Handle received push notification when app is in foreground
     */
    func handleForegroundNotification(_ notification: UNNotification) -> UNNotificationPresentationOptions {
        let userInfo = notification.request.content.userInfo
        
        print("📨 Received foreground notification:")
        print("   Title: \(notification.request.content.title)")
        print("   Body: \(notification.request.content.body)")
        
        // Check if it's a spend alert
        if let customData = userInfo["customData"] as? [String: Any],
           let alertType = customData["type"] as? String,
           alertType == "spend-alert" {
            
            handleSpendAlert(from: userInfo)
            
            // Show notification with sound and badge
            return [.alert, .sound, .badge]
        }
        
        // Default presentation for other notifications
        return [.alert, .sound]
    }
    
    /**
     * Handle notification tap when app is in background
     */
    func handleNotificationTap(_ response: UNNotificationResponse) {
        let userInfo = response.notification.request.content.userInfo
        
        print("👆 User tapped notification:")
        print("   Action: \(response.actionIdentifier)")
        
        // Check if it's a spend alert
        if let customData = userInfo["customData"] as? [String: Any],
           let alertType = customData["type"] as? String,
           alertType == "spend-alert" {
            
            handleSpendAlert(from: userInfo)
            
            // Navigate to spend monitoring screen
            navigateToSpendMonitoring()
        }
    }
    
    /**
     * Parse and handle spend alert data
     */
    private func handleSpendAlert(from userInfo: [AnyHashable: Any]) {
        guard let customData = userInfo["customData"] as? [String: Any] else {
            print("❌ No custom data in spend alert")
            return
        }
        
        let currentSpend = customData["spendAmount"] as? Double ?? 0
        let threshold = customData["threshold"] as? Double ?? 0
        let exceedAmount = customData["exceedAmount"] as? Double ?? 0
        let topService = customData["topService"] as? String ?? "Unknown"
        
        print("💰 Spend Alert Details:")
        print("   Current Spend: $\(String(format: "%.2f", currentSpend))")
        print("   Threshold: $\(String(format: "%.2f", threshold))")
        print("   Exceed Amount: $\(String(format: "%.2f", exceedAmount))")
        print("   Top Service: \(topService)")
        
        // Update app badge with exceed amount
        let badgeCount = max(1, Int(exceedAmount))
        UIApplication.shared.applicationIconBadgeNumber = badgeCount
        
        // Store alert for display in app
        storeSpendAlert(currentSpend: currentSpend, threshold: threshold, exceedAmount: exceedAmount, topService: topService)
        
        // Post notification for app to update UI
        NotificationCenter.default.post(name: .spendAlertReceived, object: nil, userInfo: userInfo)
    }
    
    // MARK: - Utility Methods
    
    /**
     * Validate device token format
     */
    private func isValidDeviceToken(_ token: String) -> Bool {
        return token.count == 64 && token.range(of: "^[0-9a-fA-F]+$", options: .regularExpression) != nil
    }
    
    /**
     * Handle permission denied scenario
     */
    private func handlePermissionDenied() {
        // Show alert to user about enabling notifications in Settings
        DispatchQueue.main.async {
            let alert = UIAlertController(
                title: "Notifications Disabled",
                message: "To receive spend alerts, please enable notifications in Settings > Notifications > AWS Spend Monitor",
                preferredStyle: .alert
            )
            
            alert.addAction(UIAlertAction(title: "Settings", style: .default) { _ in
                if let settingsURL = URL(string: UIApplication.openSettingsURLString) {
                    UIApplication.shared.open(settingsURL)
                }
            })
            
            alert.addAction(UIAlertAction(title: "Cancel", style: .cancel))
            
            if let topViewController = UIApplication.shared.windows.first?.rootViewController {
                topViewController.present(alert, animated: true)
            }
        }
    }
    
    /**
     * Navigate to spend monitoring screen
     */
    private func navigateToSpendMonitoring() {
        // Implement navigation to your spend monitoring view controller
        NotificationCenter.default.post(name: .navigateToSpendMonitoring, object: nil)
    }
    
    /**
     * Store spend alert data locally
     */
    private func storeSpendAlert(currentSpend: Double, threshold: Double, exceedAmount: Double, topService: String) {
        let alertData: [String: Any] = [
            "currentSpend": currentSpend,
            "threshold": threshold,
            "exceedAmount": exceedAmount,
            "topService": topService,
            "timestamp": Date().timeIntervalSince1970
        ]
        
        UserDefaults.standard.set(alertData, forKey: "LastSpendAlert")
    }
    
    /**
     * Get stored spend alert data
     */
    func getLastSpendAlert() -> [String: Any]? {
        return UserDefaults.standard.dictionary(forKey: "LastSpendAlert")
    }
    
    /**
     * Clear app badge
     */
    func clearBadge() {
        UIApplication.shared.applicationIconBadgeNumber = 0
    }
    
    /**
     * Check if device is registered
     */
    func isDeviceRegistered() -> Bool {
        return isRegistered || UserDefaults.standard.bool(forKey: "SpendMonitorRegistered")
    }
    
    /**
     * Force re-registration (useful for testing)
     */
    func forceReregistration() {
        isRegistered = false
        UserDefaults.standard.removeObject(forKey: "SpendMonitorRegistered")
        UserDefaults.standard.removeObject(forKey: "SpendMonitorDeviceToken")
        
        if let token = currentDeviceToken {
            registerDeviceToken(token)
        } else {
            setupNotifications()
        }
    }
}

// MARK: - UNUserNotificationCenterDelegate

extension SpendMonitorNotificationManager: UNUserNotificationCenterDelegate {
    
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification, withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void) {
        let options = handleForegroundNotification(notification)
        completionHandler(options)
    }
    
    func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
        handleNotificationTap(response)
        completionHandler()
    }
}

// MARK: - Notification Names

extension Notification.Name {
    static let spendAlertReceived = Notification.Name("SpendAlertReceived")
    static let navigateToSpendMonitoring = Notification.Name("NavigateToSpendMonitoring")
}

// MARK: - AppDelegate Integration

/**
 * Example AppDelegate methods for integrating with the notification manager
 */
extension UIApplicationDelegate {
    
    func setupSpendMonitorNotifications() {
        SpendMonitorNotificationManager.shared.setupNotifications()
    }
    
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        SpendMonitorNotificationManager.shared.didRegisterForRemoteNotifications(with: deviceToken)
    }
    
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        SpendMonitorNotificationManager.shared.didFailToRegisterForRemoteNotifications(with: error)
    }
}

// MARK: - View Controller Integration Example

class SpendMonitorViewController: UIViewController {
    
    @IBOutlet weak var currentSpendLabel: UILabel!
    @IBOutlet weak var thresholdLabel: UILabel!
    @IBOutlet weak var statusLabel: UILabel!
    @IBOutlet weak var topServiceLabel: UILabel!
    @IBOutlet weak var registrationStatusLabel: UILabel!
    
    override func viewDidLoad() {
        super.viewDidLoad()
        setupUI()
        setupNotificationObservers()
        updateRegistrationStatus()
        loadLastSpendAlert()
    }
    
    private func setupUI() {
        title = "AWS Spend Monitor"
        navigationController?.navigationBar.prefersLargeTitles = true
    }
    
    private func setupNotificationObservers() {
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(spendAlertReceived),
            name: .spendAlertReceived,
            object: nil
        )
        
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(navigateToSpendMonitoring),
            name: .navigateToSpendMonitoring,
            object: nil
        )
    }
    
    @objc private func spendAlertReceived() {
        DispatchQueue.main.async {
            self.loadLastSpendAlert()
        }
    }
    
    @objc private func navigateToSpendMonitoring() {
        // App was opened from notification tap
        DispatchQueue.main.async {
            self.tabBarController?.selectedIndex = 0 // Navigate to spend monitoring tab
            self.loadLastSpendAlert()
        }
    }
    
    private func updateRegistrationStatus() {
        let isRegistered = SpendMonitorNotificationManager.shared.isDeviceRegistered()
        registrationStatusLabel.text = isRegistered ? "✅ Registered for notifications" : "❌ Not registered"
        registrationStatusLabel.textColor = isRegistered ? .systemGreen : .systemRed
    }
    
    private func loadLastSpendAlert() {
        guard let alertData = SpendMonitorNotificationManager.shared.getLastSpendAlert() else {
            statusLabel.text = "No recent alerts"
            return
        }
        
        let currentSpend = alertData["currentSpend"] as? Double ?? 0
        let threshold = alertData["threshold"] as? Double ?? 0
        let exceedAmount = alertData["exceedAmount"] as? Double ?? 0
        let topService = alertData["topService"] as? String ?? "Unknown"
        let timestamp = alertData["timestamp"] as? TimeInterval ?? 0
        
        currentSpendLabel.text = String(format: "$%.2f", currentSpend)
        thresholdLabel.text = String(format: "$%.2f", threshold)
        topServiceLabel.text = topService
        
        if exceedAmount > 0 {
            statusLabel.text = String(format: "⚠️ Over budget by $%.2f", exceedAmount)
            statusLabel.textColor = .systemRed
        } else {
            statusLabel.text = "✅ Within budget"
            statusLabel.textColor = .systemGreen
        }
        
        // Show timestamp
        let date = Date(timeIntervalSince1970: timestamp)
        let formatter = DateFormatter()
        formatter.dateStyle = .short
        formatter.timeStyle = .short
        navigationItem.prompt = "Last updated: \(formatter.string(from: date))"
    }
    
    @IBAction func clearBadgeTapped(_ sender: UIButton) {
        SpendMonitorNotificationManager.shared.clearBadge()
    }
    
    @IBAction func reregisterTapped(_ sender: UIButton) {
        SpendMonitorNotificationManager.shared.forceReregistration()
        
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            self.updateRegistrationStatus()
        }
    }
    
    deinit {
        NotificationCenter.default.removeObserver(self)
    }
}

// MARK: - Testing Utilities

#if DEBUG
extension SpendMonitorNotificationManager {
    
    /**
     * Send a test notification request (for development/testing)
     */
    func sendTestNotification() {
        guard let url = URL(string: SpendMonitorConfig.notificationTestEndpoint) else {
            print("❌ Invalid test notification URL")
            return
        }
        
        guard let deviceToken = currentDeviceToken else {
            print("❌ No device token available for testing")
            return
        }
        
        let testRequest: [String: Any] = [
            "deviceToken": deviceToken,
            "message": "Test notification from iOS app",
            "type": "test"
        ]
        
        var urlRequest = URLRequest(url: url)
        urlRequest.httpMethod = "POST"
        urlRequest.setValue("application/json", forHTTPHeaderField: "Content-Type")
        
        do {
            urlRequest.httpBody = try JSONSerialization.data(withJSONObject: testRequest)
        } catch {
            print("❌ Failed to encode test request: \(error)")
            return
        }
        
        print("📤 Sending test notification...")
        
        URLSession.shared.dataTask(with: urlRequest) { data, response, error in
            DispatchQueue.main.async {
                if let error = error {
                    print("❌ Test notification failed: \(error.localizedDescription)")
                } else if let httpResponse = response as? HTTPURLResponse {
                    print("📥 Test notification response: HTTP \(httpResponse.statusCode)")
                }
            }
        }.resume()
    }
}
#endif