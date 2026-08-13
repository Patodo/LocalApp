use localapp_native_contract::NotificationEnvelope;

#[derive(Clone, Debug, Eq, PartialEq)]
enum ActionEvent {
    Invoked(String),
    Closed,
    Disconnected,
}

trait NotificationBackend {
    fn supports_actions(&mut self) -> Result<bool, ()>;
    fn show(&mut self, envelope: &NotificationEnvelope, actions: &[(&str, &str)], replace_id: u32) -> Result<u32, ()>;
    fn wait_for_action(&mut self, id: u32) -> Result<ActionEvent, ()>;
}

#[derive(Debug, Eq, PartialEq)]
struct DeliveryResult {
    notification_id: u32,
    actions: bool,
    activation_url: Option<String>,
}

fn deliver(
    backend: &mut impl NotificationBackend,
    envelope: &NotificationEnvelope,
    replace_id: u32,
) -> Result<DeliveryResult, ()> {
    let actions = backend.supports_actions()?;
    let action_pairs = if actions { vec![("default", "Open")] } else { Vec::new() };
    let notification_id = backend.show(envelope, &action_pairs, replace_id)?;
    if !actions {
        return Ok(DeliveryResult { notification_id, actions, activation_url: None });
    }
    let activation_url = match backend.wait_for_action(notification_id)? {
        ActionEvent::Invoked(key) if key == "default" => Some(envelope.activation_url()),
        ActionEvent::Invoked(_) | ActionEvent::Closed | ActionEvent::Disconnected => None,
    };
    Ok(DeliveryResult { notification_id, actions, activation_url })
}

#[cfg(target_os = "linux")]
mod platform {
    use super::{ActionEvent, NotificationBackend};
    use localapp_native_contract::{NotificationEnvelope, Platform};
    use notify_rust::{get_capabilities, Notification, NotificationHandle, NotificationResponse};
    use std::io::{self, Write};
    use std::path::{Component, Path};
    use std::process::Command;
    use std::sync::{Arc, Mutex};

    struct FreedesktopBackend {
        handle: Option<NotificationHandle>,
    }

    impl NotificationBackend for FreedesktopBackend {
        fn supports_actions(&mut self) -> Result<bool, ()> {
            Ok(get_capabilities().map_err(|_| ())?.iter().any(|capability| capability == "actions"))
        }

        fn show(&mut self, envelope: &NotificationEnvelope, actions: &[(&str, &str)], replace_id: u32) -> Result<u32, ()> {
            let mut notification = Notification::new();
            let display_body = if envelope.body.is_empty() {
                format!("{} · {}", envelope.application_label, envelope.source_label)
            } else {
                format!("{} · {}\n{}", envelope.application_label, envelope.source_label, envelope.body)
            };
            notification
                .appname(&envelope.product_label)
                .summary(&envelope.title)
                .body(&display_body)
                .icon(&envelope.icon_path)
                .image_path(&envelope.icon_path);
            if replace_id != 0 { notification.id(replace_id); }
            for (identifier, label) in actions { notification.action(identifier, label); }
            let handle = notification.show().map_err(|_| ())?;
            let id = handle.id();
            self.handle = Some(handle);
            Ok(id)
        }

        fn wait_for_action(&mut self, _id: u32) -> Result<ActionEvent, ()> {
            let handle = self.handle.take().ok_or(())?;
            let event = Arc::new(Mutex::new(ActionEvent::Disconnected));
            let captured = Arc::clone(&event);
            handle.wait_for_response(move |response: &NotificationResponse| {
                let next = match response {
                    NotificationResponse::Default => ActionEvent::Invoked("default".into()),
                    NotificationResponse::Action(key) => ActionEvent::Invoked(key.clone()),
                    NotificationResponse::Reply(_) | NotificationResponse::Closed(_) => ActionEvent::Closed,
                };
                if let Ok(mut slot) = captured.lock() { *slot = next; }
            }).map_err(|_| ())?;
            let result = event.lock().map_err(|_| ())?.clone();
            Ok(result)
        }
    }

    pub fn run(arguments: &[String]) -> Result<(), ()> {
        match arguments.first().map(String::as_str) {
            Some("--permission-state") if arguments.len() == 1 => {
                println!("{}", if get_capabilities().is_ok() { "granted" } else { "unsupported" });
                Ok(())
            }
            Some("--request-permission") if arguments.len() == 1 => {
                println!("{}", if get_capabilities().is_ok() { "granted" } else { "unsupported" });
                Ok(())
            }
            Some("--show-notification") if arguments.len() == 8
                && arguments[2] == "--node" && arguments[4] == "--ipc-client" && arguments[6] == "--replace-id" => {
                let envelope = NotificationEnvelope::parse(&arguments[1], Platform::Unix).map_err(|_| ())?;
                envelope.verify_icon().map_err(|_| ())?;
                if !safe_executable(&arguments[3]) || !safe_executable(&arguments[5]) { return Err(()); }
                let replace_id = arguments[7].parse::<u32>().map_err(|_| ())?;
                let mut backend = FreedesktopBackend { handle: None };
                let actions = backend.supports_actions()?;
                let action_pairs = if actions { vec![("default", "Open")] } else { Vec::new() };
                let notification_id = backend.show(&envelope, &action_pairs, replace_id)?;
                println!("{{\"accepted\":true,\"actions\":{},\"notificationId\":{notification_id}}}", if actions { "true" } else { "false" });
                io::stdout().flush().map_err(|_| ())?;
                if !actions { return Ok(()); }
                if let ActionEvent::Invoked(key) = backend.wait_for_action(notification_id)? {
                    if key == "default" {
                        let status = Command::new(&arguments[3])
                            .arg(&arguments[5])
                            .arg(envelope.activation_url())
                            .status()
                            .map_err(|_| ())?;
                        if !status.success() { return Err(()); }
                    }
                }
                Ok(())
            }
            _ => Err(()),
        }
    }

    fn safe_executable(value: &str) -> bool {
        let path = Path::new(value);
        path.is_absolute()
            && path.components().all(|component| !matches!(component, Component::ParentDir | Component::CurDir))
            && std::fs::symlink_metadata(path).map(|metadata| metadata.file_type().is_file() && !metadata.file_type().is_symlink()).unwrap_or(false)
    }
}

#[cfg(target_os = "linux")]
fn main() {
    let arguments = std::env::args().skip(1).collect::<Vec<_>>();
    if platform::run(&arguments).is_err() { std::process::exit(1); }
}

#[cfg(not(target_os = "linux"))]
fn main() { std::process::exit(1); }

#[cfg(test)]
mod tests {
    use super::{deliver, ActionEvent, NotificationBackend};
    use localapp_native_contract::{NotificationEnvelope, Platform};

    struct Backend {
        actions: bool,
        event: ActionEvent,
        action_count: usize,
    }

    impl NotificationBackend for Backend {
        fn supports_actions(&mut self) -> Result<bool, ()> { Ok(self.actions) }
        fn show(&mut self, _envelope: &NotificationEnvelope, actions: &[(&str, &str)], _replace_id: u32) -> Result<u32, ()> {
            self.action_count = actions.len();
            Ok(41)
        }
        fn wait_for_action(&mut self, _id: u32) -> Result<ActionEvent, ()> { Ok(self.event.clone()) }
    }

    fn envelope() -> NotificationEnvelope {
        NotificationEnvelope::parse(
            r#"{"identifier":"notification_native_0123456789","ticket":"notification_ticket_0123456789","productLabel":"LocalApp","applicationLabel":"Interview App","sourceLabel":"Local server","title":"Build complete","body":"The task finished","priority":"normal","iconPath":"/opt/localapp/icon.png"}"#,
            Platform::Unix,
        ).unwrap()
    }

    #[test]
    fn exposes_only_the_default_action_when_the_server_supports_actions() {
        let mut backend = Backend { actions: true, event: ActionEvent::Invoked("default".into()), action_count: 0 };
        let result = deliver(&mut backend, &envelope(), 0).unwrap();
        assert_eq!(backend.action_count, 1);
        assert_eq!(result.notification_id, 41);
        assert_eq!(result.activation_url.as_deref(), Some("localapp://notification/open?ticket=notification_ticket_0123456789"));
    }

    #[test]
    fn degrades_to_a_non_clickable_popup_and_cleans_up_disconnects() {
        let mut no_actions = Backend { actions: false, event: ActionEvent::Closed, action_count: 0 };
        let result = deliver(&mut no_actions, &envelope(), 19).unwrap();
        assert_eq!(no_actions.action_count, 0);
        assert_eq!(result.activation_url, None);

        let mut disconnected = Backend { actions: true, event: ActionEvent::Disconnected, action_count: 0 };
        let result = deliver(&mut disconnected, &envelope(), 0).unwrap();
        assert_eq!(result.activation_url, None);
    }
}
