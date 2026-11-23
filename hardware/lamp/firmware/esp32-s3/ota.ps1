# Sends the built app to the lamp over Wi-Fi:  .\ota.ps1                 (nc-lamp.local)
#                                               .\ota.ps1 192.168.1.50    (the lamp's IP, when .local does not resolve)
# Build first (.\build.ps1 build). Only the app goes over; the model partition stays as it is.
param([string] $Lamp = "nc-lamp.local")
$bin = Join-Path $PSScriptRoot "build\nc_lamp.bin"
if (-not (Test-Path $bin)) { Write-Error "no $bin - run .\build.ps1 build first"; exit 1 }
$size = (Get-Item $bin).Length
Write-Host ("sending {0:N0} bytes to http://{1}/update ..." -f $size, $Lamp)
try {
    $r = Invoke-WebRequest -UseBasicParsing -Method Post -Uri "http://$Lamp/update" -InFile $bin `
        -ContentType "application/octet-stream" -TimeoutSec 300
    Write-Host $r.Content
    Write-Host "the lamp reboots now; give it about 10 s"
} catch {
    Write-Error $_.Exception.Message
    exit 1
}
