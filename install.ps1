# 学习监督台 —— 装进当前机器的 DSH 桌面 profile
#
# 用法（在本目录执行）：
#   powershell -ExecutionPolicy Bypass -File .\install.ps1
# 或指定别的 profile 目录：
#   powershell -ExecutionPolicy Bypass -File .\install.ps1 -ProfileDir "$env:USERPROFILE\.dsh\profiles\desktop"

param(
    [string]$ProfileDir = (Join-Path $env:USERPROFILE '.dsh\profiles\desktop'),
    [string]$Source = $PSScriptRoot
)

$ErrorActionPreference = 'Stop'
$name = 'dsh-study-supervisor'

if (-not (Test-Path (Join-Path $Source 'package.json'))) {
    throw "找不到插件包：$Source\package.json（请把整个目录一起拷贝过来）"
}
$pkgPath = Join-Path $ProfileDir 'package.json'
if (-not (Test-Path $pkgPath)) {
    throw "找不到 profile：$ProfileDir。请先启动一次 DSH 桌面端，让它生成此目录。"
}

# 1) 目录联接：profile\node_modules\<name> -> 插件目录
$nodeModules = Join-Path $ProfileDir 'node_modules'
New-Item -ItemType Directory -Force -Path $nodeModules | Out-Null
$link = Join-Path $nodeModules $name
if (Test-Path $link) {
    $target = (Get-Item $link).Target
    if ($target -and ($target -ne $Source)) {
        Write-Host "已有联接指向 $target，改指向 $Source"
        Remove-Item $link -Force
        New-Item -ItemType Junction -Path $link -Target $Source | Out-Null
    }
    else {
        Write-Host "联接已存在：$link"
    }
}
else {
    New-Item -ItemType Junction -Path $link -Target $Source | Out-Null
    Write-Host "已建立联接：$link -> $Source"
}

# 2) profile 清单：依赖 + bundles
$backup = Join-Path $env:TEMP ("dsh-profile-package.json.bak-" + (Get-Date -Format 'yyyyMMdd-HHmmss'))
Copy-Item -LiteralPath $pkgPath -Destination $backup -Force
Write-Host "已备份清单：$backup"

$data = Get-Content -LiteralPath $pkgPath -Raw | ConvertFrom-Json
if (-not $data.PSObject.Properties['dependencies']) {
    $data | Add-Member -NotePropertyName dependencies -NotePropertyValue ([pscustomobject]@{})
}
$data.dependencies | Add-Member -Force -NotePropertyName $name -NotePropertyValue "link:$Source"

if (-not $data.PSObject.Properties['dsh']) {
    $data | Add-Member -NotePropertyName dsh -NotePropertyValue ([pscustomobject]@{})
}
if (-not $data.dsh.PSObject.Properties['profile']) {
    $data.dsh | Add-Member -NotePropertyName profile -NotePropertyValue ([pscustomobject]@{})
}
$bundles = @()
if ($data.dsh.profile.PSObject.Properties['bundles']) { $bundles = @($data.dsh.profile.bundles) }
if ($bundles -notcontains $name) { $bundles += $name }
$data.dsh.profile | Add-Member -Force -NotePropertyName bundles -NotePropertyValue $bundles

($data | ConvertTo-Json -Depth 8) | Set-Content -LiteralPath $pkgPath -Encoding utf8

Write-Host ''
Write-Host "完成：插件已接入 $ProfileDir"
Write-Host 'DSH 开着的话会通过 HMR 自动加载；如果底部没出现学习监督栏，重启一次桌面端。'
