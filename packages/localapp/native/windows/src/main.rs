//! Windows owns only URI activation, direct browser opening, and atomic Job
//! ownership. It never parses tickets, hosts LocalApp, or runs action scripts.

use localapp_native_contract::NotificationEnvelope;

const LOCALAPP_APP_USER_MODEL_ID: &str = "LocalApp.Desktop";

fn build_toast_xml(envelope: &NotificationEnvelope) -> String {
    format!(
        r#"<toast activationType="protocol" launch="{}"><visual><binding template="ToastGeneric"><image placement="appLogoOverride" src="{}"/><text>{}</text><text>{} · {}</text><text>{}</text></binding></visual><audio silent="true"/></toast>"#,
        envelope.activation_url(),
        xml_escape(&windows_file_uri(&envelope.icon_path)),
        xml_escape(&envelope.title),
        xml_escape(&envelope.application_label),
        xml_escape(&envelope.source_label),
        xml_escape(&envelope.body),
    )
}

fn xml_escape(value: &str) -> String {
    value.replace('&', "&amp;").replace('"', "&quot;").replace('\'', "&apos;").replace('<', "&lt;").replace('>', "&gt;")
}

fn windows_file_uri(value: &str) -> String {
    let normalized = value.replace('\\', "/");
    let mut encoded = String::from("file:///");
    for byte in normalized.bytes() {
        if byte.is_ascii_alphanumeric() || matches!(byte, b'/' | b':' | b'-' | b'.' | b'_' | b'~') {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    encoded
}

#[cfg(windows)]
mod platform {
    use super::{build_toast_xml, LOCALAPP_APP_USER_MODEL_ID};
    use localapp_native_contract::{NotificationEnvelope, Platform};
    use serde::Deserialize;
    use std::ffi::OsStr;
    use std::fs;
    use std::iter::once;
    use std::os::windows::ffi::OsStrExt;
    use std::path::Path;
    use std::process::Command;
    use std::ptr::null;
    use windows_sys::Win32::Foundation::{CloseHandle, HANDLE};
    use windows_sys::Win32::System::JobObjects::{AssignProcessToJobObject, CreateJobObjectW, SetInformationJobObject, JOBOBJECT_EXTENDED_LIMIT_INFORMATION, JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE, JobObjectExtendedLimitInformation};
    use windows_sys::Win32::System::Registry::{RegCloseKey, RegCreateKeyExW, RegSetValueExW, HKEY, HKEY_CURRENT_USER, KEY_WRITE, REG_OPTION_NON_VOLATILE, REG_SZ};
    use windows_sys::Win32::System::Threading::{CreateProcessW, ResumeThread, TerminateProcess, WaitForSingleObject, PROCESS_INFORMATION, STARTUPINFOW, CREATE_SUSPENDED};
    use windows_sys::Win32::UI::Shell::ShellExecuteW;
    use windows::core::{HSTRING, Interface, PCWSTR, PWSTR};
    use windows::Data::Xml::Dom::XmlDocument;
    use windows::UI::Notifications::{ToastNotification, ToastNotificationManager};
    use windows::Win32::Foundation::PROPERTYKEY;
    use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, IPersistFile, CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED};
    use windows::Win32::System::Com::StructuredStorage::{PROPVARIANT, PROPVARIANT_0, PROPVARIANT_0_0, PROPVARIANT_0_0_0};
    use windows::Win32::System::Variant::VT_LPWSTR;
    use windows::Win32::UI::Shell::{IShellLinkW, ShellLink};
    use windows::Win32::UI::Shell::PropertiesSystem::IPropertyStore;

    const WAIT_FAILED: u32 = 0xFFFF_FFFF;
    const MAX_BRIDGE_CONFIGURATION_BYTES: u64 = 8 * 1024;
    const MAX_ACTIVATION_URL_BYTES: usize = 4096;
    const APP_USER_MODEL_KEY: PROPERTYKEY = PROPERTYKEY {
        fmtid: windows::core::GUID::from_u128(0x9f4c2855_9f79_4b39_a8d0_e1d42de1d5f3),
        pid: 5,
    };

    #[derive(Deserialize)]
    struct BridgeConfiguration {
        #[serde(rename = "nodePath")]
        node_path: String,
        #[serde(rename = "ipcClientPath")]
        ipc_client_path: String,
    }

    fn wide(value: &str) -> Vec<u16> { OsStr::new(value).encode_wide().chain(once(0)).collect() }

    fn safe_absolute_path(value: &str) -> bool {
        !value.is_empty() && !value.contains('\0') && !value.contains('\r') && !value.contains('\n') && Path::new(value).is_absolute()
    }

    /// Quotes one Windows argv element according to CreateProcess parsing rules.
    /// The executable remains a separate lpApplicationName, so a spaced path
    /// cannot be reinterpreted as a different program.
    fn quote_windows_argument(value: &str) -> String {
        let mut quoted = String::from("\"");
        let mut backslashes = 0usize;
        for character in value.chars() {
            if character == '\\' {
                backslashes += 1;
            } else if character == '"' {
                quoted.push_str(&"\\".repeat(backslashes * 2 + 1));
                quoted.push('"');
                backslashes = 0;
            } else {
                quoted.push_str(&"\\".repeat(backslashes));
                quoted.push(character);
                backslashes = 0;
            }
        }
        quoted.push_str(&"\\".repeat(backslashes * 2));
        quoted.push('"');
        quoted
    }

    fn create_process_command_line(executable: &str, arguments: &[String]) -> String {
        let mut command_line = quote_windows_argument(executable);
        for argument in arguments {
            command_line.push(' ');
            command_line.push_str(&quote_windows_argument(argument));
        }
        command_line
    }

    unsafe fn cleanup_failed_setup(process: PROCESS_INFORMATION, job: HANDLE) {
        TerminateProcess(process.hProcess, 1);
        if !job.is_null() { CloseHandle(job); }
        CloseHandle(process.hThread);
        CloseHandle(process.hProcess);
    }

    /// Suspended create -> kill-on-close Job assignment -> resume. Every
    /// partial failure terminates and closes the root before it can escape.
    pub unsafe fn job_owner(executable: &str, arguments: &[String]) -> Result<(), String> {
        if !safe_absolute_path(executable) { return Err("invalid executable".into()); }
        let application_name = wide(executable);
        let mut command_line = wide(&create_process_command_line(executable, arguments));
        let mut startup: STARTUPINFOW = std::mem::zeroed();
        startup.cb = std::mem::size_of::<STARTUPINFOW>() as u32;
        let mut process: PROCESS_INFORMATION = std::mem::zeroed();
        if CreateProcessW(application_name.as_ptr(), command_line.as_mut_ptr(), null(), null(), 1, CREATE_SUSPENDED, null(), null(), &startup, &mut process) == 0 {
            return Err("suspended create failed".into());
        }
        let job: HANDLE = CreateJobObjectW(null(), null());
        if job.is_null() {
            cleanup_failed_setup(process, job);
            return Err("job create failed".into());
        }
        let mut limits: JOBOBJECT_EXTENDED_LIMIT_INFORMATION = std::mem::zeroed();
        limits.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
        if SetInformationJobObject(job, JobObjectExtendedLimitInformation, &limits as *const _ as *const _, std::mem::size_of::<JOBOBJECT_EXTENDED_LIMIT_INFORMATION>() as u32) == 0
            || AssignProcessToJobObject(job, process.hProcess) == 0 || ResumeThread(process.hThread) == u32::MAX {
            cleanup_failed_setup(process, job);
            return Err("atomic job ownership failed".into());
        }
        CloseHandle(process.hThread);
        if WaitForSingleObject(process.hProcess, u32::MAX) == WAIT_FAILED {
            TerminateProcess(process.hProcess, 1);
            CloseHandle(process.hProcess);
            CloseHandle(job);
            return Err("owned process wait failed".into());
        }
        CloseHandle(process.hProcess);
        CloseHandle(job);
        Ok(())
    }

    pub fn forward_scheme(config_path: &str, url: &str) -> Result<(), String> {
        if !safe_absolute_path(config_path) || !url.starts_with("localapp://") || url.contains('\0') || url.as_bytes().len() > MAX_ACTIVATION_URL_BYTES {
            return Err("invalid Scheme activation".into());
        }
        let metadata = fs::metadata(config_path).map_err(|_| "bridge configuration is unavailable")?;
        if metadata.len() > MAX_BRIDGE_CONFIGURATION_BYTES { return Err("bridge configuration is too large".into()); }
        let configuration: BridgeConfiguration = serde_json::from_slice(&fs::read(config_path).map_err(|_| "bridge configuration is unavailable")?)
            .map_err(|_| "bridge configuration is invalid")?;
        if !safe_absolute_path(&configuration.node_path) || !safe_absolute_path(&configuration.ipc_client_path) { return Err("bridge configuration is invalid".into()); }
        let status = Command::new(&configuration.node_path)
            .arg(&configuration.ipc_client_path)
            .arg(url)
            .status()
            .map_err(|_| "could not start the packaged IPC client")?;
        if status.success() { Ok(()) } else { Err("packaged IPC client failed".into()) }
    }

    unsafe fn create_current_user_key(path: &str) -> Result<HKEY, String> {
        let mut key: HKEY = std::ptr::null_mut();
        let path = wide(path);
        if RegCreateKeyExW(HKEY_CURRENT_USER, path.as_ptr(), 0, null(), REG_OPTION_NON_VOLATILE, KEY_WRITE, null(), &mut key, std::ptr::null_mut()) != 0 {
            return Err("current-user registry create failed".into());
        }
        Ok(key)
    }

    unsafe fn set_string_value(key: HKEY, name: Option<&str>, value: &str) -> Result<(), String> {
        let name_wide = name.map(wide);
        let value_wide = wide(value);
        let name_pointer = name_wide.as_ref().map_or(null(), |item| item.as_ptr());
        if RegSetValueExW(key, name_pointer, 0, REG_SZ, value_wide.as_ptr() as *const u8, (value_wide.len() * std::mem::size_of::<u16>()) as u32) != 0 {
            return Err("current-user registry write failed".into());
        }
        Ok(())
    }

    pub unsafe fn register_scheme(config_path: &str) -> Result<(), String> {
        if !safe_absolute_path(config_path) || fs::metadata(config_path).map_err(|_| "bridge configuration is unavailable")?.len() > MAX_BRIDGE_CONFIGURATION_BYTES {
            return Err("bridge configuration is unavailable".into());
        }
        let executable = std::env::current_exe().map_err(|_| "native executable is unavailable")?;
        let executable = executable.to_string_lossy();
        if !safe_absolute_path(&executable) { return Err("native executable is unavailable".into()); }
        let protocol = create_current_user_key("Software\\Classes\\localapp")?;
        let protocol_result = set_string_value(protocol, None, "URL:LocalApp Protocol")
            .and_then(|_| set_string_value(protocol, Some("URL Protocol"), ""));
        RegCloseKey(protocol);
        protocol_result?;
        let command_key = create_current_user_key("Software\\Classes\\localapp\\shell\\open\\command")?;
        let command = format!("{} --scheme --config {} \"%1\"", quote_windows_argument(&executable), quote_windows_argument(config_path));
        let command_result = set_string_value(command_key, None, &command);
        RegCloseKey(command_key);
        command_result?;
        register_notification_identity(&executable)
    }

    unsafe fn register_notification_identity(executable: &str) -> Result<(), String> {
        let app_data = std::env::var("APPDATA").map_err(|_| "current-user application data is unavailable")?;
        if !safe_absolute_path(&app_data) { return Err("current-user application data is invalid".into()); }
        let programs = Path::new(&app_data).join("Microsoft").join("Windows").join("Start Menu").join("Programs");
        fs::create_dir_all(&programs).map_err(|_| "current-user Programs directory is unavailable")?;
        let shortcut_path = programs.join("LocalApp.lnk");

        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().map_err(|_| "COM initialization failed")?;
        let result = (|| -> windows::core::Result<()> {
            let shell_link: IShellLinkW = CoCreateInstance(&ShellLink, None, CLSCTX_INPROC_SERVER)?;
            let executable_wide = wide(executable);
            shell_link.SetPath(PCWSTR(executable_wide.as_ptr()))?;
            shell_link.SetDescription(windows::core::w!("LocalApp"))?;
            shell_link.SetIconLocation(PCWSTR(executable_wide.as_ptr()), 0)?;

            let property_store: IPropertyStore = shell_link.cast()?;
            let mut app_id_wide = wide(LOCALAPP_APP_USER_MODEL_ID);
            let property = PROPVARIANT {
                Anonymous: PROPVARIANT_0 {
                    Anonymous: std::mem::ManuallyDrop::new(PROPVARIANT_0_0 {
                        vt: VT_LPWSTR,
                        wReserved1: 0,
                        wReserved2: 0,
                        wReserved3: 0,
                        Anonymous: PROPVARIANT_0_0_0 { pwszVal: PWSTR(app_id_wide.as_mut_ptr()) },
                    }),
                },
            };
            property_store.SetValue(&APP_USER_MODEL_KEY, &property)?;
            property_store.Commit()?;
            let persist: IPersistFile = shell_link.cast()?;
            let shortcut_wide = wide(&shortcut_path.to_string_lossy());
            persist.Save(PCWSTR(shortcut_wide.as_ptr()), true)?;
            Ok(())
        })();
        CoUninitialize();
        result.map_err(|_| "current-user notification identity registration failed".into())
    }

    pub fn notification_permission_state() -> &'static str {
        match ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(LOCALAPP_APP_USER_MODEL_ID)) {
            Ok(_) => "granted",
            Err(_) => "unsupported",
        }
    }

    pub fn show_notification(raw: &str) -> Result<(), String> {
        let envelope = NotificationEnvelope::parse(raw, Platform::Windows).map_err(|_| "invalid notification envelope")?;
        envelope.verify_icon().map_err(|_| "invalid notification icon")?;
        let document = XmlDocument::new().map_err(|_| "Windows notification runtime is unavailable")?;
        document.LoadXml(&HSTRING::from(build_toast_xml(&envelope))).map_err(|_| "Windows notification XML was rejected")?;
        let notification = ToastNotification::CreateToastNotification(&document).map_err(|_| "Windows notification runtime is unavailable")?;
        let tag = &envelope.identifier[..envelope.identifier.len().min(16)];
        notification.SetTag(&HSTRING::from(tag)).map_err(|_| "Windows notification identifier was rejected")?;
        notification.SetGroup(&HSTRING::from("LocalApp")).map_err(|_| "Windows notification group was rejected")?;
        let notifier = ToastNotificationManager::CreateToastNotifierWithId(&HSTRING::from(LOCALAPP_APP_USER_MODEL_ID))
            .map_err(|_| "Windows notification runtime is unavailable")?;
        notifier.Show(&notification).map_err(|_| "Windows notification display failed".to_string())
    }

    pub unsafe fn open_external_url(url: &str) -> Result<(), String> {
        if !(url.starts_with("https://") || url.starts_with("http://")) || url.contains('\0') { return Err("invalid browser URL".into()); }
        let wide_url = wide(url);
        // ShellExecuteW opens only the supplied HTTP(S) URL; this is not a
        // command line and does not pass through cmd.exe or Job ownership.
        if ShellExecuteW(std::ptr::null_mut(), null(), wide_url.as_ptr(), null(), null(), 1) as isize <= 32 { return Err("browser open failed".into()); }
        Ok(())
    }
}

#[cfg(windows)]
fn main() {
    let arguments = std::env::args().skip(1).collect::<Vec<_>>();
    let result = match arguments.first().map(String::as_str) {
        Some("--job-owner") if arguments.len() >= 3 && arguments[1] == "--" => unsafe { platform::job_owner(&arguments[2], &arguments[3..]) },
        Some("--register") if arguments.len() == 3 && arguments[1] == "--config" => unsafe { platform::register_scheme(&arguments[2]) },
        Some("--scheme") if arguments.len() == 4 && arguments[1] == "--config" => platform::forward_scheme(&arguments[2], &arguments[3]),
        Some("--open-url") if arguments.len() == 2 => unsafe { platform::open_external_url(&arguments[1]) },
        Some("--permission-state") if arguments.len() == 1 => { println!("{}", platform::notification_permission_state()); Ok(()) },
        Some("--request-permission") if arguments.len() == 1 => { println!("{}", platform::notification_permission_state()); Ok(()) },
        Some("--show-notification") if arguments.len() == 2 => platform::show_notification(&arguments[1]),
        Some("--validate-notification") if arguments.len() == 2 => localapp_native_contract::NotificationEnvelope::parse(&arguments[1], localapp_native_contract::Platform::Windows)
            .and_then(|envelope| envelope.verify_icon()).map_err(String::from),
        _ => Err("unsupported native command".into()),
    };
    if result.is_err() { std::process::exit(1); }
}

#[cfg(not(windows))]
fn main() { std::process::exit(1); }

#[cfg(test)]
mod notification_tests {
    use super::{build_toast_xml, LOCALAPP_APP_USER_MODEL_ID};
    use localapp_native_contract::{NotificationEnvelope, Platform};

    fn envelope() -> NotificationEnvelope {
        NotificationEnvelope::parse(
            r#"{"identifier":"notification_native_0123456789","ticket":"notification_ticket_0123456789","productLabel":"LocalApp","applicationLabel":"Interview & App","sourceLabel":"Local server","title":"Build complete","body":"The task finished","priority":"normal","iconPath":"C:\\Users\\Pat\\LocalApp\\icon.png"}"#,
            Platform::Windows,
        ).unwrap()
    }

    #[test]
    fn builds_only_a_protocol_activated_silent_current_user_toast() {
        let xml = build_toast_xml(&envelope());
        assert!(xml.contains(r#"activationType="protocol""#));
        assert!(xml.contains(r#"launch="localapp://notification/open?ticket=notification_ticket_0123456789""#));
        assert!(xml.contains("Interview &amp; App · Local server"));
        assert!(xml.contains(r#"<audio silent="true"/>"#));
        assert!(!xml.contains("cmd.exe"));
        assert!(!xml.contains("powershell"));
        assert!(!xml.contains("https://"));
        assert_eq!(LOCALAPP_APP_USER_MODEL_ID, "LocalApp.Desktop");
    }
}
