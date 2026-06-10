@echo off
rem Windows wrapper: see scripts/lsdbg for the bash equivalent.
setlocal
set "SCRIPT_DIR=%~dp0"
set "SKILL_DIR=%SCRIPT_DIR%.."
set "PYTHONPATH=%SKILL_DIR%\tools;%PYTHONPATH%"

if "%PYTHON%"=="" set "PYTHON=python"
"%PYTHON%" -m lsdbg %*
exit /b %ERRORLEVEL%
