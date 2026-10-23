/**
 * @file JavDB类别显示词典。只改变显示名称，来源ID、筛选及原记录始终不变。
 * 接口目录本身已有中文名，未人工确认的条目沿用来源中文，不声称全部已翻译。
 * 按ID查词而非用名称跨站合并；新增来源ID不在词典时安全回退原名称。
 */
import dictionary from '../data/javdb-tag-labels.json'
const terms: Record<string, { label: string; sourceNames: string[]; status: string }> =
  dictionary.terms
export function javdbTagLabel(id: string, original: string) {
  return terms[String(id)]?.label || original
}
