@echo off
cd /d "C:\Users\Aaronnjs\Desktop\SENA-Node-Server"

echo Añadiendo archivos...
git add .

echo Escribe un mensaje para el commit:
set /p mensaje=Mensaje: 
git commit -m "%mensaje%"

echo Haciendo push a GitHub...
git push origin master

pause
