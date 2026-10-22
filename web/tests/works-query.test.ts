import { expect, it } from 'vitest'
import { compareWorks } from '../src/features/works/query'
import type { WorkEntry } from '../src/entities/work'
it('作品评分排序把未知放后，保留0分，同分按日期与原生ID稳定排列', () => {
  const row = (id: string, date: string, score?: number): WorkEntry => ({
    id,
    kind: 'work',
    title: id,
    sourceUrl: '',
    releaseDate: date,
    ...(score != null ? { rating: { score, count: 1, source: 'javdb' } } : {})
  })
  const rows = [
    row('missing', '2026-01-01'),
    row('zero', '2024-01-01', 0),
    row('b', '2025-01-01', 4),
    row('a', '2025-01-01', 4)
  ]
  expect([...rows].sort((a, b) => compareWorks(a, b, 'score')).map(x => x.id)).toEqual([
    'a',
    'b',
    'zero',
    'missing'
  ])
  expect([...rows].sort((a, b) => compareWorks(a, b, 'date'))[0].id).toBe('missing')
})
