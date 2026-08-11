use localapp_desktop::activation::ActivationTicket;
use localapp_desktop::device_control_client::DeviceControlClient;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

#[tokio::test]
async fn activation_uses_only_the_authenticated_loopback_endpoint() {
    let listener = TcpListener::bind(("127.0.0.1", 0)).await.expect("bind loopback");
    let port = listener.local_addr().expect("local address").port();
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.expect("accept control request");
        let mut request = Vec::new();
        let mut buffer = [0_u8; 1024];
        while !request.windows(4).any(|window| window == b"\r\n\r\n") {
            let count = stream.read(&mut buffer).await.expect("read request");
            assert!(count > 0, "client closed before headers");
            request.extend_from_slice(&buffer[..count]);
        }
        let request = String::from_utf8(request).expect("request headers");
        assert!(request.starts_with("POST /api/device-control/activations HTTP/1.1\r\n"));
        assert!(request.contains("x-localapp-device-control: per-process-secret\r\n"));
        let body = r#"{"success":true,"data":{"requestId":"018f7c0e-0f8f-4b5f-8c20-7f468f808d10","status":"awaiting_trust","confirmationUrl":"http://127.0.0.1:49813/my/device-actions/?requestId=018f7c0e-0f8f-4b5f-8c20-7f468f808d10","protocolVersion":2}}"#;
        let response = format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(), body
        );
        stream.write_all(response.as_bytes()).await.expect("write response");
    });

    let client = DeviceControlClient::new(
        &format!("http://127.0.0.1:{port}"),
        "per-process-secret".into(),
    )
    .expect("loopback client");
    let ticket = ActivationTicket::parse(
        "localapp://action/018f7c0e-0f8f-4b5f-8c20-7f468f808d10?origin=https%3A%2F%2Fapps.example&nonce=abcdefghijklmnop&protocolVersion=2",
    )
    .expect("ticket");
    let response = client.activate(&ticket).await.expect("activation response");
    assert_eq!(response.status, "awaiting_trust");
    server.await.expect("control server task");
}

#[test]
fn client_rejects_non_loopback_http_without_an_explicit_private_network_policy() {
    assert!(DeviceControlClient::new("http://192.168.1.10:3000", "secret".into()).is_err());
}
