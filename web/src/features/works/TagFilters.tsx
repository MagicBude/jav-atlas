/** 类别按类型＋ID隔离；旧资料缺类型时使用原名保守回退。 */
import { useState } from 'react'
import {
  javdbTagLabel,
  displayJavdbTags,
  javdbTagGroup,
  tagSelectionKey,
  parseTagSelection,
  validJavdbType
} from '../../entities/tagLabels'
import { normalize } from '../../entities/person'
import type { WorkEntry } from '../../entities/work'
import { selectedTags } from './query'
import { CategoryRow } from '../../shared/CategoryRow'
import sourceGroups from '../../data/javdb-tag-groups.json'
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
  const options = new Map<string, { id: string; name: string; count: number; type?: number }>()
  for (const entry of entries.filter(row => row.kind === 'work')) {
    const seen = new Set<string>()
    for (const tag of displayJavdbTags(entry.facets?.tag || [], entry.javdbType)) {
      const key = tagSelectionKey(tag.id, tag.name, entry.javdbType)
      if (seen.has(key)) continue
      seen.add(key)
      const old = options.get(key)
      options.set(key, { ...tag, type: entry.javdbType, count: (old?.count || 0) + 1 })
    }
  }
  // 保留旧数字 URL，并明确显示它不区分同号名称；切换为新选项后即使用精确查询键。
  for (const key of selected)
    if (!options.has(key)) {
      const value = parseTagSelection(key)
      // 直达来源旧ID时，从当前记录中核对原名，不能用一个未知数字猜测类别。
      const originals = [
        ...new Set(
          entries
            .filter(row => value.type === undefined || row.javdbType === value.type)
            .flatMap(row => row.facets?.tag || [])
            .filter(tag => tag.id === value.id)
            .map(tag => tag.name)
        )
      ]
      const original = value.name || (originals.length === 1 ? originals[0] : undefined)
      options.set(key, {
        id: value.id,
        type: value.type,
        name:
          original ||
          javdbTagLabel(
            value.id,
            value.type === undefined ? `ID ${value.id}（旧链接，未区分原名）` : `ID ${value.id}`,
            value.type
          ),
        count: entries.filter(
          row =>
            row.kind === 'work' &&
            row.facets?.tag?.some(
              tag =>
                tag.id === value.id &&
                (value.name === undefined || tag.name === value.name) &&
                (value.type === undefined || row.javdbType === value.type)
            )
        ).length
      })
    }
  const grouped = new Map<string, { name: string; keys: string[] }>()
  for (const [key, option] of options) {
    const group =
      javdbTagGroup(option.id, option.name, option.type) ||
      (validJavdbType(option.type)
        ? { id: 'unlisted', name: '来源目录未收录' }
        : { id: 'unconfirmed', name: '未确认分组' })
    const bucket = grouped.get(group.id) || { name: group.name, keys: [] }
    bucket.keys.push(key)
    grouped.set(group.id, bucket)
  }
  const matchesSearch = (key: string) => {
    const tag = options.get(key)!
    return (
      !search ||
      normalize(`${javdbTagLabel(tag.id, tag.name, tag.type)} ${tag.name} ${tag.id}`).includes(
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
      <div className="category-row work-field-row">
        <h2 className="category-row-label">
          类别<small>多选</small>
        </h2>
        <input
          className="work-field-control"
          type="search"
          aria-label="查找类别"
          placeholder="查找类别名称"
          value={search}
          onChange={event => setSearch(event.target.value)}
        />
      </div>
      {[...grouped]
        .sort(([left], [right]) => {
          const order = (id: string) => {
            const index = sourceGroups.findIndex(
              group => group.id === id || group.id.split(':')[1] === id
            )
            return index < 0 ? sourceGroups.length : index
          }
          return order(left) - order(right)
        })
        .map(([id, group]) => {
          const keys = group.keys.filter(matchesSearch)
          if (!keys.length) return null
          const types = new Set(
            [...options.values()].map(option => option.type).filter(type => type !== undefined)
          )
          const label = types.size === 1 ? group.name.replace(/^.+ · /, '') : group.name
          return (
            <CategoryRow
              key={id}
              label={label}
              forceExpanded={!!search}
              onToggle={toggle}
              onClear={() =>
                update('wf_tag', selected.filter(key => !group.keys.includes(key)).join(','))
              }
              options={keys.map(key => {
                const tag = options.get(key)!
                return {
                  key,
                  label: javdbTagLabel(tag.id, tag.name, tag.type),
                  title: 'ID：' + tag.id,
                  count: tag.count,
                  selected: selected.includes(key)
                }
              })}
            />
          )
        })}
      {search && ![...options.keys()].some(matchesSearch) && (
        <p className="muted">当前范围没有匹配类别。</p>
      )}
    </section>
  )
}
