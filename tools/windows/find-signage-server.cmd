@echo off
setlocal
rem ==========================================================================
rem Windows cmd.exe launcher for the Digital Signage Studio LAN scanner.
rem Requires Node.js 18 or newer (already used by the signage server toolchain).
rem ==========================================================================

set "SCANNER=%~dp0..\network-scanner\find-signage-server.mjs"

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js 18 or newer is required to run the signage network scanner. 1>&2
  echo         Install from https://nodejs.org/ or run this from the project checkout. 1>&2
  exit /b 2
)

if not exist "%SCANNER%" (
  echo [ERROR] Scanner not found: %SCANNER% 1>&2
  exit /b 2
)

node "%SCANNER%" %*
exit /b %ERRORLEVEL%
