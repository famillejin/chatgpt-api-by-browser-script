const WebSocket = require('ws');
const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
const utf8 = require('utf8');

const WS_PORT = 8765;
const HTTP_PORT = 8766;

class WebSocketServer {
  constructor() {
    this.server = new WebSocket.Server({ port: WS_PORT });
    this.connectedSocket = null;
    this.sessions = new Map(); // Store chat sessions
    this.initialize();
  }

  initialize() {
    this.server.on('connection', (socket) => {
      this.connectedSocket = socket;
      console.log('Browser connected, can process requests now.');

      socket.on('close', () => {
        console.log('The browser connection has been disconnected, the request cannot be processed.');
        this.connectedSocket = null;
      });
    });

    console.log('WebSocket server is running');
  }

  async sendRequest(request, callback) {
    if (!this.connectedSocket) {
      const error = {
        code: 'WEBSOCKET_NOT_CONNECTED',
        message: 'Browser connection not established'
      };
      callback('error', JSON.stringify(error));
      return;
    }

    try {
      // Validate request
      if (!request.text || typeof request.text !== 'string') {
        throw new Error('Invalid request format');
      }

    // Send the complete message at once
    this.connectedSocket.send(JSON.stringify({
      type: 'request',
      data: request
    }));

    let fullMessage = '';
    let expectedChunks = 0;
    let receivedChunks = 0;
    const chunks = {};

    // Set up message handler
    const handleMessage = async (message) => {
      try {
        const data = message instanceof Buffer ? utf8.decode(message.toString('utf8')) : message;
        const jsonObject = JSON.parse(data);

        if (jsonObject.type === 'answer') {
          console.log('Received answer:', jsonObject.text);
          callback('answer', jsonObject.text);
        } else if (jsonObject.type === 'stop') {
          console.log('Received stop signal');
          this.connectedSocket.off('message', handleMessage);
          callback('stop', '');
        }
      } catch (e) {
        console.error("Failed to process message:", e);
        console.error("Message data:", data);
      }
    };

    this.connectedSocket.on('message', handleMessage);
  }
}

// Create WebSocket server instance
const webSocketServer = new WebSocketServer();

// Create Express app instance
const app = express();

// Security headers middleware
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// Configure middleware with error handling
app.use((err, req, res, next) => {
  console.error('Middleware error:', err);
  if (res.headersSent) {
    return next(err);
  }
  res.status(500).json({ 
    error: 'Internal server error',
    requestId: req.id
  });
});

app.use(bodyParser.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    try {
      JSON.parse(buf.toString());
    } catch (e) {
      throw new Error('Invalid JSON');
    }
  }
}));

app.use(bodyParser.urlencoded({ 
  extended: true, 
  limit: '10mb',
  verify: (req, res, buf) => {
    try {
      JSON.parse(buf.toString());
    } catch (e) {
      throw new Error('Invalid JSON');
    }
  }
}));

const corsOptions = {
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
  exposedHeaders: ['X-Request-ID'],
  credentials: true,
  maxAge: 86400
};

app.use(cors(corsOptions));

// Handle preflight requests
app.options('/v1/chat/completions', (req, res) => {
  try {
    res.setHeader('Access-Control-Allow-Origin', corsOptions.origin);
    res.setHeader('Access-Control-Allow-Methods', corsOptions.methods.join(','));
    res.setHeader('Access-Control-Allow-Headers', corsOptions.allowedHeaders.join(','));
    res.setHeader('Access-Control-Allow-Credentials', corsOptions.credentials.toString());
    res.setHeader('Access-Control-Max-Age', corsOptions.maxAge.toString());
    res.status(204).end();
  } catch (error) {
    console.error('Preflight request error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Main API endpoint
app.post('/v1/chat/completions', async function (req, res) {

  const { messages, model, stream, newChat = true  } = req.body;

  if(stream){
    console.log('streaming');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Transfer-Encoding', 'chunked');
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.flushHeaders();
  }

  console.log('request body', req.body)

  const requestPayload = `
    Now you must play the role of system and answer the user.

    ${JSON.stringify(messages)}

    Your answer:
  `;

  let lastResponse = '';
  webSocketServer.sendRequest(
    {
      text: requestPayload,
      model: model,
      newChat,
    },
    (type, response) => {
      try {
        //console.log('base64 response:', response);
        //response = atob(response).trim();
        console.log('response:', response);
        console.log("Received text with length:", response.length);
        let deltaContent = '';

        if (response.length>0) {
           result = {
            choices: [{
                message: { content: response },
                delta: { content: deltaContent }
            }]
          }
        }
        if (response.length < lastResponse.length) {
          // If response is shorter than lastResponse, something went wrong
          // Use the full response as delta
          deltaContent = response;
        } else if (lastResponse) {
          // Find common prefix length
          let commonLength = 0;
          while (commonLength < lastResponse.length && 
                 response[commonLength] === lastResponse[commonLength]) {
            commonLength++;
          }
          deltaContent = response.slice(commonLength);
        } else {
          deltaContent = response;
        }
        //lastResponse = response;
        if(type === 'stop'){
          if(stream) {
            // Make sure we send the final chunk if there's content remaining
            if (response !== lastResponse) {
              const chunk = {
                id: 'chatcmpl-' + Date.now(),
                object: 'chat.completion.chunk',
                created: Math.floor(Date.now() / 1000),
                model: model,
                choices: [{
                  index: 0,
                  delta: { content: deltaContent },
                  finish_reason: null
                }]
              };
              res.write(`data: ${JSON.stringify(chunk)}\n\n`);
            }
            
            // Send the final chunk with finish_reason: "stop"
            const finalChunk = {
              id: 'chatcmpl-' + Date.now(),
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: model,
              choices: [{
                index: 0,
                delta: {},
                finish_reason: 'stop'
              }]
            };
            res.write(`data: ${JSON.stringify(finalChunk)}\n\n`);
            res.write('data: [DONE]\n\n');
            res.end();
          } else {
            
            // Send the final response without using streaming chunks
            res.send(result);
            console.log('result:', result.choices[0].message.content);
          }
        } else if (deltaContent) { // Only send chunk if there's actual content
          if(stream) {
            const chunk = {
              id: 'chatcmpl-' + Date.now(),
              object: 'chat.completion.chunk',
              created: Math.floor(Date.now() / 1000),
              model: model,
              choices: [{
                index: 0,
                delta: { content: deltaContent },
                finish_reason: null
              }]
            };
            res.write(`data: ${JSON.stringify(chunk)}\n\n`);
          }
        }
        lastResponse = response;
      } catch (error) {
        console.log('error', error)
      }
    }
  );
});

// Start HTTP server
let server;
try {
  server = app.listen(HTTP_PORT, '127.0.0.1', function () {
    console.log(`API server running at http://localhost:${HTTP_PORT}/v1/chat/completions`);
    console.log(`CORS origin: ${corsOptions.origin}`);
    console.log(`Node version: ${process.version}`);
    console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  });
} catch (error) {
  console.error('Failed to start server:', error);
  process.exit(1);
}

// Add health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Handle server errors
server.on('error', (error) => {
  console.error('Server error:', error);
  
  if (error.code === 'EADDRINUSE') {
    console.error(`Port ${HTTP_PORT} is already in use`);
  } else if (error.code === 'EACCES') {
    console.error(`Port ${HTTP_PORT} requires elevated privileges`);
  }
  
  process.exit(1);
});

// Handle process termination
const shutdown = (signal) => {
  console.log(`Received ${signal}, shutting down gracefully...`);
  
  // Close WebSocket server first
  if (webSocketServer) {
    webSocketServer.server.close(() => {
      console.log('WebSocket server closed');
    });
  }

  // Then close HTTP server
  if (server) {
    server.close(() => {
      console.log('HTTP server closed');
      process.exit(0);
    });
  }

  // Force shutdown if not completed in 10 seconds
  const forceShutdownTimer = setTimeout(() => {
    console.error('Forcing shutdown...');
    process.exit(1);
  }, 10000);

  // Clean up force shutdown timer
  forceShutdownTimer.unref();
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('Uncaught exception:', error);
  shutdown('uncaughtException');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled rejection at:', promise, 'reason:', reason);
  shutdown('unhandledRejection');
});
