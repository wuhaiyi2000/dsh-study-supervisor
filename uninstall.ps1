# 学习监督台 —— 从当前机器的 DSH 桌面 profile 卸载（保留插件目录与学习数据）

param(
    [string]$ProfileDir = (Join-Path $env:USERPROFILE '.dsh\profiles\desktop')
)

$ErrorActionPreference = 'Stop'
$name = 'dsh-study-supervisor'

$link = Join-Path $ProfileDir "node_modules\$name"
if (Test-Path $link) {
    Remove-Item $link -Force
    Write-Host "已删除联接：$link"
}

$pkgPath = Join-Path $ProfileDir 'package.json'
if (-not (Test-Path $pkgPath)) { Write-Host "没有 profile 清单，跳过：$pkgPath"; exit 0 }

$backup = Join-Path $env:TEMP ("dsh-profile-package.json.bak-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
Copy-Item -LiteralPath $pkgPath -Destination $backup -Force

$data = Get-Content -LiteralPath $pkgPath -Raw | ConvertFrom-Json
if ($data.PSObject.Properties['dependencies'] -and $data.dependencies.PSObject.Properties[$name]) {
    $data.dependencies.PSObject.Properties.Remove($name)
}
if ($data.PSObject.Properties['dsh'] -and $data.dsh.PSObject.Properties['profile'] -and
    $data.dsh.profile.PSObject.Properties['bundles']) {
    $data.dsh.profile.bundles = @($data.dsh.profile.bundles | Where-Object { $_ -ne $name })
}

($data | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $pkgPath -Encoding utf8
Write-Host "已从 $pkgPath 移除插件条目（备份：$backup）"
Write-Host '学习数据仍保存在浏览器 localStorage 里；如需带走，先在面板「设置 → 跨机同步」导出文件。'
