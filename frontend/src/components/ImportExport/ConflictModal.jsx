import React, { useState, useMemo } from 'react'
import Modal from '../Modal.jsx'
import { Button } from '../Form.jsx'

export default function ConflictModal({ conflicts, onResolve, onCancel }) {
  const [resolutions, setResolutions] = useState({})
  const [filter, setFilter] = useState('all')

  const filteredConflicts = useMemo(() => {
    if (filter === 'all') return conflicts
    return conflicts.filter(c => !resolutions[c.index])
  }, [conflicts, resolutions, filter])

  const handleSingleResolve = (index, strategy) => {
    setResolutions(prev => ({ ...prev, [index]: strategy }))
  }

  const handleApplyAll = (strategy) => {
    const allRes = {}
    conflicts.forEach(c => { allRes[c.index] = strategy })
    setResolutions(allRes)
  }

  const allResolved = conflicts.length === 0 ||
    conflicts.every(c => resolutions[c.index] !== undefined)

  return (
    <Modal
      title="服务名称冲突"
      onClose={onCancel}
      width={760}
      actions={[
        <Button key="cancel" onClick={onCancel}>取消</Button>,
        <Button
          key="confirm"
          variant="primary"
          disabled={!allResolved}
          onClick={() => onResolve(resolutions)}
        >
          确认导入 ({Object.keys(resolutions).length}/{conflicts.length})
        </Button>
      ]}
    >
      <div style={{ marginBottom: 16 }}>
        <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 12 }}>
          检测到 <b style={{ color: '#92400e' }}>{conflicts.length}</b> 个服务名称与现有服务冲突，请选择处理方式：
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <span style={{ fontSize: 12, color: '#6b7280' }}>批量应用：</span>
          <Button size="sm" onClick={() => handleApplyAll('skip')}>全部跳过</Button>
          <Button size="sm" onClick={() => handleApplyAll('overwrite')}>全部覆盖</Button>
          <Button size="sm" onClick={() => handleApplyAll('duplicate')}>全部创建副本</Button>
          <span style={{ flex: 1 }} />
          <span style={{ fontSize: 12, color: '#6b7280' }}>显示：</span>
          <Button size="sm" variant={filter === 'all' ? 'primary' : 'default'} onClick={() => setFilter('all')}>全部</Button>
          <Button size="sm" variant={filter === 'pending' ? 'primary' : 'default'} onClick={() => setFilter('pending')}>待处理</Button>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 10, maxHeight: 420, overflowY: 'auto' }}>
        {filteredConflicts.map(c => (
          <div key={c.index} style={{
            border: '1px solid #e5e7eb', borderRadius: 10, padding: 14,
            background: resolutions[c.index] ? '#f0fdf4' : '#fff',
            transition: 'background 0.15s'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 18 }}>⚠️</span>
                <span style={{ fontWeight: 600, fontSize: 14 }}>{c.name}</span>
                {resolutions[c.index] && (
                  <span style={{
                    fontSize: 11, padding: '2px 8px', borderRadius: 999,
                    background: '#d1fae5', color: '#065f46', fontWeight: 600
                  }}>
                    {resolutions[c.index] === 'skip' ? '跳过' : resolutions[c.index] === 'overwrite' ? '覆盖' : '创建副本'}
                  </span>
                )}
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                <Button
                  size="sm"
                  variant={resolutions[c.index] === 'skip' ? 'primary' : 'default'}
                  onClick={() => handleSingleResolve(c.index, 'skip')}
                >跳过</Button>
                <Button
                  size="sm"
                  variant={resolutions[c.index] === 'overwrite' ? 'primary' : 'default'}
                  onClick={() => handleSingleResolve(c.index, 'overwrite')}
                >覆盖</Button>
                <Button
                  size="sm"
                  variant={resolutions[c.index] === 'duplicate' ? 'primary' : 'default'}
                  onClick={() => handleSingleResolve(c.index, 'duplicate')}
                >创建副本</Button>
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12 }}>
              <div>
                <div style={{ color: '#6b7280', marginBottom: 4, fontWeight: 600 }}>现有配置</div>
                <div style={{
                  background: '#f3f4f6', borderRadius: 6, padding: 10,
                  fontFamily: 'monospace', color: '#374151', lineHeight: 1.6
                }}>
                  <div><b>{c.existingConfig.type.toUpperCase()}</b> → {c.existingConfig.target}{c.existingConfig.port ? `:${c.existingConfig.port}` : ''}</div>
                  <div style={{ color: '#6b7280' }}>
                    间隔 {c.existingConfig.interval_seconds}s · 超时 {c.existingConfig.timeout_ms}ms
                    {c.existingConfig.group ? ` · ${c.existingConfig.group}` : ''}
                    {c.existingConfig.enabled === false || c.existingConfig.enabled === 0 ? ' · 已停用' : ''}
                  </div>
                </div>
              </div>
              <div>
                <div style={{ color: '#6b7280', marginBottom: 4, fontWeight: 600 }}>导入配置</div>
                <div style={{
                  background: '#fef3c7', borderRadius: 6, padding: 10,
                  fontFamily: 'monospace', color: '#374151', lineHeight: 1.6
                }}>
                  <div><b>{c.newConfig.type.toUpperCase()}</b> → {c.newConfig.target}{c.newConfig.port ? `:${c.newConfig.port}` : ''}</div>
                  <div style={{ color: '#92400e' }}>
                    间隔 {c.newConfig.interval_seconds}s · 超时 {c.newConfig.timeout_ms}ms
                    {c.newConfig.group ? ` · ${c.newConfig.group}` : ''}
                    {c.newConfig.enabled === false || c.newConfig.enabled === 0 ? ' · 已停用' : ''}
                  </div>
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}
