/**
 * JavDB 的类别 ID 只在内容类型内唯一，不能拿数字 ID 当全站词典键。
 * 来源作品暂未保存类别的内容类型，因此显示名必须同时核对来源 ID 和原名；
 * 找不到唯一显示名时保留原文。这里不推测作品类型，也不改写采集记录。
 */
import dictionary from '../data/javdb-tag-labels.json'
import groups from '../data/javdb-tag-groups.json'
const terms: Record<string, { label: string; sourceNames: string[]; status: string }> =
  dictionary.terms
export function javdbTagLabel(id: string, original: string) {
  const candidates = Object.entries(terms).filter(
    ([key, term]) => key.endsWith(':' + id) && term.sourceNames.includes(original)
  )
  const labels = [...new Set(candidates.map(([, term]) => term.label))]
  return labels.length === 1 ? labels[0] : original
}
/** 查询键包含原名，防止同一数字 ID 的不同类别互相选中。编码避免名称里的逗号破坏多选。 */
export const tagSelectionKey = (id: string, name: string) => id + '~' + encodeURIComponent(name)
export function parseTagSelection(key: string) {
  const split = key.indexOf('~')
  if (split < 0) return { id: key, name: undefined }
  try {
    return { id: key.slice(0, split), name: decodeURIComponent(key.slice(split + 1)) }
  } catch {
    return { id: key, name: undefined }
  }
}
/** 仅当 ID、原名均匹配且各类型一致指向同一分组时确认归属，否则留待核实。 */
export function javdbTagGroup(id: string, original: string) {
  const matches = groups.filter(
    group =>
      group.tags.includes(id) &&
      (group.sourceNames as Record<string, string | undefined>)[id] === original
  )
  const categories = new Set(matches.map(group => group.id.split(':')[1]))
  if (categories.size !== 1) return undefined
  return { id: matches[0].id.split(':')[1], name: matches[0].name }
}
