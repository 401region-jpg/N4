' OSINT Map Console — Silent Launcher
' Запускает backend и frontend в скрытых окнах, затем открывает браузер.

Dim shell
Set shell = CreateObject("WScript.Shell")

' ── Backend ──────────────────────────────────────────────────────────────────
' pip install тихо, затем uvicorn
Dim backendCmd
backendCmd = "cmd /c """ & _
    "cd /d C:\N4\osint-map-console\backend && " & _
    "pip install -r requirements.txt -q --disable-pip-version-check && " & _
    "uvicorn main:app --reload --port 8000" & _
    """"

shell.Run backendCmd, 0, False   ' 0 = скрытое окно, False = не ждать

' ── Frontend ─────────────────────────────────────────────────────────────────
Dim frontendCmd
frontendCmd = "cmd /c """ & _
    "cd /d C:\N4\osint-map-console\frontend && " & _
    "npm install --prefer-offline --loglevel error && " & _
    "npm run dev" & _
    """"

shell.Run frontendCmd, 0, False

' ── Ждём пока Vite поднимется, потом открываем браузер ───────────────────────
WScript.Sleep 4500
shell.Run "http://localhost:5173", 1, False

Set shell = Nothing
