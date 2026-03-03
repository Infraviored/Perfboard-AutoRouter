const http = require('http');
const fs = require('fs');

const PORT = 3001;
const LOG_FILE = 'benchmark_results.log';

console.log(`Benchmark Logger started on pin ${PORT}`);
console.log(`Writing results to ${LOG_FILE}...`);

http.createServer((req, res) => {
    console.log(`Incoming: ${req.method} ${req.url}`);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
        res.writeHead(200);
        res.end();
        return;
    }

    if (req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
            const timestamp = new Date().toISOString();
            const line = `[${timestamp}] ${body}\n`;
            fs.appendFileSync(LOG_FILE, line);
            console.log(`Captured: ${body}`);
            res.writeHead(200);
            res.end('Logged');
        });
    } else {
        console.log(`Ignored ${req.method} request`);
        res.writeHead(404);
        res.end();
    }
}).listen(PORT);
