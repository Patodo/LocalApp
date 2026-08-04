use crate::{actions::validate_request_id, configured_server_url, resolve_notification_url};
use futures_util::{SinkExt, StreamExt};
use localapp_core::Config;
use serde::{Deserialize, Serialize};
use std::future::Future;
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tokio::sync::{Notify, watch};
use tokio::time::{Instant, interval_at, sleep};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::{HeaderValue, Request, header::AUTHORIZATION};
use tokio_tungstenite::tungstenite::protocol::Message;

pub const HEARTBEAT_INTERVAL: Duration = Duration::from_secs(30);

#[derive(Clone, Debug, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ConnectionState {
    Connecting,
    Connected,
    Offline,
}

impl ConnectionState {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Connecting => "connecting",
            Self::Connected => "connected",
            Self::Offline => "offline",
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all(serialize = "camelCase", deserialize = "snake_case"))]
pub struct NotificationPayload {
    pub id: String,
    pub app_owner: String,
    pub app_name: String,
    pub title: String,
    pub body: Option<String>,
    pub url: Option<String>,
    pub priority: String,
    pub created_at: String,
}

#[derive(Clone, Debug, PartialEq)]
pub enum BusEvent {
    Ready { user_id: String },
    Pong { ts: u64 },
    Missed { count: u32 },
    Notification(NotificationPayload),
    ActionRequested { request_id: String },
}

#[derive(Clone, Debug, PartialEq)]
pub enum BusCommand {
    Ping { ts: u64 },
}

#[derive(Deserialize)]
struct BusEnvelope {
    #[serde(rename = "type")]
    kind: String,
    data: serde_json::Value,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ReadyData {
    user_id: String,
}

#[derive(Deserialize)]
struct PongData {
    t: u64,
}

#[derive(Deserialize)]
struct MissedData {
    count: u32,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ActionRequestedData {
    request_id: String,
}

pub fn parse_bus_message(raw: &str) -> Result<BusEvent, String> {
    let envelope: BusEnvelope =
        serde_json::from_str(raw).map_err(|_| "Invalid notification bus message".to_string())?;
    match envelope.kind.as_str() {
        "bus:ready" => {
            let data: ReadyData = serde_json::from_value(envelope.data)
                .map_err(|_| "Invalid bus:ready payload".to_string())?;
            Ok(BusEvent::Ready {
                user_id: data.user_id,
            })
        }
        "bus:pong" => {
            let data: PongData = serde_json::from_value(envelope.data)
                .map_err(|_| "Invalid bus:pong payload".to_string())?;
            Ok(BusEvent::Pong { ts: data.t })
        }
        "notify:missed" => {
            let data: MissedData = serde_json::from_value(envelope.data)
                .map_err(|_| "Invalid notify:missed payload".to_string())?;
            Ok(BusEvent::Missed { count: data.count })
        }
        "notify:notification" => serde_json::from_value(envelope.data)
            .map(BusEvent::Notification)
            .map_err(|_| "Invalid notify:notification payload".to_string()),
        "desktop:action-requested" => {
            let data: ActionRequestedData = serde_json::from_value(envelope.data)
                .map_err(|_| "Invalid desktop:action-requested payload".to_string())?;
            validate_request_id(&data.request_id)?;
            Ok(BusEvent::ActionRequested {
                request_id: data.request_id,
            })
        }
        _ => Err("Unknown notification bus message".to_string()),
    }
}

pub fn heartbeat_command(ts: u64) -> BusCommand {
    BusCommand::Ping { ts }
}

fn encode_bus_command(command: &BusCommand) -> String {
    match command {
        BusCommand::Ping { ts } => {
            serde_json::json!({ "type": "bus:ping", "data": { "t": ts } }).to_string()
        }
    }
}

#[derive(Clone, Debug)]
pub struct ReconnectPolicy {
    base: Duration,
    maximum: Duration,
}

impl Default for ReconnectPolicy {
    fn default() -> Self {
        Self {
            base: Duration::from_secs(1),
            maximum: Duration::from_secs(30),
        }
    }
}

impl ReconnectPolicy {
    pub fn delay(&self, attempt: u32) -> Duration {
        let multiplier = 2_u32.checked_pow(attempt).unwrap_or(u32::MAX);
        self.base.saturating_mul(multiplier).min(self.maximum)
    }
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum HeartbeatAction {
    Wait,
    Ping,
    TimedOut,
}

#[derive(Clone, Debug)]
pub struct Heartbeat {
    next_ping: Duration,
    awaiting_pong: bool,
}

impl Heartbeat {
    pub fn new(now: Duration) -> Self {
        Self {
            next_ping: now + HEARTBEAT_INTERVAL,
            awaiting_pong: false,
        }
    }

    pub fn tick(&mut self, now: Duration) -> HeartbeatAction {
        if now < self.next_ping {
            return HeartbeatAction::Wait;
        }
        if self.awaiting_pong {
            return HeartbeatAction::TimedOut;
        }
        self.awaiting_pong = true;
        self.next_ping = now + HEARTBEAT_INTERVAL;
        HeartbeatAction::Ping
    }

    pub fn record_pong(&mut self, _now: Duration) {
        self.awaiting_pong = false;
    }
}

pub fn reconciliation_request(event: &BusEvent) -> Option<u32> {
    match event {
        BusEvent::Missed { count } if *count > 0 => Some(*count),
        _ => None,
    }
}

#[derive(Clone, Debug, PartialEq)]
pub enum NotificationClickAction {
    MarkRead(String),
    Open(String),
}

#[derive(Clone, Debug, PartialEq)]
pub enum NativeNotificationAction {
    Default,
    Named(String),
    Reply(String),
    Closed,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum NotificationActivation {
    Activate,
    Ignore,
}

pub fn notification_activation(action: &NativeNotificationAction) -> NotificationActivation {
    match action {
        NativeNotificationAction::Default => NotificationActivation::Activate,
        NativeNotificationAction::Named(action) if action == "default" => {
            NotificationActivation::Activate
        }
        _ => NotificationActivation::Ignore,
    }
}

pub fn notification_click_plan(
    config: &Config,
    notification_id: Option<&str>,
    candidate_url: &str,
) -> Result<Vec<NotificationClickAction>, String> {
    let validated = resolve_notification_url(config, candidate_url)?;
    let mut actions = Vec::with_capacity(2);
    if let Some(id) = notification_id.filter(|id| !id.is_empty()) {
        actions.push(NotificationClickAction::MarkRead(id.to_string()));
    }
    actions.push(NotificationClickAction::Open(validated.to_string()));
    Ok(actions)
}

pub fn build_ws_request(config: &Config, installation_id: &str) -> Result<Request<()>, String> {
    if config.api_key.trim().is_empty() {
        return Err("LocalApp API key is missing".to_string());
    }
    let mut url = configured_server_url(config)?;
    let scheme = match url.scheme() {
        "http" => "ws",
        "https" => "wss",
        _ => return Err("LocalApp server URL must use http(s)".to_string()),
    };
    url.set_scheme(scheme)
        .map_err(|_| "Could not construct notification bus URL".to_string())?;
    url.set_path("/api/ws");
    url.query_pairs_mut()
        .clear()
        .append_pair("client", "desktop")
        .append_pair("protocolVersion", "1")
        .append_pair("installationId", installation_id);
    url.set_fragment(None);

    let mut request = url
        .as_str()
        .into_client_request()
        .map_err(|_| "Could not construct notification bus request".to_string())?;
    let authorization = HeaderValue::from_str(&format!("Bearer {}", config.api_key))
        .map_err(|_| "LocalApp API key is invalid".to_string())?;
    request.headers_mut().insert(AUTHORIZATION, authorization);
    Ok(request)
}

pub trait BusObserver: Clone + Send + Sync + 'static {
    fn connection_changed(&self, state: ConnectionState);
    fn notification_received(&self, notification: NotificationPayload);
    fn notifications_missed(&self, count: u32);
    fn action_requested(&self, request_id: String);
}

#[derive(Clone)]
pub struct BusController {
    inner: Arc<ControllerInner>,
}

struct ControllerInner {
    state: Arc<Mutex<ConnectionState>>,
    run: Mutex<RunState>,
    finished: Notify,
}

#[derive(Default)]
struct RunState {
    next_id: u64,
    active: Option<ActiveRun>,
}

struct ActiveRun {
    id: u64,
    cancel: watch::Sender<bool>,
}

struct RunCompletion {
    controller: BusController,
    run_id: u64,
}

impl Drop for RunCompletion {
    fn drop(&mut self) {
        self.controller.finish(self.run_id);
    }
}

impl Default for BusController {
    fn default() -> Self {
        Self {
            inner: Arc::new(ControllerInner {
                state: Arc::new(Mutex::new(ConnectionState::Offline)),
                run: Mutex::new(RunState::default()),
                finished: Notify::new(),
            }),
        }
    }
}

impl BusController {
    pub fn connection_state(&self) -> ConnectionState {
        self.inner
            .state
            .lock()
            .map(|state| state.clone())
            .unwrap_or(ConnectionState::Offline)
    }

    pub fn start<O: BusObserver>(
        &self,
        config: Config,
        installation_id: String,
        observer: O,
    ) -> bool {
        self.start_task(move |controller, stop| {
            run_bus_worker(config, installation_id, controller, observer, stop)
        })
    }

    pub fn is_running(&self) -> bool {
        self.inner
            .run
            .lock()
            .map(|run| run.active.is_some())
            .unwrap_or(false)
    }

    pub fn request_stop(&self) -> bool {
        let cancel = self
            .inner
            .run
            .lock()
            .ok()
            .and_then(|run| run.active.as_ref().map(|active| active.cancel.clone()));
        cancel.is_some_and(|cancel| cancel.send(true).is_ok())
    }

    pub async fn stop(&self) -> bool {
        let active_id = self
            .inner
            .run
            .lock()
            .ok()
            .and_then(|run| run.active.as_ref().map(|active| active.id));
        let Some(active_id) = active_id else {
            return false;
        };
        self.request_stop();

        loop {
            let finished = self.inner.finished.notified();
            let still_active = self
                .inner
                .run
                .lock()
                .map(|run| {
                    run.active
                        .as_ref()
                        .is_some_and(|active| active.id == active_id)
                })
                .unwrap_or(false);
            if !still_active {
                return true;
            }
            finished.await;
        }
    }

    fn start_task<Factory, Task>(&self, factory: Factory) -> bool
    where
        Factory: FnOnce(BusController, watch::Receiver<bool>) -> Task + Send + 'static,
        Task: Future<Output = ()> + Send + 'static,
    {
        let (run_id, stop) = {
            let Ok(mut run) = self.inner.run.lock() else {
                return false;
            };
            if run.active.is_some() {
                return false;
            }
            run.next_id = run.next_id.wrapping_add(1).max(1);
            let run_id = run.next_id;
            let (cancel, stop) = watch::channel(false);
            run.active = Some(ActiveRun { id: run_id, cancel });
            (run_id, stop)
        };

        let controller = self.clone();
        tauri::async_runtime::spawn(async move {
            let _completion = RunCompletion {
                controller: controller.clone(),
                run_id,
            };
            factory(controller, stop).await;
        });
        true
    }

    fn finish(&self, run_id: u64) {
        if let Ok(mut run) = self.inner.run.lock()
            && run
                .active
                .as_ref()
                .is_some_and(|active| active.id == run_id)
        {
            run.active = None;
        }
        self.inner.finished.notify_waiters();
    }

    fn set_connection<O: BusObserver>(&self, observer: &O, state: ConnectionState) {
        if let Ok(mut current) = self.inner.state.lock() {
            *current = state.clone();
        }
        observer.connection_changed(state);
    }
}

pub async fn run_bus_worker<O: BusObserver>(
    config: Config,
    installation_id: String,
    controller: BusController,
    observer: O,
    mut stop: watch::Receiver<bool>,
) {
    let policy = ReconnectPolicy::default();
    let mut attempt = 0_u32;

    while !*stop.borrow() {
        controller.set_connection(&observer, ConnectionState::Connecting);
        let connection = match build_ws_request(&config, &installation_id) {
            Ok(request) => {
                let Some(connection) =
                    cancellable(tokio_tungstenite::connect_async(request), &mut stop).await
                else {
                    break;
                };
                connection
            }
            Err(_) => {
                controller.set_connection(&observer, ConnectionState::Offline);
                return;
            }
        };

        let mut was_ready = false;
        if let Ok((socket, _)) = connection {
            let result = run_connection(socket, &controller, &observer, &mut stop).await;
            was_ready = result.was_ready;
            if result.stopped {
                break;
            }
        }

        controller.set_connection(&observer, ConnectionState::Offline);
        if was_ready {
            attempt = 0;
        }
        let delay = policy.delay(attempt);
        attempt = attempt.saturating_add(1);
        if cancellable(sleep(delay), &mut stop).await.is_none() {
            break;
        }
    }

    controller.set_connection(&observer, ConnectionState::Offline);
}

async fn cancellable<F: Future>(future: F, stop: &mut watch::Receiver<bool>) -> Option<F::Output> {
    if *stop.borrow() {
        return None;
    }
    tokio::select! {
        biased;
        _ = stop.changed() => None,
        result = future => Some(result),
    }
}

struct ConnectionResult {
    stopped: bool,
    was_ready: bool,
}

async fn run_connection<S, O>(
    socket: tokio_tungstenite::WebSocketStream<S>,
    controller: &BusController,
    observer: &O,
    stop: &mut watch::Receiver<bool>,
) -> ConnectionResult
where
    S: tokio::io::AsyncRead + tokio::io::AsyncWrite + Unpin,
    O: BusObserver,
{
    let (mut writer, mut reader) = socket.split();
    let started = Instant::now();
    let mut heartbeat = Heartbeat::new(Duration::ZERO);
    let mut ticker = interval_at(started + HEARTBEAT_INTERVAL, HEARTBEAT_INTERVAL);
    let mut was_ready = false;

    loop {
        tokio::select! {
            _ = stop.changed() => {
                let _ = writer.send(Message::Close(None)).await;
                return ConnectionResult { stopped: true, was_ready };
            }
            _ = ticker.tick() => {
                match heartbeat.tick(started.elapsed()) {
                    HeartbeatAction::Ping => {
                        let command = heartbeat_command(unix_time_millis());
                        if writer.send(Message::Text(encode_bus_command(&command).into())).await.is_err() {
                            break;
                        }
                    }
                    HeartbeatAction::TimedOut => break,
                    HeartbeatAction::Wait => {}
                }
            }
            message = reader.next() => {
                let Some(Ok(message)) = message else { break };
                match message {
                    Message::Text(raw) => {
                        let Ok(event) = parse_bus_message(raw.as_str()) else { continue };
                        match event {
                            BusEvent::Ready { .. } => {
                                was_ready = true;
                                controller.set_connection(observer, ConnectionState::Connected);
                            }
                            BusEvent::Pong { .. } => heartbeat.record_pong(started.elapsed()),
                            BusEvent::Missed { count } if count > 0 => {
                                observer.notifications_missed(count);
                            }
                            BusEvent::Notification(notification) => {
                                observer.notification_received(notification);
                            }
                            BusEvent::ActionRequested { request_id } => {
                                observer.action_requested(request_id);
                            }
                            BusEvent::Missed { .. } => {}
                        }
                    }
                    Message::Close(_) => break,
                    _ => {}
                }
            }
        }
    }

    ConnectionResult {
        stopped: false,
        was_ready,
    }
}

fn unix_time_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(u64::MAX)
}

#[cfg(test)]
mod lifecycle_tests {
    use super::*;
    use std::future::pending;
    use tokio::time::timeout;

    #[tokio::test]
    async fn duplicate_start_is_guarded_and_stop_allows_restart() {
        let controller = BusController::default();
        assert!(controller.start_task(|_, mut stop| async move {
            let _ = stop.changed().await;
        }));
        assert!(!controller.start_task(|_, _| async {}));

        assert!(controller.stop().await);
        assert!(!controller.is_running());

        assert!(controller.start_task(|_, mut stop| async move {
            let _ = stop.changed().await;
        }));
        assert!(controller.stop().await);
        assert!(!controller.is_running());
    }

    #[tokio::test]
    async fn cancellation_interrupts_a_pending_connect() {
        let (cancel, mut stop) = watch::channel(false);
        let task = tokio::spawn(async move { cancellable(pending::<()>(), &mut stop).await });
        cancel.send(true).unwrap();

        assert_eq!(
            timeout(Duration::from_secs(1), task)
                .await
                .unwrap()
                .unwrap(),
            None,
        );
    }

    #[tokio::test]
    async fn cancellation_interrupts_reconnect_backoff() {
        let (cancel, mut stop) = watch::channel(false);
        let task =
            tokio::spawn(
                async move { cancellable(sleep(Duration::from_secs(30)), &mut stop).await },
            );
        cancel.send(true).unwrap();

        assert_eq!(
            timeout(Duration::from_secs(1), task)
                .await
                .unwrap()
                .unwrap(),
            None,
        );
    }
}
