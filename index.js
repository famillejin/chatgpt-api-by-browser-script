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
      callback('stop', 'api error');
      console.log('The browser connection has not been established, the request cannot be processed.');
      return;
    }

    // Send the complete message at once
    this.connectedSocket.send(JSON.stringify({
      type: 'request',
      data: request
    }));

    // Set up message handler
    const handleMessage = (message) => {
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
        console.error("Failed to parse message as JSON", e);
        console.error("Message data:", data);
      }
    };

    this.connectedSocket.on('message', handleMessage);
  }
}

const webSocketServer = new WebSocketServer();

const app = express();

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(cors());

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

app.listen(HTTP_PORT, function () {
  console.log(`Application example, access address is http://localhost:${HTTP_PORT}/v1/chat/completions`);
});
