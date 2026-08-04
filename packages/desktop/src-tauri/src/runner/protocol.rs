use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::fmt;

const MAGIC: &[u8; 4] = b"LADP";
const HEADER_BYTES: usize = 8;
pub const MAX_FRAME_BYTES: usize = 2 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum HostMessage {
    Start {
        task_id: String,
        script: String,
        input: Value,
        context: Value,
        environment_path: String,
    },
    Cancel {
        task_id: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LogStream {
    Stdout,
    Stderr,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "type",
    rename_all = "snake_case",
    rename_all_fields = "camelCase"
)]
pub enum RunnerMessage {
    Ready {
        protocol_version: u32,
    },
    Log {
        task_id: String,
        stream: LogStream,
        message: String,
    },
    Completed {
        task_id: String,
        result: Value,
    },
    Failed {
        task_id: Option<String>,
        code: String,
        message: String,
    },
    Cancelled {
        task_id: String,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProtocolError {
    MalformedFrame,
    FrameTooLarge,
}

impl ProtocolError {
    pub const fn code(self) -> &'static str {
        match self {
            Self::MalformedFrame => "protocol_malformed_frame",
            Self::FrameTooLarge => "protocol_frame_too_large",
        }
    }
}

impl fmt::Display for ProtocolError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.code())
    }
}

impl std::error::Error for ProtocolError {}

pub fn encode_frame<T: Serialize>(message: &T) -> Result<Vec<u8>, ProtocolError> {
    let payload = serde_json::to_vec(message).map_err(|_| ProtocolError::MalformedFrame)?;
    if payload.len() > MAX_FRAME_BYTES {
        return Err(ProtocolError::FrameTooLarge);
    }

    let mut frame = Vec::with_capacity(HEADER_BYTES + payload.len());
    frame.extend_from_slice(MAGIC);
    frame.extend_from_slice(&(payload.len() as u32).to_be_bytes());
    frame.extend_from_slice(&payload);
    Ok(frame)
}

#[derive(Debug, Default)]
pub struct FrameDecoder {
    buffer: Vec<u8>,
}

impl FrameDecoder {
    pub fn push(&mut self, bytes: &[u8]) -> Result<Vec<Value>, ProtocolError> {
        self.buffer.extend_from_slice(bytes);
        let mut messages = Vec::new();

        loop {
            if self.buffer.len() < MAGIC.len() {
                break;
            }
            if &self.buffer[..MAGIC.len()] != MAGIC {
                return self.fail(ProtocolError::MalformedFrame);
            }
            if self.buffer.len() < HEADER_BYTES {
                break;
            }

            let payload_len = u32::from_be_bytes(
                self.buffer[4..8]
                    .try_into()
                    .expect("frame length has exactly four bytes"),
            ) as usize;
            if payload_len > MAX_FRAME_BYTES {
                return self.fail(ProtocolError::FrameTooLarge);
            }
            if self.buffer.len() < HEADER_BYTES + payload_len {
                break;
            }

            let payload = &self.buffer[HEADER_BYTES..HEADER_BYTES + payload_len];
            let message = match serde_json::from_slice(payload) {
                Ok(message) => message,
                Err(_) => return self.fail(ProtocolError::MalformedFrame),
            };
            self.buffer.drain(..HEADER_BYTES + payload_len);
            messages.push(message);
        }

        Ok(messages)
    }

    fn fail<T>(&mut self, error: ProtocolError) -> Result<T, ProtocolError> {
        self.buffer.clear();
        Err(error)
    }
}
