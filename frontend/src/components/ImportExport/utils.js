export function yieldToMain() {
  return new Promise(resolve => setTimeout(resolve, 0))
}

export async function processArrayInChunks(array, chunkSize, processFn, onProgress) {
  const results = []
  for (let i = 0; i < array.length; i += chunkSize) {
    const chunk = array.slice(i, i + chunkSize)
    const chunkResults = await processFn(chunk, i)
    results.push(...chunkResults)
    if (onProgress) {
      onProgress(Math.min(i + chunkSize, array.length), array.length)
    }
    if (i + chunkSize < array.length) {
      await yieldToMain()
    }
  }
  return results
}

export async function parseJsonFileAsync(file, onProgress) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()

    reader.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(e.loaded, e.total)
      }
    }

    reader.onload = (e) => {
      try {
        const text = e.target.result
        const json = JSON.parse(text)
        resolve(json)
      } catch (err) {
        reject(err)
      }
    }

    reader.onerror = () => {
      reject(new Error('文件读取失败'))
    }

    reader.readAsText(file)
  })
}

export function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function downloadJSON(data, filename) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
}
