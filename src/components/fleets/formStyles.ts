import React from 'react';

export const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 10px',
  borderRadius: '8px',
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-surface-elevated)',
  color: 'var(--text-primary)',
  fontSize: '13px',
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
};

export const labelStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  fontSize: '12px',
  color: 'var(--text-secondary)',
};

export const hintStyle: React.CSSProperties = {
  fontSize: '11px',
  color: 'var(--text-muted)',
};

export const errorBoxStyle: React.CSSProperties = {
  padding: '10px 12px',
  borderRadius: '8px',
  fontSize: '12px',
  background: 'rgba(239, 68, 68, 0.12)',
  border: '1px solid rgba(239, 68, 68, 0.35)',
  color: '#FCA5A5',
  whiteSpace: 'pre-wrap',
};
