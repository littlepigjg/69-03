import React, { useState, useRef, useEffect, useCallback } from 'react'
import Modal from './Modal.jsx'
import { FormField, TextInput, SelectInput, Button } from './Form.jsx'
import useApi from '../hooks/useApi.js'

function ProgressBar({ value, max, label }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0
  return (
    <div style={{ margin: '8px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: '#6b7280', marginBottom: 4 }}>
        <span>{label || `进度: ${value}/${max}`}</span>
        <span>{pct.toFixed(0)}%</span>
      </div>
      <div style={{
        width: '100%', height: 10, borderRadius: 5,
        background: '#e5e7eb', overflow: 'hidden'
      }}>
        <div style={{
          width: `${pct}%`, height: '100%',
          background: 'linear-gradient(90deg, #6366f1, #8b5cf6)',
          transition: 'width 0.2s ease-out'
        }} />
      </div>
    </div>
  )
}

function LogViewer({ logs, errors }) {
  const logRef = useRef(null)

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [logs, errors])

  const allEntries = [
    ...(errors || []).map(e => ({ type: 'error', text: `${e.field}: ${e.message}` })),
    ...(logs || []).map(l => ({ type: 'info', text: l }))
  ]

  return (
    <div
      ref={logRef}
      style={{
        maxHeight: 240, overflowY: 'auto',
        background: '#1f2937', borderRadius: 8, padding: 12,
        fontFamily: 'monospace', fontSize: 12, lineHeight: 1.6
      }}
    >
      {allEntries.length === 0 ? (
        <div style={{ color: '#9ca3af' }}>等待处理...</div>
      ) : (
        allEntries.map((entry, idx) => (
          <div
            key={idx}
            style={{
              color: entry.type === 'error' ? '#fca5a5' : entry.type === 'warn' ? '#fcd34d' : '#a7f3d0',
              whiteSpace: 'pre-wrap', wordBreak: 'break-all'
            }}
          >
            {entry.type === 'error' && '❌ '}
            {entry.type === 'warn' && '⚠️ '}
            {entry.type === 'info' && entry.text.startsWith('[创建]') && '✅ '}
            {entry.type === 'info' && entry.text.startsWith('[覆盖]') && '🔄 '}
            {entry.type === 'info' && entry.text.startsWith('[跳过]') && '⏭️ '}
            {entry.type === 'info' && entry.text.startsWith('[失败]') && '❌ '}
            {entry.text.replace(/^\[(创建|覆盖|跳过|失败)\]\s*/, '')}
          </div>
        ))
      )}
    </div>
  )
}

function ConflictModal({ conflicts, onResolve, onCancel }) {
  const [resolutions, setResolutions] = useState({})
  const [applyAll, setApplyAll] = useState(null)

  const handleSingleResolve = (index, strategy) => {
    setResolutions(prev => ({ ...prev, [index]: strategy }))
  }

  const handleApplyAll = (strategy) => {
    setApplyAll(strategy)
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
      width={720}
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
          检测到 {conflicts.length} 个服务名称与现有服务冲突，请选择处理方式：
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 12, color: '#6b7280', alignSelf: 'center' }}>批量应用：</span>
          <Button size="sm" variant={applyAll === 'skip' ? 'primary' : 'default'} onClick={() => handleApplyAll('skip')}>全部跳过</Button>
          <Button size="sm" variant={applyAll === 'overwrite' ? 'primary' : 'default'} onClick={() => handleApplyAll('overwrite')}>全部覆盖</Button>
          <Button size="sm" variant={applyAll === 'duplicate' ? 'primary' : 'default'} onClick={() => handleApplyAll('duplicate')}>全部创建副本</Button>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 12, maxHeight: 400, overflowY: 'auto' }}>
        {conflicts.map(c => (
          <div key={c.index} style={{
            border: '1px solid #e5e7eb', borderRadius: 10, padding: 14,
            background: resolutions[c.index] ? '#f0fdf4' : '#fff'
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                ⚠️ {c.name}
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
                  background: '#f3f4f6', borderRadius: 6, padding: 8,
                  fontFamily: 'monospace', color: '#374151'
                }}>
                  {c.existingConfig.type} → {c.existingConfig.target}
                  {c.existingConfig.port ? `:${c.existingConfig.port}` : ''}
                  <br />
                  间隔: {c.existingConfig.interval_seconds}s · 超时: {c.existingConfig.timeout_ms}ms
                  {c.existingConfig.group ? ` · 分组: ${c.existingConfig.group}` : ''}
                </div>
              </div>
              <div>
                <div style={{ color: '#6b7280', marginBottom: 4, fontWeight: 600 }}>导入配置</div>
                <div style={{
                  background: '#fef3c7', borderRadius: 6, padding: 8,
                  fontFamily: 'monospace', color: '#374151'
                }}>
                  {c.newConfig.type} → {c.newConfig.target}
                  {c.newConfig.port ? `:${c.newConfig.port}` : ''}
                  <br />
                  间隔: {c.newConfig.interval_seconds}s · 超时: {c.newConfig.timeout_ms}ms
                  {c.newConfig.group ? ` · 分组: ${c.newConfig.group}` : ''}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </Modal>
  )
}

export function ImportModal({ onClose, onComplete }) {
  const { post } = useApi('/api')
  const fileInputRef = useRef(null)
  const [step, setStep] = useState('upload')
  const [fileName, setFileName] = useState('')
  const [previewData, setPreviewData] = useState(null)
  const [parsedData, setParsedData] = useState(null)
  const [importing, setImporting] = useState(false)
  const [importResult, setImportResult] = useState(null)
  const [showConflicts, setShowConflicts] = useState(false)
  const [conflictResolutions, setConflictResolutions] = useState({})
  const [defaultStrategy, setDefaultStrategy] = useState('skip')
  const [error, setError] = useState('')

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setFileName(file.name)
    setError('')
    setStep('parsing')

    try {
      const text = await file.text()
      const json = JSON.parse(text)
      setParsedData(json)

      const preview = await post('/services/import/preview', json)
      setPreviewData(preview)
      setStep('preview')
    } catch (e) {
      setError(e.message || '文件解析失败，请确保是有效的 JSON 文件')
      setStep('upload')
    }
  }

  const handleStartImport = useCallback(async (resolutions = {}) => {
    if (!parsedData) return

    setImporting(true)
    setShowConflicts(false)
    setConflictResolutions(resolutions)
    setStep('importing')

    try {
      const services = Array.isArray(parsedData) ? parsedData : parsedData.services
      const result = await post('/services/import', {
        services,
        conflictStrategy: defaultStrategy,
        conflictResolutions: resolutions
      })
      setImportResult(result)
      setStep('done')
    } catch (e) {
      setError(e.message || '导入失败')
      setStep('preview')
    } finally {
      setImporting(false)
    }
  }, [parsedData, defaultStrategy, post])

  const handlePreviewImport = () => {
    if (previewData?.conflicts?.length > 0 && !showConflicts) {
      setShowConflicts(true)
      return
    }
    handleStartImport({})
  }

  const handleResolveConflicts = (resolutions) => {
    handleStartImport(resolutions)
  }

  const totalProcessed = importResult
    ? (importResult.imported?.length || 0) + (importResult.skipped?.length || 0) + (importResult.failed?.length || 0)
    : 0

  return (
    <>
      <Modal
        title="批量导入服务配置"
        onClose={onClose}
        width={680}
      >
        {step === 'upload' && (
          <div>
            <div
              onClick={() => fileInputRef.current?.click()}
              style={{
                border: '2px dashed #d1d5db', borderRadius: 12,
                padding: 48, textAlign: 'center', cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseEnter={e => {
                e.currentTarget.style.borderColor = '#6366f1'
                e.currentTarget.style.background = '#eef2ff'
              }}
              onMouseLeave={e => {
                e.currentTarget.style.borderColor = '#d1d5db'
                e.currentTarget.style.background = '#fff'
              }}
            >
              <div style={{ fontSize: 48, marginBottom: 12 }}>📁</div>
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>
                点击选择 JSON 文件
              </div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                支持 services 数组格式，可先下载模板查看格式
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              style={{ display: 'none' }}
              onChange={handleFileSelect}
            />

            {error && (
              <div style={{
                marginTop: 16, padding: 12, borderRadius: 8,
                background: '#fee2e2', color: '#991b1b', fontSize: 13
              }}>{error}</div>
            )}

            <div style={{
              display: 'flex', gap: 10, justifyContent: 'flex-end',
              marginTop: 20
            }}>
              <Button onClick={() => window.open('/api/services/template', '_blank')}>
                下载模板
              </Button>
              <Button onClick={onClose}>取消</Button>
            </div>
          </div>
        )}

        {step === 'parsing' && (
          <div style={{ textAlign: 'center', padding: 40 }}>
            <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
            <div>正在解析文件: {fileName}</div>
          </div>
        )}

        {step === 'preview' && previewData && (
          <div>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
              文件: <b style={{ color: '#1f2937' }}>{fileName}</b>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 16 }}>
              <StatCard label="总配置数" value={previewData.totalCount} color="#6366f1" />
              <StatCard label="有效配置" value={previewData.validCount} color="#10b981" />
              <StatCard label="无效配置" value={previewData.invalidCount} color={previewData.invalidCount > 0 ? '#ef4444' : '#9ca3af'} />
              <StatCard label="名称冲突" value={previewData.conflicts?.length || 0} color={previewData.conflicts?.length > 0 ? '#f59e0b' : '#9ca3af'} />
            </div>

            <FormField label="默认冲突处理策略" help="当服务名称已存在时的默认处理方式">
              <SelectInput
                value={defaultStrategy}
                onChange={setDefaultStrategy}
                options={[
                  { value: 'skip', label: '跳过（保留原配置）' },
                  { value: 'overwrite', label: '覆盖（更新现有配置）' },
                  { value: 'duplicate', label: '创建副本（添加序号后缀）' }
                ]}
              />
            </FormField>

            {previewData.errors?.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#991b1b', marginBottom: 8 }}>
                  ⚠️ 发现 {previewData.errors.length} 个验证错误（这些配置将被跳过）:
                </div>
                <div style={{
                  maxHeight: 120, overflowY: 'auto',
                  background: '#fef2f2', borderRadius: 8, padding: 10
                }}>
                  {previewData.errors.slice(0, 20).map((e, i) => (
                    <div key={i} style={{ fontSize: 12, color: '#991b1b', padding: '2px 0' }}>
                      • <b>{e.field}</b>: {e.message}
                    </div>
                  ))}
                  {previewData.errors.length > 20 && (
                    <div style={{ fontSize: 12, color: '#991b1b', padding: '2px 0' }}>
                      ...还有 {previewData.errors.length - 20} 个错误
                    </div>
                  )}
                </div>
              </div>
            )}

            {previewData.preview?.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
                  配置预览（前 {Math.min(10, previewData.validCount)} 项）:
                </div>
                <div style={{ maxHeight: 160, overflowY: 'auto' }}>
                  {previewData.preview.map((s, i) => (
                    <div key={i} style={{
                      padding: '8px 12px', borderBottom: '1px solid #f3f4f6',
                      fontSize: 12, fontFamily: 'monospace'
                    }}>
                      <b style={{ color: '#4f46e5' }}>{s.name}</b>
                      <span style={{ color: '#6b7280' }}> · </span>
                      <span style={{ textTransform: 'uppercase' }}>{s.type}</span>
                      <span style={{ color: '#6b7280' }}> → </span>
                      {s.target}{s.port ? `:${s.port}` : ''}
                      {s.group && <span style={{ color: '#8b5cf6' }}> · [{s.group}]</span>}
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <Button onClick={onClose}>取消</Button>
              <Button
                variant="primary"
                onClick={handlePreviewImport}
                disabled={previewData.validCount === 0}
              >
                {previewData.conflicts?.length > 0 ? '处理冲突并导入' : '开始导入'}
                {' '}({previewData.validCount} 项)
              </Button>
            </div>
          </div>
        )}

        {step === 'importing' && (
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>
              正在导入服务配置...
            </div>
            <ProgressBar
              value={totalProcessed}
              max={previewData?.validCount || 1}
            />
            <LogViewer logs={importResult?.logs} errors={importResult?.validationErrors} />
          </div>
        )}

        {step === 'done' && importResult && (
          <div>
            <div style={{
              textAlign: 'center', padding: 16, marginBottom: 16,
              borderRadius: 12, background: importResult.imported?.length > 0 ? '#d1fae5' : '#fef3c7'
            }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>
                {importResult.imported?.length > 0 ? '✅' : '⚠️'}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>
                导入完成
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
              <StatCard label="成功导入" value={importResult.imported?.length || 0} color="#10b981" />
              <StatCard label="跳过" value={importResult.skipped?.length || 0} color="#f59e0b" />
              <StatCard label="失败" value={importResult.failed?.length || 0} color={importResult.failed?.length > 0 ? '#ef4444' : '#9ca3af'} />
            </div>

            <LogViewer logs={importResult.logs} errors={importResult.validationErrors} />

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <Button
                variant="primary"
                onClick={() => { onComplete?.(); onClose() }}
              >
                完成
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {showConflicts && previewData?.conflicts?.length > 0 && (
        <ConflictModal
          conflicts={previewData.conflicts}
          onResolve={handleResolveConflicts}
          onCancel={() => setShowConflicts(false)}
        />
      )}
    </>
  )
}

function StatCard({ label, value, color }) {
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

export function ExportModal({ onClose, groups = [] }) {
  const [selectedGroup, setSelectedGroup] = useState('')
  const [selectedType, setSelectedType] = useState('')

  const handleExport = () => {
    const params = new URLSearchParams()
    params.append('format', 'pretty')
    if (selectedGroup) params.append('group', selectedGroup)
    if (selectedType) params.append('type', selectedType)
    window.open(`/api/services/export?${params.toString()}`, '_blank')
    onClose()
  }

  return (
    <Modal
      title="导出服务配置"
      onClose={onClose}
      width={480}
    >
      <p style={{ color: '#6b7280', fontSize: 13, marginBottom: 20 }}>
        选择筛选条件导出服务配置为 JSON 文件，导出的文件可用于版本控制或在其他环境导入。
      </p>

      <FormField label="按分组筛选" help="留空则导出全部分组">
        <SelectInput
          value={selectedGroup}
          onChange={setSelectedGroup}
          options={[
            { value: '', label: '全部服务' },
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

      <div style={{
        marginTop: 20, padding: 12, borderRadius: 8,
        background: '#f3f4f6', fontSize: 12, color: '#6b7280'
      }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>📄 导出格式说明</div>
        <div>• 缩进格式化 JSON，便于人工阅读和 Git 版本控制</div>
        <div>• 包含版本号、导出时间、筛选条件和服务配置</div>
        <div>• 可直接通过导入功能在其他环境恢复</div>
      </div>

      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
        <Button onClick={onClose}>取消</Button>
        <Button variant="primary" onClick={handleExport}>
          导出 JSON
        </Button>
      </div>
    </Modal>
  )
}

export default { ImportModal, ExportModal }
