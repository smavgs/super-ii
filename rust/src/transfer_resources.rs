//! Local capacity limits. Durable account/spending authorization stays in the control plane.
use crate::transfer::{TransferError, TransferRecord, TransferStatus};
use std::collections::HashMap;
use std::fs::{self, File, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use uuid::Uuid;

#[derive(Clone, Debug)]
pub struct TransferLimits {
    pub concurrent_uploads: usize,
    pub concurrent_downloads: usize,
    pub concurrent_disk_jobs: usize,
    pub active_transfers: usize,
    pub transfers_per_owner: usize,
    pub quarantine_bytes: u64,
    pub free_disk_reserve_bytes: u64,
    pub idle_timeout: Duration,
    pub upload_timeout: Duration,
    pub download_timeout: Duration,
}

impl Default for TransferLimits {
    fn default() -> Self {
        Self {
            concurrent_uploads: 8,
            concurrent_downloads: 16,
            concurrent_disk_jobs: 2,
            active_transfers: 128,
            transfers_per_owner: 16,
            quarantine_bytes: 50 * 1024 * 1024 * 1024,
            free_disk_reserve_bytes: 5 * 1024 * 1024 * 1024,
            idle_timeout: Duration::from_secs(60),
            upload_timeout: Duration::from_secs(15 * 60),
            download_timeout: Duration::from_secs(6 * 60 * 60),
        }
    }
}

struct Reservation {
    owner: String,
    length: u64,
    remaining: u64,
}

pub(crate) struct Resources {
    pub limits: TransferLimits,
    pub requests: Arc<Semaphore>,
    pub uploads: Arc<Semaphore>,
    pub downloads: Arc<Semaphore>,
    pub disk_jobs: Arc<Semaphore>,
    reservations: Mutex<HashMap<Uuid, Reservation>>,
    scratch_bytes: u64,
    // A second daemon must not bypass accounting or race writes to the same root.
    _root_lock: File,
}

impl Resources {
    pub fn new(
        root: &Path,
        limits: TransferLimits,
        chunk_bytes: u64,
    ) -> Result<Self, TransferError> {
        if [
            limits.concurrent_uploads,
            limits.concurrent_downloads,
            limits.concurrent_disk_jobs,
            limits.active_transfers,
            limits.transfers_per_owner,
        ]
        .iter()
        .any(|value| *value == 0 || *value > Semaphore::MAX_PERMITS)
            || limits.quarantine_bytes == 0
            || limits.idle_timeout.is_zero()
            || limits.upload_timeout.is_zero()
            || limits.download_timeout.is_zero()
        {
            return Err(TransferError::Invalid(
                "invalid transfer resource limits".into(),
            ));
        }
        let scratch_bytes = chunk_bytes
            .checked_mul(limits.concurrent_uploads as u64)
            .and_then(|v| v.checked_mul(2))
            .ok_or(TransferError::TooLarge)?;
        let root_lock = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(root.join(".transfer.lock"))?;
        root_lock
            .try_lock()
            .map_err(|_| TransferError::Conflict("transfer root is already in use".into()))?;
        let resources = Self {
            requests: Arc::new(Semaphore::new(64)),
            uploads: Arc::new(Semaphore::new(limits.concurrent_uploads)),
            downloads: Arc::new(Semaphore::new(limits.concurrent_downloads)),
            disk_jobs: Arc::new(Semaphore::new(limits.concurrent_disk_jobs)),
            reservations: Mutex::new(HashMap::new()),
            limits,
            scratch_bytes,
            _root_lock: root_lock,
        };
        // Rebuild from durable records, including expired payloads until cleanup removes them.
        for entry in fs::read_dir(root.join("transfers"))? {
            let entry = entry?;
            if !entry.file_type()?.is_dir() {
                continue;
            }
            for file in fs::read_dir(entry.path())? {
                let file = file?;
                if file.file_type()?.is_file()
                    && file.file_name().to_string_lossy().ends_with(".pending")
                {
                    fs::remove_file(file.path())?;
                }
            }
            let state = entry.path().join("state.json");
            // An interrupted create has no acknowledged transfer to preserve.
            if !state.exists()
                && !entry
                    .path()
                    .join("payload")
                    .metadata()
                    .is_ok_and(|m| m.len() > 0)
            {
                fs::remove_dir_all(entry.path())?;
                continue;
            }
            let record: TransferRecord = serde_json::from_slice(&fs::read(state)?)?;
            if record.id.to_string() != entry.file_name().to_string_lossy() {
                return Err(TransferError::Conflict("transfer identity mismatch".into()));
            }
            if record.status != TransferStatus::Available
                && (record.status != TransferStatus::Rejected
                    || entry.path().join("payload").exists())
            {
                resources
                    .reservations
                    .lock()
                    .expect("reservation mutex poisoned")
                    .insert(
                        record.id,
                        Reservation {
                            owner: record.created_by,
                            length: record.length,
                            remaining: record.length.saturating_sub(record.offset),
                        },
                    );
            }
        }
        Ok(resources)
    }

    pub fn reserve(
        &self,
        root: &Path,
        id: Uuid,
        owner: &str,
        length: u64,
    ) -> Result<(), TransferError> {
        let mut records = self
            .reservations
            .lock()
            .expect("reservation mutex poisoned");
        if records.contains_key(&id) {
            return Err(TransferError::Conflict("transfer already exists".into()));
        }
        let total: u128 = records.values().map(|r| u128::from(r.length)).sum();
        let remaining: u128 = records.values().map(|r| u128::from(r.remaining)).sum();
        if records.len() >= self.limits.active_transfers
            || records.values().filter(|r| r.owner == owner).count()
                >= self.limits.transfers_per_owner
            || total + u128::from(length) > u128::from(self.limits.quarantine_bytes)
        {
            return Err(TransferError::Capacity);
        }
        let needed = remaining
            + u128::from(length)
            + u128::from(self.scratch_bytes)
            + u128::from(self.limits.free_disk_reserve_bytes);
        if u128::from(fs2::available_space(root)?) < needed {
            return Err(TransferError::Capacity);
        }
        records.insert(
            id,
            Reservation {
                owner: owner.into(),
                length,
                remaining: length,
            },
        );
        Ok(())
    }

    pub fn check_disk(&self, root: &Path) -> Result<(), TransferError> {
        if u128::from(fs2::available_space(root)?)
            < u128::from(self.limits.free_disk_reserve_bytes) + u128::from(self.scratch_bytes)
        {
            return Err(TransferError::Capacity);
        }
        Ok(())
    }

    pub fn advance(&self, id: Uuid, offset: u64) {
        if let Some(record) = self
            .reservations
            .lock()
            .expect("reservation mutex poisoned")
            .get_mut(&id)
        {
            record.remaining = record.length.saturating_sub(offset);
        }
    }

    pub fn release(&self, id: Uuid) {
        self.reservations
            .lock()
            .expect("reservation mutex poisoned")
            .remove(&id);
    }
}

pub(crate) fn admit(semaphore: &Arc<Semaphore>) -> Result<OwnedSemaphorePermit, TransferError> {
    semaphore
        .clone()
        .try_acquire_owned()
        .map_err(|_| TransferError::Busy)
}

// Synchronous unlink also runs when an async body future is cancelled or errors.
pub(crate) struct PendingChunk(pub PathBuf);
impl Drop for PendingChunk {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
