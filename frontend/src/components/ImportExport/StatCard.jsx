import React from 'react'

export default function StatCard({ label, value, color = '#6366f1' }) {
  return (
    <div style={{
      padding: 12, borderRadius: 10, background: '#f9fafb',
      border: '1px solid #e5e7eb', textAlign: 'center'
    }}>
      <div style={{ fontSize: 24, fontWeight: 700, color }}>{value}</div>
      <div style={{ fontSize: 11, color: '#6b7280', marginTop: 2 }}>{label}</div>
    </div>
  )
}
