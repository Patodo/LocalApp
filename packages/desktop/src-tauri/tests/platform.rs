use localapp_core::Config;
use localapp_desktop::{
    configured_app_url,
    platform::{FavoriteService, InboxService},
};
use std::io::{Read, Write};
use std::net::TcpListener;
use std::thread;

fn config(server_url: String) -> Config {
    Config {
        server_url,
        api_key: "desktop-secret".into(),
    }
}

#[test]
fn inbox_maps_snake_case_server_fields_to_camel_case_without_exposing_the_api_key() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let server_url = format!("http://{}/", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = [0_u8; 4096];
        let length = stream.read(&mut request).unwrap();
        let request = String::from_utf8_lossy(&request[..length]);
        assert!(request.starts_with("GET /api/inbox?limit=20 HTTP/1.1"));
        assert!(request.contains("x-api-key: desktop-secret"));

        let body = r#"{"success":true,"data":{"items":[{"id":"n1","user_id":"alice","app_owner":"localapp","app_name":"builder","title":"构建完成","body":"生产构建已发布。","url":"http://work.example/apps/localapp/builder","priority":"high","created_at":"2026-07-14T09:30:00.000Z","read_at":null,"deleted_at":null}],"cursor":"next-page"}}"#;
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .unwrap();
    });

    let page =
        tauri::async_runtime::block_on(InboxService::new(config(server_url)).list(None, false))
            .expect("inbox request should succeed");
    let json = serde_json::to_value(&page).unwrap();

    assert_eq!(json["items"][0]["appOwner"], "localapp");
    assert_eq!(json["items"][0]["appName"], "builder");
    assert_eq!(json["items"][0]["createdAt"], "2026-07-14T09:30:00.000Z");
    assert_eq!(json["items"][0]["read"], false);
    assert_eq!(json["nextCursor"], "next-page");
    assert!(
        serde_json::to_string(&json)
            .unwrap()
            .contains("desktop-secret")
            == false
    );
    server.join().unwrap();
}

#[test]
fn inbox_forwards_unread_mode_and_encodes_cursor_values() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let server_url = format!("http://{}/", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = [0_u8; 4096];
        let length = stream.read(&mut request).unwrap();
        let request = String::from_utf8_lossy(&request[..length]);
        assert!(
            request.starts_with(
                "GET /api/inbox?limit=20&cursor=page%2B2%2F3&unreadOnly=true HTTP/1.1"
            )
        );

        let body = r#"{"success":true,"data":{"items":[],"cursor":null}}"#;
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .unwrap();
    });

    let page = tauri::async_runtime::block_on(
        InboxService::new(config(server_url)).list(Some("page+2/3"), true),
    )
    .expect("unread inbox request should succeed");

    assert_eq!(
        serde_json::to_value(page).unwrap()["nextCursor"],
        serde_json::Value::Null
    );
    server.join().unwrap();
}

#[test]
fn notification_ids_are_percent_encoded_in_mutation_paths() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let server_url = format!("http://{}/", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = [0_u8; 4096];
        let length = stream.read(&mut request).unwrap();
        let request = String::from_utf8_lossy(&request[..length]);
        assert!(request.starts_with("PATCH /api/inbox/notice%2Fone%3Ftwo HTTP/1.1"));

        let body = r#"{"success":true,"data":{"id":"notice/one?two","user_id":"alice","app_owner":"localapp","app_name":"builder","title":"构建完成","body":null,"url":null,"priority":"normal","created_at":"2026-07-14T09:30:00.000Z","read_at":"2026-07-14T10:00:00.000Z","deleted_at":null}}"#;
        write!(
            stream,
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
        .unwrap();
    });

    tauri::async_runtime::block_on(
        InboxService::new(config(server_url)).mark_read("notice/one?two"),
    )
    .expect("mark-read request should succeed");
    server.join().unwrap();
}

#[test]
fn favorites_normalize_server_paths_for_opening_and_preserve_stored_paths_for_removal() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let server_url = format!("http://{}/", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        for request_number in 0..2 {
            let (mut stream, _) = listener.accept().unwrap();
            let mut request = [0_u8; 4096];
            let length = stream.read(&mut request).unwrap();
            let request = String::from_utf8_lossy(&request[..length]);

            let body = if request_number == 0 {
                assert!(request.starts_with("GET /api/me/favorites?limit=100 HTTP/1.1"));
                r#"{"success":true,"data":[{"id":1,"userId":"favorite-user","pagePath":"owner/app","pageName":"App","ownerName":null,"createdAt":"2026-07-14T09:30:00.000Z"},{"id":2,"userId":"favorite-user","pagePath":"/legacy/app","pageName":"Legacy App","ownerName":"Legacy","createdAt":"2026-07-13T09:30:00.000Z"}]}"#
            } else {
                assert!(request.starts_with("DELETE /api/favorites/owner%2Fapp HTTP/1.1"));
                r#"{"success":true,"data":{"favorited":false}}"#
            };
            write!(
                stream,
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                body.len(),
                body
            )
            .unwrap();
        }
    });

    let favorites =
        tauri::async_runtime::block_on(FavoriteService::new(config(server_url.clone())).list())
            .expect("favorites request should succeed");
    let json = serde_json::to_value(&favorites).unwrap();

    assert_eq!(json[0]["storedPagePath"], "owner/app");
    assert_eq!(json[0]["appPath"], "/owner/app");
    assert!(json[0].get("userId").is_none());
    assert_eq!(json[1]["storedPagePath"], "/legacy/app");
    assert_eq!(json[1]["appPath"], "/legacy/app");

    let app_path = json[0]["appPath"].as_str().unwrap();
    assert_eq!(
        configured_app_url(&config(server_url.clone()), app_path)
            .unwrap()
            .as_str(),
        format!("{server_url}owner/app")
    );
    tauri::async_runtime::block_on(
        FavoriteService::new(config(server_url))
            .remove(json[0]["storedPagePath"].as_str().unwrap()),
    )
    .expect("favorite removal should preserve the original server path");
    server.join().unwrap();
}

#[test]
fn app_urls_are_bound_to_the_configured_origin_and_reject_unsafe_page_paths() {
    let config = config("https://work.example/".to_string());

    assert_eq!(
        configured_app_url(&config, "/test-owner/team-workload")
            .unwrap()
            .as_str(),
        "https://work.example/test-owner/team-workload"
    );

    for page_path in [
        "test-owner/team-workload",
        "https://evil.example/",
        "//evil.example/",
        "/test-owner/team?tab=admin",
        "/test-owner/team#details",
        "/test-owner/../admin",
        "/test-owner/%2e%2e/admin",
        "/test-owner/%2f%2fevil",
        "/test-owner/%5c%5cevil",
        "/test-owner/%3fadmin",
        "/test-owner/%23details",
        "/test-owner/%252e%252e/admin",
        "/user:password@evil.example/",
    ] {
        assert!(
            configured_app_url(&config, page_path).is_err(),
            "{page_path}"
        );
    }
}
