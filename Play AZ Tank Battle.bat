@echo off
setlocal
title AZ - Tank Battle
rem ============================================================
rem  Launches AZ - Tank Battle as a chromeless desktop window
rem  using Microsoft Edge (or Chrome) in --app mode.
rem ============================================================

set "DIR=%~dp0"
set "GAME=%DIR%index.html"

rem Use a dedicated profile dir so the app window opens clean & isolated
set "PROFILE=%LOCALAPPDATA%\AZTankBattle\profile"

set "EDGE1=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
set "EDGE2=%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe"
set "CHROME1=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
set "CHROME2=%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe"

set "BROWSER="
if exist "%EDGE1%"   set "BROWSER=%EDGE1%"
if not defined BROWSER if exist "%EDGE2%"   set "BROWSER=%EDGE2%"
if not defined BROWSER if exist "%CHROME1%" set "BROWSER=%CHROME1%"
if not defined BROWSER if exist "%CHROME2%" set "BROWSER=%CHROME2%"

if not defined BROWSER (
  echo Could not find Microsoft Edge or Google Chrome.
  echo Opening in your default browser instead...
  start "" "%GAME%"
  goto :eof
)

start "" "%BROWSER%" --app="file:///%GAME:\=/%" --user-data-dir="%PROFILE%" --window-size=1100,820 --no-first-run --disable-features=Translate,msEdgeWebView2 --autoplay-policy=no-user-gesture-required
endlocal
