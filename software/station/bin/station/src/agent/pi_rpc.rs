use serde_json::{Map, Value};
use std::collections::HashMap;
use std::ffi::OsString;
use std::fmt;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdout, Command};
use tokio::sync::{mpsc, oneshot};
use tokio::time::{Duration, timeout};

const MAX_JSONL_RECORD_BYTES: usize = 8 * 1024 * 1024;
const REQUEST_TIMEOUT: Duration = Duration::from_secs(15);
static REQUEST_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Debug)]
pub enum PiCommand {
    Prompt { message: String },
    Steer { message: String },
    FollowUp { message: String },
    Abort,
    GetState,
}

impl PiCommand {
    fn name(&self) -> &'static str {
        match self {
            Self::Prompt { .. } => "prompt",
            Self::Steer { .. } => "steer",
            Self::FollowUp { .. } => "follow_up",
            Self::Abort => "abort",
            Self::GetState => "get_state",
        }
    }

    fn into_rpc_value(self, id: String) -> Value {
        let mut object = Map::new();
        object.insert("id".to_owned(), Value::String(id));
        object.insert("type".to_owned(), Value::String(self.name().to_owned()));
        match self {
            Self::Prompt { message } => {
                object.insert("message".to_owned(), Value::String(message));
            }
            Self::Steer { message } | Self::FollowUp { message } => {
                object.insert("message".to_owned(), Value::String(message));
            }
            Self::Abort | Self::GetState => {}
        }
        Value::Object(object)
    }
}

#[derive(Clone, Debug)]
pub struct PiResponse {
    pub command: String,
    pub success: bool,
    pub data: Value,
    pub error: Option<String>,
}

impl PiResponse {
    fn from_value(value: Value) -> Result<(String, Self), PiRpcError> {
        let object = value
            .as_object()
            .ok_or_else(|| PiRpcError::Protocol("RPC response must be a JSON object".to_owned()))?;
        let id = object
            .get("id")
            .and_then(Value::as_str)
            .ok_or_else(|| PiRpcError::Protocol("RPC response is missing string id".to_owned()))?
            .to_owned();
        let command = object
            .get("command")
            .and_then(Value::as_str)
            .ok_or_else(|| {
                PiRpcError::Protocol("RPC response is missing string command".to_owned())
            })?
            .to_owned();
        let success = object
            .get("success")
            .and_then(Value::as_bool)
            .ok_or_else(|| {
                PiRpcError::Protocol("RPC response is missing boolean success".to_owned())
            })?;
        Ok((
            id,
            Self {
                command,
                success,
                data: object.get("data").cloned().unwrap_or(Value::Null),
                error: object
                    .get("error")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
            },
        ))
    }
}

#[derive(Clone, Debug)]
pub enum PiNotification {
    Event(Value),
    Stderr(String),
    ProtocolError(String),
    Exited {
        success: bool,
        detail: String,
        requested: bool,
    },
}

#[derive(Clone, Debug)]
pub struct PiLaunch {
    pub program: PathBuf,
    pub prefix_args: Vec<OsString>,
    pub cwd: PathBuf,
    pub session_dir: PathBuf,
    pub session_name: String,
    pub provider: Option<String>,
    pub model: Option<String>,
    pub resume_session: Option<PathBuf>,
}

impl PiLaunch {
    fn args(&self) -> Vec<OsString> {
        let mut args = self.prefix_args.clone();
        args.extend([
            OsString::from("--mode"),
            OsString::from("rpc"),
            OsString::from("--session-dir"),
            self.session_dir.as_os_str().to_owned(),
            OsString::from("--name"),
            OsString::from(&self.session_name),
        ]);
        if let Some(provider) = self.provider.as_deref().filter(|value| !value.is_empty()) {
            args.extend([OsString::from("--provider"), OsString::from(provider)]);
        }
        if let Some(model) = self.model.as_deref().filter(|value| !value.is_empty()) {
            args.extend([OsString::from("--model"), OsString::from(model)]);
        }
        if let Some(session) = &self.resume_session {
            args.extend([OsString::from("--session"), session.as_os_str().to_owned()]);
        }
        args
    }
}

#[derive(Clone, Debug)]
pub enum PiRpcError {
    Spawn(String),
    Transport(String),
    Protocol(String),
    Timeout(String),
    Rejected(String),
}

impl fmt::Display for PiRpcError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Spawn(message)
            | Self::Transport(message)
            | Self::Protocol(message)
            | Self::Timeout(message)
            | Self::Rejected(message) => formatter.write_str(message),
        }
    }
}

impl std::error::Error for PiRpcError {}

struct Request {
    command: PiCommand,
    response: oneshot::Sender<Result<PiResponse, PiRpcError>>,
}

struct PendingRequest {
    command: &'static str,
    response: oneshot::Sender<Result<PiResponse, PiRpcError>>,
}

enum Control {
    Request(Request),
    Stop(oneshot::Sender<()>),
}

enum Incoming {
    Value(Value),
    Eof,
    Error(PiRpcError),
}

#[derive(Clone)]
pub struct PiHandle {
    control: mpsc::Sender<Control>,
}

impl PiHandle {
    pub async fn request(&self, command: PiCommand) -> Result<PiResponse, PiRpcError> {
        let command_name = command.name();
        let (response_tx, response_rx) = oneshot::channel();
        self.control
            .send(Control::Request(Request {
                command,
                response: response_tx,
            }))
            .await
            .map_err(|_| {
                PiRpcError::Transport(format!(
                    "pi stopped before accepting {command_name} command"
                ))
            })?;
        timeout(REQUEST_TIMEOUT, response_rx)
            .await
            .map_err(|_| {
                PiRpcError::Timeout(format!(
                    "pi did not answer {command_name} within {} seconds",
                    REQUEST_TIMEOUT.as_secs()
                ))
            })?
            .map_err(|_| {
                PiRpcError::Transport(format!(
                    "pi stopped before completing {command_name} command"
                ))
            })?
    }

    pub async fn stop(&self) {
        let (ack_tx, ack_rx) = oneshot::channel();
        if self.control.send(Control::Stop(ack_tx)).await.is_ok() {
            let _ = timeout(Duration::from_secs(5), ack_rx).await;
        }
    }
}

pub struct SpawnedPi {
    pub handle: PiHandle,
    pub notifications: mpsc::Receiver<PiNotification>,
}

pub async fn spawn(launch: PiLaunch) -> Result<SpawnedPi, PiRpcError> {
    tokio::fs::create_dir_all(&launch.session_dir)
        .await
        .map_err(|error| {
            PiRpcError::Spawn(format!(
                "Failed to create pi session directory '{}': {error}",
                launch.session_dir.display()
            ))
        })?;

    let args = launch.args();
    let display_command = format!(
        "{} {}",
        launch.program.display(),
        args.iter()
            .map(|arg| arg.to_string_lossy())
            .collect::<Vec<_>>()
            .join(" ")
    );
    let mut child = Command::new(&launch.program)
        .args(&args)
        .current_dir(&launch.cwd)
        .kill_on_drop(true)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            PiRpcError::Spawn(format!(
                "Failed to start pi RPC process ({display_command}): {error}"
            ))
        })?;

    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| PiRpcError::Spawn("pi stdin was not piped".to_owned()))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| PiRpcError::Spawn("pi stdout was not piped".to_owned()))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| PiRpcError::Spawn("pi stderr was not piped".to_owned()))?;

    let (control_tx, mut control_rx) = mpsc::channel(32);
    let (incoming_tx, mut incoming_rx) = mpsc::channel(64);
    let (notification_tx, notification_rx) = mpsc::channel(256);
    tokio::spawn(read_stdout(stdout, incoming_tx));

    let stderr_notifications = notification_tx.clone();
    tokio::spawn(async move {
        let mut lines = BufReader::new(stderr).lines();
        while let Ok(Some(line)) = lines.next_line().await {
            if stderr_notifications
                .send(PiNotification::Stderr(line))
                .await
                .is_err()
            {
                break;
            }
        }
    });

    tokio::spawn(async move {
        let mut pending: HashMap<String, PendingRequest> = HashMap::new();
        let mut requested_stop = false;
        let mut wait_interval = tokio::time::interval(Duration::from_millis(100));

        loop {
            tokio::select! {
                Some(control) = control_rx.recv() => {
                    match control {
                        Control::Request(request) => {
                            let id = format!(
                                "station-{}",
                                REQUEST_COUNTER.fetch_add(1, Ordering::Relaxed)
                            );
                            let command_name = request.command.name();
                            let mut encoded = match serde_json::to_vec(
                                &request.command.into_rpc_value(id.clone())
                            ) {
                                Ok(encoded) => encoded,
                                Err(error) => {
                                    let _ = request.response.send(Err(PiRpcError::Protocol(
                                        format!("Failed to encode {command_name} command: {error}")
                                    )));
                                    continue;
                                }
                            };
                            encoded.push(b'\n');
                            if let Err(error) = stdin.write_all(&encoded).await {
                                let _ = request.response.send(Err(PiRpcError::Transport(
                                    format!("Failed to write {command_name} command to pi: {error}")
                                )));
                                break;
                            }
                            if let Err(error) = stdin.flush().await {
                                let _ = request.response.send(Err(PiRpcError::Transport(
                                    format!("Failed to flush {command_name} command to pi: {error}")
                                )));
                                break;
                            }
                            pending.insert(
                                id,
                                PendingRequest {
                                    command: command_name,
                                    response: request.response,
                                },
                            );
                        }
                        Control::Stop(ack) => {
                            requested_stop = true;
                            let _ = child.kill().await;
                            let _ = ack.send(());
                            break;
                        }
                    }
                }
                Some(incoming) = incoming_rx.recv() => {
                    match incoming {
                        Incoming::Value(value) => {
                            if value.get("type").and_then(Value::as_str) == Some("response") {
                                match PiResponse::from_value(value) {
                                    Ok((id, response)) => {
                                        if let Some(waiter) = pending.remove(&id) {
                                            let result = if response.command != waiter.command {
                                                Err(PiRpcError::Protocol(format!(
                                                    "pi answered {} request with {} response",
                                                    waiter.command, response.command
                                                )))
                                            } else if response.success {
                                                Ok(response)
                                            } else {
                                                Err(PiRpcError::Rejected(
                                                    response.error.clone().unwrap_or_else(|| {
                                                        format!("pi rejected {} command", response.command)
                                                    })
                                                ))
                                            };
                                            let _ = waiter.response.send(result);
                                        } else {
                                            let message = format!(
                                                "pi returned a response for unknown request id '{id}'"
                                            );
                                            let _ = notification_tx
                                                .send(PiNotification::ProtocolError(message))
                                                .await;
                                            let _ = child.kill().await;
                                            break;
                                        }
                                    }
                                    Err(error) => {
                                        let _ = notification_tx
                                            .send(PiNotification::ProtocolError(error.to_string()))
                                            .await;
                                        let _ = child.kill().await;
                                        break;
                                    }
                                }
                            } else if notification_tx
                                .send(PiNotification::Event(value))
                                .await
                                .is_err()
                            {
                                let _ = child.kill().await;
                                break;
                            }
                        }
                        Incoming::Eof => break,
                        Incoming::Error(error) => {
                            let _ = notification_tx
                                .send(PiNotification::ProtocolError(error.to_string()))
                                .await;
                            let _ = child.kill().await;
                            break;
                        }
                    }
                }
                _ = wait_interval.tick() => {
                    match child.try_wait() {
                        Ok(Some(_)) => break,
                        Ok(None) => {}
                        Err(error) => {
                            let _ = notification_tx
                                .send(PiNotification::ProtocolError(
                                    format!("Failed to inspect pi process: {error}")
                                ))
                                .await;
                            break;
                        }
                    }
                }
                else => break,
            }
        }

        let status = match child.try_wait() {
            Ok(Some(status)) => Some(status),
            Ok(None) => {
                let _ = child.kill().await;
                child.wait().await.ok()
            }
            Err(_) => None,
        };
        let detail = status
            .map(|status| format!("pi process exited with {status}"))
            .unwrap_or_else(|| "pi process exited without a status".to_owned());
        let success = requested_stop || status.is_some_and(|status| status.success());
        let failure = PiRpcError::Transport(detail.clone());
        for (_, waiter) in pending {
            let _ = waiter.response.send(Err(failure.clone()));
        }
        let _ = notification_tx
            .send(PiNotification::Exited {
                success,
                detail,
                requested: requested_stop,
            })
            .await;
    });

    Ok(SpawnedPi {
        handle: PiHandle {
            control: control_tx,
        },
        notifications: notification_rx,
    })
}

async fn read_stdout(stdout: ChildStdout, incoming: mpsc::Sender<Incoming>) {
    let mut reader = BufReader::new(stdout);
    let mut buffer = Vec::new();
    loop {
        buffer.clear();
        match reader.read_until(b'\n', &mut buffer).await {
            Ok(0) => {
                let _ = incoming.send(Incoming::Eof).await;
                break;
            }
            Ok(_) => {
                if buffer.len() > MAX_JSONL_RECORD_BYTES {
                    let _ = incoming
                        .send(Incoming::Error(PiRpcError::Protocol(format!(
                            "pi emitted a JSONL record larger than {MAX_JSONL_RECORD_BYTES} bytes"
                        ))))
                        .await;
                    break;
                }
                if buffer.last() == Some(&b'\n') {
                    buffer.pop();
                }
                if buffer.last() == Some(&b'\r') {
                    buffer.pop();
                }
                if buffer.is_empty() {
                    continue;
                }
                match serde_json::from_slice(&buffer) {
                    Ok(value) => {
                        if incoming.send(Incoming::Value(value)).await.is_err() {
                            break;
                        }
                    }
                    Err(error) => {
                        let preview = String::from_utf8_lossy(&buffer[..buffer.len().min(160)]);
                        let _ = incoming
                            .send(Incoming::Error(PiRpcError::Protocol(format!(
                                "pi emitted invalid JSONL ({error}): {preview}"
                            ))))
                            .await;
                        break;
                    }
                }
            }
            Err(error) => {
                let _ = incoming
                    .send(Incoming::Error(PiRpcError::Transport(format!(
                        "Failed to read pi stdout: {error}"
                    ))))
                    .await;
                break;
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{PiCommand, PiLaunch, PiNotification};
    use std::ffi::OsString;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};
    use tokio::time::{Duration, timeout};

    #[test]
    fn prompt_uses_exact_command_name() {
        let value = PiCommand::Prompt {
            message: "next".to_owned(),
        }
        .into_rpc_value("request-1".to_owned());
        assert_eq!(value["type"], "prompt");
        assert_eq!(value["message"], "next");
    }

    #[test]
    fn steer_and_follow_up_use_exact_command_names() {
        assert_eq!(
            PiCommand::Steer {
                message: "change course".to_owned()
            }
            .name(),
            "steer"
        );
        assert_eq!(
            PiCommand::FollowUp {
                message: "then summarize".to_owned()
            }
            .name(),
            "follow_up"
        );
    }

    #[tokio::test]
    async fn correlates_responses_and_forwards_events_from_a_pi_process() {
        if tokio::process::Command::new("node")
            .arg("--version")
            .output()
            .await
            .is_err()
        {
            eprintln!("Skipping pi RPC process test because node is unavailable");
            return;
        }

        static TEST_COUNTER: AtomicU64 = AtomicU64::new(1);
        let test_root = std::env::temp_dir().join(format!(
            "station-pi-rpc-test-{}-{}",
            std::process::id(),
            TEST_COUNTER.fetch_add(1, Ordering::Relaxed)
        ));
        tokio::fs::create_dir_all(&test_root).await.unwrap();
        let fixture = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/fake-pi.mjs");
        let mut spawned = super::spawn(PiLaunch {
            program: PathBuf::from("node"),
            prefix_args: vec![OsString::from(fixture)],
            cwd: test_root.clone(),
            session_dir: test_root.join("sessions"),
            session_name: "rpc-contract-test".to_owned(),
            provider: Some("test-provider".to_owned()),
            model: Some("test-model".to_owned()),
            resume_session: None,
        })
        .await
        .unwrap();

        let state = spawned.handle.request(PiCommand::GetState).await.unwrap();
        assert_eq!(state.command, "get_state");
        assert_eq!(state.data["sessionId"], "fake-session-id");
        assert!(
            state.data["sessionFile"]
                .as_str()
                .unwrap()
                .ends_with("fake-session.jsonl")
        );

        spawned
            .handle
            .request(PiCommand::Prompt {
                message: "hello".to_owned(),
            })
            .await
            .unwrap();
        let notification = timeout(Duration::from_secs(2), spawned.notifications.recv())
            .await
            .unwrap()
            .unwrap();
        match notification {
            PiNotification::Event(event) => assert_eq!(event["type"], "agent_start"),
            other => panic!("expected agent event, got {other:?}"),
        }

        spawned
            .handle
            .request(PiCommand::Steer {
                message: "adjust".to_owned(),
            })
            .await
            .unwrap();
        spawned
            .handle
            .request(PiCommand::FollowUp {
                message: "summarize".to_owned(),
            })
            .await
            .unwrap();
        spawned.handle.request(PiCommand::Abort).await.unwrap();
        spawned.handle.stop().await;
        let _ = tokio::fs::remove_dir_all(test_root).await;
    }

    #[tokio::test]
    #[ignore = "set STATION_REAL_PI to run against an installed pi binary"]
    async fn handshakes_with_the_installed_pi_rpc() {
        let program = std::env::var_os("STATION_REAL_PI")
            .map(PathBuf::from)
            .expect("STATION_REAL_PI must point to the installed pi executable");
        let test_root =
            std::env::temp_dir().join(format!("station-real-pi-test-{}", std::process::id()));
        tokio::fs::create_dir_all(&test_root).await.unwrap();
        let spawned = super::spawn(PiLaunch {
            program,
            prefix_args: Vec::new(),
            cwd: test_root.clone(),
            session_dir: test_root.join("sessions"),
            session_name: "station-real-pi-contract".to_owned(),
            provider: None,
            model: None,
            resume_session: None,
        })
        .await
        .unwrap();

        let state = spawned.handle.request(PiCommand::GetState).await.unwrap();
        assert_eq!(state.command, "get_state");
        assert!(state.data["sessionId"].is_string());
        assert!(state.data["sessionFile"].is_string());
        spawned.handle.stop().await;
        let _ = tokio::fs::remove_dir_all(test_root).await;
    }
}
