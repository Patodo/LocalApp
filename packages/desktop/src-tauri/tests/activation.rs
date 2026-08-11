use localapp_desktop::activation::{ActivationTicket, validate_confirmation_url};

const VALID_TICKET: &str = "localapp://action/018f7c0e-0f8f-4b5f-8c20-7f468f808d10?origin=https%3A%2F%2Fapps.example&nonce=abcdefghijklmnop&protocolVersion=2";

#[test]
fn parses_only_the_versioned_device_action_ticket() {
    let ticket = ActivationTicket::parse(VALID_TICKET).expect("valid ticket");
    assert_eq!(ticket.protocol_version, 2);
    assert_eq!(ticket.action_id, "018f7c0e-0f8f-4b5f-8c20-7f468f808d10");
    assert_eq!(ticket.source_origin, "https://apps.example");
    assert_eq!(ticket.nonce, "abcdefghijklmnop");
}

#[test]
fn rejects_scripts_credentials_and_non_canonical_fields() {
    for value in [
        "localapp://action/018f7c0e-0f8f-4b5f-8c20-7f468f808d10?origin=https%3A%2F%2Fapps.example&nonce=abcdefghijklmnop&protocolVersion=2&script=evil",
        "localapp://action/018f7c0e-0f8f-4b5f-8c20-7f468f808d10?origin=https%3A%2F%2Fapps.example&nonce=abcdefghijklmnop&protocolVersion=2&nonce=second",
        "localapp://action/018F7C0E-0F8F-4B5F-8C20-7F468F808D10?origin=https%3A%2F%2Fapps.example&nonce=abcdefghijklmnop&protocolVersion=2",
        "localapp://action/018f7c0e-0f8f-4b5f-8c20-7f468f808d10?origin=https%3A%2F%2Fuser%3Asecret%40apps.example&nonce=abcdefghijklmnop&protocolVersion=2",
        "localapp://action/018f7c0e-0f8f-4b5f-8c20-7f468f808d10?origin=file%3A%2F%2F%2Ftmp&nonce=abcdefghijklmnop&protocolVersion=2",
    ] {
        assert!(
            ActivationTicket::parse(value).is_err(),
            "accepted invalid ticket: {value}"
        );
    }
}

#[test]
fn opens_only_the_exact_local_confirmation_url_for_the_control_response() {
    let ready_origin = "http://127.0.0.1:49813";
    let request_id = "018f7c0e-0f8f-4b5f-8c20-7f468f808d10";
    let valid = format!("{ready_origin}/my/device-actions/?requestId={request_id}");
    assert_eq!(
        validate_confirmation_url(&valid, ready_origin, request_id).unwrap(),
        valid,
    );

    for value in [
        format!("{ready_origin}/my/device-actions/anything?requestId={request_id}"),
        format!(
            "{ready_origin}/my/device-actions/?requestId={request_id}&next=https://evil.example"
        ),
        format!("{ready_origin}/my/device-actions/?requestId={request_id}&requestId={request_id}"),
        format!("{ready_origin}/my/device-actions/?requestId=018f7c0e-0f8f-4b5f-8c20-7f468f808d11"),
        format!("{ready_origin}/my/device-actions/?requestId={request_id}#fragment"),
        format!("http://localhost:49813/my/device-actions/?requestId={request_id}"),
    ] {
        assert!(
            validate_confirmation_url(&value, ready_origin, request_id).is_err(),
            "accepted invalid confirmation URL: {value}",
        );
    }
}
