Option Explicit

Dim shell, fso, appShell, projectDir, cmdPath, url, http, status
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = projectDir
url = "http://127.0.0.1:5177/"

' Fast path: if CE QC is already running, open the existing local app immediately.
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

' Cold start: ShellExecute the project CMD directly instead of embedding the
' project path in a cmd.exe argument string. This preserves Unicode folder
' names and avoids Windows Script Host turning Chinese characters into ???? .
cmdPath = fso.BuildPath(projectDir, "Start_CE_QC.cmd")
If Not fso.FileExists(cmdPath) Then
  MsgBox "CE QC launcher file was not found:" & vbCrLf & cmdPath, 16, "CE QC"
  WScript.Quit 2
End If

Set appShell = CreateObject("Shell.Application")
appShell.ShellExecute cmdPath, "", projectDir, "open", 0
