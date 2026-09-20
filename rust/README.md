# Super ii transfer service and CLI

This crate contains the bounded data-plane components used by Super ii:

- `superii-transferd` implements checksum-bound, offset-reconciled resumable
  transfer and atomic content-addressed promotion.
- `superii` provides guarded push, pull, verify, connector, and rollback
  commands for operators and trusted automation.

Credentials are supplied at invocation, never written into repository state,
and restricted to HTTPS or loopback origins. Local connector changes are
dry-run-first, preserve unrelated configuration, create private backups and
receipts, and refuse unsafe conflicts.

Run the complete Rust checks from the repository root:

```sh
cargo +1.97.0 fmt --manifest-path rust/Cargo.toml --check
cargo +1.97.0 test --locked --manifest-path rust/Cargo.toml
cargo +1.97.0 clippy --locked --all-targets --manifest-path rust/Cargo.toml -- -D warnings
```

See the root [README](../README.md), [system-state register](../SYSTEM-STATE.md),
and [resumable-transfer architecture](../docs/architecture/resumable-transfers.md)
for the surrounding trust and release boundaries.

The crate is provided under the [Super ii Modified MIT License](LICENSE), a
custom license with a commercial attribution condition.
