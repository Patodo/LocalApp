use httpmock::{Method, MockServer};
use localapp_core::{Config, PlatformClient, PlatformError};
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize, PartialEq)]
struct User {
    id: String,
}

#[derive(Serialize)]
struct UpdateUser<'a> {
    name: &'a str,
}

fn config(server: &MockServer) -> Config {
    Config {
        server_url: server.url("/"),
        api_key: "secret".into(),
    }
}

#[tokio::test]
async fn get_sends_api_key_and_unwraps_success_data() {
    let server = MockServer::start_async().await;
    let request = server
        .mock_async(|when, then| {
            when.method(Method::GET)
                .path("/api/me")
                .header("x-api-key", "secret");
            then.status(200)
                .header("content-type", "application/json")
                .body(r#"{"success":true,"data":{"id":"alice"}}"#);
        })
        .await;
    let client = PlatformClient::new(config(&server));

    let user: User = client.get("/api/me").await.unwrap();

    assert_eq!(user, User { id: "alice".into() });
    request.assert_async().await;
}

#[tokio::test]
async fn http_requests_do_not_send_authorization_header() {
    let server = MockServer::start_async().await;
    let authorization = server
        .mock_async(|when, then| {
            when.method(Method::GET)
                .path("/api/me")
                .header_exists("authorization");
            then.status(418);
        })
        .await;
    let request = server
        .mock_async(|when, then| {
            when.method(Method::GET)
                .path("/api/me")
                .header("x-api-key", "secret");
            then.status(200)
                .header("content-type", "application/json")
                .body(r#"{"success":true,"data":{"id":"alice"}}"#);
        })
        .await;
    let client = PlatformClient::new(config(&server));

    let user: User = client.get("/api/me").await.unwrap();

    assert_eq!(user, User { id: "alice".into() });
    authorization.assert_hits_async(0).await;
    request.assert_async().await;
}

#[tokio::test]
async fn rejects_absolute_and_scheme_relative_paths_before_sending_credentials() {
    let platform = MockServer::start_async().await;
    let external = MockServer::start_async().await;
    let absolute_leak = external
        .mock_async(|when, then| {
            when.method(Method::GET)
                .path("/absolute")
                .header("x-api-key", "secret");
            then.status(200)
                .header("content-type", "application/json")
                .body(r#"{"success":true,"data":{"id":"leaked"}}"#);
        })
        .await;
    let absolute_request = external
        .mock_async(|when, then| {
            when.method(Method::GET).path("/absolute");
            then.status(200);
        })
        .await;
    let scheme_relative_leak = external
        .mock_async(|when, then| {
            when.method(Method::GET)
                .path("/scheme-relative")
                .header("x-api-key", "secret");
            then.status(200)
                .header("content-type", "application/json")
                .body(r#"{"success":true,"data":{"id":"leaked"}}"#);
        })
        .await;
    let scheme_relative_request = external
        .mock_async(|when, then| {
            when.method(Method::GET).path("/scheme-relative");
            then.status(200);
        })
        .await;
    let client = PlatformClient::new(config(&platform));

    for path in [
        external.url("/absolute"),
        format!("//{}/scheme-relative", external.address()),
    ] {
        let error = client.get::<User>(&path).await.unwrap_err();
        assert!(matches!(error, PlatformError::Transport));
    }

    absolute_leak.assert_hits_async(0).await;
    absolute_request.assert_hits_async(0).await;
    scheme_relative_leak.assert_hits_async(0).await;
    scheme_relative_request.assert_hits_async(0).await;
}

#[tokio::test]
async fn does_not_follow_cross_origin_redirects_with_credentials() {
    let platform = MockServer::start_async().await;
    let external = MockServer::start_async().await;
    let redirect = platform
        .mock_async(|when, then| {
            when.method(Method::GET)
                .path("/api/redirect")
                .header("x-api-key", "secret");
            then.status(302)
                .header("location", external.url("/redirect-target"));
        })
        .await;
    let leaked_key = external
        .mock_async(|when, then| {
            when.method(Method::GET)
                .path("/redirect-target")
                .header("x-api-key", "secret");
            then.status(200)
                .header("content-type", "application/json")
                .body(r#"{"success":true,"data":{"id":"leaked"}}"#);
        })
        .await;
    let external_request = external
        .mock_async(|when, then| {
            when.method(Method::GET).path("/redirect-target");
            then.status(200);
        })
        .await;
    let client = PlatformClient::new(config(&platform));

    let error = client.get::<User>("/api/redirect").await.unwrap_err();

    assert!(matches!(error, PlatformError::Http { status: 302, .. }));
    redirect.assert_async().await;
    leaked_key.assert_hits_async(0).await;
    external_request.assert_hits_async(0).await;
}

#[tokio::test]
async fn write_methods_send_json_and_unwrap_success_data() {
    let server = MockServer::start_async().await;
    let post = server
        .mock_async(|when, then| {
            when.method(Method::POST)
                .path("/api/users")
                .header("x-api-key", "secret")
                .json_body_obj(&serde_json::json!({ "name": "Ada" }));
            then.status(201)
                .header("content-type", "application/json")
                .body(r#"{"success":true,"data":{"id":"post"}}"#);
        })
        .await;
    let patch = server
        .mock_async(|when, then| {
            when.method(Method::PATCH)
                .path("/api/users/post")
                .header("x-api-key", "secret")
                .json_body_obj(&serde_json::json!({ "name": "Grace" }));
            then.status(200)
                .header("content-type", "application/json")
                .body(r#"{"success":true,"data":{"id":"patch"}}"#);
        })
        .await;
    let delete = server
        .mock_async(|when, then| {
            when.method(Method::DELETE)
                .path("/api/users/patch")
                .header("x-api-key", "secret");
            then.status(200)
                .header("content-type", "application/json")
                .body(r#"{"success":true,"data":{"id":"delete"}}"#);
        })
        .await;
    let client = PlatformClient::new(config(&server));

    let created: User = client
        .post("/api/users", &UpdateUser { name: "Ada" })
        .await
        .unwrap();
    let updated: User = client
        .patch("/api/users/post", &UpdateUser { name: "Grace" })
        .await
        .unwrap();
    let deleted: User = client.delete("/api/users/patch").await.unwrap();

    assert_eq!(created.id, "post");
    assert_eq!(updated.id, "patch");
    assert_eq!(deleted.id, "delete");
    post.assert_async().await;
    patch.assert_async().await;
    delete.assert_async().await;
}

#[tokio::test]
async fn non_json_error_response_is_a_controlled_http_error_without_api_key() {
    let server = MockServer::start_async().await;
    server
        .mock_async(|when, then| {
            when.method(Method::GET).path("/api/me");
            then.status(502)
                .header("content-type", "text/html")
                .body("<html>secret</html>");
        })
        .await;
    let client = PlatformClient::new(config(&server));

    let error = client.get::<User>("/api/me").await.unwrap_err();

    assert!(matches!(error, PlatformError::Http { status: 502, .. }));
    assert!(!error.to_string().contains("secret"));
    assert!(!format!("{error:?}").contains("secret"));
}

#[tokio::test]
async fn malformed_success_envelope_is_invalid_without_api_key() {
    let server = MockServer::start_async().await;
    server
        .mock_async(|when, then| {
            when.method(Method::GET).path("/api/me");
            then.status(200)
                .header("content-type", "text/html")
                .body("<html>secret</html>");
        })
        .await;
    let client = PlatformClient::new(config(&server));

    let error = client.get::<User>("/api/me").await.unwrap_err();

    assert!(matches!(error, PlatformError::InvalidEnvelope));
    assert!(!error.to_string().contains("secret"));
    assert!(!format!("{error:?}").contains("secret"));
}

#[tokio::test]
async fn failed_envelope_redacts_api_key_from_server_message() {
    let server = MockServer::start_async().await;
    server
        .mock_async(|when, then| {
            when.method(Method::GET).path("/api/me");
            then.status(200)
                .header("content-type", "application/json")
                .body(r#"{"success":false,"error":"invalid secret"}"#);
        })
        .await;
    let client = PlatformClient::new(config(&server));

    let error = client.get::<User>("/api/me").await.unwrap_err();

    assert!(matches!(error, PlatformError::Http { status: 200, .. }));
    assert!(!error.to_string().contains("secret"));
    assert!(!format!("{error:?}").contains("secret"));
}

#[tokio::test]
async fn missing_configuration_is_reported_before_requesting() {
    let client = PlatformClient::new(Config {
        server_url: String::new(),
        api_key: String::new(),
    });

    let error = client.get::<User>("/api/me").await.unwrap_err();

    assert!(matches!(error, PlatformError::NotConfigured));
}
