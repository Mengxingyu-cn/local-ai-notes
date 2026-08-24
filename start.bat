@echo off
title 本地 AI 笔记 - 启动器
setlocal
cd /d "%~dp0"

if not defined PORT set PORT=3000

echo ============================================
echo    ? 本地 AI 笔记 启动器
echo ============================================
echo.

rem ---- 寻找 Node.js：优先便携版（node\node.exe，免安装），其次系统安装版 ----
set "NODE_EXE="
if exist "%~dp0node\node.exe" (
    set "NODE_EXE=%~dp0node\node.exe"
    echo [信息] 使用便携版 Node.js（node 文件夹）
) else (
    where node >nul 2>nul
    if not errorlevel 1 (
        set "NODE_EXE=node"
        echo [信息] 使用系统安装的 Node.js
    )
)

if not defined NODE_EXE (
    echo [错误] 未找到 Node.js！
    echo.
    echo   新手用户推荐使用便携版（免安装）：
    echo   1. 打开 https://nodejs.org/en/download
    echo   2. 在 Windows 部分选择 Windows Binary ^(.zip^) 下载
    echo   3. 解压后把文件夹里的文件 ^(node.exe 等^) 全部放入本项目的 node 文件夹
    echo   4. 放好后重新双击本脚本即可启动
    echo.
    echo   也可以直接安装 Node.js：https://nodejs.org/
    echo.
    pause
    exit /b 1
)

rem ---- 校验 Node.js 主版本不低于 18 ----
for /f "delims=" %%v in ('"%NODE_EXE%" -v 2^>nul') do set NODE_VER=%%v
echo [信息] Node.js 版本：%NODE_VER%
set "VER_MAJOR="
for /f "tokens=1 delims=." %%a in ("%NODE_VER:~1%") do set VER_MAJOR=%%a
if defined VER_MAJOR (
    if %VER_MAJOR% LSS 18 (
        echo [错误] Node.js 版本过低，需要 18 或更高版本！
        echo   请更换新版便携版 Node（重新覆盖 node 文件夹），或升级系统 Node.js。
        pause
        exit /b 1
    )
)

echo [信息] 服务端口：%PORT%
echo [信息] 2 秒后自动打开浏览器，若未打开请手动访问 http://localhost:%PORT%
echo [信息] 关闭本窗口或按 Ctrl+C 即可停止服务
echo.

rem ---- 延迟 2 秒打开浏览器（等服务监听就绪） ----
start "" /b cmd /c "timeout /t 2 /nobreak >nul & start http://localhost:%PORT%"

rem ---- 启动服务 ----
"%NODE_EXE%" server.js

echo.
echo [提示] 服务已停止。若因端口被占用退出，请关闭占用 %PORT% 端口的程序后重试。
pause