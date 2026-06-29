@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

echo [run] C# 引用分析工具
echo [run] 地址: http://127.0.0.1:8780
echo [run] 按 Ctrl+C 停止服务
echo.

rem 等待 Kestrel 就绪后打开浏览器
start "" cmd /c "ping 127.0.0.1 -n 3 >nul && start http://127.0.0.1:8780"

dotnet run
if errorlevel 1 (
  echo.
  echo [run] 启动失败，请确认已安装 .NET SDK（net10.0）。
  pause
)
