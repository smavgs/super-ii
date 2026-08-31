use clap::Parser;
use std::net::{IpAddr, Ipv4Addr};
use std::path::PathBuf;
use superii_data_plane::transfer::{
    DEFAULT_MAX_CHUNK_BYTES, DEFAULT_MAX_UPLOAD_BYTES, TransferStore, cleanup_expired, parse_bind,
    serve,
};

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
    let store = TransferStore::new(
        arguments.root,
        arguments.token,
        arguments.max_upload_bytes,
        arguments.max_chunk_bytes,
    )?;
    let removed = cleanup_expired(&store)?;
    if removed > 0 {
        tracing::info!(removed, "removed expired transfers");
    }
    serve(store, parse_bind(arguments.host, arguments.port)).await?;
    Ok(())
}
