/** URL范围参数的唯一约定。未知值仅在启用相应条件时排除，不把未知评分当作0分。 */
import type { WorkEntry } from '../../entities/work'
export const workRanges = [
  { key: 'wr_score', label: '最低评分', max: 5, step: 0.1 },
  { key: 'wr_votes', label: '最低评价人数', step: 1 },
  { key: 'wr_min', label: '最短时长（分钟）', step: 1 },
  { key: 'wr_max', label: '最长时长（分钟）', step: 1 }
] as const
export function rangeValue(params: URLSearchParams, key: string): number | null {
  const raw = params.get(key)
  if (!raw?.trim()) return null
  const value = Number(raw)
  if (!Number.isFinite(value) || value < 0 || (key === 'wr_score' && value > 5)) return null
  if (key !== 'wr_score' && !Number.isSafeInteger(value)) return null
  return value
}
export function matchesWorkRanges(row: WorkEntry, params: URLSearchParams) {
  const values = [row.rating?.score, row.rating?.count, row.durationMinutes, row.durationMinutes]
  return workRanges.every(({ key }, i) => {
    const limit = rangeValue(params, key),
      value = values[i]
    if (limit === null) return true
    return (
      value != null &&
      Number.isFinite(value) &&
      (key === 'wr_max' ? value <= limit : value >= limit)
    )
  })
}
/** 只归一化番号匹配，不去掉标题标点；全角字符、大小写、空格与连字符均可容错。 */
export function matchesWorkSearch(row: WorkEntry, query: string) {
  const text = query.normalize('NFKC').trim().toLowerCase()
  if (!text) return true
  const code = (value: string) =>
    value
      .normalize('NFKC')
      .toLowerCase()
      .replace(/[\s\-‐‑–—−]/g, '')
  return (
    row.title.normalize('NFKC').toLowerCase().includes(text) ||
    (!!row.code && !!code(text) && code(row.code).includes(code(text)))
  )
}
