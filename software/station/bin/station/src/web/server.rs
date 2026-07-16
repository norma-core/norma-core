use crate::web::content_encoding;
use bytes::Bytes;
use http_body_util::{BodyExt, Empty, Full, combinators::BoxBody};
use hyper::{Request, Response, body::Incoming};
use hyper_util::rt::{TokioExecutor, TokioIo};
use hyper_util::server::conn::auto;
use normfs::NormFS;
use rust_embed::RustEmbed;
use std::error::Error;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use tokio::net::TcpListener;

#[derive(RustEmbed)]
#[folder = "../../clients/station-viewer/dist"]
struct Asset;

// Asset key `rust_embed` uses for the ElRobot follower URDF (matches
// `elrobotUrdfPath` in station-viewer's `devices/elrobot/config.ts`), the
// only asset `--elrobot-urdf-path` is allowed to override.
const ELROBOT_FOLLOWER_URDF_ASSET: &str = "devices/elrobot/elrobot_follower.urdf";

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
    elrobot_urdf_override: Option<PathBuf>,
}

// Routes taken from `software/station/clients/station-viewer/src/App.tsx`.
const SPA_ROUTE_ALLOWLIST: [&str; 4] = [
    "/",
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

        if asset_path == ELROBOT_FOLLOWER_URDF_ASSET
            && let Some(override_path) = &self.elrobot_urdf_override
        {
            match tokio::fs::read(override_path).await {
                Ok(bytes) => {
                    let mime = mime_guess::from_path(asset_path).first_or_octet_stream();
                    let mut response = Response::new(full(bytes));
                    response.headers_mut().insert(
                        hyper::header::CONTENT_TYPE,
                        hyper::header::HeaderValue::from_str(mime.as_ref())?,
                    );
                    // Deliberately not immutable/long-lived like the embedded
                    // asset's cache header: the whole point of this override
                    // is to iterate on the file on disk between reloads.
                    response.headers_mut().insert(
                        hyper::header::CACHE_CONTROL,
                        hyper::header::HeaderValue::from_static("no-store, no-cache, must-revalidate"),
                    );
                    return Ok(response);
                }
                Err(e) => {
                    log::error!(
                        "Failed to read ElRobot URDF override at {override_path:?}: {e:#}. Falling back to the embedded asset."
                    );
                }
            }
        }

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
}

pub async fn start_server(
    addr: SocketAddr,
    normfs: Arc<NormFS>,
    shutdown: Arc<AtomicBool>,
    elrobot_urdf_override: Option<PathBuf>,
) -> Result<(), Box<dyn Error + Send + Sync>> {
    let listener = TcpListener::bind(addr).await?;
    log::info!("WebSocket server listening on {}", addr);
    let server = Arc::new(WebServer {
        normfs,
        elrobot_urdf_override,
    });

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
