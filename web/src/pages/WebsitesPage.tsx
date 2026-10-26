/** 网站目录整理站点用途；采集能力说明单独放入数据页，避免收录即接入的误解。 */
import { Link } from 'react-router-dom'
import { dataSources } from '../entities/dataSources'
import { SourceCandidates } from './SourceCandidates'
import '../features/sources/sources.css'
export default function WebsitesPage() {
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
      <section aria-label="现有资料站点">
        <h2>现有资料站点</h2>
        <div className="website-cards">
          {dataSources.map(source => (
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
      <SourceCandidates />
    </main>
  )
}
