# OpenCode + OC Kit single-command installer (Windows PowerShell).
#
# Usage:
#   irm https://raw.githubusercontent.com/vibecoder880/opencode/main/scripts/install.ps1 | iex
#
# This installs OpenCode with OC Kit support built-in.
# After installation, run `opencode` to start.

[CmdletBinding()]
param(
    [string]$Version = "",
    [string]$InstallDir = ""
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# --- Configuration -----------------------------------------------------------
$GitHubRepo = "vibecoder880/opencode"
$ApiUrl = "https://api.github.com/repos/$GitHubRepo/releases"

# --- Colors ------------------------------------------------------------------
function Write-Info { param([string]$Message) Write-Host "[INFO] $Message" -ForegroundColor Green }
function Write-Warn { param([string]$Message) Write-Host "[WARN] $Message" -ForegroundColor Yellow }
function Write-Error { param([string]$Message) Write-Host "[ERROR] $Message" -ForegroundColor Red; exit 1 }

# --- Detect OS/Arch ---------------------------------------------------------
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
        "x86"   { return "386" }
        default { return "unknown" }
    }
}

# --- Resolve release --------------------------------------------------------
function Resolve-Release {
    if ($Version -ne "") { return $Version }
    
    try {
        $releases = Invoke-RestMethod -Uri $ApiUrl -UseBasicParsing
        return $releases[0].tag_name
    } catch {
        Write-Error "Could not resolve latest release"
    }
}

# --- Main --------------------------------------------------------------------
function Main {
    $os = Get-Os
    $arch = Get-Arch
    
    if ($arch -eq "unknown") {
        Write-Error "unsupported architecture: $arch"
    }
    
    Write-Info "OpenCode + OC Kit installer"
    Write-Info "os=$os arch=$arch"
    
    # Resolve version
    $release = Resolve-Release
    if (-not $release) {
        Write-Error "could not resolve latest release"
    }
    Write-Info "version: $release"
    
    # Determine install directory
    if (-not $InstallDir) {
        $InstallDir = Join-Path $env:USERPROFILE ".opencode\bin"
    }
    New-Item -ItemType Directory -Force -Path $InstallDir | Out-Null
    
    # Download archive
    $archive = "opencode-$os-$arch.zip"
    $downloadUrl = "https://github.com/$GitHubRepo/releases/download/$release/$archive"
    
    Write-Info "downloading $downloadUrl"
    
    $archivePath = Join-Path $env:TEMP "opencode-$release.zip"
    
    try {
        Invoke-WebRequest -Uri $downloadUrl -OutFile $archivePath -UseBasicParsing
    } catch {
        Write-Error "failed to download archive"
    }
    
    # Extract
    Write-Info "extracting to $InstallDir"
    try {
        Expand-Archive -Path $archivePath -DestinationPath $InstallDir -Force
    } catch {
        Remove-Item -Path $archivePath -Force -ErrorAction SilentlyContinue
        Write-Error "failed to extract archive"
    }
    Remove-Item -Path $archivePath -Force -ErrorAction SilentlyContinue
    
    # Add to PATH if needed
    $currentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ($currentPath -notlike "*$InstallDir*") {
        [Environment]::SetEnvironmentVariable("Path", "$InstallDir;$currentPath", "User")
        Write-Info "added $InstallDir to PATH"
        Write-Warn "restart your terminal for PATH changes to take effect"
    } else {
        Write-Info "$InstallDir already in PATH"
    }
    
    # Verify installation
    Write-Info "verifying installation..."
    
    $opencodePath = Join-Path $InstallDir "opencode.exe"
    if (Test-Path $opencodePath) {
        Write-Info "OpenCode installed successfully!"
        & $opencodePath --version 2>$null
    } else {
        Write-Warn "opencode.exe not found in $InstallDir"
    }
    
    Write-Host ""
    Write-Info "Installation complete!"
    Write-Host ""
    Write-Host "  Run 'opencode' to start OpenCode with OC Kit support"
    Write-Host ""
    Write-Host "  Quick commands:"
    Write-Host "    opencode                    # Start OpenCode"
    Write-Host "    opencode kit list           # List installed kits"
    Write-Host "    opencode kit install <id>   # Install a kit"
    Write-Host "    opencode kit doctor         # Check kit health"
    Write-Host ""
}

Main
