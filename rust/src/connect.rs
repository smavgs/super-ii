use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use sha2::{Digest, Sha256};
use std::ffi::OsStr;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use toml_edit::{DocumentMut, value};
use uuid::Uuid;

pub const PUBLIC_MCP_URL: &str = "https://superii.site/mcp";

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum ConnectorKind {
    Codex,
    OpenCode,
    OpenCodeV1,
    OpenCodeV2,
}

impl FromStr for ConnectorKind {
    type Err = String;

    fn from_str(input: &str) -> Result<Self, Self::Err> {
        match input {
            "codex" => Ok(Self::Codex),
            "opencode" => Ok(Self::OpenCode),
            "opencode-v1" => Ok(Self::OpenCodeV1),
            "opencode-v2" => Ok(Self::OpenCodeV2),
            _ => Err("agent must be codex, opencode, opencode-v1, or opencode-v2".into()),
        }
    }
}

#[derive(Debug, Serialize)]
pub struct ConnectPlan {
    pub connector: ConnectorKind,
    pub config_path: PathBuf,
    pub endpoint: &'static str,
    pub existing_file: bool,
    pub changed: bool,
    pub behavior: &'static str,
    pub apply_required: bool,
    pub verification: &'static str,
    #[serde(skip)]
    before: Option<Vec<u8>>,
    #[serde(skip)]
    after: Vec<u8>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConnectReceipt {
    pub schema_version: u8,
    pub receipt_id: Uuid,
    pub action: String,
    pub connector: ConnectorKind,
    pub endpoint: String,
    pub config_path: PathBuf,
    pub backup_path: Option<PathBuf>,
    pub original_existed: bool,
    pub before_sha256: Option<String>,
    pub after_sha256: String,
    pub created_at: String,
    pub previous_receipt_id: Option<Uuid>,
}

#[derive(Debug, Serialize)]
pub struct ApplyResult {
    pub applied: bool,
    pub already_connected: bool,
    pub verified: bool,
    pub connector: ConnectorKind,
    pub config_path: PathBuf,
    pub receipt_path: Option<PathBuf>,
    pub receipt: Option<ConnectReceipt>,
}

#[derive(Debug, Serialize)]
pub struct RollbackPlan {
    pub receipt_id: Uuid,
    pub config_path: PathBuf,
    pub restores_existing_file: bool,
    pub current_matches_receipt: bool,
    pub apply_required: bool,
}

fn user_root() -> Result<PathBuf, String> {
    std::env::var_os("HOME")
        .or_else(|| std::env::var_os("USERPROFILE"))
        .map(PathBuf::from)
        .ok_or_else(|| "user profile directory is unavailable; pass --config explicitly".into())
}

pub fn default_config_path(connector: ConnectorKind) -> Result<PathBuf, String> {
    match connector {
        ConnectorKind::Codex => Ok(user_root()?.join(".codex/config.toml")),
        ConnectorKind::OpenCode | ConnectorKind::OpenCodeV1 | ConnectorKind::OpenCodeV2 => {
            std::env::current_dir()
                .map(|directory| directory.join("opencode.json"))
                .map_err(|error| format!("current directory is unavailable: {error}"))
        }
    }
}

pub fn default_receipt_dir() -> Result<PathBuf, String> {
    Ok(user_root()?.join(".superii/connect-receipts"))
}

fn absolute_path(path: PathBuf) -> Result<PathBuf, String> {
    if path.is_absolute() {
        Ok(path)
    } else {
        std::env::current_dir()
            .map(|directory| directory.join(path))
            .map_err(|error| format!("current directory is unavailable: {error}"))
    }
}

fn sha256_bytes(value: &[u8]) -> String {
    hex::encode(Sha256::digest(value))
}

fn codex_config(before: Option<&[u8]>) -> Result<Vec<u8>, String> {
    let source = match before {
        Some(bytes) => std::str::from_utf8(bytes).map_err(|_| "Codex config is not UTF-8")?,
        None => "",
    };
    let mut document = source
        .parse::<DocumentMut>()
        .map_err(|error| format!("Codex TOML is invalid: {error}"))?;
    if let Some(server) = document
        .get("mcp_servers")
        .and_then(|item| item.get("superii"))
    {
        if server.get("url").and_then(|item| item.as_str()) != Some(PUBLIC_MCP_URL) {
            return Err(
                "mcp_servers.superii already exists with a different URL; no file was changed"
                    .into(),
            );
        }
        if let Some(mode) = server.get("default_tools_approval_mode")
            && mode.as_str() != Some("prompt")
        {
            return Err(
                "mcp_servers.superii has a different approval mode; no file was changed".into(),
            );
        }
    }
    document["mcp_servers"]["superii"]["url"] = value(PUBLIC_MCP_URL);
    document["mcp_servers"]["superii"]["default_tools_approval_mode"] = value("prompt");
    Ok(document.to_string().into_bytes())
}

fn object_at_mut<'a>(
    root: &'a mut Value,
    path: &[&str],
) -> Result<&'a mut Map<String, Value>, String> {
    let mut current = root;
    for segment in path {
        let object = current
            .as_object_mut()
            .ok_or_else(|| format!("{} must be a JSON object", path.join(".")))?;
        current = object
            .entry((*segment).to_owned())
            .or_insert_with(|| json!({}));
    }
    current
        .as_object_mut()
        .ok_or_else(|| format!("{} must be a JSON object", path.join(".")))
}

fn is_v2_document(value: &Value) -> bool {
    value
        .get("mcp")
        .and_then(|mcp| mcp.get("servers"))
        .is_some_and(Value::is_object)
}

fn opencode_config(
    connector: ConnectorKind,
    before: Option<&[u8]>,
) -> Result<(ConnectorKind, Vec<u8>), String> {
    let mut document: Value = match before {
        Some(bytes) => serde_json::from_slice(bytes)
            .map_err(|error| format!("OpenCode JSON is invalid: {error}"))?,
        None => json!({}),
    };
    if !document.is_object() {
        return Err("OpenCode configuration root must be a JSON object".into());
    }
    let resolved = match connector {
        ConnectorKind::OpenCode if is_v2_document(&document) => ConnectorKind::OpenCodeV2,
        ConnectorKind::OpenCode => ConnectorKind::OpenCodeV1,
        other => other,
    };
    let (path, desired) = match resolved {
        ConnectorKind::OpenCodeV2 => (
            vec!["mcp", "servers"],
            json!({ "type": "remote", "url": PUBLIC_MCP_URL, "disabled": false }),
        ),
        ConnectorKind::OpenCodeV1 => (
            vec!["mcp"],
            json!({ "type": "remote", "url": PUBLIC_MCP_URL, "enabled": true }),
        ),
        _ => return Err("invalid OpenCode connector profile".into()),
    };
    let servers = object_at_mut(&mut document, &path)?;
    if let Some(existing) = servers.get("superii") {
        let object = existing
            .as_object()
            .ok_or_else(|| "OpenCode mcp.superii must be an object".to_string())?;
        if object.get("url").and_then(Value::as_str) != Some(PUBLIC_MCP_URL)
            || object.get("type").and_then(Value::as_str) != Some("remote")
        {
            return Err("OpenCode superii connector already exists with different settings; no file was changed".into());
        }
        if resolved == ConnectorKind::OpenCodeV1
            && object
                .get("enabled")
                .is_some_and(|item| item != &json!(true))
        {
            return Err("OpenCode superii connector is disabled; no file was changed".into());
        }
        if resolved == ConnectorKind::OpenCodeV2
            && object
                .get("disabled")
                .is_some_and(|item| item != &json!(false))
        {
            return Err("OpenCode V2 superii connector is disabled; no file was changed".into());
        }
    }
    servers.insert("superii".into(), desired);
    let mut output = serde_json::to_vec_pretty(&document).map_err(|error| error.to_string())?;
    output.push(b'\n');
    Ok((resolved, output))
}

pub fn plan_connect(
    connector: ConnectorKind,
    config_path: Option<PathBuf>,
) -> Result<ConnectPlan, String> {
    let path = absolute_path(config_path.unwrap_or(default_config_path(connector)?))?;
    let before = if path.exists() {
        Some(
            fs::read(&path)
                .map_err(|error| format!("could not read {}: {error}", path.display()))?,
        )
    } else {
        None
    };
    let (resolved, after) = match connector {
        ConnectorKind::Codex => (ConnectorKind::Codex, codex_config(before.as_deref())?),
        _ => opencode_config(connector, before.as_deref())?,
    };
    let changed = before.as_deref() != Some(after.as_slice());
    Ok(ConnectPlan {
        connector: resolved,
        config_path: path,
        endpoint: PUBLIC_MCP_URL,
        existing_file: before.is_some(),
        changed,
        behavior: if changed {
            "merge one public read-only connector"
        } else {
            "already connected"
        },
        apply_required: changed,
        verification: "parse configuration, re-read written bytes, and compare SHA-256",
        before,
        after,
    })
}

fn private_create(path: &Path, bytes: &[u8]) -> Result<(), String> {
    #[cfg(unix)]
    let mut file = {
        use std::os::unix::fs::OpenOptionsExt;
        OpenOptions::new()
            .create_new(true)
            .write(true)
            .mode(0o600)
            .open(path)
            .map_err(|error| format!("could not create {}: {error}", path.display()))?
    };
    #[cfg(not(unix))]
    let mut file = OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .map_err(|error| format!("could not create {}: {error}", path.display()))?;
    file.write_all(bytes).map_err(|error| error.to_string())?;
    file.sync_all().map_err(|error| error.to_string())?;
    Ok(())
}

fn atomic_replace(path: &Path, bytes: &[u8]) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or_else(|| "config path has no parent".to_string())?;
    fs::create_dir_all(parent)
        .map_err(|error| format!("could not create {}: {error}", parent.display()))?;
    let filename = path.file_name().and_then(OsStr::to_str).unwrap_or("config");
    let temporary = parent.join(format!(".{filename}.superii-tmp-{}", Uuid::new_v4()));
    private_create(&temporary, bytes)?;
    if let Err(error) = fs::rename(&temporary, path) {
        let _ = fs::remove_file(&temporary);
        return Err(format!(
            "could not atomically update {}: {error}",
            path.display()
        ));
    }
    Ok(())
}

fn restore_original(path: &Path, before: Option<&[u8]>) -> Result<(), String> {
    if let Some(bytes) = before {
        atomic_replace(path, bytes)
    } else if path.exists() {
        fs::remove_file(path)
            .map_err(|error| format!("could not remove {}: {error}", path.display()))
    } else {
        Ok(())
    }
}

pub fn apply_connect(plan: ConnectPlan, receipt_dir: PathBuf) -> Result<ApplyResult, String> {
    if !plan.changed {
        return Ok(ApplyResult {
            applied: false,
            already_connected: true,
            verified: true,
            connector: plan.connector,
            config_path: plan.config_path,
            receipt_path: None,
            receipt: None,
        });
    }
    let current = if plan.config_path.exists() {
        Some(fs::read(&plan.config_path).map_err(|error| error.to_string())?)
    } else {
        None
    };
    if current != plan.before {
        return Err("configuration changed after planning; no file was changed".into());
    }
    let receipt_dir = absolute_path(receipt_dir)?;
    fs::create_dir_all(&receipt_dir)
        .map_err(|error| format!("could not create receipt directory: {error}"))?;
    let receipt_id = Uuid::new_v4();
    let backup_path = if let Some(before) = &plan.before {
        let backup = receipt_dir.join(format!("{receipt_id}.backup"));
        private_create(&backup, before)?;
        Some(backup)
    } else {
        None
    };
    atomic_replace(&plan.config_path, &plan.after)?;
    let verified_bytes = match fs::read(&plan.config_path) {
        Ok(bytes) => bytes,
        Err(error) => {
            let restore = restore_original(&plan.config_path, plan.before.as_deref());
            return Err(match restore {
                Ok(()) => {
                    format!("written configuration could not be verified and was restored: {error}")
                }
                Err(restore_error) => format!(
                    "written configuration could not be verified ({error}) and restoration failed: {restore_error}"
                ),
            });
        }
    };
    if verified_bytes != plan.after {
        let restore = restore_original(&plan.config_path, plan.before.as_deref());
        return Err(match restore {
            Ok(()) => "written configuration failed byte verification and was restored".into(),
            Err(error) => format!(
                "written configuration failed byte verification and restoration failed: {error}"
            ),
        });
    }
    let receipt = ConnectReceipt {
        schema_version: 1,
        receipt_id,
        action: "connect".into(),
        connector: plan.connector,
        endpoint: PUBLIC_MCP_URL.into(),
        config_path: plan.config_path.clone(),
        backup_path,
        original_existed: plan.before.is_some(),
        before_sha256: plan.before.as_deref().map(sha256_bytes),
        after_sha256: sha256_bytes(&plan.after),
        created_at: chrono::Utc::now().to_rfc3339(),
        previous_receipt_id: None,
    };
    let receipt_path = receipt_dir.join(format!("{receipt_id}.json"));
    let receipt_bytes = serde_json::to_vec_pretty(&receipt).map_err(|error| error.to_string())?;
    if let Err(error) = private_create(&receipt_path, &receipt_bytes) {
        let _ = fs::remove_file(&receipt_path);
        let restore = restore_original(&plan.config_path, plan.before.as_deref());
        return Err(match restore {
            Ok(()) => format!("receipt write failed and config was restored: {error}"),
            Err(restore_error) => format!(
                "receipt write failed ({error}) and config restoration failed: {restore_error}"
            ),
        });
    }
    Ok(ApplyResult {
        applied: true,
        already_connected: false,
        verified: true,
        connector: plan.connector,
        config_path: plan.config_path,
        receipt_path: Some(receipt_path),
        receipt: Some(receipt),
    })
}

pub fn load_receipt(path: &Path) -> Result<ConnectReceipt, String> {
    let receipt: ConnectReceipt = serde_json::from_slice(
        &fs::read(path).map_err(|error| format!("could not read receipt: {error}"))?,
    )
    .map_err(|error| format!("receipt JSON is invalid: {error}"))?;
    if receipt.schema_version != 1 || receipt.action != "connect" {
        return Err("unsupported connect receipt".into());
    }
    Ok(receipt)
}

pub fn plan_rollback(receipt: &ConnectReceipt) -> Result<RollbackPlan, String> {
    let current = fs::read(&receipt.config_path)
        .map_err(|error| format!("could not read current configuration: {error}"))?;
    let current_matches = sha256_bytes(&current) == receipt.after_sha256;
    Ok(RollbackPlan {
        receipt_id: receipt.receipt_id,
        config_path: receipt.config_path.clone(),
        restores_existing_file: receipt.original_existed,
        current_matches_receipt: current_matches,
        apply_required: current_matches,
    })
}

pub fn apply_rollback(
    receipt: &ConnectReceipt,
    receipt_dir: PathBuf,
) -> Result<(RollbackPlan, PathBuf), String> {
    let plan = plan_rollback(receipt)?;
    if !plan.current_matches_receipt {
        return Err(
            "configuration changed since connect; rollback refused to protect newer edits".into(),
        );
    }
    let connected_bytes = fs::read(&receipt.config_path)
        .map_err(|error| format!("could not read connected configuration: {error}"))?;
    let receipt_dir = absolute_path(receipt_dir)?;
    fs::create_dir_all(&receipt_dir).map_err(|error| error.to_string())?;
    let restored = if receipt.original_existed {
        let backup_path = receipt
            .backup_path
            .as_ref()
            .ok_or_else(|| "connect receipt has no backup path".to_string())?;
        let bytes =
            fs::read(backup_path).map_err(|error| format!("could not read backup: {error}"))?;
        let backup_hash = sha256_bytes(&bytes);
        if receipt.before_sha256.as_deref() != Some(backup_hash.as_str()) {
            return Err("backup SHA-256 does not match the connect receipt".into());
        }
        atomic_replace(&receipt.config_path, &bytes)?;
        bytes
    } else {
        fs::remove_file(&receipt.config_path)
            .map_err(|error| format!("could not remove connector-only config: {error}"))?;
        Vec::new()
    };
    let rollback_id = Uuid::new_v4();
    let rollback = ConnectReceipt {
        schema_version: 1,
        receipt_id: rollback_id,
        action: "rollback".into(),
        connector: receipt.connector,
        endpoint: receipt.endpoint.clone(),
        config_path: receipt.config_path.clone(),
        backup_path: None,
        original_existed: true,
        before_sha256: Some(receipt.after_sha256.clone()),
        after_sha256: sha256_bytes(&restored),
        created_at: chrono::Utc::now().to_rfc3339(),
        previous_receipt_id: Some(receipt.receipt_id),
    };
    let path = receipt_dir.join(format!("{rollback_id}.json"));
    if let Err(error) = private_create(
        &path,
        &serde_json::to_vec_pretty(&rollback).map_err(|error| error.to_string())?,
    ) {
        let _ = fs::remove_file(&path);
        let restore = atomic_replace(&receipt.config_path, &connected_bytes);
        return Err(match restore {
            Ok(()) => format!(
                "rollback receipt write failed and the connected configuration was restored: {error}"
            ),
            Err(restore_error) => format!(
                "rollback receipt write failed ({error}) and connected configuration restoration failed: {restore_error}"
            ),
        });
    }
    Ok((plan, path))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn codex_connect_preserves_unrelated_toml_and_rolls_back() {
        let directory = tempfile::tempdir().expect("tempdir");
        let config = directory.path().join("config.toml");
        fs::write(&config, b"model = \"gpt-test\"\n").expect("fixture");
        let receipts = directory.path().join("receipts");
        let plan = plan_connect(ConnectorKind::Codex, Some(config.clone())).expect("plan");
        assert!(plan.changed);
        let applied = apply_connect(plan, receipts.clone()).expect("apply");
        let output = fs::read_to_string(&config).expect("read");
        assert!(output.contains("model = \"gpt-test\""));
        assert!(output.contains(PUBLIC_MCP_URL));
        let receipt = applied.receipt.expect("receipt");
        apply_rollback(&receipt, receipts).expect("rollback");
        assert_eq!(
            fs::read_to_string(config).expect("restored"),
            "model = \"gpt-test\"\n"
        );
    }

    #[test]
    fn opencode_detects_v2_and_preserves_other_servers() {
        let directory = tempfile::tempdir().expect("tempdir");
        let config = directory.path().join("opencode.json");
        fs::write(
            &config,
            br#"{"mcp":{"servers":{"other":{"type":"remote","url":"https://example.test/mcp"}}}}"#,
        )
        .expect("fixture");
        let plan = plan_connect(ConnectorKind::OpenCode, Some(config.clone())).expect("plan");
        assert_eq!(plan.connector, ConnectorKind::OpenCodeV2);
        apply_connect(plan, directory.path().join("receipts")).expect("apply");
        let parsed: Value = serde_json::from_slice(&fs::read(config).expect("read")).expect("json");
        assert_eq!(
            parsed["mcp"]["servers"]["other"]["url"],
            "https://example.test/mcp"
        );
        assert_eq!(parsed["mcp"]["servers"]["superii"]["url"], PUBLIC_MCP_URL);
    }

    #[test]
    fn refuses_to_overwrite_a_conflicting_connector() {
        let directory = tempfile::tempdir().expect("tempdir");
        let config = directory.path().join("opencode.json");
        fs::write(
            &config,
            br#"{"mcp":{"superii":{"type":"remote","url":"https://wrong.test"}}}"#,
        )
        .expect("fixture");
        assert!(plan_connect(ConnectorKind::OpenCodeV1, Some(config)).is_err());
    }
}
