/** @file 榜单名次取自采集快照，不因个人资料修改重排；人物卡片仍复用统一收藏与详情入口。 */
import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../app/context'
import { loadIndex, resource } from '../data/repository'
import { identity } from '../entities/person'
import { resolvePerson } from '../data/personal'
import { PersonCard } from '../features/people/PersonCard'
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
  const selected = new URLSearchParams(location.search).get('period') || 'week'
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
    <main>
      <div className="page-heading">
        <div>
          <p className="eyebrow">MINNANO / RANKINGS</p>
          <h1>榜单</h1>
          <p className="muted">来自已采集榜单；名次与作品数口径以来源为准。</p>
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
              onClick={() => navigate(`/rankings?period=${value}`, { replace: true })}
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
          采集时间：{new Date(request.value.rankings.fetchedAt).toLocaleString('zh-CN')}
        </p>
      )}
      <div className="ranking-grid">
        {entries.map(row => (
          <div className="ranking-entry" key={row.id}>
            <div className="rank-number">{String(row.rank).padStart(2, '0')}</div>
            {row.person ? (
              <PersonCard
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
