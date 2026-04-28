// Must be set before any MongoDB driver code is loaded
if (typeof globalThis.crypto === 'undefined') {
  globalThis.crypto = require('crypto').webcrypto;
}

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const { scanDatabaseStream } = require('./scanners/db-scanner');

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
  const { connectionString } = req.body;
  if (!connectionString || !connectionString.trim()) {
    return res.status(400).json({ error: 'connectionString is required' });
  }
  const jobId = crypto.randomUUID();
  jobs.set(jobId, { connStr: connectionString.trim(), createdAt: Date.now() });
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

  scanDatabaseStream(job.connStr, (event) => {
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

app.get('/api/health', (_req, res) => res.json({ status: 'ok' }));

app.listen(PORT, () => {
  console.log(`DPDPA Scanner backend running on http://localhost:${PORT}`);
});
