use clap::Parser;
use station_iface::StationEngine;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use normfs::{NormFS, NormFsSettings, CloudSettings, QueueSettings, QueueConfig};
use normfs_types::{CompressionType, EncryptionType};
use crate::queues::MainQueue;
use parking_lot::Mutex;

pub mod station_proto {
    pub mod opts {
        include!("proto/opts.rs");
    }
    pub mod drivers {
        pub use station_iface::iface_proto::drivers::QueueDataType;
    }
    pub mod commands {
        pub use station_iface::iface_proto::commands::{DriverCommand, StationCommandsPack};
    }
    pub mod inference {
        pub use station_iface::iface_proto::inference::*;
    }
    pub mod startups {
        include!("proto/startups.rs");
    }
    pub mod inference_tags {
        include!("proto/inference_tags.rs");
    }
}

mod queues;
mod inference;
mod tags;
mod web;

const VERSION: &str = concat!(
    env!("CARGO_PKG_VERSION"),
    " (",
    env!("GIT_HASH"),
    ")"
);

/// NormaCore.Dev station: physical operations platform
#[derive(Parser, Debug)]
#[command(name = "NormaCore.Dev station", author, version = VERSION, about, long_about = None)]
struct Args {
    /// Maximum queue disk size in bytes
    #[arg(long, default_value = "2147483648")] // 2GB default
    max_queue_disk_size: u64,

    /// Base folder for normfs storage
    #[arg(long, default_value = "./station_data")]
    normfs_base_folder: PathBuf,
    
    /// Path to configuration file
    #[arg(short, long, default_value = "station.yaml")]
    config: PathBuf,

    /// Addr to listen for normfs TCP server. If provided without a value, it will listen on 0.0.0.0:8888.
    #[arg(short, long, num_args = 0..=1, default_missing_value = "0.0.0.0:8888")]
    tcp: Option<String>,

    /// Addr to listen for websocket server. If provided without a value, it will listen on 0.0.0.0:8889.
    #[arg(long, num_args = 0..=1, default_missing_value = "0.0.0.0:8889")]
    web: Option<String>,
}

struct Station {
    normfs: Arc<NormFS>,
    config: station_iface::config::Config,
    base_path: PathBuf,

    engine: Arc<Engine>,

    #[cfg(target_os = "macos")]
    usbvideo_instances: parking_lot::Mutex<Vec<Arc<usbvideo::pipeline::USBVideoManager<usbvideo::osx::CameraMacDriver>>>>,
    #[cfg(target_os = "linux")]
    usbvideo_instances: parking_lot::Mutex<Vec<Arc<usbvideo::pipeline::USBVideoManager<usbvideo::linux::CameraLinuxDriver>>>>,

    #[cfg(feature = "ov5647")]
    ov5647_handle: Mutex<Option<ov5647::Ov5647Handle>>,

    motors_mirroring_inference: Mutex<Option<Arc<motors_mirroring::inference::Inference>>>,
}

struct Engine {
    main_queue: Option<MainQueue>,
    inference: Mutex<Option<inference::Inference>>,
}

impl station_iface::StationEngine for Engine {
    fn register_queue(&self, queue_id: &normfs::QueueId, queue_data_type: station_iface::iface_proto::drivers::QueueDataType, opts: Vec<station_iface::iface_proto::envelope::QueueOpt>) {
        if let Some(main_queue) = &self.main_queue {
            let _ = main_queue.send_queue_start(queue_id, queue_data_type, opts);
        }

        // Register queue with inference for time synchronization
        if let Some(inference) = self.inference.lock().as_ref() {
            inference.register_queue(queue_id, queue_data_type as i32);
        }
    }
}

impl Station {
    async fn new(args: &Args) -> Result<Self, Box<dyn std::error::Error>> {
        env_logger::Builder::from_env(env_logger::Env::default().default_filter_or("info")).init();

        // Create station_data directory if it doesn't exist
        std::fs::create_dir_all(&args.normfs_base_folder)?;

        // Generate app_start_id based on current timestamp
        let app_start_id = systime::get_app_start_id();

        log::info!("App Start ID: {}", app_start_id);

        // Load configuration
        let config = station_iface::config::Config::load_or_default(&args.config)?;
        log::info!("Loaded configuration from: {:?}", args.config);

        let normfs = Self::initialize_normfs(args, &config).await?;

        log::info!("Instance ID: {}", normfs.get_instance_id());

        Ok(Station {
            normfs,
            config,
            base_path: args.normfs_base_folder.clone(),
            engine: Arc::new(Engine {
                main_queue: None,
                inference: Mutex::new(None),
            }),
            usbvideo_instances: parking_lot::Mutex::new(Vec::new()),
            #[cfg(feature = "ov5647")]
            ov5647_handle: Mutex::new(None),
            motors_mirroring_inference: Mutex::new(None),
        })
    }

    async fn initialize_normfs(
        args: &Args,
        config: &station_iface::config::Config,
    ) -> Result<Arc<NormFS>, Box<dyn std::error::Error>> {
        let mut settings = NormFsSettings {
            max_disk_usage_per_queue: Some(args.max_queue_disk_size),
            ..Default::default()
        };

        // Configure queue-specific settings
        settings.queue_settings = QueueSettings::new(
            vec![
                ("*video/*".to_string(), QueueConfig {
                    compression_type: CompressionType::None,
                    enable_fsync: false,
                    encryption_type: EncryptionType::Aes,
                }),
                ("*inference-queues/*".to_string(), QueueConfig {
                    compression_type: CompressionType::None,
                    enable_fsync: false,
                    encryption_type: EncryptionType::Aes,
                }),
            ],
            QueueConfig::default(), // default config for all other queues
        )?;

        // Configure Cloud settings if provided
        if let Some(cloud_config) = &config.cloud_offload {
            let get_or_env = |config_val: &str, env_var: &str| -> String {
                if config_val.is_empty() {
                    std::env::var(env_var).unwrap_or_default()
                } else {
                    config_val.to_string()
                }
            };

            let bucket = get_or_env(&cloud_config.bucket, "AWS_S3_BUCKET");
            let region = get_or_env(&cloud_config.region, "AWS_REGION");
            let access_key = get_or_env(&cloud_config.access_key_id, "AWS_ACCESS_KEY_ID");
            let secret_key = get_or_env(&cloud_config.secret_access_key, "AWS_SECRET_ACCESS_KEY");
            let endpoint = cloud_config.endpoint.clone()
                .or_else(|| std::env::var("AWS_ENDPOINT_URL").ok())
                .unwrap_or_default();

            settings.cloud_settings = Some(CloudSettings {
                endpoint,
                bucket: bucket.clone(),
                region,
                access_key,
                secret_key,
                prefix: String::new(), // NormFS will use instance_id as prefix automatically
            });

            log::info!("Cloud offload enabled for bucket: {}", bucket);
        }

        let normfs = NormFS::new(args.normfs_base_folder.clone(), settings).await?;

        Ok(Arc::new(normfs))
    }

    async fn start_main_queue(&mut self) -> Result<(), Box<dyn std::error::Error>> {
        let main_queue = MainQueue::new(self.normfs.clone(), self.normfs.get_instance_id_bytes()).await?;
        main_queue.send_app_start().unwrap();

        if let Some(engine) = Arc::get_mut(&mut self.engine) {
            engine.main_queue = Some(main_queue);
        }
        Ok(())
    }

    async fn start_drivers(&self) -> Result<(), Box<dyn std::error::Error>> {
        if self.config.drivers.system_info {
            sysinfod::start_system_monitor(
                self.normfs.clone(), self.engine.clone(),
            ).await?;
        }
        
        // Start ST3215 bus if configured
        let st3215_config = if let Some(st3215) = &self.config.drivers.st3215 {
            if st3215.enabled {
                match st3215::start_st3215_driver(self.normfs.clone(), self.engine.clone()).await {
                    Ok(_) => Some(st3215.clone()),
                    Err(e) => {
                        log::error!("Failed to start ST3215 driver: {}", e);
                        None
                    }
                }
            } else {
                None
            }
        } else {
            None
        };

        if let Some(st3215) = &st3215_config {
            // Start motors mirroring driver
            let motor_config = motors_mirroring::config::MotorConfig::from(st3215);

            let mirroring_inference = motors_mirroring::start(
                self.normfs.clone(),
                self.engine.clone(),
                motor_config,
            ).await?;
            *self.motors_mirroring_inference.lock() = Some(mirroring_inference);
        } else {
            log::info!("No motor drivers available for mirroring");
        }

        // Start USB camera monitoring if configured
        if let Some(usb_video) = &self.config.drivers.usb_video {
            if usb_video.enabled {
                let usb_instance = usbvideo::start_usbvideo(
                    self.normfs.clone(),
                    self.engine.clone(),
                    self.base_path.clone(),
                    usbvideo::USBVideoConfig {
                        resize_target: usb_video.resize_target,
                    },
                ).await;
                self.usbvideo_instances.lock().push(usb_instance);
            } else {
                log::info!("USB video monitoring disabled by configuration");
            }
        } else {
            log::info!("No USB video configuration found");
        }

        #[cfg(feature = "yahboom-dogzilla-lite")]
        if let Some(yahboom_dogzilla_lite_config) = &self.config.drivers.yahboom_dogzilla_lite {
            if yahboom_dogzilla_lite_config.enabled {
                let simulation = matches!(yahboom_dogzilla_lite_config.mode, station_iface::config::YahboomDogzillaLiteMode::Simulation);
                match yahboom_dogzilla_lite::start_yahboom_dogzilla_lite_driver(
                    self.normfs.clone(),
                    self.engine.clone(),
                    simulation,
                )
                .await
                {
                    Ok(_) => {
                        let mode = if simulation { "simulation" } else { "real" };
                        log::info!("Yahboom Dogzilla Lite driver started (mode: {})", mode);
                    },
                    Err(e) => log::warn!("Failed to start Yahboom Dogzilla Lite driver: {}", e),
                }
            } else {
                log::info!("Yahboom Dogzilla Lite driver disabled by configuration");
            }
        } else {
            log::info!("Yahboom Dogzilla Lite driver disabled by configuration");
        }

        #[cfg(not(feature = "yahboom-dogzilla-lite"))]
        if self.config.drivers.yahboom_dogzilla_lite.as_ref().is_some_and(|config| config.enabled) {
            log::warn!("Yahboom Dogzilla Lite driver requested but not compiled (missing 'yahboom-dogzilla-lite' feature)");
        }

        #[cfg(feature = "ov5647")]
        if let Some(ov5647_config) = &self.config.drivers.ov5647 {
            if ov5647_config.enabled {
                let (width, height) =
                    match station_iface::config::parse_ov5647_dimension(&ov5647_config.dimension) {
                        Some((w, h)) => (w, h),
                        None => {
                            if !ov5647_config.dimension.trim().is_empty() {
                                log::warn!(
                                    "Invalid OV5647 dimension '{}', using default {}x{}",
                                    ov5647_config.dimension,
                                    ov5647::DEFAULT_WIDTH,
                                    ov5647::DEFAULT_HEIGHT,
                                );
                            }
                            (ov5647::DEFAULT_WIDTH, ov5647::DEFAULT_HEIGHT)
                        }
                    };

                match ov5647::start_ov5647(
                    self.normfs.clone(),
                    self.engine.clone(),
                    width,
                    height,
                    ov5647_config.frames_per_second as u32,
                    "video/ov5647",
                )
                .await
                {
                    Ok(handle) => {
                        *self.ov5647_handle.lock() = Some(handle);
                        log::info!("OV5647 driver started");
                    }
                    Err(e) => log::warn!("Failed to start OV5647 driver: {}", e),
                }
            } else {
                log::info!("OV5647 driver disabled by configuration");
            }
        } else {
            log::info!("No OV5647 configuration found");
        }

        #[cfg(not(feature = "ov5647"))]
        if self.config.drivers.ov5647.as_ref().map_or(false, |c| c.enabled) {
            log::warn!("OV5647 driver requested but not compiled (missing 'ov5647' feature)");
        }

        match &self.config.inference {
            Some(inference_configs) => {
                if !inference_configs.is_empty() {
                    log::info!("Starting inference driver with {} configurations", inference_configs.len());
                    inferences::start(
                        self.normfs.clone(),
                        self.engine.clone(),
                        inference_configs.clone(),
                    ).await?;
                } else {
                    log::info!("Inference explicitly disabled (empty config)");
                }
            }
            None => {
                // User did not specify inference config, use default normvla
                log::info!("No inference configuration found, using default normvla config");
                let default_config = vec![station_iface::config::Inference::default_normvla()];
                inferences::start(
                    self.normfs.clone(),
                    self.engine.clone(),
                    default_config,
                ).await?;
            }
        }

        Ok(())
    }

    async fn start_server(
        &self,
        addr: SocketAddr,
    ) -> Result<tokio::task::JoinHandle<()>, Box<dyn std::error::Error>> {
        let server = normfs::server::Server::new(addr, self.normfs.clone()).await?;
        log::info!("NormFS server listening on {}", addr);

        Ok(tokio::spawn(async move {
            if let Err(e) = server.run().await {
                log::error!("Server error: {}", e);
            }
        }))
    }

    async fn shutdown(&self) -> Result<(), Box<dyn std::error::Error>> {
        log::info!("Stopping USB video instances...");
        let instances_to_stop = {
            let instances = self.usbvideo_instances.lock();
            instances.iter().cloned().collect::<Vec<_>>()
        };
        for instance in instances_to_stop.iter() {
            instance.stop().await;
        }
        log::info!("USB video instances stopped");

        #[cfg(feature = "ov5647")]
        if let Some(handle) = self.ov5647_handle.lock().take() {
            log::info!("Stopping OV5647 driver...");
            handle.stop().await;
            log::info!("OV5647 driver stopped");
        }

        if let Some(mirroring_inference) = self.motors_mirroring_inference.lock().as_ref() {
            log::info!("Stopping any active gravity compensation tasks...");
            mirroring_inference.stop_all_gravity_comp();
        }

        log::info!("Closing NormFS (writing WAL)...");

        self.normfs.close().await?;
        log::info!("NormFS closed successfully");

        Ok(())
    }


    async fn start_commands_queue(&self) -> Result<(), Box<dyn std::error::Error>> {
        let queue_id = self.normfs.resolve(station_iface::COMMANDS_QUEUE_ID);
        self.normfs.ensure_queue_exists_for_write(&queue_id).await?;
        self.engine.register_queue(
            &queue_id,
            station_iface::iface_proto::drivers::QueueDataType::QdtStationCommands,
             vec![],
        );
        Ok(())
    }
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();

    log::info!("TCP address: {:?}", args.tcp);
    log::info!("Max queue disk size: {} bytes", args.max_queue_disk_size);
    log::info!("NormFS base folder: {:?}", args.normfs_base_folder);
    log::info!("Configuration file: {:?}", args.config);

    let mut station = Station::new(&args).await?;

    station.start_main_queue().await?;
    log::info!("Main queue started");

    inference::Inference::start_queue(&station.normfs).await?;
    log::info!("Inference queue started");

    station.start_commands_queue().await?;

    tags::start(station.normfs.clone()).await?;

    let inference = inference::Inference::start(
        station.normfs.clone(),
    );
    *station.engine.inference.lock() = Some(inference);

    station.start_drivers().await?;
    log::info!("Drivers started");

    let mut server_handle: Option<tokio::task::JoinHandle<()>> = None;
    if let Some(tcp_addr_str) = args.tcp {
        let tcp_addr: SocketAddr = tcp_addr_str
            .parse()
            .or_else(|_| format!("0.0.0.0:{}", tcp_addr_str).parse())
            .map_err(|e| format!("Invalid address '{}': {}", tcp_addr_str, e))?;

        if let Err(e) = tokio::net::TcpListener::bind(tcp_addr).await {
            panic!("NormFS TCP port {} is busy: {}", tcp_addr.port(), e);
        }

        server_handle = Some(station.start_server(tcp_addr).await?);
    }

    let web_shutdown = Arc::new(AtomicBool::new(false));
    let mut web_server_handle: Option<tokio::task::JoinHandle<()>> = None;
    if let Some(web_addr_str) = args.web {
        let web_addr: SocketAddr = web_addr_str
            .parse()
            .or_else(|_| format!("0.0.0.0:{}", web_addr_str).parse())
            .map_err(|e| format!("Invalid address '{}': {}", web_addr_str, e))?;

        if let Err(e) = tokio::net::TcpListener::bind(web_addr).await {
            panic!("Web server port {} is busy: {}", web_addr.port(), e);
        }
        
        let normfs_clone = station.normfs.clone();
        let web_shutdown_clone = web_shutdown.clone();
        web_server_handle = Some(tokio::spawn(async move {
            if let Err(e) = web::server::start_server(
                web_addr,
                normfs_clone,
                web_shutdown_clone,
            )
            .await
            {
                log::error!("Web server error: {}", e);
            }
        }));
    }

    // On macOS, periodically tick the main run loop for AVFoundation notifications
    // This MUST run on the main thread, so we use select! instead of spawn
    #[cfg(target_os = "macos")]
    {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_millis(100));
        loop {
            tokio::select! {
                _ = interval.tick() => {
                    // Runs on main thread - tick the run loop
                    usbvideo::process_main_run_loop();
                }
                _ = tokio::signal::ctrl_c() => {
                    log::info!("\nShutting down...");
                    break;
                }
            }
        }
    }

    #[cfg(not(target_os = "macos"))]
    {
        tokio::signal::ctrl_c().await?;
        log::info!("\nShutting down...");
    }

    if let Some(handle) = web_server_handle {
        log::info!("Shutting down web server...");
        web_shutdown.store(true, Ordering::Relaxed);
        if let Err(e) = handle.await {
            log::error!("Web server shutdown error: {}", e);
        } else {
            log::info!("Web server shut down.");
        }
    }

    if let Some(handle) = server_handle {
        log::info!("Shutting down TCP server...");
        handle.abort();
        log::info!("TCP server shut down.");
    }

    if let Some(inference) = station.engine.inference.lock().as_ref() {
        inference.shutdown();
    }

    station.shutdown().await?;

    log::info!("Data persisted at: {:?}", args.normfs_base_folder);
    
    Ok(())
}
