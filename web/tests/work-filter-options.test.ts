/** 验证混合来源的片商身份、未知年份和历史URL，不以同名自动合并。 */
import { expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import {
  workYear,
  workYearOptions,
  makerOptions,
  makerFilter
} from '../src/features/works/filterOptions'
import { workQuery } from '../src/features/works/query'
import { WorkBrowser } from '../src/features/works/WorkBrowser'
import type { WorkEntry } from '../src/entities/work'
const entries: WorkEntry[] = [
  {
    id: '1',
    kind: 'work',
    title: '已知日期作品',
    sourceUrl: '',
    releaseDate: '2026-10-24',
    makerText: '同名片商',
    facets: { maker: [{ id: 'A', name: '同名片商' }] }
  },
  { id: '2', kind: 'work', title: '未知日期作品', sourceUrl: '', makerText: '同名片商' },
  { id: '3', kind: 'work', title: '老年份作品', sourceUrl: '', releaseDate: '2000-01-01' }
]
it('年份按降序保留未知与零结果已选项，占位不是作品', () => {
  const options = workYearOptions(
    [...entries, { id: 'u', kind: 'unknown', title: '占位', sourceUrl: '' }],
    '1990'
  )
  expect(options.map(option => option.key)).toEqual(['2026', '2000', '1990', 'unknown'])
  expect(options.find(option => option.key === 'unknown')?.count).toBe(1)
  expect(workYear({ ...entries[0], releaseDate: '未知' })).toBe('unknown')
  expect(workYearOptions([entries[0]], '').find(option => option.key === 'unknown')?.count).toBe(0)
})
it('片商统一入口仍区分来源，同名和特殊字符名称可往返', () => {
  const options = makerOptions(entries)
  expect(options.filter(option => option.name === '同名片商')).toHaveLength(2)
  expect(makerFilter(options.find(option => option.source === 'JavDB')!.id)).toEqual({
    key: 'wf_maker',
    value: 'A'
  })
  const text = '片商 & 系列:1,2'
  expect(makerFilter('minnano:' + encodeURIComponent(text))).toEqual({ key: 'wm', value: text })
})
it('换片商互斥旧来源；旧双条件逐项清除保留另一项，全部片商清除两项', () => {
  const original = 'wm=旧名称&wf_maker=旧ID&wp=7&wy=2026&wd=compact&wf_director=D'
  const next = new URLSearchParams(workQuery(original, 'wf_maker', '新ID'))
  expect(next.has('wm')).toBe(false)
  expect(next.has('wp')).toBe(false)
  expect(next.get('wy')).toBe('2026')
  expect(next.get('wd')).toBe('compact')
  expect(next.get('wf_director')).toBe('D')
  expect(new URLSearchParams(workQuery(original, 'wm', '')).get('wf_maker')).toBe('旧ID')
  expect(new URLSearchParams(workQuery(original, 'wf_maker', '')).get('wm')).toBe('旧名称')
  const all = makerFilter('')
  const cleared = new URLSearchParams(workQuery(original, all.key, all.value))
  expect(cleared.has('wm') || cleared.has('wf_maker') || cleared.has('wp')).toBe(false)
  expect(new URLSearchParams(workQuery(original, 'wm', '新名称')).has('wf_maker')).toBe(false)
})
it('旧厂商URL和未知年份仍筛选正确，界面只提供一个片商入口', () => {
  const render = (search: string) =>
    renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: ['/works?' + search] },
        createElement(WorkBrowser, { entries })
      )
    )
  const unknown = render('wy=unknown')
  expect(unknown).toContain('未知日期作品')
  expect(unknown).not.toContain('已知日期作品')
  expect(unknown).not.toContain('作品厂商')
  expect(unknown.match(/aria-label="作品片商"/g)).toHaveLength(1)
  const legacy = render('wm=' + encodeURIComponent('同名片商'))
  expect(legacy).toContain('已知日期作品')
  expect(legacy).toContain('未知日期作品')
  expect(legacy).not.toContain('老年份作品')
  expect(legacy).toContain('片商（minnano）')
})
