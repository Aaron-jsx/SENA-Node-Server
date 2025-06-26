# Sistema de Notificaciones en Tiempo Real para SENA

Este documento explica cómo funciona el sistema de notificaciones en tiempo real implementado para la plataforma SENA.

## Arquitectura

El sistema utiliza Socket.IO para proporcionar notificaciones en tiempo real a los usuarios, aprovechando la misma conexión que se usa para las videollamadas. La arquitectura es la siguiente:

1. **Servidor Node.js en Render**: Alojado en https://sena-node-server.onrender.com, maneja tanto las conexiones de videollamadas como las notificaciones.

2. **Cliente Web en ByeHost**: La aplicación web se conecta al servidor Node.js para recibir actualizaciones en tiempo real.

## Tipos de Notificaciones

El sistema soporta varios tipos de notificaciones:

- **Notificaciones de asistencia**: Cuando un instructor marca asistencia para un aprendiz.
- **Notificaciones de anuncios**: Cuando se crea un nuevo anuncio relevante para el usuario.
- **Notificaciones directas**: Mensajes enviados directamente a un usuario específico.
- **Notificaciones broadcast**: Mensajes enviados a todos los usuarios en una sala (solo disponible para instructores).

## Cómo Enviar Notificaciones

### Desde el Cliente (JavaScript)

Para enviar una notificación a un usuario específico:

```javascript
// Enviar notificación a un usuario específico
sendNotificationToUser(userId, "Mensaje de notificación", "info");
```

Los tipos de notificaciones disponibles son:
- `info`: Notificación informativa (azul)
- `success`: Notificación de éxito (verde)
- `warning`: Notificación de advertencia (amarillo)
- `error`: Notificación de error (rojo)
- `important`: Notificación importante (morado)

Para enviar una notificación a todos los usuarios en una sala (solo instructores):

```javascript
// Enviar notificación a todos los usuarios en la sala
broadcastNotification("Mensaje para todos", "important");
```

### Desde el Servidor (Node.js)

El servidor puede enviar notificaciones a través de Socket.IO:

```javascript
// Enviar notificación a un usuario específico
io.to(socketId).emit('notification', {
    message: "Mensaje de notificación",
    type: "info",
    senderName: "Nombre del remitente"
});
```

## Cómo Recibir Notificaciones

Las notificaciones se muestran automáticamente en la interfaz de usuario. Los usuarios pueden activar o desactivar las notificaciones usando el botón con el icono de campana en la barra de control.

## Almacenamiento de Notificaciones

El servidor almacena temporalmente las notificaciones para usuarios que no están conectados. Cuando un usuario se conecta, recibe todas las notificaciones pendientes.

## Depuración

Para depurar el sistema de notificaciones, puedes revisar la consola del navegador donde verás mensajes detallados sobre las notificaciones recibidas y enviadas.

## Integración con Otras Funcionalidades

El sistema de notificaciones está integrado con:

1. **Sistema de Asistencia**: Notifica a los aprendices cuando se registra su asistencia.
2. **Sistema de Anuncios**: Notifica a los aprendices cuando hay nuevos anuncios.
3. **Videollamadas**: Notifica sobre eventos importantes durante las videollamadas.

## Consideraciones Técnicas

- El sistema utiliza la misma conexión Socket.IO que las videollamadas para evitar abrir múltiples conexiones.
- Las notificaciones tienen diferentes duraciones según su importancia.
- El sistema incluye efectos visuales y sonoros para llamar la atención del usuario. 