export interface InspectionReportContract {
  expected_device_ids: string[]
  expected_statuses?: Record<string, string>
}

export interface InspectionReportCheck {
  ok: boolean
  device_ids: string[]
  missing: string[]
  unexpected: string[]
  duplicates: string[]
  errors: string[]
  total: number
  declared_total?: number
}

/** 读取实际产物，不生成报告、不依据模型自己的完成声明。 */
export function verifyInspectionReport(content: string, format: 'csv' | 'markdown', contract: InspectionReportContract): InspectionReportCheck {
  if (!Array.isArray(contract.expected_device_ids) || !contract.expected_device_ids.length
    || contract.expected_device_ids.some(id => typeof id !== 'string' || !id.trim())
    || new Set(contract.expected_device_ids).size !== contract.expected_device_ids.length) throw new Error('验收设备清单必须非空、唯一')
  const rows = format === 'csv' ? csvRows(content) : markdownRows(content)
  const errors: string[] = []
  const header = rows.shift() ?? []
  const idIndex = header.findIndex(value => /^(device_id|asset_id|设备\s*ID|资产\s*ID|设备标识|资产标识)$/i.test(value.trim()))
  const statusIndex = header.findIndex(value => /^(status|状态|巡检状态|结果)$/i.test(value.trim()))
  if (idIndex < 0 || statusIndex < 0) errors.push('报告缺少设备标识或状态列')
  const devices = rows.filter(row => row.some(value => value.trim())).map(row => ({ id: (row[idIndex] ?? '').trim(), status: (row[statusIndex] ?? '').trim() }))
  const ids = devices.map(row => row.id)
  const expected = new Set(contract.expected_device_ids)
  const seen = new Set<string>(), duplicates = new Set<string>()
  for (const { id, status } of devices) {
    if (!id || !status) errors.push('报告存在缺少设备标识或状态的行')
    if (seen.has(id)) duplicates.add(id)
    seen.add(id)
    if (contract.expected_statuses?.[id] !== undefined && contract.expected_statuses[id] !== status) errors.push(`设备 ${id} 状态与固定输入不符`)
  }
  const missing = [...expected].filter(id => !seen.has(id))
  const unexpected = [...seen].filter(id => !expected.has(id))
  const totalMatch = format === 'markdown' ? content.match(/(?:设备总数|总设备数|设备合计|total\s+devices)\s*[:：]\s*(\d+)/i) : null
  const declaredTotal = totalMatch ? Number(totalMatch[1]) : undefined
  if (format === 'markdown' && declaredTotal === undefined) errors.push('Markdown 报告缺少“设备总数：N”汇总')
  if (declaredTotal !== undefined && declaredTotal !== ids.length) errors.push('报告汇总与明细数量不一致')
  return { ok: !errors.length && !missing.length && !unexpected.length && !duplicates.size,
    device_ids: ids, missing, unexpected, duplicates: [...duplicates], errors, total: ids.length,
    ...(declaredTotal === undefined ? {} : { declared_total: declaredTotal }) }
}

function csvRows(content: string): string[][] {
  const rows: string[][] = [], row: string[] = []
  let value = '', quoted = false
  const text = content.replace(/^\uFEFF/, '')
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (char === '"') {
      if (quoted && text[index + 1] === '"') { value += '"'; index++ }
      else if (!quoted && value) throw new Error('CSV 引号格式无效')
      else quoted = !quoted
    } else if (char === ',' && !quoted) { row.push(value); value = '' }
    else if (char === '\n' && !quoted) { row.push(value.replace(/\r$/, '')); rows.push([...row]); row.length = 0; value = '' }
    else value += char
  }
  if (quoted) throw new Error('CSV 引号未闭合')
  if (value || row.length) { row.push(value.replace(/\r$/, '')); rows.push(row) }
  return rows
}

function markdownRows(content: string): string[][] {
  const lines = content.split(/\r?\n/)
  const cells = (line: string) => line.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map(value => value.trim().replace(/^`|`$/g, ''))
  for (let index = 0; index < lines.length - 1; index++) {
    const header = cells(lines[index])
    if (!header.some(value => /^(设备\s*ID|资产\s*ID|设备标识|资产标识|device_id|asset_id)$/i.test(value))) continue
    if (!cells(lines[index + 1]).every(value => /^:?-{3,}:?$/.test(value))) continue
    const rows = [header]
    for (let cursor = index + 2; cursor < lines.length && lines[cursor].includes('|') && lines[cursor].trim(); cursor++) rows.push(cells(lines[cursor]))
    return rows
  }
  return []
}
