import React, { useRef, useEffect } from 'react'

export default function LogViewer({ logs = [], errors = [], maxLines = 500 }) {
  const logRef = useRef(null)

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs.length, errors.length])

  const displayedErrors = errors.slice(-maxLines)
  const displayedLogs = logs.slice(-(maxLines - displayedErrors.length))

  const allEntries = [
    ...displayedErrors.map(e => ({ type: 'error', text: `${e.field}: ${e.message}` })),
    ...displayedLogs.map(l => ({ type: 'info', text: l }))
  ]

  return (
    <div
      ref={logRef}
      style={{
        maxHeight: 260, overflowY: 'auto',
        background: '#1f2937', borderRadius: 8, padding: 12,
        fontFamily: 'Consolas, "Courier New", monospace',
        fontSize: 12, lineHeight: 1.7
      }}
    >
      {allEntries.length === 0 ? (
        <div style={{ color: '#9ca3af' }}>等待处理...</div>
      ) : (
        allEntries.map((entry, idx) => {
          let icon = ''
          let text = entry.text
          if (entry.type === 'error') {
            icon = '❌ '
          } else {
            if (text.startsWith('[创建]')) { icon = '✅ '; text = text.slice(4) }
            else if (text.startsWith('[覆盖]')) { icon = '🔄 '; text = text.slice(4) }
            else if (text.startsWith('[跳过]')) { icon = '⏭️ '; text = text.slice(4) }
            else if (text.startsWith('[失败]')) { icon = '❌ '; text = text.slice(4) }
            else if (text.startsWith('[信息]')) { icon = 'ℹ️ '; text = text.slice(4) }
          }
          return (
            <div
              key={idx}
              style={{
                color: entry.type === 'error' ? '#fca5a5' : '#a7f3d0',
                whiteSpace: 'pre-wrap', wordBreak: 'break-all'
              }}
            >
              {icon}{text}
            </div>
          )
        })
      )}
    </div>
  )
}
