/** 评论默认三条、长文本默认折叠；只改变展示，不截断存储或把样本当全量。 */
import { useState } from 'react'
import type { Enrichment } from '../../entities/enrichment'
function Review({ review }: { review: Enrichment['reviews'][number] }) {
  const [expanded, setExpanded] = useState(false)
  const long = review.content.length > 240
  return (
    <article>
      <header>
        <strong>{review.author || '匿名用户'}</strong>
        <span>{review.score == null ? '未评分' : `${review.score} 分`}</span>
        <time>
          {review.createdAt && Number.isFinite(Date.parse(review.createdAt))
            ? new Date(review.createdAt).toLocaleDateString('zh-CN')
            : '日期未知'}
        </time>
      </header>
      <p className={long && !expanded ? 'review-collapsed' : ''}>{review.content}</p>
      {long && (
        <button
          className="text-button"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '收起正文' : '展开全文'}
        </button>
      )}
      <small className="muted">赞同 {review.likes}</small>
    </article>
  )
}
export function WorkEnrichment({ data }: { data: Enrichment }) {
  const [expanded, setExpanded] = useState(false)
  // 元数据采集不请求评论；空数组不能解读成“来源没有评论”，因此不展示空评论区。
  if (!data.reviews.length) return null
  return (
    <section className="work-enrichment">
      <div className="enrichment-heading">
        <h3>
          短评 <span className="muted small">{data.reviews.length}</span>
        </h3>
        <span className="small muted">来自 JavDB</span>
      </div>
      <div className="work-reviews">
        {(expanded ? data.reviews : data.reviews.slice(0, 3)).map(r => (
          <Review key={r.id} review={r} />
        ))}
      </div>
      {data.reviews.length > 3 && (
        <button
          className="reviews-toggle"
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? '收起评论' : `展开其余 ${data.reviews.length - 3} 条评论`}
        </button>
      )}
      <p className="small muted">已保存 {data.reviews.length} 条，不代表全部评论。</p>
    </section>
  )
}
