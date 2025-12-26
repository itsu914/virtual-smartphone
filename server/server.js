const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const bodyParser = require('body-parser');
const cors = require('cors');
const app = express();
app.use(cors());
app.use(bodyParser.json());

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

let clients = new Set();

wss.on('connection', (ws) => {
  ws.id = Math.random().toString(36).slice(2,9);
  clients.add(ws);
  console.log('client connected', ws.id);

  ws.on('message', (msg) => {
    try {
      const m = JSON.parse(msg);
      handleMessage(ws, m);
    } catch(e){
      console.error('invalid message', msg);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    console.log('client disconnected', ws.id);
  });
});

function broadcast(obj, except = null){
  const s = JSON.stringify(obj);
  for(const c of clients){
    if(c !== except && c.readyState === WebSocket.OPEN) c.send(s);
  }
}

function handleMessage(ws, m){
  const { type, payload } = m;
  if(type === 'message'){
    // broadcast message
    broadcast({ type:'message', payload });
  } else if(type === 'snapshot'){
    // here you could store snapshot to DB / file. For demo just broadcast ack
    console.log('snapshot', payload);
    ws.send(JSON.stringify({ type:'snapshot', payload:{ status:'ok', savedAt:new Date().toISOString() }}));
  } else if(type === 'offer'){
    // broadcast offer to others
    broadcast({ type:'offer', payload }, ws);
  } else if(type === 'answer'){
    broadcast({ type:'answer', payload }, ws);
  } else if(type === 'ice'){
    broadcast({ type:'ice', payload }, ws);
  } else {
    console.log('unknown type', type);
  }
}

// simple API to list stored snapshots (demo: none persisted)
app.get('/health', (req, res) => res.json({ ok: true, ts: Date.now() }));

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on ${PORT}`));
