const express = require('express');
const http = require('http');
const socketIo = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new socketIo.Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

const PORT = 3000;
const rooms = {};

io.on('connection', (socket) => {
    const { userId, userName, userType } = socket.handshake.query;
    console.log(`Usuario conectado: ${userName} (${userId}), Socket ID: ${socket.id}`);

    socket.on('join-room', (data) => {
        const { salaId, userId, userName, userType } = data;
        if (!salaId) return;

        if (!rooms[salaId]) {
            rooms[salaId] = {
                participants: {},
                poll: null,
                spotlightedSocketId: null
            };
        }
        
        // Guardar la sala en el socket para referencia futura
        socket.salaId = salaId;

        rooms[salaId].participants[socket.id] = { userId, userName, userType, raisedHand: false };
        
        socket.join(salaId);

        const otherUsers = Object.keys(rooms[salaId].participants).filter(id => id !== socket.id);
        socket.emit('all-users', otherUsers);

        io.to(salaId).emit('update-participant-list', rooms[salaId].participants);
    });

    socket.on('sending-signal', payload => {
        const room = rooms[socket.salaId];
        console.log(`[signal] sending-signal from ${socket.id} to ${payload.userToSignal} in room ${socket.salaId}`);
        if (!room) {
            console.error(`[signal] ERROR: User ${socket.id} tried to send signal but is not in a valid room.`);
            return;
        }
        
        io.to(payload.userToSignal).emit('user-offering', { 
            signal: payload.signal, 
            callerId: payload.callerId,
            callerInfo: room.participants[payload.callerId]
        });
    });

    socket.on('returning-signal', payload => {
        console.log(`[signal] returning-signal from ${socket.id} to ${payload.callerId}`);
        io.to(payload.callerId).emit('receiving-returned-signal', { signal: payload.signal, id: socket.id });
    });

    socket.on('disconnect', () => {
        const userName = rooms[socket.salaId]?.participants[socket.id]?.userName || socket.id;
        console.log(`Usuario desconectado: ${userName} (${userId})`);
        const salaId = socket.salaId;
        if (salaId && rooms[salaId]) {
            delete rooms[salaId].participants[socket.id];
            if (Object.keys(rooms[salaId].participants).length === 0) {
                console.log(`Sala vacía '${salaId}', eliminando.`);
                delete rooms[salaId];
            } else {
                io.to(salaId).emit('user-left', socket.id);
                io.to(salaId).emit('update-participant-list', rooms[salaId].participants);
            }
        }
    });
    
    // --- Handlers específicos de la sala ---
    socket.on('send-chat-message', (messageData) => {
        const salaId = socket.salaId;
        if (!salaId) return;
        console.log(`[chat] Mensaje de ${socket.id} en sala ${salaId}:`, messageData);
        
        // Enviar mensaje a todos los demás en la sala
        socket.to(salaId).emit('chat-message', { 
            senderId: socket.id, 
            userName: messageData.sender || userName, 
            message: messageData.text,
            timestamp: new Date().toISOString()
        });
    });
    
    socket.on('raise-hand', (raised) => {
        const room = rooms[socket.salaId];
        if (room && room.participants[socket.id]) {
            room.participants[socket.id].raisedHand = raised;
            io.to(socket.salaId).emit('update-participant-list', room.participants);
            io.to(socket.salaId).emit('hand-raised', { userId: socket.id, userName, raised });
        }
    });

    // Solicitar lista de participantes
    socket.on('request-participant-list', () => {
        const salaId = socket.salaId;
        if (salaId && rooms[salaId]) {
            socket.emit('update-participant-list', rooms[salaId].participants);
        }
    });
    
    // Obtener nombre de usuario por socket ID
    socket.on('get-user-name', (socketId, callback) => {
        const salaId = socket.salaId;
        if (salaId && rooms[salaId] && rooms[salaId].participants[socketId]) {
            const userName = rooms[salaId].participants[socketId].userName;
            callback(userName);
        } else {
            callback(null);
        }
    });
    
    // Actualizar nombre de usuario
    socket.on('update-user-name', (data) => {
        const salaId = socket.salaId;
        if (salaId && rooms[salaId] && rooms[salaId].participants[socket.id]) {
            rooms[salaId].participants[socket.id].userName = data.userName;
            io.to(salaId).emit('update-participant-list', rooms[salaId].participants);
        }
    });

    // --- Funciones de moderación ---
    
    // Silenciar a un participante
    socket.on('mute-participant', ({ participantId }) => {
        const salaId = socket.salaId;
        const room = rooms[salaId];
        
        // Verificar que el usuario es instructor o administrador
        if (!room || room.participants[socket.id]?.userType !== 'instructor') {
            console.log(`[moderación] Usuario ${socket.id} intentó silenciar pero no tiene permisos`);
            return;
        }
        
        console.log(`[moderación] Instructor ${socket.id} silenció a ${participantId}`);
        
        // Enviar mensaje al usuario silenciado
        io.to(participantId).emit('muted-by-moderator');
        
        // Notificar a todos los participantes
        const mutedUserName = room.participants[participantId]?.userName || 'Usuario';
        const moderatorName = room.participants[socket.id]?.userName || 'Instructor';
        
        io.to(salaId).emit('chat-message', {
            senderId: 'system',
            userName: 'Sistema',
            message: `${moderatorName} ha silenciado a ${mutedUserName}`,
            timestamp: new Date().toISOString()
        });
    });
    
    // Desactivar video de un participante
    socket.on('disable-participant-video', ({ participantId }) => {
        const salaId = socket.salaId;
        const room = rooms[salaId];
        
        // Verificar que el usuario es instructor o administrador
        if (!room || room.participants[socket.id]?.userType !== 'instructor') {
            console.log(`[moderación] Usuario ${socket.id} intentó desactivar video pero no tiene permisos`);
            return;
        }
        
        console.log(`[moderación] Instructor ${socket.id} desactivó video de ${participantId}`);
        
        // Enviar mensaje al usuario
        io.to(participantId).emit('video-disabled-by-moderator');
        
        // Notificar a todos los participantes
        const userName = room.participants[participantId]?.userName || 'Usuario';
        const moderatorName = room.participants[socket.id]?.userName || 'Instructor';
        
        io.to(salaId).emit('chat-message', {
            senderId: 'system',
            userName: 'Sistema',
            message: `${moderatorName} ha desactivado el video de ${userName}`,
            timestamp: new Date().toISOString()
        });
    });
    
    // Expulsar a un participante
    socket.on('kick-participant', ({ participantId }) => {
        const salaId = socket.salaId;
        const room = rooms[salaId];
        
        // Verificar que el usuario es instructor o administrador
        if (!room || room.participants[socket.id]?.userType !== 'instructor') {
            console.log(`[moderación] Usuario ${socket.id} intentó expulsar pero no tiene permisos`);
            return;
        }
        
        console.log(`[moderación] Instructor ${socket.id} expulsó a ${participantId}`);
        
        // Notificar a todos los participantes
        const userName = room.participants[participantId]?.userName || 'Usuario';
        const moderatorName = room.participants[socket.id]?.userName || 'Instructor';
        
        io.to(salaId).emit('chat-message', {
            senderId: 'system',
            userName: 'Sistema',
            message: `${moderatorName} ha expulsado a ${userName} de la sala`,
            timestamp: new Date().toISOString()
        });
        
        // Enviar mensaje de expulsión al usuario
        io.to(participantId).emit('kicked-by-moderator');
        
        // Eliminar al usuario de la sala
        delete room.participants[participantId];
        io.to(salaId).emit('user-left', participantId);
        io.to(salaId).emit('update-participant-list', room.participants);
    });

    socket.on('send-reaction', ({ emoji }) => {
        const salaId = socket.salaId;
        if (!salaId) return;
        socket.to(salaId).emit('show-reaction', { socketId: socket.id, emoji });
    });

    // --- Encuestas ---
    socket.on('create-poll', ({ question, options, duration }) => {
        const room = rooms[socket.salaId];
        if (room && room.participants[socket.id]?.userType === 'instructor') {
            const endTime = duration > 0 ? Date.now() + duration * 60 * 1000 : null;
            room.poll = {
                question,
                options,
                results: new Array(options.length).fill(0),
                votes: {},
                endTime,
            };
            console.log(`Encuesta creada en sala ${socket.salaId}: "${question}"`);
            io.to(socket.salaId).emit('poll-created', room.poll);

            io.to(socket.salaId).emit('chat-message', {
                senderId: 'system',
                userName: 'Sistema',
                message: `📊 ¡Nueva encuesta del instructor! "${question}". ¡Vota ahora!`
            });
            
            // Configurar temporizador para finalizar la encuesta
            if (endTime) {
                setTimeout(() => {
                    if (rooms[socket.salaId] && rooms[socket.salaId].poll) {
                        io.to(socket.salaId).emit('poll-ended');
                        console.log(`Encuesta finalizada en sala ${socket.salaId}`);
                        
                        // Notificar en el chat
                        io.to(socket.salaId).emit('chat-message', {
                            senderId: 'system',
                            userName: 'Sistema',
                            message: `📊 La encuesta "${question}" ha finalizado.`
                        });
                    }
                }, duration * 60 * 1000);
            }
        }
    });
    
    socket.on('vote-poll', ({ optionIndex }) => {
        const room = rooms[socket.salaId];
        if (!room || !room.poll) return;
        
        // Si el usuario ya votó, anular su voto anterior
        const previousVote = room.poll.votes[socket.id];
        if (previousVote !== undefined) {
            room.poll.results[previousVote]--;
        }
        
        // Registrar nuevo voto
        room.poll.votes[socket.id] = optionIndex;
        room.poll.results[optionIndex]++;
        
        // Actualizar resultados a todos los participantes
        io.to(socket.salaId).emit('poll-updated', room.poll);
    });
    
    socket.on('close-poll', () => {
        const room = rooms[socket.salaId];
        if (room && room.participants[socket.id]?.userType === 'instructor' && room.poll) {
            io.to(socket.salaId).emit('poll-ended');
            console.log(`Encuesta cerrada manualmente en sala ${socket.salaId}`);
            
            // Notificar en el chat
            io.to(socket.salaId).emit('chat-message', {
                senderId: 'system',
                userName: 'Sistema',
                message: `📊 La encuesta "${room.poll.question}" ha sido cerrada por el instructor.`
            });
        }
    });

    // --- Moderación y otros ---
    socket.on('spotlight-user', ({ spotlightedSocketId }) => {
         const room = rooms[socket.salaId];
         if (room && room.participants[socket.id]?.userType === 'instructor') {
            room.spotlightedSocketId = spotlightedSocketId;
            io.to(socket.salaId).emit('spotlight-update', { spotlightedSocketId });
         }
    });

    // --- Subtítulos y reconocimiento de voz ---
    socket.on('broadcast-subtitle', (data) => {
        const salaId = socket.salaId;
        if (!salaId) return;
        
        const userName = rooms[salaId]?.participants[socket.id]?.userName || 'Usuario';
        
        // Enviar a todos menos al emisor
        socket.to(salaId).emit('subtitle-broadcast', {
            text: data.text,
            userName: userName
        });
    });

    // --- Detección de voz y actividad ---
    socket.on('voice-activity', (speaking) => {
        const salaId = socket.salaId;
        if (!salaId) return;
        
        // Enviar a todos menos al emisor
        socket.to(salaId).emit('user-speaking', {
            userId: socket.id,
            speaking: speaking
        });
    });

    // --- Cambio de estado de video ---
    socket.on('video-state-changed', (data) => {
        const salaId = socket.salaId;
        if (!salaId) return;
        
        // Guardar el estado en los datos del participante
        if (rooms[salaId] && rooms[salaId].participants[socket.id]) {
            rooms[salaId].participants[socket.id].videoEnabled = data.enabled;
        }
        
        // Notificar a los demás participantes
        socket.to(salaId).emit('remote-video-state-changed', {
            userId: socket.id,
            enabled: data.enabled
        });
    });

    // --- Obtener información de perfil de usuario ---
    socket.on('get-user-profile', (userId, callback) => {
        const salaId = socket.salaId;
        if (!salaId || !rooms[salaId]) {
            callback(null);
            return;
        }
        
        // En un sistema real, aquí consultarías a la base de datos
        // Para esta implementación, devolvemos datos de ejemplo o simulados
        const participant = rooms[salaId].participants[userId];
        if (!participant) {
            callback(null);
            return;
        }
        
        // Simulamos un objeto con la URL de la foto de perfil
        // En una implementación real, esto debería consultar la base de datos
        const profileData = {
            userId: participant.userId,
            userName: participant.userName,
            profileUrl: `../uploads/profiles/profile_${participant.userId}.jpg` // URL simulada
        };
        
        callback(profileData);
    });
});

server.listen(PORT, () => console.log(`Servidor de señalización corriendo en el puerto ${PORT}`)); 