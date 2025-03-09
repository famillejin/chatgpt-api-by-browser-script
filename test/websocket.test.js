const WebSocket = require('ws');
const WebSocketServer = require('../index').WebSocketServer;
const assert = require('assert');

describe('WebSocketServer', function() {
  let server;

  before(function() {
    server = new WebSocketServer();
  });

  it('should handle connection', function(done) {
    const client = new WebSocket('ws://localhost:8765');
    client.on('open', function() {
      assert.ok(true);
      done();
    });
  });

  // Add more tests...
});
