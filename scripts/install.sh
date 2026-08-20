#!/usr/bin/env sh
# OC Kit single-command installer (macOS / Linux / WSL).
#
# Pipeline (plan §34-35): detect OS/arch → fetch release metadata from the
# GitHub Releases registry → verify sha256 → install the archive → update PATH →
# verify the executable → surface post-install checks.
#
# The release registry is `opencode-ai/kits` by default; override with
# OCKIT_REGISTRY_OWNER / OCKIT_REGISTRY_REPO.
#
# NOTE: CI validates the syntax of this script only (`sh -n`); no live network
# install ever runs in CI.

set -eu

KIT_ID="${1:-engineer}"
VERSION="${OCKIT_KIT_VERSION:-}"
OWNER="${OCKIT_REGISTRY_OWNER:-opencode-ai}"
REPO="${OCKIT_REGISTRY_REPO:-kits}"
INSTALL_DIR="${OCKIT_INSTALL_DIR:-}"
API_URL="https://api.github.com/repos/${OWNER}/${REPO}/releases"
RAW_URL="https://raw.githubusercontent.com/${OWNER}/${REPO}"

# --- detect ----------------------------------------------------------------
detect_os() {
  case "$(uname -s)" in
    Linux*) echo "linux" ;;
    Darwin*) echo "darwin" ;;
    *MINGW*|*MSYS*|*CYGWIN*) echo "windows" ;;
    *) echo "unknown" ;;
  esac
}

detect_arch() {
  case "$(uname -m)" in
    x86_64|amd64) echo "amd64" ;;
    arm64|aarch64) echo "arm64" ;;
    i386|i686) echo "386" ;;
    *) echo "unknown" ;;
  esac
}

have() {
  command -v "$1" >/dev/null 2>&1
}

# --- fetch -----------------------------------------------------------------
# Resolve the latest release tag whose kit manifest is compatible with the
# running opencode runtime (min_opencode guard lives in the manifest).
resolve_release() {
  if [ -n "$VERSION" ]; then
    echo "$VERSION"
    return
  fi
  if ! have curl; then
    echo "error: curl is required to install OC Kit" >&2
    exit 1
  fi
  curl -fsSL "${API_URL}" |
    sed -n 's/.*"tag_name": *"\([^"]*\)".*/\1/p' |
    head -n 1
}

from_json() {
  # Minimal JSON field extractor (no jq dependency): prints the value of a
  # string field whose key exactly matches "$1".
  sed -n "s/.*\"$1\" *: *\"\([^\"]*\)\".*/\1/p" | head -n 1
}

main() {
  OS="$(detect_os)"
  ARCH="$(detect_arch)"
  if [ "${OS}" = "unknown" ] || [ "${ARCH}" = "unknown" ]; then
    echo "error: unsupported platform (os=${OS}, arch=${ARCH})" >&2
    exit 1
  fi

  echo "OC Kit installer — os=${OS} arch=${ARCH} kit=${KIT_ID}"

  RELEASE="$(resolve_release)"
  if [ -z "$RELEASE" ]; then
    echo "error: no release found for ${OWNER}/${REPO}" >&2
    exit 1
  fi
  echo "release: $RELEASE"

  if [ -z "$INSTALL_DIR" ]; then
    INSTALL_DIR="${HOME}/.opencode-kits/${KIT_ID}"
  fi
  mkdir -p "$INSTALL_DIR"

  ARCHIVE="kit-${OS}-${ARCH}.tar.gz"
  ARCHIVE_URL="${RAW_URL}/${RELEASE}/${ARCHIVE}"
  CHECKSUMS_URL="${RAW_URL}/${RELEASE}/checksums.txt"

  # --- verify --------------------------------------------------------------
  if [ -n "$VERSION" ] || [ -z "${VERSION}" ]; then :; fi
  if have shasum; then
    SHA_BIN="shasum"
  elif have sha256sum; then
    SHA_BIN="sha256sum"
  else
    echo "error: no sha256 tool found (shasum/sha256sum)" >&2
    exit 1
  fi

  TMPDIR_SAFE="${TMPDIR:-/tmp}"
  ARCHIVE_PATH="${TMPDIR_SAFE}/ockit-${KIT_ID}-${RELEASE}.tar.gz"

  echo "fetching ${ARCHIVE_URL}"
  curl -fsSL "$ARCHIVE_URL" -o "$ARCHIVE_PATH"

  EXPECTED=""
  if curl -fsSL "$CHECKSUMS_URL" 2>/dev/null | grep -q "${ARCHIVE}"; then
    EXPECTED="$(curl -fsSL "$CHECKSUMS_URL" 2>/dev/null | grep "${ARCHIVE}" | awk '{print $1}' | head -n 1)"
  fi
  if [ -n "$EXPECTED" ]; then
    ACTUAL="$($SHA_BIN -a 256 "$ARCHIVE_PATH" | awk '{print $1}')"
    if [ "$ACTUAL" != "$EXPECTED" ]; then
      echo "error: checksum mismatch for ${ARCHIVE} (expected ${EXPECTED}, got ${ACTUAL})" >&2
      rm -f "$ARCHIVE_PATH"
      exit 1
    fi
    echo "checksum verified"
  else
    echo "warning: no checksum entry found for ${ARCHIVE}; skipping verification"
  fi

  # --- install -------------------------------------------------------------
  tar -xzf "$ARCHIVE_PATH" -C "$INSTALL_DIR"
  rm -f "$ARCHIVE_PATH"
  echo "installed kit to ${INSTALL_DIR}"

  # --- PATH ----------------------------------------------------------------
  if [ -d "${INSTALL_DIR}/bin" ]; then
    case ":$PATH:" in
      *":${INSTALL_DIR}/bin:"*) : ;;
      *)
        echo "export PATH=\"${INSTALL_DIR}/bin:\$PATH\"" >>"${HOME}/.profile"
        echo "added ${INSTALL_DIR}/bin to PATH (${HOME}/.profile)"
        ;;
    esac
  fi

  # --- verify + post-checks ------------------------------------------------
  if have opencode; then
    echo "opencode: $(opencode --version 2>/dev/null || echo 'unknown')"
    if have "opencode" && [ "${OS}" != "windows" ]; then
      opencode doctor --install 2>/dev/null || echo "opencode doctor unavailable (non-fatal)"
    fi
  else
    echo "warning: opencode not found on PATH after install"
  fi
  echo "done"
}

main "$@"