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
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000
});

const PORT = process.env.PORT || 10000;

// Configuración de logs mejorada
const debug = true;
function log(message, data = null, type = 'info') {
    if (!debug) return;
    
    const timestamp = new Date().toISOString();
    const prefix = `[${timestamp}]`;
    
    if (data) {
        console.log(`${prefix} ${message}`, data);
    } else {
        console.log(`${prefix} ${message}`);
    }
}

server.listen(PORT, () => {
    log(`Servidor de señalización iniciado en el puerto ${PORT}`);
    log(`URL del servidor: https://sena-node-server.onrender.com:${PORT}`);
});

// Dentro de la definición de rooms, agregar polls para almacenar encuestas
const rooms = new Map();

// Función para obtener información de la sala
function getRoomInfo(salaId) {
    const room = rooms.get(salaId);
    if (!room) return null;
    
    return {
        participantsCount: room.participants.size,
        participants: Array.from(room.participants.entries()).map(([id, info]) => ({
            id,
            userId: info.userId,
            userName: info.userName,
            userType: info.userType,
            joinedAt: info.joinedAt
        })),
        createdAt: room.createdAt
    };
}

io.on("connection", (socket) => {
    log(`Nueva conexión establecida: ${socket.id}`);

    // Unirse a una sala
    socket.on("join-room", ({ salaId, userId, userName, userType }) => {
        log(`Usuario ${userName} (${userType}) está uniéndose a la sala ${salaId}`, { userId, socketId: socket.id });

        // Crear la sala si no existe
        if (!rooms.has(salaId)) {
            log(`Creando nueva sala: ${salaId}`);
            rooms.set(salaId, {
                participants: new Map(),
                createdAt: new Date(),
                messages: [],
                polls: [] // Agregar array para almacenar encuestas
            });
        }

        const room = rooms.get(salaId);
        
        // Verificar si el usuario ya está en la sala (reconexión)
        const existingParticipant = Array.from(room.participants.entries())
            .find(([_, p]) => p.userId === userId);
            
        if (existingParticipant) {
            const [oldSocketId, _] = existingParticipant;
            if (oldSocketId !== socket.id) {
                log(`Usuario ${userName} (${userId}) reconectado con nuevo socket ID: ${socket.id}, antiguo: ${oldSocketId}`);
                // Eliminar la entrada antigua
                room.participants.delete(oldSocketId);
                // Notificar a otros que el usuario anterior se fue
                socket.to(salaId).emit('user-left', oldSocketId);
            }
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

        log(`Enviando lista de ${participantsInfo.length} participantes existentes a ${userName}`, participantsInfo);
        socket.emit('existing-participants', participantsInfo);

        // Notificar a otros participantes sobre el nuevo usuario
        socket.to(salaId).emit('user-joined', {
            id: socket.id,
            userId,
            userName,
            userType
        });

        log(`Usuario ${userName} se unió exitosamente a la sala ${salaId}`);
        log(`Participantes actuales en la sala ${salaId}: ${room.participants.size}`);
        
        // Enviar información actualizada de la sala a todos los participantes
        io.to(salaId).emit('update-participant-list', 
            Array.from(room.participants.entries()).map(([id, info]) => ({
                id,
                userId: info.userId,
                userName: info.userName,
                userType: info.userType
            }))
        );
    });

    // Manejo de señalización WebRTC
    socket.on('sending-signal', payload => {
        const room = rooms.get(socket.salaId);
        if (!room) {
            log(`Error: Usuario ${socket.id} intentó enviar señal pero no está en una sala válida`);
            return;
        }

        const participant = room.participants.get(socket.id);
        if (!participant) {
            log(`Error: No se encontró información del participante ${socket.id}`);
            return;
        }
        
        log(`Señal enviada de ${participant.userName} (${socket.id}) a ${payload.userToSignal}`);

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
            log(`Error: Usuario ${socket.id} intentó devolver señal pero no está en una sala válida`);
            return;
        }
        
        const participant = room.participants.get(socket.id);
        if (!participant) {
            log(`Error: No se encontró información del participante ${socket.id}`);
            return;
        }
        
        log(`Señal devuelta de ${participant.userName} (${socket.id}) a ${payload.callerId}`);

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
    
    // Manejar ICE candidates
    socket.on('ice-candidate', ({ to, candidate }) => {
        const room = rooms.get(socket.salaId);
        if (!room) {
            log(`Error: Usuario ${socket.id} intentó enviar ICE candidate pero no está en una sala válida`);
            return;
        }

        log(`ICE candidate de ${socket.id} para ${to}`);
        io.to(to).emit('ice-candidate', {
            from: socket.id,
            candidate
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
        log(`Mensaje de chat de ${participant.userName} en sala ${socket.salaId}: ${message.text}`);
        
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
            log(`Usuario ${participant.userName} comenzó a compartir pantalla en la sala ${socket.salaId}`);
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
            log(`Usuario ${participant.userName} dejó de compartir pantalla en la sala ${socket.salaId}`);
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
            log(`Usuario ${participant.userName} intentó crear una encuesta sin ser instructor`);
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
        log(`Encuesta creada por ${participant.userName} en sala ${socket.salaId}: ${poll.question}`);
        
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
            log(`Usuario ${participant.userName} intentó votar más de una vez en la encuesta ${pollId}`);
            return;
        }

        // Verificar si la opción es válida
        if (optionIndex < 0 || optionIndex >= poll.options.length) {
            log(`Usuario ${participant.userName} intentó votar por una opción inválida en la encuesta ${pollId}`);
            return;
        }
        
        // Registrar voto
        poll.results[optionIndex]++;
        poll.voters.push(participant.userId);
        
        log(`Usuario ${participant.userName} votó en la encuesta ${pollId}, opción: ${poll.options[optionIndex]}`);

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
            log(`Usuario ${participant.userName} intentó cerrar una encuesta sin ser instructor`);
            return;
        }
        
        // Buscar la encuesta
        const pollIndex = room.polls.findIndex(poll => poll.id === pollId);
        if (pollIndex === -1) return;

        // Marcar como inactiva
        room.polls[pollIndex].active = false;
        
        log(`Encuesta ${pollId} cerrada por ${participant.userName}`);
        
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
    
    // Endpoint para obtener información de la sala
    socket.on('get-room-info', () => {
        const salaId = socket.salaId;
        if (!salaId) {
            socket.emit('room-info', { error: 'No estás en una sala' });
            return;
        }
        
        const roomInfo = getRoomInfo(salaId);
        if (!roomInfo) {
            socket.emit('room-info', { error: 'Sala no encontrada' });
            return;
        }
        
        socket.emit('room-info', roomInfo);
    });
    
    // Ping para mantener la conexión activa
    socket.on('ping', (callback) => {
        if (typeof callback === 'function') {
            callback({ time: new Date().toISOString() });
        }
    });

    // Manejo de desconexión
    socket.on('disconnect', () => {
        const salaId = socket.salaId;
        if (!salaId) return;
        
        const room = rooms.get(salaId);
        if (!room) return;

        const participant = room.participants.get(socket.id);
        if (participant) {
            log(`Usuario ${participant.userName} se desconectó de la sala ${salaId}`);
            room.participants.delete(socket.id);

            // Notificar a otros participantes
            io.to(salaId).emit('user-left', socket.id);
            
            // Enviar lista actualizada de participantes
            io.to(salaId).emit('update-participant-list', 
                Array.from(room.participants.entries()).map(([id, info]) => ({
                    id,
                    userId: info.userId,
                    userName: info.userName,
                    userType: info.userType
                }))
            );

            // Eliminar la sala si está vacía
            if (room.participants.size === 0) {
                log(`Sala ${salaId} cerrada por falta de participantes`);
                rooms.delete(salaId);
            }
        }
    });
});

// Iniciar el servidor
server.listen(PORT, () => {
    log(`Servidor de videollamadas iniciado en el puerto ${PORT}`);
}); 