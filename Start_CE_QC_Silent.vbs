Option Explicit

Dim shell, fso, projectDir, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = projectDir
command = "cmd.exe /d /c """ & projectDir & "\Start_CE_QC.cmd"" --background"
shell.Run command, 0, False
WScript.Sleep 4000
shell.Run "http://127.0.0.1:5177/", 1, False
