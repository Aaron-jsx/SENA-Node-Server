@echo off
echo Iniciando despliegue a Render...

echo Guardando cambios en Git...
git add .
git commit -m "Actualizacion: Mejoras en la gestion de roles y funcionalidades de videollamada"
git push origin main

echo Esperando a que Render detecte los cambios (30 segundos)...
timeout /t 30

echo Verificando el estado del servidor...
curl https://sena-node-server.onrender.com/status

echo Despliegue completado. Verifica el estado del servidor en el panel de Render.
pause 