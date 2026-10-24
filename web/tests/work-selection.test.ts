import { expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { WorkBrowser } from '../src/features/works/WorkBrowser'
import { filterWorks } from '../src/features/works/selection'
import { workYearOptions } from '../src/features/works/filterOptions'
import { workQuery } from '../src/features/works/query'
import type { WorkEntry } from '../src/entities/work'

const row = (id: string, year: string, ids: string[]): WorkEntry => ({
  id,
  kind: 'work',
  title: '示例',
  code: 'TEST-' + id,
  sourceUrl: '',
  releaseDate: year + '-01-01',
  javdbType: 0,
  actorIds: ['a'],
  facets: { tag: ids.map(id => ({ id, name: ['40', '46'].includes(id) ? '顏射' : '巨乳' })) }
})
const entries = [
  row('1', '2025', ['40', '46', '17']),
  row('2', '2026', ['46']),
  row('3', '2026', ['17'])
]
it('多选取交集，重复来源类别只匹配一部，且不修改URL参数或原数据', () => {
  const params = new URLSearchParams('wf_tag=0:46,0:17&wa=a')
  const before = JSON.stringify(entries)
  expect(filterWorks(entries, params).map(r => r.id)).toEqual(['1'])
  expect(params.toString()).toBe('wf_tag=0%3A46%2C0%3A17&wa=a')
  expect(JSON.stringify(entries)).toBe(before)
  expect(filterWorks(entries, new URLSearchParams('wf_tag=2:46'))).toHaveLength(0)
})
it('年份计数保留其他类别条件，已选无结果年份保留为零', () => {
  const p = new URLSearchParams('wf_tag=0:46&wy=2026')
  expect(filterWorks(entries, p)).toHaveLength(1)
  p.delete('wy')
  const years = workYearOptions(filterWorks(entries, p), '1999')
  expect(years.find(o => o.key === '2025')?.count).toBe(1)
  expect(years.find(o => o.key === '2026')?.count).toBe(1)
  expect(years.find(o => o.key === '1999')).toMatchObject({ count: 0, selected: true })
})
it('筛选标签和已选条件统一简体，类别数字与当前结果一致', () => {
  const html = renderToStaticMarkup(
    createElement(
      MemoryRouter,
      { initialEntries: ['/works?wf_tag=0:46&wy=2026'] },
      createElement(WorkBrowser, { entries })
    )
  )
  expect(html).toContain('类别：颜射')
  expect(html).not.toContain('顏射')
  expect(html).toContain('<span>颜射</span><small>1</small>')
  expect(html).toContain('<span>巨乳</span><small>0</small>')
  expect(html).toContain('1 部作品')
})
it('零结果仍保留已选类别和清除入口，刷新所需信息全部在URL中', () => {
  const url = '/works?wf_tag=0:46,0:17&wy=2026&wd=compact&ws=score'
  const render = () =>
    renderToStaticMarkup(
      createElement(
        MemoryRouter,
        { initialEntries: [url] },
        createElement(WorkBrowser, { entries })
      )
    )
  const html = render()
  expect(html).toContain('0 部作品')
  expect(html).toContain('类别：颜射')
  expect(html).toContain('类别：巨乳')
  expect(html).toContain('<span>颜射</span><small>0</small>')
  expect(render()).toBe(html)
  const next = new URLSearchParams(workQuery(url.split('?')[1], 'wf_tag', '0:46'))
  expect(next.get('wy')).toBe('2026')
  expect(next.get('ws')).toBe('score')
  expect(next.get('wd')).toBe('compact')
})
