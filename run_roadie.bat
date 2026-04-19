@echo off
setlocal

:: Check if node is in PATH
where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js not found. Please install Node.js >= 22.
    exit /b 1
)

:: Build if necessary
if not exist "out\index.js" (
    echo [INFO] First time setup: Building Roadie MCP server...
    call npm run build
)

set PROJECT_ROOT=%~1
if "%PROJECT_ROOT%"=="" set PROJECT_ROOT=%cd%

echo [INFO] Starting Roadie MCP Server...
echo [INFO] Project Root: %PROJECT_ROOT%
echo [INFO] Press Ctrl+C to stop.

node out\index.js "%PROJECT_ROOT%"
