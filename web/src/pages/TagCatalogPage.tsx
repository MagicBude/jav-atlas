/**
 * 类别目录是独立的来源参考页，展示全部目录项，不受本地已收录作品范围限制。
 * 查询参数保存类型和搜索词，刷新、复制链接与浏览器后退均可恢复当前查阅状态。
 * 统一展示类别名称，优先采用已核实的官方简体，来源快照仍独立保留。
 */
import { useSearchParams } from 'react-router-dom'
import groups from '../data/javdb-tag-groups.json'
import dictionary from '../data/javdb-tag-labels.json'
import { javdbGroupLabel, javdbTagLabel } from '../entities/tagLabels'
import { javdbContentTypes } from '../entities/javdbCatalog'
import { normalize } from '../entities/person'
import './tag-catalog.css'
import { CategoryRow } from '../shared/CategoryRow'
import { tagSelectionKey } from '../entities/tagLabels'
export default function TagCatalogPage() {
  const [params, setParams] = useSearchParams()
  const rawType = params.get('type') || '0'
  const type = /^[0-4]$/.test(rawType) ? Number(rawType) : 0
  const search = params.get('q') || ''
  const scoped = groups.filter(group => group.type === type)
  const visible = scoped
    .map(group => ({
      ...group,
      tags: group.tags.filter(
        id =>
          !search ||
          normalize(
            `${javdbGroupLabel(group.id, group.name)} ${javdbTagLabel(id, (group.sourceNames as Record<string, string | undefined>)[id] || id, type)} ${group.name} ${id} ${(group.sourceNames as Record<string, string | undefined>)[id]}`
          ).includes(normalize(search))
      )
    }))
    .filter(group => group.tags.length)
  const count = (rows: typeof scoped) => rows.reduce((sum, group) => sum + group.tags.length, 0)
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: key === 'q' })
  }
  const download = () => {
    const body = JSON.stringify(
      {
        source: 'javdb',
        snapshotDate: '2026-10-23',
        complete: false,
        scope: 'types-0-4-category-groups',
        types: javdbContentTypes,
        localizations: dictionary.localizations,
        displayLabels: dictionary.terms,
        groupLabels: dictionary.groupLabels,
        groups
      },
      null,
      2
    )
    const url = URL.createObjectURL(new Blob([body], { type: 'application/json;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'javdb-tag-catalog-2026-10-23.json'
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  return (
    <main className="tag-catalog-page">
      <header className="tag-catalog-heading">
        <div>
          <p className="eyebrow">JavDB · 来源目录</p>
          <h1>类别目录</h1>
          <p className="muted">
            5 种内容类型 · {groups.length} 个分组 · {count(groups)} 个类别条目
          </p>
        </div>
        <button onClick={download}>下载完整 JSON</button>
      </header>
      <details className="catalog-notes">
        <summary>目录说明</summary>
        <p>
          按 JavDB
          接口原有顺序、分组和名称展示，包含尚未收录作品的类别。快照日期：2026-10-23；仅展示类别分组，不含年份、月份、时长等通用筛选，不保证覆盖历史或隐藏标签。五类目录共
          844 项均已核对官方简体页面名称；少数名称在官网简体页面中仍使用繁体字，按来源保留。
        </p>
      </details>
      <nav className="catalog-types" aria-label="目录内容类型">
        {javdbContentTypes.map(item => (
          <button
            key={item.id}
            aria-pressed={type === item.id}
            onClick={() => update('type', String(item.id))}
          >
            {item.name}
            <small>{count(groups.filter(group => group.type === item.id))}</small>
          </button>
        ))}
      </nav>
      <div className="catalog-toolbar">
        <input
          type="search"
          aria-label="搜索来源类别目录"
          placeholder="搜索类别名、分组名或 ID"
          value={search}
          onChange={event => update('q', event.target.value)}
        />
        {search && <button onClick={() => update('q', '')}>清除搜索</button>}
        <span className="muted" role="status">
          显示 {visible.length} / {scoped.length} 组，{count(visible)} / {count(scoped)} 项
        </span>
      </div>
      <p className="small muted">
        数字 ID
        只在当前内容类型内有效；跨类型同号不代表同一类别。这里的数量是目录条目数，与本地作品数量无关。
      </p>
      <p className="small muted">
        每组先显示 12 项，可在右侧展开更多；点击类别可查看本地作品，尚未收录的类别可能没有结果。
      </p>
      <div className="catalog-rows">
        {visible.map(group => (
          <div id={'catalog-' + group.id} key={group.id}>
            <CategoryRow
              label={javdbGroupLabel(group.id, group.name)}
              forceExpanded={!!search}
              options={group.tags.map(id => {
                const original = (group.sourceNames as Record<string, string | undefined>)[id] || id
                return {
                  key: id,
                  label: javdbTagLabel(id, original, type),
                  title: 'ID：' + id,
                  to:
                    '/works?' +
                    new URLSearchParams({ wf_tag: tagSelectionKey(id, original, type) }).toString()
                }
              })}
            />
          </div>
        ))}
      </div>
      {!visible.length && (
        <p className="empty-state">该内容类型下没有匹配的类别，请更换关键词或切换类型。</p>
      )}
    </main>
  )
}
