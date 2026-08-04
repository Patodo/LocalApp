use localapp_core::Config;
use localapp_desktop::bus::{
    BusCommand, BusEvent, Heartbeat, HeartbeatAction, NativeNotificationAction,
    NotificationActivation, NotificationClickAction, ReconnectPolicy, build_ws_request,
    heartbeat_command, notification_activation, notification_click_plan, parse_bus_message,
    reconciliation_request,
};
use std::time::Duration;

fn config() -> Config {
    Config {
        server_url: "https://work.example/base/".into(),
        api_key: "desktop-secret".into(),
    }
}

#[test]
fn native_notification_actions_only_activate_for_default_clicks() {
    assert_eq!(
        notification_activation(&NativeNotificationAction::Default),
        NotificationActivation::Activate,
    );
    assert_eq!(
        notification_activation(&NativeNotificationAction::Named("default".into())),
        NotificationActivation::Activate,
    );

    for action in [
        NativeNotificationAction::Named("archive".into()),
        NativeNotificationAction::Reply("hello".into()),
        NativeNotificationAction::Closed,
    ] {
        assert_eq!(
            notification_activation(&action),
            NotificationActivation::Ignore,
        );
    }
}

#[test]
fn parses_the_live_server_bus_envelopes() {
    assert_eq!(
        parse_bus_message(r#"{"type":"bus:ready","data":{"userId":"u1"}}"#).unwrap(),
        BusEvent::Ready {
            user_id: "u1".into()
        }
    );
    assert_eq!(
        parse_bus_message(r#"{"type":"notify:missed","data":{"count":3}}"#).unwrap(),
        BusEvent::Missed { count: 3 }
    );
    assert_eq!(
        parse_bus_message(r#"{"type":"bus:pong","data":{"t":7}}"#).unwrap(),
        BusEvent::Pong { ts: 7 }
    );

    let BusEvent::Notification(notification) = parse_bus_message(
        r#"{"type":"notify:notification","data":{"id":"n1","app_owner":"localapp","app_name":"builder","title":"Build ready","body":"Open it","url":"/localapp/builder?issue=7#details","priority":"high","created_at":"2026-07-14T09:30:00.000Z"}}"#,
    )
    .unwrap()
    else {
        panic!("expected a notification event");
    };
    assert_eq!(notification.id, "n1");
    assert_eq!(notification.app_owner, "localapp");
    assert_eq!(notification.created_at, "2026-07-14T09:30:00.000Z");

    assert_eq!(
        parse_bus_message(
            r#"{"type":"desktop:action-requested","data":{"requestId":"550e8400-e29b-41d4-a716-446655440000"}}"#
        )
        .unwrap(),
        BusEvent::ActionRequested {
            request_id: "550e8400-e29b-41d4-a716-446655440000".into(),
        }
    );
}

#[test]
fn rejects_unknown_or_malformed_bus_messages() {
    assert!(parse_bus_message(r#"{"type":"bus:pong","ts":7}"#).is_err());
    assert!(parse_bus_message(r#"{"type":"notify:missed","data":{}}"#).is_err());
    assert!(parse_bus_message(r#"{"type":"task:run","data":{}}"#).is_err());
    assert!(parse_bus_message("not-json").is_err());
}

#[test]
fn reconnect_backoff_is_exponential_and_capped_at_thirty_seconds() {
    let policy = ReconnectPolicy::default();

    assert_eq!(policy.delay(0), Duration::from_secs(1));
    assert_eq!(policy.delay(1), Duration::from_secs(2));
    assert_eq!(policy.delay(4), Duration::from_secs(16));
    assert_eq!(policy.delay(5), Duration::from_secs(30));
    assert_eq!(policy.delay(20), Duration::from_secs(30));
    assert_eq!(policy.delay(u32::MAX), Duration::from_secs(30));
}

#[test]
fn heartbeat_pings_every_thirty_seconds_and_times_out_without_a_pong() {
    assert_eq!(heartbeat_command(7), BusCommand::Ping { ts: 7 });

    let mut heartbeat = Heartbeat::new(Duration::ZERO);
    assert_eq!(
        heartbeat.tick(Duration::from_secs(29)),
        HeartbeatAction::Wait
    );
    assert_eq!(
        heartbeat.tick(Duration::from_secs(30)),
        HeartbeatAction::Ping
    );
    assert_eq!(
        heartbeat.tick(Duration::from_secs(59)),
        HeartbeatAction::Wait
    );
    assert_eq!(
        heartbeat.tick(Duration::from_secs(60)),
        HeartbeatAction::TimedOut
    );
}

#[test]
fn heartbeat_pong_restores_liveness_for_the_next_interval() {
    let mut heartbeat = Heartbeat::new(Duration::ZERO);
    assert_eq!(
        heartbeat.tick(Duration::from_secs(30)),
        HeartbeatAction::Ping
    );
    heartbeat.record_pong(Duration::from_secs(31));
    assert_eq!(
        heartbeat.tick(Duration::from_secs(59)),
        HeartbeatAction::Wait
    );
    assert_eq!(
        heartbeat.tick(Duration::from_secs(60)),
        HeartbeatAction::Ping
    );
}

#[test]
fn ws_request_uses_the_configured_origin_and_bearer_api_key() {
    let request = build_ws_request(&config(), "550e8400-e29b-41d4-a716-446655440000").unwrap();

    assert_eq!(
        request.uri().to_string(),
        "wss://work.example/api/ws?client=desktop&protocolVersion=1&installationId=550e8400-e29b-41d4-a716-446655440000"
    );
    assert_eq!(
        request.headers().get("authorization").unwrap(),
        "Bearer desktop-secret"
    );
}

#[test]
fn missed_events_request_inbox_reconciliation_only_when_work_exists() {
    assert_eq!(
        reconciliation_request(&BusEvent::Missed { count: 3 }),
        Some(3)
    );
    assert_eq!(reconciliation_request(&BusEvent::Missed { count: 0 }), None);
    assert_eq!(reconciliation_request(&BusEvent::Pong { ts: 7 }), None);
}

#[test]
fn notification_click_validates_before_marking_read_and_opening() {
    let actions =
        notification_click_plan(&config(), Some("n1"), "/localapp/builder?issue=7#details").unwrap();

    assert_eq!(
        actions,
        vec![
            NotificationClickAction::MarkRead("n1".into()),
            NotificationClickAction::Open(
                "https://work.example/localapp/builder?issue=7#details".into(),
            ),
        ]
    );

    for candidate in [
        "//evil.example/localapp/builder",
        "https://work.example/localapp/builder",
        "https://user:password@work.example/localapp/builder",
        "/localapp\\builder",
        "/localapp/%5cbuilder",
    ] {
        assert!(
            notification_click_plan(&config(), Some("n1"), candidate).is_err(),
            "{candidate}",
        );
    }
}
