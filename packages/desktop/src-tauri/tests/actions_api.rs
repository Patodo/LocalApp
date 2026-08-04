use localapp_core::Config;
use localapp_desktop::actions::{
    ActionActivation, ActionService, ActionStatus, ActionStatusUpdate,
};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

const ACTION_ID: &str = "550e8400-e29b-41d4-a716-446655440000";
const INSTALLATION_ID: &str = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";

fn config(server_url: String) -> Config {
    Config {
        server_url,
        api_key: "desktop-secret".into(),
    }
}

fn respond(stream: &mut std::net::TcpStream, body: &str) {
    write!(
        stream,
        "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        body.len(),
        body
    )
    .unwrap();
}

fn read_request(stream: &mut std::net::TcpStream) -> String {
    let mut bytes = Vec::new();
    let mut buffer = [0_u8; 4096];
    loop {
        let length = stream.read(&mut buffer).unwrap();
        bytes.extend_from_slice(&buffer[..length]);
        if length < buffer.len() {
            break;
        }
    }
    String::from_utf8(bytes).unwrap()
}

#[test]
fn pending_mapping_is_redacted_and_uses_the_api_key_boundary() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let server_url = format!("http://{}/", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let request = read_request(&mut stream);
        assert!(request.starts_with("GET /api/desktop-actions/pending HTTP/1.1"));
        assert!(request.contains("x-api-key: desktop-secret"));
        respond(
            &mut stream,
            &format!(
                r#"{{"success":true,"data":[{{"id":"{ACTION_ID}","nonce":"claim_nonce","serverOrigin":"https://work.example","appOwner":"alice","appName":"reports","appVersion":"7","publisherUserId":"publisher-1","publisherDisplayName":"Release Publisher","title":"Generate report","description":"Build the workbook","createdAt":"2026-07-14T10:00:00Z","expiresAt":"2026-07-14T10:10:00Z"}}]}}"#
            ),
        );
    });

    let actions = tauri::async_runtime::block_on(
        ActionService::new(config(server_url), INSTALLATION_ID.into()).list_pending(),
    )
    .unwrap();
    let json = serde_json::to_value(actions).unwrap();

    assert_eq!(json[0]["id"], ACTION_ID);
    assert_eq!(json[0]["publisherDisplayName"], "Release Publisher");
    assert!(json[0].get("script").is_none());
    assert!(json[0].get("input").is_none());
    server.join().unwrap();
}

#[test]
fn recoverable_mapping_uses_the_private_installation_boundary() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let server_url = format!("http://{}/", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let request = read_request(&mut stream);
        assert!(request.starts_with(&format!(
            "GET /api/desktop-actions/recover?installationId={INSTALLATION_ID} HTTP/1.1"
        )));
        assert!(request.contains("x-api-key: desktop-secret"));
        respond(
            &mut stream,
            &format!(
                r#"{{"success":true,"data":[{{"id":"{ACTION_ID}","serverOrigin":"https://work.example","appOwner":"alice","appName":"reports","appVersion":"7","publisherUserId":"publisher-1","publisherDisplayName":"Release Publisher","title":"Generate report","description":"Build the workbook","script":"return input.month","dependencies":{{"zod":"3.23.8"}},"input":{{"month":"2026-07"}},"timeoutSeconds":45,"status":"claimed"}}]}}"#
            ),
        );
    });

    let actions = tauri::async_runtime::block_on(
        ActionService::new(config(server_url), INSTALLATION_ID.into()).list_recoverable(),
    )
    .unwrap();

    assert_eq!(actions.len(), 1);
    assert_eq!(actions[0].id, ACTION_ID);
    assert_eq!(actions[0].status, ActionStatus::Claimed);
    assert_eq!(actions[0].script, "return input.month");
    server.join().unwrap();
}

#[test]
fn claim_and_status_map_full_payload_only_after_success() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let server_url = format!("http://{}/", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let (mut claim_stream, _) = listener.accept().unwrap();
        let claim_request = read_request(&mut claim_stream);
        assert!(claim_request.starts_with(&format!(
            "GET /api/desktop-actions/{ACTION_ID}/claim?nonce=claim_nonce&installationId={INSTALLATION_ID}&protocolVersion=1 HTTP/1.1"
        )), "{claim_request}");
        assert!(claim_request.contains("x-api-key: desktop-secret"));
        respond(
            &mut claim_stream,
            &format!(
                r#"{{"success":true,"data":{{"id":"{ACTION_ID}","userId":"u1","serverOrigin":"https://work.example","appOwner":"alice","appName":"reports","appVersion":"7","publisherUserId":"publisher-1","publisherDisplayName":"Release Publisher","title":"Generate report","description":"Build the workbook","script":"return input.month","dependencies":{{"zod":"3.23.8"}},"input":{{"month":"2026-07"}},"timeoutSeconds":45,"nonce":"claim_nonce","installationId":"{INSTALLATION_ID}","status":"claimed","result":null,"error":null,"createdAt":"2026-07-14T10:00:00Z","updatedAt":"2026-07-14T10:01:00Z","expiresAt":"2026-07-14T10:10:00Z","claimedAt":"2026-07-14T10:01:00Z","completedAt":null}}}}"#
            ),
        );

        let (mut status_stream, _) = listener.accept().unwrap();
        let status_request = read_request(&mut status_stream);
        assert!(status_request.starts_with(&format!(
            "POST /api/desktop-actions/{ACTION_ID}/status HTTP/1.1"
        )));
        assert!(status_request.contains(&format!(
            r#"{{"installationId":"{INSTALLATION_ID}","status":"awaiting_trust"}}"#
        )));
        respond(
            &mut status_stream,
            &format!(
                r#"{{"success":true,"data":{{"id":"{ACTION_ID}","userId":"u1","serverOrigin":"https://work.example","appOwner":"alice","appName":"reports","appVersion":"7","publisherUserId":"publisher-1","publisherDisplayName":"Release Publisher","title":"Generate report","description":"Build the workbook","timeoutSeconds":45,"status":"awaiting_trust","result":null,"error":null,"createdAt":"2026-07-14T10:00:00Z","updatedAt":"2026-07-14T10:01:00Z","expiresAt":"2026-07-14T10:10:00Z","claimedAt":"2026-07-14T10:01:00Z","completedAt":null}}}}"#
            ),
        );
    });

    let service = ActionService::new(config(server_url), INSTALLATION_ID.into());
    let claimed = tauri::async_runtime::block_on(service.claim(&ActionActivation {
        request_id: ACTION_ID.into(),
        nonce: "claim_nonce".into(),
    }))
    .unwrap();
    assert_eq!(claimed.script, "return input.month");
    assert_eq!(claimed.dependencies["zod"], "3.23.8");
    assert_eq!(claimed.input["month"], "2026-07");

    let snapshot = tauri::async_runtime::block_on(service.update_status(
        ACTION_ID,
        ActionStatusUpdate {
            status: ActionStatus::AwaitingTrust,
            result: None,
            error: None,
        },
    ))
    .unwrap();
    assert_eq!(snapshot.status, ActionStatus::AwaitingTrust);
    server.join().unwrap();
}

#[test]
fn terminal_status_uploads_structured_result_and_error_fields() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let server_url = format!("http://{}/", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let request = read_request(&mut stream);
        assert!(request.contains(&format!(
            r#"{{"installationId":"{INSTALLATION_ID}","status":"succeeded","result":{{"answer":42}}}}"#
        )), "{request}");
        respond(
            &mut stream,
            &format!(r#"{{"success":true,"data":{{"id":"{ACTION_ID}","status":"succeeded"}}}}"#),
        );
    });

    let snapshot = tauri::async_runtime::block_on(
        ActionService::new(config(server_url), INSTALLATION_ID.into()).update_status(
            ACTION_ID,
            ActionStatusUpdate {
                status: ActionStatus::Succeeded,
                result: Some(serde_json::json!({"answer": 42})),
                error: None,
            },
        ),
    )
    .unwrap();
    assert_eq!(snapshot.status, ActionStatus::Succeeded);
    server.join().unwrap();
}
