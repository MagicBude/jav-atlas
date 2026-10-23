/**
 * JavDB 的类别 ID 只在内容类型内唯一，不能拿数字 ID 当全站词典键。
 * 已知类型按 type:id 查词与归组，不让简繁名称差异改变身份。
 * 老资料缺类型时按 ID＋原名保守核对；没有可靠匹配则保留原文。
 */
import dictionary from '../data/javdb-tag-labels.json'
import groups from '../data/javdb-tag-groups.json'
import { javdbContentTypes } from './javdbCatalog'
const terms: Record<string, { label: string; sourceNames: string[]; status: string }> =
  dictionary.terms
/** 分组显示名只采用已核实的官方简体源码；没有证据的类型保留接口原名。 */
export function javdbGroupLabel(id: string, original: string) {
  return (dictionary.groupLabels as Record<string, string>)[id] || original
}
export const validJavdbType = (type: unknown): type is number =>
  Number.isInteger(type) && Number(type) >= 0 && Number(type) <= 4
export function javdbTagLabel(id: string, original: string, type?: number) {
  if (validJavdbType(type)) return terms[type + ':' + id]?.label || original
  const candidates = Object.entries(terms).filter(
    ([key, term]) => key.endsWith(':' + id) && term.sourceNames.includes(original)
  )
  const labels = [...new Set(candidates.map(([, term]) => term.label))]
  return labels.length === 1 ? labels[0] : original
}
/** 优先使用 type:id；缺类型时兼容 ID＋编码原名，避免同号串选及名称逗号破坏多选。 */
export const tagSelectionKey = (id: string, name: string, type?: number) =>
  validJavdbType(type) ? type + ':' + id : id + '~' + encodeURIComponent(name)
export function parseTagSelection(key: string) {
  const scoped = key.match(/^([0-4]):([^:~]+)$/)
  if (scoped) return { id: scoped[2], name: undefined, type: Number(scoped[1]) }
  const split = key.indexOf('~')
  if (split < 0) return { id: key, name: undefined }
  try {
    return { id: key.slice(0, split), name: decodeURIComponent(key.slice(split + 1)) }
  } catch {
    return { id: key, name: undefined }
  }
}
/** 有类型就按来源类型与 ID 找分组；无类型时要求原名匹配且候选归属一致。 */
export function javdbTagGroup(id: string, original: string, type?: number) {
  const matches = groups.filter(
    group =>
      group.tags.includes(id) &&
      (validJavdbType(type)
        ? group.type === type
        : (group.sourceNames as Record<string, string | undefined>)[id] === original)
  )
  const categories = new Set(matches.map(group => group.id.split(':')[1]))
  if (categories.size !== 1) return undefined
  return validJavdbType(type)
    ? {
        id: matches[0].id,
        name: javdbContentTypes[type].name + ' · ' + javdbGroupLabel(matches[0].id, matches[0].name)
      }
    : { id: matches[0].id.split(':')[1], name: javdbGroupLabel(matches[0].id, matches[0].name) }
}
