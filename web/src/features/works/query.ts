/** 列表排序独立成纯函数：未知评分排最后，同分按日期及原生ID稳定排序。 */
import type { WorkEntry } from '../../entities/work'
export const facetKeys = ['prefix', 'director', 'maker', 'series', 'tag'] as const
/** 选项从当前浏览范围生成，以ID去重；同名不同ID仍是独立选项。 */
export function workFacetOptions(entries: WorkEntry[], kind: string) {
  const values = new Map<string, string>()
  for (const row of entries) {
    if (kind === 'prefix') {
      const prefix = row.code?.toUpperCase().match(/^([A-Z]+)(?=[-\d])/)?.[1]
      if (prefix) values.set(prefix, prefix)
    } else for (const value of row.facets?.[kind] || []) values.set(value.id, value.name)
  }
  return [...values]
    .map(([id, name]) => ({ id, name }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
}
export function matchesWorkFacets(row: WorkEntry, params: URLSearchParams) {
  return facetKeys.every(kind => {
    const selected = params.get(`wf_${kind}`)
    if (!selected) return true
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
    ...facetKeys.map(kind => `wf_${kind}`),
    ...(keepQuery ? [] : [queryKey])
  ])
    next.delete(key)
  return next.toString()
}
/** 密度只改变排版，不改变结果集合；保留页码，避免切换外观时跳回第一页。 */
export function workQuery(search: string, key: string, value: string) {
  const next = new URLSearchParams(search)
  if (value) next.set(key, value)
  else next.delete(key)
  if (['q', 'wq', 'wy', 'wm', 'ws', 'wa', ...facetKeys.map(kind => `wf_${kind}`)].includes(key))
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
