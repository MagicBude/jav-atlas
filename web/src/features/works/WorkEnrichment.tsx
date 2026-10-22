/** @file JavDB只读补充区。与minnano分开展示，评分人数与保存评论数不混用。 */
import { useApp } from '../../app/context'
import { resource } from '../../data/repository'
import { useResource } from '../../shared/useResource'
import { RawTree } from '../../shared/RawTree'
interface Enrichment {
  id: string
  sourceUrl: string
  fetchedAt: string
  metadata: {
    number: string
    score?: string
    reviews_count?: number
    comments_count?: number
    duration?: number
    release_date?: string
    maker_name?: string
    publisher_name?: string
    director_name?: string
    series_name?: string
    tags?: { id: string; name: string }[]
    actors?: { id: string; name: string }[]
  }
  reviews: {
    id: string
    author: string
    score: number | null
    content: string
    likes: number
    createdAt: string
  }[]
  mapping: { dateDifference: boolean; minnanoDate: string | null; javdbDate: string | null }
}
export function WorkEnrichment({ id }: { id: string }) {
  const { manifest } = useApp()
  const file = manifest?.works?.enrichments?.[id]
  const request = useResource(file || '', () => resource<Enrichment>(file!))
  if (!file) return null
  if (request.error)
    return (
      <section>
        <h3>JavDB 资料</h3>
        <p role="alert">{request.error}</p>
        <button onClick={request.retry}>重试</button>
      </section>
    )
  if (!request.value) return <p>正在读取 JavDB 资料…</p>
  const data = request.value,
    m = data.metadata
  const facts = [
    ['番号', m.number],
    ['发行日期', m.release_date],
    ['时长', m.duration ? `${m.duration} 分钟` : '未知'],
    ['制作商', m.maker_name],
    ['发行商 / 厂牌', m.publisher_name],
    ['导演', m.director_name],
    ['系列', m.series_name]
  ]
  return (
    <section className="work-enrichment">
      <div className="enrichment-heading">
        <h3>JavDB 资料</h3>
        <a
          href={`https://javdb.com/v/${encodeURIComponent(data.id)}`}
          target="_blank"
          rel="noreferrer"
        >
          查看来源 ↗
        </a>
      </div>
      <div className="work-score">
        <strong>{m.score || '暂无评分'}</strong>
        <span>
          JavDB 评分
          <small>
            来源评价数 {m.reviews_count ?? '未知'} · 已保存短评 {data.reviews.length} 条
          </small>
        </span>
      </div>
      {data.mapping.dateDifference && (
        <p className="notice">
          两站发行日期不同：minnano {data.mapping.minnanoDate}；JavDB {data.mapping.javdbDate}
          。分别保留来源值。
        </p>
      )}
      <dl className="facts">
        {facts.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value || '未知'}</dd>
          </div>
        ))}
      </dl>
      <h4>JavDB 出演者</h4>
      <p className="muted small">来源署名可能与 minnano 不同，未自动合并人物身份。</p>
      <div className="work-cast">
        {m.actors?.map(a => (
          <a
            key={a.id}
            href={`https://javdb.com/actors/${encodeURIComponent(a.id)}`}
            target="_blank"
            rel="noreferrer"
          >
            {a.name} ↗
          </a>
        ))}
      </div>
      <div className="work-tags">
        {m.tags?.map(t => (
          <span className="badge" key={t.id}>
            {t.name}
          </span>
        ))}
      </div>
      <h3>
        短评 <span className="muted small">{data.reviews.length} 条</span>
      </h3>
      <p className="muted small">仅保存本次取得的前两页；排序未确认，不代表全部评论。</p>
      <div className="work-reviews">
        {data.reviews.map(r => (
          <article key={r.id}>
            <header>
              <strong>{r.author || '匿名用户'}</strong>
              <span>{r.score == null ? '未评分' : `${r.score} 分`}</span>
              <time>
                {r.createdAt && Number.isFinite(Date.parse(r.createdAt))
                  ? new Date(r.createdAt).toLocaleDateString('zh-CN')
                  : '日期未知'}
              </time>
            </header>
            <p>{r.content}</p>
            <small className="muted">赞同 {r.likes}</small>
          </article>
        ))}
      </div>
      <p className="muted small">
        资料取得时间：{new Date(data.fetchedAt).toLocaleString('zh-CN')}
      </p>
      <details>
        <summary>JavDB 来源字段与匹配依据</summary>
        <RawTree value={data} />
      </details>
    </section>
  )
}
