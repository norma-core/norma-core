# Runs idf.py for this project with ESP-IDF 5.5 from C:\esp\esp-idf (set IDF_PATH to use another copy).
# Examples:  .\build.ps1 build          .\build.ps1 -p COM7 flash monitor          .\build.ps1 menuconfig
# ESP-IDF's export.ps1 wants a `python` on PATH; this PC only has the `py` launcher, so the Python folder is added first.
param([Parameter(ValueFromRemainingArguments = $true)] [string[]] $Args)
$ErrorActionPreference = "Continue"   # export.ps1 prints progress to stderr; "Stop" would abort on it when the output is redirected
Remove-Item Env:MSYSTEM -ErrorAction SilentlyContinue   # idf_tools refuses to run when it thinks it is inside Git Bash / MSYS
if (-not $env:IDF_PATH) { $env:IDF_PATH = "C:\esp\esp-idf" }
$py = Split-Path (& py -3 -c "import sys; print(sys.executable)")
$env:Path = "$py;$py\Scripts;" + $env:Path
Set-Location $PSScriptRoot
. "$env:IDF_PATH\export.ps1" | Out-Null
if (-not $Args) { $Args = @("build") }
idf.py @Args
exit $LASTEXITCODE
