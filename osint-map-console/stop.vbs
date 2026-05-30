' OSINT Map Console — Stop All
' Убивает uvicorn и node процессы запущенные лаунчером.

Dim shell
Set shell = CreateObject("WScript.Shell")

shell.Run "cmd /c taskkill /F /IM uvicorn.exe >nul 2>&1", 0, True
shell.Run "cmd /c taskkill /F /IM node.exe >nul 2>&1",    0, True

' Подтверждение через трей-уведомление (не всплывает окно)
Dim wsh
Set wsh = CreateObject("WScript.Shell")
wsh.Popup "OSINT Map Console остановлен.", 2, "OSINT Map", 64

Set shell = Nothing
Set wsh = Nothing
