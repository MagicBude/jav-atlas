import { expect, it } from 'vitest'
import {
  matchesWorkFacets,
  selectedTags,
  workQuery,
  clearWorkFilters
} from '../src/features/works/query'
it('类别多选统一交集，旧匹配模式不改变结果，单选链接兼容', () => {
  const row = {
    id: '1',
    kind: 'work' as const,
    title: '',
    sourceUrl: '',
    facets: { tag: [{ id: 'A', name: '甲' }] }
  }
  expect(matchesWorkFacets(row, new URLSearchParams('wf_tag=A'))).toBe(true)
  expect(matchesWorkFacets(row, new URLSearchParams('wf_tag=A,B'))).toBe(false)
  expect(matchesWorkFacets(row, new URLSearchParams('wf_tag=A,B&wt_mode=any'))).toBe(false)
  expect(selectedTags(new URLSearchParams('wf_tag=A,A,B'))).toEqual(['A', 'B'])
  expect(
    new URLSearchParams(workQuery('?wp=3&wd=compact&wt_mode=any', 'wf_tag', 'A')).has('wp')
  ).toBe(false)
  const cleared = new URLSearchParams(clearWorkFilters('wf_tag=A,B&wt_mode=any&wd=compact'))
  expect(cleared.has('wt_mode')).toBe(false)
  expect(cleared.get('wd')).toBe('compact')
})

it('编辑查询清理弃用匹配模式，保留类别组合与其他筛选', () => {
  const next = new URLSearchParams(
    workQuery('wf_tag=A,B&wt_mode=any&wy=2026&wd=compact', 'wf_director', 'D')
  )
  expect(next.has('wt_mode')).toBe(false)
  expect(next.get('wf_tag')).toBe('A,B')
  expect(next.get('wy')).toBe('2026')
})
