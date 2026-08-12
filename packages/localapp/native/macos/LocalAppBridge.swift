import AppKit
import CoreServices
import Foundation
import UserNotifications

final class LocalAppBridge: NSObject, NSApplicationDelegate, UNUserNotificationCenterDelegate {
  private let environment: [String: String]

  override init() {
    var configured = ProcessInfo.processInfo.environment
    if let config = Bundle.main.url(forResource: "runtime-configuration", withExtension: "json"),
       let data = try? Data(contentsOf: config),
       let value = try? JSONSerialization.jsonObject(with: data) as? [String: String] {
      for (key, item) in value where key == "LOCALAPP_RUNTIME_DIR" || key == "LOCALAPP_SUPPORT_DIR" || key == "LOCALAPP_DATA_DIR" {
        configured[key] = item
      }
    }
    environment = configured
    super.init()
  }

  func applicationDidFinishLaunching(_ notification: Notification) {
    NSApp.setActivationPolicy(.prohibited)
    UNUserNotificationCenter.current().delegate = self
    for argument in CommandLine.arguments.dropFirst() where argument.hasPrefix("localapp://") { forward(argument) }
  }

  func application(_ application: NSApplication, open urls: [URL]) {
    for url in urls where url.scheme == "localapp" { forward(url.absoluteString) }
    DispatchQueue.main.async { NSApp.terminate(nil) }
  }

  private func forward(_ url: String) {
    guard let script = Bundle.main.url(forResource: "localapp-native-ipc-client", withExtension: "mjs") else { return }
    let task = Process()
    task.executableURL = URL(fileURLWithPath: "/usr/bin/env")
    task.arguments = ["node", script.path, url]
    task.environment = environment
    task.standardOutput = FileHandle.nullDevice
    task.standardError = FileHandle.nullDevice
    try? task.run()
  }

  func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse, withCompletionHandler completionHandler: @escaping () -> Void) {
    if let ticket = response.notification.request.content.userInfo["localappTicket"] as? String {
      forward("localapp://notification/open?ticket=\(ticket)")
    }
    completionHandler()
  }
}

func bridgeBundleURL() -> CFURL { Bundle.main.bundleURL as CFURL }

func unregisterExactBundle() -> Bool {
  let task = Process()
  task.executableURL = URL(fileURLWithPath: "/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister")
  task.arguments = ["-u", Bundle.main.bundlePath]
  task.standardOutput = FileHandle.nullDevice
  task.standardError = FileHandle.nullDevice
  do {
    try task.run()
    task.waitUntilExit()
    return task.terminationStatus == 0
  } catch { return false }
}

func runCommand() -> Bool {
  let arguments = CommandLine.arguments
  if arguments.contains("--register") { return LSRegisterURL(bridgeBundleURL(), true) == noErr }
  if arguments.contains("--unregister") { return unregisterExactBundle() }
  if let index = arguments.firstIndex(of: "--open-url"), arguments.count == index + 2,
     let url = URL(string: arguments[index + 1]), ["http", "https"].contains(url.scheme?.lowercased() ?? "") {
    return NSWorkspace.shared.open(url)
  }
  if arguments.contains("--permission-state") { print("unknown"); return true }
  if arguments.contains("--request-permission") {
    UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { granted, _ in print(granted ? "granted" : "denied") }
    RunLoop.current.run(until: Date(timeIntervalSinceNow: 1))
    return true
  }
  return false
}

let commandArguments = Set(CommandLine.arguments.dropFirst())
if !commandArguments.isDisjoint(with: ["--register", "--unregister", "--open-url", "--permission-state", "--request-permission"]) {
  exit(runCommand() ? 0 : 1)
}
let app = NSApplication.shared
let delegate = LocalAppBridge()
app.delegate = delegate
app.run()
