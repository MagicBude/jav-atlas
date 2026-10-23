/** 类别目录只定义分组，数量来自当前浏览范围；同一类别跨组共享选中状态。 */
import { useState } from 'react'
import groups from '../../data/javdb-tag-groups.json'
import dictionary from '../../data/javdb-tag-labels.json'
import { javdbTagLabel } from '../../entities/tagLabels'
import { normalize } from '../../entities/person'
import type { WorkEntry } from '../../entities/work'
import { selectedTags } from './query'
export function TagFilters({
  entries,
  params,
  update
}: {
  entries: WorkEntry[]
  params: URLSearchParams
  update: (key: string, value: string) => void
}) {
  const [search, setSearch] = useState('')
  const selected = selectedTags(params)
  const counts = new Map<string, number>(),
    names = new Map<string, string>()
  for (const entry of entries.filter(row => row.kind === 'work')) {
    const ids = new Set<string>()
    for (const tag of entry.facets?.tag || []) {
      names.set(tag.id, tag.name)
      ids.add(tag.id)
    }
    for (const id of ids) counts.set(id, (counts.get(id) || 0) + 1)
  }
  const terms: Record<string, { sourceNames: string[] }> = dictionary.terms
  const toggle = (id: string) =>
    update(
      'wf_tag',
      (selected.includes(id) ? selected.filter(value => value !== id) : [...selected, id]).join(',')
    )
  const known = new Set(groups.flatMap(group => group.tags))
  const allGroups = [
    ...groups,
    {
      id: 'unlisted',
      name: '目录外类别',
      tags: [...new Set([...names.keys(), ...selected])].filter(id => !known.has(id))
    }
  ]
  return (
    <section className="tag-filter-browser" aria-label="分组类别筛选">
      <div className="tag-filter-toolbar">
        <input
          aria-label="查找类别"
          placeholder="搜索中文名或来源原名"
          value={search}
          onChange={e => setSearch(e.target.value)}
        />
        <select
          aria-label="类别匹配方式"
          value={params.get('wt_mode') === 'any' ? 'any' : 'all'}
          onChange={e => update('wt_mode', e.target.value)}
        >
          <option value="all">全部满足</option>
          <option value="any">满足任一</option>
        </select>
      </div>
      <p className="small muted">
        类别后为当前浏览范围内的作品数；无本地作品的类别默认不列出，已选条件始终保留。
      </p>
      {allGroups.map(group => {
        const tags = group.tags.filter(
          id =>
            (counts.has(id) || selected.includes(id)) &&
            (!search ||
              normalize(
                [
                  javdbTagLabel(id, names.get(id) || id),
                  ...(terms[id]?.sourceNames || []),
                  id
                ].join(' ')
              ).includes(normalize(search)))
        )
        if (!tags.length) return null
        return (
          <details
            key={group.id}
            open={!!search || tags.some(id => selected.includes(id)) || undefined}
          >
            <summary>
              {group.name} <span className="muted">{tags.length}</span>
            </summary>
            <div className="tag-filter-options">
              {tags.map(id => (
                <label
                  key={id}
                  title={`来源原名：${(terms[id]?.sourceNames || [names.get(id) || id]).join(' / ')}`}
                >
                  <input
                    type="checkbox"
                    checked={selected.includes(id)}
                    onChange={() => toggle(id)}
                  />
                  <span>{javdbTagLabel(id, names.get(id) || id)}</span>
                  <small>{counts.get(id) || 0}</small>
                </label>
              ))}
            </div>
          </details>
        )
      })}
      {search &&
        ![...new Set([...names.keys(), ...selected])].some(id =>
          normalize(
            [javdbTagLabel(id, names.get(id) || id), ...(terms[id]?.sourceNames || []), id].join(
              ' '
            )
          ).includes(normalize(search))
        ) && <p className="muted">当前范围没有匹配类别。</p>}
    </section>
  )
}
