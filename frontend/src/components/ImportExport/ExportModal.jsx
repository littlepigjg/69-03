import React, { useState, useMemo } from 'react'
import Modal from '../Modal.jsx'
import { FormField, SelectInput, CheckboxInput, Button } from '../Form.jsx'
import { downloadJSON } from './utils.js'

export default function ExportModal({ onClose, groups = [], services = [] }) {
  const [selectedGroup, setSelectedGroup] = useState('')
  const [selectedType, setSelectedType] = useState('')
  const [selectedEnabled, setSelectedEnabled] = useState('')
  const [useCompact, setUseCompact] = useState(true)

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

  const handleExport = () => {
    const params = new URLSearchParams()
    params.append('format', 'pretty')
    params.append('compact', useCompact ? 'true' : 'false')
    if (selectedGroup) params.append('group', selectedGroup)
    if (selectedType) params.append('type', selectedType)
    if (selectedEnabled !== '') params.append('enabled', selectedEnabled)
    window.open(`/api/services/export?${params.toString()}`, '_blank')
    onClose()
  }

  return (
    <Modal
      title="导出服务配置"
      onClose={onClose}
      width={520}
    >
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 20 }}>
        选择筛选条件导出服务配置为 JSON 文件。导出的文件可用于版本控制或在其他环境导入。
      </p>

      <div style={{
        padding: 14, borderRadius: 10,
        background: '#eef2ff', border: '1px solid #c7d2fe',
        marginBottom: 20, textAlign: 'center'
      }}>
        <div style={{ fontSize: 12, color: '#6366f1', marginBottom: 4 }}>预计导出</div>
        <div style={{ fontSize: 28, fontWeight: 700, color: '#4f46e5' }}>
          {previewCount} <span style={{ fontSize: 14, fontWeight: 500 }}>个服务</span>
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

      <div style={{ marginBottom: 8 }}>
        <CheckboxInput
          checked={useCompact}
          onChange={setUseCompact}
          label={
            <span>
              <b>精简格式（推荐）</b>
              <span style={{ fontSize: 12, color: '#6b7280', marginLeft: 6 }}>
                - 只导出与默认值不同的字段，文件更小
              </span>
            </span>
          }
        />
      </div>

      <div style={{
        marginTop: 8, padding: 12, borderRadius: 8,
        background: '#f9fafb', fontSize: 12, color: '#6b7280',
        border: '1px solid #e5e7eb'
      }}>
        <div style={{ fontWeight: 600, marginBottom: 6, color: '#374151' }}>📄 格式示例</div>
        {useCompact ? (
          <pre style={{
            margin: 0, fontSize: 11, color: '#065f46',
            background: '#fff', padding: 10, borderRadius: 6,
            fontFamily: 'monospace', lineHeight: 1.6
          }}>{`{
  "name": "我的服务",
  "type": "https",
  "target": "https://api.example.com/health",
  "group": "业务服务"
}`}</pre>
        ) : (
          <pre style={{
            margin: 0, fontSize: 11, color: '#92400e',
            background: '#fff', padding: 10, borderRadius: 6,
            fontFamily: 'monospace', lineHeight: 1.6
          }}>{`{
  "name": "我的服务",
  "type": "https",
  "target": "https://api.example.com/health",
  "port": null,
  "method": "GET",
  "expectedStatus": 200,
  "interval_seconds": 30,
  "timeout_ms": 5000,
  "enabled": true,
  "group": "业务服务"
}`}</pre>
        )}
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
        <Button onClick={onClose}>取消</Button>
        <Button
          variant="primary"
          onClick={handleExport}
          disabled={previewCount === 0}
        >
          导出 JSON ({previewCount})
        </Button>
      </div>
    </Modal>
  )
}
