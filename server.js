const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const winston = require('winston');

const app = express();
const server = http.createServer(app);
const io = new socketIo.Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket'],
    pingTimeout: 60000,
    pingInterval: 25000
});

const PORT = process.env.PORT || 10000;

server.listen(PORT, () => {
    console.log(`Servidor de señalización iniciado en el puerto ${PORT}`);
    console.log(`URL del servidor: http://localhost:${PORT}`);
});

// Dentro de la definición de rooms, agregar polls para almacenar encuestas
const rooms = new Map();

// Mapa para almacenar notificaciones pendientes
const pendingNotifications = new Map();

// Configuración de logs más detallada
const logger = winston.createLogger({
    level: 'debug',
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.printf(({ timestamp, level, message, ...metadata }) => {
            let msg = `${timestamp} [${level}]: ${message} `;
            if (Object.keys(metadata).length > 0) {
                msg += JSON.stringify(metadata);
            }
            return msg;
        })
    ),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({ filename: 'server.log' })
    ]
});

// Crear namespace para actualizaciones en tiempo real
const realTimeNamespace = io.of('/realtime');

io.on("connection", (socket) => {
    const { userId, userName, userType, room } = socket.handshake.query;

    logger.info('Nueva conexión de socket', { 
        socketId: socket.id, 
        userId, 
        userName, 
        userType, 
        room 
    });

    // Unirse a una sala
    socket.on("join-room", ({ salaId, userId, userName, userType }) => {
        logger.debug('Intento de unión a sala', { 
            socketId: socket.id, 
            salaId, 
            userId, 
            userName, 
            userType 
        });

        // Crear la sala si no existe
        if (!rooms.has(salaId)) {
            rooms.set(salaId, {
                participants: new Map(),
                createdAt: new Date(),
                messages: [],
                polls: [],
                notifications: []
            });
            logger.info(`Sala ${salaId} creada`);
        }

        const room = rooms.get(salaId);
        
        // Verificar límite de participantes
        if (room.participants.size >= 2) {
            logger.warn(`Sala ${salaId} llena. No se permiten más participantes.`);
            socket.emit('room-full', { 
                message: 'La sala ya tiene el máximo de participantes permitidos' 
            });
            return;
        }

        // Verificar usuarios duplicados
        const isDuplicateUser = Array.from(room.participants.values()).some(
            participant => 
                participant.userId === userId || 
                participant.userName === userName
        );

        if (isDuplicateUser) {
            logger.warn(`Intento de unión con usuario duplicado en sala ${salaId}`);
            socket.emit('room-error', { 
                message: 'No puedes unirte a la misma sala dos veces' 
            });
            return;
        }

        // Agregar participante
        room.participants.set(socket.id, {
            userId,
            userName,
            userType,
            joinedAt: new Date(),
            socketId: socket.id
        });

        // Unir socket a la sala
        socket.join(salaId);
        socket.salaId = salaId;

        logger.info(`Usuario unido a sala ${salaId}`, { 
            socketId: socket.id, 
            participantCount: room.participants.size 
        });

        // Enviar lista de participantes existentes
        const existingParticipants = Array.from(room.participants.entries())
            .filter(([id]) => id !== socket.id)
            .map(([id, info]) => ({
                socketId: id,
                ...info
            }));

        socket.emit('existing-participants', existingParticipants);

        // Notificar a otros participantes
        socket.to(salaId).emit('user-joined', {
            socketId: socket.id,
            userId,
            userName,
            userType
        });

        // Enviar notificaciones pendientes para este usuario
        if (pendingNotifications.has(userId)) {
            const notifications = pendingNotifications.get(userId);
            notifications.forEach(notification => {
                socket.emit('notification', notification);
            });
            pendingNotifications.delete(userId);
        }

        logger.info(`Participantes actuales en la sala ${salaId}: ${room.participants.size}`);
    });

    // Manejo de señalización WebRTC
    socket.on('sending-signal', payload => {
        const room = rooms.get(socket.salaId);
        if (!room) {
            logger.error(`Error: Usuario ${socket.id} intentó enviar señal pero no está en una sala válida`);
            return;
        }

        const participant = room.participants.get(socket.id);
        if (!participant) {
            logger.error(`Error: No se encontró información del participante ${socket.id}`);
            return;
        }
        
        logger.info(`Señal enviada de ${participant.userName} a ${payload.userToSignal}`);

        io.to(payload.userToSignal).emit('user-joined-with-signal', {
            signal: payload.signal, 
            callerId: socket.id,
            callerInfo: {
                userId: participant.userId,
                userName: participant.userName,
                userType: participant.userType
            }
        });
    });

    socket.on('returning-signal', payload => {
        const room = rooms.get(socket.salaId);
        if (!room) {
            logger.error(`Error: Usuario ${socket.id} intentó devolver señal pero no está en una sala válida`);
            return;
        }
        
        const participant = room.participants.get(socket.id);
        if (!participant) {
            logger.error(`Error: No se encontró información del participante ${socket.id}`);
            return;
        }
        
        logger.info(`Señal devuelta de ${participant.userName} a ${payload.callerId}`);

        io.to(payload.callerId).emit('receiving-returned-signal', {
            signal: payload.signal,
            id: socket.id,
            userInfo: {
                userId: participant.userId,
                userName: participant.userName,
                userType: participant.userType
            }
        });
    });
    
    // Chat en tiempo real
    socket.on('send-chat-message', message => {
        const room = rooms.get(socket.salaId);
        if (!room) return;

        const participant = room.participants.get(socket.id);
        if (!participant) return;

        const messageData = {
            id: Date.now(),
            text: message.text,
            sender: participant.userName,
            senderId: socket.id, 
            userId: participant.userId,
            timestamp: new Date().toISOString()
        };
        
        room.messages.push(messageData);
        logger.info(`Mensaje de chat de ${participant.userName} en sala ${socket.salaId}: ${message.text}`);
        
        // Enviar a todos los participantes de la sala
        io.to(socket.salaId).emit('chat-message', messageData);
    });

    // Control de audio/video
    socket.on('toggle-audio', (isEnabled) => {
        const room = rooms.get(socket.salaId);
        if (!room) return;

        const participant = room.participants.get(socket.id);
        if (participant) {
            participant.isAudioEnabled = isEnabled;
            io.to(socket.salaId).emit('participant-audio-changed', {
                participantId: socket.id,
                isEnabled
            });
        }
    });
    
    socket.on('toggle-video', (isEnabled) => {
        const room = rooms.get(socket.salaId);
        if (!room) return;
        
        const participant = room.participants.get(socket.id);
        if (participant) {
            participant.isVideoEnabled = isEnabled;
            io.to(socket.salaId).emit('participant-video-changed', {
                participantId: socket.id,
                isEnabled
            });
        }
    });
    
    // Levantar la mano
    socket.on('raise-hand', (isRaised) => {
        const room = rooms.get(socket.salaId);
        if (!room) return;

        const participant = room.participants.get(socket.id);
        if (participant) {
            participant.raisedHand = isRaised;
            io.to(socket.salaId).emit('hand-raised', {
                participantId: socket.id,
                userName: participant.userName,
                isRaised
            });
        }
    });

    // Agregar eventos para compartir pantalla
    socket.on('screen-sharing-started', () => {
        const room = rooms.get(socket.salaId);
        if (!room) return;

        const participant = room.participants.get(socket.id);
        if (participant) {
            participant.isScreenSharing = true;
            io.to(socket.salaId).emit('participant-screen-sharing', {
                participantId: socket.id,
                userId: participant.userId,
                userName: participant.userName,
                isSharing: true
            });
            logger.info(`Usuario ${participant.userName} comenzó a compartir pantalla en la sala ${socket.salaId}`);
        }
    });

    socket.on('screen-sharing-stopped', () => {
        const room = rooms.get(socket.salaId);
        if (!room) return;

        const participant = room.participants.get(socket.id);
        if (participant) {
            participant.isScreenSharing = false;
            io.to(socket.salaId).emit('participant-screen-sharing', {
                participantId: socket.id,
                userId: participant.userId,
                userName: participant.userName,
                isSharing: false
            });
            logger.info(`Usuario ${participant.userName} dejó de compartir pantalla en la sala ${socket.salaId}`);
        }
    });

    // Eventos para manejar encuestas
    socket.on('create-poll', (pollData) => {
        const room = rooms.get(socket.salaId);
        if (!room) return;

        const participant = room.participants.get(socket.id);
        if (!participant) return;

        // Solo los instructores pueden crear encuestas
        if (participant.userType !== 'instructor') {
            logger.warn(`Usuario ${participant.userName} intentó crear una encuesta sin ser instructor`);
            return;
        }
        
        // Agregar información adicional a la encuesta
        const poll = {
            ...pollData,
            createdAt: new Date(),
            active: true,
            voters: []
        };

        // Guardar la encuesta en la sala
        room.polls.push(poll);
        logger.info(`Encuesta creada por ${participant.userName} en sala ${socket.salaId}: ${poll.question}`);
        
        // Notificar a todos los participantes
        io.to(socket.salaId).emit('poll-created', poll);
    });

    socket.on('get-active-polls', () => {
        const room = rooms.get(socket.salaId);
        if (!room) return;

        // Filtrar encuestas activas
        const activePolls = room.polls.filter(poll => poll.active);
        
        // Enviar encuestas activas al solicitante
        socket.emit('active-polls', activePolls);
    });

    socket.on('vote-poll', ({ pollId, optionIndex }) => {
        const room = rooms.get(socket.salaId);
        if (!room) return;

        const participant = room.participants.get(socket.id);
        if (!participant) return;

        // Buscar la encuesta
        const pollIndex = room.polls.findIndex(poll => poll.id === pollId);
        if (pollIndex === -1) return;

        const poll = room.polls[pollIndex];
        
        // Verificar si el usuario ya votó
        if (poll.voters.includes(participant.userId)) {
            logger.warn(`Usuario ${participant.userName} intentó votar más de una vez en la encuesta ${pollId}`);
            return;
        }

        // Verificar si la opción es válida
        if (optionIndex < 0 || optionIndex >= poll.options.length) {
            logger.warn(`Usuario ${participant.userName} intentó votar por una opción inválida en la encuesta ${pollId}`);
            return;
        }
        
        // Registrar voto
        poll.results[optionIndex]++;
        poll.voters.push(participant.userId);
        
        logger.info(`Usuario ${participant.userName} votó en la encuesta ${pollId}, opción: ${poll.options[optionIndex]}`);

        // Actualizar la encuesta en la sala
        room.polls[pollIndex] = poll;
        
        // Notificar a todos los participantes
        io.to(socket.salaId).emit('poll-updated', poll);
    });

    socket.on('close-poll', ({ pollId }) => {
        const room = rooms.get(socket.salaId);
        if (!room) return;

        const participant = room.participants.get(socket.id);
        if (!participant) return;

        // Solo los instructores pueden cerrar encuestas
        if (participant.userType !== 'instructor') {
            logger.warn(`Usuario ${participant.userName} intentó cerrar una encuesta sin ser instructor`);
            return;
        }
        
        // Buscar la encuesta
        const pollIndex = room.polls.findIndex(poll => poll.id === pollId);
        if (pollIndex === -1) return;

        // Marcar como inactiva
        room.polls[pollIndex].active = false;
        
        logger.info(`Encuesta ${pollId} cerrada por ${participant.userName}`);
        
        // Notificar a todos los participantes
        io.to(socket.salaId).emit('poll-closed', { pollId });
    });

    socket.on('get-chat-history', () => {
        const room = rooms.get(socket.salaId);
        if (!room) return;

        // Enviar los últimos 50 mensajes
        const recentMessages = room.messages.slice(-50);
        socket.emit('chat-history', recentMessages);
    });

    // Eventos para notificaciones en tiempo real
    socket.on('send-notification', ({ userId, notification }) => {
        const room = rooms.get(socket.salaId);
        if (!room) return;

        const participant = room.participants.get(socket.id);
        if (!participant) return;

        // Verificar si el usuario al que se envía la notificación está en la sala
        let targetSocketId = null;
        for (const [id, info] of room.participants.entries()) {
            if (info.userId === userId) {
                targetSocketId = id;
                break;
            }
        }

        // Guardar la notificación en la sala
        const notificationData = {
            id: Date.now(),
            senderId: participant.userId,
            senderName: participant.userName,
            message: notification.message,
            type: notification.type || 'info',
            timestamp: new Date().toISOString()
        };

        room.notifications.push(notificationData);

        // Enviar notificación al usuario específico si está en la sala
        if (targetSocketId) {
            io.to(targetSocketId).emit('notification', notificationData);
        } else {
            // Si el usuario no está en la sala, almacenar la notificación para enviarla cuando se conecte
            if (!pendingNotifications.has(userId)) {
                pendingNotifications.set(userId, []);
            }
            pendingNotifications.get(userId).push(notificationData);
        }
    });

    socket.on('broadcast-notification', ({ notification }) => {
        const room = rooms.get(socket.salaId);
        if (!room) return;

        const participant = room.participants.get(socket.id);
        if (!participant) return;

        // Solo los instructores pueden enviar notificaciones broadcast
        if (participant.userType !== 'instructor') {
            logger.warn(`Usuario ${participant.userName} intentó enviar una notificación broadcast sin ser instructor`);
            return;
        }

        // Crear la notificación
        const notificationData = {
            id: Date.now(),
            senderId: participant.userId,
            senderName: participant.userName,
            message: notification.message,
            type: notification.type || 'info',
            timestamp: new Date().toISOString()
        };

        room.notifications.push(notificationData);

        // Enviar a todos los participantes de la sala
        io.to(socket.salaId).emit('notification', notificationData);
    });

    // Manejo de desconexión
    socket.on('disconnect', () => {
        const salaId = socket.salaId;
        
        if (salaId && rooms.has(salaId)) {
            const room = rooms.get(salaId);
            room.participants.delete(socket.id);

            logger.info(`Usuario desconectado de sala ${salaId}`, { 
                socketId: socket.id,
                participantCount: room.participants.size 
            });

            // Notificar a otros participantes
            socket.to(salaId).emit('user-left', { 
                socketId: socket.id 
            });

            // Limpiar sala si no hay participantes
            if (room.participants.size === 0) {
                rooms.delete(salaId);
                logger.info(`Sala ${salaId} eliminada por falta de participantes`);
            }
        }
    });
});

// Iniciar el servidor
server.listen(PORT, () => {
    console.log(`Servidor de videollamadas iniciado en el puerto ${PORT}`);
});

realTimeNamespace.on('connection', (socket) => {
    const { userId, userName, userType, salaId } = socket.handshake.query;

    logger.info('Nueva conexión en namespace de tiempo real', { 
        socketId: socket.id, 
        userId, 
        userName, 
        userType, 
        salaId 
    });

    // Unirse a la sala de tiempo real
    socket.join(salaId);

    // Manejar eventos de tiempo real
    socket.on('join-room', ({ salaId, userId, userName, userType }) => {
        logger.debug('Unión a sala de tiempo real', { 
            socketId: socket.id, 
            salaId, 
            userId, 
            userName, 
            userType 
        });

        // Verificar si la sala existe
        if (!rooms.has(salaId)) {
            logger.warn(`Sala de tiempo real no encontrada: ${salaId}`);
            socket.emit('room-error', { 
                message: 'Sala no encontrada' 
            });
            return;
        }

        // Emitir eventos de actualización
        socket.on('request-attendance-update', () => {
            logger.info(`Solicitando actualización de asistencia para sala ${salaId}`);
            realTimeNamespace.to(salaId).emit('attendance-update', {
                userId,
                userName,
                status: 'presente', // Lógica de asistencia aquí
                timestamp: new Date()
            });
        });

        socket.on('send-announcement', (announcementData) => {
            logger.info(`Nuevo anuncio en sala ${salaId}`, announcementData);
            realTimeNamespace.to(salaId).emit('announcement-update', {
                ...announcementData,
                sender: { userId, userName },
                timestamp: new Date()
            });
        });
    });

    // Manejar desconexión
    socket.on('disconnect', () => {
        logger.info('Desconexión en namespace de tiempo real', { 
            socketId: socket.id 
        });
    });
}); 