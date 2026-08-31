use axum::Router;
use axum::body::Body;
use axum::extract::{Path as AxumPath, Request, State};
use axum::http::header::{
    ACCEPT_RANGES, CACHE_CONTROL, CONTENT_LENGTH, CONTENT_RANGE, CONTENT_TYPE, ETAG, RANGE,
};
use axum::http::{HeaderMap, HeaderName, HeaderValue, Response, StatusCode};
use axum::response::{IntoResponse, Json};
use axum::routing::get;
use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use chrono::{DateTime, Utc};
use http_body_util::BodyExt;
use serde::{Deserialize, Serialize};
use sha1::Sha1;
use sha2::{Digest, Sha256};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::io::{SeekFrom, Write};
use std::net::{IpAddr, SocketAddr};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime};
use subtle::ConstantTimeEq;
use thiserror::Error;
use tokio::io::{AsyncReadExt, AsyncSeekExt};
use tokio::sync::Mutex as AsyncMutex;
use tokio_util::io::ReaderStream;
use uuid::Uuid;

use crate::{sha256_file, valid_sha256};

pub const TUS_VERSION: &str = "1.0.0";
pub const TUS_EXTENSIONS: &str = "creation,expiration,checksum,termination";
pub const DEFAULT_MAX_CHUNK_BYTES: u64 = 32 * 1024 * 1024;
pub const DEFAULT_MAX_UPLOAD_BYTES: u64 = 10 * 1024 * 1024 * 1024;

const TUS_RESUMABLE: HeaderName = HeaderName::from_static("tus-resumable");
const TUS_VERSION_HEADER: HeaderName = HeaderName::from_static("tus-version");
const TUS_EXTENSION: HeaderName = HeaderName::from_static("tus-extension");
const TUS_MAX_SIZE: HeaderName = HeaderName::from_static("tus-max-size");
const TUS_CHECKSUM_ALGORITHM: HeaderName = HeaderName::from_static("tus-checksum-algorithm");
const UPLOAD_OFFSET: HeaderName = HeaderName::from_static("upload-offset");
const UPLOAD_LENGTH: HeaderName = HeaderName::from_static("upload-length");
const UPLOAD_EXPIRES: HeaderName = HeaderName::from_static("upload-expires");
const UPLOAD_CHECKSUM: HeaderName = HeaderName::from_static("upload-checksum");
const INTERNAL_TOKEN: HeaderName = HeaderName::from_static("x-superii-transfer-token");
const UPLOAD_COMPLETE: HeaderName = HeaderName::from_static("upload-complete");

#[derive(Debug, Error)]
pub enum TransferError {
    #[error("transfer authentication failed")]
    Unauthorized,
    #[error("transfer not found")]
    NotFound,
    #[error("transfer expired")]
    Expired,
    #[error("unsupported tus version")]
    TusVersion,
    #[error("invalid request: {0}")]
    Invalid(String),
    #[error("offset conflict")]
    Offset,
    #[error("chunk checksum mismatch")]
    Checksum,
    #[error("upload is too large")]
    TooLarge,
    #[error("transfer state conflict: {0}")]
    Conflict(String),
    #[error("storage error")]
    Io(#[from] std::io::Error),
    #[error("state serialization failed")]
    Json(#[from] serde_json::Error),
}

impl IntoResponse for TransferError {
    fn into_response(self) -> axum::response::Response {
        let status = match self {
            Self::Unauthorized => StatusCode::UNAUTHORIZED,
            Self::NotFound => StatusCode::NOT_FOUND,
            Self::Expired => StatusCode::GONE,
            Self::TusVersion => StatusCode::PRECONDITION_FAILED,
            Self::Invalid(_) => StatusCode::BAD_REQUEST,
            Self::Offset | Self::Conflict(_) => StatusCode::CONFLICT,
            Self::Checksum => StatusCode::from_u16(460).expect("valid checksum status"),
            Self::TooLarge => StatusCode::PAYLOAD_TOO_LARGE,
            Self::Io(_) | Self::Json(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        let mut response = Json(serde_json::json!({ "error": self.to_string() })).into_response();
        *response.status_mut() = status;
        response
            .headers_mut()
            .insert(TUS_RESUMABLE, HeaderValue::from_static(TUS_VERSION));
        if status == StatusCode::PRECONDITION_FAILED {
            response
                .headers_mut()
                .insert(TUS_VERSION_HEADER, HeaderValue::from_static(TUS_VERSION));
        }
        response
    }
}

#[derive(Clone)]
pub struct TransferStore {
    root: Arc<PathBuf>,
    token: Arc<Vec<u8>>,
    max_upload_bytes: u64,
    max_chunk_bytes: u64,
    locks: Arc<Mutex<HashMap<Uuid, Arc<AsyncMutex<()>>>>>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum TransferStatus {
    Created,
    Uploading,
    Uploaded,
    Available,
    Rejected,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TransferRecord {
    pub id: Uuid,
    pub repository_id: Uuid,
    pub revision_id: Uuid,
    pub path: String,
    pub filename: String,
    pub mime_type: String,
    pub created_by: String,
    pub length: u64,
    pub offset: u64,
    pub expected_sha256: Option<String>,
    pub actual_sha256: Option<String>,
    pub storage_key: Option<String>,
    pub status: TransferStatus,
    pub expires_at: DateTime<Utc>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Deserialize)]
pub struct CreateTransfer {
    pub id: Uuid,
    pub repository_id: Uuid,
    pub revision_id: Uuid,
    pub path: String,
    pub filename: String,
    pub mime_type: String,
    pub created_by: String,
    pub length: u64,
    pub expected_sha256: Option<String>,
    pub expires_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
pub struct ScrubReport {
    pub checked: usize,
    pub corrupt: Vec<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ByteRange {
    pub start: u64,
    pub end: u64,
}

impl ByteRange {
    pub fn length(self) -> u64 {
        self.end - self.start + 1
    }
}

impl TransferStore {
    pub fn new(
        storage_root: PathBuf,
        token: String,
        max_upload_bytes: u64,
        max_chunk_bytes: u64,
    ) -> Result<Self, TransferError> {
        if token.len() < 32 {
            return Err(TransferError::Invalid(
                "internal transfer token must contain at least 32 characters".into(),
            ));
        }
        if max_chunk_bytes == 0 || max_chunk_bytes > max_upload_bytes {
            return Err(TransferError::Invalid(
                "invalid transfer size limits".into(),
            ));
        }
        let root = storage_root.canonicalize().or_else(|_| {
            fs::create_dir_all(&storage_root)?;
            storage_root.canonicalize()
        })?;
        set_directory_mode(&root)?;
        for directory in [
            root.join("transfers"),
            root.join("objects"),
            root.join("objects/sha256"),
        ] {
            fs::create_dir_all(&directory)?;
            set_directory_mode(&directory)?;
        }
        Ok(Self {
            root: Arc::new(root),
            token: Arc::new(token.into_bytes()),
            max_upload_bytes,
            max_chunk_bytes,
            locks: Arc::new(Mutex::new(HashMap::new())),
        })
    }

    pub fn root(&self) -> &Path {
        self.root.as_ref()
    }

    pub fn max_upload_bytes(&self) -> u64 {
        self.max_upload_bytes
    }

    fn authorized(&self, headers: &HeaderMap) -> bool {
        let supplied = headers
            .get(&INTERNAL_TOKEN)
            .and_then(|value| value.to_str().ok())
            .map(str::as_bytes)
            .unwrap_or_default();
        supplied.len() == self.token.len() && bool::from(supplied.ct_eq(self.token.as_slice()))
    }

    fn lock(&self, id: Uuid) -> Arc<AsyncMutex<()>> {
        let mut locks = self.locks.lock().expect("transfer lock registry poisoned");
        locks
            .entry(id)
            .or_insert_with(|| Arc::new(AsyncMutex::new(())))
            .clone()
    }

    fn transfer_directory(&self, id: Uuid) -> PathBuf {
        self.root.join("transfers").join(id.to_string())
    }

    fn record_path(&self, id: Uuid) -> PathBuf {
        self.transfer_directory(id).join("state.json")
    }

    fn payload_path(&self, id: Uuid) -> PathBuf {
        self.transfer_directory(id).join("payload")
    }

    pub fn create(&self, request: CreateTransfer) -> Result<TransferRecord, TransferError> {
        validate_repository_path(&request.path)?;
        if request.length == 0 || request.length > self.max_upload_bytes {
            return Err(TransferError::TooLarge);
        }
        if request.expires_at <= Utc::now() {
            return Err(TransferError::Expired);
        }
        if let Some(expected) = request.expected_sha256.as_deref()
            && !valid_sha256(expected)
        {
            return Err(TransferError::Invalid("expected SHA-256 is invalid".into()));
        }
        let directory = self.transfer_directory(request.id);
        fs::create_dir(&directory).map_err(|error| {
            if error.kind() == std::io::ErrorKind::AlreadyExists {
                TransferError::Conflict("transfer already exists".into())
            } else {
                TransferError::Io(error)
            }
        })?;
        set_directory_mode(&directory)?;
        let payload = self.payload_path(request.id);
        let file = OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(payload)?;
        file.sync_all()?;
        let now = Utc::now();
        let record = TransferRecord {
            id: request.id,
            repository_id: request.repository_id,
            revision_id: request.revision_id,
            path: request.path,
            filename: request.filename.chars().take(255).collect(),
            mime_type: request.mime_type.chars().take(255).collect(),
            created_by: request.created_by.chars().take(255).collect(),
            length: request.length,
            offset: 0,
            expected_sha256: request.expected_sha256,
            actual_sha256: None,
            storage_key: None,
            status: TransferStatus::Created,
            expires_at: request.expires_at,
            created_at: now,
            updated_at: now,
        };
        self.save_record(&record)?;
        Ok(record)
    }

    pub fn load(&self, id: Uuid) -> Result<TransferRecord, TransferError> {
        let path = self.record_path(id);
        let bytes = fs::read(path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                TransferError::NotFound
            } else {
                TransferError::Io(error)
            }
        })?;
        let record: TransferRecord = serde_json::from_slice(&bytes)?;
        if record.id != id {
            return Err(TransferError::Conflict("transfer identity mismatch".into()));
        }
        if record.expires_at <= Utc::now()
            && !matches!(
                record.status,
                TransferStatus::Available | TransferStatus::Rejected
            )
        {
            return Err(TransferError::Expired);
        }
        Ok(record)
    }

    fn save_record(&self, record: &TransferRecord) -> Result<(), TransferError> {
        let path = self.record_path(record.id);
        let temporary = path.with_extension("json.pending");
        let bytes = serde_json::to_vec_pretty(record)?;
        {
            let mut target = OpenOptions::new()
                .create(true)
                .truncate(true)
                .write(true)
                .open(&temporary)?;
            target.write_all(&bytes)?;
            target.sync_all()?;
        }
        fs::rename(&temporary, &path)?;
        sync_directory(path.parent().expect("state has parent"))?;
        Ok(())
    }

    pub async fn append(
        &self,
        id: Uuid,
        expected_offset: u64,
        content_length: u64,
        checksum: Option<&str>,
        mut body: Body,
    ) -> Result<TransferRecord, TransferError> {
        if content_length == 0 || content_length > self.max_chunk_bytes {
            return Err(TransferError::TooLarge);
        }
        let lock = self.lock(id);
        let _guard = lock.lock().await;
        let mut record = self.load(id)?;
        if !matches!(
            record.status,
            TransferStatus::Created | TransferStatus::Uploading
        ) {
            return Err(TransferError::Conflict("upload is not writable".into()));
        }
        if record.offset != expected_offset {
            return Err(TransferError::Offset);
        }
        let next = record
            .offset
            .checked_add(content_length)
            .ok_or(TransferError::TooLarge)?;
        if next > record.length {
            return Err(TransferError::TooLarge);
        }

        let chunk_path = self.transfer_directory(id).join(format!(
            "chunk-{}-{}.pending",
            expected_offset,
            Uuid::new_v4()
        ));
        let mut target = tokio::fs::OpenOptions::new()
            .create_new(true)
            .write(true)
            .open(&chunk_path)
            .await?;
        let mut sha1 = Sha1::new();
        let mut sha256 = Sha256::new();
        let mut received = 0_u64;
        while let Some(frame) = body.frame().await {
            let frame = frame.map_err(|_| TransferError::Invalid("invalid request body".into()))?;
            if let Ok(data) = frame.into_data() {
                received = received
                    .checked_add(data.len() as u64)
                    .ok_or(TransferError::TooLarge)?;
                if received > content_length || received > self.max_chunk_bytes {
                    let _ = tokio::fs::remove_file(&chunk_path).await;
                    return Err(TransferError::TooLarge);
                }
                sha1.update(&data);
                sha256.update(&data);
                tokio::io::AsyncWriteExt::write_all(&mut target, &data).await?;
            }
        }
        if received != content_length {
            let _ = tokio::fs::remove_file(&chunk_path).await;
            return Err(TransferError::Invalid("content length mismatch".into()));
        }
        tokio::io::AsyncWriteExt::flush(&mut target).await?;
        target.sync_all().await?;
        drop(target);

        if let Some(header) = checksum {
            let sha1_bytes = sha1.finalize();
            let sha256_bytes = sha256.finalize();
            if let Err(error) = verify_checksum(header, &sha1_bytes, &sha256_bytes) {
                let _ = fs::remove_file(&chunk_path);
                return Err(error);
            }
        }

        let payload_path = self.payload_path(id);
        let actual_length = fs::metadata(&payload_path)?.len();
        if actual_length != record.offset {
            let _ = fs::remove_file(&chunk_path);
            return Err(TransferError::Conflict(
                "quarantine length does not match committed offset".into(),
            ));
        }
        let mut payload = OpenOptions::new().append(true).open(&payload_path)?;
        let mut chunk = File::open(&chunk_path)?;
        std::io::copy(&mut chunk, &mut payload)?;
        payload.flush()?;
        payload.sync_all()?;
        fs::remove_file(&chunk_path)?;

        record.offset = next;
        record.status = if next == record.length {
            let (actual_sha256, actual_size) = sha256_file(&payload_path)?;
            if actual_size != record.length {
                return Err(TransferError::Conflict("completed size mismatch".into()));
            }
            if let Some(expected) = record.expected_sha256.as_deref()
                && expected != actual_sha256
            {
                record.status = TransferStatus::Rejected;
                record.actual_sha256 = Some(actual_sha256);
                record.updated_at = Utc::now();
                self.save_record(&record)?;
                return Err(TransferError::Checksum);
            }
            record.actual_sha256 = Some(actual_sha256);
            TransferStatus::Uploaded
        } else {
            TransferStatus::Uploading
        };
        record.updated_at = Utc::now();
        self.save_record(&record)?;
        Ok(record)
    }

    pub async fn promote(&self, id: Uuid) -> Result<TransferRecord, TransferError> {
        let lock = self.lock(id);
        let _guard = lock.lock().await;
        let mut record = self.load(id)?;
        if record.status == TransferStatus::Available {
            return Ok(record);
        }
        if record.status != TransferStatus::Uploaded || record.offset != record.length {
            return Err(TransferError::Conflict("upload has not completed".into()));
        }
        let sha256 = record
            .actual_sha256
            .clone()
            .ok_or_else(|| TransferError::Conflict("completed hash is missing".into()))?;
        if !valid_sha256(&sha256) {
            return Err(TransferError::Conflict("completed hash is invalid".into()));
        }
        let payload = self.payload_path(id);
        let target_directory = self.root.join("objects/sha256").join(&sha256[..2]);
        fs::create_dir_all(&target_directory)?;
        set_directory_mode(&target_directory)?;
        let target = target_directory.join(&sha256);
        if target.exists() {
            let metadata = fs::symlink_metadata(&target)?;
            if metadata.file_type().is_symlink() || !metadata.is_file() {
                return Err(TransferError::Conflict(
                    "existing CAS object is unsafe".into(),
                ));
            }
            let (existing_hash, size) = sha256_file(&target)?;
            if existing_hash != sha256 || size != record.length {
                return Err(TransferError::Conflict(
                    "existing CAS object is corrupt".into(),
                ));
            }
            fs::remove_file(&payload)?;
        } else {
            fs::rename(&payload, &target)?;
            set_readonly_mode(&target)?;
            File::open(&target)?.sync_all()?;
            sync_directory(&target_directory)?;
        }
        record.status = TransferStatus::Available;
        record.storage_key = Some(format!("objects/sha256/{}/{}", &sha256[..2], sha256));
        record.updated_at = Utc::now();
        self.save_record(&record)?;
        Ok(record)
    }

    pub async fn reject(&self, id: Uuid) -> Result<TransferRecord, TransferError> {
        let lock = self.lock(id);
        let _guard = lock.lock().await;
        let mut record = self.load(id)?;
        if record.status == TransferStatus::Available {
            return Err(TransferError::Conflict(
                "available object cannot be rejected".into(),
            ));
        }
        let payload = self.payload_path(id);
        if payload.exists() {
            fs::remove_file(payload)?;
        }
        record.status = TransferStatus::Rejected;
        record.updated_at = Utc::now();
        self.save_record(&record)?;
        Ok(record)
    }

    pub async fn terminate(&self, id: Uuid) -> Result<(), TransferError> {
        let lock = self.lock(id);
        let _guard = lock.lock().await;
        let record = self.load(id)?;
        if record.status == TransferStatus::Available {
            return Err(TransferError::Conflict(
                "available transfer cannot be terminated".into(),
            ));
        }
        fs::remove_dir_all(self.transfer_directory(id))?;
        self.locks
            .lock()
            .expect("transfer lock registry poisoned")
            .remove(&id);
        Ok(())
    }

    pub fn quarantine_path(&self, id: Uuid) -> Result<PathBuf, TransferError> {
        let record = self.load(id)?;
        if record.status != TransferStatus::Uploaded {
            return Err(TransferError::Conflict(
                "transfer is not ready for scanning".into(),
            ));
        }
        let path = self.payload_path(id);
        let metadata = fs::symlink_metadata(&path)?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(TransferError::Conflict(
                "quarantine payload is unsafe".into(),
            ));
        }
        Ok(path)
    }

    pub fn scrub(&self) -> Result<ScrubReport, TransferError> {
        let object_root = self.root.join("objects/sha256");
        let mut checked = 0_usize;
        let mut corrupt = Vec::new();
        for prefix in fs::read_dir(&object_root)? {
            let prefix = prefix?;
            if !prefix.file_type()?.is_dir() {
                continue;
            }
            for object in fs::read_dir(prefix.path())? {
                let object = object?;
                let name = object.file_name().to_string_lossy().into_owned();
                checked += 1;
                if !object.file_type()?.is_file() || !valid_sha256(&name) {
                    corrupt.push(name);
                    continue;
                }
                let (actual, _) = sha256_file(&object.path())?;
                if actual != name {
                    corrupt.push(name);
                }
            }
        }
        Ok(ScrubReport { checked, corrupt })
    }

    pub fn object_path(&self, sha256: &str) -> Result<PathBuf, TransferError> {
        if !valid_sha256(sha256) {
            return Err(TransferError::NotFound);
        }
        let path = self
            .root
            .join("objects/sha256")
            .join(&sha256[..2])
            .join(sha256);
        let metadata = fs::symlink_metadata(&path).map_err(|error| {
            if error.kind() == std::io::ErrorKind::NotFound {
                TransferError::NotFound
            } else {
                TransferError::Io(error)
            }
        })?;
        if metadata.file_type().is_symlink() || !metadata.is_file() {
            return Err(TransferError::NotFound);
        }
        let canonical = path.canonicalize()?;
        let object_root = self.root.join("objects/sha256").canonicalize()?;
        if !canonical.starts_with(object_root) {
            return Err(TransferError::NotFound);
        }
        Ok(canonical)
    }
}

pub fn validate_repository_path(value: &str) -> Result<(), TransferError> {
    if value.is_empty()
        || value.len() > 1024
        || value.starts_with('/')
        || value.contains('\\')
        || value.contains('\0')
        || value
            .split('/')
            .any(|part| part.is_empty() || part == "." || part == "..")
    {
        return Err(TransferError::Invalid("unsafe repository path".into()));
    }
    Ok(())
}

fn verify_checksum(header: &str, sha1: &[u8], sha256: &[u8]) -> Result<(), TransferError> {
    let (algorithm, encoded) = header
        .split_once(' ')
        .ok_or_else(|| TransferError::Invalid("invalid Upload-Checksum header".into()))?;
    let expected = STANDARD
        .decode(encoded)
        .map_err(|_| TransferError::Invalid("invalid Upload-Checksum value".into()))?;
    let actual = match algorithm {
        "sha1" => sha1,
        "sha256" => sha256,
        _ => {
            return Err(TransferError::Invalid(
                "unsupported checksum algorithm".into(),
            ));
        }
    };
    if expected.len() != actual.len() || !bool::from(expected.as_slice().ct_eq(actual)) {
        return Err(TransferError::Checksum);
    }
    Ok(())
}

pub fn parse_range(value: Option<&str>, length: u64) -> Result<ByteRange, TransferError> {
    if length == 0 {
        return Err(TransferError::Invalid("empty object".into()));
    }
    let Some(value) = value else {
        return Ok(ByteRange {
            start: 0,
            end: length - 1,
        });
    };
    let raw = value
        .strip_prefix("bytes=")
        .ok_or_else(|| TransferError::Invalid("invalid Range header".into()))?;
    if raw.contains(',') {
        return Err(TransferError::Invalid(
            "multiple ranges are unsupported".into(),
        ));
    }
    let (start, end) = raw
        .split_once('-')
        .ok_or_else(|| TransferError::Invalid("invalid Range header".into()))?;
    if start.is_empty() {
        let suffix = end
            .parse::<u64>()
            .map_err(|_| TransferError::Invalid("invalid suffix range".into()))?;
        if suffix == 0 {
            return Err(TransferError::Invalid("invalid suffix range".into()));
        }
        let bounded = suffix.min(length);
        return Ok(ByteRange {
            start: length - bounded,
            end: length - 1,
        });
    }
    let start = start
        .parse::<u64>()
        .map_err(|_| TransferError::Invalid("invalid range start".into()))?;
    if start >= length {
        return Err(TransferError::Invalid("range is outside the object".into()));
    }
    let end = if end.is_empty() {
        length - 1
    } else {
        end.parse::<u64>()
            .map_err(|_| TransferError::Invalid("invalid range end".into()))?
            .min(length - 1)
    };
    if end < start {
        return Err(TransferError::Invalid("range end precedes start".into()));
    }
    Ok(ByteRange { start, end })
}

fn require_auth(store: &TransferStore, headers: &HeaderMap) -> Result<(), TransferError> {
    if store.authorized(headers) {
        Ok(())
    } else {
        Err(TransferError::Unauthorized)
    }
}

fn require_tus(headers: &HeaderMap) -> Result<(), TransferError> {
    if headers
        .get(&TUS_RESUMABLE)
        .and_then(|value| value.to_str().ok())
        == Some(TUS_VERSION)
    {
        Ok(())
    } else {
        Err(TransferError::TusVersion)
    }
}

fn tus_headers(headers: &mut HeaderMap, record: Option<&TransferRecord>) {
    headers.insert(TUS_RESUMABLE, HeaderValue::from_static(TUS_VERSION));
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    if let Some(record) = record {
        headers.insert(
            UPLOAD_OFFSET,
            HeaderValue::from_str(&record.offset.to_string()).expect("numeric offset"),
        );
        headers.insert(
            UPLOAD_LENGTH,
            HeaderValue::from_str(&record.length.to_string()).expect("numeric length"),
        );
        headers.insert(
            UPLOAD_EXPIRES,
            HeaderValue::from_str(&httpdate::fmt_http_date(record.expires_at.into()))
                .expect("valid HTTP date"),
        );
        headers.insert(
            UPLOAD_COMPLETE,
            HeaderValue::from_static(
                if matches!(
                    record.status,
                    TransferStatus::Uploaded | TransferStatus::Available
                ) {
                    "true"
                } else {
                    "false"
                },
            ),
        );
    }
}

async fn health() -> impl IntoResponse {
    Json(serde_json::json!({
        "service": "superii-transferd",
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION")
    }))
}

async fn tus_options(
    State(store): State<TransferStore>,
    headers: HeaderMap,
) -> Result<Response<Body>, TransferError> {
    require_auth(&store, &headers)?;
    let mut response = Response::new(Body::empty());
    *response.status_mut() = StatusCode::NO_CONTENT;
    let headers = response.headers_mut();
    headers.insert(TUS_VERSION_HEADER, HeaderValue::from_static(TUS_VERSION));
    headers.insert(TUS_RESUMABLE, HeaderValue::from_static(TUS_VERSION));
    headers.insert(TUS_EXTENSION, HeaderValue::from_static(TUS_EXTENSIONS));
    headers.insert(
        TUS_CHECKSUM_ALGORITHM,
        HeaderValue::from_static("sha1,sha256"),
    );
    headers.insert(
        TUS_MAX_SIZE,
        HeaderValue::from_str(&store.max_upload_bytes().to_string()).expect("numeric max size"),
    );
    headers.insert(CACHE_CONTROL, HeaderValue::from_static("no-store"));
    Ok(response)
}

async fn create_transfer(
    State(store): State<TransferStore>,
    headers: HeaderMap,
    Json(payload): Json<CreateTransfer>,
) -> Result<Response<Body>, TransferError> {
    require_auth(&store, &headers)?;
    require_tus(&headers)?;
    let record = store.create(payload)?;
    let mut response = Response::new(Body::empty());
    *response.status_mut() = StatusCode::CREATED;
    tus_headers(response.headers_mut(), Some(&record));
    response.headers_mut().insert(
        axum::http::header::LOCATION,
        HeaderValue::from_str(&format!("/v1/transfers/{}", record.id))
            .expect("valid transfer location"),
    );
    Ok(response)
}

async fn head_transfer(
    State(store): State<TransferStore>,
    AxumPath(id): AxumPath<Uuid>,
    headers: HeaderMap,
) -> Result<Response<Body>, TransferError> {
    require_auth(&store, &headers)?;
    require_tus(&headers)?;
    let record = store.load(id)?;
    let mut response = Response::new(Body::empty());
    *response.status_mut() = StatusCode::NO_CONTENT;
    tus_headers(response.headers_mut(), Some(&record));
    Ok(response)
}

async fn transfer_status(
    State(store): State<TransferStore>,
    AxumPath(id): AxumPath<Uuid>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, TransferError> {
    require_auth(&store, &headers)?;
    Ok(Json(store.load(id)?))
}

async fn patch_transfer(
    State(store): State<TransferStore>,
    AxumPath(id): AxumPath<Uuid>,
    request: Request,
) -> Result<Response<Body>, TransferError> {
    require_auth(&store, request.headers())?;
    require_tus(request.headers())?;
    if request
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        != Some("application/offset+octet-stream")
    {
        return Err(TransferError::Invalid(
            "PATCH requires application/offset+octet-stream".into(),
        ));
    }
    let offset = numeric_header(request.headers(), &UPLOAD_OFFSET)?;
    let content_length = numeric_header(request.headers(), &CONTENT_LENGTH)?;
    let checksum = request
        .headers()
        .get(&UPLOAD_CHECKSUM)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let record = store
        .append(
            id,
            offset,
            content_length,
            checksum.as_deref(),
            request.into_body(),
        )
        .await?;
    let mut response = Response::new(Body::empty());
    *response.status_mut() = StatusCode::NO_CONTENT;
    tus_headers(response.headers_mut(), Some(&record));
    Ok(response)
}

async fn terminate_transfer(
    State(store): State<TransferStore>,
    AxumPath(id): AxumPath<Uuid>,
    headers: HeaderMap,
) -> Result<Response<Body>, TransferError> {
    require_auth(&store, &headers)?;
    require_tus(&headers)?;
    store.terminate(id).await?;
    let mut response = Response::new(Body::empty());
    *response.status_mut() = StatusCode::NO_CONTENT;
    tus_headers(response.headers_mut(), None);
    Ok(response)
}

async fn promote_transfer(
    State(store): State<TransferStore>,
    AxumPath(id): AxumPath<Uuid>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, TransferError> {
    require_auth(&store, &headers)?;
    Ok(Json(store.promote(id).await?))
}

async fn reject_transfer(
    State(store): State<TransferStore>,
    AxumPath(id): AxumPath<Uuid>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, TransferError> {
    require_auth(&store, &headers)?;
    Ok(Json(store.reject(id).await?))
}

async fn scrub_objects(
    State(store): State<TransferStore>,
    headers: HeaderMap,
) -> Result<impl IntoResponse, TransferError> {
    require_auth(&store, &headers)?;
    let report = tokio::task::spawn_blocking(move || store.scrub())
        .await
        .map_err(|_| TransferError::Conflict("scrub task failed".into()))??;
    Ok(Json(report))
}

async fn get_object(
    State(store): State<TransferStore>,
    AxumPath(sha256): AxumPath<String>,
    headers: HeaderMap,
) -> Result<Response<Body>, TransferError> {
    require_auth(&store, &headers)?;
    let path = store.object_path(&sha256)?;
    let size = fs::metadata(&path)?.len();
    let requested = headers.get(RANGE).and_then(|value| value.to_str().ok());
    let range = parse_range(requested, size)?;
    let mut file = tokio::fs::File::open(path).await?;
    file.seek(SeekFrom::Start(range.start)).await?;
    let stream = ReaderStream::new(file.take(range.length()));
    let mut response = Response::new(Body::from_stream(stream));
    *response.status_mut() = if requested.is_some() {
        StatusCode::PARTIAL_CONTENT
    } else {
        StatusCode::OK
    };
    let headers = response.headers_mut();
    headers.insert(ACCEPT_RANGES, HeaderValue::from_static("bytes"));
    headers.insert(
        CONTENT_LENGTH,
        HeaderValue::from_str(&range.length().to_string()).expect("numeric content length"),
    );
    headers.insert(
        CONTENT_TYPE,
        HeaderValue::from_static("application/octet-stream"),
    );
    headers.insert(
        ETAG,
        HeaderValue::from_str(&format!("\"sha256:{sha256}\"")).expect("valid etag"),
    );
    if requested.is_some() {
        headers.insert(
            CONTENT_RANGE,
            HeaderValue::from_str(&format!("bytes {}-{}/{}", range.start, range.end, size))
                .expect("valid content range"),
        );
    }
    Ok(response)
}

fn numeric_header(headers: &HeaderMap, name: &HeaderName) -> Result<u64, TransferError> {
    headers
        .get(name)
        .and_then(|value| value.to_str().ok())
        .and_then(|value| value.parse::<u64>().ok())
        .ok_or_else(|| TransferError::Invalid(format!("missing or invalid {name}")))
}

pub fn router(store: TransferStore) -> Router {
    Router::new()
        .route("/health", get(health))
        .route(
            "/v1/transfers",
            axum::routing::options(tus_options).post(create_transfer),
        )
        .route(
            "/v1/transfers/{id}",
            get(transfer_status)
                .head(head_transfer)
                .patch(patch_transfer)
                .delete(terminate_transfer),
        )
        .route(
            "/v1/transfers/{id}/promote",
            axum::routing::post(promote_transfer),
        )
        .route(
            "/v1/transfers/{id}/reject",
            axum::routing::post(reject_transfer),
        )
        .route("/v1/objects/{sha256}", get(get_object))
        .route("/v1/scrub", axum::routing::post(scrub_objects))
        .with_state(store)
}

pub async fn serve(store: TransferStore, bind: SocketAddr) -> Result<(), std::io::Error> {
    if !bind.ip().is_loopback() {
        return Err(std::io::Error::new(
            std::io::ErrorKind::PermissionDenied,
            "superii-transferd must bind to loopback",
        ));
    }
    let listener = tokio::net::TcpListener::bind(bind).await?;
    tracing::info!(address = %bind, "Super ii transfer service ready");
    let cleanup = tokio::spawn(cleanup_loop(store.clone()));
    let result = axum::serve(listener, router(store))
        .with_graceful_shutdown(shutdown_signal())
        .await;
    cleanup.abort();
    result
}

async fn cleanup_loop(store: TransferStore) {
    let mut interval = tokio::time::interval(Duration::from_secs(15 * 60));
    interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        interval.tick().await;
        let current = store.clone();
        match tokio::task::spawn_blocking(move || cleanup_expired(&current)).await {
            Ok(Ok(removed)) if removed > 0 => {
                tracing::info!(removed, "removed expired transfers");
            }
            Ok(Ok(_)) => {}
            Ok(Err(error)) => tracing::error!(%error, "expired transfer cleanup failed"),
            Err(error) => tracing::error!(%error, "expired transfer cleanup task failed"),
        }
    }
}

async fn shutdown_signal() {
    let interrupt = async {
        tokio::signal::ctrl_c()
            .await
            .expect("failed to install Ctrl+C handler");
    };
    #[cfg(unix)]
    let terminate = async {
        tokio::signal::unix::signal(tokio::signal::unix::SignalKind::terminate())
            .expect("failed to install SIGTERM handler")
            .recv()
            .await;
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();
    tokio::select! { _ = interrupt => {}, _ = terminate => {} }
}

pub fn parse_bind(host: IpAddr, port: u16) -> SocketAddr {
    SocketAddr::new(host, port)
}

#[cfg(unix)]
fn set_directory_mode(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))
}

#[cfg(not(unix))]
fn set_directory_mode(_path: &Path) -> std::io::Result<()> {
    Ok(())
}

#[cfg(unix)]
fn set_readonly_mode(path: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o440))
}

#[cfg(not(unix))]
fn set_readonly_mode(path: &Path) -> std::io::Result<()> {
    let mut permissions = fs::metadata(path)?.permissions();
    permissions.set_readonly(true);
    fs::set_permissions(path, permissions)
}

fn sync_directory(path: &Path) -> std::io::Result<()> {
    File::open(path)?.sync_all()
}

pub fn cleanup_expired(store: &TransferStore) -> Result<usize, TransferError> {
    let root = store.root.join("transfers");
    let mut removed = 0_usize;
    for entry in fs::read_dir(root)? {
        let entry = entry?;
        if !entry.file_type()?.is_dir() {
            continue;
        }
        let Ok(id) = Uuid::parse_str(&entry.file_name().to_string_lossy()) else {
            continue;
        };
        match store.load(id) {
            Err(TransferError::Expired) => {
                fs::remove_dir_all(entry.path())?;
                removed += 1;
            }
            Err(TransferError::Json(_) | TransferError::Io(_)) => {
                let modified = entry.metadata()?.modified().unwrap_or(SystemTime::now());
                if modified.elapsed().unwrap_or_default() > Duration::from_secs(7 * 86_400) {
                    fs::remove_dir_all(entry.path())?;
                    removed += 1;
                }
            }
            _ => {}
        }
    }
    Ok(removed)
}

#[cfg(test)]
mod tests {
    use super::*;
    use axum::body::Bytes;
    use base64::engine::general_purpose::STANDARD;
    use chrono::Duration as ChronoDuration;

    fn store() -> (tempfile::TempDir, TransferStore) {
        let directory = tempfile::tempdir().expect("tempdir");
        let store = TransferStore::new(directory.path().to_path_buf(), "x".repeat(32), 1024, 16)
            .expect("store");
        (directory, store)
    }

    fn request(id: Uuid, expected: Option<String>) -> CreateTransfer {
        CreateTransfer {
            id,
            repository_id: Uuid::new_v4(),
            revision_id: Uuid::new_v4(),
            path: "weights/model.gguf".into(),
            filename: "model.gguf".into(),
            mime_type: "application/octet-stream".into(),
            created_by: Uuid::new_v4().to_string(),
            length: 8,
            expected_sha256: expected,
            expires_at: Utc::now() + ChronoDuration::hours(1),
        }
    }

    #[tokio::test]
    async fn resumes_by_committed_offset_and_promotes_atomically() {
        let (_directory, store) = store();
        let id = Uuid::new_v4();
        let fixture = store.root().join("fixture");
        fs::write(&fixture, b"verified").expect("fixture");
        let expected = crate::sha256_file(&fixture).expect("hash").0;
        store
            .create(request(id, Some(expected.clone())))
            .expect("create");
        let first = STANDARD.encode(Sha256::digest(b"veri"));
        let record = store
            .append(
                id,
                0,
                4,
                Some(&format!("sha256 {first}")),
                Body::from(Bytes::from_static(b"veri")),
            )
            .await
            .expect("first chunk");
        assert_eq!(record.offset, 4);
        assert_eq!(record.status, TransferStatus::Uploading);
        let second = STANDARD.encode(Sha256::digest(b"fied"));
        let record = store
            .append(
                id,
                4,
                4,
                Some(&format!("sha256 {second}")),
                Body::from(Bytes::from_static(b"fied")),
            )
            .await
            .expect("second chunk");
        assert_eq!(record.status, TransferStatus::Uploaded);
        let promoted = store.promote(id).await.expect("promote");
        assert_eq!(promoted.status, TransferStatus::Available);
        assert_eq!(promoted.actual_sha256.as_deref(), Some(expected.as_str()));
        let object = store.object_path(&expected).expect("object");
        assert_eq!(fs::read(object).expect("read"), b"verified");
    }

    #[tokio::test]
    async fn rejects_offset_and_checksum_without_advancing() {
        let (_directory, store) = store();
        let id = Uuid::new_v4();
        store.create(request(id, None)).expect("create");
        let error = store
            .append(id, 1, 4, None, Body::from(Bytes::from_static(b"veri")))
            .await
            .expect_err("offset conflict");
        assert!(matches!(error, TransferError::Offset));
        let error = store
            .append(
                id,
                0,
                4,
                Some("sha256 AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="),
                Body::from(Bytes::from_static(b"veri")),
            )
            .await
            .expect_err("checksum mismatch");
        assert!(matches!(error, TransferError::Checksum));
        assert_eq!(store.load(id).expect("state").offset, 0);
    }

    #[test]
    fn range_parser_is_bounded() {
        assert_eq!(
            parse_range(Some("bytes=2-5"), 10).expect("range"),
            ByteRange { start: 2, end: 5 }
        );
        assert_eq!(
            parse_range(Some("bytes=-3"), 10).expect("suffix"),
            ByteRange { start: 7, end: 9 }
        );
        assert!(parse_range(Some("bytes=20-"), 10).is_err());
        assert!(parse_range(Some("bytes=0-1,4-5"), 10).is_err());
    }

    #[test]
    fn repository_paths_fail_closed() {
        for path in ["../secret", "/absolute", "a//b", "a/./b", "a\\b"] {
            assert!(validate_repository_path(path).is_err(), "{path}");
        }
        assert!(validate_repository_path("models/model.gguf").is_ok());
    }
}
