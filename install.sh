#!/usr/bin/env bash
set -euo pipefail

REPO="renatoadorno/azdev"
INSTALL_DIR="${HOME}/.local/bin"
BINARY_NAME="azdev"

# Detect OS and architecture
OS="$(uname -s)"
ARCH="$(uname -m)"

if [[ "$OS" == "Darwin" && "$ARCH" == "arm64" ]]; then
  ASSET="azdev-darwin-arm64"
elif [[ "$OS" == "Linux" && "$ARCH" == "x86_64" ]]; then
  ASSET="azdev-linux-x64"
else
  echo "Unsupported platform: $OS $ARCH" >&2
  echo "Supported: Darwin arm64, Linux x86_64" >&2
  exit 1
fi

# Resolve version (latest release if not specified via AZDEV_VERSION env var)
VERSION="${AZDEV_VERSION:-}"
if [[ -z "$VERSION" ]]; then
  VERSION=$(curl -fsSL "https://api.github.com/repos/${REPO}/releases/latest" \
    | grep '"tag_name"' | sed 's/.*"tag_name": *"//;s/".*//')
fi

if [[ -z "$VERSION" ]]; then
  echo "Could not determine latest release version." >&2
  echo "Set AZDEV_VERSION=vX.Y.Z to specify a version manually." >&2
  exit 1
fi

BASE_URL="https://github.com/${REPO}/releases/download/${VERSION}"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

echo "Downloading azdev ${VERSION} for ${OS} ${ARCH}..."
curl -fsSL "${BASE_URL}/${ASSET}"   -o "${TMP_DIR}/${BINARY_NAME}"
curl -fsSL "${BASE_URL}/SHA256SUMS" -o "${TMP_DIR}/SHA256SUMS"

# Verify SHA256 (portable: sha256sum on Linux, shasum on macOS)
EXPECTED=$(grep " ${ASSET}" "${TMP_DIR}/SHA256SUMS" | awk '{print $1}')
if command -v sha256sum &>/dev/null; then
  ACTUAL=$(sha256sum "${TMP_DIR}/${BINARY_NAME}" | awk '{print $1}')
elif command -v shasum &>/dev/null; then
  ACTUAL=$(shasum -a 256 "${TMP_DIR}/${BINARY_NAME}" | awk '{print $1}')
else
  echo "Warning: sha256sum / shasum not found — skipping verification" >&2
  ACTUAL="$EXPECTED"
fi

if [[ "$EXPECTED" != "$ACTUAL" ]]; then
  echo "SHA256 mismatch!" >&2
  echo "  Expected: ${EXPECTED}" >&2
  echo "  Got:      ${ACTUAL}" >&2
  exit 1
fi
echo "SHA256 verified."

mkdir -p "$INSTALL_DIR"
cp "${TMP_DIR}/${BINARY_NAME}" "${INSTALL_DIR}/${BINARY_NAME}"
chmod +x "${INSTALL_DIR}/${BINARY_NAME}"

echo "Installed: ${INSTALL_DIR}/${BINARY_NAME}"

if ! echo ":${PATH}:" | grep -q ":${INSTALL_DIR}:"; then
  echo ""
  echo "Note: ${INSTALL_DIR} is not in your PATH."
  echo "Add to your shell profile (~/.zshrc or ~/.bashrc):"
  echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
fi
