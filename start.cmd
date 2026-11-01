@echo off
setlocal
set "SL_ERP_DEV_ROOT=%~dp0"
powershell.exe -NoProfile -Command "$ErrorActionPreference='Stop'; $p=$env:SL_ERP_DEV_ROOT.TrimEnd('\'); if($p -match '^\\\\(?:wsl\.localhost|wsl\$)\\([^\\]+)\\(.*)$') { $d=$Matches[1]; $l='/'+$Matches[2].Replace('\','/') } else { $d='Ubuntu'; $l=(& wsl.exe -d $d -- wslpath -a $p); if($LASTEXITCODE){exit $LASTEXITCODE} }; & wsl.exe -d $d --cd $l -- bash ./start.sh; exit $LASTEXITCODE"
exit /b %errorlevel%
