import React, { useState } from 'react';

interface Props {
  onScan: (connStr: string) => void;
  loading: boolean;
  spocName: string;
  onChangeSpoc: () => void;
}

const EXAMPLES = [
  { label: 'MongoDB', value: 'mongodb://user:password@localhost:27017/mydb' },
  { label: 'MongoDB Atlas', value: 'mongodb+srv://user:password@cluster.mongodb.net/mydb' },
  { label: 'PostgreSQL', value: 'postgresql://user:password@localhost:5432/mydb' },
  { label: 'MySQL', value: 'mysql://user:password@localhost:3306/mydb' },
  { label: 'SQLite', value: './data/sample.db' },
];

const DB_ICONS: Record<string, string> = {
  mongodb: '🍃',
  'mongodb atlas': '🍃',
  postgresql: '🐘',
  postgres: '🐘',
  mysql: '🐬',
  sqlite: '📁',
};

function detectDb(val: string) {
  if (/^mongodb(\+srv)?:\/\//i.test(val)) return 'mongodb';
  if (/^postgres/i.test(val)) return 'postgresql';
  if (/^mysql/i.test(val)) return 'mysql';
  if (/^sqlite|\.db$|\.sqlite/i.test(val)) return 'sqlite';
  return null;
}

export default function ConnectionForm({ onScan, loading, spocName, onChangeSpoc }: Props) {
  const [value, setValue] = useState('');
  const [showExamples, setShowExamples] = useState(false);

  const detectedDb = detectDb(value);

  return (
    <div style={styles.wrapper}>
      {/* Hero */}
      <div style={styles.hero}>
        <div style={styles.logoRow}>
          <span style={styles.logoIcon}>🔍</span>
          <span style={styles.logoText}>DPDPA PII Scanner</span>
        </div>
        <p style={styles.subtitle}>
          Connect to your database and discover PII data governed by India's{' '}
          <span style={{ color: '#58a6ff' }}>Digital Personal Data Protection Act</span>
        </p>
        {/* SPOC context badge */}
        <div style={styles.spocBadge}>
          <span style={styles.spocIcon}>{spocName ? '👤' : '🌐'}</span>
          <span style={styles.spocLabel}>{spocName ? 'Scanning for:' : 'Scanning:'}</span>
          <span style={styles.spocName}>{spocName || 'All data'}</span>
          <button style={styles.spocChange} onClick={onChangeSpoc}>Change</button>
        </div>
      </div>

      {/* Card */}
      <div style={styles.card}>
        <label style={styles.label}>Database Connection String</label>

        <div style={styles.inputRow}>
          {detectedDb && (
            <span style={styles.dbBadge} title={detectedDb}>
              {DB_ICONS[detectedDb] || '🗄️'}
            </span>
          )}
          <input
            style={{ ...styles.input, paddingLeft: detectedDb ? '42px' : '14px' }}
            type="text"
            placeholder="postgresql://user:pass@host:5432/db  or  mysql://  or  ./file.db"
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && value.trim() && !loading && onScan(value)}
            spellCheck={false}
            autoComplete="off"
          />
        </div>

        <div style={styles.actions}>
          <button
            style={styles.exampleBtn}
            onClick={() => setShowExamples(v => !v)}
            type="button"
          >
            {showExamples ? '▲ Hide examples' : '▼ Show examples'}
          </button>
          <button
            style={{
              ...styles.scanBtn,
              opacity: loading || !value.trim() ? 0.55 : 1,
              cursor: loading || !value.trim() ? 'not-allowed' : 'pointer',
            }}
            onClick={() => value.trim() && !loading && onScan(value)}
            disabled={loading || !value.trim()}
          >
            {loading ? (
              <span style={styles.spinnerRow}>
                <span style={styles.spinner} />
                Scanning…
              </span>
            ) : (
              '⚡ Scan Database'
            )}
          </button>
        </div>

        {showExamples && (
          <div style={styles.examplesBox}>
            {EXAMPLES.map(ex => (
              <button
                key={ex.label}
                style={styles.exampleChip}
                onClick={() => { setValue(ex.value); setShowExamples(false); }}
              >
                <span style={{ marginRight: 6 }}>{DB_ICONS[ex.label.toLowerCase()] || '🗄️'}</span>
                <span style={{ fontWeight: 600, marginRight: 8 }}>{ex.label}</span>
                <span style={{ color: '#8b949e', fontFamily: 'JetBrains Mono, monospace', fontSize: 11 }}>{ex.value}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Info chips */}
      <div style={styles.chips}>
        {['Aadhaar / PAN', 'Email & Phone', 'Bank & UPI', 'Health Records', 'Biometrics', 'Location Data'].map(tag => (
          <span key={tag} style={styles.chip}>{tag}</span>
        ))}
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    justifyContent: 'center', flex: 1, padding: '40px 20px', gap: 24,
  },
  hero: { textAlign: 'center' },
  logoRow: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 10 },
  logoIcon: { fontSize: 36 },
  logoText: { fontSize: 28, fontWeight: 700, letterSpacing: '-0.5px' },
  subtitle: { color: '#8b949e', fontSize: 15, maxWidth: 520, lineHeight: 1.6 },
  card: {
    background: '#1c2128', border: '1px solid #30363d', borderRadius: 12,
    padding: 28, width: '100%', maxWidth: 620,
  },
  label: { display: 'block', fontSize: 13, fontWeight: 600, color: '#8b949e', marginBottom: 10, letterSpacing: '0.5px', textTransform: 'uppercase' },
  inputRow: { position: 'relative', marginBottom: 16 },
  dbBadge: { position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 18, pointerEvents: 'none' },
  input: {
    width: '100%', background: '#0d1117', border: '1px solid #30363d', borderRadius: 8,
    color: '#e6edf3', fontSize: 14, fontFamily: 'JetBrains Mono, monospace',
    padding: '11px 14px', outline: 'none', transition: 'border-color 0.15s',
  },
  actions: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  exampleBtn: { background: 'none', border: 'none', color: '#58a6ff', cursor: 'pointer', fontSize: 13 },
  scanBtn: {
    background: 'linear-gradient(135deg, #1f6feb, #388bfd)',
    border: 'none', borderRadius: 8, color: '#fff', fontSize: 14,
    fontWeight: 600, padding: '10px 22px', cursor: 'pointer', transition: 'opacity 0.15s',
  },
  spinnerRow: { display: 'flex', alignItems: 'center', gap: 8 },
  spinner: {
    width: 14, height: 14, borderRadius: '50%',
    border: '2px solid rgba(255,255,255,0.3)',
    borderTopColor: '#fff', animation: 'spin 0.7s linear infinite',
    display: 'inline-block',
  },
  examplesBox: { marginTop: 14, display: 'flex', flexDirection: 'column', gap: 6 },
  exampleChip: {
    background: '#0d1117', border: '1px solid #30363d', borderRadius: 6,
    padding: '8px 12px', cursor: 'pointer', textAlign: 'left',
    display: 'flex', alignItems: 'center', color: '#e6edf3', fontSize: 13,
  },
  chips: { display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'center' },
  chip: {
    background: '#21262d', border: '1px solid #30363d', borderRadius: 20,
    padding: '4px 12px', fontSize: 12, color: '#8b949e',
  },
  spocBadge: {
    display: 'inline-flex', alignItems: 'center', gap: 6, marginTop: 12,
    background: '#1c2128', border: '1px solid #30363d', borderRadius: 20,
    padding: '5px 14px', fontSize: 13,
  },
  spocIcon: { fontSize: 14 },
  spocLabel: { color: '#8b949e' },
  spocName: { color: '#58a6ff', fontWeight: 700 },
  spocChange: {
    background: 'none', border: 'none', color: '#484f58', cursor: 'pointer',
    fontSize: 12, padding: '0 0 0 4px', textDecoration: 'underline',
  },
};
