/** @file 人物与收藏共用同一条浏览流水线：加载 → 个人覆盖 → 筛选排序 → 当前页。 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../app/context'
import { loadIndex } from '../data/repository'
import { resolvePerson } from '../data/personal'
import { identity, type Person, type Source } from '../entities/person'
import { useResource } from '../shared/useResource'
import { Filters } from '../features/people/Filters'
import {
  emptyPrivate,
  privateFilters,
  queryLabel,
  sanitizeQuery,
  selectPeople,
  type PrivateFilters
} from '../features/people/query'
import { PersonCard } from '../features/people/PersonCard'
import { personView, ViewSwitcher } from '../features/people/ViewSwitcher'
import {
  readPrivateFilters,
  restoreList,
  savePrivateFilters
} from '../features/people/returnPosition'
import { Modal } from '../shared/Modal'
export default function PeoplePage({ favoritesOnly = false }: { favoritesOnly?: boolean }) {
  const { manifest, data, notify } = useApp(),
    location = useLocation(),
    navigate = useNavigate()
  const params = useMemo(() => sanitizeQuery(location.search), [location.search])
  const selectedSource = params.get('source') || (favoritesOnly ? 'all' : 'minnano')
  const source = ['minnano', 'javdb'].includes(selectedSource)
    ? selectedSource
    : selectedSource === 'all'
      ? 'all'
      : 'minnano'
  const request = useResource(manifest ? `${manifest.version}:${source}` : '', () =>
    Promise.all(
      (source === 'all' ? ['minnano', 'javdb'] : [source]).map(s =>
        loadIndex(manifest!, s as Source)
      )
    ).then(rows => rows.flat())
  )
  const [personal, setPersonal] = useState<PrivateFilters>(() =>
    privateFilters(location.state?.privateFilters)
  )
  const [search, setSearch] = useState(params.get('q') || ''),
    composing = useRef(false)
  const [mobile, setMobile] = useState<{
    params: URLSearchParams
    personal: PrivateFilters
  } | null>(null)
  const resultRef = useRef<HTMLElement>(null),
    restored = useRef('')
  useEffect(() => {
    setSearch(params.get('q') || '')
    setPersonal(privateFilters(location.state?.privateFilters || readPrivateFilters(location.key)))
  }, [location.key])
  useEffect(() => {
    savePrivateFilters(location.key, personal)
  }, [personal, location.key])
  const update = (
    next: URLSearchParams,
    nextPersonal = personal,
    push = false,
    resetPage = true
  ) => {
    if (resetPage) next.delete('page')
    navigate(
      { pathname: location.pathname, search: next.toString() },
      { replace: !push, state: { privateFilters: nextPersonal } }
    )
  }
  useEffect(() => {
    if (composing.current || search === (params.get('q') || '')) return
    const timer = window.setTimeout(() => {
      const next = new URLSearchParams(params)
      if (search.trim()) next.set('q', search.trim())
      else next.delete('q')
      update(next)
    }, 120)
    return () => window.clearTimeout(timer)
  }, [search, params.toString(), personal, location.pathname])
  const original = useMemo(() => {
    const list = request.value || []
    if (!favoritesOnly || !request.value) return list
    // 已从来源消失的人物仍保留收藏快照，不能因名册更新而顺带删除个人记录。
    const known = new Set(list.map(identity))
    const missing = Object.values(data.records)
      .filter(
        r =>
          r.favorite?.active && !known.has(identity(r)) && (source === 'all' || r.source === source)
      )
      .map(
        r =>
          ({
            source: r.source,
            id: r.id,
            name: r.snapshot.name,
            aliases: [],
            gender: '?',
            birthday: '',
            height: null,
            breast: null,
            waist: null,
            hip: null,
            cup: '',
            blood: '',
            place: '',
            agency: '',
            hobby: '',
            shoe: '',
            official: '',
            tags: [],
            avatar: null,
            status: 'directory',
            fetchedAt: null,
            genderEvidence: '当前数据未收录',
            sourceUrl: r.snapshot.sourceUrl,
            detailRef: ''
          }) as Person
      )
    return [...list, ...missing]
  }, [request.value, data, favoritesOnly, source])
  const people = useMemo(
    () =>
      original.map(p => {
        if (params.get('values') === 'source') return p
        const record = data.records[identity(p)],
          resolved = resolvePerson(p, record)
        return record?.fields.name?.kind === 'set' || record?.fields.aliases?.kind === 'set'
          ? {
              ...resolved,
              aliases: [...new Set([...(resolved.aliases || []), p.name, ...p.aliases])]
            }
          : resolved
      }),
    [original, data, params.get('values')]
  )
  const results = useMemo(
    () => selectPeople(people, params, personal, data, favoritesOnly),
    [people, params, personal, data, favoritesOnly]
  )
  const perPage = [24, 48, 96].includes(Number(params.get('size')))
    ? Number(params.get('size'))
    : 48
  const pages = Math.max(1, Math.ceil(results.length / perPage)),
    requestedPage = Math.max(1, Number(params.get('page')) || 1),
    page = Math.min(pages, Math.floor(requestedPage))
  const current = results.slice((page - 1) * perPage, page * perPage)
  useEffect(() => {
    if (request.value && requestedPage !== page) {
      const next = new URLSearchParams(params)
      next.set('page', String(page))
      update(next, personal, false, false)
    }
  }, [page, requestedPage, request.value])
  useEffect(() => {
    if (request.value && restored.current !== location.key) {
      restored.current = location.key
      restoreList(location.key)
    }
  }, [request.value, location.key])
  const changePage = (value: number) => {
    const next = new URLSearchParams(params)
    next.set('page', String(value))
    update(next, personal, true, false)
    requestAnimationFrame(() => resultRef.current?.scrollIntoView({ block: 'start' }))
  }
  const clear = () => {
    const next = new URLSearchParams()
    for (const key of ['source', 'view', 'size'])
      if (params.get(key)) next.set(key, params.get(key)!)
    update(next, emptyPrivate())
    setPersonal(emptyPrivate())
  }
  const view = personView(params.get('view'))
  const compact = view === 'list'
  const filterProps = {
    people,
    params,
    change: update,
    personal,
    changePersonal: (value: PrivateFilters) => {
      setPersonal(value)
      update(new URLSearchParams(params), value)
    },
    data,
    favoritesOnly
  }
  const tagLabels = useMemo(
    () => new Map(people.flatMap(person => person.tags).map(tag => [tag.value, tag.label])),
    [people]
  )
  const chipValue = (key: string, value: string) =>
    key === 'tag'
      ? tagLabels.get(value) || value
      : {
          f: '女',
          m: '男',
          '?': '未知',
          yes: '是',
          no: '否',
          raw: '原字段已采集',
          profile: '详情已采集',
          directory: '目录记录',
          api: 'API资料',
          any: '任一',
          all: '全部'
        }[value] || value
  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">
            JAV ATLAS / {favoritesOnly ? 'YOUR COLLECTION' : 'PEOPLE DIRECTORY'}
          </p>
          <h1>{favoritesOnly ? '我的收藏' : '人物资料'}</h1>
          <p className="muted">
            {favoritesOnly
              ? '此浏览器的收藏、标签与个人资料。'
              : 'minnano 聚焦曾进入日、周、月榜 Top250 的人物；落榜后继续保留。'}
          </p>
        </div>
        <div className="segmented" aria-label="数据来源">
          {[
            ['minnano', 'minnano'],
            ['javdb', 'JavDB'],
            ['all', '全部来源']
          ].map(([value, label]) => (
            <button
              aria-pressed={source === value}
              key={value}
              onClick={() => {
                const next = new URLSearchParams(params)
                next.set('source', value)
                next.delete('tag')
                update(next)
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="catalog">
        <aside className="filter-sidebar">
          <div className="filter-title">
            <h2>筛选条件</h2>
            <button className="text-button" onClick={clear}>
              清空
            </button>
          </div>
          <Filters {...filterProps} />
        </aside>
        <section className="results" ref={resultRef} tabIndex={-1} aria-label="人物搜索结果">
          <form
            className="search-bar"
            onSubmit={event => {
              event.preventDefault()
              const next = new URLSearchParams(params)
              if (search.trim()) next.set('q', search.trim())
              else next.delete('q')
              update(next)
            }}
          >
            <span aria-hidden="true">⌕</span>
            <input
              aria-label="搜索姓名、别名或原始ID"
              placeholder="搜索姓名、别名或原始 ID"
              value={search}
              onCompositionStart={() => {
                composing.current = true
              }}
              onCompositionEnd={event => {
                composing.current = false
                const value = event.currentTarget.value
                setSearch(value)
                const next = new URLSearchParams(params)
                if (value.trim()) next.set('q', value.trim())
                else next.delete('q')
                update(next)
              }}
              onChange={event => setSearch(event.target.value)}
            />
            <button type="submit">搜索</button>
          </form>
          <div className="active-filters">
            {[...new Set(params.keys())]
              .filter(key => !['source', 'view', 'sort', 'page', 'size', 'values'].includes(key))
              .map(key => (
                <button
                  className="chip"
                  key={key}
                  onClick={() => {
                    const next = new URLSearchParams(params)
                    next.delete(key)
                    update(next)
                  }}
                >
                  {queryLabel(key)}:{' '}
                  {params
                    .getAll(key)
                    .map(value => chipValue(key, value))
                    .join(' / ')}{' '}
                  ×
                </button>
              ))}
            {(personal.favorite ||
              personal.edited ||
              personal.personalTags.length > 0 ||
              personal.batch) && (
              <button
                className="chip"
                onClick={() => {
                  setPersonal(emptyPrivate())
                  update(new URLSearchParams(params), emptyPrivate())
                }}
              >
                {personal.batch ? '最近批次限定' : '本地条件（不分享）'} ×
              </button>
            )}
          </div>
          <div className="result-toolbar">
            <span role="status" className="muted">
              {request.value
                ? `${results.length.toLocaleString()} 条${source === 'all' ? '来源记录 · 跨站未合并' : '记录'}`
                : '正在读取名册…'}
            </span>
            <div className="toolbar-actions">
              <button
                className="mobile-filter-button"
                onClick={() => setMobile({ params: new URLSearchParams(params), personal })}
              >
                筛选
              </button>
              <select
                aria-label="排序"
                value={
                  params.get('sort') ||
                  (params.get('q') ? 'relevance' : favoritesOnly ? 'added' : 'name')
                }
                onChange={event => {
                  const next = new URLSearchParams(params)
                  next.set('sort', event.target.value)
                  update(next)
                }}
              >
                <option value="name">姓名 ↑</option>
                <option value="name-desc">姓名 ↓</option>
                <option value="relevance">搜索相关度</option>
                <option value="height">身高 ↑</option>
                <option value="height-desc">身高 ↓</option>
                <option value="birthday">出生日期</option>
                <option value="fetchedAt">详情采集时间</option>
                {favoritesOnly && <option value="added">最近收藏</option>}
              </select>
              <ViewSwitcher
                value={view}
                onChange={value => {
                  const next = new URLSearchParams(params)
                  next.set('view', value)
                  update(next, personal, false, false)
                }}
              />
            </div>
          </div>
          <div className="view-options">
            <label>
              筛选口径{' '}
              <select
                value={params.get('values') || 'effective'}
                onChange={event => {
                  const next = new URLSearchParams(params)
                  next.set('values', event.target.value)
                  update(next)
                }}
              >
                <option value="effective">当前显示值（含本地修改）</option>
                <option value="source">仅源数据</option>
              </select>
            </label>
            <button
              className="text-button"
              onClick={async () => {
                const next = new URLSearchParams(params)
                next.delete('page')
                try {
                  await navigator.clipboard.writeText(
                    `${window.location.origin}${window.location.pathname}#${location.pathname}?${next}`
                  )
                  notify('已复制公共条件，不含收藏、个人标签和修改。')
                } catch {
                  notify('无法自动复制，请复制地址栏；个人筛选未写入地址。')
                }
              }}
            >
              分享公共条件
            </button>
          </div>
          {request.error && (
            <div className="notice error">
              {request.error}
              <button onClick={request.retry}>重试</button>
              <button onClick={() => window.location.reload()}>刷新站点</button>
            </div>
          )}
          {!request.value && !request.error && (
            <div className="loading-grid" aria-label="正在加载">
              {Array.from({ length: 12 }, (_, i) => (
                <div className="skeleton" key={i} />
              ))}
            </div>
          )}
          {request.value && current.length === 0 && (
            <div className="empty-state">
              <h2>{favoritesOnly ? '这里还没有匹配的收藏' : '没有匹配的人物'}</h2>
              <p>可以减少筛选条件，或回到人物页继续浏览。</p>
              <button onClick={clear}>清空筛选</button>
            </div>
          )}
          <div
            className={`people-grid ${compact ? 'list-view' : view === 'portrait' ? 'portrait-view' : ''}`}
          >
            {current.map(person => (
              <PersonCard
                key={identity(person)}
                person={person}
                compact={compact}
                portrait={view === 'portrait'}
                sequence={current.map(identity)}
              />
            ))}
          </div>
          {request.value && (
            <nav className="pagination" aria-label="分页">
              <label>
                每页{' '}
                <select
                  value={perPage}
                  onChange={event => {
                    const next = new URLSearchParams(params)
                    next.set('size', event.target.value)
                    update(next)
                  }}
                >
                  {[24, 48, 96].map(value => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </label>
              <div>
                <button disabled={page <= 1} onClick={() => changePage(page - 1)}>
                  上一页
                </button>
                <span>
                  {page} / {pages}
                </span>
                <button disabled={page >= pages} onClick={() => changePage(page + 1)}>
                  下一页
                </button>
              </div>
            </nav>
          )}
        </section>
      </div>
      {mobile && (
        <Modal title="筛选条件" close={() => setMobile(null)}>
          <header className="modal-heading">
            <h2>筛选条件</h2>
            <button onClick={() => setMobile(null)} aria-label="关闭筛选">
              ×
            </button>
          </header>
          <Filters
            {...filterProps}
            params={mobile.params}
            personal={mobile.personal}
            change={value => setMobile({ ...mobile, params: value })}
            changePersonal={value => setMobile({ ...mobile, personal: value })}
          />
          <footer className="sticky-actions">
            <button
              onClick={() =>
                setMobile({ params: new URLSearchParams({ source }), personal: emptyPrivate() })
              }
            >
              重置草稿
            </button>
            <button
              className="primary"
              onClick={() => {
                update(mobile.params, mobile.personal)
                setPersonal(mobile.personal)
                setMobile(null)
              }}
            >
              查看结果
            </button>
          </footer>
        </Modal>
      )}
    </>
  )
}
