#ifndef AppVersion
  #error AppVersion must be supplied by tools/package.ps1
#endif
#ifndef RuntimeDir
  #error RuntimeDir must be supplied by tools/package.ps1
#endif

[Setup]
AppId={{868314CE-1253-46A3-A4EA-55CDE71BCF0A}
AppName=Emby Theater Enhanced
AppVersion={#AppVersion}
VersionInfoVersion={#AppVersion}
DefaultDirName={autopf}\Emby Theater Enhanced
DefaultGroupName=Emby Theater Enhanced
UninstallDisplayIcon={app}\electronapp\icon.ico
SetupIconFile={#RuntimeDir}\electronapp\icon.ico
OutputDir={#OutputDir}
OutputBaseFilename=EmbyTheaterEnhanced-{#AppVersion}-win-x64-setup
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
PrivilegesRequired=admin
Compression=lzma2/normal
SolidCompression=yes
WizardStyle=modern
DisableProgramGroupPage=yes
CloseApplications=no
RestartApplications=no

[Tasks]
Name: "desktopicon"; Description: "Create a desktop shortcut"; Flags: unchecked

[Files]
Source: "{#RuntimeDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Emby Theater Enhanced"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\Start-Enhanced.ps1"""; WorkingDir: "{app}"; IconFilename: "{app}\electronapp\icon.ico"
Name: "{autodesktop}\Emby Theater Enhanced"; Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\Start-Enhanced.ps1"""; WorkingDir: "{app}"; IconFilename: "{app}\electronapp\icon.ico"; Tasks: desktopicon

[Run]
Filename: "{sys}\WindowsPowerShell\v1.0\powershell.exe"; Parameters: "-NoLogo -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File ""{app}\Start-Enhanced.ps1"""; Description: "Launch Emby Theater Enhanced"; Flags: nowait postinstall skipifsilent runasoriginaluser
