Dim shell
Set shell = CreateObject("WScript.Shell")

Dim backendCmd
backendCmd = "cmd /c ""cd /d C:\N4\osint-map-console\backend && .venv\Scripts\python.exe -m uvicorn main:app --reload --port 8000"""

shell.Run backendCmd, 0, False

Dim frontendCmd
frontendCmd = "cmd /c ""cd /d C:\N4\osint-map-console\frontend && npm run dev"""

shell.Run frontendCmd, 0, False

WScript.Sleep 6000
shell.Run "http://localhost:5173", 1, False

Set shell = Nothing