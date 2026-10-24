import { expect, it } from 'vitest'
import dictionary from '../src/data/javdb-tag-labels.json'
import { normalizeTagDictionary, simplifyTagLabel } from '../scripts/tag-label-normalization.mjs'

it('全部类别和分组都符合简体整理规则，重复执行没有变化', () => {
  expect(Object.keys(dictionary.terms)).toHaveLength(844)
  expect(Object.keys(dictionary.groupLabels)).toHaveLength(25)
  expect(normalizeTagDictionary(dictionary)).toEqual(dictionary)
  for (const term of Object.values(dictionary.terms)) {
    expect(term.label).toBe(simplifyTagLabel(term.label))
  }
})

it('整理只修改显示名称，保留身份、来源观察名称和繁体名称', () => {
  const source = {
    terms: { '4:61': { label: '人妻', sourceNames: ['人妻'], status: 'official-zh-CN' } },
    groupLabels: { '4:role': '角色' },
    localizations: [{ type: 4, locale: 'zh-CN' }]
  }
  const before = structuredClone(source)
  const result = normalizeTagDictionary(source)
  expect(source).toEqual(before)
  expect(Object.keys(result.terms)).toEqual(['4:61'])
  expect(result.terms['4:61']).toMatchObject({
    label: '已婚妇女',
    labelTraditional: '人妻',
    labelEnglish: null,
    sourceNames: ['人妻']
  })
  expect(result.localizations).toEqual(source.localizations)
  expect(result.traditionalGroupLabels).toEqual(source.groupLabels)
})

it('繁体字、日文常用称谓和分隔符统一，缩写保持原样', () => {
  expect(simplifyTagLabel('女服務員')).toBe('女服务员')
  expect(simplifyTagLabel('女子高生製服')).toBe('女高中生制服')
  expect(simplifyTagLabel('母親・兒時的朋友')).toBe('母亲、儿时的朋友')
  expect(simplifyTagLabel('VR / 4K / SM / OL')).toBe('VR / 4K / SM / OL')
})

it('全部词条保留已核对的繁体与英文，不保留官方原名字段', () => {
  for (const term of Object.values(dictionary.terms)) {
    expect(term.labelTraditional).toBe(term.sourceNames[0])
    expect(term.labelEnglish.trim().length).toBeGreaterThan(0)
    expect(term).not.toHaveProperty('officialLabel')
  }
})

it('25个分组英文与繁体名称完整，语言来源覆盖五类目录', () => {
  expect(Object.values(dictionary.englishGroupLabels)).toHaveLength(25)
  for (const name of Object.values(dictionary.englishGroupLabels))
    expect(name.trim().length).toBeGreaterThan(0)
  expect(dictionary.traditionalGroupLabels['0:subject']).toBe('主題')
  expect(dictionary.languageSources.locales.en.terms).toBe(844)
})
