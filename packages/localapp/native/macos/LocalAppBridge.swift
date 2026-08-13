import AppKit
import CoreServices
import Foundation
import UserNotifications

private let bridgeConfigPreference = "LocalAppBridgeConfigPath"
private let notificationEnvelopeLimit = 8 * 1024
private let activationURLLimit = 4096
private let notificationKeys = Set(["identifier", "ticket", "productLabel", "applicationLabel", "sourceLabel", "title", "body", "priority", "iconPath"])

private func bridgeBundle() -> Bundle {
  if Bundle.main.bundleIdentifier != nil { return Bundle.main }
  let executable = URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL
  let application = executable.deletingLastPathComponent().deletingLastPathComponent().deletingLastPathComponent()
  return Bundle(url: application) ?? Bundle.main
}

private func bridgePreferenceValue() -> String? {
  guard let identifier = bridgeBundle().bundleIdentifier else { return nil }
  return CFPreferencesCopyAppValue(bridgeConfigPreference as CFString, identifier as CFString) as? String
}

private func setBridgePreferenceValue(_ value: String?) -> Bool {
  guard let identifier = bridgeBundle().bundleIdentifier else { return false }
  CFPreferencesSetAppValue(bridgeConfigPreference as CFString, value as CFPropertyList?, identifier as CFString)
  return CFPreferencesAppSynchronize(identifier as CFString)
}

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

private func safePlainText(_ value: String) -> Bool {
  return !value.unicodeScalars.contains { scalar in
    CharacterSet.controlCharacters.contains(scalar) || scalar == "<" || scalar == ">"
  }
}

private func safeLabel(_ value: String) -> Bool {
  return !value.isEmpty && value.count <= 128 && safePlainText(value)
}

private func regularLocalFile(_ value: String) -> Bool {
  guard safeAbsolutePath(value),
        let attributes = try? FileManager.default.attributesOfItem(atPath: value),
        attributes[.type] as? FileAttributeType == .typeRegular
  else { return false }
  return true
}

private func defaultBridgeConfigurationURL() -> URL {
  return FileManager.default.homeDirectoryForCurrentUser
    .appendingPathComponent("Library/Application Support/LocalApp/native-bridge.json")
}

private func bridgeConfigurationURL() -> URL? {
  if let configured = bridgePreferenceValue(), safeAbsolutePath(configured) {
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
  func applicationWillFinishLaunching(_ notification: Notification) {
    NSAppleEventManager.shared().setEventHandler(
      self,
      andSelector: #selector(handleGetURLEvent(_:withReplyEvent:)),
      forEventClass: AEEventClass(kInternetEventClass),
      andEventID: AEEventID(kAEGetURL)
    )
  }

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

  func applicationWillTerminate(_ notification: Notification) {
    NSAppleEventManager.shared().removeEventHandler(
      forEventClass: AEEventClass(kInternetEventClass),
      andEventID: AEEventID(kAEGetURL)
    )
  }

  @objc private func handleGetURLEvent(_ event: NSAppleEventDescriptor, withReplyEvent reply: NSAppleEventDescriptor) {
    if let value = event.paramDescriptor(forKeyword: AEKeyword(keyDirectObject))?.stringValue,
       value.hasPrefix("localapp://") {
      _ = forward(value)
    }
    DispatchQueue.main.async { NSApp.terminate(nil) }
  }

  private func forward(_ url: String) -> Bool {
    return forwardScheme(url)
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
    if let ticket = response.notification.request.content.userInfo["localappTicket"] as? String, validTicket(ticket) {
      _ = forward(notificationActivationURL(ticket)!)
    }
    completionHandler()
  }
}

private func forwardScheme(_ url: String) -> Bool {
  guard url.hasPrefix("localapp://"), url.lengthOfBytes(using: .utf8) <= activationURLLimit,
        let configuration = loadBridgeConfiguration() else {
    reportFailure("Scheme bridge configuration is unavailable")
    return false
  }
  return forwardScheme(url, configuration: configuration)
}

private func forwardScheme(_ url: String, configuration: BridgeConfiguration) -> Bool {
  guard url.hasPrefix("localapp://"), url.lengthOfBytes(using: .utf8) <= activationURLLimit else { return false }
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

private func validTicket(_ ticket: String) -> Bool {
  return ticket.range(of: "^[A-Za-z0-9_-]{16,256}$", options: .regularExpression) != nil
}

private func notificationActivationURL(_ ticket: String) -> String? {
  return validTicket(ticket) ? "localapp://notification/open?ticket=\(ticket)" : nil
}

private func bridgeBundleURL() -> CFURL { bridgeBundle().bundleURL as CFURL }

private func unregisterExactBundle() -> Bool {
  let task = Process()
  task.executableURL = URL(fileURLWithPath: "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister")
  task.arguments = ["-u", bridgeBundle().bundlePath]
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
  UNUserNotificationCenter.current().requestAuthorization(options: [.alert]) { granted, error in
    result = error == nil ? (granted ? "granted" : "denied") : nil
    completed.signal()
  }
  guard completed.wait(timeout: .now() + 10) == .success else { return nil }
  return result
}

private struct NotificationEnvelope {
  let identifier: String
  let ticket: String
  let productLabel: String
  let applicationLabel: String
  let sourceLabel: String
  let title: String
  let body: String
  let priority: String
  let iconPath: String
}

private func parseNotificationEnvelope(_ rawEnvelope: String) -> NotificationEnvelope? {
  guard rawEnvelope.lengthOfBytes(using: .utf8) <= notificationEnvelopeLimit,
        let object = parseExactStringObject(rawEnvelope), Set(object.keys) == notificationKeys,
        let identifier = object["identifier"], validTicket(identifier),
        let ticket = object["ticket"], validTicket(ticket),
        object["productLabel"] == "LocalApp",
        let applicationLabel = object["applicationLabel"], safeLabel(applicationLabel),
        let sourceLabel = object["sourceLabel"], safeLabel(sourceLabel),
        let title = object["title"], !title.isEmpty, safePlainText(title),
        let body = object["body"], safePlainText(body),
        let priority = object["priority"], priority == "normal" || priority == "high",
        let iconPath = object["iconPath"], regularLocalFile(iconPath)
  else { return nil }
  return NotificationEnvelope(
    identifier: identifier,
    ticket: ticket,
    productLabel: "LocalApp",
    applicationLabel: applicationLabel,
    sourceLabel: sourceLabel,
    title: title,
    body: body,
    priority: priority,
    iconPath: iconPath
  )
}

private func stageNotificationAttachment(_ iconPath: String) -> (directory: URL, file: URL)? {
  let sourceURL = URL(fileURLWithPath: iconPath)
  let stagedDirectory = FileManager.default.temporaryDirectory
    .appendingPathComponent("localapp-notification-\(UUID().uuidString)", isDirectory: true)
  let extensionSuffix = sourceURL.pathExtension.isEmpty ? "" : ".\(sourceURL.pathExtension)"
  let stagedURL = stagedDirectory.appendingPathComponent("icon\(extensionSuffix)")
  do {
    try FileManager.default.createDirectory(at: stagedDirectory, withIntermediateDirectories: false)
    try FileManager.default.copyItem(at: sourceURL, to: stagedURL)
    return (stagedDirectory, stagedURL)
  } catch let error as NSError {
    reportFailure("could not stage the notification attachment [\(error.domain):\(error.code)]")
    try? FileManager.default.removeItem(at: stagedDirectory)
    return nil
  }
}

private func showNotification(_ rawEnvelope: String) -> Bool {
  guard let envelope = parseNotificationEnvelope(rawEnvelope),
        let stagedAttachment = stageNotificationAttachment(envelope.iconPath)
  else { return false }
  let stagedDirectory = stagedAttachment.directory
  let stagedURL = stagedAttachment.file
  defer { try? FileManager.default.removeItem(at: stagedDirectory) }

  let content = UNMutableNotificationContent()
  content.title = envelope.title
  content.subtitle = "\(envelope.applicationLabel) · \(envelope.sourceLabel)"
  content.body = envelope.body
  content.userInfo = ["localappTicket": envelope.ticket]
  guard let attachment = try? UNNotificationAttachment(identifier: "localapp-icon", url: stagedURL) else {
    reportFailure("could not create the notification attachment")
    return false
  }
  content.attachments = [attachment]
  let completed = DispatchSemaphore(value: 0)
  var accepted = false
  UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: envelope.identifier, content: content, trigger: nil)) { error in
    if let error = error as NSError? {
      reportFailure("notification center rejected the request [\(error.domain):\(error.code)]")
    }
    accepted = error == nil
    completed.signal()
  }
  return completed.wait(timeout: .now() + 10) == .success && accepted
}

private func parseExactStringObject(_ raw: String) -> [String: String]? {
  let bytes = Array(raw.utf8)
  var index = 0
  func skipWhitespace() {
    while index < bytes.count && [9, 10, 13, 32].contains(bytes[index]) { index += 1 }
  }
  func stringToken() -> String? {
    guard index < bytes.count, bytes[index] == 34 else { return nil }
    let start = index
    index += 1
    var escaped = false
    while index < bytes.count {
      let byte = bytes[index]
      index += 1
      if escaped { escaped = false; continue }
      if byte == 92 { escaped = true; continue }
      if byte == 34 {
        let token = Data(bytes[start..<index])
        guard let decoded = try? JSONSerialization.jsonObject(with: Data("[".utf8) + token + Data("]".utf8)) as? [String], decoded.count == 1 else { return nil }
        return decoded[0]
      }
      if byte < 32 { return nil }
    }
    return nil
  }

  skipWhitespace()
  guard index < bytes.count, bytes[index] == 123 else { return nil }
  index += 1
  var result: [String: String] = [:]
  skipWhitespace()
  if index < bytes.count, bytes[index] == 125 { index += 1; skipWhitespace(); return index == bytes.count ? result : nil }
  while index < bytes.count {
    skipWhitespace()
    guard let key = stringToken(), result[key] == nil else { return nil }
    skipWhitespace()
    guard index < bytes.count, bytes[index] == 58 else { return nil }
    index += 1
    skipWhitespace()
    guard let value = stringToken() else { return nil }
    result[key] = value
    skipWhitespace()
    guard index < bytes.count else { return nil }
    if bytes[index] == 125 { index += 1; skipWhitespace(); return index == bytes.count ? result : nil }
    guard bytes[index] == 44 else { return nil }
    index += 1
  }
  return nil
}

private func registerBridge(configPath: String) -> Bool {
  guard safeAbsolutePath(configPath), loadConfiguration(at: configPath) != nil else { return false }
  guard setBridgePreferenceValue(configPath) else { return false }
  guard LSRegisterURL(bridgeBundleURL(), true) == noErr else { return false }
  if #available(macOS 12.0, *) {
    let completed = DispatchSemaphore(value: 0)
    var succeeded = false
    NSWorkspace.shared.setDefaultApplication(at: bridgeBundle().bundleURL, toOpenURLsWithScheme: "localapp") { error in
      succeeded = error == nil
      completed.signal()
    }
    return completed.wait(timeout: .now() + 5) == .success && succeeded
  }
  guard let identifier = bridgeBundle().bundleIdentifier else { return false }
  return LSSetDefaultHandlerForURLScheme("localapp" as CFString, identifier as CFString) == noErr
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
    _ = setBridgePreferenceValue(nil)
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
  case "--scheme":
    guard arguments.count == 4, arguments[1] == "--config", let configuration = loadConfiguration(at: arguments[2]) else { return false }
    return forwardScheme(arguments[3], configuration: configuration)
  case "--validate-notification":
    return arguments.count == 2 && parseNotificationEnvelope(arguments[1]) != nil
  case "--notification-activation-ticket":
    guard arguments.count == 2, let url = notificationActivationURL(arguments[1]) else { return false }
    return forwardScheme(url)
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
let commandLineActivations = arguments.filter { $0.hasPrefix("localapp://") }
if !commandLineActivations.isEmpty {
  let succeeded = commandLineActivations.allSatisfy { forwardScheme($0) }
  if !succeeded { reportFailure("Scheme activation failed") }
  exit(succeeded ? 0 : 1)
}
let app = NSApplication.shared
let delegate = LocalAppBridge()
app.delegate = delegate
app.run()
