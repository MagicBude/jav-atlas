/** @file 榜单名次取自采集快照，不因个人资料修改重排；人物卡片仍复用统一收藏与详情入口。 */
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../app/context'
import { loadIndex, resource } from '../data/repository'
import { identity } from '../entities/person'
import { resolvePerson } from '../data/personal'
import { PersonCard } from '../features/people/PersonCard'
import { personView, ViewSwitcher } from '../features/people/ViewSwitcher'
import { restoreList } from '../features/people/returnPosition'
import { useResource } from '../shared/useResource'
interface Rankings {
  fetchedAt: number
  day: { id: string; rank: number; name: string }[]
  week: Rankings['day']
  month: Rankings['day']
}
export default function RankingsPage() {
  const { manifest, data } = useApp(),
    location = useLocation(),
    navigate = useNavigate()
  const params = new URLSearchParams(location.search)
  const view = personView(params.get('view'))
  const selected = params.get('period') || 'week'
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(location.search)
    next.set(key, value)
    navigate(`/rankings?${next}`, { replace: true })
  }
  const period = ['day', 'week', 'month'].includes(selected)
    ? (selected as 'day' | 'week' | 'month')
    : 'week'
  const request = useResource(manifest ? `${manifest.version}:rankings` : '', async () => ({
    rankings: await resource<Rankings>(manifest!.rankings),
    people: await loadIndex(manifest!, 'minnano')
  }))
  useEffect(() => {
    if (request.value) restoreList(location.key)
  }, [request.value, location.key])
  const entries = (request.value?.rankings[period] || []).map(row => ({
    ...row,
    person: request.value?.people.find(person => person.id === String(row.id))
  }))
  return (
    <main className="rankings-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">MINNANO / RANKINGS</p>
          <h1>
            人气榜单<span className="heading-accent">TOP 250</span>
          </h1>
          <p className="muted">
            日、周、月榜各取来源前 250 位；曾上榜人物持续累积，落榜后仍保留资料。
          </p>
        </div>
        <div className="segmented">
          {[
            ['day', '日榜'],
            ['week', '周榜'],
            ['month', '月榜']
          ].map(([value, label]) => (
            <button
              key={value}
              aria-pressed={period === value}
              onClick={() => update('period', value)}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {request.error && (
        <p className="notice error">
          {request.error}
          <button onClick={request.retry}>重试</button>
        </p>
      )}
      {!request.value && !request.error && <p>正在加载榜单…</p>}
      {request.value && (
        <p className="small muted">
          当前榜单 {entries.length} 位 · 采集时间：
          {new Date(request.value.rankings.fetchedAt).toLocaleString('zh-CN')}
        </p>
      )}
      <div className="ranking-toolbar">
        <span>
          按源站名次排序 <span className="muted">/ 共 {entries.length} 位</span>
        </span>
        <ViewSwitcher value={view} onChange={value => update('view', value)} />
      </div>
      <div
        className={`ranking-grid ${view === 'list' ? 'list-view' : view === 'portrait' ? 'portrait-view' : ''}`}
      >
        {entries.map(row => (
          <div className="ranking-entry" key={row.id}>
            {row.person ? (
              <PersonCard
                rank={row.rank}
                compact={view === 'list'}
                portrait={view === 'portrait'}
                person={resolvePerson(row.person, data.records[identity(row.person)])}
                sequence={entries.flatMap(r => (r.person ? [identity(r.person)] : []))}
              />
            ) : (
              <p>
                {row.name} · 当前名册未收录{' '}
                <a
                  href={`https://www.minnano-av.com/actress${encodeURIComponent(row.id)}.html`}
                  target="_blank"
                  rel="noreferrer"
                >
                  查看来源 ↗
                </a>
              </p>
            )}
          </div>
        ))}
      </div>
    </main>
  )
}
