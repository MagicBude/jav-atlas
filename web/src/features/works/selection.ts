/**
 * 所有作品筛选共享一个判定入口，列表和分面计数不得各写一套近似逻辑。
 * params只读：计数需要忽略某个维度时，先复制URL参数再删除该维度。
 */
import type { WorkEntry } from '../../entities/work'
import { normalize } from '../../entities/person'
import { matchesWorkFacets } from './query'
import { workYear } from './filterOptions'
import { matchesWorkRanges, matchesWorkSearch } from './ranges'
export function filterWorks(
  entries: WorkEntry[],
  params: URLSearchParams,
  queryKey = 'wq',
  useActor = true
) {
  const q = normalize(params.get(queryKey) || '')
  const year = params.get('wy') || ''
  const maker = params.get('wm') || ''
  const actor = useActor ? params.get('wa') || '' : ''
  return entries.filter(
    row =>
      row.kind === 'work' &&
      matchesWorkFacets(row, params) &&
      matchesWorkRanges(row, params) &&
      matchesWorkSearch(row, q) &&
      (!year || workYear(row) === year) &&
      (!maker || row.makerText === maker) &&
      (!actor || row.actorIds?.includes(actor))
  )
}
