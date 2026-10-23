/**
 * @file 人物作品区与独立作品库的共用浏览器。只接收轻量条目，不负责抓取来源资料。
 * 查询、分页、密度和详情历史在此统一，避免两个入口随功能演进出现不同结果。
 */
import { useMemo } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import type { WorkEntry } from '../../entities/work'
import { normalize } from '../../entities/person'
import { Modal } from '../../shared/Modal'
import { WorkDetail } from './WorkDetail'
import { clearWorkFilters, compareWorks, workQuery } from './query'
export function WorkBrowser({
  entries,
  actors = [],
  queryKey = 'wq',
  hideSearch = false
}: {
  entries: WorkEntry[]
  actors?: { id: string; name: string }[]
  queryKey?: 'wq' | 'q'
  hideSearch?: boolean
}) {
  const location = useLocation(),
    navigate = useNavigate()
  const params = new URLSearchParams(location.search)
  const update = (key: string, value: string) => {
    // 打开作品压入一层历史，让后退先关作品。直达链接没有该历史，只移除参数。
    if (key === 'work' && !value && location.state?.workModal) {
      navigate(-1)
      return
    }
    navigate(
      { pathname: location.pathname, search: workQuery(location.search, key, value) },
      {
        replace: key !== 'work' || !value,
        state: key === 'work' && value ? { ...location.state, workModal: true } : location.state
      }
    )
  }
  const q = normalize(params.get(queryKey) || '')
  const year = params.get('wy') || '',
    maker = params.get('wm') || ''
  const actor = actors.length ? params.get('wa') || '' : ''
  const sort = params.get('ws') === 'score' ? 'score' : 'date'
  const density = params.get('wd') === 'compact' ? 'compact' : 'standard'
  const result = useMemo(
    () =>
      entries
        .filter(
          row =>
            row.kind === 'work' &&
            (!q || normalize(`${row.title} ${'code' in row ? row.code : ''}`).includes(q)) &&
            (!year || row.releaseDate?.startsWith(year)) &&
            (!maker || row.makerText === maker) &&
            (!actor || row.actorIds?.includes(actor))
        )
        .sort((a, b) => compareWorks(a, b, sort)),
    [entries, q, year, maker, sort, actor]
  )
  const pages = Math.max(1, Math.ceil(result.length / 24))
  const requestedPage = Number(params.get('wp'))
  const page = Math.min(
    pages,
    Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
  )
  const work = params.get('work')
  const conditions = [
    ...(!hideSearch && params.get(queryKey)
      ? [{ key: queryKey, label: `搜索：${params.get(queryKey)}` }]
      : []),
    ...(actor
      ? [{ key: 'wa', label: `人物：${actors.find(person => person.id === actor)?.name || actor}` }]
      : []),
    ...(year ? [{ key: 'wy', label: `年份：${year}` }] : []),
    ...(maker ? [{ key: 'wm', label: `厂商：${maker}` }] : [])
  ]
  const reset = () =>
    navigate(
      {
        pathname: location.pathname,
        search: clearWorkFilters(location.search, queryKey, hideSearch)
      },
      { replace: true, state: location.state }
    )
  return (
    <>
      <div className="work-query-panel">
        {!hideSearch && (
          <input
            aria-label="搜索作品标题或番号"
            placeholder="搜索标题 / 番号"
            value={params.get(queryKey) || ''}
            onChange={e => update(queryKey, e.target.value)}
          />
        )}
        <div className="work-filters">
          {actors.length > 0 && (
            <select
              aria-label="作品人物"
              value={actor}
              onChange={e => update('wa', e.target.value)}
            >
              <option value="">全部人物</option>
              {actor && !actors.some(person => person.id === actor) && (
                <option value={actor}>人物 ID {actor}</option>
              )}
              {[...actors]
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(person => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
            </select>
          )}
          <select
            aria-label="作品发行年份"
            value={year}
            onChange={e => update('wy', e.target.value)}
          >
            <option value="">全部年份</option>
            {[...new Set(entries.flatMap(e => (e.releaseDate ? [e.releaseDate.slice(0, 4)] : [])))]
              .sort()
              .reverse()
              .map(y => (
                <option key={y}>{y}</option>
              ))}
          </select>
          <select aria-label="作品厂商" value={maker} onChange={e => update('wm', e.target.value)}>
            <option value="">全部厂商</option>
            {[...new Set(entries.flatMap(e => (e.makerText ? [e.makerText] : [])))]
              .sort()
              .map(m => (
                <option key={m}>{m}</option>
              ))}
          </select>
        </div>
        {conditions.length > 0 && (
          <div className="work-conditions" aria-label="已选作品条件">
            {conditions.map(condition => (
              <button
                key={condition.key}
                onClick={() => update(condition.key, '')}
                title={`清除${condition.label}`}
              >
                <span>{condition.label}</span>
                <span aria-hidden="true">×</span>
              </button>
            ))}
            <button className="text-button" onClick={reset}>
              清除筛选
            </button>
          </div>
        )}
      </div>
      <div className="work-results-toolbar">
        <p className="small muted">
          {result.length} 部作品 ·{' '}
          {sort === 'score' ? '评分从高到低，无评分排后' : '发行日期从新到旧'}
        </p>
        <div className="work-display-controls">
          <select aria-label="作品排序" value={sort} onChange={e => update('ws', e.target.value)}>
            <option value="date">发行日期 ↓</option>
            <option value="score">JavDB 评分 ↓</option>
          </select>
          <div className="work-density" role="group" aria-label="作品列表密度">
            {(
              [
                ['standard', '标准'],
                ['compact', '紧凑']
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                aria-pressed={density === value}
                onClick={() => update('wd', value)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="work-list" data-density={density}>
        {result.slice((page - 1) * 24, page * 24).map((row: WorkEntry) => (
          <button
            className="work-row"
            title={row.title}
            key={row.id}
            onClick={() => update('work', row.id)}
          >
            <span className="work-code">
              {'code' in row && row.code ? String(row.code) : `#${row.id}`}
            </span>
            <span className="work-title">
              <span className="work-title-text">{row.title}</span>
              <small>
                {row.makerText || '厂商未知'}
                {row.rating && (
                  <span
                    className="list-work-rating"
                    title={`JavDB · ${row.rating.count ?? '未知'} 人评价`}
                  >
                    JavDB {row.rating.score.toFixed(2)}
                  </span>
                )}
              </small>
            </span>
            <time>{row.releaseDate || '日期未知'}</time>
            <span aria-hidden="true">›</span>
          </button>
        ))}
      </div>
      {!result.length && (
        <div className="work-empty">
          <p>没有符合条件的作品。</p>
          {conditions.length > 0 && <button onClick={reset}>清除筛选后再看</button>}
        </div>
      )}
      <div className="pagination">
        <span>
          第 {page} / {pages} 页
        </span>
        <div>
          <button disabled={page <= 1} onClick={() => update('wp', String(page - 1))}>
            上一页
          </button>
          <button disabled={page >= pages} onClick={() => update('wp', String(page + 1))}>
            下一页
          </button>
        </div>
      </div>
      {entries.some(e => e.kind === 'unknown') && (
        <details>
          <summary>
            来源中的未知作品记录（{entries.filter(e => e.kind === 'unknown').length}）
          </summary>
          {entries
            .filter(e => e.kind === 'unknown')
            .map(e => (
              <p key={e.id}>
                {e.title} · {e.id}
              </p>
            ))}
        </details>
      )}
      {work && /^\d+$/.test(work) && (
        <Modal title="作品详情" close={() => update('work', '')}>
          <div className="work-dialog-toolbar">
            <button onClick={() => update('work', '')}>‹ 返回作品列表</button>
            <Link to={`/works/minnano/${work}`} target="_blank" rel="noreferrer">
              独立打开 ↗
            </Link>
          </div>
          <WorkDetail key={work} id={work} />
        </Modal>
      )}
    </>
  )
}
