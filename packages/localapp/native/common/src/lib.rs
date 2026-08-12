use serde::de::{self, Deserialize, Deserializer, MapAccess, Visitor};
use std::fmt;
use std::fs;
use std::path::Path;

pub const NOTIFICATION_ENVELOPE_LIMIT_BYTES: usize = 8 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Platform {
    Unix,
    Windows,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Priority {
    Normal,
    High,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct NotificationEnvelope {
    pub identifier: String,
    pub ticket: String,
    pub product_label: String,
    pub application_label: String,
    pub source_label: String,
    pub title: String,
    pub body: String,
    pub priority: Priority,
    pub icon_path: String,
}

impl NotificationEnvelope {
    pub fn parse(raw: &str, platform: Platform) -> Result<Self, &'static str> {
        if raw.as_bytes().len() > NOTIFICATION_ENVELOPE_LIMIT_BYTES {
            return Err("notification envelope is too large");
        }
        let envelope: Self = serde_json::from_str(raw).map_err(|_| "notification envelope is invalid")?;
        if !opaque(&envelope.identifier)
            || !opaque(&envelope.ticket)
            || envelope.product_label != "LocalApp"
            || !label(&envelope.application_label)
            || !label(&envelope.source_label)
            || envelope.title.is_empty()
            || !plain(&envelope.title)
            || !plain(&envelope.body)
            || !local_path(&envelope.icon_path, platform)
        {
            return Err("notification envelope is invalid");
        }
        Ok(envelope)
    }

    pub fn activation_url(&self) -> String {
        format!("localapp://notification/open?ticket={}", self.ticket)
    }

    pub fn verify_icon(&self) -> Result<(), &'static str> {
        let metadata = fs::symlink_metadata(Path::new(&self.icon_path)).map_err(|_| "notification icon is unavailable")?;
        if !metadata.file_type().is_file() || metadata.file_type().is_symlink() {
            return Err("notification icon is invalid");
        }
        Ok(())
    }
}

impl<'de> Deserialize<'de> for NotificationEnvelope {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        deserializer.deserialize_map(EnvelopeVisitor)
    }
}

struct EnvelopeVisitor;

impl<'de> Visitor<'de> for EnvelopeVisitor {
    type Value = NotificationEnvelope;

    fn expecting(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str("the exact LocalApp notification envelope")
    }

    fn visit_map<A>(self, mut map: A) -> Result<Self::Value, A::Error>
    where
        A: MapAccess<'de>,
    {
        let mut identifier = None;
        let mut ticket = None;
        let mut product_label = None;
        let mut application_label = None;
        let mut source_label = None;
        let mut title = None;
        let mut body = None;
        let mut priority = None;
        let mut icon_path = None;
        while let Some(key) = map.next_key::<String>()? {
            match key.as_str() {
                "identifier" => set_once(&mut identifier, map.next_value()?)?,
                "ticket" => set_once(&mut ticket, map.next_value()?)?,
                "productLabel" => set_once(&mut product_label, map.next_value()?)?,
                "applicationLabel" => set_once(&mut application_label, map.next_value()?)?,
                "sourceLabel" => set_once(&mut source_label, map.next_value()?)?,
                "title" => set_once(&mut title, map.next_value()?)?,
                "body" => set_once(&mut body, map.next_value()?)?,
                "priority" => {
                    let value: String = map.next_value()?;
                    let parsed = match value.as_str() {
                        "normal" => Priority::Normal,
                        "high" => Priority::High,
                        _ => return Err(de::Error::custom("invalid priority")),
                    };
                    set_once(&mut priority, parsed)?;
                }
                "iconPath" => set_once(&mut icon_path, map.next_value()?)?,
                _ => return Err(de::Error::unknown_field(&key, FIELDS)),
            }
        }
        Ok(NotificationEnvelope {
            identifier: required(identifier)?,
            ticket: required(ticket)?,
            product_label: required(product_label)?,
            application_label: required(application_label)?,
            source_label: required(source_label)?,
            title: required(title)?,
            body: required(body)?,
            priority: required(priority)?,
            icon_path: required(icon_path)?,
        })
    }
}

const FIELDS: &[&str] = &[
    "identifier",
    "ticket",
    "productLabel",
    "applicationLabel",
    "sourceLabel",
    "title",
    "body",
    "priority",
    "iconPath",
];

fn set_once<E: de::Error, T>(slot: &mut Option<T>, value: T) -> Result<(), E> {
    if slot.is_some() {
        return Err(E::custom("duplicate notification envelope field"));
    }
    *slot = Some(value);
    Ok(())
}

fn required<E: de::Error, T>(value: Option<T>) -> Result<T, E> {
    value.ok_or_else(|| E::custom("missing notification envelope field"))
}

fn opaque(value: &str) -> bool {
    (16..=256).contains(&value.len())
        && value.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'_' || byte == b'-')
}

fn label(value: &str) -> bool {
    !value.is_empty() && value.chars().count() <= 128 && plain(value)
}

fn plain(value: &str) -> bool {
    !value.chars().any(|character| character.is_control() || character == '<' || character == '>')
}

fn local_path(value: &str, platform: Platform) -> bool {
    if value.is_empty() || value.contains('\0') || value.contains('\r') || value.contains('\n') || value.contains("://") {
        return false;
    }
    match platform {
        Platform::Unix => value.starts_with('/')
            && !value.split('/').any(|part| part == "." || part == ".."),
        Platform::Windows => {
            let bytes = value.as_bytes();
            bytes.len() >= 4
                && bytes[0].is_ascii_alphabetic()
                && bytes[1] == b':'
                && bytes[2] == b'\\'
                && !value.split('\\').any(|part| part == "." || part == ".." || part.is_empty())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{NotificationEnvelope, Platform};

    fn valid(icon_path: &str) -> String {
        format!(
            r#"{{"identifier":"notification_native_0123456789","ticket":"notification_ticket_0123456789","productLabel":"LocalApp","applicationLabel":"Interview App","sourceLabel":"Local server","title":"Build complete","body":"The task finished","priority":"normal","iconPath":"{icon_path}"}}"#,
        )
    }

    #[test]
    fn accepts_only_the_exact_bounded_plain_envelope() {
        let parsed = NotificationEnvelope::parse(&valid("/opt/localapp/icon.png"), Platform::Unix).unwrap();
        assert_eq!(parsed.identifier, "notification_native_0123456789");
        assert_eq!(parsed.product_label, "LocalApp");
        assert_eq!(parsed.application_label, "Interview App");
        assert_eq!(parsed.activation_url(), "localapp://notification/open?ticket=notification_ticket_0123456789");

        let extra = valid("/opt/localapp/icon.png").replace("}", r#",\"url\":\"https://evil.example\"}"#);
        assert!(NotificationEnvelope::parse(&extra, Platform::Unix).is_err());
        let duplicate = valid("/opt/localapp/icon.png").replace(
            r#""title":"Build complete""#,
            r#""title":"first","title":"second""#,
        );
        assert!(NotificationEnvelope::parse(&duplicate, Platform::Unix).is_err());
        let markup = valid("/opt/localapp/icon.png").replace("Build complete", "<script>run()</script>");
        assert!(NotificationEnvelope::parse(&markup, Platform::Unix).is_err());
        let oversized = valid("/opt/localapp/icon.png").replace("The task finished", &"界".repeat(2_800));
        assert!(oversized.len() > 8 * 1024);
        assert!(NotificationEnvelope::parse(&oversized, Platform::Unix).is_err());
    }

    #[test]
    fn validates_platform_local_paths_without_treating_urls_as_files() {
        assert!(NotificationEnvelope::parse(&valid(r"C:\\Users\\Pat\\LocalApp\\icon.png"), Platform::Windows).is_ok());
        for path in ["https://evil.example/icon.png", "file:///opt/icon.png", "/opt/../icon.png", "relative/icon.png"] {
            assert!(NotificationEnvelope::parse(&valid(path), Platform::Unix).is_err(), "accepted {path}");
        }
    }
}
