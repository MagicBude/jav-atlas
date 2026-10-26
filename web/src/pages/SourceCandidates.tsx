/**
 * 候选核实记录与已接入来源严格分开：有文档不等于有数据，能访问不等于可采集。
 * 这里只展示筛选依据；不会注册采集器、生成详情地址或增加外站主页导航。
 */
import audit from '../data/source-candidates.json'
export function SourceCandidates() {
  return (
    <section className="source-candidates" aria-label="候选资料来源">
      <h2>候选资料来源</h2>
      <p className="muted">
        首批整理 {audit.candidates.length} 个候选，尚未接入。核实日期：{audit.checkedOn}
        。结论是当次观察，不是实时可用性检测。
      </p>
      <p className="small muted">
        {audit.scope}。{audit.notes}
      </p>
      {audit.candidates.map(candidate => (
        <details className="source-candidate" key={candidate.id}>
          <summary>
            <strong>{candidate.name}</strong>
            <span className="small muted">{candidate.status}</span>
          </summary>
          <div className="source-candidate-body">
            <p>
              <strong>核实依据：</strong>
              {candidate.basis}
            </p>
            <p>
              <strong>可能补充：</strong>
              {candidate.potential}
            </p>
            <ul>
              {candidate.observations.map(observation => (
                <li key={observation}>{observation}</li>
              ))}
            </ul>
            <p>
              <strong>未确认：</strong>
              {candidate.blockers}
            </p>
            <p>
              <strong>下一步：</strong>
              {candidate.next}
            </p>
            {!!candidate.evidence.length && (
              <p className="source-evidence">
                {candidate.evidence.map(item => (
                  <a key={item.url} href={item.url} target="_blank" rel="noopener noreferrer">
                    {item.label} ↗
                  </a>
                ))}
              </p>
            )}
          </div>
        </details>
      ))}
    </section>
  )
}
