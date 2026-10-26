@echo off
chcp 65001 >nul
setlocal
rem 始终进入bat所在仓库；pushd也支持包含空格的路径。
pushd "%~dp0"
if errorlevel 1 exit /b 1
where node >nul 2>nul
if errorlevel 1 goto missing_node
node "tools\sync-local.js"
set "sync_exit=%errorlevel%"
goto finish
:missing_node
echo 未找到Node.js，请安装Node.js并重新打开窗口。
set "sync_exit=1"
:finish
popd
rem 双击后保留结果；命令行验证可加 --no-pause 跳过等待。
if /i "%~1"=="--no-pause" goto done
pause
:done
exit /b %sync_exit%
