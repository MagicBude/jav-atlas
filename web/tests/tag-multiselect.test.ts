import { expect, it } from 'vitest'
import {
  matchesWorkFacets,
  selectedTags,
  workQuery,
  clearWorkFilters
} from '../src/features/works/query'
it('类别多选默认交集，可选并集，旧单选链接兼容', () => {
  const row = {
    id: '1',
    kind: 'work' as const,
    title: '',
    sourceUrl: '',
    facets: { tag: [{ id: 'A', name: '甲' }] }
  }
  expect(matchesWorkFacets(row, new URLSearchParams('wf_tag=A'))).toBe(true)
  expect(matchesWorkFacets(row, new URLSearchParams('wf_tag=A,B'))).toBe(false)
  expect(matchesWorkFacets(row, new URLSearchParams('wf_tag=A,B&wt_mode=any'))).toBe(true)
  expect(selectedTags(new URLSearchParams('wf_tag=A,A,B'))).toEqual(['A', 'B'])
  expect(new URLSearchParams(workQuery('?wp=3&wd=compact', 'wt_mode', 'any')).has('wp')).toBe(false)
  const cleared = new URLSearchParams(clearWorkFilters('wf_tag=A,B&wt_mode=any&wd=compact'))
  expect(cleared.has('wt_mode')).toBe(false)
  expect(cleared.get('wd')).toBe('compact')
})
