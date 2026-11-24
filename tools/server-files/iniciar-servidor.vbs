' Abre el Servidor POS sin ventana (corre oculto). Si ya estaba abierto, no hace nada.
' Para cerrarlo: detener-servidor.cmd. La bitacora queda en servidor.log.
Set shell = CreateObject("WScript.Shell")
dir = CreateObject("Scripting.FileSystemObject").GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = dir
shell.Run """" & dir & "\ServidorPOS.exe""", 0, False
