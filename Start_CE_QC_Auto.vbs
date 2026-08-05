Option Explicit

Dim shell, fso, projectDir, command
Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

If fso.FolderExists("C:\CE-QC") Then
  projectDir = "C:\CE-QC"
Else
  projectDir = fso.GetParentFolderName(WScript.ScriptFullName)
End If
shell.CurrentDirectory = projectDir
command = "cmd.exe /d /c """ & projectDir & "\Start_CE_QC.cmd"" --background"
shell.Run command, 0, False
