param(
  [Parameter(Mandatory = $true)][string]$Label
)

$project = 'streamtube-phase03-large'
$root = Resolve-Path -LiteralPath '../docs/phases/phase-03-videos/evidence'
$stop = Join-Path $env:TEMP "phase03-$Label-stop.flag"
$resources = Join-Path $root "large-$Label-resources.csv"
$disk = Join-Path $root "large-$Label-disk.csv"
if (Test-Path -LiteralPath $stop) { Remove-Item -LiteralPath $stop }
'timestamp,container,cpu,mem,block_io' | Set-Content -LiteralPath $resources
'timestamp,minio_bytes,worker_scratch_bytes' | Set-Content -LiteralPath $disk

while (-not (Test-Path -LiteralPath $stop)) {
  $timestamp = (Get-Date).ToString('o')
  docker stats --no-stream --format '{{.Name}},{{.CPUPerc}},{{.MemUsage}},{{.BlockIO}}' |
    Where-Object { $_ -like "$project-*" } |
    ForEach-Object { "$timestamp,$_" } |
    Add-Content -LiteralPath $resources
  $minio = (docker compose -f compose.test.yaml -f compose.large.yaml -p $project exec -T minio-test du -sb /data 2>$null |
    Select-Object -First 1) -split '\s+'
  $scratch = (docker compose -f compose.test.yaml -f compose.large.yaml -p $project exec -T video-worker-test du -sb /work/videos 2>$null |
    Select-Object -First 1) -split '\s+'
  "$timestamp,$($minio[0]),$($scratch[0])" | Add-Content -LiteralPath $disk
  Start-Sleep -Seconds 5
}
