const { classifyColumn } = require('./pii-detector');
const { scanMongoDBStream } = require('./mongodb-scanner');

function parseConnectionString(connStr) {
  const s = connStr.trim();
  if (/^mongodb(\+srv)?:\/\//i.test(s)) return { type: 'mongodb', connStr: s };
  if (/^postgres(ql)?:\/\//i.test(s)) return { type: 'postgres', connStr: s };
  if (/^mysql:\/\//i.test(s)) {
    const url = new URL(s);
    return {
      type: 'mysql',
      config: {
        host: url.hostname,
        port: parseInt(url.port) || 3306,
        user: decodeURIComponent(url.username),
        password: decodeURIComponent(url.password),
        database: url.pathname.replace(/^\//, ''),
      },
    };
  }
  if (/^sqlite:\/\//i.test(s)) return { type: 'sqlite', path: s.replace(/^sqlite:\/\//i, '') };
  if (/\.(db|sqlite|sqlite3)$/i.test(s) || s.startsWith('./') || s.startsWith('/') || /^[A-Za-z]:[\\/]/.test(s)) {
    return { type: 'sqlite', path: s };
  }
  throw new Error('Unsupported database. Supported: MongoDB (mongodb:// or mongodb+srv://), PostgreSQL (postgresql://), MySQL (mysql://), SQLite (file path or sqlite://)');
}

// ─── SPOC helpers ──────────────────────────────────────────────────────────────

// Returns true if the column list contains a spoc_name-like column
function hasSpocColumn(cols) {
  return cols.some(c => /^spoc[_\s]?name$/i.test(String(c.column_name || c.COLUMN_NAME || c.name || '')));
}

// ─── PostgreSQL ────────────────────────────────────────────────────────────────

async function scanPostgres(connStr, onEvent = () => {}, spocName = null) {
  const { Client } = require('pg');
  const client = new Client({ connectionString: connStr, connectionTimeoutMillis: 15000, statement_timeout: 10000 });
  await client.connect();
  try {
    const dbRes = await client.query('SELECT current_database()');
    const dbName = dbRes.rows[0].current_database;

    const tablesRes = await client.query(`
      SELECT t.table_schema, t.table_name, COALESCE(c.reltuples::bigint, 0) AS row_count
      FROM information_schema.tables t
      LEFT JOIN pg_class c ON c.relname = t.table_name
      LEFT JOIN pg_namespace n ON n.oid = c.relnamespace AND n.nspname = t.table_schema
      WHERE t.table_type = 'BASE TABLE'
        AND t.table_schema NOT IN ('pg_catalog','information_schema','pg_toast')
      ORDER BY t.table_schema, t.table_name
    `);

    const columnsRes = await client.query(`
      SELECT table_schema, table_name, column_name, data_type, is_nullable, ordinal_position
      FROM information_schema.columns
      WHERE table_schema NOT IN ('pg_catalog','information_schema','pg_toast')
      ORDER BY table_schema, table_name, ordinal_position
    `);

    const columnMap = {};
    for (const col of columnsRes.rows) {
      const key = `${col.table_schema}.${col.table_name}`;
      if (!columnMap[key]) columnMap[key] = [];
      columnMap[key].push(col);
    }

    const tables = tablesRes.rows;
    onEvent({ type: 'discovered', collections: tables.length, databases: 1, dbNames: [dbName] });

    const result = { dbName, schemas: {} };
    let done = 0;

    for (const table of tables) {
      const { table_schema: schema, table_name: tableName } = table;
      const key = `${schema}.${tableName}`;
      if (!result.schemas[schema]) result.schemas[schema] = { tables: {} };

      const cols = columnMap[key] || [];
      const scannedColumns = [];

      const useSpocFilter = spocName && hasSpocColumn(cols);
      for (const col of cols) {
        let sampleValues = [];
        try {
          const spocClause = useSpocFilter ? ` AND spoc_name = $2` : '';
          const params = useSpocFilter ? [col.column_name, spocName] : [];
          const q = `SELECT "${col.column_name}" FROM "${schema}"."${tableName}" WHERE "${col.column_name}" IS NOT NULL${spocClause} LIMIT 10`;
          const r = await client.query(q, params);
          sampleValues = r.rows.map(r => r[col.column_name]);
        } catch (_) {}
        const piiMatches = classifyColumn(col.column_name, sampleValues);
        scannedColumns.push({ name: col.column_name, dataType: col.data_type, nullable: col.is_nullable === 'YES', piiMatches, hasPii: piiMatches.length > 0 });
      }

      result.schemas[schema].tables[tableName] = {
        rowCount: Number(table.row_count),
        columns: scannedColumns,
        piiColumnCount: scannedColumns.filter(c => c.hasPii).length,
      };

      done++;
      onEvent({ type: 'progress', db: schema, collection: tableName, done, total: tables.length, skipped: 0, piiFound: scannedColumns.some(c => c.hasPii) });
    }

    return result;
  } finally {
    await client.end();
  }
}

// ─── MySQL ─────────────────────────────────────────────────────────────────────

async function scanMySQL(config, onEvent = () => {}, spocName = null) {
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({ ...config, connectTimeout: 15000 });
  try {
    const [[dbRow]] = await conn.execute('SELECT DATABASE() as db');
    const dbName = dbRow.db || config.database;

    const [tables] = await conn.execute(`SELECT TABLE_NAME, TABLE_ROWS FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? AND TABLE_TYPE = 'BASE TABLE'`, [config.database]);
    const [columns] = await conn.execute(`SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, ORDINAL_POSITION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME, ORDINAL_POSITION`, [config.database]);

    const columnMap = {};
    for (const col of columns) {
      if (!columnMap[col.TABLE_NAME]) columnMap[col.TABLE_NAME] = [];
      columnMap[col.TABLE_NAME].push(col);
    }

    onEvent({ type: 'discovered', collections: tables.length, databases: 1, dbNames: [dbName] });

    const result = { dbName, schemas: { [config.database]: { tables: {} } } };
    let done = 0;

    for (const table of tables) {
      const tableName = table.TABLE_NAME;
      const tableCols = columnMap[tableName] || [];
      const useSpocFilter = spocName && hasSpocColumn(tableCols);
      const scannedColumns = [];
      for (const col of tableCols) {
        let sampleValues = [];
        try {
          const spocClause = useSpocFilter ? ' AND `spoc_name` = ?' : '';
          const params = useSpocFilter ? [spocName] : [];
          const [rows] = await conn.execute(
            `SELECT \`${col.COLUMN_NAME}\` FROM \`${tableName}\` WHERE \`${col.COLUMN_NAME}\` IS NOT NULL${spocClause} LIMIT 10`,
            params
          );
          sampleValues = rows.map(r => r[col.COLUMN_NAME]);
        } catch (_) {}
        const piiMatches = classifyColumn(col.COLUMN_NAME, sampleValues);
        scannedColumns.push({ name: col.COLUMN_NAME, dataType: col.DATA_TYPE, nullable: col.IS_NULLABLE === 'YES', piiMatches, hasPii: piiMatches.length > 0 });
      }

      result.schemas[config.database].tables[tableName] = {
        rowCount: Number(table.TABLE_ROWS) || 0,
        columns: scannedColumns,
        piiColumnCount: scannedColumns.filter(c => c.hasPii).length,
      };

      done++;
      onEvent({ type: 'progress', db: config.database, collection: tableName, done, total: tables.length, skipped: 0, piiFound: scannedColumns.some(c => c.hasPii) });
    }

    return result;
  } finally {
    await conn.end();
  }
}

// ─── SQLite ────────────────────────────────────────────────────────────────────

async function scanSQLite(filePath, onEvent = () => {}, spocName = null) {
  const Database = require('better-sqlite3');
  const db = new Database(filePath, { readonly: true });
  try {
    const dbName = filePath.split(/[\\/]/).pop().replace(/\.(db|sqlite|sqlite3)$/i, '');
    const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all();

    onEvent({ type: 'discovered', collections: tables.length, databases: 1, dbNames: [dbName] });

    const result = { dbName, schemas: { main: { tables: {} } } };
    let done = 0;

    for (const table of tables) {
      const tableName = table.name;
      const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all();
      let rowCount = 0;
      try { rowCount = db.prepare(`SELECT COUNT(*) as cnt FROM "${tableName}"`).get().cnt; } catch (_) {}

      const useSpocFilter = spocName && hasSpocColumn(columns);
      const scannedColumns = [];
      for (const col of columns) {
        let sampleValues = [];
        try {
          if (useSpocFilter) {
            sampleValues = db.prepare(`SELECT "${col.name}" FROM "${tableName}" WHERE "${col.name}" IS NOT NULL AND spoc_name = ? LIMIT 10`).all(spocName).map(r => r[col.name]);
          } else {
            sampleValues = db.prepare(`SELECT "${col.name}" FROM "${tableName}" WHERE "${col.name}" IS NOT NULL LIMIT 10`).all().map(r => r[col.name]);
          }
        } catch (_) {}
        const piiMatches = classifyColumn(col.name, sampleValues);
        scannedColumns.push({ name: col.name, dataType: col.type, nullable: col.notnull === 0, piiMatches, hasPii: piiMatches.length > 0 });
      }

      result.schemas.main.tables[tableName] = { rowCount, columns: scannedColumns, piiColumnCount: scannedColumns.filter(c => c.hasPii).length };

      done++;
      onEvent({ type: 'progress', db: 'main', collection: tableName, done, total: tables.length, skipped: 0, piiFound: scannedColumns.some(c => c.hasPii) });
    }

    return result;
  } finally {
    db.close();
  }
}

// ─── Graph builder ─────────────────────────────────────────────────────────────

function buildGraphData(scanResult, dbType) {
  const nodes = [];
  const edges = [];
  const summary = { totalTables: 0, totalColumns: 0, piiColumns: 0, piiByCategory: {} };

  const dbNodeId = `db_${scanResult.dbName}`;
  nodes.push({ id: dbNodeId, label: scanResult.dbName, type: 'database', dbType, color: '#1A252F', shape: 'diamond' });

  const categoryNodesAdded = new Set();

  for (const [schemaName, schema] of Object.entries(scanResult.schemas)) {
    const schemaNodeId = `schema_${schemaName}`;
    nodes.push({ id: schemaNodeId, label: schemaName, type: 'schema', color: '#2C3E50', shape: 'roundrectangle' });
    edges.push({ source: dbNodeId, target: schemaNodeId, type: 'HAS_SCHEMA' });

    for (const [tableName, table] of Object.entries(schema.tables)) {
      summary.totalTables++;
      const hasPii = table.piiColumnCount > 0;
      const tableNodeId = `table_${schemaName}_${tableName}`;

      nodes.push({ id: tableNodeId, label: tableName, type: 'table', rowCount: table.rowCount, columnCount: table.columns.length, piiColumnCount: table.piiColumnCount, hasPii, color: hasPii ? '#922B21' : '#154360', shape: 'roundrectangle' });
      edges.push({ source: schemaNodeId, target: tableNodeId, type: 'HAS_TABLE' });

      for (const col of table.columns) {
        summary.totalColumns++;
        // Only create graph nodes for PII columns — non-PII columns are counted in
        // summary.totalColumns but skipped from the graph to keep it renderable at scale.
        if (!col.hasPii) continue;

        summary.piiColumns++;
        const colNodeId = `col_${schemaName}_${tableName}_${col.name}`;
        nodes.push({ id: colNodeId, label: col.name, type: 'column', dataType: col.dataType, nullable: col.nullable, hasPii: true, piiMatches: col.piiMatches, color: '#E74C3C', shape: 'ellipse' });
        edges.push({ source: tableNodeId, target: colNodeId, type: 'HAS_COLUMN' });

        for (const match of col.piiMatches) {
          const catNodeId = `pii_${match.category}`;
          if (!categoryNodesAdded.has(catNodeId)) {
            categoryNodesAdded.add(catNodeId);
            nodes.push({ id: catNodeId, label: match.categoryInfo.label, type: 'pii_category', category: match.category, description: match.categoryInfo.description, dpdpaSection: match.categoryInfo.dpdpa_section, color: match.categoryInfo.color, shape: 'hexagon' });
          }
          if (!summary.piiByCategory[match.category]) {
            summary.piiByCategory[match.category] = { count: 0, label: match.categoryInfo.label, color: match.categoryInfo.color };
          }
          summary.piiByCategory[match.category].count++;
          edges.push({ source: colNodeId, target: catNodeId, type: 'CONTAINS_PII', confidence: match.confidence, matchedBy: match.matchedBy });
        }
      }
    }
  }

  return { nodes, edges, summary, dbName: scanResult.dbName, dbType, spocName: scanResult.spocName };
}

// ─── Neo4j graph builder ───────────────────────────────────────────────────────

function parseServerInfo(parsed) {
  try {
    if (parsed.type === 'sqlite') return { host: parsed.path, port: null };
    if (parsed.type === 'mysql') return { host: parsed.config.host, port: parsed.config.port || 3306 };
    // mongodb / postgres — extract first host from connection string
    const match = (parsed.connStr || '').match(/@([^/?]+)/);
    if (match) {
      const first = match[1].split(',')[0];
      const [host, port] = first.split(':');
      return { host: host || 'unknown', port: port ? parseInt(port) : null };
    }
  } catch (_) {}
  return { host: 'unknown', port: null };
}

function buildNeo4jGraph(scanResult, dbType, serverInfo, spocName) {
  const nodes = [];
  const rels = [];

  // ── Server node ──────────────────────────────────────────────────────────────
  const serverId = 'server_1';
  nodes.push({
    id: serverId,
    label: 'Server',
    properties: { host: serverInfo.host, port: serverInfo.port, dbType },
  });

  // ── Database node ─────────────────────────────────────────────────────────────
  const dbId = `db_${scanResult.dbName}`;
  nodes.push({
    id: dbId,
    label: 'Database',
    properties: { name: scanResult.dbName, dbType },
  });
  rels.push({ from: serverId, to: dbId, type: 'HOSTS' });

  // ── User / SPOC node ──────────────────────────────────────────────────────────
  let userId = null;
  if (spocName) {
    userId = `user_${spocName.toLowerCase().replace(/\s+/g, '_')}`;
    nodes.push({
      id: userId,
      label: 'User',
      properties: { name: spocName },
    });
  }

  const piiNodesAdded = new Set();

  for (const [schemaName, schema] of Object.entries(scanResult.schemas)) {
    const schemaId = `schema_${schemaName}`;
    nodes.push({
      id: schemaId,
      label: 'Schema',
      properties: { name: schemaName },
    });
    rels.push({ from: dbId, to: schemaId, type: 'HAS_SCHEMA' });

    for (const [tableName, table] of Object.entries(schema.tables)) {
      const fileId = `file_${schemaName}_${tableName}`;
      nodes.push({
        id: fileId,
        label: 'File',
        properties: {
          name: tableName,
          schema: schemaName,
          rowCount: table.rowCount,
          columnCount: table.columns.length,
          piiColumnCount: table.piiColumnCount,
          hasPii: table.piiColumnCount > 0,
        },
      });
      rels.push({ from: schemaId, to: fileId, type: 'HAS_FILE' });

      // User → File lineage
      if (userId) {
        rels.push({ from: userId, to: fileId, type: 'HAS_DATA_IN' });
      }

      const filePiiTypes = new Set();

      for (const col of table.columns) {
        const colId = `col_${schemaName}_${tableName}_${col.name}`;
        nodes.push({
          id: colId,
          label: 'Column',
          properties: {
            name: col.name,
            dataType: col.dataType || 'unknown',
            nullable: col.nullable,
            hasPii: col.hasPii,
          },
        });
        rels.push({ from: fileId, to: colId, type: 'HAS_COLUMN' });

        for (const match of col.piiMatches) {
          const piiId = `piitype_${match.category}`;

          if (!piiNodesAdded.has(piiId)) {
            piiNodesAdded.add(piiId);
            nodes.push({
              id: piiId,
              label: 'PIIType',
              properties: {
                category: match.category,
                name: match.categoryInfo.label,
                description: match.categoryInfo.description,
                dpdpaSection: match.categoryInfo.dpdpa_section,
                sensitive: /sensitive|biometric|financial|health|government/i.test(match.categoryInfo.dpdpa_section),
              },
            });
          }

          rels.push({ from: colId, to: piiId, type: 'CLASSIFIED_AS', properties: { confidence: match.confidence, matchedBy: match.matchedBy } });
          filePiiTypes.add(piiId);
        }
      }

      // File -[CONTAINS]-> PIIType  (direct data-lineage edge, as requested)
      for (const piiId of filePiiTypes) {
        rels.push({ from: fileId, to: piiId, type: 'CONTAINS' });
      }
    }
  }

  return { nodes, relationships: rels };
}

// ─── Public API ────────────────────────────────────────────────────────────────

async function scanDatabaseStream(connectionString, spocName, onEvent) {
  const parsed = parseConnectionString(connectionString);
  onEvent({ type: 'status', message: 'Connecting…', dbType: parsed.type });

  let rawResult;
  switch (parsed.type) {
    case 'mongodb': rawResult = await scanMongoDBStream(parsed.connStr, onEvent, spocName); break;
    case 'postgres': rawResult = await scanPostgres(parsed.connStr, onEvent, spocName); break;
    case 'mysql':    rawResult = await scanMySQL(parsed.config, onEvent, spocName); break;
    case 'sqlite':   rawResult = await scanSQLite(parsed.path, onEvent, spocName); break;
    default: throw new Error('Unsupported database type');
  }
  rawResult.spocName = spocName || null;

  // Count what we're about to build so the UI can show meaningful steps
  let totalTables = 0, totalPiiCols = 0;
  for (const schema of Object.values(rawResult.schemas)) {
    for (const table of Object.values(schema.tables)) {
      totalTables++;
      totalPiiCols += table.piiColumnCount;
    }
  }
  const schemaCount = Object.keys(rawResult.schemas).length;

  onEvent({ type: 'building_graph', step: 1, steps: 4, message: `Analysing ${schemaCount} schema(s) / ${totalTables} collection(s)…` });
  await new Promise(r => setImmediate(r)); // yield so the event flushes before CPU work

  onEvent({ type: 'building_graph', step: 2, steps: 4, message: `Creating ${totalTables} collection nodes…` });
  await new Promise(r => setImmediate(r));

  onEvent({ type: 'building_graph', step: 3, steps: 4, message: `Mapping ${totalPiiCols} PII field(s) to DPDPA categories…` });
  await new Promise(r => setImmediate(r));

  const graph = buildGraphData(rawResult, parsed.type);
  const serverInfo = parseServerInfo(parsed);
  const neo4jGraph = buildNeo4jGraph(rawResult, parsed.type, serverInfo, spocName);

  onEvent({ type: 'building_graph', step: 4, steps: 4, message: `Finalising graph (${graph.nodes.length} nodes, ${graph.edges.length} edges)…` });
  await new Promise(r => setImmediate(r));

  return { ...graph, neo4jGraph };
}

module.exports = { scanDatabaseStream };
