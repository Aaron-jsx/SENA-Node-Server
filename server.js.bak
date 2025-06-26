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

// Almacena información de las salas activas
const rooms = new Map();

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
                messages: []
            });
        }

        const room = rooms.get(salaId);
        
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