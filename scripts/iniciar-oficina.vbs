' Arranca la Oficina Virtual sin abrir ninguna ventana.
' El acceso directo "Oficina Virtual" de la carpeta Inicio de Windows apunta a este archivo.
Set fso = CreateObject("Scripting.FileSystemObject")
carpeta = fso.GetParentFolderName(WScript.ScriptFullName)
CreateObject("WScript.Shell").Run "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & carpeta & "\iniciar-oficina.ps1""", 0, False
