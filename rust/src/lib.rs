pub mod connect;
pub mod transfer;

use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{self, Read};
use std::path::Path;

pub const COPY_BUFFER_BYTES: usize = 1024 * 1024;

pub fn sha256_file(path: &Path) -> io::Result<(String, u64)> {
    let mut source = File::open(path)?;
    let mut digest = Sha256::new();
    let mut buffer = vec![0_u8; COPY_BUFFER_BYTES];
    let mut size = 0_u64;
    loop {
        let read = source.read(&mut buffer)?;
        if read == 0 {
            break;
        }
        size = size
            .checked_add(read as u64)
            .ok_or_else(|| io::Error::other("file size overflow"))?;
        digest.update(&buffer[..read]);
    }
    Ok((hex::encode(digest.finalize()), size))
}

pub fn valid_sha256(value: &str) -> bool {
    value.len() == 64
        && value
            .as_bytes()
            .iter()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn hashes_files_without_loading_them_whole() {
        let directory = tempfile::tempdir().expect("tempdir");
        let path = directory.path().join("fixture");
        fs::write(&path, b"verified").expect("fixture");
        let (sha256, size) = sha256_file(&path).expect("hash");
        assert_eq!(
            sha256,
            "1c34f88707b55e6104c4eb20e71ffa3d33e414b71ef689a15fad0640d0ac58cb"
        );
        assert_eq!(size, 8);
    }

    #[test]
    fn accepts_only_canonical_lowercase_sha256() {
        assert!(valid_sha256(&"a".repeat(64)));
        assert!(!valid_sha256(&"A".repeat(64)));
        assert!(!valid_sha256("../../object"));
    }
}
