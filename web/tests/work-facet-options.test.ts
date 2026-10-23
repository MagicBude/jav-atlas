import { expect, it } from 'vitest'
import { workFacetOptions, workQuery } from '../src/features/works/query'
it('筛选选项按ID去重且保留同名来源，改变条件重置页码', () => {
  const base = { kind: 'work' as const, title: '', sourceUrl: '', code: 'SONE-001' }
  const options = workFacetOptions(
    [
      { ...base, id: '1', facets: { director: [{ id: 'A', name: '同名' }] } },
      {
        ...base,
        id: '2',
        facets: {
          director: [
            { id: 'B', name: '同名' },
            { id: 'A', name: '同名' }
          ]
        }
      }
    ],
    'director'
  )
  expect(options.map(x => x.id)).toEqual(['A', 'B'])
  expect(new URLSearchParams(workQuery('?wp=4&wd=compact', 'wf_director', 'A')).has('wp')).toBe(
    false
  )
  expect(new URLSearchParams(workQuery('?wp=4&wd=compact', 'wf_director', 'A')).get('wd')).toBe(
    'compact'
  )
})
