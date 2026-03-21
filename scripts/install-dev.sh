#!/usr/bin/env bash
# For contributors — requires running 'bun run build.js' first.
set -euo pipefail

INSTALL_DIR="${HOME}/.local/bin"
BINARY_NAME="azdev"

OS="$(uname -s)"
ARCH="$(uname -m)"

if [[ "$OS" == "Darwin" && "$ARCH" == "arm64" ]]; then
  SRC="dist/azdev-darwin-arm64"
elif [[ "$OS" == "Linux" && "$ARCH" == "x86_64" ]]; then
  SRC="dist/azdev-linux-x64"
else
  echo "Unsupported platform: $OS $ARCH" >&2
  echo "Supported: Darwin arm64, Linux x86_64" >&2
  exit 1
fi

if [[ ! -f "$SRC" ]]; then
  echo "Binary not found at $SRC. Run 'bun run build.js' first." >&2
  exit 1
fi

mkdir -p "$INSTALL_DIR"
cp "$SRC" "$INSTALL_DIR/$BINARY_NAME"
chmod +x "$INSTALL_DIR/$BINARY_NAME"

echo "Installed: $INSTALL_DIR/$BINARY_NAME"

if ! echo ":${PATH}:" | grep -q ":${INSTALL_DIR}:"; then
  echo ""
  echo "Note: $INSTALL_DIR is not in your PATH."
  echo "Add to your shell profile (~/.zshrc or ~/.bashrc):"
  echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
fi
