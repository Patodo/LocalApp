#[path = "../src/process_util.rs"]
mod process_util;

#[path = "../src/runner/mod.rs"]
mod runner;

use runner::protocol;
use runner::protocol::{
    FrameDecoder, HostMessage, LogStream, ProtocolError, RunnerMessage, encode_frame,
};
use serde_json::json;

#[test]
fn round_trips_typed_host_and_runner_messages() {
    let start = HostMessage::Start {
        task_id: "task-1".into(),
        script: "return input.value;".into(),
        input: json!({ "value": 7 }),
        context: json!({ "app": { "owner": "localapp", "name": "demo" } }),
        environment_path: "/tmp/localapp-env".into(),
    };
    let bytes = encode_frame(&start).unwrap();
    let decoded = FrameDecoder::default().push(&bytes).unwrap();
    assert_eq!(decoded, vec![serde_json::to_value(start).unwrap()]);

    let log = RunnerMessage::Log {
        task_id: "task-1".into(),
        stream: LogStream::Stdout,
        message: "hello\n".into(),
    };
    let bytes = encode_frame(&log).unwrap();
    assert_eq!(
        FrameDecoder::default().push(&bytes).unwrap(),
        vec![serde_json::to_value(log).unwrap()]
    );
}

#[test]
fn decoder_accepts_fragmented_and_multiple_frames() {
    let first = encode_frame(&json!({ "type": "cancel", "taskId": "a" })).unwrap();
    let second = encode_frame(&json!({ "type": "cancel", "taskId": "b" })).unwrap();
    let joined = [first, second].concat();
    let split = 3;
    let mut decoder = FrameDecoder::default();

    assert!(decoder.push(&joined[..split]).unwrap().is_empty());
    assert_eq!(
        decoder.push(&joined[split..]).unwrap(),
        vec![
            json!({ "type": "cancel", "taskId": "a" }),
            json!({ "type": "cancel", "taskId": "b" }),
        ]
    );
}

#[test]
fn decoder_reports_stable_malformed_and_oversized_errors() {
    let malformed = FrameDecoder::default().push(b"NOPE\0\0\0\0");
    let malformed = malformed.unwrap_err();
    assert_eq!(malformed, ProtocolError::MalformedFrame);
    assert_eq!(malformed.code(), "protocol_malformed_frame");

    let mut oversized = b"LADP".to_vec();
    oversized.extend_from_slice(&(protocol::MAX_FRAME_BYTES as u32 + 1).to_be_bytes());
    let error = FrameDecoder::default().push(&oversized).unwrap_err();
    assert_eq!(error, ProtocolError::FrameTooLarge);
    assert_eq!(error.code(), "protocol_frame_too_large");

    let oversized_message = "x".repeat(protocol::MAX_FRAME_BYTES);
    assert_eq!(
        encode_frame(&oversized_message).unwrap_err(),
        ProtocolError::FrameTooLarge
    );
}

#[test]
fn decoder_rejects_invalid_utf8_and_json_as_malformed() {
    for payload in [vec![0xff], b"{".to_vec()] {
        let mut frame = b"LADP".to_vec();
        frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
        frame.extend_from_slice(&payload);
        assert_eq!(
            FrameDecoder::default().push(&frame).unwrap_err(),
            ProtocolError::MalformedFrame
        );
    }
}

#[test]
fn frame_budget_carries_server_boundary_input_script_and_result_envelopes() {
    let start = HostMessage::Start {
        task_id: "550e8400-e29b-41d4-a716-446655440000".into(),
        script: "x".repeat(256 * 1024),
        input: json!("x".repeat(1024 * 1024 - 2)),
        context: json!({ "app": { "owner": "alice", "name": "reports" } }),
        environment_path: "C:\\Users\\Ada\\AppData\\Local\\LocalApp\\js-envs\\hash".into(),
    };
    assert!(encode_frame(&start).is_ok());

    let completed = RunnerMessage::Completed {
        task_id: "550e8400-e29b-41d4-a716-446655440000".into(),
        result: json!("x".repeat(1024 * 1024 - 2)),
    };
    assert!(encode_frame(&completed).is_ok());
}
