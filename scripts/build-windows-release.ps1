[CmdletBinding()]
param(
  [ValidateSet("All", "Cli", "Desktop")]
  [string]$Target = "All",
  [ValidateSet("Test", "Release")]
  [string]$Mode = "Test",
  [string]$OutputDirectory = "dist/windows",
  [switch]$SkipInstall
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$RepositoryRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot "..")).Path
$DesktopDirectory = Join-Path $RepositoryRoot "packages/desktop"
$CliStaticDirectory = Join-Path $RepositoryRoot "packages/server/static/cli"
$CliCargoToml = Join-Path $RepositoryRoot "packages/cli/Cargo.toml"
$CliVersionsPath = Join-Path $CliStaticDirectory "versions.json"
$CliArtifactName = "localapp-cli-x86_64-pc-windows-msvc.exe"
$ReleaseEnvironmentVariables = @(
  "LOCALAPP_UPDATER_ENDPOINT",
  "LOCALAPP_UPDATER_PUBKEY",
  "TAURI_SIGNING_PRIVATE_KEY"
)
$script:LastExternalExitCode = 1
$script:NativeProcessorArchitecture = [Environment]::GetEnvironmentVariable(
  "PROCESSOR_ARCHITECTURE",
  [EnvironmentVariableTarget]::Machine
)
if ([string]::IsNullOrWhiteSpace($script:NativeProcessorArchitecture)) {
  $script:NativeProcessorArchitecture = $env:PROCESSOR_ARCHITEW6432
}
if ([string]::IsNullOrWhiteSpace($script:NativeProcessorArchitecture)) {
  $script:NativeProcessorArchitecture = $env:PROCESSOR_ARCHITECTURE
}

function Assert-Condition([bool]$Condition, [string]$Message) {
  if (!$Condition) { throw $Message }
}

function Invoke-External([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory = $RepositoryRoot) {
  $nativeErrorPreferenceVariable = Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue
  $restoreNativeErrorPreference = $null -ne $nativeErrorPreferenceVariable
  $originalNativeErrorPreference = $false
  if ($restoreNativeErrorPreference) {
    $originalNativeErrorPreference = [bool]$nativeErrorPreferenceVariable.Value
    Set-Variable -Name PSNativeCommandUseErrorActionPreference -Value $false -Scope Local
  }
  Push-Location -LiteralPath $WorkingDirectory
  try {
    & $FilePath @Arguments
    $exitCode = $LASTEXITCODE
    if ($exitCode -ne 0) {
      $script:LastExternalExitCode = $exitCode
      throw "$FilePath failed with exit code $exitCode"
    }
    $script:LastExternalExitCode = 0
  } finally {
    if ($restoreNativeErrorPreference) {
      Set-Variable -Name PSNativeCommandUseErrorActionPreference -Value $originalNativeErrorPreference -Scope Local
    }
    Pop-Location
  }
}

function Get-ExternalText([string]$FilePath, [string[]]$Arguments, [string]$WorkingDirectory = $RepositoryRoot) {
  return ((@(Invoke-External $FilePath $Arguments $WorkingDirectory) | ForEach-Object { [string]$_ }) -join [Environment]::NewLine).Trim()
}

function Normalize-Path([string]$Path) {
  $fullPath = [IO.Path]::GetFullPath($Path)
  $root = [IO.Path]::GetPathRoot($fullPath)
  Assert-Condition (![string]::IsNullOrWhiteSpace($root)) "Path must have a root: $Path"
  if ($fullPath.Equals($root, [StringComparison]::OrdinalIgnoreCase)) {
    return $root
  }
  return $fullPath.TrimEnd([char[]]@('\', '/'))
}

function Resolve-OutputPath([string]$Path) {
  if ([IO.Path]::IsPathRooted($Path)) {
    return Normalize-Path $Path
  }
  return Normalize-Path (Join-Path $RepositoryRoot $Path)
}

function Test-PathIsWithin([string]$Path, [string]$Directory) {
  $comparison = [StringComparison]::OrdinalIgnoreCase
  $normalizedPath = Normalize-Path $Path
  $normalizedDirectory = Normalize-Path $Directory
  if ($normalizedPath.Equals($normalizedDirectory, $comparison)) { return $true }
  $directoryWithSeparator = if (
    $normalizedDirectory.EndsWith([IO.Path]::DirectorySeparatorChar.ToString()) -or
    $normalizedDirectory.EndsWith([IO.Path]::AltDirectorySeparatorChar.ToString())
  ) {
    $normalizedDirectory
  } else {
    $normalizedDirectory + [IO.Path]::DirectorySeparatorChar
  }
  return $normalizedPath.StartsWith($directoryWithSeparator, $comparison)
}

function Assert-ItemIsNotReparsePoint([IO.FileSystemInfo]$Item, [string]$Description) {
  Assert-Condition (($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) -eq 0) "$Description must not be a reparse point: $($Item.FullName)"
}

function Assert-NoReparsePoints([string]$Path) {
  $directory = New-Object IO.DirectoryInfo (Normalize-Path $Path)
  while ($null -ne $directory) {
    if (Test-Path -LiteralPath $directory.FullName) {
      $item = Get-Item -LiteralPath $directory.FullName -Force
      Assert-ItemIsNotReparsePoint $item "OutputDirectory path"
    }
    $directory = $directory.Parent
  }
}

function Assert-OutputPath([string]$Path) {
  $normalizedPath = Normalize-Path $Path
  Assert-Condition (!$normalizedPath.Equals((Normalize-Path $RepositoryRoot), [StringComparison]::OrdinalIgnoreCase)) "OutputDirectory must not be the repository root: $normalizedPath"
  $sourceDirectories = @(
    (Join-Path $RepositoryRoot "packages"),
    (Join-Path $RepositoryRoot "scripts"),
    (Join-Path $RepositoryRoot "init-repo")
  )
  foreach ($directory in $sourceDirectories) {
    if (Test-PathIsWithin $normalizedPath $directory) {
      throw "OutputDirectory must not be the repository root or a source directory: $normalizedPath"
    }
  }
  Assert-NoReparsePoints $normalizedPath
}

function Assert-OutputDirectoryEmpty([string]$Path) {
  Assert-OutputPath $Path
  if (!(Test-Path -LiteralPath $Path)) { return }
  $item = Get-Item -LiteralPath $Path -Force
  Assert-Condition $item.PSIsContainer "OutputDirectory must be a directory: $Path"
  Assert-ItemIsNotReparsePoint $item "OutputDirectory"
  $existingItems = @(Get-ChildItem -LiteralPath $Path -Force)
  Assert-Condition ($existingItems.Count -eq 0) "OutputDirectory must be empty; refusing to mix this build with existing files: $Path"
}

function Initialize-OutputDirectory([string]$Path) {
  $destinationRoot = Resolve-OutputPath $Path
  Assert-OutputDirectoryEmpty $destinationRoot
  if (!(Test-Path -LiteralPath $destinationRoot)) {
    New-Item -ItemType Directory -Path $destinationRoot | Out-Null
  }
  Assert-OutputDirectoryEmpty $destinationRoot
  return (Get-Item -LiteralPath $destinationRoot).FullName
}

function Assert-ArtifactDirectorySafe(
  [string]$DestinationRoot,
  [ValidateSet("cli", "desktop")]
  [string]$DirectoryName,
  [switch]$BeforeCopy,
  [switch]$AfterCopy
) {
  Assert-Condition ($BeforeCopy -xor $AfterCopy) "Artifact directory safety phase is required"
  Assert-NoReparsePoints $DestinationRoot
  $artifactDirectory = Join-Path $DestinationRoot $DirectoryName
  if (Test-Path -LiteralPath $artifactDirectory) {
    $item = Get-Item -LiteralPath $artifactDirectory -Force
    Assert-Condition $item.PSIsContainer "Artifact directory must be a directory: $artifactDirectory"
    Assert-ItemIsNotReparsePoint $item "Artifact directory"
  }
  return $artifactDirectory
}

function Assert-DeclaredArtifactDirectoryContents(
  [string]$DestinationRoot,
  [ValidateSet("cli", "desktop")]
  [string]$DirectoryName,
  [System.Collections.Generic.List[IO.FileInfo]]$Artifacts
) {
  $artifactDirectory = Join-Path $DestinationRoot $DirectoryName
  if (!(Test-Path -LiteralPath $artifactDirectory)) { return }
  $declaredFiles = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  foreach ($artifact in $Artifacts) {
    if ((Split-Path -Leaf (Split-Path -Parent $artifact.FullName)) -eq $DirectoryName) {
      [void]$declaredFiles.Add((Normalize-Path $artifact.FullName))
    }
  }
  foreach ($item in @(Get-ChildItem -LiteralPath $artifactDirectory -Force)) {
    Assert-Condition (!$item.PSIsContainer) "Artifact directory contains an undeclared subdirectory: $($item.FullName)"
    Assert-ItemIsNotReparsePoint $item "Artifact directory entry"
    Assert-Condition $declaredFiles.Contains((Normalize-Path $item.FullName)) "Artifact directory contains an undeclared file: $($item.FullName)"
  }
}

function Assert-WindowsX64(
  [string]$OperatingSystem = $env:OS,
  [string]$ProcessArchitecture = $env:PROCESSOR_ARCHITECTURE,
  [string]$NativeArchitecture = $script:NativeProcessorArchitecture
) {
  Assert-Condition ($OperatingSystem -eq "Windows_NT") "This build script must run on Windows"
  Assert-Condition ($ProcessArchitecture -match "^(AMD64|x86_64)$") "A 64-bit AMD64/x86_64 PowerShell process is required; found $ProcessArchitecture"
  Assert-Condition ($NativeArchitecture -match "^(AMD64|x86_64)$") "Windows AMD64/x86_64 is required; found $NativeArchitecture"
}

function Assert-RequiredCommand([string]$Name) {
  Assert-Condition ($null -ne (Get-Command $Name -ErrorAction SilentlyContinue)) "$Name must be available on PATH"
}

function Assert-Toolchain {
  foreach ($command in @("git", "node", "pnpm", "cargo", "rustc")) {
    Assert-RequiredCommand $command
  }

  $nodeVersion = Get-ExternalText "node" @("--version")
  $pnpmVersion = Get-ExternalText "pnpm" @("--version")
  $rustcVersion = Get-ExternalText "rustc" @("--version")
  Assert-Condition ($nodeVersion -match '^v24\.\d+\.\d+$') "Node.js 24.x is required; found $nodeVersion"
  Assert-Condition ($pnpmVersion -match '^10\.\d+\.\d+$') "pnpm 10.x is required; found $pnpmVersion"
  Assert-Condition ($rustcVersion -match '^rustc\s+\d+\.\d+\.\d+') "rustc version output is invalid: $rustcVersion"
  return [ordered]@{
    node = $nodeVersion
    pnpm = $pnpmVersion
    rustc = $rustcVersion
  }
}

function Assert-ReleaseEnvironment(
  [string]$BuildMode = $Mode,
  [System.Collections.IDictionary]$Environment = $null
) {
  if ($BuildMode -ne "Release") { return }

  $missing = @(
    foreach ($name in $ReleaseEnvironmentVariables) {
      $value = if ($null -eq $Environment) { [Environment]::GetEnvironmentVariable($name) } else { $Environment[$name] }
      if ([string]::IsNullOrWhiteSpace([string]$value)) { $name }
    }
  )
  if ($missing.Count -gt 0) {
    throw "Release mode requires environment variables: $($missing -join ', ')"
  }
}

function Get-EnvironmentValue([System.Collections.IDictionary]$Environment, [string]$Name) {
  if ($null -eq $Environment) {
    return ([string][Environment]::GetEnvironmentVariable($Name)).Trim()
  }
  return ([string]$Environment[$Name]).Trim()
}

function ConvertTo-HttpsUrl([string]$Value, [string]$EnvironmentVariableName) {
  try {
    $uri = New-Object Uri($Value, [UriKind]::Absolute)
  } catch {
    throw "$EnvironmentVariableName must be a valid HTTPS URL"
  }
  Assert-Condition ($uri.Scheme -eq "https") "$EnvironmentVariableName must use HTTPS"
  Assert-Condition ([string]::IsNullOrEmpty($uri.UserInfo)) "$EnvironmentVariableName must not include credentials"
  return $uri.AbsoluteUri
}

function Get-WindowsSigningMetadata([System.Collections.IDictionary]$Environment = $null) {
  $certificateThumbprint = Get-EnvironmentValue $Environment "LOCALAPP_WINDOWS_CERTIFICATE_THUMBPRINT"
  $timestamp = Get-EnvironmentValue $Environment "LOCALAPP_WINDOWS_TIMESTAMP_URL"
  $windows = [ordered]@{}

  if (![string]::IsNullOrWhiteSpace($certificateThumbprint)) {
    Assert-Condition ($certificateThumbprint -match "^[a-fA-F0-9]{40}$") "LOCALAPP_WINDOWS_CERTIFICATE_THUMBPRINT must be a 40-character SHA-1 certificate thumbprint"
    $windows.certificateThumbprint = $certificateThumbprint.ToUpperInvariant()
    $windows.digestAlgorithm = "sha256"
  }

  if (![string]::IsNullOrWhiteSpace($timestamp)) {
    Assert-Condition (![string]::IsNullOrWhiteSpace($certificateThumbprint)) "LOCALAPP_WINDOWS_TIMESTAMP_URL requires LOCALAPP_WINDOWS_CERTIFICATE_THUMBPRINT"
    $windows.timestampUrl = ConvertTo-HttpsUrl $timestamp "LOCALAPP_WINDOWS_TIMESTAMP_URL"
  }
  return ,$windows
}

function Write-Utf8NoBom([string]$Path, [string]$Content) {
  $encoding = New-Object System.Text.UTF8Encoding($false)
  [IO.File]::WriteAllText($Path, $Content, $encoding)
}

function New-TestTauriConfig([string]$ConfigPath, [System.Collections.IDictionary]$Environment = $null) {
  $windows = Get-WindowsSigningMetadata $Environment
  $config = [ordered]@{
    bundle = [ordered]@{
      createUpdaterArtifacts = $false
      windows = $windows
    }
    plugins = [ordered]@{
      updater = [ordered]@{
        endpoints = @()
        pubkey = "development-only"
        windows = [ordered]@{ installMode = "passive" }
      }
    }
  }
  Write-Utf8NoBom $ConfigPath (($config | ConvertTo-Json -Depth 6) + [Environment]::NewLine)
}

function Get-JsonPropertyValue([object]$Object, [string]$Name, [string]$Description) {
  $property = $Object.PSObject.Properties[$Name]
  Assert-Condition ($null -ne $property) "$Description is missing $Name"
  return $property.Value
}

function Get-CliArtifact(
  [string]$CargoTomlPath = $CliCargoToml,
  [string]$VersionsPath = $CliVersionsPath,
  [string]$CliDirectory = $CliStaticDirectory
) {
  Assert-Condition (Test-Path -LiteralPath $CargoTomlPath -PathType Leaf) "CLI Cargo.toml was not found: $CargoTomlPath"
  Assert-Condition (Test-Path -LiteralPath $VersionsPath -PathType Leaf) "CLI versions.json was not found after pnpm build:cli: $VersionsPath"
  $cargoToml = Get-Content -LiteralPath $CargoTomlPath -Raw
  $versionMatch = [regex]::Match($cargoToml, '(?m)^\s*version\s*=\s*"([^"]+)"')
  Assert-Condition $versionMatch.Success "Unable to read CLI version from $CargoTomlPath"
  $version = $versionMatch.Groups[1].Value
  $versions = Get-Content -LiteralPath $VersionsPath -Raw | ConvertFrom-Json
  $allVersions = Get-JsonPropertyValue $versions "versions" "CLI versions.json"
  $versionEntry = Get-JsonPropertyValue $allVersions $version "CLI versions.json"
  $platforms = Get-JsonPropertyValue $versionEntry "platforms" "CLI version $version"
  $mappedFileName = [string](Get-JsonPropertyValue $platforms "windows/x86_64" "CLI version $version platforms")
  Assert-Condition ($mappedFileName -eq $CliArtifactName) "CLI versions.json must map windows/x86_64 to the canonical CLI filename $CliArtifactName; found $mappedFileName"
  $artifactPath = Join-Path (Join-Path $CliDirectory $version) $CliArtifactName
  Assert-Condition (Test-Path -LiteralPath $artifactPath -PathType Leaf) "CLI artifact was not created by pnpm build:cli: $artifactPath"
  return Get-Item -LiteralPath $artifactPath
}

function Get-FileSnapshot([string]$Directory) {
  $snapshot = @{}
  if (Test-Path -LiteralPath $Directory -PathType Container) {
    foreach ($file in @(Get-ChildItem -LiteralPath $Directory -File -Recurse)) {
      [void]($snapshot[$file.FullName] = [pscustomobject]@{
        Length = $file.Length
        LastWriteTimeUtc = $file.LastWriteTimeUtc
        Sha256 = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
      })
    }
  }
  return ,$snapshot
}

function Get-ChangedFiles([System.Collections.IDictionary]$Before, [string]$Directory) {
  $after = Get-FileSnapshot $Directory
  $changed = @()
  foreach ($path in $after.Keys) {
    $previous = $Before[$path]
    if (
      $null -eq $previous -or
      $previous.Sha256 -ne $after[$path].Sha256 -or
      $previous.Length -ne $after[$path].Length -or
      $previous.LastWriteTimeUtc -ne $after[$path].LastWriteTimeUtc
    ) {
      $changed += Get-Item -LiteralPath $path
    }
  }
  return $changed
}

function Get-FreshNsisInstaller([System.Collections.IDictionary]$Before, [string]$BundleDirectory) {
  Assert-Condition (Test-Path -LiteralPath $BundleDirectory -PathType Container) "NSIS bundle directory was not created: $BundleDirectory"
  $installers = @(Get-ChangedFiles $Before $BundleDirectory | Where-Object { $_.Extension -eq ".exe" })
  Assert-Condition ($installers.Count -eq 1) "Expected exactly one new or changed NSIS installer, found $($installers.Count)"
  return $installers[0]
}

function Get-FreshSignature([IO.FileInfo]$Installer, [System.Collections.IDictionary]$Before, [string]$BundleDirectory) {
  $signaturePath = "$($Installer.FullName).sig"
  $signatures = @(Get-ChangedFiles $Before $BundleDirectory | Where-Object { $_.FullName -eq $signaturePath })
  Assert-Condition ($signatures.Count -eq 1) "Release mode requires a current updater signature beside the NSIS installer"
  return $signatures[0]
}

function Copy-Artifact(
  [IO.FileInfo]$Source,
  [string]$DestinationRoot,
  [ValidateSet("cli", "desktop")]
  [string]$DirectoryName,
  [string]$DestinationFileName,
  [System.Collections.Generic.List[IO.FileInfo]]$Artifacts
) {
  Assert-Condition (!$Source.Attributes.HasFlag([IO.FileAttributes]::ReparsePoint)) "Artifact source must not be a reparse point: $($Source.FullName)"
  $destinationDirectory = Assert-ArtifactDirectorySafe $DestinationRoot $DirectoryName -BeforeCopy
  if (!(Test-Path -LiteralPath $destinationDirectory)) {
    New-Item -ItemType Directory -Path $destinationDirectory | Out-Null
  }
  [void](Assert-ArtifactDirectorySafe $DestinationRoot $DirectoryName -AfterCopy)
  Assert-DeclaredArtifactDirectoryContents $DestinationRoot $DirectoryName $Artifacts
  $destination = Join-Path $destinationDirectory $DestinationFileName
  Assert-Condition (!(Test-Path -LiteralPath $destination)) "Artifact destination already exists: $destination"
  [void](Assert-ArtifactDirectorySafe $DestinationRoot $DirectoryName -BeforeCopy)
  Assert-DeclaredArtifactDirectoryContents $DestinationRoot $DirectoryName $Artifacts
  Copy-Item -LiteralPath $Source.FullName -Destination $destination -ErrorAction Stop
  [void](Assert-ArtifactDirectorySafe $DestinationRoot $DirectoryName -AfterCopy)
  $copiedArtifact = Get-Item -LiteralPath $destination -Force
  Assert-Condition (!$copiedArtifact.PSIsContainer) "Artifact destination must be a file: $destination"
  Assert-ItemIsNotReparsePoint $copiedArtifact "Artifact destination"
  $Artifacts.Add($copiedArtifact)
  Assert-DeclaredArtifactDirectoryContents $DestinationRoot $DirectoryName $Artifacts
}

function Get-ArtifactRelativePath([string]$DestinationRoot, [string]$ArtifactPath) {
  Assert-Condition (Test-PathIsWithin $ArtifactPath $DestinationRoot) "Artifact is outside OutputDirectory: $ArtifactPath"
  return $ArtifactPath.Substring($DestinationRoot.Length).TrimStart([char[]]@('\', '/')).Replace("\", "/")
}

function Assert-OutputContainsOnly(
  [string]$DestinationRoot,
  [System.Collections.Generic.List[IO.FileInfo]]$Artifacts,
  [switch]$IncludeMetadata
) {
  Assert-NoReparsePoints $DestinationRoot
  $expectedFiles = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  $expectedDirectories = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  foreach ($artifact in $Artifacts) {
    [void]$expectedFiles.Add((Normalize-Path $artifact.FullName))
    [void]$expectedDirectories.Add((Split-Path -Leaf (Split-Path -Parent $artifact.FullName)))
  }
  if ($IncludeMetadata) {
    [void]$expectedFiles.Add((Join-Path $DestinationRoot "manifest.json"))
    [void]$expectedFiles.Add((Join-Path $DestinationRoot "SHA256SUMS.txt"))
  }

  $actualFiles = New-Object 'System.Collections.Generic.HashSet[string]' ([StringComparer]::OrdinalIgnoreCase)
  foreach ($item in @(Get-ChildItem -LiteralPath $DestinationRoot -Force)) {
    Assert-ItemIsNotReparsePoint $item "OutputDirectory entry"
    if (!$item.PSIsContainer) {
      Assert-Condition $expectedFiles.Contains((Normalize-Path $item.FullName)) "OutputDirectory contains an unexpected file: $($item.FullName)"
      [void]$actualFiles.Add((Normalize-Path $item.FullName))
      continue
    }
    Assert-Condition $expectedDirectories.Contains($item.Name) "OutputDirectory contains an unexpected directory: $($item.FullName)"
    [void](Assert-ArtifactDirectorySafe $DestinationRoot $item.Name -AfterCopy)
    foreach ($child in @(Get-ChildItem -LiteralPath $item.FullName -Force)) {
      Assert-Condition (!$child.PSIsContainer) "Artifact directory contains an unexpected subdirectory: $($child.FullName)"
      Assert-ItemIsNotReparsePoint $child "Artifact directory entry"
      Assert-Condition $expectedFiles.Contains((Normalize-Path $child.FullName)) "OutputDirectory contains an unexpected file: $($child.FullName)"
      [void]$actualFiles.Add((Normalize-Path $child.FullName))
    }
  }
  Assert-Condition ($actualFiles.Count -eq $expectedFiles.Count) "OutputDirectory is missing or contains files outside the declared artifact set"
}

function Write-ArtifactMetadata(
  [string]$DestinationRoot,
  [System.Collections.Generic.List[IO.FileInfo]]$Artifacts,
  [System.Collections.IDictionary]$BuildMetadata
) {
  Assert-OutputContainsOnly $DestinationRoot $Artifacts
  $records = @(
    foreach ($artifact in @($Artifacts | Sort-Object -Property FullName)) {
      $hash = Get-FileHash -LiteralPath $artifact.FullName -Algorithm SHA256
      [ordered]@{
        path = Get-ArtifactRelativePath $DestinationRoot $artifact.FullName
        bytes = $artifact.Length
        sha256 = $hash.Hash.ToLowerInvariant()
      }
    }
  )
  $manifest = [ordered]@{
    gitCommit = $BuildMetadata.gitCommit
    toolchain = $BuildMetadata.toolchain
    target = $BuildMetadata.target
    mode = $BuildMetadata.mode
    generatedAt = [DateTimeOffset]::UtcNow.ToString("O")
    updaterSignature = @($Artifacts | Where-Object { $_.Name.EndsWith(".sig", [StringComparison]::OrdinalIgnoreCase) }).Count -gt 0
    artifacts = $records
  }
  Write-Utf8NoBom (Join-Path $DestinationRoot "manifest.json") (($manifest | ConvertTo-Json -Depth 6) + [Environment]::NewLine)
  $checksums = @($records | ForEach-Object { "$($_.sha256) *$($_.path)" })
  Write-Utf8NoBom (Join-Path $DestinationRoot "SHA256SUMS.txt") (($checksums -join [Environment]::NewLine) + [Environment]::NewLine)
  Assert-OutputContainsOnly $DestinationRoot $Artifacts -IncludeMetadata
}

function Get-BuildMetadata([System.Collections.IDictionary]$Toolchain) {
  $gitCommit = Get-ExternalText "git" @("rev-parse", "HEAD")
  Assert-Condition ($gitCommit -match "^[0-9a-fA-F]{40}$") "Unable to determine the current Git commit"
  return [ordered]@{
    gitCommit = $gitCommit.ToLowerInvariant()
    toolchain = $Toolchain
    target = $Target
    mode = $Mode
  }
}

function New-TemporaryTauriConfig([string]$BuildMode) {
  return Join-Path ([IO.Path]::GetTempPath()) ("localapp-tauri-{0}-{1}-{2}.json" -f $BuildMode.ToLowerInvariant(), $PID, [Guid]::NewGuid().ToString("N"))
}

function Invoke-BuildWindowsRelease {
  Assert-WindowsX64
  $toolchain = Assert-Toolchain
  Assert-ReleaseEnvironment

  $destinationRoot = Initialize-OutputDirectory $OutputDirectory
  if ($Target -in @("All", "Cli")) {
    [void](Assert-ArtifactDirectorySafe $destinationRoot "cli" -BeforeCopy)
  }
  if ($Target -in @("All", "Desktop")) {
    [void](Assert-ArtifactDirectorySafe $destinationRoot "desktop" -BeforeCopy)
  }

  if (!$SkipInstall) {
    Invoke-External "pnpm" @("install", "--frozen-lockfile")
  }

  $artifacts = [System.Collections.Generic.List[IO.FileInfo]]::new()

  if ($Target -in @("All", "Cli")) {
    Invoke-External "pnpm" @("build:cli")
    Copy-Artifact (Get-CliArtifact) $destinationRoot "cli" $CliArtifactName $artifacts
  }

  if ($Target -in @("All", "Desktop")) {
    Invoke-External "pnpm" @("--filter", "@localapp/desktop", "runtime:prepare", "--target", "win-x64")
    $tauriArguments = @("--filter", "@localapp/desktop", "tauri", "build", "--bundles", "nsis", "--target", "x86_64-pc-windows-msvc")
    $tauriConfig = New-TemporaryTauriConfig $Mode
    if ($Mode -eq "Release") {
      Invoke-External "node" @("packages/desktop/scripts/windows-release-config.mjs", "--output", $tauriConfig)
    } else {
      New-TestTauriConfig $tauriConfig
    }
    $tauriArguments += @("--config", $tauriConfig)
    $bundleDirectory = Join-Path $DesktopDirectory "src-tauri/target/x86_64-pc-windows-msvc/release/bundle/nsis"
    $beforeBuild = Get-FileSnapshot $bundleDirectory
    try {
      Invoke-External "pnpm" $tauriArguments
    } finally {
      if (Test-Path -LiteralPath $tauriConfig) {
        Remove-Item -LiteralPath $tauriConfig -Force
      }
    }
    $installer = Get-FreshNsisInstaller $beforeBuild $bundleDirectory
    Copy-Artifact $installer $destinationRoot "desktop" $installer.Name $artifacts

    if ($Mode -eq "Release") {
      $signature = Get-FreshSignature $installer $beforeBuild $bundleDirectory
      Copy-Artifact $signature $destinationRoot "desktop" $signature.Name $artifacts
    }
  }

  Write-ArtifactMetadata $destinationRoot $artifacts (Get-BuildMetadata $toolchain)
  Write-Host "Windows $Mode artifacts written to $destinationRoot"
}

function Invoke-ReleaseTopLevel([scriptblock]$Operation = { Invoke-BuildWindowsRelease }) {
  try {
    & $Operation
  } catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    if ($script:LastExternalExitCode -ne 0) {
      exit $script:LastExternalExitCode
    }
    exit 1
  }
}

if ($MyInvocation.InvocationName -ne ".") {
  Invoke-ReleaseTopLevel
}
