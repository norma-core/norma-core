use crate::agent::{AgentError, AgentModule, CreateSessionRequest, PromptRequest};
use crate::web::content_encoding;
use bytes::Bytes;
use http_body_util::{BodyExt, Empty, Full, combinators::BoxBody};
use hyper::{Method, Request, Response, StatusCode, body::Incoming};
use hyper_util::rt::{TokioExecutor, TokioIo};
use hyper_util::server::conn::auto;
use normfs::NormFS;
use rust_embed::RustEmbed;
use serde::Serialize;
use serde::de::DeserializeOwned;
use serde_json::json;
use std::error::Error;
use std::net::SocketAddr;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tokio::net::TcpListener;

#[derive(RustEmbed)]
#[folder = "../../clients/station-viewer/dist"]
struct Asset;

fn empty() -> BoxBody<Bytes, hyper::Error> {
    Empty::<Bytes>::new()
        .map_err(|never| match never {})
        .boxed()
}

fn full<T: Into<Bytes>>(chunk: T) -> BoxBody<Bytes, hyper::Error> {
    Full::new(chunk.into())
        .map_err(|never| match never {})
        .boxed()
}

struct WebServer {
    normfs: Arc<NormFS>,
    agent: Arc<AgentModule>,
}

// Routes taken from `software/station/clients/station-viewer/src/App.tsx`.
const SPA_ROUTE_ALLOWLIST: [&str; 5] = [
    "/",
    "/agent",
    "/history",
    "/st3215-bus-calibration",
    "/st3215-bind-motors",
];

impl WebServer {
    fn normalize_route_path(path: &str) -> &str {
        // Normalize trailing slashes (except keep "/" as-is).
        if path != "/" {
            path.trim_end_matches('/')
        } else {
            path
        }
    }

    fn is_spa_route(path: &str) -> bool {
        let normalized = Self::normalize_route_path(path);
        SPA_ROUTE_ALLOWLIST.contains(&normalized)
    }

    async fn handle_client(
        self: Arc<Self>,
        mut req: Request<Incoming>,
    ) -> Result<Response<BoxBody<Bytes, hyper::Error>>, Box<dyn Error + Send + Sync>> {
        if req.uri().path().starts_with("/api/sessions") {
            return Ok(self.handle_agent_api(req).await);
        }

        if fastwebsockets::upgrade::is_upgrade_request(&req) {
            let (response, fut) = fastwebsockets::upgrade::upgrade(&mut req)?;
            let normfs = self.normfs.clone();

            tokio::spawn(async move {
                let upgraded = match fut.await {
                    Ok(upgraded) => upgraded,
                    Err(e) => {
                        log::error!("WebSocket upgrade error: {e:#}");
                        return;
                    }
                };

                static CLIENT_COUNTER: AtomicU64 = AtomicU64::new(1);
                let client_id = format!("ws-{}", CLIENT_COUNTER.fetch_add(1, Ordering::Relaxed));
                if let Err(e) =
                    normfs::server::websocket::handle_websocket(upgraded, normfs, client_id).await
                {
                    log::error!("NormFS WebSocket error: {e:#}");
                }
            });

            return Ok(response.map(|_| empty()));
        }

        let uri_path = req.uri().path();
        let asset_path = uri_path.trim_start_matches('/');
        let asset_path = if asset_path.is_empty() {
            "index.html"
        } else {
            asset_path
        };

        let gz_path = format!("{}.gz", asset_path);

        // Determine which encodings are available for this asset
        let mut available_encodings = Vec::new();
        if Asset::get(&gz_path).is_some() {
            available_encodings.push(content_encoding::Encoding::Gzip);
        }
        if Asset::get(asset_path).is_some() {
            available_encodings.push(content_encoding::Encoding::Identity);
        }

        // Negotiate the best encoding based on client preferences
        let chosen_encoding = if !available_encodings.is_empty() {
            content_encoding::negotiate_encoding(req.headers(), &available_encodings)
        } else {
            content_encoding::Encoding::Identity
        };

        // Select the appropriate file based on negotiated encoding
        let (asset_result, encoding_used) = match chosen_encoding {
            content_encoding::Encoding::Gzip => (Asset::get(&gz_path), Some("gzip")),
            content_encoding::Encoding::Identity => (Asset::get(asset_path), None),
        };

        if let Some(content) = asset_result {
            let mime = mime_guess::from_path(asset_path).first_or_octet_stream();
            let mut response = Response::new(full(content.data.to_vec()));
            response.headers_mut().insert(
                hyper::header::CONTENT_TYPE,
                hyper::header::HeaderValue::from_str(mime.as_ref())?,
            );

            // Add Content-Encoding header if serving compressed content
            if let Some(encoding) = encoding_used {
                response.headers_mut().insert(
                    hyper::header::CONTENT_ENCODING,
                    hyper::header::HeaderValue::from_static(encoding),
                );
            }

            // Add Vary header for proper cache behavior
            response.headers_mut().insert(
                hyper::header::VARY,
                hyper::header::HeaderValue::from_static("Accept-Encoding"),
            );

            let has_js_hash = asset_path
                .matches(r"-[a-zA-Z0-9]{8,}\.js(\.gz)?$")
                .next()
                .is_some();

            let is_static_asset = asset_path.ends_with(".stl")
                || asset_path.ends_with(".stl.gz")
                || asset_path.ends_with(".urdf")
                || asset_path.ends_with(".urdf.gz")
                || asset_path == "logo.svg";

            let cache_header = if has_js_hash || is_static_asset {
                "public, max-age=31536000, immutable"
            } else {
                "no-store, no-cache, must-revalidate"
            };
            response.headers_mut().insert(
                hyper::header::CACHE_CONTROL,
                hyper::header::HeaderValue::from_static(cache_header),
            );
            return Ok(response);
        }

        let is_get_or_head =
            req.method() == hyper::Method::GET || req.method() == hyper::Method::HEAD;
        if is_get_or_head
            && Self::is_spa_route(uri_path)
            && let Some(content) = Asset::get("index.html")
        {
            let mime = mime_guess::from_path("index.html").first_or_octet_stream();
            let mut response = Response::new(full(content.data.to_vec()));
            response.headers_mut().insert(
                hyper::header::CONTENT_TYPE,
                hyper::header::HeaderValue::from_str(mime.as_ref())?,
            );
            response.headers_mut().insert(
                hyper::header::CACHE_CONTROL,
                hyper::header::HeaderValue::from_static("no-store, no-cache, must-revalidate"),
            );
            return Ok(response);
        }

        let mut response = Response::new(empty());
        *response.status_mut() = hyper::StatusCode::NOT_FOUND;
        Ok(response)
    }

    async fn handle_agent_api(
        &self,
        req: Request<Incoming>,
    ) -> Response<BoxBody<Bytes, hyper::Error>> {
        let method = req.method().clone();
        let path = req.uri().path().to_owned();
        let query = req.uri().query().unwrap_or_default().to_owned();
        let segments: Vec<_> = path
            .trim_matches('/')
            .split('/')
            .filter(|segment| !segment.is_empty())
            .collect();

        let result = match (method, segments.as_slice()) {
            (Method::GET, ["api", "sessions"]) => Ok(api_ok(self.agent.list_sessions().await)),
            (Method::POST, ["api", "sessions"]) => {
                match parse_json_body::<CreateSessionRequest>(req).await {
                    Ok(request) => self.agent.create_session(request).await.map(|session| {
                        api_response(StatusCode::CREATED, json!({ "ok": true, "data": session }))
                    }),
                    Err(error) => Err(error),
                }
            }
            (Method::GET, ["api", "sessions", id]) => self.agent.get_session(id).await.map(api_ok),
            (Method::DELETE, ["api", "sessions", id]) => self
                .agent
                .delete(id)
                .await
                .map(|()| api_ok(json!({ "deleted": true }))),
            (Method::POST, ["api", "sessions", id, "prompt"]) => {
                match parse_json_body::<PromptRequest>(req).await {
                    Ok(request) => self.agent.prompt(id, request.message).await.map(|()| {
                        api_response(
                            StatusCode::ACCEPTED,
                            json!({ "ok": true, "data": { "accepted": true } }),
                        )
                    }),
                    Err(error) => Err(error),
                }
            }
            (Method::POST, ["api", "sessions", id, "steer"]) => {
                match parse_json_body::<PromptRequest>(req).await {
                    Ok(request) => self.agent.steer(id, request.message).await.map(|()| {
                        api_response(
                            StatusCode::ACCEPTED,
                            json!({ "ok": true, "data": { "accepted": true } }),
                        )
                    }),
                    Err(error) => Err(error),
                }
            }
            (Method::POST, ["api", "sessions", id, "follow-up"]) => {
                match parse_json_body::<PromptRequest>(req).await {
                    Ok(request) => self.agent.follow_up(id, request.message).await.map(|()| {
                        api_response(
                            StatusCode::ACCEPTED,
                            json!({ "ok": true, "data": { "accepted": true } }),
                        )
                    }),
                    Err(error) => Err(error),
                }
            }
            (Method::POST, ["api", "sessions", id, "abort"]) => self
                .agent
                .abort(id)
                .await
                .map(|()| api_ok(json!({ "aborted": true }))),
            (Method::POST, ["api", "sessions", id, "stop"]) => {
                self.agent.stop(id).await.map(api_ok)
            }
            (Method::POST, ["api", "sessions", id, "resume"]) => {
                self.agent.resume(id).await.map(api_ok)
            }
            (Method::GET, ["api", "sessions", id, "events"]) => {
                let after = query_param(&query, "after")
                    .and_then(|value| value.parse::<u64>().ok())
                    .unwrap_or(0);
                self.agent
                    .events_after(id, after)
                    .await
                    .map(|events| api_ok(json!({ "events": events })))
            }
            _ => Err(AgentError {
                status: StatusCode::NOT_FOUND,
                code: "route_not_found",
                message: format!("No agent API route for {path}"),
            }),
        };

        result.unwrap_or_else(api_error)
    }
}

pub async fn start_server(
    addr: SocketAddr,
    normfs: Arc<NormFS>,
    agent: Arc<AgentModule>,
    shutdown: Arc<AtomicBool>,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let listener = TcpListener::bind(addr).await?;
    log::info!("WebSocket server listening on {}", addr);
    let server = Arc::new(WebServer { normfs, agent });

    loop {
        tokio::select! {
            biased;
            _ = async {
                while !shutdown.load(Ordering::Relaxed) {
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                }
            } => {
                log::info!("Web server shutting down.");
                break;
            }
            res = listener.accept() => {
                if let Ok((stream, _)) = res {
                    let server = server.clone();
                    let hyper_service =
                        hyper::service::service_fn(move |req: Request<Incoming>| server.clone().handle_client(req));

                    tokio::spawn(async move {
                        if let Err(e) = auto::Builder::new(TokioExecutor::new())
                            .serve_connection_with_upgrades(TokioIo::new(stream), hyper_service)
                            .await
                        {
                            log::error!("failed to serve connection: {e:#}");
                        }
                    });
                }
            }
        }
    }

    Ok(())
}

async fn parse_json_body<T: DeserializeOwned>(req: Request<Incoming>) -> Result<T, AgentError> {
    let bytes = req
        .into_body()
        .collect()
        .await
        .map_err(|error| AgentError {
            status: StatusCode::BAD_REQUEST,
            code: "invalid_request_body",
            message: error.to_string(),
        })?
        .to_bytes();
    serde_json::from_slice(&bytes).map_err(|error| AgentError {
        status: StatusCode::BAD_REQUEST,
        code: "invalid_json",
        message: error.to_string(),
    })
}

fn api_ok<T: Serialize>(data: T) -> Response<BoxBody<Bytes, hyper::Error>> {
    api_response(StatusCode::OK, json!({ "ok": true, "data": data }))
}

fn api_error(error: AgentError) -> Response<BoxBody<Bytes, hyper::Error>> {
    api_response(
        error.status,
        json!({
            "ok": false,
            "error": {
                "code": error.code,
                "message": error.message,
            }
        }),
    )
}

fn api_response(
    status: StatusCode,
    value: serde_json::Value,
) -> Response<BoxBody<Bytes, hyper::Error>> {
    let mut response = Response::new(full(value.to_string()));
    *response.status_mut() = status;
    response.headers_mut().insert(
        hyper::header::CONTENT_TYPE,
        hyper::header::HeaderValue::from_static("application/json"),
    );
    response.headers_mut().insert(
        hyper::header::CACHE_CONTROL,
        hyper::header::HeaderValue::from_static("no-store"),
    );
    response
}

fn query_param<'a>(query: &'a str, name: &str) -> Option<&'a str> {
    query.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=')?;
        (key == name).then_some(value)
    })
}
