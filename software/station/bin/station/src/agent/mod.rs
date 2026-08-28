mod pi_rpc;

use pi_rpc::{PiCommand, PiHandle, PiLaunch, PiNotification, PiRpcError};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::io::AsyncWriteExt;
use tokio::sync::{Mutex, RwLock, mpsc, oneshot};
use tokio::time::{Duration, sleep};

const MAX_EVENTS_PER_SESSION: usize = 2_000;
static SESSION_COUNTER: AtomicU64 = AtomicU64::new(1);

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SessionMode {
    Headless,
    Pty,
}

#[derive(Clone, Copy, Debug, Default, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum RuntimeKind {
    #[default]
    Pi,
    Mock,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Starting,
    Running,
    Stopped,
    Errored,
}

impl SessionStatus {
    fn can_transition_to(self, next: Self) -> bool {
        matches!(
            (self, next),
            (Self::Starting, Self::Running | Self::Errored)
                | (Self::Running, Self::Stopped | Self::Errored)
                | (Self::Stopped | Self::Errored, Self::Starting)
        )
    }
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    pub id: String,
    pub name: String,
    pub mode: SessionMode,
    #[serde(default)]
    pub runtime: RuntimeKind,
    pub status: SessionStatus,
    pub cwd: PathBuf,
    pub provider: String,
    pub model_id: String,
    pub created_at_ms: u64,
    pub updated_at_ms: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pi_session_file: Option<PathBuf>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub pi_session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateSessionRequest {
    pub name: String,
    #[serde(default = "default_mode")]
    pub mode: SessionMode,
    #[serde(default = "default_cwd")]
    pub cwd: PathBuf,
    #[serde(default)]
    pub provider: String,
    #[serde(default)]
    pub model_id: String,
}

#[derive(Debug, Deserialize)]
pub struct PromptRequest {
    pub message: String,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentEvent {
    pub seq: u64,
    pub at_ms: u64,
    pub event: Value,
}

#[derive(Debug)]
pub struct AgentError {
    pub status: hyper::StatusCode,
    pub code: &'static str,
    pub message: String,
}

impl AgentError {
    fn bad_request(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status: hyper::StatusCode::BAD_REQUEST,
            code,
            message: message.into(),
        }
    }

    fn conflict(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status: hyper::StatusCode::CONFLICT,
            code,
            message: message.into(),
        }
    }

    fn not_found(id: &str) -> Self {
        Self {
            status: hyper::StatusCode::NOT_FOUND,
            code: "session_not_found",
            message: format!("Agent session '{id}' does not exist"),
        }
    }

    fn runtime(code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status: hyper::StatusCode::BAD_GATEWAY,
            code,
            message: message.into(),
        }
    }

    fn internal(message: impl Into<String>) -> Self {
        Self {
            status: hyper::StatusCode::INTERNAL_SERVER_ERROR,
            code: "agent_internal",
            message: message.into(),
        }
    }
}

enum RuntimeHandle {
    Pi(PiHandle),
    Mock {
        input: mpsc::Sender<PiCommand>,
        stop: oneshot::Sender<()>,
    },
}

enum RuntimeCommandTarget {
    Pi(PiHandle),
    Mock(mpsc::Sender<PiCommand>),
}

pub struct AgentModule {
    base_path: PathBuf,
    sessions: RwLock<HashMap<String, SessionRecord>>,
    events: Mutex<HashMap<String, Vec<AgentEvent>>>,
    runtimes: Mutex<HashMap<String, RuntimeHandle>>,
}

impl AgentModule {
    pub async fn open(base_path: PathBuf) -> Result<Arc<Self>, Box<dyn std::error::Error>> {
        tokio::fs::create_dir_all(base_path.join("sessions")).await?;
        tokio::fs::create_dir_all(base_path.join("pi-sessions")).await?;

        let index_path = base_path.join("sessions.json");
        let mut sessions: HashMap<String, SessionRecord> = match tokio::fs::read(&index_path).await
        {
            Ok(bytes) => serde_json::from_slice(&bytes)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => HashMap::new(),
            Err(error) => return Err(error.into()),
        };

        for session in sessions.values_mut() {
            if matches!(
                session.status,
                SessionStatus::Starting | SessionStatus::Running
            ) {
                session.status = SessionStatus::Stopped;
                session.updated_at_ms = now_ms();
                session.last_error = None;
            }
        }

        let mut events = HashMap::new();
        for id in sessions.keys() {
            events.insert(id.clone(), load_events(&base_path, id).await?);
        }

        let module = Arc::new(Self {
            base_path,
            sessions: RwLock::new(sessions),
            events: Mutex::new(events),
            runtimes: Mutex::new(HashMap::new()),
        });
        module.persist_sessions().await?;
        Ok(module)
    }

    pub async fn list_sessions(&self) -> Vec<SessionRecord> {
        let mut sessions: Vec<_> = self.sessions.read().await.values().cloned().collect();
        sessions.sort_by(|left, right| right.updated_at_ms.cmp(&left.updated_at_ms));
        sessions
    }

    pub async fn get_session(&self, id: &str) -> Result<SessionRecord, AgentError> {
        self.sessions
            .read()
            .await
            .get(id)
            .cloned()
            .ok_or_else(|| AgentError::not_found(id))
    }

    pub async fn create_session(
        self: &Arc<Self>,
        request: CreateSessionRequest,
    ) -> Result<SessionRecord, AgentError> {
        let name = request.name.trim();
        if name.is_empty() {
            return Err(AgentError::bad_request(
                "invalid_session_name",
                "Session name must not be empty",
            ));
        }
        if request.mode != SessionMode::Headless {
            return Err(AgentError::bad_request(
                "unsupported_session_mode",
                "Agent RPC currently supports headless sessions only",
            ));
        }
        if !request.cwd.is_dir() {
            return Err(AgentError::bad_request(
                "invalid_session_cwd",
                format!(
                    "Session working directory '{}' does not exist",
                    request.cwd.display()
                ),
            ));
        }

        let now = now_ms();
        let id = format!(
            "agent-{now}-{}",
            SESSION_COUNTER.fetch_add(1, Ordering::Relaxed)
        );
        let record = SessionRecord {
            id: id.clone(),
            name: name.to_owned(),
            mode: request.mode,
            runtime: if mock_enabled() {
                RuntimeKind::Mock
            } else {
                RuntimeKind::Pi
            },
            status: SessionStatus::Starting,
            cwd: request.cwd,
            provider: request.provider.trim().to_owned(),
            model_id: request.model_id.trim().to_owned(),
            created_at_ms: now,
            updated_at_ms: now,
            pi_session_file: None,
            pi_session_id: None,
            last_error: None,
        };

        self.sessions.write().await.insert(id.clone(), record);
        self.events.lock().await.insert(id.clone(), Vec::new());
        self.persist_sessions()
            .await
            .map_err(AgentError::internal)?;

        if let Err(error) = self.spawn_runtime(&id).await {
            self.set_status(&id, SessionStatus::Errored, Some(error.message.clone()))
                .await?;
            return Err(error);
        }
        self.get_session(&id).await
    }

    pub async fn prompt(&self, id: &str, message: String) -> Result<(), AgentError> {
        self.send_message_command(id, message, "empty_prompt", |message| PiCommand::Prompt {
            message,
        })
        .await
    }

    pub async fn steer(&self, id: &str, message: String) -> Result<(), AgentError> {
        self.send_message_command(id, message, "empty_steer", |message| PiCommand::Steer {
            message,
        })
        .await
    }

    pub async fn follow_up(&self, id: &str, message: String) -> Result<(), AgentError> {
        self.send_message_command(id, message, "empty_follow_up", |message| {
            PiCommand::FollowUp { message }
        })
        .await
    }

    pub async fn abort(&self, id: &str) -> Result<(), AgentError> {
        self.ensure_running_headless(id).await?;
        self.send_runtime_command(id, PiCommand::Abort).await
    }

    async fn send_message_command(
        &self,
        id: &str,
        message: String,
        empty_code: &'static str,
        command: fn(String) -> PiCommand,
    ) -> Result<(), AgentError> {
        let message = message.trim().to_owned();
        if message.is_empty() {
            return Err(AgentError::bad_request(
                empty_code,
                "Agent message must not be empty",
            ));
        }
        self.ensure_running_headless(id).await?;
        self.send_runtime_command(id, command(message)).await
    }

    async fn ensure_running_headless(&self, id: &str) -> Result<(), AgentError> {
        let session = self.get_session(id).await?;
        if session.mode != SessionMode::Headless {
            return Err(AgentError::conflict(
                "wrong_session_mode",
                "RPC commands are only supported for headless sessions",
            ));
        }
        if session.status != SessionStatus::Running {
            return Err(AgentError::conflict(
                "session_stopped",
                "Resume the session before sending an agent command",
            ));
        }
        Ok(())
    }

    async fn send_runtime_command(&self, id: &str, command: PiCommand) -> Result<(), AgentError> {
        let target = {
            let runtimes = self.runtimes.lock().await;
            match runtimes.get(id) {
                Some(RuntimeHandle::Pi(handle)) => RuntimeCommandTarget::Pi(handle.clone()),
                Some(RuntimeHandle::Mock { input, .. }) => {
                    RuntimeCommandTarget::Mock(input.clone())
                }
                None => {
                    return Err(AgentError::conflict(
                        "session_runtime_missing",
                        "The session has no active runtime; stop and resume it",
                    ));
                }
            }
        };

        match target {
            RuntimeCommandTarget::Pi(handle) => handle
                .request(command)
                .await
                .map(|_| ())
                .map_err(agent_rpc_error),
            RuntimeCommandTarget::Mock(input) => input.send(command).await.map_err(|_| {
                AgentError::conflict(
                    "session_runtime_closed",
                    "The mock runtime stopped accepting commands",
                )
            }),
        }
    }

    pub async fn events_after(&self, id: &str, after: u64) -> Result<Vec<AgentEvent>, AgentError> {
        self.get_session(id).await?;
        Ok(self
            .events
            .lock()
            .await
            .get(id)
            .map(|events| {
                events
                    .iter()
                    .filter(|event| event.seq > after)
                    .cloned()
                    .collect()
            })
            .unwrap_or_default())
    }

    pub async fn stop(&self, id: &str) -> Result<SessionRecord, AgentError> {
        let session = self.get_session(id).await?;
        if session.status != SessionStatus::Running {
            return Err(AgentError::conflict(
                "session_not_running",
                "Only a running session can be stopped",
            ));
        }
        let runtime = self.runtimes.lock().await.remove(id).ok_or_else(|| {
            AgentError::conflict("session_runtime_missing", "The session runtime is missing")
        })?;
        match runtime {
            RuntimeHandle::Pi(handle) => handle.stop().await,
            RuntimeHandle::Mock { stop, .. } => {
                let _ = stop.send(());
            }
        }
        self.set_status(id, SessionStatus::Stopped, None).await?;
        self.append_event(id, json!({ "type": "session_stopped" }))
            .await?;
        self.get_session(id).await
    }

    pub async fn resume(self: &Arc<Self>, id: &str) -> Result<SessionRecord, AgentError> {
        let session = self.get_session(id).await?;
        if !matches!(
            session.status,
            SessionStatus::Stopped | SessionStatus::Errored
        ) {
            return Err(AgentError::conflict(
                "session_not_resumable",
                "Only stopped or errored sessions can be resumed",
            ));
        }
        self.set_status(id, SessionStatus::Starting, None).await?;
        if let Err(error) = self.spawn_runtime(id).await {
            self.set_status(id, SessionStatus::Errored, Some(error.message.clone()))
                .await?;
            return Err(error);
        }
        self.get_session(id).await
    }

    pub async fn delete(&self, id: &str) -> Result<(), AgentError> {
        if let Some(runtime) = self.runtimes.lock().await.remove(id) {
            match runtime {
                RuntimeHandle::Pi(handle) => handle.stop().await,
                RuntimeHandle::Mock { stop, .. } => {
                    let _ = stop.send(());
                }
            }
        }
        if self.sessions.write().await.remove(id).is_none() {
            return Err(AgentError::not_found(id));
        }
        self.events.lock().await.remove(id);
        self.persist_sessions()
            .await
            .map_err(AgentError::internal)?;
        match tokio::fs::remove_file(self.event_path(id)).await {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
            Err(error) => Err(AgentError::internal(error.to_string())),
        }
    }

    async fn spawn_runtime(self: &Arc<Self>, id: &str) -> Result<(), AgentError> {
        let session = self.get_session(id).await?;
        match session.runtime {
            RuntimeKind::Mock => self.spawn_mock_runtime(session.id.clone()).await?,
            RuntimeKind::Pi => self.spawn_pi_runtime(session).await?,
        }
        self.set_status(id, SessionStatus::Running, None).await?;
        let runtime = self.get_session(id).await?.runtime;
        self.append_event(
            id,
            json!({
                "type": "session_started",
                "backend": match runtime {
                    RuntimeKind::Pi => "pi",
                    RuntimeKind::Mock => "mock",
                }
            }),
        )
        .await
    }

    async fn spawn_pi_runtime(self: &Arc<Self>, session: SessionRecord) -> Result<(), AgentError> {
        let launch = PiLaunch {
            program: resolve_pi_program(),
            prefix_args: Vec::new(),
            cwd: session.cwd.clone(),
            session_dir: self.base_path.join("pi-sessions"),
            session_name: session.name.clone(),
            provider: nonempty(session.provider.clone()),
            model: nonempty(session.model_id.clone()),
            resume_session: session.pi_session_file.clone(),
        };
        let mut spawned = pi_rpc::spawn(launch).await.map_err(agent_rpc_error)?;
        let state = spawned
            .handle
            .request(PiCommand::GetState)
            .await
            .map_err(agent_rpc_error)?;
        self.update_pi_identity(&session.id, &state.data).await?;

        let handle = spawned.handle.clone();
        self.runtimes
            .lock()
            .await
            .insert(session.id.clone(), RuntimeHandle::Pi(handle));

        let module = Arc::clone(self);
        tokio::spawn(async move {
            while let Some(notification) = spawned.notifications.recv().await {
                match notification {
                    PiNotification::Event(event) => {
                        if let Err(error) = module.append_event(&session.id, event).await {
                            log::error!(
                                "Failed to append pi event for {}: {}",
                                session.id,
                                error.message
                            );
                        }
                    }
                    PiNotification::Stderr(text) => {
                        let _ = module
                            .append_event(
                                &session.id,
                                json!({ "type": "agent_stderr", "text": text }),
                            )
                            .await;
                    }
                    PiNotification::ProtocolError(message) => {
                        let _ = module
                            .append_event(
                                &session.id,
                                json!({ "type": "agent_protocol_error", "message": message }),
                            )
                            .await;
                    }
                    PiNotification::Exited {
                        success,
                        detail,
                        requested,
                    } => {
                        module.runtimes.lock().await.remove(&session.id);
                        if let Ok(current) = module.get_session(&session.id).await
                            && matches!(
                                current.status,
                                SessionStatus::Starting | SessionStatus::Running
                            )
                        {
                            let next = if current.status == SessionStatus::Running
                                && (requested || success)
                            {
                                SessionStatus::Stopped
                            } else {
                                SessionStatus::Errored
                            };
                            let last_error = (next == SessionStatus::Errored).then_some(detail);
                            let _ = module.set_status(&session.id, next, last_error).await;
                        }
                        break;
                    }
                }
            }
        });
        Ok(())
    }

    async fn spawn_mock_runtime(self: &Arc<Self>, id: String) -> Result<(), AgentError> {
        let (input_tx, mut input_rx) = mpsc::channel(32);
        let (stop_tx, mut stop_rx) = oneshot::channel();
        self.runtimes.lock().await.insert(
            id.clone(),
            RuntimeHandle::Mock {
                input: input_tx,
                stop: stop_tx,
            },
        );

        let module = Arc::clone(self);
        tokio::spawn(async move {
            loop {
                tokio::select! {
                    Some(command) = input_rx.recv() => {
                        match command {
                            PiCommand::Prompt { message, .. }
                            | PiCommand::Steer { message }
                            | PiCommand::FollowUp { message } => {
                                module.emit_mock_turn(&id, &message).await;
                            }
                            PiCommand::Abort => {
                                let _ = module.append_event(&id, json!({ "type": "agent_end", "messages": [] })).await;
                                let _ = module.append_event(&id, json!({ "type": "agent_settled" })).await;
                            }
                            PiCommand::GetState => {}
                        }
                    }
                    _ = &mut stop_rx => break,
                }
            }
        });
        Ok(())
    }

    async fn emit_mock_turn(&self, id: &str, prompt: &str) {
        let user_message = json!({
            "role": "user",
            "content": [{ "type": "text", "text": prompt }],
            "timestamp": now_ms()
        });
        let _ = self
            .append_event(id, json!({ "type": "agent_start" }))
            .await;
        let _ = self
            .append_event(
                id,
                json!({ "type": "message_start", "message": user_message }),
            )
            .await;
        let _ = self
            .append_event(
                id,
                json!({
                    "type": "message_end",
                    "message": {
                        "role": "user",
                        "content": [{ "type": "text", "text": prompt }],
                        "timestamp": now_ms()
                    }
                }),
            )
            .await;
        let _ = self
            .append_event(
                id,
                json!({
                    "type": "message_start",
                    "message": {
                        "role": "assistant",
                        "content": [],
                        "timestamp": now_ms()
                    }
                }),
            )
            .await;

        let response = format!(
            "Mock pi received: “{}”. Set STATION_AGENT_MOCK=0 and install the pinned pi runtime to use the real RPC process.",
            prompt.trim()
        );
        for chunk in response.as_bytes().chunks(24) {
            let delta = String::from_utf8_lossy(chunk);
            let _ = self
                .append_event(
                    id,
                    json!({
                        "type": "message_update",
                        "assistantMessageEvent": {
                            "type": "text_delta",
                            "delta": delta
                        }
                    }),
                )
                .await;
            sleep(Duration::from_millis(60)).await;
        }
        let _ = self
            .append_event(
                id,
                json!({
                    "type": "message_end",
                    "message": {
                        "role": "assistant",
                        "content": [{ "type": "text", "text": response }],
                        "timestamp": now_ms()
                    }
                }),
            )
            .await;
        let _ = self
            .append_event(id, json!({ "type": "agent_end", "messages": [] }))
            .await;
        let _ = self
            .append_event(id, json!({ "type": "agent_settled" }))
            .await;
    }

    async fn update_pi_identity(&self, id: &str, state: &Value) -> Result<(), AgentError> {
        {
            let mut sessions = self.sessions.write().await;
            let session = sessions
                .get_mut(id)
                .ok_or_else(|| AgentError::not_found(id))?;
            session.pi_session_file = state
                .get("sessionFile")
                .and_then(Value::as_str)
                .map(PathBuf::from);
            session.pi_session_id = state
                .get("sessionId")
                .and_then(Value::as_str)
                .map(str::to_owned);
            session.updated_at_ms = now_ms();
        }
        self.persist_sessions().await.map_err(AgentError::internal)
    }

    async fn set_status(
        &self,
        id: &str,
        next: SessionStatus,
        last_error: Option<String>,
    ) -> Result<(), AgentError> {
        {
            let mut sessions = self.sessions.write().await;
            let session = sessions
                .get_mut(id)
                .ok_or_else(|| AgentError::not_found(id))?;
            if session.status != next && !session.status.can_transition_to(next) {
                return Err(AgentError::conflict(
                    "invalid_session_transition",
                    format!(
                        "Cannot transition session from {:?} to {:?}",
                        session.status, next
                    ),
                ));
            }
            session.status = next;
            session.updated_at_ms = now_ms();
            session.last_error = last_error;
        }
        self.persist_sessions().await.map_err(AgentError::internal)
    }

    async fn append_event(&self, id: &str, event: Value) -> Result<(), AgentError> {
        let mut events_by_session = self.events.lock().await;
        let events = events_by_session
            .get_mut(id)
            .ok_or_else(|| AgentError::not_found(id))?;
        let seq = events.last().map_or(1, |event| event.seq + 1);
        let event = AgentEvent {
            seq,
            at_ms: now_ms(),
            event,
        };
        events.push(event.clone());
        if events.len() > MAX_EVENTS_PER_SESSION {
            events.remove(0);
        }

        let mut encoded =
            serde_json::to_vec(&event).map_err(|error| AgentError::internal(error.to_string()))?;
        encoded.push(b'\n');
        let mut file = tokio::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(self.event_path(id))
            .await
            .map_err(|error| AgentError::internal(error.to_string()))?;
        file.write_all(&encoded)
            .await
            .map_err(|error| AgentError::internal(error.to_string()))
    }

    async fn persist_sessions(&self) -> Result<(), String> {
        let sessions = self.sessions.read().await;
        let bytes = serde_json::to_vec_pretty(&*sessions).map_err(|error| error.to_string())?;
        drop(sessions);
        let temporary = self.base_path.join("sessions.json.tmp");
        tokio::fs::write(&temporary, bytes)
            .await
            .map_err(|error| error.to_string())?;
        tokio::fs::rename(temporary, self.base_path.join("sessions.json"))
            .await
            .map_err(|error| error.to_string())
    }

    fn event_path(&self, id: &str) -> PathBuf {
        self.base_path.join("sessions").join(format!("{id}.jsonl"))
    }
}

fn agent_rpc_error(error: PiRpcError) -> AgentError {
    let code = match error {
        PiRpcError::Spawn(_) => "pi_spawn_failed",
        PiRpcError::Transport(_) => "pi_transport_failed",
        PiRpcError::Protocol(_) => "pi_protocol_error",
        PiRpcError::Timeout(_) => "pi_request_timeout",
        PiRpcError::Rejected(_) => "pi_command_rejected",
    };
    AgentError::runtime(code, error.to_string())
}

fn default_mode() -> SessionMode {
    SessionMode::Headless
}

fn default_cwd() -> PathBuf {
    PathBuf::from(".")
}

fn nonempty(value: String) -> Option<String> {
    (!value.is_empty()).then_some(value)
}

fn mock_enabled() -> bool {
    std::env::var("STATION_AGENT_MOCK").is_ok_and(|value| {
        matches!(
            value.trim().to_ascii_lowercase().as_str(),
            "1" | "true" | "yes"
        )
    })
}

fn resolve_pi_program() -> PathBuf {
    if let Some(configured) = std::env::var_os("STATION_PI_BIN").filter(|value| !value.is_empty()) {
        return PathBuf::from(configured);
    }
    let local =
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../agent-runtime/node_modules/.bin/pi");
    if local.is_file() {
        local
    } else {
        PathBuf::from("pi")
    }
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}

async fn load_events(base_path: &Path, id: &str) -> Result<Vec<AgentEvent>, std::io::Error> {
    let path = base_path.join("sessions").join(format!("{id}.jsonl"));
    let contents = match tokio::fs::read_to_string(path).await {
        Ok(contents) => contents,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(error),
    };
    let mut events: Vec<_> = contents
        .lines()
        .filter_map(|line| serde_json::from_str(line).ok())
        .collect();
    if events.len() > MAX_EVENTS_PER_SESSION {
        events.drain(..events.len() - MAX_EVENTS_PER_SESSION);
    }
    Ok(events)
}

#[cfg(test)]
mod tests {
    use super::{SessionStatus, mock_enabled};

    #[test]
    fn lifecycle_requires_explicit_resume() {
        assert!(SessionStatus::Starting.can_transition_to(SessionStatus::Running));
        assert!(SessionStatus::Running.can_transition_to(SessionStatus::Stopped));
        assert!(SessionStatus::Stopped.can_transition_to(SessionStatus::Starting));
        assert!(!SessionStatus::Stopped.can_transition_to(SessionStatus::Running));
        assert!(!SessionStatus::Running.can_transition_to(SessionStatus::Starting));
    }

    #[test]
    fn mock_is_not_enabled_by_default() {
        if std::env::var_os("STATION_AGENT_MOCK").is_none() {
            assert!(!mock_enabled());
        }
    }
}
