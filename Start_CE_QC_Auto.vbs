Option Explicit

Dim shell, fso, projectDir, command, url, http, status
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = projectDir
url = "http://127.0.0.1:5177/"

' Fast path: if CE QC is already running, do not restart Node or touch the port.
' Just open the existing local app immediately.
status = 0
On Error Resume Next
Set http = CreateObject("WinHttp.WinHttpRequest.5.1")
http.SetTimeouts 300, 300, 500, 500
http.Open "GET", url, False
http.Send
status = http.Status
On Error GoTo 0

If status >= 200 And status < 500 Then
  shell.Run url, 1, False
  WScript.Quit 0
End If

' Cold start: launch the protected runtime completely in the background.
' Start_CE_QC.ps1 will verify port 5177 and open the browser only when ready.
command = "cmd.exe /d /c """ & projectDir & "\Start_CE_QC.cmd"""
shell.Run command, 0, False
