import React, { useState, useRef, useCallback, useEffect } from 'react'
import Modal from '../Modal.jsx'
import { FormField, SelectInput, Button } from '../Form.jsx'
import ProgressBar from './ProgressBar.jsx'
import LogViewer from './LogViewer.jsx'
import StatCard from './StatCard.jsx'
import ConflictModal from './ConflictModal.jsx'
import { parseJsonFileAsync, formatBytes, yieldToMain } from './utils.js'

const BATCH_SIZE = 50

export default function ImportModal({ onClose, onComplete }) {
  const fileInputRef = useRef(null)
  const [step, setStep] = useState('upload')
  const [fileName, setFileName] = useState('')
  const [fileSize, setFileSize] = useState(0)
  const [parseProgress, setParseProgress] = useState({ loaded: 0, total: 0 })
  const [previewData, setPreviewData] = useState(null)
  const [parsedData, setParsedData] = useState(null)
  const [importState, setImportState] = useState({
    imported: [],
    skipped: [],
    failed: [],
    logs: [],
    errors: [],
    processed: 0,
    total: 0
  })
  const [showConflicts, setShowConflicts] = useState(false)
  const [defaultStrategy, setDefaultStrategy] = useState('skip')
  const [error, setError] = useState('')
  const abortRef = useRef(false)

  useEffect(() => {
    return () => { abortRef.current = true }
  }, [])

  const fetch = (url, options) => {
    return window.fetch(`/api${url}`, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined
    }).then(async res => {
      const text = await res.text()
      let data
      try { data = text ? JSON.parse(text) : null } catch { data = text }
      if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
      return data
    })
  }

  const handleFileSelect = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return

    setFileName(file.name)
    setFileSize(file.size)
    setError('')
    setStep('parsing')

    try {
      const json = await parseJsonFileAsync(file, (loaded, total) => {
        setParseProgress({ loaded, total })
      })

      await yieldToMain()
      setParsedData(json)

      const preview = await fetch('/services/import/preview', {
        method: 'POST',
        body: json
      })
      setPreviewData(preview)
      setStep('preview')
    } catch (e) {
      setError(e.message || '文件解析失败，请确保是有效的 JSON 文件')
      setStep('upload')
    }
  }

  const runBatchImport = useCallback(async (resolutions = {}) => {
    if (!parsedData) return
    abortRef.current = false

    const allServices = Array.isArray(parsedData) ? parsedData : parsedData.services
    const total = allServices.length
    const startTime = Date.now()

    setImportState({
      imported: [],
      skipped: [],
      failed: [],
      logs: [`[信息] 开始导入 ${previewData?.validCount || total} 条有效配置，共 ${total} 条...`],
      errors: previewData?.errors || [],
      processed: 0,
      total
    })
    setStep('importing')

    let existingNames = []
    try {
      existingNames = await fetch('/services/groups').catch(() => [])
      const allSvcs = await fetch('/services').catch(() => [])
      existingNames = Array.isArray(allSvcs) ? allSvcs.map(s => s.name) : []
    } catch {
      existingNames = []
    }

    let cumulativeImported = []
    let cumulativeSkipped = []
    let cumulativeFailed = []
    let cumulativeLogs = [`[信息] 开始导入 ${previewData?.validCount || total} 条有效配置，共 ${total} 条...`]
    let workingNames = [...existingNames]

    for (let i = 0; i < total; i += BATCH_SIZE) {
      if (abortRef.current) break

      const batch = allServices.slice(i, i + BATCH_SIZE)
      const batchResolutions = {}
      Object.keys(resolutions).forEach(key => {
        const idx = parseInt(key, 10)
        if (idx >= i && idx < i + BATCH_SIZE) {
          batchResolutions[idx - i] = resolutions[key]
        }
      })

      try {
        const result = await fetch('/services/import/batch', {
          method: 'POST',
          body: {
            services: batch,
            conflictStrategy: defaultStrategy,
            conflictResolutions: batchResolutions,
            existingNames: workingNames
          }
        })

        cumulativeImported = cumulativeImported.concat(result.imported || [])
        cumulativeSkipped = cumulativeSkipped.concat(result.skipped || [])
        cumulativeFailed = cumulativeFailed.concat(result.failed || [])
        cumulativeLogs = cumulativeLogs.concat(result.logs || [])
        if (result.newNames) workingNames = workingNames.concat(result.newNames)

        const processed = Math.min(i + BATCH_SIZE, total)
        setImportState({
          imported: cumulativeImported,
          skipped: cumulativeSkipped,
          failed: cumulativeFailed,
          logs: cumulativeLogs,
          errors: previewData?.errors || [],
          processed,
          total
        })

        if (i + BATCH_SIZE < total) {
          await yieldToMain()
        }
      } catch (e) {
        cumulativeFailed = cumulativeFailed.concat(
          batch.map((_, j) => ({
            index: i + j,
            name: batch[j]?.name || `第 ${i + j + 1} 项`,
            error: e.message
          }))
        )
        cumulativeLogs.push(`[失败] 批次 ${Math.floor(i / BATCH_SIZE) + 1} 处理出错: ${e.message}`)
        setImportState(prev => ({
          ...prev,
          failed: cumulativeFailed,
          logs: cumulativeLogs
        }))
        break
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    cumulativeLogs.push(`[信息] 导入完成: 成功 ${cumulativeImported.length} 条, 跳过 ${cumulativeSkipped.length} 条, 失败 ${cumulativeFailed.length} 条, 耗时 ${duration}s`)

    setImportState(prev => ({
      ...prev,
      imported: cumulativeImported,
      skipped: cumulativeSkipped,
      failed: cumulativeFailed,
      logs: cumulativeLogs,
      processed: total
    }))
    setStep('done')
  }, [parsedData, previewData, defaultStrategy])

  const handlePreviewImport = () => {
    if (previewData?.conflicts?.length > 0 && !showConflicts) {
      setShowConflicts(true)
      return
    }
    runBatchImport({})
  }

  const handleResolveConflicts = (resolutions) => {
    setShowConflicts(false)
    runBatchImport(resolutions)
  }

  const totalProcessed = importState.processed
  const importTotal = importState.total || previewData?.validCount || 1

  return (
    <>
      <Modal
        title="批量导入服务配置"
        onClose={onClose}
        width={720}
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
          <div style={{ padding: 40 }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>正在解析文件</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                {fileName} ({formatBytes(fileSize)})
              </div>
            </div>
            <ProgressBar
              value={parseProgress.loaded}
              max={parseProgress.total || fileSize || 1}
              label={parseProgress.total ? `读取: ${formatBytes(parseProgress.loaded)}/${formatBytes(parseProgress.total)}` : '读取中...'}
              indeterminate={!parseProgress.total}
            />
            <div style={{ fontSize: 11, color: '#9ca3af', textAlign: 'center', marginTop: 12 }}>
              💡 大文件解析和验证可能需要几秒，请耐心等待
            </div>
          </div>
        )}

        {step === 'preview' && previewData && (
          <div>
            <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 16 }}>
              文件: <b style={{ color: '#1f2937' }}>{fileName}</b>
              <span style={{ color: '#9ca3af' }}> · {formatBytes(fileSize)}</span>
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
                  maxHeight: 100, overflowY: 'auto',
                  background: '#fef2f2', borderRadius: 8, padding: 10
                }}>
                  {previewData.errors.slice(0, 30).map((e, i) => (
                    <div key={i} style={{ fontSize: 12, color: '#991b1b', padding: '2px 0' }}>
                      • <b>{e.field}</b>: {e.message}
                    </div>
                  ))}
                  {previewData.errors.length > 30 && (
                    <div style={{ fontSize: 12, color: '#991b1b', padding: '2px 0' }}>
                      ...还有 {previewData.errors.length - 30} 个错误
                    </div>
                  )}
                </div>
              </div>
            )}

            {previewData.conflictsTruncated && (
              <div style={{
                marginTop: 12, padding: 10, borderRadius: 8,
                background: '#fffbeb', color: '#92400e', fontSize: 12
              }}>
                ⚠️ 冲突过多，仅显示前 500 条。其余冲突将使用默认策略处理。
              </div>
            )}

            {previewData.preview?.length > 0 && (
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#374151', marginBottom: 8 }}>
                  配置预览（前 {Math.min(10, previewData.validCount)} 项）:
                </div>
                <div style={{ maxHeight: 140, overflowY: 'auto' }}>
                  {previewData.preview.map((s, i) => (
                    <div key={i} style={{
                      padding: '6px 12px', borderBottom: '1px solid #f3f4f6',
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
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>
                正在导入服务配置...
              </div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                {importState.imported.length} 成功 · {importState.skipped.length} 跳过 · {importState.failed.length} 失败
              </div>
            </div>
            <ProgressBar
              value={totalProcessed}
              max={importTotal}
            />
            <div style={{ marginTop: 12 }}>
              <LogViewer logs={importState.logs} errors={importState.errors} />
            </div>
          </div>
        )}

        {step === 'done' && (
          <div>
            <div style={{
              textAlign: 'center', padding: 16, marginBottom: 16,
              borderRadius: 12,
              background: importState.imported.length > 0
                ? (importState.failed.length > 0 ? '#fef3c7' : '#d1fae5')
                : '#fee2e2'
            }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>
                {importState.imported.length > 0
                  ? (importState.failed.length > 0 ? '⚠️' : '✅')
                  : '❌'}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>
                {importState.imported.length > 0
                  ? (importState.failed.length > 0 ? '导入完成（部分失败）' : '导入成功')
                  : '导入失败'}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
              <StatCard label="成功导入" value={importState.imported.length} color="#10b981" />
              <StatCard label="跳过" value={importState.skipped.length} color="#f59e0b" />
              <StatCard label="失败" value={importState.failed.length} color={importState.failed.length > 0 ? '#ef4444' : '#9ca3af'} />
            </div>

            <LogViewer logs={importState.logs} errors={importState.errors} />

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
