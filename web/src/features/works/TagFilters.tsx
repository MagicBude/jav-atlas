/** 类别计数按来源 ID＋原名隔离；目录证据不足的条目不强行归组。 */
import { useState } from 'react'
import {
  javdbTagLabel,
  javdbTagGroup,
  tagSelectionKey,
  parseTagSelection
} from '../../entities/tagLabels'
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
  const options = new Map<string, { id: string; name: string; count: number }>()
  for (const entry of entries.filter(row => row.kind === 'work')) {
    const seen = new Set<string>()
    for (const tag of entry.facets?.tag || []) {
      const key = tagSelectionKey(tag.id, tag.name)
      if (seen.has(key)) continue
      seen.add(key)
      const old = options.get(key)
      options.set(key, { ...tag, count: (old?.count || 0) + 1 })
    }
  }
  // 保留旧数字 URL，并明确显示它不区分同号名称；切换为新选项后即使用精确查询键。
  for (const key of selected)
    if (!options.has(key)) {
      const value = parseTagSelection(key)
      options.set(key, {
        id: value.id,
        name: value.name || `ID ${value.id}（旧链接，未区分原名）`,
        count: value.name
          ? 0
          : entries.filter(
              row => row.kind === 'work' && row.facets?.tag?.some(tag => tag.id === value.id)
            ).length
      })
    }
  const grouped = new Map<string, { name: string; keys: string[] }>()
  for (const [key, option] of options) {
    const group = javdbTagGroup(option.id, option.name) || { id: 'unconfirmed', name: '未确认分组' }
    const bucket = grouped.get(group.id) || { name: group.name, keys: [] }
    bucket.keys.push(key)
    grouped.set(group.id, bucket)
  }
  const matchesSearch = (key: string) => {
    const tag = options.get(key)!
    return (
      !search ||
      normalize(`${javdbTagLabel(tag.id, tag.name)} ${tag.name} ${tag.id}`).includes(
        normalize(search)
      )
    )
  }
  const toggle = (key: string) =>
    update(
      'wf_tag',
      (selected.includes(key) ? selected.filter(value => value !== key) : [...selected, key]).join(
        ','
      )
    )
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
        类别后为当前浏览范围内的作品数；目录归属不明确的类别列入“未确认分组”。
      </p>
      {[...grouped].map(([id, group]) => {
        const keys = group.keys.filter(matchesSearch)
        if (!keys.length) return null
        return (
          <details
            key={id}
            open={!!search || keys.some(key => selected.includes(key)) || undefined}
          >
            <summary>
              {group.name} <span className="muted">{keys.length}</span>
            </summary>
            <div className="tag-filter-options">
              {keys.map(key => {
                const tag = options.get(key)!
                return (
                  <label key={key} title={`来源原名：${tag.name}；ID：${tag.id}`}>
                    <input
                      type="checkbox"
                      checked={selected.includes(key)}
                      onChange={() => toggle(key)}
                    />
                    <span>{javdbTagLabel(tag.id, tag.name)}</span>
                    <small>{tag.count}</small>
                  </label>
                )
              })}
            </div>
          </details>
        )
      })}
      {search && ![...options.keys()].some(matchesSearch) && (
        <p className="muted">当前范围没有匹配类别。</p>
      )}
    </section>
  )
}
