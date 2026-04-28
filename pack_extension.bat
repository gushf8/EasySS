@echo off
set VERSION=1.0.1
set FILENAME=EasySS-Image-Upload-v%VERSION%.zip

echo ============================================
echo   Empaquetador de EasySS Extension v%VERSION%
echo ============================================
echo.
echo Eliminando version anterior si existe...
if exist %FILENAME% del %FILENAME%

echo.
echo Comprimiendo archivos (Excluyendo .git y .zip)...
powershell -Command "Get-ChildItem -Path . -Exclude '.git', '*.zip', '*.bat' | Compress-Archive -DestinationPath ./%FILENAME% -Force"

if %ERRORLEVEL% EQU 0 (
    echo.
    echo --------------------------------------------
    echo   EXITO: %FILENAME% creado correctamente.
    echo --------------------------------------------
) else (
    echo.
    echo   ERROR: Hubo un problema al crear el ZIP.
)

echo.
pause
