import React, { useEffect, useRef, useState, useCallback } from 'react';
import cytoscape, { Core, NodeSingular } from 'cytoscape';
import { GraphNode, GraphEdge, ScanResult } from '../types';
import NodeDetailPanel from './NodeDetailPanel';
import SummaryPanel from './SummaryPanel';
import Neo4jPushModal from './Neo4jPushModal';

function buildYaml(data: ScanResult): string {
  const safeName = data.dbName.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const lines: string[] = [];

  lines.push('dataset:');
  lines.push(`  name: ${safeName}_pii_dataset`);
  lines.push(`  description: PII dataset scanned from ${data.dbName}${data.spocName ? ` for ${data.spocName}` : ''}`);
  lines.push('  data_categories:');
  lines.push('    - user');
  lines.push('  retention:');
  lines.push('    policy: no_retention_policy_defined');
  lines.push('  collections:');

  const nodeById = new Map(data.nodes.map(n => [n.id, n]));

  // table → [columnId]
  const tableToColumns = new Map<string, string[]>();
  // columnId → [pii label]
  const columnToPii = new Map<string, string[]>();

  for (const edge of data.edges) {
    if (edge.type === 'HAS_COLUMN') {
      if (!tableToColumns.has(edge.source)) tableToColumns.set(edge.source, []);
      tableToColumns.get(edge.source)!.push(edge.target);
    }
    if (edge.type === 'CONTAINS_PII') {
      if (!columnToPii.has(edge.source)) columnToPii.set(edge.source, []);
      const piiNode = nodeById.get(edge.target);
      if (piiNode) columnToPii.get(edge.source)!.push(piiNode.label);
    }
  }

  const tableNodes = data.nodes.filter(n => n.type === 'table');

  for (const table of tableNodes) {
    const columnIds = tableToColumns.get(table.id) ?? [];
    const columns = columnIds.map(id => nodeById.get(id)).filter(Boolean) as GraphNode[];

    // Detect primary key: first column named 'id' or '<tableSingular>_id'
    const tableBase = table.label.replace(/s$/, '');
    const pkCol = columns.find(c =>
      c.label === 'id' || c.label === `${tableBase}_id` || c.label === `${table.label}_id`
    ) ?? columns.find(c => c.label.endsWith('_id'));

    lines.push(`    - name: ${table.label}`);
    lines.push(`      description: ${table.label} table`);
    if (pkCol) lines.push(`      primary_key: ${pkCol.label}`);
    lines.push('      fields:');

    for (const col of columns) {
      const piiLabels = columnToPii.get(col.id) ?? [];
      const isPk = pkCol?.id === col.id;
      lines.push(`        - name: ${col.label}`);
      if (isPk) {
        lines.push(`          data_categories: [user.unique_id]`);
        lines.push('          is_primary_key: true');
      } else if (piiLabels.length > 0) {
        lines.push(`          data_categories: [${piiLabels.join(', ')}]`);
      } else {
        lines.push('          data_categories: [system.operations]');
      }
    }
    lines.push('');
  }

  return lines.join('\n');
}

interface Props {
  data: ScanResult;
  onReset: () => void;
}

type FilterType = 'all' | 'pii_only' | 'pii_category';

// For large graphs, breadthfirst is O(n) — cose is O(n²) and will freeze the tab
const autoLayout = (nodeCount: number) => nodeCount > 150 ? 'breadthfirst' : 'cose';

const NODE_SIZE: Record<string, number> = {
  database: 70,
  schema: 50,
  table: 42,
  column: 28,
  pii_category: 55,
};

const EDGE_COLOR: Record<string, string> = {
  HAS_SCHEMA: '#30363d',
  HAS_TABLE: '#30363d',
  HAS_COLUMN: '#21262d',
  CONTAINS_PII: '#f85149',
};

export default function GraphVisualization({ data, onReset }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null);
  const [filter, setFilter] = useState<FilterType>('all');
  const [layout, setLayout] = useState<'cose' | 'breadthfirst' | 'concentric'>(() => autoLayout(data.nodes.length) as 'cose' | 'breadthfirst');
  const [renderPhase, setRenderPhase] = useState<'waiting' | 'layout' | 'ready'>('waiting');
  const [renderMsg, setRenderMsg] = useState('Preparing graph renderer…');
  const [showNeo4jModal, setShowNeo4jModal] = useState(false);

  const handleDownloadYaml = () => {
    const yaml = buildYaml(data);
    const blob = new Blob([yaml], { type: 'text/yaml' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${data.dbName}_pii_dataset.yaml`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const buildElements = useCallback((nodes: GraphNode[], edges: GraphEdge[], f: FilterType) => {
    let visibleNodes = nodes;
    let visibleEdges = edges;

    if (f === 'pii_only') {
      const piiNodeIds = new Set<string>();
      // Always include database, schema, pii_category nodes
      nodes.forEach(n => {
        if (['database', 'schema', 'pii_category'].includes(n.type)) piiNodeIds.add(n.id);
        if (n.type === 'table' && n.hasPii) piiNodeIds.add(n.id);
        if (n.type === 'column' && n.hasPii) piiNodeIds.add(n.id);
      });
      visibleNodes = nodes.filter(n => piiNodeIds.has(n.id));
      visibleEdges = edges.filter(e => piiNodeIds.has(e.source) && piiNodeIds.has(e.target));
    } else if (f === 'pii_category') {
      const piiNodeIds = new Set<string>();
      nodes.forEach(n => {
        if (n.type === 'pii_category') piiNodeIds.add(n.id);
        if (n.type === 'column' && n.hasPii) piiNodeIds.add(n.id);
      });
      visibleNodes = nodes.filter(n => piiNodeIds.has(n.id));
      visibleEdges = edges.filter(e => piiNodeIds.has(e.source) && piiNodeIds.has(e.target));
    }

    return [
      ...visibleNodes.map(n => ({
        data: {
          ...n,
          id: n.id,
          label: n.label.length > 18 ? n.label.slice(0, 16) + '…' : n.label,
          fullLabel: n.label,
          nodeType: n.type,
          color: n.color,
          size: NODE_SIZE[n.type] || 30,
          hasPii: n.hasPii,
        },
      })),
      ...visibleEdges.map((e, i) => ({
        data: {
          id: `edge_${i}`,
          source: e.source,
          target: e.target,
          edgeType: e.type,
          color: EDGE_COLOR[e.type] || '#30363d',
          width: e.type === 'CONTAINS_PII' ? 2 : 1,
          confidence: e.confidence,
        },
      })),
    ];
  }, []);

  const initCy = useCallback((elements: ReturnType<typeof buildElements>, layoutName: string) => {
    if (!containerRef.current) return;
    if (cyRef.current) { cyRef.current.destroy(); }

    const nodeCount = elements.filter(e => !('source' in e.data)).length;
    setRenderPhase('waiting');
    setRenderMsg(`Loading ${nodeCount} nodes into renderer…`);

    // Defer the heavy Cytoscape work so the browser can paint the loading overlay first
    requestAnimationFrame(() => {
      if (!containerRef.current) return;
      setRenderMsg('Applying graph layout…');
      setRenderPhase('layout');

    const layoutConfig: Record<string, unknown> =
      layoutName === 'breadthfirst'
        ? { name: 'breadthfirst', directed: true, spacingFactor: 1.4, padding: 40 }
        : layoutName === 'concentric'
        ? { name: 'concentric', concentric: (n: NodeSingular) => {
            const t = n.data('nodeType');
            return t === 'database' ? 5 : t === 'schema' ? 4 : t === 'pii_category' ? 3 : t === 'table' ? 2 : 1;
          }, levelWidth: () => 1, minNodeSpacing: 60, padding: 40 }
        : { name: 'cose', idealEdgeLength: 120, nodeRepulsion: 8000, gravity: 0.4, padding: 40, randomize: false };

    const cy = cytoscape({
      container: containerRef.current,
      elements,
      style: [
        {
          selector: 'node',
          style: {
            'background-color': 'data(color)',
            'label': 'data(label)',
            'color': '#e6edf3',
            'font-size': '10px',
            'font-family': 'Inter, sans-serif',
            'font-weight': 500,
            'text-valign': 'bottom',
            'text-halign': 'center',
            'text-margin-y': 4,
            'width': 'data(size)',
            'height': 'data(size)',
            'border-width': 2,
            'border-color': '#30363d',
            'text-outline-width': 2,
            'text-outline-color': '#0d1117',
          },
        },
        {
          selector: 'node[nodeType = "database"]',
          style: {
            shape: 'diamond',
            'border-color': '#58a6ff',
            'border-width': 3,
            'font-size': '12px',
            'font-weight': 700,
          },
        },
        {
          selector: 'node[nodeType = "schema"]',
          style: { shape: 'round-rectangle', 'border-color': '#484f58' },
        },
        {
          selector: 'node[nodeType = "table"][?hasPii]',
          style: { 'border-color': '#f85149', 'border-width': 3 },
        },
        {
          selector: 'node[nodeType = "table"][!hasPii]',
          style: { 'border-color': '#2471a3' },
        },
        {
          selector: 'node[nodeType = "column"][?hasPii]',
          style: { 'border-color': '#f85149', 'border-width': 3 },
        },
        {
          selector: 'node[nodeType = "pii_category"]',
          style: {
            shape: 'hexagon',
            'border-color': 'data(color)',
            'border-width': 3,
            'font-size': '11px',
            'font-weight': 600,
          },
        },
        {
          selector: 'edge',
          style: {
            'line-color': 'data(color)',
            'target-arrow-color': 'data(color)',
            'target-arrow-shape': 'triangle',
            'curve-style': 'bezier',
            'width': 'data(width)',
            'arrow-scale': 0.8,
            'opacity': 0.7,
          },
        },
        {
          selector: 'edge[edgeType = "CONTAINS_PII"]',
          style: {
            'line-style': 'dashed',
            'line-dash-pattern': [6, 3],
            opacity: 1,
          },
        },
        {
          selector: 'node:selected',
          style: {
            'border-color': '#58a6ff',
            'border-width': 4,
            'background-color': 'data(color)',
          },
        },
        {
          selector: 'node:active',
          style: { 'overlay-opacity': 0.1 },
        },
      ],
      layout: layoutConfig as never,
      userZoomingEnabled: true,
      userPanningEnabled: true,
      boxSelectionEnabled: false,
    });

    cy.on('tap', 'node', (evt) => {
      const nodeData = evt.target.data() as GraphNode;
      setSelectedNode(nodeData);
    });

    cy.on('tap', (evt) => {
      if (evt.target === cy) setSelectedNode(null);
    });

    // Mark ready after layout completes
    cy.one('layoutstop', () => setRenderPhase('ready'));

    cyRef.current = cy;
    }); // end requestAnimationFrame
  }, []);

  useEffect(() => {
    const elements = buildElements(data.nodes, data.edges, filter);
    initCy(elements, layout);
    return () => { cyRef.current?.destroy(); };
  }, [data, filter, layout, buildElements, initCy]);

  const fitGraph = () => cyRef.current?.fit(undefined, 40);

  const zoomIn = () => cyRef.current?.zoom({ level: (cyRef.current.zoom() || 1) * 1.3, renderedPosition: { x: (containerRef.current?.clientWidth || 800) / 2, y: (containerRef.current?.clientHeight || 600) / 2 } });
  const zoomOut = () => cyRef.current?.zoom({ level: (cyRef.current.zoom() || 1) / 1.3, renderedPosition: { x: (containerRef.current?.clientWidth || 800) / 2, y: (containerRef.current?.clientHeight || 600) / 2 } });

  return (
    <div style={styles.root}>
      {/* Toolbar */}
      <div style={styles.toolbar}>
        <div style={styles.toolbarLeft}>
          <button style={styles.backBtn} onClick={onReset}>← New Scan</button>
          {data.spocName && (
            <div style={styles.spocBadge}>
              <span>👤</span>
              <span style={{ color: '#8b949e', fontSize: 12 }}>SPOC:</span>
              <span style={{ color: '#58a6ff', fontWeight: 700, fontSize: 13 }}>{data.spocName}</span>
            </div>
          )}
          <div style={styles.filterGroup}>
            {(['all', 'pii_only', 'pii_category'] as FilterType[]).map(f => (
              <button key={f} style={{ ...styles.filterBtn, ...(filter === f ? styles.filterBtnActive : {}) }} onClick={() => setFilter(f)}>
                {f === 'all' ? 'All Nodes' : f === 'pii_only' ? '⚠️ PII Only' : '🏷️ PII Map'}
              </button>
            ))}
          </div>
          <div style={styles.filterGroup}>
            {(['cose', 'breadthfirst', 'concentric'] as const).map(l => (
              <button key={l} style={{ ...styles.filterBtn, ...(layout === l ? styles.filterBtnActive : {}) }} onClick={() => setLayout(l)}>
                {l === 'cose' ? 'Force' : l === 'breadthfirst' ? 'Tree' : 'Radial'}
              </button>
            ))}
          </div>
        </div>
        <div style={styles.zoomBtns}>
          <button style={styles.yamlBtn} onClick={handleDownloadYaml}>
            ⬇ Download YAML
          </button>
          {data.neo4jGraph && (
            <button style={styles.neo4jBtn} onClick={() => setShowNeo4jModal(true)}>
              <svg width="14" height="14" viewBox="0 0 22 22" style={{ marginRight: 6, verticalAlign: 'middle' }}>
                <circle cx="11" cy="11" r="10" fill="rgba(255,255,255,0.25)" />
                <text x="11" y="15.5" textAnchor="middle" fontSize="11" fontWeight="bold" fill="white">N</text>
              </svg>
              Push to Neo4j
            </button>
          )}
          <button style={styles.zoomBtn} onClick={zoomIn}>+</button>
          <button style={styles.zoomBtn} onClick={fitGraph}>⊙</button>
          <button style={styles.zoomBtn} onClick={zoomOut}>−</button>
        </div>
      </div>

      {/* Main area */}
      <div style={styles.main}>
        {/* Left: summary */}
        <div style={styles.sidebar}>
          <SummaryPanel summary={data.summary} dbName={data.dbName} dbType={data.dbType} spocName={data.spocName} />
          <Legend />
        </div>

        {/* Graph canvas */}
        <div style={{ flex: 1, position: 'relative', background: '#0d1117' }}>
          <div ref={containerRef} style={{ ...styles.canvas, opacity: renderPhase === 'ready' ? 1 : 0, transition: 'opacity 0.4s ease' }} />
          {renderPhase !== 'ready' && (
            <div style={styles.renderOverlay}>
              <div style={styles.renderCard}>
                <div style={styles.renderSpinnerWrap}>
                  <div style={styles.renderSpinnerOuter} />
                  <div style={styles.renderSpinnerInner} />
                  <span style={styles.renderSpinnerIcon}>🕸️</span>
                </div>
                <div style={styles.renderTitle}>Initialising Graph</div>
                <div style={styles.renderMsg}>{renderMsg}</div>
                <div style={styles.renderStats}>
                  <span>{data.nodes.length} nodes</span>
                  <span style={{ color: '#484f58' }}>·</span>
                  <span>{data.edges.length} edges</span>
                  <span style={{ color: '#484f58' }}>·</span>
                  <span>{data.summary.piiColumns} PII fields</span>
                </div>
                <div style={styles.renderHint}>
                  {autoLayout(data.nodes.length) === 'breadthfirst'
                    ? 'Large graph detected — using fast tree layout'
                    : 'Computing force-directed layout…'}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Right: node detail */}
        {selectedNode && (
          <div style={styles.detail}>
            <NodeDetailPanel node={selectedNode} onClose={() => setSelectedNode(null)} />
          </div>
        )}
      </div>

      {showNeo4jModal && data.neo4jGraph && (
        <Neo4jPushModal
          neo4jGraph={data.neo4jGraph}
          dbName={data.dbName}
          onClose={() => setShowNeo4jModal(false)}
        />
      )}
    </div>
  );
}

function Legend() {
  const items = [
    { color: '#1A252F', label: 'Database', shape: '◆' },
    { color: '#2C3E50', label: 'Schema', shape: '▬' },
    { color: '#154360', label: 'Table (clean)', shape: '●' },
    { color: '#922B21', label: 'Table (PII)', shape: '●' },
    { color: '#2471A3', label: 'Column (clean)', shape: '●' },
    { color: '#E74C3C', label: 'Column (PII)', shape: '●' },
  ];
  return (
    <div style={styles.legend}>
      <div style={styles.legendTitle}>Legend</div>
      {items.map(item => (
        <div key={item.label} style={styles.legendRow}>
          <span style={{ color: item.color, fontSize: 14 }}>{item.shape}</span>
          <span style={styles.legendLabel}>{item.label}</span>
        </div>
      ))}
      <div style={{ ...styles.legendRow, marginTop: 6 }}>
        <span style={{ color: '#f85149', fontSize: 12 }}>- - -</span>
        <span style={styles.legendLabel}>PII relationship</span>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: { display: 'flex', flexDirection: 'column', height: '100vh', background: '#0d1117' },
  toolbar: {
    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
    padding: '10px 16px', background: '#161b22', borderBottom: '1px solid #30363d',
    gap: 12, flexShrink: 0,
  },
  toolbarLeft: { display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' },
  backBtn: {
    background: '#21262d', border: '1px solid #30363d', borderRadius: 6,
    color: '#e6edf3', cursor: 'pointer', fontSize: 13, padding: '6px 12px',
  },
  spocBadge: {
    display: 'flex', alignItems: 'center', gap: 5,
    background: '#1c2128', border: '1px solid #30363d', borderRadius: 20,
    padding: '4px 12px',
  },
  filterGroup: { display: 'flex', gap: 4, background: '#0d1117', padding: 3, borderRadius: 8 },
  filterBtn: {
    background: 'none', border: 'none', borderRadius: 6, color: '#8b949e',
    cursor: 'pointer', fontSize: 12, fontWeight: 500, padding: '5px 10px', transition: 'all 0.15s',
  },
  filterBtnActive: { background: '#21262d', color: '#e6edf3' },
  zoomBtns: { display: 'flex', gap: 6, alignItems: 'center' },
  yamlBtn: {
    background: '#1f6feb', border: 'none', borderRadius: 6, color: '#fff',
    cursor: 'pointer', fontSize: 12, fontWeight: 600,
    padding: '6px 12px', whiteSpace: 'nowrap' as const,
  },
  neo4jBtn: {
    background: 'linear-gradient(135deg, #008cc1, #00acd4)',
    border: 'none', borderRadius: 6, color: '#fff',
    cursor: 'pointer', fontSize: 12, fontWeight: 600,
    padding: '6px 12px', whiteSpace: 'nowrap' as const,
  },
  zoomBtn: {
    background: '#21262d', border: '1px solid #30363d', borderRadius: 6,
    color: '#e6edf3', cursor: 'pointer', fontSize: 14, width: 32, height: 32,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
  },
  main: { display: 'flex', flex: 1, overflow: 'hidden' },
  sidebar: { display: 'flex', flexDirection: 'column', gap: 12, padding: 12, width: 240, flexShrink: 0, overflowY: 'auto', background: '#0d1117', borderRight: '1px solid #30363d' },
  canvas: { position: 'absolute', inset: 0, background: '#0d1117' },
  renderOverlay: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#0d1117', zIndex: 10 },
  renderCard: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, padding: '32px 40px', background: '#1c2128', border: '1px solid #30363d', borderRadius: 16, maxWidth: 340, textAlign: 'center' },
  renderSpinnerWrap: { position: 'relative', width: 56, height: 56, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  renderSpinnerOuter: { position: 'absolute', inset: 0, borderRadius: '50%', border: '3px solid #21262d', borderTopColor: '#388bfd', animation: 'spin 1s linear infinite' },
  renderSpinnerInner: { position: 'absolute', inset: 8, borderRadius: '50%', border: '2px solid #21262d', borderBottomColor: '#3fb950', animation: 'spin 0.6s linear infinite reverse' },
  renderSpinnerIcon: { fontSize: 20, zIndex: 1 },
  renderTitle: { fontWeight: 700, fontSize: 16, color: '#e6edf3' },
  renderMsg: { fontSize: 13, color: '#58a6ff', fontFamily: 'JetBrains Mono, monospace', minHeight: 20 },
  renderStats: { display: 'flex', gap: 8, fontSize: 12, color: '#8b949e' },
  renderHint: { fontSize: 11, color: '#484f58', fontStyle: 'italic' },
  detail: { width: 300, flexShrink: 0, padding: 12, overflowY: 'auto', borderLeft: '1px solid #30363d', background: '#0d1117' },
  legend: { background: '#1c2128', border: '1px solid #30363d', borderRadius: 10, padding: 12 },
  legendTitle: { fontSize: 11, fontWeight: 600, color: '#8b949e', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: 8 },
  legendRow: { display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 },
  legendLabel: { fontSize: 12, color: '#8b949e' },
};
