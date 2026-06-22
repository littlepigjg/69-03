import React, { useState, useMemo } from 'react'
import Modal from '../Modal.jsx'
import { FormField, SelectInput, CheckboxInput, Button } from '../Form.jsx'
import { downloadJSON, formatBytes } from './utils.js'

export default function ExportModal({ onClose, groups = [], services = [] }) {
  const [selectedGroup, setSelectedGroup] = useState('')
  const [selectedType, setSelectedType] = useState('')
  const [selectedEnabled, setSelectedEnabled] = useState('')
  const [useCompact, setUseCompact] = useState(true)
  const [splitMode, setSplitMode] = useState('single')

  const previewCount = useMemo(() => {
    let filtered = services
    if (selectedGroup) filtered = filtered.filter(s => s.group === selectedGroup)
    if (selectedType) filtered = filtered.filter(s => s.type === selectedType)
    if (selectedEnabled !== '') {
      const wantEnabled = selectedEnabled === 'true'
      filtered = filtered.filter(s => (s.enabled ? true : false) === wantEnabled)
    }
    return filtered.length
  }, [services, selectedGroup, selectedType, selectedEnabled])

  const estimatedSizeKB = useMemo(() => {
    const avgObjSize = useCompact ? 80 : 200
    return Math.round((previewCount * avgObjSize) / 1024)
  }, [previewCount, useCompact])

  const handleExportSingle = () => {
    const params = new URLSearchParams()
    params.append('format', 'pretty')
    params.append('compact', useCompact ? 'true' : 'false')
    if (selectedGroup) params.append('group', selectedGroup)
    if (selectedType) params.append('type', selectedType)
    if (selectedEnabled !== '') params.append('enabled', selectedEnabled)
    window.open(`/api/services/export?${params.toString()}`, '_blank')
    onClose()
  }

  const handleExportSplit = () => {
    const params = new URLSearchParams()
    params.append('format', 'pretty')
    params.append('compact', useCompact ? 'true' : 'false')
    params.append('splitBy', 'group')
    if (selectedType) params.append('type', selectedType)
    if (selectedEnabled !== '') params.append('enabled', selectedEnabled)
    window.open(`/api/services/export?${params.toString()}`, '_blank')
    onClose()
  }

  const handleExportGroup = (group) => {
    const params = new URLSearchParams()
    params.append('format', 'pretty')
    params.append('compact', useCompact ? 'true' : 'false')
    params.append('group', group)
    if (selectedType) params.append('type', selectedType)
    if (selectedEnabled !== '') params.append('enabled', selectedEnabled)
    window.open(`/api/services/export?${params.toString()}`, '_blank')
  }

  const groupCounts = useMemo(() => {
    let filtered = services
    if (selectedType) filtered = filtered.filter(s => s.type === selectedType)
    if (selectedEnabled !== '') {
      const wantEnabled = selectedEnabled === 'true'
      filtered = filtered.filter(s => (s.enabled ? true : false) === wantEnabled)
    }
    const map = new Map()
    filtered.forEach(s => {
      const g = s.group || '未分组'
      map.set(g, (map.get(g) || 0) + 1)
    })
    return Array.from(map.entries()).map(([group, count]) => ({ group, count }))
  }, [services, selectedType, selectedEnabled])

  return (
    <Modal
      title="导出服务配置"
      onClose={onClose}
      width={580}
    >
      <div style={{
        padding: 14, borderRadius: 10,
        background: '#eef2ff', border: '1px solid #c7d2fe',
        marginBottom: 20, textAlign: 'center'
      }}>
        <div style={{ fontSize: 12, color: '#6366f1', marginBottom: 4 }}>预计导出</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: '#4f46e5' }}>
          {previewCount} <span style={{ fontSize: 14, fontWeight: 500 }}>个服务</span>
        </div>
        <div style={{ fontSize: 12, color: '#6366f1', marginTop: 4 }}>
          约 {estimatedSizeKB >= 1024 ? `${(estimatedSizeKB / 1024).toFixed(1)} MB` : `${estimatedSizeKB} KB`}
          {estimatedSizeKB >= 500 && ' · 建议使用分片导出'}
        </div>
      </div>

      <FormField label="按启用状态筛选">
        <SelectInput
          value={selectedEnabled}
          onChange={setSelectedEnabled}
          options={[
            { value: '', label: '全部服务' },
            { value: 'true', label: '🟢 仅正在监控（已启用）' },
            { value: 'false', label: '⚪ 仅已停用' }
          ]}
        />
      </FormField>

      <FormField label="按分组筛选" help="留空则导出全部分组">
        <SelectInput
          value={selectedGroup}
          onChange={setSelectedGroup}
          options={[
            { value: '', label: '全部分组' },
            ...groups.map(g => ({ value: g, label: g }))
          ]}
        />
      </FormField>

      <FormField label="按类型筛选" help="留空则导出全部类型">
        <SelectInput
          value={selectedType}
          onChange={setSelectedType}
          options={[
            { value: '', label: '全部类型' },
            { value: 'http', label: 'HTTP' },
            { value: 'https', label: 'HTTPS' },
            { value: 'tcp', label: 'TCP' }
          ]}
        />
      </FormField>

      <div style={{ marginBottom: 12 }}>
        <CheckboxInput
          checked={useCompact}
          onChange={setUseCompact}
          label={
            <span>
              <b>精简格式</b>
              <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 6 }}>
                省略默认值字段，文件更小
              </span>
            </span>
          }
        />
      </div>

      {previewCount > 0 && !selectedGroup && groupCounts.length > 1 && (
        <div style={{ marginTop: 16 }}>
          <FormField label="导出方式">
            <SelectInput
              value={splitMode}
              onChange={setSplitMode}
              options={[
                { value: 'single', label: '单个文件' },
                { value: 'split', label: '按分组拆分为多个文件' },
                { value: 'individual', label: '按分组逐个下载' }
              ]}
            />
          </FormField>
        </div>
      )}

      {splitMode === 'individual' && !selectedGroup && groupCounts.length > 1 && (
        <div style={{
          marginTop: 12, maxHeight: 180, overflowY: 'auto',
          border: '1px solid #e5e7eb', borderRadius: 8, padding: 8
        }}>
          {groupCounts.map(({ group, count }) => (
            <div
              key={group}
              style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '8px 12px', borderBottom: '1px solid #f3f4f6', fontSize: 13
              }}
            >
              <span>
                <b>{group}</b>
                <span style={{ color: '#6b7280', marginLeft: 8 }}>{count} 个服务</span>
              </span>
              <Button size="sm" onClick={() => handleExportGroup(group)}>下载</Button>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
        <Button onClick={onClose}>取消</Button>
        {splitMode === 'split' ? (
          <Button variant="primary" onClick={handleExportSplit} disabled={previewCount === 0}>
            分片导出 ({groupCounts.length} 个文件)
          </Button>
        ) : (
          <Button variant="primary" onClick={handleExportSingle} disabled={previewCount === 0}>
            导出 JSON ({previewCount})
          </Button>
        )}
      </div>
    </Modal>
  )
}
