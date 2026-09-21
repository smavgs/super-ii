#!/bin/sh
set -eu

load_agents=0
if [ "${1:-}" = "--load" ]; then
  load_agents=1
  shift
fi
if [ "$#" -ne 0 ]; then
  echo "Usage: $0 [--load]" >&2
  exit 2
fi

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
runtime_root=${SUPERII_RUNTIME_ROOT:-"$HOME/Library/Application Support/Super ii Runtime/app"}
log_root=${SUPERII_LOG_ROOT:-"$HOME/Library/Logs"}
launch_agents_dir=${SUPERII_LAUNCH_AGENTS_DIR:-"$HOME/Library/LaunchAgents"}
python_bin=${PYTHON_BIN:-python3}

for launcher in bridge cloudflared policy transfer; do
  if [ ! -x "$runtime_root/run-$launcher-macos.sh" ]; then
    echo "Missing executable: $runtime_root/run-$launcher-macos.sh" >&2
    exit 1
  fi
done

mkdir -p "$log_root" "$launch_agents_dir"
umask 077

for template in "$script_dir"/site.superii.*.plist.template; do
  label=$(basename "$template" .plist.template)
  destination="$launch_agents_dir/$label.plist"
  "$python_bin" - "$template" "$destination" "$runtime_root" "$log_root" <<'PY'
import os
import sys
from pathlib import Path
from xml.sax.saxutils import escape

template, destination, runtime_root, log_root = map(Path, sys.argv[1:])
content = template.read_text(encoding="utf-8")
content = content.replace("__SUPERII_RUNTIME_ROOT__", escape(str(runtime_root)))
content = content.replace("__SUPERII_LOG_ROOT__", escape(str(log_root)))
if "__SUPERII_" in content:
    raise SystemExit(f"Unresolved launch-agent marker in {template}")
temporary = destination.with_name(f".{destination.name}.{os.getpid()}.tmp")
temporary.write_text(content, encoding="utf-8")
temporary.chmod(0o600)
os.replace(temporary, destination)
PY
  /usr/bin/plutil -lint "$destination" >/dev/null
  echo "Installed $destination"
  if [ "$load_agents" -eq 1 ]; then
    domain="gui/$(id -u)"
    /bin/launchctl bootout "$domain/$label" >/dev/null 2>&1 || true
    /bin/launchctl bootstrap "$domain" "$destination"
    echo "Loaded $label"
  fi
done
