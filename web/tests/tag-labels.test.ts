import { expect, it } from 'vitest'
import dictionary from '../src/data/javdb-tag-labels.json'
import { javdbTagLabel } from '../src/entities/tagLabels'
import { workFacetOptions, matchesWorkFacets } from '../src/features/works/query'
it('类别词典覆盖目录，显示替换不改变ID匹配且新类别回退原文', () => {
  expect(Object.keys(dictionary.terms)).toHaveLength(327)
  for (const [id, term] of Object.entries(dictionary.terms)) {
    expect(javdbTagLabel(id, 'fallback')).toBe(term.label)
    expect(term.sourceNames.length).toBeGreaterThan(0)
  }
  expect(javdbTagLabel('future-tag', '原名称')).toBe('原名称')
  const id = Object.keys(dictionary.terms)[0]
  const row = {
    id: '1',
    kind: 'work' as const,
    title: '',
    sourceUrl: '',
    facets: { tag: [{ id, name: '原名称' }] }
  }
  expect(workFacetOptions([row], 'tag')[0].name).toBe(javdbTagLabel(id, '原名称'))
  expect(matchesWorkFacets(row, new URLSearchParams('wf_tag=' + id))).toBe(true)
})
