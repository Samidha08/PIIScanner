export interface PiiMatch {
  category: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  matchedBy: 'column_name' | 'data_pattern';
  matchedTypes?: string[];
  categoryInfo: {
    label: string;
    color: string;
    icon: string;
    description: string;
    dpdpa_section: string;
  };
}

export interface GraphNode {
  id: string;
  label: string;
  type: 'database' | 'schema' | 'table' | 'column' | 'pii_category';
  color: string;
  shape: string;
  // extra fields per type
  dbType?: string;
  rowCount?: number;
  columnCount?: number;
  piiColumnCount?: number;
  hasPii?: boolean;
  dataType?: string;
  nullable?: boolean;
  piiMatches?: PiiMatch[];
  category?: string;
  description?: string;
  dpdpaSection?: string;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  confidence?: string;
  matchedBy?: string;
}

export interface ScanSummary {
  totalTables: number;
  totalColumns: number;
  piiColumns: number;
  piiByCategory: Record<string, { count: number; label: string; color: string }>;
}

export interface Neo4jNode {
  id: string;
  label: string;
  properties: Record<string, unknown>;
}

export interface Neo4jRelationship {
  from: string;
  to: string;
  type: string;
  properties?: Record<string, unknown>;
}

export interface Neo4jGraph {
  nodes: Neo4jNode[];
  relationships: Neo4jRelationship[];
}

export interface ScanResult {
  nodes: GraphNode[];
  edges: GraphEdge[];
  summary: ScanSummary;
  dbName: string;
  dbType: string;
  spocName?: string;
  neo4jGraph?: Neo4jGraph;
}
