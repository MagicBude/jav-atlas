/**
 * 候选核实记录与已接入来源严格分开：有文档不等于有数据，能访问不等于可采集。
 * 这里只展示筛选依据；不会注册采集器、生成详情地址或增加外站主页导航。
 */
import audit from '../data/source-candidates.json'
import { matchesWebsiteCategory, websiteCategoryLabel } from '../entities/websiteCategories'
export function SourceCandidates({ category = 'all' }: { category?: string }) {
  const candidates = audit.candidates.filter(item =>
    matchesWebsiteCategory(item.categories, category)
  )
  return (
    <section className="source-candidates" aria-label="网站核实记录">
      <h2>更多相关网站</h2>
      <p className="muted">
        本分类显示 {candidates.length} / {audit.candidates.length}{' '}
        项核实记录，尚未接入采集。核实日期：{audit.checkedOn}
        。结论是当次观察，不是实时可用性检测。
      </p>
      <div className="candidate-grid">
        {candidates.map(candidate => (
          <article className="candidate-card" key={candidate.id}>
            <header>
              <span className="candidate-monogram" aria-hidden="true">
                {candidate.name.slice(0, 2).toUpperCase()}
              </span>
              <div>
                <h3>{candidate.name}</h3>
                <p className="candidate-categories">
                  {candidate.categories.map(websiteCategoryLabel).join(' · ')}
                </p>
              </div>
            </header>
            <p>{candidate.potential}</p>
            <div className="source-evidence">
              {candidate.evidence.map(item => (
                <a key={item.url} href={item.url} target="_blank" rel="noopener noreferrer">{item.label} ↗</a>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  )
}
