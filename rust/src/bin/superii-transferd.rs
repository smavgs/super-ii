use clap::Parser;
use std::net::{IpAddr, Ipv4Addr};
use std::path::PathBuf;
use std::time::Duration;
use superii_data_plane::transfer::{
    DEFAULT_MAX_CHUNK_BYTES, DEFAULT_MAX_UPLOAD_BYTES, TransferStore, cleanup_expired, parse_bind,
    serve,
};
use superii_data_plane::transfer_resources::TransferLimits;

#[derive(Debug, Parser)]
#[command(
    version,
    about = "Loopback-only resumable transfer service for Super ii"
)]
struct Arguments {
    #[arg(long, env = "SUPERII_TRANSFER_ROOT")]
    root: PathBuf,
    #[arg(long, env = "SUPERII_TRANSFER_TOKEN", hide_env_values = true)]
    token: String,
    #[arg(
        long,
        env = "SUPERII_TRANSFER_HOST",
        default_value_t = IpAddr::V4(Ipv4Addr::LOCALHOST)
    )]
    host: IpAddr,
    #[arg(long, env = "SUPERII_TRANSFER_PORT", default_value_t = 8790)]
    port: u16,
    #[arg(
        long,
        env = "SUPERII_MAX_UPLOAD_BYTES",
        default_value_t = DEFAULT_MAX_UPLOAD_BYTES
    )]
    max_upload_bytes: u64,
    #[arg(
        long,
        env = "SUPERII_TRANSFER_MAX_CHUNK_BYTES",
        default_value_t = DEFAULT_MAX_CHUNK_BYTES
    )]
    max_chunk_bytes: u64,
    #[arg(long, env = "SUPERII_TRANSFER_CONCURRENT_UPLOADS", default_value_t = TransferLimits::default().concurrent_uploads)]
    concurrent_uploads: usize,
    #[arg(long, env = "SUPERII_TRANSFER_CONCURRENT_DOWNLOADS", default_value_t = TransferLimits::default().concurrent_downloads)]
    concurrent_downloads: usize,
    #[arg(long, env = "SUPERII_TRANSFER_CONCURRENT_DISK_JOBS", default_value_t = TransferLimits::default().concurrent_disk_jobs)]
    concurrent_disk_jobs: usize,
    #[arg(long, env = "SUPERII_TRANSFER_ACTIVE_TRANSFERS", default_value_t = TransferLimits::default().active_transfers)]
    active_transfers: usize,
    #[arg(long, env = "SUPERII_TRANSFER_TRANSFERS_PER_OWNER", default_value_t = TransferLimits::default().transfers_per_owner)]
    transfers_per_owner: usize,
    #[arg(long, env = "SUPERII_TRANSFER_QUARANTINE_BYTES", default_value_t = TransferLimits::default().quarantine_bytes)]
    quarantine_bytes: u64,
    #[arg(long, env = "SUPERII_TRANSFER_FREE_DISK_RESERVE_BYTES", default_value_t = TransferLimits::default().free_disk_reserve_bytes)]
    free_disk_reserve_bytes: u64,
    #[arg(long, env = "SUPERII_TRANSFER_IDLE_TIMEOUT_SECONDS", default_value_t = TransferLimits::default().idle_timeout.as_secs())]
    idle_timeout_seconds: u64,
    #[arg(long, env = "SUPERII_TRANSFER_UPLOAD_TIMEOUT_SECONDS", default_value_t = TransferLimits::default().upload_timeout.as_secs())]
    upload_timeout_seconds: u64,
    #[arg(long, env = "SUPERII_TRANSFER_DOWNLOAD_TIMEOUT_SECONDS", default_value_t = TransferLimits::default().download_timeout.as_secs())]
    download_timeout_seconds: u64,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "superii_data_plane=info".into()),
        )
        .compact()
        .init();
    let arguments = Arguments::parse();
    let store = TransferStore::with_limits(
        arguments.root,
        arguments.token,
        arguments.max_upload_bytes,
        arguments.max_chunk_bytes,
        TransferLimits {
            concurrent_uploads: arguments.concurrent_uploads,
            concurrent_downloads: arguments.concurrent_downloads,
            concurrent_disk_jobs: arguments.concurrent_disk_jobs,
            active_transfers: arguments.active_transfers,
            transfers_per_owner: arguments.transfers_per_owner,
            quarantine_bytes: arguments.quarantine_bytes,
            free_disk_reserve_bytes: arguments.free_disk_reserve_bytes,
            idle_timeout: Duration::from_secs(arguments.idle_timeout_seconds),
            upload_timeout: Duration::from_secs(arguments.upload_timeout_seconds),
            download_timeout: Duration::from_secs(arguments.download_timeout_seconds),
        },
    )?;
    let removed = cleanup_expired(&store)?;
    if removed > 0 {
        tracing::info!(removed, "removed expired transfers");
    }
    serve(store, parse_bind(arguments.host, arguments.port)).await?;
    Ok(())
}
