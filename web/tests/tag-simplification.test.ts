import { expect, it } from 'vitest'
import dictionary from '../src/data/javdb-tag-labels.json'
import { normalizeTagDictionary, simplifyTagLabel } from '../scripts/tag-label-normalization.mjs'

it('全部类别和分组都符合简体整理规则，重复执行没有变化', () => {
  expect(Object.keys(dictionary.terms)).toHaveLength(844)
  expect(Object.keys(dictionary.groupLabels)).toHaveLength(25)
  expect(normalizeTagDictionary(dictionary)).toEqual(dictionary)
  for (const term of Object.values(dictionary.terms)) {
    expect(term.label).toBe(simplifyTagLabel(term.officialLabel))
  }
})

it('整理只修改显示名称，保留身份、来源观察名称和官方原名', () => {
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
    officialLabel: '人妻',
    sourceNames: ['人妻']
  })
  expect(result.localizations).toEqual(source.localizations)
  expect(result.officialGroupLabels).toEqual(source.groupLabels)
})

it('繁体字、日文常用称谓和分隔符统一，缩写保持原样', () => {
  expect(simplifyTagLabel('女服務員')).toBe('女服务员')
  expect(simplifyTagLabel('女子高生製服')).toBe('女高中生制服')
  expect(simplifyTagLabel('母親・兒時的朋友')).toBe('母亲、儿时的朋友')
  expect(simplifyTagLabel('VR / 4K / SM / OL')).toBe('VR / 4K / SM / OL')
})
