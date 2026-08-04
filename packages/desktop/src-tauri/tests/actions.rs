use localapp_desktop::actions::{ActivationQueue, parse_activation_url};

const ACTION_ID: &str = "550e8400-e29b-41d4-a716-446655440000";

#[test]
fn parses_exact_action_activation_urls() {
    let activation =
        parse_activation_url(&format!("localapp://action/{ACTION_ID}?nonce=abc_DEF-123")).unwrap();

    assert_eq!(activation.request_id, ACTION_ID);
    assert_eq!(activation.nonce, "abc_DEF-123");
}

#[test]
fn rejects_activation_url_abuse_cases() {
    for candidate in [
        "https://action/550e8400-e29b-41d4-a716-446655440000?nonce=n",
        "localapp://other/550e8400-e29b-41d4-a716-446655440000?nonce=n",
        "localapp://user:password@action/550e8400-e29b-41d4-a716-446655440000?nonce=n",
        "localapp://action/550e8400-e29b-41d4-a716-446655440000/extra?nonce=n",
        "localapp://action/550e8400-e29b-41d4-a716-446655440000%2Fextra?nonce=n",
        "localapp://action/550e8400-e29b-41d4-a716-446655440000%5Cextra?nonce=n",
        "localapp://action/550e8400-e29b-41d4-a716-446655440000\\extra?nonce=n",
        "localapp://action/not-a-uuid?nonce=n",
        "localapp://action/550e8400e29b41d4a716446655440000?nonce=n",
        "localapp://action/550e8400-e29b-41d4-a716-446655440000",
        "localapp://action/550e8400-e29b-41d4-a716-446655440000?nonce=",
        "localapp://action/550e8400-e29b-41d4-a716-446655440000?nonce=a&nonce=b",
        "localapp://action/550e8400-e29b-41d4-a716-446655440000?nonce=n&extra=x",
        "localapp://action/550e8400-e29b-41d4-a716-446655440000?nonce=a%2Fb",
        "localapp://action/550e8400-e29b-41d4-a716-446655440000?nonce=a%5Cb",
        "localapp://action/550e8400-e29b-41d4-a716-446655440000?nonce=a%00b",
        "localapp://action/550e8400-e29b-41d4-a716-446655440000?nonce=n#fragment",
    ] {
        assert!(parse_activation_url(candidate).is_err(), "{candidate}");
    }
}

#[test]
fn rejects_nonce_tokens_over_the_boundary() {
    let nonce = "a".repeat(257);
    let candidate = format!("localapp://action/{ACTION_ID}?nonce={nonce}");

    assert!(parse_activation_url(&candidate).is_err());
}

#[test]
fn queues_activations_before_a_frontend_listener_and_takes_them_once() {
    let queue = ActivationQueue::default();
    let first = format!("localapp://action/{ACTION_ID}?nonce=first");
    let second_id = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
    let second = format!("localapp://action/{second_id}?nonce=second");

    assert_eq!(
        queue.push_urls(["--hidden", first.as_str(), second.as_str()]),
        2
    );
    let pending = queue.take_pending();

    assert_eq!(pending.len(), 2);
    assert_eq!(pending[0].request_id, ACTION_ID);
    assert_eq!(pending[1].request_id, second_id);
    assert!(queue.take_pending().is_empty());
}

#[test]
fn releases_taken_activations_for_a_later_reconnect_retry() {
    let queue = ActivationQueue::default();
    let url = format!("localapp://action/{ACTION_ID}?nonce=once");

    assert_eq!(queue.push_urls([url.as_str(), url.as_str()]), 1);
    assert_eq!(queue.take_pending().len(), 1);
    assert_eq!(queue.push_urls([url.as_str()]), 1);
    assert_eq!(queue.take_pending().len(), 1);
}
