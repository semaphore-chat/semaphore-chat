; Semaphore Chat native client: Windows installer (NSIS 3, Unicode).
;
; Built by native/scripts/package-windows.sh, which passes every input as a define and the
; output name as a full path:
;
;   makensis -WX \
;     -DVERSION=0.10.0 -DVERSION_QUAD=0.10.0.0 \
;     -DAPP_EXE=<built semaphore-app.exe> \
;     -DLICENCES=<THIRD-PARTY-LICENCES.txt> \
;     -DOUT_FILE=<.../Semaphore-Chat-Native-Setup-0.10.0-x64.exe> \
;     packaging/windows/installer.nsi
;
; What it does, matching frontend/electron-builder.yml's NSIS configuration:
;   - per-user install (RequestExecutionLevel user, no elevation), default
;     %LOCALAPPDATA%\Programs\Semaphore Chat, directory page to change it;
;   - Start menu and desktop shortcuts named "Semaphore Chat";
;   - semaphore:// registered in HKCU\Software\Classes with "%1", as the app's own
;     registration does (crates/semaphore-platform-desktop/src/links.rs);
;   - an Add/Remove Programs entry (display name, version, publisher, icon, uninstall and
;     quiet-uninstall strings, estimated size) under HKCU;
;   - an uninstaller that removes the files, shortcuts and registry values written here, and
;     leaves the user's data directory alone (Electron's default: deleteAppDataOnUninstall off);
;   - upgrades run the previous version's uninstaller silently first, and the running app is
;     closed (asked first when interactive, silently when /S).
;
; Everything is stock NSIS: no third-party plug-ins, so no extra licence terms. The script is
; checked mechanically by native/scripts/test-package-windows.sh.

!ifndef VERSION
  !error "VERSION is required (-DVERSION=0.10.0)"
!endif
!ifndef VERSION_QUAD
  !error "VERSION_QUAD is required, four numeric parts (-DVERSION_QUAD=0.10.0.0)"
!endif
!ifndef APP_EXE
  !error "APP_EXE is required (the built semaphore-app.exe)"
!endif
!ifndef LICENCES
  !error "LICENCES is required (THIRD-PARTY-LICENCES.txt)"
!endif
; Where makensis writes the installer. package-windows.sh passes a full path; on its own the
; script still derives the artifact name from VERSION, in the current directory.
!ifndef OUT_FILE
  !define OUT_FILE "Semaphore-Chat-Native-Setup-${VERSION}-x64.exe"
!endif
; Default: the repository's existing Windows icon, the one electron-builder uses for the
; Electron installer (frontend/build/icon.ico, copied here unchanged).
!ifndef ICON
  !define ICON "semaphore-chat.ico"
!endif

; ---- Identity -------------------------------------------------------------------------------

!define APP_NAME "Semaphore Chat"
; The native client's stable id (native/docs/packaging.md), used as the registry key name.
; Deliberately not the Electron app id (com.semaphorechat.app): both can be installed at once.
!define APP_ID "app.semaphorechat.semaphore"
!define APP_EXE_NAME "semaphore-app.exe"
!define UNINSTALLER_NAME "Uninstall Semaphore Chat.exe"
!define PUBLISHER "Semaphore Chat Team"
!define APP_DESCRIPTION "Self-hosted voice and text chat"

!define INSTALL_KEY "Software\${APP_ID}"
!define UNINSTALL_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\${APP_ID}"
!define PROTOCOL_BASE "Software\Classes\semaphore"
!define START_MENU_LINK "$SMPROGRAMS\${APP_NAME}.lnk"
!define DESKTOP_LINK "$DESKTOP\${APP_NAME}.lnk"
!define DEFAULT_INSTALL_DIR "$LOCALAPPDATA\Programs\${APP_NAME}"

; ---- Compiler settings ----------------------------------------------------------------------

!define MUI_ICON "${ICON}"
!define MUI_UNICON "${ICON}"
!define MUI_ABORTWARNING
!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE_NAME}"
!define MUI_FINISHPAGE_RUN_TEXT "Run ${APP_NAME}"

!include "MUI2.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"
!include "FileFunc.nsh"

Name "${APP_NAME}"
OutFile "${OUT_FILE}"
Unicode true
SetCompressor /SOLID lzma
RequestExecutionLevel user
BrandingText "${APP_NAME} ${VERSION}"
ShowInstDetails nevershow
ShowUninstDetails nevershow

VIProductVersion "${VERSION_QUAD}"
VIAddVersionKey /LANG=1033 "ProductName" "${APP_NAME}"
VIAddVersionKey /LANG=1033 "FileDescription" "${APP_NAME} installer"
VIAddVersionKey /LANG=1033 "FileVersion" "${VERSION}"
VIAddVersionKey /LANG=1033 "ProductVersion" "${VERSION}"
VIAddVersionKey /LANG=1033 "CompanyName" "${PUBLISHER}"
VIAddVersionKey /LANG=1033 "LegalCopyright" "Copyright (c) 2025 ${PUBLISHER}"

!ifndef BUILD_UNINSTALLER
  ; Per-user by default; a previous install's own directory wins (upgrade in place), and /D=
  ; still overrides both because NSIS applies it last.
  InstallDir "${DEFAULT_INSTALL_DIR}"
  InstallDirRegKey HKCU "${INSTALL_KEY}" "InstallLocation"
!endif

; ---- Pages ----------------------------------------------------------------------------------
; Electron's assisted installer (oneClick: false) shows the directory page, progress and a
; finish page with a "Run" checkbox; there is no licence page (electron-builder.yml comments
; the licence option out) and no all-users page here (per-user only, no elevation).

!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_WELCOME
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_UNPAGE_FINISH

!insertmacro MUI_LANGUAGE "English"

LangString AppRunning ${LANG_ENGLISH} "${APP_NAME} is running. Click OK to close it and continue, or Cancel to abort."
LangString AppClosing ${LANG_ENGLISH} "Closing ${APP_NAME}..."
LangString AppCannotBeClosed ${LANG_ENGLISH} "${APP_NAME} could not be closed. Close it yourself, then click Retry."
LangString PreviousFailed ${LANG_ENGLISH} "The previous version could not be removed (uninstaller exit code $0). Close ${APP_NAME} and run this installer again."

; ---- The running app ------------------------------------------------------------------------
; Electron's CHECK_APP_RUNNING asks before closing an interactive install and closes without
; asking in silent mode (/S). Only processes of the current user are matched, by image name;
; the stock plugins (nsExec + tasklist/taskkill) do what electron-builder does with nsProcess.

!macro AppIsRunning SUFFIX
  nsExec::Exec `"$SYSDIR\cmd.exe" /S /C ""$SYSDIR\tasklist.exe" /FI "USERNAME eq %USERNAME%" /FI "IMAGENAME eq ${APP_EXE_NAME}" /FO CSV /NH | "$SYSDIR\findstr.exe" /B /I /C:"\"${APP_EXE_NAME}\"""`
  Pop $R0
!macroend

!macro AppKill FORCE
  !if "${FORCE}" == "1"
    nsExec::Exec `"$SYSDIR\cmd.exe" /S /C ""$SYSDIR\taskkill.exe" /F /IM "${APP_EXE_NAME}" /FI "USERNAME eq %USERNAME%""`
  !else
    nsExec::Exec `"$SYSDIR\cmd.exe" /S /C ""$SYSDIR\taskkill.exe" /IM "${APP_EXE_NAME}" /FI "USERNAME eq %USERNAME%""`
  !endif
  Pop $R0
!macroend

!macro CheckAppRunning SUFFIX
  !insertmacro AppIsRunning ${SUFFIX}
  ${If} $R0 = 0
    ${IfNot} ${Silent}
      MessageBox MB_OKCANCEL|MB_ICONEXCLAMATION "$(AppRunning)" /SD IDOK IDOK close${SUFFIX}
      SetErrorLevel 2
      Quit
    ${EndIf}
    close${SUFFIX}:
    DetailPrint "$(AppClosing)"
    StrCpy $R1 0
    retry${SUFFIX}:
      IntOp $R1 $R1 + 1
      !insertmacro AppKill 0
      Sleep 500
      !insertmacro AppIsRunning ${SUFFIX}
      ${If} $R0 = 0
        ${If} $R1 >= 3
          !insertmacro AppKill 1
          Sleep 500
          !insertmacro AppIsRunning ${SUFFIX}
          ${If} $R0 = 0
            ${IfNot} ${Silent}
              MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(AppCannotBeClosed)" /SD IDCANCEL IDRETRY retry${SUFFIX}
            ${EndIf}
            SetErrorLevel 2
            Quit
          ${EndIf}
        ${Else}
          Goto retry${SUFFIX}
        ${EndIf}
      ${EndIf}
  ${EndIf}
!macroend

; ---- Install --------------------------------------------------------------------------------

Function .onInit
  ${IfNot} ${RunningX64}
    MessageBox MB_OK|MB_ICONSTOP "${APP_NAME} requires 64-bit Windows." /SD IDOK
    Abort
  ${EndIf}
  SetRegView 64
  SetShellVarContext current
FunctionEnd

Section "Install" INSTALL
  SectionIn RO

  !insertmacro CheckAppRunning inst

  ; An older native install: run its uninstaller silently first, as Electron's installer does
  ; (it copies the old uninstaller out of the install directory first because that directory is
  ; about to be deleted). A failed removal is reported instead of half-upgrading.
  ReadRegStr $R2 HKCU "${INSTALL_KEY}" "InstallLocation"
  ${If} $R2 != ""
  ${AndIf} ${FileExists} "$R2\${UNINSTALLER_NAME}"
    DetailPrint "Removing the previous version in $R2"
    InitPluginsDir
    CopyFiles /SILENT "$R2\${UNINSTALLER_NAME}" "$PLUGINSDIR\old-uninstaller.exe"
    ExecWait '"$PLUGINSDIR\old-uninstaller.exe" /S _?=$R2' $0
    ${If} ${Errors}
      MessageBox MB_OK|MB_ICONSTOP "$(PreviousFailed)" /SD IDOK
      Abort
    ${EndIf}
    ${If} $0 != 0
      MessageBox MB_OK|MB_ICONSTOP "$(PreviousFailed)" /SD IDOK
      Abort
    ${EndIf}
  ${EndIf}

  SetOutPath "$INSTDIR"
  File "/oname=${APP_EXE_NAME}" "${APP_EXE}"
  File "/oname=THIRD-PARTY-LICENCES.txt" "${LICENCES}"
  WriteUninstaller "$INSTDIR\${UNINSTALLER_NAME}"

  CreateShortCut "${START_MENU_LINK}" "$INSTDIR\${APP_EXE_NAME}" "" "$INSTDIR\${APP_EXE_NAME}" 0 "" "" "${APP_DESCRIPTION}"
  CreateShortCut "${DESKTOP_LINK}" "$INSTDIR\${APP_EXE_NAME}" "" "$INSTDIR\${APP_EXE_NAME}" 0 "" "" "${APP_DESCRIPTION}"

  ; semaphore://: the same values as links.rs::registry_values, so the app's own status check
  ; recognises this registration and leaves it alone.
  WriteRegStr HKCU "${PROTOCOL_BASE}" "" "URL:Semaphore"
  WriteRegStr HKCU "${PROTOCOL_BASE}" "URL Protocol" ""
  WriteRegStr HKCU "${PROTOCOL_BASE}\DefaultIcon" "" '"$INSTDIR\${APP_EXE_NAME}",0'
  WriteRegStr HKCU "${PROTOCOL_BASE}\shell\open\command" "" '"$INSTDIR\${APP_EXE_NAME}" "%1"'

  ; Add/Remove Programs. DisplayName carries the version, as electron-builder's default
  ; uninstallDisplayName ("${productName} ${version}") does.
  WriteRegStr HKCU "${INSTALL_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "${INSTALL_KEY}" "ShortcutName" "${APP_NAME}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayName" "${APP_NAME} ${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayVersion" "${VERSION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Publisher" "${PUBLISHER}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE_NAME},0"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "Comments" "${APP_DESCRIPTION}"
  WriteRegStr HKCU "${UNINSTALL_KEY}" "UninstallString" '"$INSTDIR\${UNINSTALLER_NAME}"'
  WriteRegStr HKCU "${UNINSTALL_KEY}" "QuietUninstallString" '"$INSTDIR\${UNINSTALLER_NAME}" /S'
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoModify" 1
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "NoRepair" 1
  ${GetSize} "$INSTDIR" "/S=0K" $0 $1 $2
  WriteRegDWORD HKCU "${UNINSTALL_KEY}" "EstimatedSize" $0
SectionEnd

; ---- Uninstall ------------------------------------------------------------------------------

Function un.onInit
  SetRegView 64
  SetShellVarContext current
  ; The install directory, as the installer recorded it. $EXEDIR is only a last resort (a
  ; hand-moved uninstaller); the section then removes only the files it knows by name.
  ReadRegStr $INSTDIR HKCU "${INSTALL_KEY}" "InstallLocation"
  ${If} $INSTDIR == ""
    StrCpy $INSTDIR "$EXEDIR"
    StrCpy $R9 0
  ${Else}
    StrCpy $R9 1
  ${EndIf}
FunctionEnd

Section "Uninstall"
  SectionIn RO

  !insertmacro CheckAppRunning un

  Delete "${DESKTOP_LINK}"
  Delete "${START_MENU_LINK}"

  ; Leave the scheme alone when another Semaphore Chat build (the Electron app, say) owns it.
  ReadRegStr $0 HKCU "${PROTOCOL_BASE}\shell\open\command" ""
  ${If} $0 == '"$INSTDIR\${APP_EXE_NAME}" "%1"'
    DeleteRegKey HKCU "${PROTOCOL_BASE}"
  ${EndIf}

  SetOutPath "$TEMP"
  ; Only the files this installer wrote, then the directory if that left it empty. Never a
  ; recursive delete: the directory page takes any path as-is, so the install directory can be
  ; one the user already kept other things in.
  Delete "$INSTDIR\${APP_EXE_NAME}"
  Delete "$INSTDIR\THIRD-PARTY-LICENCES.txt"
  Delete "$INSTDIR\${UNINSTALLER_NAME}"
  RMDir "$INSTDIR"

  ; The user's data directory (settings, session) is not touched: Electron's
  ; deleteAppDataOnUninstall defaults to false.
  DeleteRegKey HKCU "${UNINSTALL_KEY}"
  DeleteRegKey HKCU "${INSTALL_KEY}"
SectionEnd
