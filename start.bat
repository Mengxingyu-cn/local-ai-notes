@echo off
chcp 65001 >nul
title 本地 AI 笔记 - 启动器
setlocal

if not defined PORT set PORT=3000

echo ============================================
echo    📝 本地 AI 笔记 启动器
echo ============================================
echo.

rem ---- 检查 Node.js 是否安装 ----
where node >nul 2>nul
if errorlevel 1 (
    echo [错误] 未检测到 Node.js！
    echo        请先安装 Node.js 18 或更高版本：https://nodejs.org/
    echo.
    pause
    exit /b 1
)

for /f "delims=" %%v in ('node -v') do echo [信息] Node.js 版本：%%v
echo [信息] 服务端口：%PORT%
echo [信息] 2 秒后自动打开浏览器，若未打开请手动访问 http://localhost:%PORT%
echo [信息] 关闭本窗口或按 Ctrl+C 即可停止服务
echo.

rem ---- 延迟 2 秒打开浏览器（等服务监听就绪） ----
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:%PORT%"

rem ---- 启动服务 ----
node server.js

echo.
echo [提示] 服务已停止。若因端口被占用退出，请关闭占用 %PORT% 端口的程序后重试。
pause
