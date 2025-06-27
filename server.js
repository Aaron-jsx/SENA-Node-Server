const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

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

io.on("connection", (socket) => {
    console.log(`Nueva conexión establecida: ${socket.id}`);

    // Unirse a una sala
    socket.on("join-room", ({ salaId, userId, userName, userType }) => {
        console.log(`Usuario ${userName} (${userType}) está uniéndose a la sala ${salaId}`);

        // Crear la sala si no existe
        if (!rooms.has(salaId)) {
            rooms.set(salaId, {
                participants: new Map(),
                createdAt: new Date(),
                messages: [],
                polls: [],
                notifications: []
            });
        }

        const room = rooms.get(salaId);
        
        // Verificar si ya hay usuarios en la sala
        const existingParticipants = Array.from(room.participants.values());
        
        // Verificación más estricta de usuarios diferentes
        const isDifferentUser = existingParticipants.length === 0 || 
            existingParticipants.every(p => 
                p.userId !== userId && 
                p.userName !== userName
            );

        // Si no son usuarios diferentes, no permitir la conexión
        if (!isDifferentUser) {
            socket.emit('room-error', { 
                message: 'No puedes unirte a la misma sala dos veces o con un usuario repetido' 
            });
            return;
        }

        // Limitar a máximo 2 participantes
        if (existingParticipants.length >= 2) {
            socket.emit('room-full', { message: 'La sala ya está llena' });
            return;
        }
        
        // Agregar participante a la sala
        room.participants.set(socket.id, {
            userId,
            userName,
            userType,
            joinedAt: new Date(),
            raisedHand: false,
            isAudioEnabled: true,
            isVideoEnabled: true
        });

        // Unir el socket a la sala
        socket.join(salaId);
        socket.salaId = salaId;

        // Enviar lista de participantes existentes al nuevo usuario
        const participantsInfo = Array.from(room.participants.entries())
            .filter(([id]) => id !== socket.id)
            .map(([id, info]) => ({
                id,
                ...info
            }));

        socket.emit('existing-participants', participantsInfo);

        // Notificar a otros participantes sobre el nuevo usuario
        socket.to(salaId).emit('user-joined', {
            id: socket.id,
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

        console.log(`Usuario ${userName} se unió exitosamente a la sala ${salaId}`);
        console.log(`Participantes actuales en la sala ${salaId}: ${room.participants.size}`);
    });

    // Manejo de señalización WebRTC
    socket.on('sending-signal', payload => {
        const room = rooms.get(socket.salaId);
        if (!room) {
            console.error(`Error: Usuario ${socket.id} intentó enviar señal pero no está en una sala válida`);
            return;
        }

        const participant = room.participants.get(socket.id);
        if (!participant) {
            console.error(`Error: No se encontró información del participante ${socket.id}`);
            return;
        }
        
        console.log(`Señal enviada de ${participant.userName} a ${payload.userToSignal}`);

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
            console.error(`Error: Usuario ${socket.id} intentó devolver señal pero no está en una sala válida`);
            return;
        }
        
        const participant = room.participants.get(socket.id);
        if (!participant) {
            console.error(`Error: No se encontró información del participante ${socket.id}`);
            return;
        }
        
        console.log(`Señal devuelta de ${participant.userName} a ${payload.callerId}`);

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
        console.log(`Mensaje de chat de ${participant.userName} en sala ${socket.salaId}: ${message.text}`);
        
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
            console.log(`Usuario ${participant.userName} comenzó a compartir pantalla en la sala ${socket.salaId}`);
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
            console.log(`Usuario ${participant.userName} dejó de compartir pantalla en la sala ${socket.salaId}`);
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
            console.log(`Usuario ${participant.userName} intentó crear una encuesta sin ser instructor`);
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
        console.log(`Encuesta creada por ${participant.userName} en sala ${socket.salaId}: ${poll.question}`);
        
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
            console.log(`Usuario ${participant.userName} intentó votar más de una vez en la encuesta ${pollId}`);
            return;
        }

        // Verificar si la opción es válida
        if (optionIndex < 0 || optionIndex >= poll.options.length) {
            console.log(`Usuario ${participant.userName} intentó votar por una opción inválida en la encuesta ${pollId}`);
            return;
        }
        
        // Registrar voto
        poll.results[optionIndex]++;
        poll.voters.push(participant.userId);
        
        console.log(`Usuario ${participant.userName} votó en la encuesta ${pollId}, opción: ${poll.options[optionIndex]}`);

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
            console.log(`Usuario ${participant.userName} intentó cerrar una encuesta sin ser instructor`);
            return;
        }
        
        // Buscar la encuesta
        const pollIndex = room.polls.findIndex(poll => poll.id === pollId);
        if (pollIndex === -1) return;

        // Marcar como inactiva
        room.polls[pollIndex].active = false;
        
        console.log(`Encuesta ${pollId} cerrada por ${participant.userName}`);
        
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
            console.log(`Usuario ${participant.userName} intentó enviar una notificación broadcast sin ser instructor`);
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
        if (!salaId) return;
        
        const room = rooms.get(salaId);
        if (!room) return;

        const participant = room.participants.get(socket.id);
        if (participant) {
            console.log(`Usuario ${participant.userName} se desconectó de la sala ${salaId}`);
            room.participants.delete(socket.id);

            // Notificar a otros participantes
            io.to(salaId).emit('user-left', socket.id);
            io.to(salaId).emit('update-participant-list', 
                Object.fromEntries(room.participants)
            );

            // Eliminar la sala si está vacía
            if (room.participants.size === 0) {
                console.log(`Sala ${salaId} cerrada por falta de participantes`);
                rooms.delete(salaId);
            }
        }
    });
});

// Iniciar el servidor
server.listen(PORT, () => {
    console.log(`Servidor de videollamadas iniciado en el puerto ${PORT}`);
}); 