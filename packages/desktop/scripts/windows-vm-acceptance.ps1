param(
  [Parameter(Mandatory = $true)]
  [string]$Installer,
  [Parameter(Mandatory = $true)]
  [string]$ExpectedSha256,
  [string]$PreviousInstaller,
  [string]$PreviousSha256,
  [string]$ReportPath = "$PWD\localapp-windows-acceptance.json",
  [switch]$RequireDisconnected,
  [switch]$RequireWebView2Absent,
  [switch]$InteractiveChecks,
  [switch]$UninstallAfter
)

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Assert-Condition([bool]$Condition, [string]$Message) {
  if (!$Condition) { throw $Message }
}

function Resolve-VerifiedInstaller([string]$Path, [string]$Sha256, [string]$Label) {
  $resolved = (Resolve-Path -LiteralPath $Path).Path
  Assert-Condition ($resolved.EndsWith(".exe", [StringComparison]::OrdinalIgnoreCase)) "$Label must be an .exe installer"
  if (![string]::IsNullOrWhiteSpace($Sha256)) {
    Assert-Condition ($Sha256 -match '^[a-fA-F0-9]{64}$') "$Label SHA-256 must contain 64 hexadecimal characters"
    $actual = (Get-FileHash -LiteralPath $resolved -Algorithm SHA256).Hash
    Assert-Condition ($actual -eq $Sha256.ToUpperInvariant()) "$Label SHA-256 does not match"
  }
  return $resolved
}

function Install-LocalApp([string]$Path) {
  $process = Start-Process -FilePath $Path -ArgumentList "/S" -PassThru -Wait
  Assert-Condition ($process.ExitCode -eq 0) "NSIS installer failed with exit code $($process.ExitCode)"
}

function Get-PropertyValue($Object, [string]$Name) {
  $property = $Object.PSObject.Properties[$Name]
  if ($null -eq $property) { return "" }
  return [string]$property.Value
}

function Get-WebView2RuntimeVersion {
  $clientId = "{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}"
  $locations = @(
    "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$clientId",
    "HKCU:\Software\Microsoft\EdgeUpdate\Clients\$clientId"
  )
  foreach ($location in $locations) {
    $entry = Get-ItemProperty -LiteralPath $location -ErrorAction SilentlyContinue
    if ($null -eq $entry) { continue }
    $version = Get-PropertyValue $entry "pv"
    if (![string]::IsNullOrWhiteSpace($version) -and $version -ne "0.0.0.0") {
      return $version
    }
  }
  return $null
}

function Find-LocalAppInstall {
  $uninstallRoot = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall"
  $entry = Get-ChildItem $uninstallRoot -ErrorAction SilentlyContinue |
    ForEach-Object { Get-ItemProperty $_.PSPath } |
    Where-Object { (Get-PropertyValue $_ "DisplayName") -eq "LocalApp" } |
    Select-Object -First 1
  Assert-Condition ($null -ne $entry) "LocalApp current-user uninstall entry was not found"
  $location = Get-PropertyValue $entry "InstallLocation"
  if ([string]::IsNullOrWhiteSpace($location)) {
    $uninstaller = Get-PropertyValue $entry "UninstallString"
    Assert-Condition (![string]::IsNullOrWhiteSpace($uninstaller)) "LocalApp uninstall command is missing"
    $location = Split-Path -Parent $uninstaller.Trim('"')
  }
  $location = (Resolve-Path -LiteralPath $location).Path
  $localPrefix = [IO.Path]::GetFullPath($env:LOCALAPPDATA).TrimEnd('\') + '\'
  Assert-Condition ($location.StartsWith($localPrefix, [StringComparison]::OrdinalIgnoreCase)) "LocalApp was not installed under LOCALAPPDATA"
  Assert-Condition (!$location.StartsWith("$env:ProgramFiles\", [StringComparison]::OrdinalIgnoreCase)) "LocalApp unexpectedly requires a machine-wide install"
  return @{ Entry = $entry; Location = $location }
}

function Assert-PackagedRuntime([string]$InstallLocation) {
  $exe = Get-ChildItem -LiteralPath $InstallLocation -Filter "localapp-desktop.exe" -File -Recurse | Select-Object -First 1
  $node = Get-ChildItem -LiteralPath $InstallLocation -Filter "node.exe" -File -Recurse | Select-Object -First 1
  $npm = Get-ChildItem -LiteralPath $InstallLocation -Filter "npm-cli.js" -File -Recurse | Select-Object -First 1
  $runner = Get-ChildItem -LiteralPath $InstallLocation -Filter "localapp-runner.mjs" -File -Recurse | Select-Object -First 1
  $localRuntime = Get-ChildItem -LiteralPath $InstallLocation -Filter "localapp-local-runtime.mjs" -File -Recurse | Select-Object -First 1
  $sqlWasm = Get-ChildItem -LiteralPath $InstallLocation -Filter "sql-wasm.wasm" -File -Recurse | Select-Object -First 1
  Assert-Condition ($null -ne $exe) "Installed application executable is missing"
  Assert-Condition ($null -ne $node) "Bundled Node.js is missing"
  Assert-Condition ($null -ne $npm) "Bundled npm CLI is missing"
  Assert-Condition ($null -ne $runner) "Fixed LocalApp runner is missing"
  Assert-Condition ($null -ne $localRuntime) "Bundled Local Runtime is missing"
  Assert-Condition ($null -ne $sqlWasm) "Bundled Local Runtime SQL WASM is missing"
  return $exe.FullName
}

function Assert-ProtocolRegistration([string]$Executable) {
  $protocol = Get-ItemProperty "HKCU:\Software\Classes\localapp\shell\open\command" -ErrorAction Stop
  $command = Get-PropertyValue $protocol "(default)"
  Assert-Condition ($command.IndexOf($Executable, [StringComparison]::OrdinalIgnoreCase) -ge 0) "localapp:// is not registered to the installed executable"
}

function Invoke-LocalAppUninstall([string]$Command) {
  $match = [regex]::Match($Command, '^\s*(?:"([^"]+)"|(\S+))(?:\s+(.*))?$')
  Assert-Condition $match.Success "LocalApp uninstall command is invalid"
  $executable = if ($match.Groups[1].Success) { $match.Groups[1].Value } else { $match.Groups[2].Value }
  $arguments = @()
  if ($match.Groups[3].Success) { $arguments += $match.Groups[3].Value }
  $arguments += "/S"
  $process = Start-Process -FilePath $executable -ArgumentList $arguments -PassThru -Wait
  Assert-Condition ($process.ExitCode -eq 0) "NSIS uninstaller failed with exit code $($process.ExitCode)"
}

function Start-And-Probe([string]$Executable) {
  $process = Start-Process -FilePath $Executable -PassThru
  Start-Sleep -Seconds 5
  $process.Refresh()
  Assert-Condition (!$process.HasExited) "LocalApp exited during startup"
  return $process
}

function Stop-LocalApp([Diagnostics.Process]$Process) {
  if (!$Process.HasExited) {
    Stop-Process -Id $Process.Id -Force
    $Process.WaitForExit()
  }
}

function Confirm-ManualCheck([string]$Prompt) {
  if (!$InteractiveChecks) { return "not-run" }
  $passed = (Read-Host "$Prompt Type YES to confirm") -ceq "YES"
  Assert-Condition $passed "Manual acceptance check failed: $Prompt"
  return "passed"
}

Assert-Condition ($env:OS -eq "Windows_NT") "This acceptance script must run on Windows"
Assert-Condition ([Environment]::Is64BitOperatingSystem) "Windows x64 is required"
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
Assert-Condition (!$principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) "Use a non-administrator VM account"
Assert-Condition ($null -eq (Get-Command node -ErrorAction SilentlyContinue)) "System Node.js must not be on PATH"
Assert-Condition ($null -eq (Get-Command npm -ErrorAction SilentlyContinue)) "System npm must not be on PATH"
$disconnectedAtInstall = $null
if ($RequireDisconnected) {
  $defaultRoutes = @(Get-NetRoute -ErrorAction SilentlyContinue | Where-Object {
    $_.DestinationPrefix -in @("0.0.0.0/0", "::/0") -and $_.State -eq "Alive"
  })
  Assert-Condition ($defaultRoutes.Count -eq 0) "Disconnect the VM before offline installation"
  $disconnectedAtInstall = $true
}
$webView2VersionBeforeInstall = Get-WebView2RuntimeVersion
if ($RequireWebView2Absent) {
  Assert-Condition ($null -eq $webView2VersionBeforeInstall) "WebView2 Runtime must be absent before installation"
}

$current = Resolve-VerifiedInstaller $Installer $ExpectedSha256 "Current installer"
$stateRoot = Join-Path $env:LOCALAPPDATA "com.localapp.desktop"
$sentinel = Join-Path $stateRoot "acceptance-upgrade-sentinel.txt"
$upgradeChecked = $null

if (![string]::IsNullOrWhiteSpace($PreviousInstaller)) {
  Assert-Condition (![string]::IsNullOrWhiteSpace($PreviousSha256)) "Previous installer SHA-256 is required when a previous installer is supplied"
  $previous = Resolve-VerifiedInstaller $PreviousInstaller $PreviousSha256 "Previous installer"
  Install-LocalApp $previous
  $previousInstall = Find-LocalAppInstall
  $previousExe = Assert-PackagedRuntime $previousInstall.Location
  $previousProcess = Start-And-Probe $previousExe
  Stop-LocalApp $previousProcess
  New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
  Set-Content -LiteralPath $sentinel -Value "preserve-on-upgrade" -NoNewline
}

Install-LocalApp $current
$install = Find-LocalAppInstall
Assert-Condition (![IO.Path]::GetFullPath($install.Location).StartsWith([IO.Path]::GetFullPath($stateRoot), [StringComparison]::OrdinalIgnoreCase)) "Install and state directories overlap"
Assert-Condition (![IO.Path]::GetFullPath($stateRoot).StartsWith([IO.Path]::GetFullPath($install.Location), [StringComparison]::OrdinalIgnoreCase)) "State directory is nested inside the install directory"
$executable = Assert-PackagedRuntime $install.Location
Assert-ProtocolRegistration $executable
$application = Start-And-Probe $executable
Stop-LocalApp $application
$webView2VersionAfterInstall = Get-WebView2RuntimeVersion
if ($RequireWebView2Absent) {
  Assert-Condition ($null -ne $webView2VersionAfterInstall) "Bundled WebView2 offline installer did not install a detectable Runtime"
}
Assert-Condition (Test-Path -LiteralPath (Join-Path $stateRoot "desktop.sqlite3")) "Desktop SQLite state was not created in the isolated data directory"
if (![string]::IsNullOrWhiteSpace($PreviousInstaller)) {
  $upgradeChecked = Test-Path -LiteralPath $sentinel
  Assert-Condition $upgradeChecked "Upgrade did not preserve LocalApp desktop state"
}

$manual = [ordered]@{
  offlineLaunch = Confirm-ManualCheck "Verify offline installation and launch without a WebView2 download"
  notifications = Confirm-ManualCheck "Verify a Windows notification and click-through"
  favorites = Confirm-ManualCheck "Verify favorite search, browser opening, and removal"
  protocolActivation = Confirm-ManualCheck "Verify localapp:// activates one existing process exactly once"
  trustedAction = Confirm-ManualCheck "Verify a trusted pure-JavaScript action without system Node"
  twoLocalApps = Confirm-ManualCheck "Install and open two local application packages together; verify both work and their records/files remain isolated without system Node"
  processTreeCancellation = Confirm-ManualCheck "Verify cancellation and timeout terminate the action process and all descendant processes"
  registryProxy = Confirm-ManualCheck "Verify exact npm dependency preparation through the configured registry/proxy"
  signedUpdater = Confirm-ManualCheck "Verify signed update installation and rejection of tampered metadata/signature"
  autostartAndTray = Confirm-ManualCheck "Verify tray behavior and enable/disable autostart across sign-in"
}

$uninstallPreservedState = $null
if ($UninstallAfter) {
  New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
  Set-Content -LiteralPath $sentinel -Value "preserve-on-uninstall" -NoNewline
  $uninstaller = Get-PropertyValue $install.Entry "UninstallString"
  Assert-Condition (![string]::IsNullOrWhiteSpace($uninstaller)) "LocalApp uninstall command is missing"
  Invoke-LocalAppUninstall $uninstaller
  $uninstallPreservedState = Test-Path -LiteralPath $sentinel
  Assert-Condition $uninstallPreservedState "Uninstall removed LocalApp desktop state"
}

$report = [ordered]@{
  status = if ($InteractiveChecks) { "passed" } else { "automation-passed-manual-not-run" }
  generatedAt = [DateTimeOffset]::UtcNow.ToString("O")
  machine = $env:COMPUTERNAME
  user = $env:USERNAME
  os = [Environment]::OSVersion.VersionString
  installerSha256 = (Get-FileHash -LiteralPath $current -Algorithm SHA256).Hash.ToLowerInvariant()
  installLocation = $install.Location
  stateLocation = $stateRoot
  windowsX64 = $true
  nonAdministrator = $true
  noSystemNode = $true
  noSystemNpm = $true
  disconnectedRequired = [bool]$RequireDisconnected
  disconnectedAtInstall = $disconnectedAtInstall
  webView2AbsenceRequired = [bool]$RequireWebView2Absent
  webView2AbsentBeforeInstall = $null -eq $webView2VersionBeforeInstall
  webView2VersionAfterInstall = $webView2VersionAfterInstall
  currentUserInstall = $true
  packagedRuntime = $true
  protocolRegistered = $true
  startupStable = $true
  interactiveChecksRequested = [bool]$InteractiveChecks
  upgradeStatePreserved = $upgradeChecked
  uninstallStatePreserved = $uninstallPreservedState
  manualChecks = $manual
}
$reportDirectory = Split-Path -Parent ([IO.Path]::GetFullPath($ReportPath))
New-Item -ItemType Directory -Path $reportDirectory -Force | Out-Null
$report | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $ReportPath -Encoding utf8
Write-Host "Acceptance report: $ReportPath"
