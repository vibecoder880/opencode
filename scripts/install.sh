#!/usr/bin/env sh
# OpenCode + OC Kit single-command installer (macOS / Linux / WSL).
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/vibecoder880/opencode/main/scripts/install.sh | bash
#
# This installs OpenCode with OC Kit support built-in.
# After installation, run `opencode` to start.

set -eu

# --- Configuration -----------------------------------------------------------
OPENCODE_VERSION="${OPENCODE_VERSION:-}"
INSTALL_DIR="${OPENCODE_INSTALL_DIR:-}"
GITHUB_REPO="vibecoder880/opencode"
API_URL="https://api.github.com/repos/${GITHUB_REPO}/releases"

# --- Colors ------------------------------------------------------------------
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

info() { printf "${GREEN}[INFO]${NC} %s\n" "$1"; }
warn() { printf "${YELLOW}[WARN]${NC} %s\n" "$1"; }
error() { printf "${RED}[ERROR]${NC} %s\n" "$1" >&2; exit 1; }

# --- Detect OS/Arch ---------------------------------------------------------
detect_os() {
  case "$(uname -s)" in
    Linux*)  echo "linux" ;;
    Darwin*) echo "darwin" ;;
    *MINGW*|*MSYS*|*CYGWIN*) echo "windows" ;;
    *)       echo "unknown" ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64)   echo "amd64" ;;
    arm64|aarch64)  echo "arm64" ;;
    i386|i686)      echo "386" ;;
    *)              echo "unknown" ;;
  esac
}

have() {
  command -v "$1" >/dev/null 2>&1
}

# --- Resolve release --------------------------------------------------------
resolve_release() {
  if [ -n "$OPENCODE_VERSION" ]; then
    echo "$OPENCODE_VERSION"
    return
  fi
  
  if have curl; then
    curl -fsSL "${API_URL}/latest" 2>/dev/null | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1
  elif have wget; then
    wget -qO- "${API_URL}/latest" 2>/dev/null | sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' | head -n 1
  else
    error "curl or wget is required"
  fi
}

# --- Install from source (fallback) ----------------------------------------
install_from_source() {
  info "No release found. Installing from source..."
  
  if ! have git; then
    error "git is required for source installation"
  fi
  
  if ! have bun; then
    info "Installing bun..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
  fi
  
  if ! have bun; then
    error "bun installation failed"
  fi
  
  CLONE_DIR="${HOME}/.opencode-src"
  if [ -d "$CLONE_DIR" ]; then
    info "Updating existing source..."
    cd "$CLONE_DIR" && git pull
  else
    info "Cloning OpenCode..."
    git clone https://github.com/${GITHUB_REPO}.git "$CLONE_DIR"
  fi
  
  cd "$CLONE_DIR"
  
  info "Installing dependencies..."
  bun install
  
  info "Building OpenCode..."
  cd packages/opencode && bun run build
  
  # Copy binary to install directory
  BINARY_PATH="dist/opencode-${OS}-${ARCH}/bin/opencode"
  if [ -f "$BINARY_PATH" ]; then
    mkdir -p "$INSTALL_DIR"
    cp "$BINARY_PATH" "$INSTALL_DIR/opencode"
    chmod +x "$INSTALL_DIR/opencode"
    info "OpenCode installed to ${INSTALL_DIR}/opencode"
  else
    error "build failed - binary not found at ${BINARY_PATH}"
  fi
}

# --- Main --------------------------------------------------------------------
main() {
  OS="$(detect_os)"
  ARCH="$(detect_arch)"
  
  if [ "${OS}" = "unknown" ] || [ "${ARCH}" = "unknown" ]; then
    error "unsupported platform (os=${OS}, arch=${ARCH})"
  fi
  
  info "OpenCode + OC Kit installer"
  info "os=${OS} arch=${ARCH}"
  
  # Resolve version
  RELEASE="$(resolve_release)"
  if [ -z "$RELEASE" ]; then
    warn "no release found, installing from source..."
    install_from_source
    return
  fi
  info "version: ${RELEASE}"
  
  # Determine install directory
  if [ -z "$INSTALL_DIR" ]; then
    if [ "${OS}" = "darwin" ] || [ "${OS}" = "linux" ]; then
      INSTALL_DIR="${HOME}/.opencode/bin"
    else
      INSTALL_DIR="${HOME}/.opencode/bin"
    fi
  fi
  mkdir -p "$INSTALL_DIR"
  
  # Download archive
  ARCHIVE="opencode-${OS}-${ARCH}.tar.gz"
  DOWNLOAD_URL="https://github.com/${GITHUB_REPO}/releases/download/${RELEASE}/${ARCHIVE}"
  
  info "downloading ${DOWNLOAD_URL}"
  
  TMPDIR_SAFE="${TMPDIR:-/tmp}"
  ARCHIVE_PATH="${TMPDIR_SAFE}/opencode-${RELEASE}.tar.gz"
  
  if have curl; then
    curl -fsSL "$DOWNLOAD_URL" -o "$ARCHIVE_PATH"
  elif have wget; then
    wget -qO "$ARCHIVE_PATH" "$DOWNLOAD_URL"
  else
    error "curl or wget is required"
  fi
  
  # Extract
  info "extracting to ${INSTALL_DIR}"
  tar -xzf "$ARCHIVE_PATH" -C "$INSTALL_DIR" 2>/dev/null || {
    # If tar fails, try unzip
    unzip -o -q "$ARCHIVE_PATH" -d "$INSTALL_DIR" 2>/dev/null || {
      rm -f "$ARCHIVE_PATH"
      error "failed to extract archive"
    }
  }
  rm -f "$ARCHIVE_PATH"
  
  # Make executable
  chmod +x "${INSTALL_DIR}/opencode" 2>/dev/null || true
  chmod +x "${INSTALL_DIR}/oc" 2>/dev/null || true
  
  # Add to PATH if needed
  case ":$PATH:" in
    *":${INSTALL_DIR}:"*) 
      info "${INSTALL_DIR} already in PATH"
      ;;
    *)
      SHELL_RC=""
      if [ -f "${HOME}/.bashrc" ]; then
        SHELL_RC="${HOME}/.bashrc"
      elif [ -f "${HOME}/.zshrc" ]; then
        SHELL_RC="${HOME}/.zshrc"
      elif [ -f "${HOME}/.profile" ]; then
        SHELL_RC="${HOME}/.profile"
      fi
      
      if [ -n "$SHELL_RC" ]; then
        echo "export PATH=\"${INSTALL_DIR}:\$PATH\"" >> "$SHELL_RC"
        info "added ${INSTALL_DIR} to PATH in ${SHELL_RC}"
        warn "restart your shell or run: source ${SHELL_RC}"
      else
        warn "add ${INSTALL_DIR} to your PATH manually"
      fi
      ;;
  esac
  
  # Verify installation
  info "verifying installation..."
  
  if [ -x "${INSTALL_DIR}/opencode" ]; then
    info "OpenCode installed successfully!"
    "${INSTALL_DIR}/opencode" --version 2>/dev/null || true
  elif have opencode; then
    info "OpenCode installed successfully!"
    opencode --version 2>/dev/null || true
  else
    warn "opencode binary not found in ${INSTALL_DIR}"
  fi
  
  echo ""
  info "Installation complete!"
  echo ""
  echo "  Run 'opencode' to start OpenCode with OC Kit support"
  echo ""
  echo "  Quick commands:"
  echo "    opencode                    # Start OpenCode"
  echo "    opencode kit list           # List installed kits"
  echo "    opencode kit install <id>   # Install a kit"
  echo "    opencode kit doctor         # Check kit health"
  echo ""
}

main "$@"
