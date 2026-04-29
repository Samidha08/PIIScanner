import React, { useState } from 'react';

interface Props {
  onSubmit: (spocName: string) => void;
}

export default function SpocEntry({ onSubmit }: Props) {
  const [name, setName] = useState('');

  const handleSubmit = (value?: string) => {
    onSubmit(value !== undefined ? value : name.trim());
  };

  return (
    <div style={styles.wrapper}>
      {/* Hero */}
      <div style={styles.hero}>
        <div style={styles.logoRow}>
          <span style={styles.logoIcon}>🔍</span>
          <span style={styles.logoText}>DPDPA PII Scanner</span>
        </div>
        <div style={styles.tagline}>India's Digital Personal Data Protection Act</div>
      </div>

      {/* Card */}
      <div style={styles.card}>
        <div style={styles.cardHeader}>
          <span style={styles.cardIcon}>👤</span>
          <div>
            <div style={styles.cardTitle}>Who are you scanning for?</div>
            <div style={styles.cardSubtitle}>Enter the SPOC (Single Point of Contact) name to filter the scan</div>
          </div>
        </div>

        <label style={styles.label}>SPOC / Team Name</label>
        <input
          style={styles.input}
          type="text"
          placeholder="Enter SPOC or team name…"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleSubmit()}
          autoFocus
          spellCheck={false}
          autoComplete="off"
        />

        <div style={styles.btnRow}>
          <button
            style={{
              ...styles.continueBtn,
              opacity: name.trim() ? 1 : 0.5,
              cursor: name.trim() ? 'pointer' : 'not-allowed',
              flex: 1,
            }}
            onClick={() => handleSubmit()}
            disabled={!name.trim()}
          >
            Continue →
          </button>
          <button
            style={styles.skipBtn}
            onClick={() => handleSubmit('')}
          >
            Skip — Scan All
          </button>
        </div>
      </div>

      {/* Info */}
      <div style={styles.infoBox}>
        <span style={styles.infoIcon}>ℹ️</span>
        <span style={styles.infoText}>
          The DPO registers SPOC data in the database. This scanner retrieves only the records
          associated with the SPOC you enter, giving you a focused view of their PII exposure.
        </span>
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
  logoRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 10, marginBottom: 8,
  },
  logoIcon: { fontSize: 36 },
  logoText: { fontSize: 28, fontWeight: 700, letterSpacing: '-0.5px', color: '#e6edf3' },
  tagline: { fontSize: 13, color: '#8b949e' },

  card: {
    background: '#1c2128', border: '1px solid #30363d', borderRadius: 14,
    padding: 32, width: '100%', maxWidth: 480,
  },
  cardHeader: { display: 'flex', alignItems: 'flex-start', gap: 14, marginBottom: 24 },
  cardIcon: { fontSize: 32, marginTop: 2 },
  cardTitle: { fontSize: 18, fontWeight: 700, color: '#e6edf3', marginBottom: 4 },
  cardSubtitle: { fontSize: 13, color: '#8b949e', lineHeight: 1.5 },

  label: {
    display: 'block', fontSize: 12, fontWeight: 600, color: '#8b949e',
    marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.5px',
  },
  input: {
    width: '100%', background: '#0d1117', border: '1px solid #30363d', borderRadius: 8,
    color: '#e6edf3', fontSize: 15, fontFamily: 'inherit',
    padding: '12px 14px', outline: 'none', marginBottom: 12,
    boxSizing: 'border-box',
  },

  btnRow: { display: 'flex', gap: 10 },

  continueBtn: {
    background: 'linear-gradient(135deg, #1f6feb, #388bfd)',
    border: 'none', borderRadius: 8, color: '#fff', fontSize: 15,
    fontWeight: 600, padding: '12px', cursor: 'pointer', transition: 'opacity 0.15s',
  },
  skipBtn: {
    background: 'none', border: '1px solid #30363d', borderRadius: 8,
    color: '#8b949e', fontSize: 13, fontWeight: 500, padding: '12px 16px',
    cursor: 'pointer', whiteSpace: 'nowrap' as const,
  },

  infoBox: {
    display: 'flex', alignItems: 'flex-start', gap: 10, maxWidth: 480,
    background: '#161b22', border: '1px solid #30363d', borderRadius: 10,
    padding: '12px 16px',
  },
  infoIcon: { fontSize: 16, flexShrink: 0, marginTop: 1 },
  infoText: { fontSize: 12, color: '#8b949e', lineHeight: 1.6 },
};
