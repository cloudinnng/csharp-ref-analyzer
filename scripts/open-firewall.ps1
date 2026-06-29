# 为 C# 引用分析工具放行 TCP 8780 入站（需管理员 PowerShell）
# 用法: 右键「以管理员身份运行」或在管理员终端执行:
#   .\scripts\open-firewall.ps1

#Requires -RunAsAdministrator

$ErrorActionPreference = 'Stop'
$ruleName = 'CsharpRefAnalyzer (TCP 8780)'
$port = 8780

Write-Host "[firewall] 检查现有规则: $ruleName"
$existing = Get-NetFirewallRule -DisplayName $ruleName -ErrorAction SilentlyContinue
if ($existing) {
    Enable-NetFirewallRule -DisplayName $ruleName | Out-Null
    Write-Host "[firewall] 规则已存在，已确保启用"
}
else {
    New-NetFirewallRule `
        -DisplayName $ruleName `
        -Direction Inbound `
        -Protocol TCP `
        -LocalPort $port `
        -Action Allow `
        -Profile Domain,Private,Public | Out-Null
    Write-Host "[firewall] 已创建入站规则，放行 TCP $port"
}

Write-Host "[firewall] 完成。局域网设备可访问: http://<本机IP>:$port"
