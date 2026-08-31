use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use clap::{Args, Parser, Subcommand};
use reqwest::header::{AUTHORIZATION, CONTENT_LENGTH, CONTENT_TYPE, RANGE};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::fs::{self, OpenOptions};
use std::io::{Read, Seek, SeekFrom, Write};
use std::path::{Path, PathBuf};
use superii_data_plane::{sha256_file, valid_sha256};
use url::Url;
use uuid::Uuid;

const DEFAULT_CHUNK_BYTES: usize = 8 * 1024 * 1024;
const MAX_CHUNK_BYTES: usize = 32 * 1024 * 1024;

#[derive(Debug, Parser)]
#[command(version, about = "Super ii repository transfer and verification CLI")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Debug, Subcommand)]
enum Command {
    Push(Push),
    Pull(Pull),
    Verify(Verify),
    Inspect(Inspect),
}

#[derive(Debug, Args)]
struct Push {
    #[arg(long)]
    repository: Uuid,
    #[arg(long)]
    file: PathBuf,
    #[arg(long)]
    path: String,
    #[arg(long)]
    branch: Option<Uuid>,
    #[arg(long, default_value = "https://superii.site")]
    base_url: Url,
    #[arg(long, env = "SUPERII_TOKEN", hide_env_values = true)]
    token: String,
    #[arg(long, default_value_t = DEFAULT_CHUNK_BYTES)]
    chunk_bytes: usize,
    #[arg(long)]
    state_file: Option<PathBuf>,
}

#[derive(Debug, Args)]
struct Pull {
    #[arg(long)]
    url: Url,
    #[arg(long)]
    output: PathBuf,
    #[arg(long)]
    sha256: String,
    #[arg(long, env = "SUPERII_TOKEN", hide_env_values = true)]
    token: Option<String>,
}

#[derive(Debug, Args)]
struct Verify {
    file: PathBuf,
    #[arg(long)]
    sha256: String,
}

#[derive(Debug, Args)]
struct Inspect {
    file: PathBuf,
}

#[derive(Debug, Serialize)]
struct CreateUpload<'a> {
    path: &'a str,
    filename: &'a str,
    mime_type: &'a str,
    length: u64,
    sha256: &'a str,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct UploadState {
    transfer_id: Uuid,
    upload_url: Url,
    transfer_token: String,
    source_sha256: String,
    source_size: u64,
    source_path: PathBuf,
}

#[derive(Debug, Deserialize)]
struct CreateResponse {
    transfer_id: Uuid,
    upload_url: Url,
    transfer_token: String,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let cli = Cli::parse();
    match cli.command {
        Command::Push(arguments) => push(arguments).await?,
        Command::Pull(arguments) => pull(arguments).await?,
        Command::Verify(arguments) => verify(arguments)?,
        Command::Inspect(arguments) => inspect(arguments)?,
    }
    Ok(())
}

async fn push(arguments: Push) -> Result<(), Box<dyn std::error::Error>> {
    if arguments.chunk_bytes == 0 || arguments.chunk_bytes > MAX_CHUNK_BYTES {
        return Err(format!("chunk size must be between 1 and {MAX_CHUNK_BYTES} bytes").into());
    }
    let source = arguments.file.canonicalize()?;
    let filename = source
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or("source filename is invalid")?;
    let (sha256, length) = sha256_file(&source)?;
    let state_path = arguments
        .state_file
        .unwrap_or_else(|| source.with_extension("superii-upload.json"));
    let client = reqwest::Client::builder()
        .https_only(arguments.base_url.scheme() == "https")
        .build()?;
    let state = if state_path.is_file() {
        let existing: UploadState = serde_json::from_slice(&fs::read(&state_path)?)?;
        if existing.source_sha256 != sha256
            || existing.source_size != length
            || existing.source_path != source
        {
            return Err("upload state belongs to different source bytes".into());
        }
        existing
    } else {
        let mut endpoint = arguments.base_url.join(&format!(
            "/api/repositories/{}/transfers",
            arguments.repository
        ))?;
        if let Some(branch) = arguments.branch {
            endpoint
                .query_pairs_mut()
                .append_pair("branch", &branch.to_string());
        }
        let mime_type = mime_guess::from_path(&source)
            .first_or_octet_stream()
            .essence_str()
            .to_owned();
        let response = client
            .post(endpoint)
            .bearer_auth(&arguments.token)
            .json(&CreateUpload {
                path: &arguments.path,
                filename,
                mime_type: &mime_type,
                length,
                sha256: &sha256,
            })
            .send()
            .await?;
        if !response.status().is_success() {
            return Err(format!("transfer creation failed: {}", response.text().await?).into());
        }
        let created: CreateResponse = response.json().await?;
        let state = UploadState {
            transfer_id: created.transfer_id,
            upload_url: created.upload_url,
            transfer_token: created.transfer_token,
            source_sha256: sha256.clone(),
            source_size: length,
            source_path: source.clone(),
        };
        write_private_json(&state_path, &state)?;
        state
    };

    let mut offset = transfer_offset(&client, &state).await?;
    let mut source_file = fs::File::open(&source)?;
    source_file.seek(SeekFrom::Start(offset))?;
    let mut buffer = vec![0_u8; arguments.chunk_bytes];
    while offset < length {
        let remaining = (length - offset).min(arguments.chunk_bytes as u64) as usize;
        source_file.read_exact(&mut buffer[..remaining])?;
        let chunk = buffer[..remaining].to_vec();
        let checksum = STANDARD.encode(Sha256::digest(&chunk));
        let response = client
            .patch(state.upload_url.clone())
            .header("tus-resumable", "1.0.0")
            .header("x-superii-transfer-token", &state.transfer_token)
            .header("upload-offset", offset)
            .header("upload-checksum", format!("sha256 {checksum}"))
            .header(CONTENT_TYPE, "application/offset+octet-stream")
            .header(CONTENT_LENGTH, remaining)
            .body(chunk)
            .send()
            .await?;
        if !response.status().is_success() {
            let confirmed = transfer_offset(&client, &state).await?;
            if confirmed != offset {
                offset = confirmed;
                source_file.seek(SeekFrom::Start(offset))?;
                continue;
            }
            return Err(format!("chunk upload failed: {}", response.text().await?).into());
        }
        offset = response
            .headers()
            .get("upload-offset")
            .and_then(|value| value.to_str().ok())
            .and_then(|value| value.parse::<u64>().ok())
            .ok_or("server omitted Upload-Offset")?;
        eprintln!("uploaded {offset}/{length} bytes");
    }

    let mut commit = state.upload_url.clone();
    commit.set_path(&format!("{}/commit", commit.path().trim_end_matches('/')));
    let response = client
        .post(commit)
        .header("x-superii-transfer-token", &state.transfer_token)
        .header("tus-resumable", "1.0.0")
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(format!("transfer commit failed: {}", response.text().await?).into());
    }
    let receipt: serde_json::Value = response.json().await?;
    fs::remove_file(&state_path)?;
    println!("{}", serde_json::to_string_pretty(&receipt)?);
    Ok(())
}

async fn transfer_offset(
    client: &reqwest::Client,
    state: &UploadState,
) -> Result<u64, Box<dyn std::error::Error>> {
    let response = client
        .head(state.upload_url.clone())
        .header("tus-resumable", "1.0.0")
        .header("x-superii-transfer-token", &state.transfer_token)
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(format!("transfer status failed with {}", response.status()).into());
    }
    response
        .headers()
        .get("upload-offset")
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .ok_or_else(|| "server omitted Upload-Offset".into())
}

async fn pull(arguments: Pull) -> Result<(), Box<dyn std::error::Error>> {
    if !valid_sha256(&arguments.sha256) {
        return Err("expected SHA-256 must be lowercase hexadecimal".into());
    }
    let client = reqwest::Client::builder().build()?;
    let offset = arguments
        .output
        .metadata()
        .map(|value| value.len())
        .unwrap_or(0);
    let mut request = client.get(arguments.url);
    if let Some(token) = arguments.token {
        request = request.header(AUTHORIZATION, format!("Bearer {token}"));
    }
    if offset > 0 {
        request = request.header(RANGE, format!("bytes={offset}-"));
    }
    let response = request.send().await?;
    let status = response.status();
    if !(status.is_success() || status == reqwest::StatusCode::PARTIAL_CONTENT) {
        return Err(format!("download failed with {status}").into());
    }
    if offset > 0 && status != reqwest::StatusCode::PARTIAL_CONTENT {
        return Err("server did not honor the requested resume range".into());
    }
    let mut target = OpenOptions::new()
        .create(true)
        .append(offset > 0)
        .truncate(offset == 0)
        .write(true)
        .open(&arguments.output)?;
    let mut stream = response.bytes_stream();
    while let Some(chunk) = futures_util::StreamExt::next(&mut stream).await {
        target.write_all(&chunk?)?;
    }
    target.flush()?;
    target.sync_all()?;
    let (actual, size) = sha256_file(&arguments.output)?;
    if actual != arguments.sha256 {
        return Err(format!("downloaded bytes failed SHA-256 verification: {actual}").into());
    }
    println!("verified {} bytes sha256:{}", size, actual);
    Ok(())
}

fn verify(arguments: Verify) -> Result<(), Box<dyn std::error::Error>> {
    if !valid_sha256(&arguments.sha256) {
        return Err("expected SHA-256 must be lowercase hexadecimal".into());
    }
    let (actual, size) = sha256_file(&arguments.file)?;
    if actual != arguments.sha256 {
        return Err(format!(
            "SHA-256 mismatch: expected {}, got {actual}",
            arguments.sha256
        )
        .into());
    }
    println!("verified {} bytes sha256:{}", size, actual);
    Ok(())
}

fn inspect(arguments: Inspect) -> Result<(), Box<dyn std::error::Error>> {
    let path = arguments.file.canonicalize()?;
    let (sha256, size_bytes) = sha256_file(&path)?;
    let detected = infer::get_from_path(&path)?;
    let mime_type = detected
        .map(|kind| kind.mime_type().to_owned())
        .unwrap_or_else(|| {
            mime_guess::from_path(&path)
                .first_or_octet_stream()
                .to_string()
        });
    let output = serde_json::json!({
        "path": path,
        "size_bytes": size_bytes,
        "sha256": sha256,
        "mime_type": mime_type,
        "executed": false
    });
    println!("{}", serde_json::to_string_pretty(&output)?);
    Ok(())
}

fn write_private_json(
    path: &Path,
    value: &impl Serialize,
) -> Result<(), Box<dyn std::error::Error>> {
    let bytes = serde_json::to_vec_pretty(value)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(path)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
    }
    #[cfg(not(unix))]
    {
        let mut file = OpenOptions::new().create_new(true).write(true).open(path)?;
        file.write_all(&bytes)?;
        file.sync_all()?;
    }
    Ok(())
}
