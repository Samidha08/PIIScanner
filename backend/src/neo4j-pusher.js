const neo4j = require('neo4j-driver');

// ── HTTP API (port 443) ────────────────────────────────────────────────────────
// Used as primary path — bypasses the Bolt port (7687) that corporate firewalls block.

function extractHost(boltUrl) {
  return boltUrl
    .replace(/^(bolt\+s|bolt|neo4j\+s|neo4j):\/\//, '')
    .replace(/:\d+$/, '');
}

async function pushViaHttp({ host, username, password, neo4jGraph, clearFirst, database = 'neo4j' }) {
  const txUrl = `https://${host}/db/${database}/tx/commit`;
  const auth = Buffer.from(`${username}:${password}`).toString('base64');
  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Basic ${auth}`,
  };

  const runCypher = async (statement, parameters = {}) => {
    const res = await fetch(txUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ statements: [{ statement, parameters }] }),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`HTTP ${res.status}: ${text}`);
    }
    const data = await res.json();
    if (data.errors && data.errors.length > 0) throw new Error(data.errors[0].message);
    return data;
  };

  // Verify connectivity with a simple query
  await runCypher('RETURN 1');

  if (clearFirst) await runCypher('MATCH (n) DETACH DELETE n');

  const { nodes, relationships } = neo4jGraph;

  // Nodes grouped by label
  const byLabel = {};
  for (const node of nodes) {
    if (!byLabel[node.label]) byLabel[node.label] = [];
    byLabel[node.label].push({ id: node.id, ...node.properties });
  }
  for (const [label, batch] of Object.entries(byLabel)) {
    await runCypher(
      `UNWIND $batch AS props MERGE (n:\`${label}\` {id: props.id}) SET n += props`,
      { batch }
    );
  }

  // Relationships grouped by type
  const byType = {};
  for (const rel of relationships) {
    if (!byType[rel.type]) byType[rel.type] = [];
    byType[rel.type].push({ from: rel.from, to: rel.to, ...(rel.properties || {}) });
  }
  for (const [type, batch] of Object.entries(byType)) {
    await runCypher(
      `UNWIND $batch AS r MATCH (a {id: r.from}), (b {id: r.to}) MERGE (a)-[rel:\`${type}\`]->(b) SET rel += r`,
      { batch }
    );
  }

  return { success: true, nodeCount: nodes.length, relCount: relationships.length };
}

// ── Bolt API (port 7687) ───────────────────────────────────────────────────────

async function pushViaBolt({ boltUrl, username, password, neo4jGraph, clearFirst }) {
  const urls = [boltUrl];
  if (boltUrl.startsWith('neo4j+s://')) urls.push(boltUrl.replace('neo4j+s://', 'bolt+s://'));
  else if (boltUrl.startsWith('neo4j://')) urls.push(boltUrl.replace('neo4j://', 'bolt://'));

  let driver, lastErr;
  for (const url of urls) {
    const d = neo4j.driver(url, neo4j.auth.basic(username, password), {
      connectionTimeoutMs: 10_000,
    });
    try {
      await d.verifyConnectivity();
      driver = d;
      break;
    } catch (err) {
      await d.close();
      lastErr = err;
    }
  }
  if (!driver) throw lastErr;

  const session = driver.session();
  try {
    if (clearFirst) await session.run('MATCH (n) DETACH DELETE n');

    const { nodes, relationships } = neo4jGraph;
    const byLabel = {};
    for (const node of nodes) {
      if (!byLabel[node.label]) byLabel[node.label] = [];
      byLabel[node.label].push({ id: node.id, ...node.properties });
    }
    for (const [label, batch] of Object.entries(byLabel)) {
      await session.run(
        `UNWIND $batch AS props MERGE (n:\`${label}\` {id: props.id}) SET n += props`,
        { batch }
      );
    }

    const byType = {};
    for (const rel of relationships) {
      if (!byType[rel.type]) byType[rel.type] = [];
      byType[rel.type].push({ from: rel.from, to: rel.to, ...(rel.properties || {}) });
    }
    for (const [type, batch] of Object.entries(byType)) {
      await session.run(
        `UNWIND $batch AS r MATCH (a {id: r.from}), (b {id: r.to}) MERGE (a)-[rel:\`${type}\`]->(b) SET rel += r`,
        { batch }
      );
    }

    return { success: true, nodeCount: nodes.length, relCount: relationships.length };
  } finally {
    await session.close();
    await driver.close();
  }
}

// ── Public API — tries HTTP (port 443) first, Bolt (port 7687) as fallback ────

async function pushToNeo4j({ boltUrl, username, password, neo4jGraph, clearFirst = false }) {
  const host = extractHost(boltUrl);

  // Try HTTP with both common AuraDB database names
  const dbNames = ['neo4j', username]; // AuraDB Free uses 'neo4j'; some use the username/instance ID
  let httpErr;
  for (const database of dbNames) {
    try {
      const result = await pushViaHttp({ host, username, password, neo4jGraph, clearFirst, database });
      console.log(`HTTP API succeeded with database="${database}"`);
      return result;
    } catch (err) {
      console.warn(`HTTP API failed (database="${database}"):`, err.message);
      httpErr = err;
    }
  }

  // Bolt fallback — log clearly so we know which path ran
  console.warn('All HTTP attempts failed, trying Bolt. HTTP error:', httpErr?.message);
  try {
    return await pushViaBolt({ boltUrl, username, password, neo4jGraph, clearFirst });
  } catch (boltErr) {
    // Throw the HTTP error if it looks like a proper API error (not just connectivity)
    // otherwise throw the Bolt error
    const isConnErr = (e) => /ECONNREFUSED|ETIMEDOUT|ENOTFOUND/.test(e?.message || '');
    throw isConnErr(httpErr) ? boltErr : httpErr;
  }
}

module.exports = { pushToNeo4j };
