[CmdletBinding()]
param(
  [ValidateSet("Test", "Release")]
  [string]$Mode = "Test",
  [string]$OutputDirectory = "dist/windows-native",
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$NativeSourceDirectory = Join-Path $RepositoryRoot "tmp/localapp-native"

function Assert-Condition([bool]$Condition, [string]$Message) {
  if (!$Condition) { throw $Message }
}

function Invoke-External([string]$FilePath, [string[]]$Arguments) {
  Push-Location -LiteralPath $RepositoryRoot
  try {
    & $FilePath @Arguments
    if ($LASTEXITCODE -ne 0) { throw "$FilePath failed with exit code $LASTEXITCODE" }
  } finally {
    Pop-Location
  }
}

function Get-ExternalText([string]$FilePath, [string[]]$Arguments) {
  return ((@(Invoke-External $FilePath $Arguments) | ForEach-Object { [string]$_ }) -join [Environment]::NewLine).Trim()
}

function Normalize-Path([string]$Path) {
  return [IO.Path]::GetFullPath($Path).TrimEnd([char[]]@('\', '/'))
}

function Test-PathIsWithin([string]$Path, [string]$Directory) {
  $candidate = Normalize-Path $Path
  $root = Normalize-Path $Directory
  return $candidate.Equals($root, [StringComparison]::OrdinalIgnoreCase) -or
    $candidate.StartsWith($root + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)
}

function Assert-SafeOutputDirectory([string]$Path) {
  $resolved = Normalize-Path $Path
  Assert-Condition (!(Test-PathIsWithin $resolved (Join-Path $RepositoryRoot "packages"))) "OutputDirectory must not be inside packages"
  Assert-Condition (!(Test-PathIsWithin $resolved (Join-Path $RepositoryRoot "scripts"))) "OutputDirectory must not be inside scripts"
  Assert-Condition (!$resolved.Equals((Normalize-Path $RepositoryRoot), [StringComparison]::OrdinalIgnoreCase)) "OutputDirectory must not be the repository root"
  if (Test-Path -LiteralPath $resolved) {
    $item = Get-Item -LiteralPath $resolved -Force
    Assert-Condition $item.PSIsContainer "OutputDirectory must be a directory"
    Assert-Condition (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) "OutputDirectory must not be a reparse point"
    Assert-Condition (@(Get-ChildItem -LiteralPath $resolved -Force).Count -eq 0) "OutputDirectory must be empty"
  }
  return $resolved
}

function Assert-WindowsX64 {
  Assert-Condition ($env:OS -eq "Windows_NT") "This native adapter build must run on Windows"
  $architecture = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
  Assert-Condition ($architecture -match "^(AMD64|x86_64)$") "Windows x64 is required; found $architecture"
}

function Assert-Toolchain {
  foreach ($command in @("git", "node", "pnpm", "cargo", "rustc")) {
    Assert-Condition ($null -ne (Get-Command $command -ErrorAction SilentlyContinue)) "$command must be available on PATH"
  }
  $nodeVersion = Get-ExternalText "node" @("--version")
  $pnpmVersion = Get-ExternalText "pnpm" @("--version")
  Assert-Condition ($nodeVersion -match '^v24\.\d+\.\d+$') "Node.js 24.x is required; found $nodeVersion"
  Assert-Condition ($pnpmVersion -match '^10\.\d+\.\d+$') "pnpm 10.x is required; found $pnpmVersion"
}

function Assert-NativeAdapterTree([string]$Directory) {
  $root = Normalize-Path $Directory
  $manifestPath = Join-Path $root "adapter-manifest.json"
  Assert-Condition (Test-Path -LiteralPath $manifestPath -PathType Leaf) "native adapter manifest is missing"
  $manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  Assert-Condition ($manifest.schemaVersion -eq 1 -and $manifest.target -eq "win32-x64") "native adapter manifest target must be win32-x64"
  Assert-Condition (@($manifest.assets).Count -eq 2) "native adapter manifest must declare exactly two files"

  $expected = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::Ordinal)
  [void]$expected.Add("adapter-manifest.json")
  foreach ($asset in @($manifest.assets)) {
    $relative = [string]$asset.path
    Assert-Condition ($relative -match '^win32-x64/(localapp-native\.exe|localapp-native-ipc-client\.mjs)$') "unexpected native adapter file: $relative"
    Assert-Condition ($expected.Add($relative)) "duplicate native adapter file: $relative"
    $filePath = Join-Path $root ($relative.Replace('/', [IO.Path]::DirectorySeparatorChar))
    Assert-Condition (Test-Path -LiteralPath $filePath -PathType Leaf) "native adapter file is missing: $relative"
    $actualHash = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant()
    Assert-Condition ($actualHash -eq ([string]$asset.sha256).ToLowerInvariant()) "native adapter digest mismatch: $relative"
  }
  foreach ($file in @(Get-ChildItem -LiteralPath $root -File -Recurse -Force)) {
    $relative = [IO.Path]::GetRelativePath($root, $file.FullName).Replace('\', '/')
    Assert-Condition $expected.Contains($relative) "unexpected native adapter file: $relative"
    Assert-Condition (($file.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) "native adapter file must not be a reparse point: $relative"
  }
}

function Copy-NativeAdapterArtifact([string]$SourceDirectory, [string]$DestinationDirectory) {
  Assert-NativeAdapterTree $SourceDirectory
  $destination = Assert-SafeOutputDirectory $DestinationDirectory
  if (!(Test-Path -LiteralPath $destination)) { New-Item -ItemType Directory -Path $destination | Out-Null }
  Copy-Item -LiteralPath (Join-Path $SourceDirectory "adapter-manifest.json") -Destination $destination
  Copy-Item -LiteralPath (Join-Path $SourceDirectory "win32-x64") -Destination $destination -Recurse
  Assert-NativeAdapterTree $destination
}

if ($env:LOCALAPP_BUILD_WINDOWS_RELEASE_DOT_SOURCE_ONLY -ne "1") {
  Assert-WindowsX64
  Assert-Toolchain
  if (!$SkipInstall) { Invoke-External "pnpm" @("install", "--frozen-lockfile") }
  Invoke-External "pnpm" @("-C", "packages/localapp", "build")
  Invoke-External "pnpm" @("-C", "packages/localapp", "build:native")
  $destination = if ([IO.Path]::IsPathRooted($OutputDirectory)) { $OutputDirectory } else { Join-Path $RepositoryRoot $OutputDirectory }
  Copy-NativeAdapterArtifact $NativeSourceDirectory $destination
  Write-Output (@{ success = $true; mode = $Mode; target = "win32-x64"; outputDirectory = (Normalize-Path $destination) } | ConvertTo-Json -Compress)
}
