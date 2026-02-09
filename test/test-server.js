/**
 * SIMPLIFIED TEST SERVER FOR LOAD-SHEDDER
 * Mocks Pro3 and provides test scenario control
 * load-shedder.js runs on the real Shelly with TEST_MODE=true
 */

const http = require('http');

const PORT = 3100; // Pro3 mock server port

class Pro3MockServer {
  constructor() {
    this.relayStates = [true, true, true]; // All relays ON initially
    this.version = "1.0-mock";
    this.online = true;
  }

  start() {
    const server = http.createServer((req, res) => this.handleRequest(req, res));
    server.listen(PORT, () => {
      console.log('╔' + '═'.repeat(78) + '╗');
      console.log('║' + ' '.repeat(25) + 'PRO3 MOCK SERVER' + ' '.repeat(37) + '║');
      console.log('╚' + '═'.repeat(78) + '╝\n');
      console.log(`🔌 Pro3 Mock running on http://localhost:${PORT}\n`);
      console.log('Available endpoints:');
      console.log(`  GET  /script/[SCRIPT_ID]/heartbeat - Pro3 heartbeat (mocked)`);
      console.log(`  GET  /rpc/Switch.Set?id=[0-2]&on=[true|false] - Relay commands`);
      console.log(`  POST /set-relay - Manually set relay state`);
      console.log(`  POST /set-online - Set Pro3 online/offline`);
      console.log(`  GET  /status - Get current mock state\n`);
      console.log('💡 Tip: Configure SHELLY_IP in scenarios.js to target your Shelly');
      console.log('─'.repeat(80));
    });
  }

  handleRequest(req, res) {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(200);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://localhost:${PORT}`);

    try {
      // Pro3 heartbeat endpoint (called by load-shedder)
      // Matches any /script/*/heartbeat path
      if (req.method === 'GET' && url.pathname.match(/^\/script\/\d+\/heartbeat$/)) {
        this.handleHeartbeat(req, res);
      }
      // Control endpoints
      else if (req.method === 'POST' && url.pathname === '/set-relay') {
        this.handleSetRelay(req, res);
      } else if (req.method === 'POST' && url.pathname === '/set-online') {
        this.handleSetOnline(req, res);
      } else if (req.method === 'GET' && url.pathname === '/status') {
        this.handleGetStatus(req, res);
      } else if (req.method === 'GET' && url.pathname === '/rpc/Switch.Set') {
        this.handleSwitchSet(req, res, url);
      } else {
        this.sendResponse(res, 404, { error: 'Not found' });
      }
    } catch (error) {
      console.error('❌ Error handling request:', error);
      this.sendResponse(res, 500, { error: error.message });
    }
  }

  handleHeartbeat(req, res) {
    if (!this.online) {
      console.log('💔 Heartbeat failed (offline mode)');
      res.writeHead(500);
      res.end();
      return;
    }

    const response = {
      version: this.version,
      relays: {
        relay0: this.relayStates[0],
        relay1: this.relayStates[1],
        relay2: this.relayStates[2]
      }
    };

    console.log(`💓 Heartbeat received - Relays: [${this.relayStates.map(s => s ? 'ON' : 'OFF').join(', ')}]`);
    this.sendResponse(res, 200, response);
  }

  handleSwitchSet(req, res, url) {
    const params = url.searchParams;
    const relayId = parseInt(params.get('id'));
    const isOn = params.get('on') === 'true';

    if (relayId >= 0 && relayId <= 2) {
      const oldState = this.relayStates[relayId];
      this.relayStates[relayId] = isOn;
      console.log(`🔄 Relay ${relayId} command: ${oldState ? 'ON' : 'OFF'} → ${isOn ? 'ON' : 'OFF'}`);

      this.sendResponse(res, 200, {
        was_on: oldState,
        ison: isOn
      });
    } else {
      this.sendResponse(res, 400, { error: 'Invalid relay ID' });
    }
  }

  handleSetRelay(req, res) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        const relayId = data.relayId;
        const state = data.state;

        if (relayId >= 0 && relayId <= 2) {
          this.relayStates[relayId] = state;
          console.log(`🔧 Manual relay ${relayId} set to ${state ? 'ON' : 'OFF'}`);
          this.sendResponse(res, 200, { success: true, relayId, state });
        } else {
          this.sendResponse(res, 400, { error: 'Invalid relay ID (0-2)' });
        }
      } catch (error) {
        this.sendResponse(res, 400, { error: 'Invalid JSON' });
      }
    });
  }

  handleSetOnline(req, res) {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const data = JSON.parse(body);
        this.online = data.online === true;
        console.log(`🌐 Pro3 mock set to ${this.online ? 'ONLINE' : 'OFFLINE'}`);
        this.sendResponse(res, 200, { success: true, online: this.online });
      } catch (error) {
        this.sendResponse(res, 400, { error: 'Invalid JSON' });
      }
    });
  }

  handleGetStatus(req, res) {
    this.sendResponse(res, 200, {
      online: this.online,
      version: this.version,
      relays: this.relayStates,
      relayStatus: this.relayStates.map((s, i) => `Relay ${i}: ${s ? 'ON' : 'OFF'}`)
    });
  }

  sendResponse(res, statusCode, data) {
    res.writeHead(statusCode, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data, null, 2));
  }
}

// Start server
console.log('');
const server = new Pro3MockServer();
server.start();

// Graceful shutdown
process.on('SIGINT', () => {
  console.log('\n\n👋 Shutting down Pro3 mock server...');
  process.exit(0);
});
