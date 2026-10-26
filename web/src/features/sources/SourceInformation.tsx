/** 数据说明中的采集来源信息；网站收录和采集接入不在同一个层级。 */
import { dataSources } from '../../entities/dataSources'
import './sources.css'
export function SourceInformation() {
  return (
    <section aria-label="采集来源说明">
      <p className="muted">
        目前接入 {dataSources.length}{' '}
        个资料来源。以下是可提供的字段，不代表每个人物或每部作品都已补齐。
      </p>
      <div className="source-cards">
        {dataSources.map(source => (
          <article className="source-card" key={source.id}>
            <header>
              <h2>{source.name}</h2>
              <p className="small muted">{source.integration}</p>
            </header>
            <div className="source-capabilities">
              <section>
                <h3>人物资料</h3>
                <ul>
                  {source.personFields.map(field => (
                    <li key={field}>{field}</li>
                  ))}
                </ul>
              </section>
              <section>
                <h3>作品资料</h3>
                <ul>
                  {source.workFields.map(field => (
                    <li key={field}>{field}</li>
                  ))}
                </ul>
              </section>
            </div>
            <dl>
              <div>
                <dt>更新方式</dt>
                <dd>{source.update}</dd>
              </div>
              <div>
                <dt>已知范围</dt>
                <dd>{source.limitations}</dd>
              </div>
            </dl>
          </article>
        ))}
      </div>
      <p>
        人物和作品详情中的来源入口对应各站原生
        ID；同名人物或相同番号不自动视为同一条记录。作品只有通过精确匹配，才提供对应的 JavDB
        详情入口。
      </p>
      <p>
        作品扩展字段优先使用 JavDB，缺失时使用 minnano 已有资料；标题与主演员列表沿用
        minnano。来源冲突和原始记录在作品详情底部保留。
      </p>
      <p className="muted">“已接入”表示本项目已有采集或展示能力，不代表刚刚检查过外站连通性。</p>
    </section>
  )
}
