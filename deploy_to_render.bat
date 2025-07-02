@echo off
echo ========================================
echo = Despliegue del servidor SENA a Render =
echo ========================================
echo.

cd /d "%~dp0"

echo Verificando cambios en el repositorio...
git status

echo.
echo Añadiendo archivos modificados...
git add .

echo.
echo Escribe un mensaje para el commit:
set /p mensaje=Mensaje: 
git commit -m "%mensaje%"

echo.
echo Haciendo push a GitHub...
git push origin master

echo.
echo ========================================
echo Los cambios han sido enviados a GitHub.
echo Render detectará automáticamente estos cambios y desplegará la nueva versión.
echo.
echo Puedes verificar el estado del despliegue en:
echo https://dashboard.render.com/
echo ========================================

pause 