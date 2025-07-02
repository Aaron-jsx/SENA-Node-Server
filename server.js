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
    'https://sena-videocall.000webhostapp.com', // Otro dominio que tenías
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

app.use(cors(corsOptions)); // Usa el middleware de CORS para Express

const io = new socketIo.Server(server, {
    cors: corsOptions, // Aplica la misma configuración a Socket.IO
    transports: ['websocket', 'polling'],
    pingTimeout: 60000,
    pingInterval: 25000
});

const PORT = process.env.PORT || 10000;

// El resto de tu lógica de servidor...
const rooms = new Map();
const pendingNotifications = new Map();
const activeSessions = new Map();

function generateUniqueUserId(userId, userRole) {
    return `${userId}_${userRole}_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
}

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

io.use((socket, next) => {
    const { userId, userName, userRole, salaId } = socket.handshake.query;
    
    if (!userId || !userName || !userRole || !salaId) {
        logger.warn('Conexión rechazada - Faltan datos de autenticación', {
            query: socket.handshake.query
        });
        return next(new Error('Autenticación requerida'));
    }

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

    if (!rooms.has(salaId)) {
        rooms.set(salaId, {
            participants: new Map(),
            createdAt: new Date(),
            messages: [],
            polls: [],
            notifications: [],
            screenSharing: null
        });
        logger.info(`Sala ${salaId} creada`);
    }

    const room = rooms.get(salaId);

    socket.join(salaId);

    room.participants.set(socket.id, {
        userId,
        userName,
        userRole,
        joinedAt: new Date(),
        socketId: socket.id
    });

    const otherParticipants = Array.from(room.participants.values())
        .filter(p => p.socketId !== socket.id);

    socket.emit('room-users', otherParticipants);

    socket.to(salaId).emit('user-joined', { userId, userName, userRole, socketId: socket.id });

    socket.on('disconnect', () => {
        if (room) {
            room.participants.delete(socket.id);
            socket.to(salaId).emit('user-left', { socketId: socket.id });
            logger.info(`Usuario desconectado: ${userId} de la sala ${salaId}`);
            if (room.participants.size === 0) {
                rooms.delete(salaId);
                logger.info(`Sala eliminada: ${salaId}`);
            }
        }
    });

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

    // ... (El resto de tus eventos de socket como chat, etc. van aquí) ...
});

app.get('/', (req, res) => {
    res.send({ status: 'ok', message: 'Servidor de señalización SENA funcionando' });
});

server.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor de videollamadas iniciado en el puerto ${PORT}`);
});