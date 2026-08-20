# OC Kit single-command installer (Windows PowerShell).
#
# Pipeline (plan §34-35): detect OS/arch -> fetch release metadata from the
# GitHub Releases registry -> verify sha256 -> install the archive -> update
# PATH -> verify the executable -> surface post-install checks.
#
# The release registry is 'opencode-ai/kits' by default; override with
# OCKIT_REGISTRY_OWNER / OCKIT_REGISTRY_REPO.
#
# NOTE: CI validates the syntax of this script only; no live network install
# ever runs in CI.

[CmdletBinding()]
param(
  [string]$KitId = "engineer",
  [string]$Version = "",
  [string]$InstallDir = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Owner = if ($env:OCKIT_REGISTRY_OWNER) { $env:OCKIT_REGISTRY_OWNER } else { "opencode-ai" }
$Repo = if ($env:OCKIT_REGISTRY_REPO) { $env:OCKIT_REGISTRY_REPO } else { "kits" }
if ($env:OCKIT_KIT_VERSION) { $Version = $env:OCKIT_KIT_VERSION }

$ApiUrl = "https://api.github.com/repos/$Owner/$Repo/releases"
$RawUrl = "https://raw.githubusercontent.com/$Owner/$Repo"

function Get-Os {
  if ($IsLinux -or $IsMacOS) {
    if ($IsMacOS) { return "darwin" }
    return "linux"
  }
  return "windows"
}

function Get-Arch {
  switch ($env:PROCESSOR_ARCHITECTURE) {
    "AMD64" { return "amd64" }
    "ARM64" { return "arm64" }
    "x86" { return "386" }
    default {
      $unameArch = (& uname -m 2>$null)
      if ($unameArch -match "aarch64|arm64") { return "arm64" }
      if ($unameArch -match "x86_64|amd64") { return "amd64" }
      return "unknown"
    }
  }
}

function Resolve-Release {
  if ($Version -ne "") { return $Version }
  $headers = @{ "User-Agent" = "ockit-installer" }
  $releases = Invoke-RestMethod -Uri $ApiUrl -Headers $headers
  if ($releases.Count -eq 0) { throw "No releases found for $Owner/$Repo" }
  return $releases[0].tag_name
}

function Get-JsonField {
  param([string]$Json, [string]$Key)
  $parsed = $Json | ConvertFrom-Json
  return $parsed.$Key
}

function Main {
  $os = Get-Os
  $arch = Get-Arch
  if ($arch -eq "unknown") { throw "Unsupported architecture" }
  Write-Host "OC Kit installer - os=$os arch=$arch kit=$KitId"

  $release = Resolve-Release
  Write-Host "release: $release"

  if ($InstallDir -eq "") {
    $InstallDir = Join-Path $HOME ".opencode-kits\$KitId"
  }
  New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null

  $archive = "kit-$os-$arch.tar.gz"
  $archiveUrl = "$RawUrl/$release/$archive"
  $checksumsUrl = "$RawUrl/$release/checksums.txt"

  $tmpPath = Join-Path $env:TEMP "ockit-$KitId-$release.tar.gz"
  $checksumsPath = Join-Path $env:TEMP "ockit-$KitId-$release-checksums.txt"

  Write-Host "fetching $archiveUrl"
  Invoke-WebRequest -Uri $archiveUrl -OutFile $tmpPath

  # --- verify --------------------------------------------------------------
  $expected = ""
  try {
    Invoke-WebRequest -Uri $checksumsUrl -OutFile $checksumsPath
    $lines = Get-Content $checksumsPath | Where-Object { $_ -match $archive }
    if ($lines) { $expected = ($lines[0] -split "\s+")[0].Trim() }
  } catch {
    Write-Host "warning: no checksum entry found for $archive; skipping verification"
  }
  if ($expected -ne "") {
    $actual = (Get-FileHash -Algorithm SHA256 $tmpPath).Hash.ToLower()
    if ($actual -ne $expected.ToLower()) {
      Remove-Item $tmpPath -ErrorAction SilentlyContinue
      throw "Checksum mismatch for $archive (expected $expected, got $actual)"
    }
    Write-Host "checksum verified"
  }

  # --- install -------------------------------------------------------------
  Expand-Archive -Path $tmpPath -DestinationPath $InstallDir -Force
  Remove-Item $tmpPath -ErrorAction SilentlyContinue
  Write-Host "installed kit to $InstallDir"

  # --- PATH ----------------------------------------------------------------
  if (Test-Path (Join-Path $InstallDir "bin")) {
    $binDir = Join-Path $InstallDir "bin"
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($userPath -notmatch [regex]::Escape($binDir)) {
      [Environment]::SetEnvironmentVariable("Path", "$userPath;$binDir", "User")
      Write-Host "added $binDir to user PATH"
    }
  }

  # --- verify + post-checks ------------------------------------------------
  $opencode = Get-Command opencode -ErrorAction SilentlyContinue
  if ($opencode) {
    Write-Host "opencode: $(& opencode --version)"
    & opencode doctor --install 2>$null
  } else {
    Write-Host "warning: opencode not found on PATH after install"
  }
  Write-Host "done"
}

Main