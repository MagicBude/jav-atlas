/**
 * @file 人物作品按需加载。作品自己的搜索/页码使用w前缀，不污染背景人物列表的page。
 * 弹窗用work查询参数表达，背景人物组件保留实例，关闭后原列表和焦点自然保留。
 */
import { useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../../app/context'
import { resource } from '../../data/repository'
import type { PersonWorks as Collection, WorkEntry } from '../../entities/work'
import { normalize } from '../../entities/person'
import { useResource } from '../../shared/useResource'
import { Modal } from '../../shared/Modal'
import { WorkDetail } from './WorkDetail'
import { compareWorks } from './query'
export function PersonWorks({ actorId }: { actorId: string }) {
  const { manifest } = useApp(),
    location = useLocation(),
    navigate = useNavigate()
  const params = new URLSearchParams(location.search)
  const file = manifest?.works?.people[actorId]
  const [opened, setOpened] = useState(false)
  const active = opened || ['work', 'wq', 'wp', 'wy', 'wm', 'ws'].some(key => params.has(key))
  const request = useResource(active && file ? file : '', () => resource<Collection>(file!))
  const update = (key: string, value: string) => {
    // 打开作品压入一层历史，让后退先关作品。直达链接没有该历史，只移除参数。
    if (key === 'work' && !value && location.state?.workModal) {
      navigate(-1)
      return
    }
    const next = new URLSearchParams(location.search)
    if (value) next.set(key, value)
    else next.delete(key)
    if (key !== 'wp' && key !== 'work') next.delete('wp')
    navigate(
      { pathname: location.pathname, search: next.toString() },
      {
        replace: key !== 'work' || !value,
        state: key === 'work' && value ? { ...location.state, workModal: true } : location.state
      }
    )
  }
  const entries = request.value?.entries || []
  const q = normalize(params.get('wq') || '')
  const year = params.get('wy') || '',
    maker = params.get('wm') || ''
  const sort = params.get('ws') === 'score' ? 'score' : 'date'
  const result = useMemo(
    () =>
      entries
        .filter(
          row =>
            row.kind === 'work' &&
            (!q || normalize(`${row.title} ${'code' in row ? row.code : ''}`).includes(q)) &&
            (!year || row.releaseDate?.startsWith(year)) &&
            (!maker || row.makerText === maker)
        )
        .sort((a, b) => compareWorks(a, b, sort)),
    [entries, q, year, maker, sort]
  )
  const pages = Math.max(1, Math.ceil(result.length / 24))
  const requestedPage = Number(params.get('wp'))
  const page = Math.min(
    pages,
    Number.isSafeInteger(requestedPage) && requestedPage > 0 ? requestedPage : 1
  )
  const work = params.get('work')
  if (!file) return <p className="muted">这位人物的作品列表暂未提供。</p>
  return (
    <>
      <p className="muted small">来源收录作品，不代表全部出演记录。封面暂未接入。</p>
      {!active ? (
        <button className="button" onClick={() => setOpened(true)}>
          查看作品列表
        </button>
      ) : (
        <>
          {request.error && (
            <p role="alert">
              {request.error}
              <button onClick={request.retry}>重试</button>
            </p>
          )}
          {!request.value && !request.error && <p>正在读取作品…</p>}
          {request.value && (
            <>
              <div className="work-filters">
                <input
                  aria-label="搜索作品标题或番号"
                  placeholder="搜索标题 / 番号"
                  value={params.get('wq') || ''}
                  onChange={e => update('wq', e.target.value)}
                />
                <select
                  aria-label="作品发行年份"
                  value={year}
                  onChange={e => update('wy', e.target.value)}
                >
                  <option value="">全部年份</option>
                  {[
                    ...new Set(
                      entries.flatMap(e => (e.releaseDate ? [e.releaseDate.slice(0, 4)] : []))
                    )
                  ]
                    .sort()
                    .reverse()
                    .map(y => (
                      <option key={y}>{y}</option>
                    ))}
                </select>
                <select
                  aria-label="作品厂商"
                  value={maker}
                  onChange={e => update('wm', e.target.value)}
                >
                  <option value="">全部厂商</option>
                  {[...new Set(entries.flatMap(e => (e.makerText ? [e.makerText] : [])))]
                    .sort()
                    .map(m => (
                      <option key={m}>{m}</option>
                    ))}
                </select>
                <select
                  aria-label="作品排序"
                  value={sort}
                  onChange={e => update('ws', e.target.value)}
                >
                  <option value="date">发行日期 ↓</option>
                  <option value="score">JavDB 评分 ↓</option>
                </select>
              </div>
              <p className="small muted">
                {result.length} 部作品 ·{' '}
                {sort === 'score' ? '评分从高到低，无评分排后' : '发行日期从新到旧'}
              </p>
              <div className="work-list">
                {result.slice((page - 1) * 24, page * 24).map((row: WorkEntry) => (
                  <button className="work-row" key={row.id} onClick={() => update('work', row.id)}>
                    <span className="work-code">
                      {'code' in row && row.code ? String(row.code) : `#${row.id}`}
                    </span>
                    <span className="work-title">
                      {row.title}
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
              {!result.length && <p>没有符合条件的作品。</p>}
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
            </>
          )}
        </>
      )}
      {work && /^\d+$/.test(work) && (
        <Modal title="作品详情" close={() => update('work', '')}>
          <div className="work-dialog-toolbar">
            <button onClick={() => update('work', '')}>‹ 返回作品列表</button>
            <Link to={`/works/minnano/${work}`} target="_blank" rel="noreferrer">
              独立打开 ↗
            </Link>
          </div>
          <WorkDetail id={work} />
        </Modal>
      )}
    </>
  )
}
