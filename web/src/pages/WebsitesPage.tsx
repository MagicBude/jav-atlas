/** 网站目录整理站点用途；采集能力说明单独放入数据页，避免收录即接入的误解。 */
import { Link, useSearchParams } from 'react-router-dom'
import audit from '../data/source-candidates.json'
import {
  websiteCategories,
  readWebsiteCategory,
  matchesWebsiteCategory
} from '../entities/websiteCategories'
import { dataSources } from '../entities/dataSources'
import { SourceCandidates } from './SourceCandidates'
import '../features/sources/sources.css'
export default function WebsitesPage() {
  const [params, setParams] = useSearchParams()
  const category = readWebsiteCategory(params.get('category'))
  const all = [...dataSources, ...audit.candidates]
  const sources = dataSources.filter(item => matchesWebsiteCategory(item.categories, category))
  const changeCategory = (id: string) => {
    const next = new URLSearchParams(params)
    if (id === 'all') next.delete('category')
    else next.set('category', id)
    setParams(next)
  }
  const summary = audit.inventorySummary
  return (
    <main className="websites-page">
      <header>
        <p className="eyebrow">JAV Atlas · 网站整理</p>
        <h1>网站目录</h1>
        <p className="muted">
          按用途整理资料站点和核实记录。收录网站不代表已接入采集，核实状态也不是实时连通性检测。
        </p>
        <p className="small">
          <Link to="/data">查看数据说明与采集来源 →</Link>
        </p>
      </header>
      <nav className="website-categories" aria-label="网站用途分类">
        {websiteCategories.map(item => (
          <button
            key={item.id}
            aria-pressed={category === item.id}
            onClick={() => changeCategory(item.id)}
          >
            {item.label}
            <small>
              {all.filter(site => matchesWebsiteCategory(site.categories, item.id)).length}
            </small>
          </button>
        ))}
      </nav>
      <p className="small muted" role="status">
        显示 {all.filter(site => matchesWebsiteCategory(site.categories, category)).length} /{' '}
        {all.length} 个资料站点。同一站点可以归入多个用途分类，分类数量不相加。
      </p>
      <details className="website-inventory-summary">
        <summary>188 条原目录的清点结果</summary>
        <p>
          已逐条完成 {summary.reviewedEntries} 条本地用途分流：{summary.registeredEntries}{' '}
          条对应现有来源，{summary.candidateEntries} 条归为 {summary.candidateServices} 个资料候选，
          {summary.deferredEntries} 条证据不足暂缓，{summary.excludedEntries}{' '}
          条不属于本轮文字资料范围。
        </p>
        <p>
          另保留原项目目录以外的 minnano 入口，目录共 {all.length}{' '}
          个站点。排除项仅统计，不提供播放、下载、磁力或露骨图片入口。
        </p>
        <p className="small muted">
          {audit.scope}。核实日期：{audit.checkedOn}
          。用途清点完成不等于所有站点和字段已在线核实，未确认事项在各记录中保留。
        </p>
      </details>
      <section aria-label="现有资料站点">
        <h2>现有资料站点</h2>
        {!sources.length && <p className="muted">这个分类暂无已接入站点，可查看下方核实记录。</p>}
        <div className="website-cards">
          {sources.map(source => (
            <article className="website-card" key={source.id}>
              <div className="source-card-heading">
                <h3>{source.name}</h3>
                <a
                  className="button"
                  href={source.homepage}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`打开 ${source.name} 网站（新标签页）`}
                >
                  打开网站 ↗
                </a>
              </div>
              <p>
                {source.id === 'minnano'
                  ? '人物资料、榜单和作品目录。'
                  : '作品资料、类别与评分查询。'}
              </p>
              <span className="small muted">本项目已使用部分资料；具体范围见数据说明。</span>
            </article>
          ))}
        </div>
      </section>
      <SourceCandidates category={category} />
    </main>
  )
}
