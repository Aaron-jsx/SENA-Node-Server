# Proyecto L.A. (Plataforma Educativa)

Esta es una plataforma educativa para instructores y aprendices del SENA.

## Cómo Ejecutar el Proyecto

Este proyecto tiene dos partes que deben ejecutarse simultáneamente: el **servidor web (Apache)** y el **servidor de señalización (Node.js)**.

### 1. Servidor Web (XAMPP / Apache)

1.  Asegúrate de que tus servicios de **Apache** y **MySQL** estén corriendo en XAMPP.
2.  Coloca la carpeta del proyecto (`SENA/`) dentro de tu directorio `htdocs`.
3.  Accede a la aplicación desde tu navegador, normalmente en `http://localhost/SENA/`.

### 2. Servidor de Señalización para Videollamadas (Node.js)

El sistema de videollamadas necesita un servidor especial para funcionar. **Este servidor DEBE estar ejecutándose para que las llamadas se conecten.**

1.  Abre una **nueva terminal** en la raíz del proyecto (la carpeta `SENA/`).
2.  **La primera vez**, o si hay nuevas dependencias, ejecuta este comando para instalar todo lo necesario:
    ```bash
    npm install
    ```
3.  Para **iniciar el servidor**, ejecuta el siguiente comando. Deberás dejar esta terminal abierta mientras uses la función de videollamadas.
    ```bash
    npm start
    ```
4.  Si todo va bien, verás el mensaje: `Servidor de señalización escuchando en el puerto 3000`.

**Si las videollamadas se quedan en "Conectando...", es 100% seguro que el servidor de señalización no se ha iniciado.** 