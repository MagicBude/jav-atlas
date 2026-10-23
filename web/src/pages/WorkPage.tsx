/** 独立作品地址没有可信背景时，明确返回作品库；不猜测用户来源历史。 */
import { Link, useParams } from 'react-router-dom'
import { WorkDetail } from '../features/works/WorkDetail'
export default function WorkPage() {
  const { id = '' } = useParams()
  return (
    <main className="person-detail">
      <Link to="/works">‹ 返回作品库</Link>
      {/^\d+$/.test(id) ? <WorkDetail id={id} /> : <h1>作品地址无效</h1>}
    </main>
  )
}
