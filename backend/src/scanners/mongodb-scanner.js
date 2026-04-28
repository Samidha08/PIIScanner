const { MongoClient } = require('mongodb');
const { classifyColumn } = require('./pii-detector');

const SAMPLE_SIZE = 15;          // docs sampled per collection (reduced for speed)
const MAX_COLLECTIONS_PER_DB = 200;
const MAX_DBS = 20;
const FIELD_SAMPLE_VALUES = 10;
const COLLECTION_TIMEOUT_MS = 8000;
const SCAN_CONCURRENCY = 5;      // collections scanned in parallel
const SYSTEM_DBS = new Set(['admin', 'local', 'config']);

function parseMongoDbName(connectionString) {
  const match = connectionString.match(
    /^mongodb(?:\+srv)?:\/\/(?:[^@]+@)?[^/]+\/([^?&\s]+)/
  );
  if (!match || !match[1] || match[1] === '') return null;
  return decodeURIComponent(match[1]);
}

function flattenDoc(obj, prefix = '', depth = 0) {
  if (depth > 4) return {};
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (k === '_id') continue;
    const key = prefix ? `${prefix}.${k}` : k;
    if (v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date) && !Buffer.isBuffer(v)) {
      Object.assign(out, flattenDoc(v, key, depth + 1));
    } else if (Array.isArray(v)) {
      const first = v.find(x => x !== null && x !== undefined);
      if (first != null) {
        if (typeof first === 'object' && !Array.isArray(first) && !(first instanceof Date)) {
          Object.assign(out, flattenDoc(first, key, depth + 1));
        } else {
          out[key] = first;
        }
      }
    } else {
      out[key] = v;
    }
  }
  return out;
}

function extractFields(docs) {
  const fieldMap = {};
  for (const doc of docs) {
    const flat = flattenDoc(doc);
    for (const [field, value] of Object.entries(flat)) {
      if (!fieldMap[field]) fieldMap[field] = { values: [], dataTypes: new Set() };
      if (value != null && fieldMap[field].values.length < FIELD_SAMPLE_VALUES) {
        fieldMap[field].values.push(value instanceof Date ? value.toISOString() : String(value));
      }
      if (value != null) {
        fieldMap[field].dataTypes.add(value instanceof Date ? 'date' : typeof value);
      }
    }
  }
  return fieldMap;
}

function inferType(dataTypes) {
  if (dataTypes.has('number')) return 'Number';
  if (dataTypes.has('boolean')) return 'Boolean';
  if (dataTypes.has('date')) return 'Date';
  if (dataTypes.has('string')) return 'String';
  return 'Mixed';
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`timed_out_${ms}ms`)), ms)
    ),
  ]);
}

async function runConcurrent(tasks, limit) {
  const results = new Array(tasks.length);
  let idx = 0;
  async function worker() {
    while (idx < tasks.length) {
      const i = idx++;
      results[i] = await tasks[i]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return results;
}

async function scanCollection(db, collName) {
  const collection = db.collection(collName);

  let rowCount = 0;
  try { rowCount = await collection.estimatedDocumentCount(); } catch (_) {}

  let sampleDocs = [];
  try {
    sampleDocs = await collection.aggregate([{ $sample: { size: SAMPLE_SIZE } }]).toArray();
  } catch (_) {
    try { sampleDocs = await collection.find({}).limit(SAMPLE_SIZE).toArray(); } catch (_2) {}
  }

  const fieldMap = extractFields(sampleDocs);
  const scannedColumns = [{
    name: '_id', dataType: 'ObjectId', nullable: false, piiMatches: [], hasPii: false,
  }];

  for (const [fieldName, info] of Object.entries(fieldMap)) {
    const piiMatches = classifyColumn(fieldName, info.values);
    scannedColumns.push({
      name: fieldName,
      dataType: inferType(info.dataTypes),
      nullable: true,
      piiMatches,
      hasPii: piiMatches.length > 0,
    });
  }

  return {
    rowCount,
    columns: scannedColumns,
    piiColumnCount: scannedColumns.filter(c => c.hasPii).length,
  };
}

/**
 * Streaming MongoDB scan — calls onEvent as each collection finishes.
 * Returns the final raw result in the same shape as the SQL scanners.
 */
async function scanMongoDBStream(connectionString, onEvent) {
  const parsedDb = parseMongoDbName(connectionString);

  const client = new MongoClient(connectionString, {
    serverSelectionTimeoutMS: 15000,
    connectTimeoutMS: 15000,
    socketTimeoutMS: 30000,
  });

  onEvent({ type: 'status', message: 'Connecting to MongoDB…' });
  await client.connect();

  try {
    // Discover databases
    let databaseNames;
    const isSystemOrEmpty = !parsedDb || SYSTEM_DBS.has(parsedDb);

    if (isSystemOrEmpty) {
      try {
        const dbList = await client.db('admin').admin().listDatabases();
        databaseNames = dbList.databases
          .map(d => d.name)
          .filter(n => !SYSTEM_DBS.has(n))
          .slice(0, MAX_DBS);
      } catch (_) {
        databaseNames = parsedDb && !SYSTEM_DBS.has(parsedDb) ? [parsedDb] : [];
      }
    } else {
      databaseNames = [parsedDb];
    }

    if (databaseNames.length === 0) {
      throw new Error(
        'No accessible data databases found. Specify a database name in the URI (e.g. mongodb://host/mydb) or grant listDatabases permission.'
      );
    }

    // Count total collections across all databases
    const dbCollectionMap = {};
    let totalCollections = 0;
    for (const dbName of databaseNames) {
      const colls = await client.db(dbName).listCollections().toArray();
      dbCollectionMap[dbName] = colls.slice(0, MAX_COLLECTIONS_PER_DB).map(c => c.name);
      totalCollections += dbCollectionMap[dbName].length;
    }

    onEvent({
      type: 'discovered',
      databases: databaseNames.length,
      collections: totalCollections,
      dbNames: databaseNames,
    });

    const result = { dbName: databaseNames[0], schemas: {} };
    for (const dbName of databaseNames) result.schemas[dbName] = { tables: {} };

    let doneCount = 0;
    let skippedCount = 0;

    // Flatten ALL (db, collection) pairs into one pool and run globally concurrent.
    // This avoids the sequential-per-DB bottleneck when there are many databases.
    const allTasks = [];
    for (const dbName of databaseNames) {
      const db = client.db(dbName);
      for (const collName of dbCollectionMap[dbName]) {
        allTasks.push(async () => {
          try {
            const tableResult = await withTimeout(
              scanCollection(db, collName),
              COLLECTION_TIMEOUT_MS
            );
            result.schemas[dbName].tables[collName] = tableResult;
            doneCount++;
            onEvent({ type: 'progress', db: dbName, collection: collName, done: doneCount, skipped: skippedCount, total: totalCollections, piiFound: tableResult.piiColumnCount > 0 });
          } catch (_) {
            skippedCount++;
            doneCount++;
            onEvent({ type: 'progress', db: dbName, collection: collName, done: doneCount, skipped: skippedCount, total: totalCollections, piiFound: false, timedOut: true });
          }
        });
      }
    }

    await runConcurrent(allTasks, SCAN_CONCURRENCY);

    return result;
  } finally {
    await client.close();
  }
}

module.exports = { scanMongoDBStream };
