import AppKit
import CoreServices
import Foundation
import UserNotifications

private let bridgeConfigPreference = "LocalAppBridgeConfigPath"
private let notificationEnvelopeLimit = 8 * 1024

private struct BridgeConfiguration: Decodable {
  let nodePath: String
  let ipcClientPath: String
  let environment: [String: String]?
}

private func reportFailure(_ message: String) {
  FileHandle.standardError.write(Data("LocalAppBridge: \(message)\n".utf8))
}

private func safeAbsolutePath(_ value: String) -> Bool {
  return !value.isEmpty && !value.contains("\0") && !value.contains("\n") && !value.contains("\r")
    && value.hasPrefix("/") && URL(fileURLWithPath: value).standardized.path == value
}

private func defaultBridgeConfigurationURL() -> URL {
  return FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Application Support/LocalApp/native-bridge.json")
}

private func bridgeConfigurationURL() -> URL? {
  if let configured = UserDefaults.standard.string(forKey: bridgeConfigPreference), safeAbsolutePath(configured) {
    return URL(fileURLWithPath: configured)
  }
  return defaultBridgeConfigurationURL()
}

private func loadBridgeConfiguration() -> BridgeConfiguration? {
  guard let url = bridgeConfigurationURL(),
        let data = try? Data(contentsOf: url),
        let configuration = try? JSONDecoder().decode(BridgeConfiguration.self, from: data),
        safeAbsolutePath(configuration.nodePath), safeAbsolutePath(configuration.ipcClientPath)
  else { return nil }
  if let environment = configuration.environment,
     environment.keys.contains(where: { $0 != "LOCALAPP_RUNTIME_DIR" && $0 != "LOCALAPP_SUPPORT_DIR" && $0 != "LOCALAPP_DATA_DIR" }) {
    return nil
  }
  return configuration
}

final class LocalAppBridge: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.prohibited)
    UNUserNotificationCenter.current().delegate = self
    let schemeArguments = CommandLine.arguments.dropFirst().filter { $0.hasPrefix("localapp://") }
    for argument in schemeArguments { _ = forward(argument) }
    if !schemeArguments.isEmpty { DispatchQueue.main.async { NSApp.terminate(nil) } }
  }

  func application(_ application: NSApplication, open urls: [URL]) {
    for url in urls where url.scheme == "localapp" { _ = forward(url.absoluteString) }
    DispatchQueue.main.async { NSApp.terminate(nil) }
  }

  private func forward(_ url: String) -> Bool {
    guard url.hasPrefix("localapp://"), let configuration = loadBridgeConfiguration() else {
      reportFailure("Scheme bridge configuration is unavailable")
      return false
    }
    let task = Process()
    task.executableURL = URL(fileURLWithPath: configuration.nodePath)
    task.arguments = [configuration.ipcClientPath, url]
    var environment = ProcessInfo.processInfo.environment
    if let configured = configuration.environment {
      for (key, value) in configured { environment[key] = value }
    }
    task.environment = environment
    task.standardOutput = FileHandle.nullDevice
    task.standardError = FileHandle.nullDevice
    do {
      try task.run()
      return true
    } catch {
      reportFailure("could not start the packaged IPC client")
      return false
    }
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
    if let ticket = response.notification.request.content.userInfo["localappTicket"] as? String, validTicket(ticket) {
      _ = forward("localapp://notification/open?ticket=\(ticket)")
    }
    completionHandler()
  }
}

private func validTicket(_ ticket: String) -> Bool {
  return ticket.range(of: "^[A-Za-z0-9_-]{16,256}$", options: .regularExpression) != nil
}

private func bridgeBundleURL() -> CFURL { Bundle.main.bundleURL as CFURL }

private func unregisterExactBundle() -> Bool {
  let task = Process()
  task.executableURL = URL(fileURLWithPath: "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister")
  task.arguments = ["-u", Bundle.main.bundlePath]
  task.standardOutput = FileHandle.nullDevice
  task.standardError = FileHandle.nullDevice
  let completed = DispatchSemaphore(value: 0)
  task.terminationHandler = { _ in completed.signal() }
  do {
    try task.run()
    guard completed.wait(timeout: .now() + 5) == .success else { task.terminate(); return false }
    return task.terminationStatus == 0
  } catch { return false }
}

private func permissionState() -> String? {
  let completed = DispatchSemaphore(value: 0)
  var state: UNAuthorizationStatus?
  UNUserNotificationCenter.current().getNotificationSettings { settings in
    state = settings.authorizationStatus
    completed.signal()
  }
  guard completed.wait(timeout: .now() + 2) == .success, let authorization = state else { return nil }
  switch authorization {
  case .notDetermined: return "not-determined"
  case .denied: return "denied"
  case .authorized, .provisional, .ephemeral: return "granted"
  @unknown default: return "unknown"
  }
}

private func requestPermission() -> String? {
  let completed = DispatchSemaphore(value: 0)
  var result: String?
  UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, error in
    result = error == nil ? (granted ? "granted" : "denied") : nil
    completed.signal()
  }
  guard completed.wait(timeout: .now() + 10) == .success else { return nil }
  return result
}

private func showNotification(_ rawEnvelope: String) -> Bool {
  guard rawEnvelope.lengthOfBytes(using: .utf8) <= notificationEnvelopeLimit,
        let data = rawEnvelope.data(using: .utf8),
        let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
        Set(object.keys) == Set(["ticket", "title", "body", "sourceLabel", "priority", "iconPath"]),
        let ticket = object["ticket"] as? String, validTicket(ticket),
        let title = object["title"] as? String, !title.isEmpty,
        let body = object["body"] as? String,
        let sourceLabel = object["sourceLabel"] as? String, !sourceLabel.isEmpty,
        let priority = object["priority"] as? String, priority == "normal" || priority == "high",
        let iconPath = object["iconPath"] as? String, safeAbsolutePath(iconPath)
  else { return false }

  let content = UNMutableNotificationContent()
  content.title = title
  content.subtitle = sourceLabel
  content.body = body
  content.userInfo = ["localappTicket": ticket]
  content.sound = .default
  let completed = DispatchSemaphore(value: 0)
  var accepted = false
  UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: ticket, content: content, trigger: nil)) { error in
    accepted = error == nil
    completed.signal()
  }
  return completed.wait(timeout: .now() + 10) == .success && accepted
}

private func registerBridge(configPath: String) -> Bool {
  guard safeAbsolutePath(configPath), loadConfiguration(at: configPath) != nil else { return false }
  UserDefaults.standard.set(configPath, forKey: bridgeConfigPreference)
  return LSRegisterURL(bridgeBundleURL(), true) == noErr
}

private func loadConfiguration(at path: String) -> BridgeConfiguration? {
  guard let data = try? Data(contentsOf: URL(fileURLWithPath: path)),
        let configuration = try? JSONDecoder().decode(BridgeConfiguration.self, from: data),
        safeAbsolutePath(configuration.nodePath), safeAbsolutePath(configuration.ipcClientPath)
  else { return nil }
  return configuration
}

private func openExternalURL(_ raw: String) -> Bool {
  guard let url = URL(string: raw), ["http", "https"].contains(url.scheme?.lowercased() ?? ""), url.user == nil, url.password == nil, url.fragment == nil else { return false }
  return NSWorkspace.shared.open(url)
}

private func runCommand(_ arguments: [String]) -> Bool {
  guard let command = arguments.first else { return false }
  switch command {
  case "--register":
    return arguments.count == 2 && registerBridge(configPath: arguments[1])
  case "--unregister":
    guard arguments.count == 1 else { return false }
    UserDefaults.standard.removeObject(forKey: bridgeConfigPreference)
    return unregisterExactBundle()
  case "--open-url":
    return arguments.count == 2 && openExternalURL(arguments[1])
  case "--permission-state":
    guard arguments.count == 1, let state = permissionState() else { return false }
    print(state)
    return true
  case "--request-permission":
    guard arguments.count == 1, let state = requestPermission() else { return false }
    print(state)
    return true
  case "--show-notification":
    return arguments.count == 2 && showNotification(arguments[1])
  default:
    return false
  }
}

let arguments = Array(CommandLine.arguments.dropFirst())
if let first = arguments.first, first.hasPrefix("--") {
  let succeeded = runCommand(arguments)
  if !succeeded { reportFailure("command failed") }
  exit(succeeded ? 0 : 1)
}
let app = NSApplication.shared
let delegate = LocalAppBridge()
app.delegate = delegate
app.run()
