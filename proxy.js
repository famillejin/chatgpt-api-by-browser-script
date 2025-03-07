const http = require('http');
const https = require('https');
const { URL } = require('url');

const HTTP_PORT = process.env.HTTP_PORT || 8766;
const OPENAI_API_URL = 'https://api.openai.com/v1/';

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://localhost:${HTTP_PORT}`);
  const openaiPath = url.pathname;

  console.log(`Forwarding request: ${req.method} ${openaiPath}`);

  const openaiOptions = {
    hostname: 'api.openai.com',
    path: openaiPath,
    method: req.method,
    headers: {
      ...req.headers,
      'Host': 'api.openai.com',
    },
  };

  const openaiReq = https.request(openaiOptions, (openaiRes) => {
    console.log(`Response Status: ${openaiRes.statusCode}`);
    console.log(`Response Headers: ${JSON.stringify(openaiRes.headers)}`);

    res.writeHead(openaiRes.statusCode, openaiRes.headers);
    let data = '';
    openaiRes.on('data', (chunk) => {
      data += chunk;
      //console.log('Received chunk:', chunk.toString());
    });
    openaiRes.on('end', () => {
      console.log('Complete response data:', data);
    });
    openaiRes.pipe(res);


  });

  openaiReq.on('error', (error) => {
    console.error(`Error forwarding request: ${error.message}`);
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end(`Error forwarding request: ${error.message}`);
  });

  req.pipe(openaiReq);

  req.on('end', () => {
    console.log('Request fully sent');
  });
});

server.listen(HTTP_PORT, () => {
  console.log(`Proxy server listening on http://localhost:${HTTP_PORT}`);
});

console.log(`Proxy server started. Forwarding to ${OPENAI_API_URL}`);
