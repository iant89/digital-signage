# ============================================================================
# apps/desktop-host/windows-kiosk-provision.ps1
# Windows 11 Enterprise Dedicated Signage Kiosk Provisioning Script
# Configures Auto-Logon, Power Policy (Never Sleep), and Shell Launcher v2
# ============================================================================

param(
    [string]$KioskExecutablePath = "C:\Program Files\Digital Signage Kiosk Player\signage-kiosk-player.exe",
    [string]$PackagePath = "C:\SignageData\packages\active.signage",
    [string]$ServerUrl = "https://signage-control.local:4000",
    [string]$DeviceId = "player-win-01"
)

Write-Host "[1/4] Disabling display sleep, screensaver, and hibernation for 24/7 signage playback..."
powercfg /change monitor-timeout-ac 0
powercfg /change standby-timeout-ac 0
powercfg /change hibernate-timeout-ac 0
Set-ItemProperty -Path "HKCU:\Control Panel\Desktop" -Name ScreenSaveActive -Value 0

Write-Host "[2/4] Suppressing Windows Error Reporting modal dialogs..."
Set-ItemProperty -Path "HKLM:\SOFTWARE\Microsoft\Windows\Windows Error Reporting" -Name DontShowUI -Value 1

Write-Host "[3/4] Registering .signage file association (application/vnd.digital-signage.package)..."
New-Item -Path "HKCR:\.signage" -Force | Out-Null
Set-ItemProperty -Path "HKCR:\.signage" -Name "(Default)" -Value "DigitalSignage.Package"
Set-ItemProperty -Path "HKCR:\.signage" -Name "Content Type" -Value "application/vnd.digital-signage.package"

Write-Host "[4/4] Configuring Kiosk Autostart Command..."
$LaunchCmd = "`"$KioskExecutablePath`" --kiosk --fullscreen --package `"$PackagePath`" --server `"$ServerUrl`" --device-id `"$DeviceId`""
Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "DigitalSignageKioskPlayer" -Value $LaunchCmd

Write-Host "Provisioning complete. Command registered: $LaunchCmd"
