// =================================================================
// == VERSIÓN 4 - LIMPIA Y SIN ERRORES DE SINTAXIS (3 de Julio) ==
// =================================================================
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const winston = require('winston');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// --- Configuración de CORS ---
const allowedOrigins = [
    'https://lasena.byethost31.com',
    'https://sena-videocall.000webhostapp.com',
    'http://localhost',
    'http://127.0.0.1'
];

const corsOptions = {
  origin: function (origin, callback) {
    if (!origin || allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      callback(new Error('No permitido por la política de CORS'));
    }
  },
  methods: ["GET", "POST", "HEAD"],
  credentials: true
};

app.use(cors(corsOptions));

const io = new socketIo.Server(server, {
    cors: corsOptions,
    transports: ['websocket', 'polling'],
});

const PORT = process.env.PORT || 10000;
const rooms = new Map();

const logger = winston.createLogger({
    level: 'info',
    format: winston.format.combine(winston.format.timestamp(), winston.format.json()),
    transports: [ new winston.transports.Console() ]
});

// --- Middleware de Autenticación ---
io.use((socket, next) => {
    const { userId, userName, userRole, salaId } = socket.handshake.query;
    if (!userId || !userName || !userRole || !salaId) {
        logger.warn('Conexión rechazada: Faltan datos de autenticación', { query: socket.handshake.query });
        return next(new Error('Autenticación requerida'));
    }
    socket.userId = userId;
    socket.userName = userName;
    socket.userRole = userRole;
    socket.salaId = salaId;
    logger.info('Usuario autenticado', { userId, salaId, socketId: socket.id });
    next();
});

// --- Lógica de Conexión Principal ---
io.on("connection", (socket) => {
    const { userId, userName, userRole, salaId } = socket;
    logger.info('Nueva conexión', { socketId: socket.id, userId, salaId });

    if (!rooms.has(salaId)) {
        rooms.set(salaId, { participants: new Map() });
        logger.info(`Sala creada: ${salaId}`);
    }
    const room = rooms.get(salaId);

    socket.join(salaId);
    room.participants.set(socket.id, { userId, userName, userRole, socketId: socket.id });

    const otherParticipants = Array.from(room.participants.values()).filter(p => p.socketId !== socket.id);
    socket.emit('room-users', otherParticipants);
    
    socket.to(salaId).emit('user-joined', { userId, userName, userRole, socketId: socket.id });

    socket.on('disconnect', () => {
        if (room && room.participants.has(socket.id)) {
            room.participants.delete(socket.id);
            socket.to(salaId).emit('user-left', { socketId: socket.id });
            logger.info(`Usuario desconectado`, { socketId: socket.id, userId });
            if (room.participants.size === 0) {
                rooms.delete(salaId);
                logger.info(`Sala eliminada: ${salaId}`);
            }
        }
    });

    // --- Manejo de WebRTC y Chat ---
    socket.on('offer', (data) => socket.to(data.to).emit('offer', { offer: data.offer, from: socket.id }));
    socket.on('answer', (data) => socket.to(data.to).emit('answer', { answer: data.answer, from: socket.id }));
    socket.on('ice-candidate', (data) => socket.to(data.to).emit('ice-candidate', { candidate: data.candidate, from: socket.id }));
    socket.on('chat-message', (messageData) => io.to(salaId).emit('chat-message', messageData));
});

server.listen(PORT, '0.0.0.0', () => console.log(`Servidor iniciado en puerto ${PORT}`));
