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
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000
});

const PORT = process.env.PORT || 10000;

// Configuración de CORS para Express
app.use((req, res, next) => {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept');
    next();
});

// Dentro de la definición de rooms, agregar polls para almacenar encuestas
const rooms = new Map();

// Mapa para almacenar notificaciones pendientes
const pendingNotifications = new Map();

// Función para generar un ID único para cada usuario
function generateUniqueUserId(userId, userRole) {
    // Combinar ID de usuario, rol y un timestamp para garantizar unicidad
    return `${userId}_${userRole}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

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

// Middleware de logging global
io.use((socket, next) => {
    logger.info('Socket middleware - Nueva conexión', { 
        socketId: socket.id,
        handshake: socket.handshake.query
    });
    next();
});

realTimeNamespace.use((socket, next) => {
    logger.info('RealTime namespace middleware - Nueva conexión', { 
        socketId: socket.id,
        handshake: socket.handshake.query
    });
    next();
});

io.on("connection", (socket) => {
    const { userId, userName, userRole, roomId } = socket.handshake.query;
    
    // Generar ID único para este usuario
    const uniqueUserId = generateUniqueUserId(userId, userRole);

    logger.info('Nueva conexión de socket principal', { 
        socketId: socket.id, 
        userId, 
        userName, 
        userRole, 
        roomId,
        uniqueUserId
    });

    // Unirse a una sala
    socket.on("join-room", ({ roomId, userId, userName, userRole }) => {
        logger.debug('Intento de unión a sala', { 
            socketId: socket.id, 
            roomId, 
            userId, 
            userName, 
            userRole 
        });

        // Crear la sala si no existe
        if (!rooms.has(roomId)) {
            rooms.set(roomId, {
                participants: new Map(),
                createdAt: new Date(),
                messages: [],
                polls: [],
                notifications: [],
                screenSharing: null
            });
            logger.info(`Sala ${roomId} creada`);
        }

        const room = rooms.get(roomId);
        
        // Verificar límite de participantes
        if (room.participants.size >= 20) {
            logger.warn(`Sala ${roomId} llena. No se permiten más participantes.`);
            socket.emit('room-full', { 
                message: 'La sala ya tiene el máximo de participantes permitidos' 
            });
            return;
        }

        // Unir socket a la sala
        socket.join(roomId);
        socket.roomId = roomId;

        // Agregar participante
        room.participants.set(socket.id, {
            userId,
            userName,
            userRole,
            joinedAt: new Date(),
            socketId: socket.id
        });

        logger.info(`Usuario unido a sala ${roomId}`, { 
            socketId: socket.id, 
            participantCount: room.participants.size
        });

        // Notificar a otros participantes
        socket.to(roomId).emit('user-joined', {
            userId,
            userName,
            userRole
        });

        // Enviar lista de usuarios actuales al nuevo participante
        const otherParticipants = Array.from(room.participants.values())
            .filter(p => p.socketId !== socket.id)
            .map(p => ({
                userId: p.userId,
                userName: p.userName,
                userRole: p.userRole
            }));
            
        socket.emit('room-users', otherParticipants);
    });

    // Manejar oferta WebRTC
    socket.on('offer', (data) => {
        logger.debug('Oferta recibida', { 
            from: socket.id, 
            to: data.to 
        });

        const room = rooms.get(socket.roomId);
        if (!room) {
            logger.warn('Sala no encontrada para oferta', { roomId: socket.roomId });
            return;
        }

        const sender = room.participants.get(socket.id);
        if (!sender) {
            logger.warn('Remitente no encontrado para oferta', { socketId: socket.id });
            return;
        }

        socket.to(data.to).emit('offer', {
            offer: data.offer,
            from: sender.userId,
            userName: sender.userName,
            userRole: sender.userRole
        });
    });

    // Manejar respuesta WebRTC
    socket.on('answer', (data) => {
        logger.debug('Respuesta recibida', { 
            from: socket.id, 
            to: data.to 
        });

        const room = rooms.get(socket.roomId);
        if (!room) {
            logger.warn('Sala no encontrada para respuesta', { roomId: socket.roomId });
            return;
        }

        const sender = room.participants.get(socket.id);
        if (!sender) {
            logger.warn('Remitente no encontrado para respuesta', { socketId: socket.id });
            return;
        }

        socket.to(data.to).emit('answer', {
            answer: data.answer,
            from: sender.userId
        });
    });

    // Manejar candidato ICE
    socket.on('ice-candidate', (data) => {
        logger.debug('Candidato ICE recibido', { 
            from: socket.id, 
            to: data.to 
        });

        const room = rooms.get(socket.roomId);
        if (!room) {
            logger.warn('Sala no encontrada para candidato ICE', { roomId: socket.roomId });
            return;
        }

        const sender = room.participants.get(socket.id);
        if (!sender) {
            logger.warn('Remitente no encontrado para candidato ICE', { socketId: socket.id });
            return;
        }

        socket.to(data.to).emit('ice-candidate', {
            candidate: data.candidate,
            from: sender.userId
        });
    });

    // Manejar desconexión
    socket.on('disconnect', () => {
        logger.info('Usuario desconectado', { socketId: socket.id });

        const room = rooms.get(socket.roomId);
        if (room) {
            const participant = room.participants.get(socket.id);
            if (participant) {
                room.participants.delete(socket.id);
                
                socket.to(socket.roomId).emit('user-left', {
                    userId: participant.userId
                });

                logger.info(`Usuario removido de sala ${socket.roomId}`, {
                    socketId: socket.id,
                    remainingParticipants: room.participants.size
                });

                // Eliminar sala si está vacía
                if (room.participants.size === 0) {
                    rooms.delete(socket.roomId);
                    logger.info(`Sala ${socket.roomId} eliminada`);
                }
            }
        }
    });

    // Manejar mensajes de chat
    socket.on('chat-message', (data) => {
        logger.debug('Mensaje de chat recibido', { 
            from: socket.id, 
            roomId: socket.roomId 
        });

        const room = rooms.get(socket.roomId);
        if (!room) {
            logger.warn('Sala no encontrada para mensaje de chat', { roomId: socket.roomId });
            return;
        }

        const sender = room.participants.get(socket.id);
        if (!sender) {
            logger.warn('Remitente no encontrado para mensaje de chat', { socketId: socket.id });
            return;
        }

        const message = {
            userId: sender.userId,
            userName: sender.userName,
            message: data.message,
            timestamp: new Date()
        };

        room.messages.push(message);
        
        socket.to(socket.roomId).emit('chat-message', message);
    });

    // Control de audio/video
    socket.on('toggle-audio', (isEnabled) => {
        const room = rooms.get(socket.roomId);
        if (!room) return;

        const participant = room.participants.get(socket.id);
        if (participant) {
            participant.isAudioEnabled = isEnabled;
            io.to(socket.roomId).emit('participant-audio-changed', {
                participantId: socket.id,
                isEnabled
            });
        }
    });
    
    socket.on('toggle-video', (isEnabled) => {
        const room = rooms.get(socket.roomId);
        if (!room) return;
        
        const participant = room.participants.get(socket.id);
        if (participant) {
            participant.isVideoEnabled = isEnabled;
            io.to(socket.roomId).emit('participant-video-changed', {
                participantId: socket.id,
                isEnabled
            });
        }
    });
    
    // Levantar la mano
    socket.on('raise-hand', (isRaised) => {
        const room = rooms.get(socket.roomId);
        if (!room) return;

        const participant = room.participants.get(socket.id);
        if (participant) {
            participant.raisedHand = isRaised;
            io.to(socket.roomId).emit('hand-raised', {
                participantId: socket.id,
                userName: participant.userName,
                isRaised
            });
        }
    });

    // Agregar eventos para compartir pantalla
    socket.on('screen-sharing-started', () => {
        const room = rooms.get(socket.roomId);
        if (!room) return;

        const participant = room.participants.get(socket.id);
        if (participant) {
            participant.isScreenSharing = true;
            io.to(socket.roomId).emit('participant-screen-sharing', {
                participantId: socket.id,
                userId: participant.userId,
                userName: participant.userName,
                isSharing: true
            });
            logger.info(`Usuario ${participant.userName} comenzó a compartir pantalla en la sala ${socket.roomId}`);

            // Guardar información de quién está compartiendo pantalla
            room.screenSharing = {
                userId: participant.uniqueUserId || participant.userId,
                userName: participant.userName,
                socketId: socket.id
            };
        }
    });

    socket.on('screen-sharing-stopped', () => {
        const room = rooms.get(socket.roomId);
        if (!room) return;

        const participant = room.participants.get(socket.id);
        if (participant) {
            participant.isScreenSharing = false;
            io.to(socket.roomId).emit('participant-screen-sharing', {
                participantId: socket.id,
                userId: participant.userId,
                userName: participant.userName,
                isSharing: false
            });
            logger.info(`Usuario ${participant.userName} dejó de compartir pantalla en la sala ${socket.roomId}`);

            // Verificar si este usuario es quien estaba compartiendo pantalla
            if (room.screenSharing && room.screenSharing.socketId === socket.id) {
                logger.info(`Usuario ${participant.userName} detuvo compartir pantalla en sala ${socket.roomId}`);
                
                // Limpiar información de compartir pantalla
                room.screenSharing = null;
            }
        }
    });

    // Eventos para manejar encuestas
    socket.on('create-poll', (pollData) => {
        const room = rooms.get(socket.roomId);
        if (!room) return;

        const participant = room.participants.get(socket.id);
        if (!participant) return;

        // Solo los instructores pueden crear encuestas
        if (participant.userRole !== 'instructor') {
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
        logger.info(`Encuesta creada por ${participant.userName} en sala ${socket.roomId}: ${poll.question}`);
        
        // Notificar a todos los participantes
        io.to(socket.roomId).emit('poll-created', poll);
    });

    socket.on('get-active-polls', () => {
        const room = rooms.get(socket.roomId);
        if (!room) return;

        // Filtrar encuestas activas
        const activePolls = room.polls.filter(poll => poll.active);
        
        // Enviar encuestas activas al solicitante
        socket.emit('active-polls', activePolls);
    });

    socket.on('vote-poll', ({ pollId, optionIndex }) => {
        const room = rooms.get(socket.roomId);
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
        io.to(socket.roomId).emit('poll-updated', poll);
    });

    socket.on('close-poll', ({ pollId }) => {
        const room = rooms.get(socket.roomId);
        if (!room) return;

        const participant = room.participants.get(socket.id);
        if (!participant) return;

        // Solo los instructores pueden cerrar encuestas
        if (participant.userRole !== 'instructor') {
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
        io.to(socket.roomId).emit('poll-closed', { pollId });
    });

    socket.on('get-chat-history', () => {
        const room = rooms.get(socket.roomId);
        if (!room) return;

        // Enviar los últimos 50 mensajes
        const recentMessages = room.messages.slice(-50);
        socket.emit('chat-history', recentMessages);
    });

    // Eventos para notificaciones en tiempo real
    socket.on('send-notification', ({ userId, notification }) => {
        const room = rooms.get(socket.roomId);
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
        const room = rooms.get(socket.roomId);
        if (!room) return;

        const participant = room.participants.get(socket.id);
        if (!participant) return;

        // Solo los instructores pueden enviar notificaciones broadcast
        if (participant.userRole !== 'instructor') {
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
        io.to(socket.roomId).emit('notification', notificationData);
    });
});

// Eventos para el namespace de tiempo real
realTimeNamespace.on('connection', (socket) => {
    const { userId, userName, userRole, salaId } = socket.handshake.query;

    logger.info('Nueva conexión en namespace de tiempo real', { 
        socketId: socket.id, 
        userId, 
        userName, 
        userRole, 
        salaId 
    });

    // Manejar errores de conexión
    socket.on('connect_error', (error) => {
        logger.error('Error de conexión en namespace de tiempo real', { 
            socketId: socket.id,
            error: error.message 
        });
    });

    // Unirse a la sala específica
    if (salaId) {
        socket.join(salaId);
        logger.info(`Socket ${socket.id} unido a sala ${salaId}`);
    }

    // Manejar eventos de tiempo real
    socket.on('join-room', (roomData) => {
        const { salaId, userId, userName, userRole } = roomData;
        
        logger.debug('Unión a sala de tiempo real', { 
            socketId: socket.id, 
            salaId, 
            userId, 
            userName, 
            userRole 
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
                status: 'presente',
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
    socket.on('disconnect', (reason) => {
        logger.info('Desconexión en namespace de tiempo real', { 
            socketId: socket.id,
            reason 
        });
    });
});

// Ruta de prueba para verificar el servidor
app.get('/health', (req, res) => {
    res.status(200).json({ 
        status: 'OK', 
        message: 'Servidor de tiempo real funcionando correctamente' 
    });
});

// Ruta simple para verificar que el servidor está funcionando
app.get('/', (req, res) => {
    res.send({
        status: 'ok',
        message: 'Servidor de señalización SENA funcionando correctamente',
        version: '1.0.0',
        timestamp: new Date().toISOString()
    });
});

// Ruta para verificar estado
app.get('/status', (req, res) => {
    res.send({
        status: 'ok',
        rooms: Array.from(rooms.keys()),
        connections: io.engine.clientsCount,
        uptime: process.uptime(),
        timestamp: new Date().toISOString()
    });
});

// Iniciar el servidor
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor de videollamadas iniciado en el puerto ${PORT}`);
    console.log(`Escuchando en todas las interfaces de red`);
});

