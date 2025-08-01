// index.js - Main server implementation
require('dotenv').config();
const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const { MongoClient } = require('mongodb');
const helmet = require('helmet');
const cors = require('cors');
const { RateLimiterMemory } = require('rate-limiter-flexible');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const log = require('./log');

// Initialize Express app
const app = express();
const server = http.createServer(app);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      scriptSrc: ["'self'", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "", "https:"],
      connectSrc: ["'self'"]
    }
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true
  }
}));

// CORS configuration for privacy
app.use(cors({
  origin: false, // Disable CORS for maximum privacy
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type'],
  credentials: false
}));

// Rate limiting to prevent abuse
const rateLimiter = new RateLimiterMemory({
  points: 20, // 20 requests
  duration: 1 // per 1 second
});

// Apply rate limiting
app.use((req, res, next) => {
  rateLimiter.consume(req.ip)
    .then(() => {
      next();
    })
    .catch(() => {
      res.status(429).json({ error: 'Too many requests' });
    });
});

// Body parsing middleware
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB connection
let db;
let usersCollection;
let messagesCollection;

MongoClient.connect(process.env.MONGO_URI, { 
  useNewUrlParser: true, 
  useUnifiedTopology: true,
  maxPoolSize: 10
})
  .then(client => {
    db = client.db('untraced_messenger');
    usersCollection = db.collection('users');
    messagesCollection = db.collection('messages');
    log.logSystem('Connected to MongoDB');
    
    // Start cleanup job
    startCleanupJob();
  })
  .catch(err => {
    log.logError(err);
    process.exit(1);
  });

// Initialize Socket.IO with security
const io = socketIo(server, {
  cors: {
    origin: false,
    methods: ["GET", "POST"]
  },
  allowEIO3: true
});

// Generate unique 3-digit code
function generateUserCode() {
  return Math.floor(100 + Math.random() * 900).toString();
}

// Validate image URL
function isValidImageUrl(url) {
  try {
    const urlObj = new URL(url);
    const imageExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp'];
    return imageExtensions.some(ext => 
      urlObj.pathname.toLowerCase().endsWith(ext)
    );
  } catch {
    return false;
  }
}

// Cleanup job to delete old messages every 3 hours
function startCleanupJob() {
  // Run immediately on startup
  cleanupOldMessages();
  
  // Then run every 3 hours (10800000 ms)
  setInterval(cleanupOldMessages, 10800000);
}

// Delete messages older than 3 hours
async function cleanupOldMessages() {
  try {
    const threeHoursAgo = new Date(Date.now() - (3 * 60 * 60 * 1000));
    const result = await messagesCollection.deleteMany({
      timestamp: { $lt: threeHoursAgo }
    });
    
    log.logSystem(`Deleted ${result.deletedCount} old messages`);
  } catch (err) {
    log.logError(`Error during cleanup: ${err.message}`);
  }
}

// Routes
app.get('/api/new-user', async (req, res) => {
  try {
    let code;
    let user;
    
    // Ensure unique code
    do {
      code = generateUserCode();
      user = await usersCollection.findOne({ code });
    } while (user);
    
    // Generate random username
    const adjectives = ['Quick', 'Silent', 'Hidden', 'Secret', 'Stealth', 'Ghost', 'Shadow', 'Invisible'];
    const nouns = ['Whisper', 'Echo', 'Phantom', 'Wraith', 'Specter', 'Spirit', 'Glimmer', 'Shade'];
    const adj = adjectives[Math.floor(Math.random() * adjectives.length)];
    const noun = nouns[Math.floor(Math.random() * nouns.length)];
    const number = Math.floor(Math.random() * 1000);
    const username = `${adj}${noun}${number}`;
    
    // Create user
    await usersCollection.insertOne({ 
      code, 
      username,
      createdAt: new Date()
    });
    
    log.logActivity(`New user created: ${username} (${code})`);
    res.json({ code, username });
  } catch (err) {
    log.logError(err);
    res.status(500).json({ error: "Failed to create user" });
  }
});

app.get('/api/user/:code', async (req, res) => {
  try {
    const user = await usersCollection.findOne({ code: req.params.code });
    if (user) {
      res.json({ username: user.username });
    } else {
      res.status(404).json({ error: "User not found" });
    }
  } catch (err) {
    log.logError(err);
    res.status(500).json({ error: "Database error" });
  }
});

// Get user profile
app.get('/api/profile/:code', async (req, res) => {
  try {
    const user = await usersCollection.findOne({ code: req.params.code });
    if (user) {
      // Get message count for this user
      const messageCount = await messagesCollection.countDocuments({
        $or: [
          { sender: user.username },
          { recipient: user.code }
        ]
      });
      
      res.json({ 
        username: user.username,
        code: user.code,
        createdAt: user.createdAt,
        messageCount
      });
    } else {
      res.status(404).json({ error: "User not found" });
    }
  } catch (err) {
    log.logError(err);
    res.status(500).json({ error: "Database error" });
  }
});

// Socket.IO connection handling
io.on('connection', (socket) => {
  log.logActivity(`New socket connection established`);
  
  // Join with user code
  socket.on('join', async ({ code }) => {
    try {
      const user = await usersCollection.findOne({ code });
      if (user) {
        socket.join(code);
        socket.data.code = code;
        socket.data.username = user.username;
        socket.emit('joined', { username: user.username });
        log.logActivity(`User ${user.username} (${code}) joined`);
      } else {
        socket.emit('error', { message: 'Invalid user code' });
      }
    } catch (err) {
      log.logError(err);
      socket.emit('error', { message: 'Server error' });
    }
  });

  // Handle sending messages
  socket.on('send-message', async ({ recipientCode, message }) => {
    try {
      // Validate recipient
      const recipient = await usersCollection.findOne({ code: recipientCode });
      if (!recipient) {
        socket.emit('message-error', { message: 'Recipient not found' });
        return;
      }

      // Check if message is an image URL
      const isImage = isValidImageUrl(message);
      
      // Create message object
      const messageData = {
        sender: socket.data.username,
        recipient: recipient.code,
        content: message,
        isImage: isImage,
        timestamp: new Date()
      };
      
      // Store message temporarily
      const result = await messagesCollection.insertOne(messageData);
      
      // Emit to recipient room
      io.to(recipientCode).emit('new-message', messageData);
      
      // Emit to sender for confirmation
      socket.emit('message-sent', { messageId: result.insertedId });
      
      log.logActivity(`Message sent from ${socket.data.username} to ${recipient.username}`);
    } catch (err) {
      log.logError(err);
      socket.emit('message-error', { message: 'Failed to send message' });
    }
  });

  // Handle disconnection
  socket.on('disconnect', () => {
    log.logActivity(`Socket disconnected`);
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', timestamp: new Date().toISOString() });
});

// Debug endpoint to check logs (remove in production)
app.get('/debug/logs', (req, res) => {
  res.json({ logs: log.getRecentLogs(50) });
});

// Serve main page
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Serve profile page
app.get('/profile/:code', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'profile.html'));
});

// Serve messaging page
app.get('/messaging', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'messaging.html'));
});

// Error handling middleware
app.use((err, req, res, next) => {
  log.logError(err);
  res.status(500).json({ error: 'Internal server error' });
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  log.logError(`Unhandled Rejection at: ${promise}, reason: ${reason}`);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  log.logError(`Uncaught Exception: ${err}`);
  process.exit(1);
});

// Start server
const PORT = process.env.PORT || 10000;
server.listen(PORT, '0.0.0.0', () => {
  log.logSystem(`Server running on port ${PORT}`);
  console.log(`Untraced Messenger server started on port ${PORT}`);
});
