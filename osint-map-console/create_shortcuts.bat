@echo off
:: Создаёт ярлыки launch.vbs и stop.vbs на рабочем столе текущего пользователя

set "SCRIPT_DIR=%~dp0"
set "DESKTOP=%USERPROFILE%\Desktop"

:: Ярлык запуска
powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "$s = $ws.CreateShortcut('%DESKTOP%\OSINT Map Console.lnk');" ^
  "$s.TargetPath = 'wscript.exe';" ^
  "$s.Arguments = '\"%SCRIPT_DIR%launch.vbs\"';" ^
  "$s.WorkingDirectory = '%SCRIPT_DIR%';" ^
  "$s.Description = 'OSINT Map Console — запустить';" ^
  "$s.IconLocation = 'shell32.dll,22';" ^
  "$s.Save()"

:: Ярлык остановки
powershell -NoProfile -Command ^
  "$ws = New-Object -ComObject WScript.Shell;" ^
  "$s = $ws.CreateShortcut('%DESKTOP%\OSINT Map Stop.lnk');" ^
  "$s.TargetPath = 'wscript.exe';" ^
  "$s.Arguments = '\"%SCRIPT_DIR%stop.vbs\"';" ^
  "$s.WorkingDirectory = '%SCRIPT_DIR%';" ^
  "$s.Description = 'OSINT Map Console — остановить';" ^
  "$s.IconLocation = 'shell32.dll,131';" ^
  "$s.Save()"

echo [OK] Ярлыки созданы на рабочем столе.
pause
