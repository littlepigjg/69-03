import React, { useState, useRef, useCallback, useEffect } from 'react'
import Modal from '../Modal.jsx'
import { FormField, SelectInput, Button } from '../Form.jsx'
import ProgressBar from './ProgressBar.jsx'
import LogViewer from './LogViewer.jsx'
import StatCard from './StatCard.jsx'
import ConflictModal from './ConflictModal.jsx'
import { parseJsonFileAsync, formatBytes, yieldToMain } from './utils.js'

const BATCH_SIZE = 30

export default function ImportModal({ onClose, onComplete }) {
  const fileInputRef = useRef(null)
  const [step, setStep] = useState('upload')
  const [fileName, setFileName] = useState('')
  const [fileSize, setFileSize] = useState(0)
  const [parseProgress, setParseProgress] = useState({ loaded: 0, total: 0 })
  const [previewData, setPreviewData] = useState(null)
  const [parsedData, setParsedData] = useState(null)
  const [importState, setImportState] = useState({
    imported: 0, skipped: 0, failed: 0,
    logs: [], errors: [], processed: 0, total: 0
  })
  const [showConflicts, setShowConflicts] = useState(false)
  const [defaultStrategy, setDefaultStrategy] = useState('skip')
  const [error, setError] = useState('')
  const abortRef = useRef(false)
  const importStateRef = useRef(importState)

  useEffect(() => {
    importStateRef.current = importState
  }, [importState])

  useEffect(() => {
    return () => { abortRef.current = true }
  }, [])

  const apiFetch = useCallback((url, options) => {
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
  }, [])

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

      setStep('validating')

      const preview = await apiFetch('/services/import/preview', {
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
      imported: 0, skipped: 0, failed: 0,
      logs: [`[信息] 开始导入 ${previewData?.validCount || total} 条有效配置...`],
      errors: previewData?.errors || [],
      processed: 0, total
    })
    setStep('importing')

    let existingNames = []
    try {
      existingNames = await apiFetch('/services/names/list')
      if (!Array.isArray(existingNames)) existingNames = []
    } catch {
      existingNames = []
    }

    let totalImported = 0
    let totalSkipped = 0
    let totalFailed = 0
    let allLogs = [`[信息] 开始导入 ${previewData?.validCount || total} 条有效配置...`]

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
        const result = await apiFetch('/services/import/batch', {
          method: 'POST',
          body: {
            services: batch,
            conflictStrategy: defaultStrategy,
            conflictResolutions: batchResolutions,
            existingNames
          }
        })

        const batchImported = result.imported?.length || 0
        const batchSkipped = result.skipped?.length || 0
        const batchFailed = result.failed?.length || 0

        totalImported += batchImported
        totalSkipped += batchSkipped
        totalFailed += batchFailed
        allLogs = allLogs.concat(result.logs || [])
        if (result.newNames) existingNames = existingNames.concat(result.newNames)

        const processed = Math.min(i + BATCH_SIZE, total)
        setImportState({
          imported: totalImported,
          skipped: totalSkipped,
          failed: totalFailed,
          logs: allLogs,
          errors: previewData?.errors || [],
          processed,
          total
        })

        if (i + BATCH_SIZE < total) {
          await yieldToMain()
        }
      } catch (e) {
        totalFailed += batch.length
        allLogs.push(`[失败] 批次 ${Math.floor(i / BATCH_SIZE) + 1} 出错: ${e.message}`)
        setImportState(prev => ({
          ...prev,
          failed: totalFailed,
          logs: allLogs
        }))
      }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(1)
    allLogs.push(`[信息] 导入完成: 成功 ${totalImported}, 跳过 ${totalSkipped}, 失败 ${totalFailed}, 耗时 ${duration}s`)

    setImportState({
      imported: totalImported,
      skipped: totalSkipped,
      failed: totalFailed,
      logs: allLogs,
      errors: previewData?.errors || [],
      processed: total,
      total
    })
    setStep('done')
  }, [parsedData, previewData, defaultStrategy, apiFetch])

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
              <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 4 }}>点击选择 JSON 文件</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>支持 services 数组格式，可先下载模板</div>
            </div>
            <input ref={fileInputRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={handleFileSelect} />

            {error && (
              <div style={{ marginTop: 16, padding: 12, borderRadius: 8, background: '#fee2e2', color: '#991b1b', fontSize: 13 }}>{error}</div>
            )}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <Button onClick={() => window.open('/api/services/template', '_blank')}>下载模板</Button>
              <Button onClick={onClose}>取消</Button>
            </div>
          </div>
        )}

        {step === 'parsing' && (
          <div style={{ padding: 40 }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{ fontSize: 32, marginBottom: 12 }}>⏳</div>
              <div style={{ fontWeight: 600, marginBottom: 4 }}>正在读取文件</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>{fileName} ({formatBytes(fileSize)})</div>
            </div>
            <ProgressBar
              value={parseProgress.loaded}
              max={parseProgress.total || fileSize || 1}
              label={parseProgress.total ? `读取: ${formatBytes(parseProgress.loaded)}/${formatBytes(parseProgress.total)}` : '读取中...'}
              indeterminate={!parseProgress.total}
            />
          </div>
        )}

        {step === 'validating' && (
          <div style={{ padding: 40, textAlign: 'center' }}>
            <ProgressBar indeterminate />
            <div style={{ fontWeight: 600, marginTop: 16 }}>正在验证配置...</div>
            <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>检查必填字段、枚举值、数值边界和名称冲突</div>
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
                  ⚠️ 发现 {previewData.errors.length} 个验证错误（将被跳过）:
                </div>
                <div style={{ maxHeight: 100, overflowY: 'auto', background: '#fef2f2', borderRadius: 8, padding: 10 }}>
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
              <div style={{ marginTop: 12, padding: 10, borderRadius: 8, background: '#fffbeb', color: '#92400e', fontSize: 12 }}>
                ⚠️ 冲突过多，仅显示前 500 条。其余将使用默认策略处理。
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
              <div style={{ fontSize: 14, fontWeight: 600 }}>正在导入服务配置...</div>
              <div style={{ fontSize: 12, color: '#6b7280' }}>
                {importState.imported} 成功 · {importState.skipped} 跳过 · {importState.failed} 失败
              </div>
            </div>
            <ProgressBar value={importState.processed} max={importState.total} />
            <div style={{ marginTop: 12 }}>
              <LogViewer logs={importState.logs} errors={importState.errors} />
            </div>
          </div>
        )}

        {step === 'done' && (
          <div>
            <div style={{
              textAlign: 'center', padding: 16, marginBottom: 16, borderRadius: 12,
              background: importState.imported > 0
                ? (importState.failed > 0 ? '#fef3c7' : '#d1fae5')
                : '#fee2e2'
            }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>
                {importState.imported > 0 ? (importState.failed > 0 ? '⚠️' : '✅') : '❌'}
              </div>
              <div style={{ fontSize: 16, fontWeight: 700 }}>
                {importState.imported > 0
                  ? (importState.failed > 0 ? '导入完成（部分失败）' : '导入成功')
                  : '导入失败'}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, marginBottom: 16 }}>
              <StatCard label="成功导入" value={importState.imported} color="#10b981" />
              <StatCard label="跳过" value={importState.skipped} color="#f59e0b" />
              <StatCard label="失败" value={importState.failed} color={importState.failed > 0 ? '#ef4444' : '#9ca3af'} />
            </div>

            <LogViewer logs={importState.logs} errors={importState.errors} />

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 20 }}>
              <Button variant="primary" onClick={() => { onComplete?.(); onClose() }}>完成</Button>
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
