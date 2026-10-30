/** 相关网站整理站点用途；采集能力说明单独放入数据页，避免收录即接入的误解。 */
import { useSearchParams } from 'react-router-dom'
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
  return (
    <main className="websites-page">
      <header>
        <p className="eyebrow">JAV Atlas · 网站整理</p>
        <h1>相关网站</h1>
        <p className="muted">按用途分类浏览 JAV 相关网站，点击链接可在新标签页打开。</p>

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
        {all.length} 个站点 · 支持多用途归类
      </p>
      <section aria-label="资料查询">
        <h2>资料查询</h2>
        {!sources.length && <p className="muted">这个分类暂无资料查询站点。</p>}
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
              <span className="small muted"></span>
            </article>
          ))}
        </div>
      </section>
      <SourceCandidates category={category} />

    </main>
  )
}
