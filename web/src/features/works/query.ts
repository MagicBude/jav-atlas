/** 列表排序独立成纯函数：未知评分排最后，同分按日期及原生ID稳定排序。 */
import type { WorkEntry } from '../../entities/work'
import { workRanges } from './ranges'
import {
  javdbDisplayTagId,
  javdbTagLabel,
  tagSelectionKey,
  parseTagSelection
} from '../../entities/tagLabels'
export const facetKeys = ['prefix', 'director', 'maker', 'series', 'tag'] as const
/** 逗号分隔查询键；名称部分已编码，兼容旧数字链接并去除重复条件。 */
export const selectedTags = (params: URLSearchParams) => [
  ...new Set((params.get('wf_tag') || '').split(',').filter(Boolean))
]
/** 选项来自当前范围；类别按 ID＋原名去重，其他维度按来源 ID 去重。 */
export function workFacetOptions(entries: WorkEntry[], kind: string) {
  const values = new Map<string, string>()
  for (const row of entries) {
    if (kind === 'prefix') {
      const prefix = row.code?.toUpperCase().match(/^([A-Z]+)(?=[-\d])/)?.[1]
      if (prefix) values.set(prefix, prefix)
    } else
      for (const value of row.facets?.[kind] || [])
        values.set(
          kind === 'tag' ? tagSelectionKey(value.id, value.name, row.javdbType) : value.id,
          kind === 'tag' ? javdbTagLabel(value.id, value.name, row.javdbType) : value.name
        )
  }
  return [...values]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}
export function matchesWorkFacets(row: WorkEntry, params: URLSearchParams) {
  return facetKeys.every(kind => {
    const selected = params.get(`wf_${kind}`)
    if (!selected) return true
    if (kind === 'tag') {
      const ids = selectedTags(params)
      const matches = (key: string) => {
        const selected = parseTagSelection(key)
        // 旧数字链接继续可用；新链接总是携带原名，避免跨类型误匹配。
        return (
          row.facets?.tag?.some(
            value =>
              (value.id === selected.id ||
                javdbDisplayTagId(value.id, value.name, row.javdbType) === selected.id) &&
              (selected.type === undefined || row.javdbType === selected.type) &&
              (selected.name === undefined || value.name === selected.name)
          ) || false
        )
      }
      // 类别多选统一取交集，不再提供两套容易混淆的匹配方式。
      return ids.every(matches)
    }
    if (kind === 'prefix')
      return row.code?.toUpperCase().match(/^([A-Z]+)(?=[-\d])/)?.[1] === selected.toUpperCase()
    return row.facets?.[kind]?.some(value => value.id === selected) || false
  })
}
/** 仅继承作品库已有条件；移除详情/页码，链接保留原历史供浏览器后退。 */
export function facetUrl(kind: string, id: string, pathname: string, search: string) {
  const params = pathname === '/works' ? new URLSearchParams(search) : new URLSearchParams()
  params.delete('work')
  params.delete('wp')
  params.set(`wf_${kind}`, id)
  return `/works?${params.toString()}`
}
/** 只清除影响结果集合的条件，保留排序、密度、人物分区及其他页面上下文。 */
export function clearWorkFilters(search: string, queryKey = 'wq', keepQuery = false) {
  const next = new URLSearchParams(search)
  for (const key of [
    'wa',
    'wy',
    'wm',
    'wp',
    'wt_mode',
    ...workRanges.map(range => range.key),
    ...facetKeys.map(kind => `wf_${kind}`),
    ...(keepQuery ? [] : [queryKey])
  ])
    next.delete(key)
  return next.toString()
}
/** 密度只改变排版，不改变结果集合；保留页码，避免切换外观时跳回第一页。 */
export function workQuery(search: string, key: string, value: string) {
  const next = new URLSearchParams(search)
  // 清理已取消的匹配方式参数，避免旧链接留下隐藏开关。
  next.delete('wt_mode')
  // 新入口选择片商时互斥清除另一来源参数；直接打开旧URL时仍按原有条件执行。
  if (key === 'clear_maker') {
    next.delete('wm')
    next.delete('wf_maker')
    next.delete('wp')
    return next.toString()
  }
  if (value && key === 'wf_maker') next.delete('wm')
  if (value && key === 'wm') next.delete('wf_maker')
  if (value) next.set(key, value)
  else next.delete(key)
  if (
    [
      'q',
      'wq',
      'wy',
      'wm',
      'ws',
      'wa',
      'wt_mode',
      ...workRanges.map(range => range.key),
      ...facetKeys.map(kind => `wf_${kind}`)
    ].includes(key)
  )
    next.delete('wp')
  return next.toString()
}

export function compareWorks(a: WorkEntry, b: WorkEntry, sort: string) {
  if (sort === 'score') {
    const left = a.rating?.score,
      right = b.rating?.score
    if (left == null && right != null) return 1
    if (left != null && right == null) return -1
    if (left != null && right != null && left !== right) return right - left
  }
  return (b.releaseDate || '').localeCompare(a.releaseDate || '') || a.id.localeCompare(b.id)
}
