/**
 * 筛选展示模型只读取当前入口的作品。年份计数不受其他筛选影响，与类别行一致。
 * 片商统一一个入口，但JavDB ID与minnano名称各用带来源的选择键，不能按同名合并。
 */
import type { WorkEntry } from '../../entities/work'
import { workFacetOptions } from './query'
export const unknownYear = 'unknown'
export function workYear(row: WorkEntry) {
  return /^\d{4}(?:-|$)/.test(row.releaseDate || '') ? row.releaseDate!.slice(0, 4) : unknownYear
}
export function workYearOptions(entries: WorkEntry[], selected: string) {
  const counts = new Map<string, number>()
  for (const row of entries.filter(row => row.kind === 'work')) {
    const year = workYear(row)
    counts.set(year, (counts.get(year) || 0) + 1)
  }
  if (!counts.has(unknownYear)) counts.set(unknownYear, 0)
  if (selected && !counts.has(selected)) counts.set(selected, 0)
  return [...counts]
    .sort(([a], [b]) => (a === unknownYear ? 1 : b === unknownYear ? -1 : b.localeCompare(a)))
    .map(([id, count]) => ({
      key: id,
      label: id === unknownYear ? '未知年份' : id,
      count,
      selected: id === selected
    }))
}
export function makerOptions(entries: WorkEntry[]) {
  return [
    ...workFacetOptions(entries, 'maker').map(option => ({
      id: 'javdb:' + option.id,
      name: option.name,
      source: 'JavDB'
    })),
    ...[
      ...new Set(
        entries
          .filter(row => row.kind === 'work')
          .flatMap(row => (row.makerText ? [row.makerText] : []))
      )
    ].map(name => ({ id: 'minnano:' + encodeURIComponent(name), name, source: 'minnano' }))
  ].sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}
/** 只解包带来源的选择键；空选择清除两个历史参数，其余来源不得被推测成JavDB ID。 */
export function makerFilter(selection: string) {
  if (selection.startsWith('javdb:')) return { key: 'wf_maker', value: selection.slice(6) }
  if (selection.startsWith('minnano:'))
    return { key: 'wm', value: decodeURIComponent(selection.slice(8)) }
  return { key: 'clear_maker', value: '' }
}
