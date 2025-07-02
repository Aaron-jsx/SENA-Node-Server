const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const winston = require('winston');
const cors = require('cors');

const app = express();
const server = http.createServer(app);

// --- CONFIGURACIÓN DE CORS CORRECTA ---
const allowedOrigins = [
    'https://lasena.byethost31.com', // Tu dominio de producción
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
    pingTimeout: 60000,
    pingInterval: 25000
});

const PORT = process.env.PORT || 10000;

const rooms = new Map();

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
    transports: [ new winston.transports.Console() ]
});

// Middleware de autenticación para Socket.IO
io.use((socket, next) => {
    const { userId, userName, userRole, salaId } = socket.handshake.query;
    
    if (!userId || !userName || !userRole || !salaId) {
        logger.warn('Conexión rechazada - Faltan datos de autenticación', { query: socket.handshake.query });
        return next(new Error('Autenticación requerida'));
    }

    // Adjuntar datos al objeto socket para uso futuro
    socket.userId = userId;
    socket.userName = userName;
    socket.userRole = userRole;
    socket.salaId = salaId;
    logger.info('Usuario autenticado correctamente', { userId, salaId, socketId: socket.id });
    next();
});

io.on("connection", (socket) => {
    const { userId, userName, userRole, salaId } = socket;
    
    logger.info('Nueva conexión de socket', { socketId: socket.id, userId, salaId });

    // --- LÓGICA CORREGIDA ---
    // Ya no se verifica si el usuario es duplicado aquí.
    // Se permite la conexión y se maneja por socket.id, que siempre es único.

    // Crear sala si no existe
    if (!rooms.has(salaId)) {
        rooms.set(salaId, { participants: new Map() });
        logger.info(`Sala ${salaId} creada`);
    }

    const room = rooms.get(salaId);

    // Unir el socket a la sala
    socket.join(salaId);

    // Añadir participante a la lista de la sala usando el socket.id como clave única
    room.participants.set(socket.id, { userId, userName, userRole, socketId: socket.id });

    // Enviar al nuevo usuario la lista de los que ya estaban
    const otherParticipants = Array.from(room.participants.values()).filter(p => p.socketId !== socket.id);
    socket.emit('room-users', otherParticipants);
    
    // Enviar a los demás la info del nuevo usuario
    socket.to(salaId).emit('user-joined', { userId, userName, userRole, socketId: socket.id });

    // Manejar desconexión
    socket.on('disconnect', () => {
        if (room && room.participants.has(socket.id)) {
            room.participants.delete(socket.id);
            // Notificar a los demás que el usuario se fue
            socket.to(salaId).emit('user-left', { socketId: socket.id });
            logger.info(`Usuario desconectado: ${userId} de la sala ${salaId}`);
            if (room.participants.size === 0) {
                rooms.delete(salaId);
                logger.info(`Sala eliminada: ${salaId}`);
            }
        }
    });

    // --- MANEJO DE WEBRTC ---
    socket.on('offer', (data) => {
        socket.to(data.to).emit('offer', {
            offer: data.offer,
            from: socket.id
        });
    });

    socket.on('answer', (data) => {
        socket.to(data.to).emit('answer', {
            answer: data.answer,
            from: socket.id
        });
    });

    socket.on('ice-candidate', (data) => {
        socket.to(data.to).emit('ice-candidate', {
            candidate: data.candidate,
            from: socket.id
        });
    });

    // --- MANEJO DE CHAT ---
    socket.on('chat-message', (messageData) => {
        // Re-transmitir el mensaje a todos en la sala, incluido el remitente
        io.to(salaId).emit('chat-message', messageData);
    });
});

// Rutas de prueba para Express
app.get('/', (req, res) => {
    res.send({ status: 'ok', message: 'Servidor de señalización SENA funcionando' });
});

// Iniciar el servidor
server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor de videollamadas iniciado en el puerto ${PORT}`);
});
