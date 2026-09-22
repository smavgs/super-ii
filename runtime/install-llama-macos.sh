#!/bin/sh
set -eu

version="b10516"
build_number="10516"
runtime_root=${SUPERII_RUNTIME_ROOT:-"$HOME/Library/Application Support/Super ii Runtime/app"}
install_parent="$runtime_root/vendor/llama.cpp"
destination="$install_parent/$version"

case "$(uname -s):$(uname -m)" in
  Darwin:arm64)
    archive="llama-$version-bin-macos-arm64.tar.gz"
    expected_sha256="ee3324327d621026ae80c24031670e65fa62a0b23a3a027dbe2f65f240affd30"
    ;;
  Darwin:x86_64)
    archive="llama-$version-bin-macos-x64.tar.gz"
    expected_sha256="b7adecf7bd2cde577ddabee8357a72409165d8104f43b4acee9f1b98cc9c447a"
    ;;
  *)
    echo "Unsupported macOS architecture: $(uname -s) $(uname -m)" >&2
    exit 1
    ;;
esac

verify_installation() {
  candidate=$1
  test -x "$candidate/llama-cli"
  test -x "$candidate/llama-server"
  "$candidate/llama-server" --version 2>&1 | grep -Eq "build[[:space:]]+$build_number([,)]|$)"
}

mkdir -p "$install_parent"
lock_directory="$install_parent/.install-$version.lock"
if ! mkdir "$lock_directory" 2>/dev/null; then
  echo "Another llama.cpp $version installation is already in progress: $lock_directory" >&2
  exit 1
fi

temporary=""
cleanup() {
  if [ -n "$temporary" ] && [ -d "$temporary" ]; then
    rm -rf -- "$temporary"
  fi
  rmdir "$lock_directory" 2>/dev/null || true
}
trap cleanup EXIT HUP INT TERM

if [ -e "$destination" ]; then
  if verify_installation "$destination"; then
    echo "Verified llama.cpp $version at $destination"
    exit 0
  fi
  echo "Refusing to replace an invalid existing llama.cpp directory: $destination" >&2
  exit 1
fi

temporary=$(mktemp -d "$install_parent/.llama-$version.XXXXXX")
download="$temporary/$archive"
extracted="$temporary/extracted"
mkdir -p "$extracted"
curl --fail --location --silent --show-error \
  --connect-timeout 20 --max-time 300 --retry 3 \
  "https://github.com/ggml-org/llama.cpp/releases/download/$version/$archive" \
  --output "$download"
actual_sha256=$(shasum -a 256 "$download" | awk '{print $1}')
if [ "$actual_sha256" != "$expected_sha256" ]; then
  echo "llama.cpp archive checksum verification failed" >&2
  exit 1
fi

tar -xzf "$download" --strip-components=1 -C "$extracted"
verify_installation "$extracted"
chmod -R go-w "$extracted"
mv "$extracted" "$destination"
verify_installation "$destination"
echo "Installed and verified llama.cpp $version at $destination"
