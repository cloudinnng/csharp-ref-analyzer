# =============================================================================
# run-tray-host.ps1
# 托盘宿主：隐藏启动 dotnet run；托盘右键可打开浏览器 / 退出并结束进程。
# 由 run-background.bat 以 Hidden + STA 拉起。
#
# 日志拆分（避免文件锁冲突）：
#   logs\tray-host.log      - 托盘宿主自己的日志
#   logs\run-background.log - 仅 dotnet/cmd 重定向输出（独占追加）
# =============================================================================

#Requires -Version 5.1
$ErrorActionPreference = "Stop"

#region 路径与日志
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = Split-Path -Parent $ScriptDir
Set-Location -LiteralPath $Root

$LogDir = Join-Path $Root "logs"
if (-not (Test-Path -LiteralPath $LogDir)) {
    New-Item -ItemType Directory -Path $LogDir | Out-Null
}

# 关键：dotnet 与托盘不得写同一文件。cmd 的 >> 会独占打开日志，Add-Content 会撞锁。
$AppLogFile = Join-Path $LogDir "run-background.log"
$TrayLogFile = Join-Path $LogDir "tray-host.log"
$PidFile = Join-Path $LogDir "tray-host.pid"
$Url = "http://127.0.0.1:8780"
$Port = 8780

function Write-TrayLog {
    param([Parameter(Mandatory = $true)][string]$Message)
    $Stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
    # 只写 tray-host.log，绝不碰 AppLogFile
    Add-Content -LiteralPath $TrayLogFile -Value "[$Stamp] [tray-host] $Message" -Encoding UTF8
}
#endregion

#region 单实例：已在监听则打开浏览器并退出
$Listening = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
if ($null -ne $Listening) {
    Write-TrayLog "port $Port already listening; open browser and exit"
    Start-Process $Url
    exit 0
}
#endregion

#region WinForms 托盘
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

Set-Content -LiteralPath $PidFile -Value $PID -Encoding ASCII
Write-TrayLog "tray host PID=$PID root=$Root"

$script:AppProcess = $null

function Stop-AppProcess {
    if ($null -ne $script:AppProcess -and -not $script:AppProcess.HasExited) {
        Write-TrayLog "taskkill /T tree PID=$($script:AppProcess.Id)"
        & taskkill.exe /F /T /PID $script:AppProcess.Id 2>$null | Out-Null
    }
    $Listeners = Get-NetTCPConnection -LocalPort $Port -State Listen -ErrorAction SilentlyContinue
    if ($null -ne $Listeners) {
        foreach ($OwningPid in @($Listeners | Select-Object -ExpandProperty OwningProcess -Unique)) {
            Write-TrayLog "fallback kill listener PID=$OwningPid"
            & taskkill.exe /F /T /PID $OwningPid 2>$null | Out-Null
        }
    }
}

$Notify = New-Object System.Windows.Forms.NotifyIcon
# 使用项目自定义图标（与浏览器 favicon 同款）；缺失时回退系统图标
$IconPath = Join-Path $Root "app.ico"
$script:CustomIcon = $null
if (Test-Path -LiteralPath $IconPath) {
    $script:CustomIcon = New-Object System.Drawing.Icon $IconPath
    $Notify.Icon = $script:CustomIcon
    Write-TrayLog "tray icon loaded: $IconPath"
}
else {
    $Notify.Icon = [System.Drawing.SystemIcons]::Application
    Write-TrayLog "tray icon fallback: SystemIcons.Application (missing $IconPath)"
}
$Notify.Text = "C# Ref Analyzer :$Port"
$Notify.Visible = $true

$Menu = New-Object System.Windows.Forms.ContextMenuStrip

$ItemOpen = New-Object System.Windows.Forms.ToolStripMenuItem
$ItemOpen.Text = "打开浏览器"
$ItemOpen.Add_Click({
    Write-TrayLog "menu: open browser"
    Start-Process $Url
})

$ItemLog = New-Object System.Windows.Forms.ToolStripMenuItem
$ItemLog.Text = "打开日志目录"
$ItemLog.Add_Click({
    Write-TrayLog "menu: open log dir"
    Start-Process explorer.exe -ArgumentList $LogDir
})

$ItemExit = New-Object System.Windows.Forms.ToolStripMenuItem
$ItemExit.Text = "退出并停止服务"
$ItemExit.Add_Click({
    Write-TrayLog "menu: exit"
    [System.Windows.Forms.Application]::Exit()
})

[void]$Menu.Items.Add($ItemOpen)
[void]$Menu.Items.Add($ItemLog)
[void]$Menu.Items.Add((New-Object System.Windows.Forms.ToolStripSeparator))
[void]$Menu.Items.Add($ItemExit)
$Notify.ContextMenuStrip = $Menu

$Notify.Add_DoubleClick({
    Write-TrayLog "double-click: open browser"
    Start-Process $Url
})
#endregion

#region 隐藏启动服务
# 启动标记写在 AppLogFile：必须在 cmd 重定向打开该文件之前完成
$Stamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
Add-Content -LiteralPath $AppLogFile -Value "" -Encoding UTF8
Add-Content -LiteralPath $AppLogFile -Value "===== $Stamp tray background start =====" -Encoding UTF8

$CmdArgs = '/c chcp 65001 >nul & dotnet run >> "' + $AppLogFile + '" 2>&1'
Write-TrayLog "Start-Process hidden cmd: $CmdArgs"
$script:AppProcess = Start-Process `
    -FilePath "cmd.exe" `
    -ArgumentList $CmdArgs `
    -WorkingDirectory $Root `
    -WindowStyle Hidden `
    -PassThru
Write-TrayLog "app shell PID=$($script:AppProcess.Id)"

$Notify.BalloonTipTitle = "C# 引用分析工具"
$Notify.BalloonTipText = "已在后台运行。右键托盘图标可退出。"
$Notify.BalloonTipIcon = [System.Windows.Forms.ToolTipIcon]::Info
$Notify.ShowBalloonTip(3000)

# 用 Timer 延迟开浏览器，避免 Sleep 卡住消息循环导致托盘无响应
$OpenTimer = New-Object System.Windows.Forms.Timer
$OpenTimer.Interval = 3000
$OpenTimer.Add_Tick({
    $OpenTimer.Stop()
    Write-TrayLog "timer: open browser"
    Start-Process $Url
})
$OpenTimer.Start()
#endregion

#region 消息循环与清理
try {
    Write-TrayLog "Application.Run message loop"
    [System.Windows.Forms.Application]::Run()
}
finally {
    Write-TrayLog "cleanup begin"
    try { $OpenTimer.Stop(); $OpenTimer.Dispose() } catch { }
    try { $Notify.Visible = $false } catch { }
    Stop-AppProcess
    if (Test-Path -LiteralPath $PidFile) {
        Remove-Item -LiteralPath $PidFile -Force -ErrorAction SilentlyContinue
    }
    try { $Notify.Dispose() } catch { }
    try {
        if ($null -ne $script:CustomIcon) { $script:CustomIcon.Dispose() }
    } catch { }
    Write-TrayLog "cleanup done"
}
#endregion