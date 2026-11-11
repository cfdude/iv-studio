; IV Studio's installer in its own colours (electron-builder includes this file by name).
; The welcome and finish pages and the strip along the top of every page use the app's near-black and cream;
; the middle of each page is drawn by Windows and keeps its own colours. The artwork (installerSidebar.bmp,
; uninstallerSidebar.bmp, installerHeader.bmp) is made by build/installer-art.py from the app's eye art.

!define MUI_BGCOLOR "100C0E"
!define MUI_TEXTCOLOR "F4ECDC"

; A welcome page before the install choices, with the eye down the side.
!macro customWelcomePage
  !define MUI_WELCOMEPAGE_TITLE "Welcome to IV Studio"
  !define MUI_WELCOMEPAGE_TEXT "Make films with MiniMax H3 on your own computer or your own cloud: hunt a few takes, pick the one you like and finish it at full size.$\r$\n$\r$\nYour projects, renders and settings are kept when you update.$\r$\n$\r$\nClick Next to continue."
  !insertmacro MUI_PAGE_WELCOME
!macroend

; electron-builder's own finish page (its StartApp and "Run IV Studio"), plus one thing: Windows draws a themed
; checkbox's label in its own black, unreadable on the dark page. Taking the theme off that one checkbox lets it
; take the page's cream text on near-black.
!macro customFinishPage
  !ifndef HIDE_RUN_AFTER_FINISH
    Function StartApp
      ${if} ${isUpdated}
        StrCpy $1 "--updated"
      ${else}
        StrCpy $1 ""
      ${endif}
      ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "$1"
    FunctionEnd

    !define MUI_FINISHPAGE_RUN
    !define MUI_FINISHPAGE_RUN_FUNCTION "StartApp"
    !define MUI_PAGE_CUSTOMFUNCTION_SHOW ivFinishShow
  !endif
  !insertmacro MUI_PAGE_FINISH
  !ifndef HIDE_RUN_AFTER_FINISH
    ; after MUI_PAGE_FINISH, which declares $mui.FinishPage.Run
    Function ivFinishShow
      Push $0
      StrCpy $0 $mui.FinishPage.Run
      System::Call 'uxtheme::SetWindowTheme(p r0, w " ", w " ")'
      SetCtlColors $0 "${MUI_TEXTCOLOR}" "${MUI_BGCOLOR}"
      Pop $0
    FunctionEnd
  !endif
!macroend
