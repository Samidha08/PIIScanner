# DPDPA PII Scanner

A full-stack application that connects to your database, scans it for Personally Identifiable Information (PII) governed by India's **Digital Personal Data Protection Act (DPDPA)**, and visualises the results as an interactive graph — similar to Neo4j Browser.

---

## Screenshots

| Connection Screen | Scan Progress | Graph View |
|---|---|---|
| Enter any supported DB connection string | Live progress with per-collection status | Interactive Neo4j-style graph |

---

## Features

- **Multi-database support** — MongoDB (including replica sets & Atlas), PostgreSQL, MySQL, SQLite
- **DPDPA-aware PII detection** — classifies fields into 8 categories defined under the Act
- **Two-pass detection** — column name pattern matching + actual data value regex matching
- **Streaming scan** — Server-Sent Events (SSE) stream results live; no timeout on large databases
- **Interactive graph** — powered by Cytoscape.js; click any node for details
- **3 view modes** — All nodes / PII-only / PII category map
- **3 layout algorithms** — Force-directed, Tree (breadthfirst), Radial (concentric)
- **Auto layout** — large graphs automatically switch to the fast O(n) tree layout
- **Cancel mid-scan** — abort any running scan at any time

---

## DPDPA PII Categories Detected

| Category | Examples | DPDPA Reference |
|---|---|---|
| Personal Identity | name, dob, gender, age, father_name | Section 2(t) |
| Contact Information | email, phone, mobile, address, pincode | Section 2(t) |
| Government ID | aadhaar, pan, passport, voter_id, driving_license | Section 2(m) — Sensitive |
| Financial Data | bank_account, ifsc, credit_card, upi, salary | Section 2(m) — Sensitive |
| Health & Medical | blood_group, diagnosis, insurance, prescription | Section 2(m) — Sensitive |
| Biometric Data | fingerprint, face_id, iris, retina | Section 2(m) — Sensitive |
| Digital Identity | ip_address, device_id, gps, cookies, session_id | Section 2(t) |
| Sensitive Personal | religion, caste, political_view, sexual_orientation | Section 2(m) — Sensitive |

---

## Tech Stack

### Backend
| Package | Purpose |
|---|---|
| `express` | REST + SSE API server |
| `mongodb` | MongoDB driver (replica sets, Atlas, SCRAM-SHA-1) |
| `pg` | PostgreSQL driver |
| `mysql2` | MySQL driver |
| `better-sqlite3` | SQLite driver (synchronous, fast) |

### Frontend
| Package | Purpose |
|---|---|
| `react` + `vite` | UI framework + dev server |
| `cytoscape` | Interactive graph visualisation |
| `typescript` | Type safety |

### PII Detection
- **Pass 1** — regex on column/field names (`aadhaar`, `pan`, `email`, etc.)
- **Pass 2** — regex on sampled data values (Aadhaar format, PAN format, IPv4, blood group, etc.)
- Confidence levels: `HIGH` / `MEDIUM` based on match strength

---

## Project Structure

```
newApp/
├── backend/
│   ├── src/
│   │   ├── server.js                  # Express server, SSE endpoints
│   │   └── scanners/
│   │       ├── db-scanner.js          # Router + graph builder
│   │       ├── mongodb-scanner.js     # MongoDB streaming scanner
│   │       └── pii-detector.js        # PII rules engine (DPDPA categories)
│   └── package.json
├── frontend/
│   ├── src/
│   │   ├── App.tsx                    # App state + SSE client
│   │   ├── components/
│   │   │   ├── ConnectionForm.tsx     # DB connection input
│   │   │   ├── ScanProgress.tsx       # Live progress screen
│   │   │   ├── GraphVisualization.tsx # Cytoscape graph
│   │   │   ├── SummaryPanel.tsx       # Stats sidebar
│   │   │   └── NodeDetailPanel.tsx    # Node detail on click
│   │   └── types/index.ts
│   └── package.json
├── demo/
│   └── sample.db                      # SQLite demo database with PII data
└── README.md
```

---

## Getting Started

### Prerequisites
- Node.js 18+
- npm 8+

### 1. Install dependencies

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### 2. Start the backend

```bash
cd backend
node src/server.js
# Running on http://localhost:3001
```

### 3. Start the frontend

```bash
cd frontend
npm run dev
# Running on http://localhost:5173
```

### 4. Open in browser

```
http://localhost:5173
```

---

## Supported Connection Strings

| Database | Format | Example |
|---|---|---|
| MongoDB | `mongodb://user:pass@host:port/db` | `mongodb://admin:secret@localhost:27017/mydb` |
| MongoDB Atlas | `mongodb+srv://user:pass@cluster/db` | `mongodb+srv://user:pass@cluster.mongodb.net/mydb` |
| MongoDB Replica Set | `mongodb://user:pass@h1:port,h2:port,h3:port/db?replicaSet=RS` | See note below |
| PostgreSQL | `postgresql://user:pass@host:port/db` | `postgresql://postgres:secret@localhost:5432/mydb` |
| MySQL | `mysql://user:pass@host:port/db` | `mysql://root:secret@localhost:3306/mydb` |
| SQLite | File path | `C:/data/mydb.db` or `./local.db` |

> **MongoDB replica sets**: full URI options are supported, e.g.:
> ```
> mongodb://user:pass@10.0.0.1:27017,10.0.0.2:27017,10.0.0.3:27017/admin?replicaSet=RS0&authSource=admin&authMechanism=SCRAM-SHA-1
> ```
> If the URI points to a system database (`admin`, `local`, `config`), the scanner automatically discovers and scans all accessible data databases.

---

## API Reference

### `POST /api/scan/start`
Registers a scan job. Returns a `jobId` used to open the SSE stream.

**Request body:**
```json
{ "connectionString": "mongodb://..." }
```

**Response:**
```json
{ "jobId": "uuid-v4" }
```

### `GET /api/scan/stream/:jobId`
Server-Sent Events stream. Events:

| Event | Payload | Description |
|---|---|---|
| `status` | `{ message, dbType }` | Connection status |
| `discovered` | `{ databases, collections, dbNames }` | Schema discovery complete |
| `progress` | `{ db, collection, done, total, skipped, piiFound, timedOut }` | Per-collection result |
| `building_graph` | `{ step, steps, message }` | Graph construction progress (4 steps) |
| `complete` | Full graph data | Scan finished — graph ready to render |
| `error` | `{ error }` | Scan failed |

---

## MongoDB Scanning — How It Works

Since MongoDB is schema-less, the scanner uses a sampling approach:

1. **Discover databases** — calls `listDatabases()` or uses the DB from the URI
2. **List collections** — up to 200 collections per database, 20 databases max
3. **Sample documents** — `$sample { size: 15 }` aggregation per collection (falls back to `find().limit(15)`)
4. **Flatten nested documents** — `{ address: { city: "Mumbai" } }` → field `address.city`
5. **Unwrap arrays** — first element of arrays is used for type and PII detection
6. **Parallel scan** — all collections across all databases run in a single concurrent pool (5 at a time)
7. **Per-collection timeout** — collections that take > 8 seconds are skipped and marked as `timeout`

---

## Performance

| Scenario | Behaviour |
|---|---|
| Small DB (< 50 collections) | Completes in seconds |
| Large DB (768 collections, 20 databases) | Streams progress live, ~2–5 min depending on network |
| Slow collection | Skipped after 8s timeout, scan continues |
| Large graph (> 150 nodes) | Auto-switches to fast O(n) tree layout |
| High-frequency events | Batched into React state at max 150ms intervals to prevent UI lag |

---

## Demo Database

A sample SQLite database is included at `demo/sample.db` with realistic PII data:

| Table | PII Fields |
|---|---|
| `customers` | full_name, email, phone, dob, aadhaar, pan, address, pincode |
| `employees` | first_name, email, mobile, salary, bank_account, ifsc, blood_group, religion |
| `transactions` | upi, credit_card, ip_address |
| `products` | *(no PII — name, price, category, stock)* |

Use connection string: `C:/samidha/newApp/demo/sample.db`

---

## License

Internal use only.
