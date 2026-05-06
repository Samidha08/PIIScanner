// Must be set before any MongoDB driver code is loaded
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = require('crypto').webcrypto;
}
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { scanDatabaseStream } = require('./scanners/db-scanner');
const { pushToNeo4j } = require('./neo4j-pusher');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// In-memory job store: jobId → { connStr, createdAt }
// Jobs expire after 2 minutes if the SSE stream never connects.
const jobs = new Map();
const JOB_TTL_MS = 120_000;

function pruneExpiredJobs() {
  const now = Date.now();
  for (const [id, job] of jobs.entries()) {
    if (now - job.createdAt > JOB_TTL_MS) jobs.delete(id);
  }
}
setInterval(pruneExpiredJobs, 30_000);

// ── Step 1: register a scan job, get back a jobId ────────────────────────────
app.post('/api/scan/start', (req, res) => {
  const { connectionString, spocName } = req.body;
  if (!connectionString || !connectionString.trim()) {
    return res.status(400).json({ error: 'connectionString is required' });
  }
  const jobId = crypto.randomUUID();
  jobs.set(jobId, { connStr: connectionString.trim(), spocName: spocName?.trim() || null, createdAt: Date.now() });
  res.json({ jobId });
});

// ── Step 2: stream scan progress via SSE ────────────────────────────────────
app.get('/api/scan/stream/:jobId', (req, res) => {
  const job = jobs.get(req.params.jobId);
  if (!job) return res.status(404).json({ error: 'Job not found or expired. Please start a new scan.' });
  jobs.delete(req.params.jobId); // consume once

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();

  let closed = false;
  req.on('close', () => { closed = true; });

  const send = (event, data) => {
    if (closed) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  // Heartbeat every 20s to prevent proxy/load-balancer idle timeouts
  const heartbeat = setInterval(() => {
    if (closed) { clearInterval(heartbeat); return; }
    res.write(': heartbeat\n\n');
  }, 20_000);

  scanDatabaseStream(job.connStr, job.spocName, (event) => {
    if (closed) return;
    if (event.type === 'building_graph') {
      send('building_graph', { message: 'Building graph…' });
    } else {
      send(event.type, event);
    }
  })
    .then(graphData => {
      send('complete', graphData);
    })
    .catch(err => {
      console.error('Stream scan error:', err.message);
      send('error', { error: err.message });
    })
    .finally(() => {
      clearInterval(heartbeat);
      if (!closed) res.end();
    });
});

// ── Neo4j push ────────────────────────────────────────────────────────────────
app.post('/api/neo4j/push', async (req, res) => {
  const { neo4jGraph, clearFirst } = req.body;

  // Use env vars if available, otherwise fall back to request body
  const boltUrl  = process.env.NEO4J_URI      || req.body.boltUrl;
  const username = process.env.NEO4J_USERNAME  || req.body.username;
  const password = process.env.NEO4J_PASSWORD  || req.body.password;

  if (!boltUrl || !neo4jGraph) {
    return res.status(400).json({ error: 'Neo4j URI not configured and not provided in request' });
  }
  try {
    const result = await pushToNeo4j({ boltUrl, username, password, neo4jGraph, clearFirst });
    res.json(result);
  } catch (err) {
    console.error('Neo4j push error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`DPDPA Scanner backend running on http://localhost:${PORT}`);
});
