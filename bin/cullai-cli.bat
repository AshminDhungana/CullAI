@echo off
REM CullAI Headless CLI Wrapper
REM Usage: cullai-cli.bat [options]
REM Forwards to Electron with --headless

setlocal
set "ELECTRON_PATH=%~dp0..\node_modules\.bin\electron.cmd"
if not exist "%ELECTRON_PATH%" (
    echo Error: electron not found. Run 'npm install' first. >&2
    exit /b 1
)

"%ELECTRON_PATH%" --headless %*
endlocal
