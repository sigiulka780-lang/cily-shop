@echo off
chcp 65001 >nul
title Cily Shop - Starting...

echo ========================================
echo   Cily Shop - Auto Shop for Celerity
echo ========================================
echo.

if not exist ".env" (
    echo [WARN] .env not found, copying from .env.example
    copy .env.example .env >nul
    echo.
    echo [IMPORTANT] Edit .env with your settings:
    echo   - YOOKASSA_SHOP_ID / YOOKASSA_SECRET_KEY / YOOKASSA_WEBHOOK_SECRET
    echo   - LICENSE_SERVER_URL / LICENSE_SERVER_API_KEY
    echo   - ADMIN_PASSWORD_HASH (generate: node -e "console.log(require('crypto').createHash('sha256').update('yourpass').digest('hex'))")
    echo.
)

if not exist "node_modules" (
    echo [INFO] Installing dependencies...
    npm install
    echo.
)

echo [INFO] Initializing database...
node src/scripts/init-db.js 2>nul || echo [INFO] DB already initialized

echo.
echo [INFO] Starting server on http://localhost:3000
echo [INFO] Admin panel: http://localhost:3000/admin
echo [INFO] Press Ctrl+C to stop
echo.

node src/server.js