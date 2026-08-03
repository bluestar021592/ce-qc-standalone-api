$root = Resolve-Path "$PSScriptRoot\..\..\.."
$patterns = @(
  'row-reverse', 'direction:\s*rtl', 'scaleX\(-1\)',
  '扫描查询', '异常规则', '导出中心',
  'Snapshot ID', 'CE速递', 'Shopee本土'
)
foreach ($p in $patterns) {
  Write-Host "=== 搜索: $p ==="
  Get-ChildItem $root -Recurse -File -Include *.js,*.jsx,*.ts,*.tsx,*.css,*.html,*.vue |
    Select-String -Pattern $p -CaseSensitive:$false |
    ForEach-Object { "{0}:{1}: {2}" -f $_.Path,$_.LineNumber,$_.Line.Trim() }
}
