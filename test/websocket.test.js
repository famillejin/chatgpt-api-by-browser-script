import WebSocket from 'ws';
import { WebSocketServer, CustomWebSocketServer } from '../index.js';
import assert from 'assert';
import utf8 from 'utf8';

describe('WebSocket Tests', function() {
    // Use different port than main app to avoid conflicts
    const TEST_PORT = 8767;
    const TEST_PORT_2 = 8769;
    let wsServer;

    before(function(done) {
        // Create a test server
        wsServer = new CustomWebSocketServer(TEST_PORT);
        
        // Allow time for server to initialize
        setTimeout(done, 100);
    });

    after(function() {
        // Clean up
        if (wsServer && wsServer.server) {
            wsServer.server.close();
        }
    });

    it('should establish a WebSocket connection', function(done) {
        this.timeout(5000); // Give more time
        const client = new WebSocket(`ws://localhost:${TEST_PORT}`);
        
        client.on('open', function() {
            assert.ok(true, 'Connection established successfully');
            client.close();
            done();
        });
        
        client.on('error', function(error) {
            assert.fail(`Failed to connect: ${error.message}`);
            done(error);
        });
    });

    it('should send and receive messages of random length (1-1000 chars)', function(done) {
        this.timeout(10000); // Give more time for this test
        
        // Generate random message length between 1 and 1000
        const randomLength = Math.floor(Math.random() * 1000) + 1;
        console.log(`Testing with message of length: ${randomLength}`);
        
        // Generate random string with various ASCII characters (33-126 are printable)
        const randomMessage = Array.from(
            { length: randomLength }, 
            () => String.fromCharCode(Math.floor(Math.random() * 94) + 33)
        ).join('');
        
        // Create a standalone server and client
        const server = new WebSocketServer({ port: 8768 });
        
        server.on('connection', function(ws) {
            ws.on('message', function(message) {
                try {
                    // Parse the incoming message
                    const data = JSON.parse(message.toString());
                    
                    // Echo back with answer type
                    ws.send(JSON.stringify({
                        type: 'answer',
                        text: data.text
                    }));
                } catch (error) {
                    console.error("Error in test server:", error);
                }
            });
        });
        
        // Connect client
        const client = new WebSocket('ws://localhost:8768');
        
        client.on('open', function() {
            // Send the random message
            const messageToSend = { type: 'test', text: randomMessage };
            client.send(JSON.stringify(messageToSend));
        });
        
        client.on('message', function(message) {
            try {
                const data = JSON.parse(message.toString());
                
                if (data.type === 'answer') {
                    // Verify the message content matches the original
                    assert.strictEqual(data.text, randomMessage, 'Message content should match exactly');
                    
                    // Log success if message lengths match
                    console.log(`Successfully verified message integrity. Length: ${randomMessage.length}`);
                    
                    // Clean up connections
                    client.close();
                    server.close(() => {
                        done();
                    });
                }
            } catch (error) {
                console.error("Error in test client:", error);
                done(error);
            }
        });
        
        client.on('error', function(error) {
            console.error(`WebSocket error: ${error.message}`);
            done(error);
        });
    });
    
    // Simplified test focusing on the echo functionality
    it('should correctly send a message and get it echoed back', function(done) {
        this.timeout(10000);
        
        // Use a shorter test message to reduce complexity
        const testMessage = "Test message " + Date.now();
        
        // Create a simple echo server
        const echoServer = new WebSocketServer({ port: 8770 });
        
        echoServer.on('connection', function(ws) {
            console.log('Echo server: client connected');
            
            ws.on('message', function(message) {
                console.log('Echo server: received message, echoing back');
                // Echo the message back unchanged
                ws.send(message.toString());
            });
        });
        
        // Connect a client to the echo server
        const client = new WebSocket('ws://localhost:8770');
        
        client.on('open', function() {
            console.log('Echo client: connected to server');
            client.send(testMessage);
        });
        
        client.on('message', function(message) {
            const received = message.toString();
            console.log(`Echo client: received message: "${received}"`);
            
            // Verify the message matches what we sent
            assert.strictEqual(received, testMessage, 'Echoed message should match sent message');
            
            // Clean up
            client.close();
            echoServer.close(() => {
                console.log('Echo test: successfully completed');
                done();
            });
        });
        
        client.on('error', function(error) {
            console.error('Echo client error:', error.message);
            echoServer.close();
            done(error);
        });
    });
});
