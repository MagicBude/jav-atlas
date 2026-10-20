/** 合成 HTTP 响应只用于离线测试；未知地址立即报错，不向外部网络回退。 */
const jpeg = Buffer.alloc(4096)
jpeg[0] = 0xff
jpeg[1] = 0xd8
const row =
  '<tr><td class="rnkno"><span class="rnkcnt">1</span></td><h3 class="ttl"><a href="actress123.html">Test Actor</a></h3><td>42</td></tr>'
const profile =
  '<meta property="og:title" content="Test Actor AV女優"><meta property="og:image" content="images/test.jpg"><td><span>生年月日</span>2000年1月2日</td><td><span>愛称</span>Test</td>'
global.fetch = async (url, options) => {
  const u = new URL(url)
  if (process.env.FIXTURE_FAIL === 'all') throw new Error('offline: total failure')
  if (u.hostname === 'www.minnano-av.com') {
    if (process.env.FIXTURE_FAIL === 'minnano') throw new Error('offline: minnano failure')
    if (u.pathname.includes('ranking_actress'))
      return new Response(
        process.env.FIXTURE_FAIL === 'rank-empty'
          ? '<html>blocked</html>'
          : row.replaceAll('h3', process.env.FIXTURE_RANK_TAG || 'h3')
      )
    if (u.pathname === '/actress123.html')
      return new Response(
        process.env.FIXTURE_FAIL === 'profile-empty' ? '<html>blocked</html>' : profile
      )
    if (u.pathname === '/images/test.jpg') return new Response(jpeg)
    throw new Error('未声明的 minnano fixture：' + url)
  }
  if (u.pathname.startsWith('/api/')) {
    if (process.env.FIXTURE_FAIL === 'javdb') throw new Error('offline: javdb failure')
    if (process.env.FIXTURE_FAIL === 'second-dimension' && u.searchParams.get('type') === '0')
      throw new Error('offline: second dimension failed')
    if (!options.headers.jdsignature) throw new Error('fixture: missing signature')
    let data
    if (u.pathname.includes('/movies/latest')) data = { movies: [{ id: 'movie1' }] }
    else if (u.pathname.includes('/v2/movies/'))
      data = {
        movie: {
          number: 'N-001',
          actors: [
            { id: 'actor1', name: 'Test Actor' },
            { id: 'actor2', name: 'Unknown Actor' }
          ]
        }
      }
    else if (u.pathname.includes('/v1/actors/')) {
      if (process.env.FIXTURE_FAIL === 'actor-detail')
        throw new Error('offline: actor detail failure')
      const id = u.pathname.split('/').pop()
      data = {
        actor: { id, name: id === 'actor1' ? 'Test Actor' : 'Unknown Actor', videos_count: 42 }
      }
    } else if (u.pathname.includes('/v2/search')) data = { actors: [] }
    else throw new Error('未声明的 API fixture：' + url)
    return Response.json({ success: 1, data })
  }
  throw new Error('测试禁止访问未声明网络地址：' + url)
}
