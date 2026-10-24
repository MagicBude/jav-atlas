/**
 * 类别显示名的本地整理规则。OpenCC只在开发脚本/测试中使用，不进入网页运行包。
 * 先转换字形，再处理明确核对的整词；不做按字替换的语义推断，避免误改其他词。
 */
import OpenCC from 'opencc-js'
const convert = OpenCC.Converter({ from: 'tw', to: 'cn' })
const terminology = new Map([
  ['人妻', '已婚妇女'],
  ['女子高生制服', '女高中生制服']
])
export function simplifyTagLabel(value) {
  if (typeof value !== 'string' || !value.trim()) throw Error('类别显示名称不能为空')
  const simplified = convert(value).replaceAll('・', '、').trim()
  return terminology.get(simplified) || simplified
}
/** 返回新文档，绝不改调用方对象；简体显示名、繁体名称和英文名称分开保存。 */
export function normalizeTagDictionary(document) {
  const next = structuredClone(document)
  for (const term of Object.values(next.terms)) {
    // 繁体采用来源名称；英文未知用null，不把机器猜测冒充已提取译名。
    term.labelTraditional ??= term.sourceNames?.[0] || term.officialLabel || term.label
    term.labelEnglish ??= null
    delete term.officialLabel
    term.label = simplifyTagLabel(term.label)
    term.status = 'simplified-zh-CN'
  }
  next.traditionalGroupLabels ??= structuredClone(next.officialGroupLabels || next.groupLabels)
  next.englishGroupLabels ??= Object.fromEntries(
    Object.keys(next.groupLabels).map(id => [id, null])
  )
  delete next.officialGroupLabels
  for (const [id, name] of Object.entries(next.groupLabels))
    next.groupLabels[id] = simplifyTagLabel(name)
  next.displayNormalization = {
    locale: 'zh-CN',
    engine: 'opencc-js',
    engineVersion: '1.4.2',
    configuration: 'tw2s',
    terminologyVersion: 1,
    punctuation: '中点统一为顿号',
    scope: 'display-labels-only'
  }
  return next
}
