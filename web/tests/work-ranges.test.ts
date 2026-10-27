import { expect, it } from 'vitest'
import { matchesWorkRanges, matchesWorkSearch, rangeValue } from '../src/features/works/ranges'
import { clearWorkFilters, workQuery } from '../src/features/works/query'
import type { WorkEntry } from '../src/entities/work'
const row: WorkEntry = {
  id: '1',
  kind: 'work',
  title: '作品标题',
  code: 'SNOS-461',
  sourceUrl: '',
  durationMinutes: 120,
  rating: { score: 4.5, count: 80, source: 'javdb' }
}
it('番号容错支持全角、空格和连字符，不把纯分隔符当成匹配全部', () => {
  for (const query of ['snos461', 'ＳＮＯＳ－４６１', 'SNOS 461', '作品标题'])
    expect(matchesWorkSearch(row, query)).toBe(true)
  expect(matchesWorkSearch(row, '---')).toBe(false)
  expect(matchesWorkSearch(row, 'SNOS462')).toBe(false)
})
it('范围含边界、排除未知，非法参数不作为隐藏条件', () => {
  const params = new URLSearchParams('wr_score=4.5&wr_votes=80&wr_min=120&wr_max=120')
  expect(matchesWorkRanges(row, params)).toBe(true)
  expect(matchesWorkRanges({ ...row, rating: null }, params)).toBe(false)
  expect(matchesWorkRanges(row, new URLSearchParams('wr_votes=81'))).toBe(false)
  expect(matchesWorkRanges(row, new URLSearchParams('wr_min=121&wr_max=100'))).toBe(false)
  expect(rangeValue(new URLSearchParams('wr_score=6'), 'wr_score')).toBe(null)
  expect(rangeValue(new URLSearchParams('wr_votes=1.5'), 'wr_votes')).toBe(null)
})
it('调整范围重置页码，清空筛选保留排序与密度', () => {
  expect(new URLSearchParams(workQuery('?wp=4&ws=score', 'wr_min', '120')).has('wp')).toBe(false)
  const cleaned = new URLSearchParams(
    clearWorkFilters('?wr_min=120&wr_score=4&ws=score&wd=compact')
  )
  expect(cleaned.has('wr_min')).toBe(false)
  expect(cleaned.has('wr_score')).toBe(false)
  expect(cleaned.get('ws')).toBe('score')
  expect(cleaned.get('wd')).toBe('compact')
})
