import React, { useState, useEffect } from 'react'

export default function ProgressBar({ value, max, label, indeterminate = false }) {
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    if (!indeterminate) return
    const interval = setInterval(() => {
      setOffset(o => (o + 2) % 100)
    }, 30)
    return () => clearInterval(interval)
  }, [indeterminate])

  const pct = indeterminate ? null : (max > 0 ? Math.min(100, (value / max) * 100) : 0)

  return (
    <div style={{ margin: '8px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
        <span>{label || (indeterminate ? '处理中...' : `进度: ${value}/${max}`)}</span>
        {!indeterminate && <span>{pct.toFixed(0)}%</span>}
      </div>
      <div style={{
        width: '100%', height: 10, borderRadius: 5,
        background: '#e5e7eb', overflow: 'hidden', position: 'relative'
      }}>
        {indeterminate ? (
          <div style={{
            position: 'absolute', top: 0, height: '100%', width: '40%',
            background: 'linear-gradient(90deg, transparent, #6366f1, #8b5cf6, transparent)',
            left: `${offset - 40}%`,
            transition: 'left 0.03s linear'
          }} />
        ) : (
          <div style={{
            width: `${pct}%`, height: '100%',
            background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
            transition: 'width 0.3s ease-out'
          }} />
        )}
      </div>
    </div>
  )
}
