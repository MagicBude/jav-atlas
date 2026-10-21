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
    if (u.pathname === '/actress_list.php') {
      const page = Number(u.searchParams.get('page') || 1)
      if (process.env.FIXTURE_DIRECTORY_FAIL === String(page))
        return new Response('<html>blocked</html>')
      const id = page === 1 ? '123' : '456'
      return new Response(
        `<span class='page_info'>${page} / 2 ページ (2件)</span><table><tr><td><a href="actress${id}.html"><img src="p_actress_125_125/123/${id}.jpg"></a></td><td class="details"><h2 class="ttl"><a href="actress${id}.html">${page === 1 ? 'Test Actor' : 'Second Actor'}</a></h2></td><td>42</td></tr></table>`
      )
    }
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
  if (u.hostname === 'tp.spfcas.com' && u.pathname === '/actor1.jpg') return new Response(jpeg)
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
      if (process.env.FIXTURE_REVERSE === '1' && id === 'actor1')
        await new Promise(resolve => setTimeout(resolve, 25))
      data = {
        actor: { id, name: id === 'actor1' ? 'Test Actor' : 'Unknown Actor', videos_count: 42 }
      }
      if (process.env.FIXTURE_AVATAR === '1' && id === 'actor1')
        data.actor.avatar_url = 'https://tp.spfcas.com/actor1.jpg'
    } else if (u.pathname.includes('/v2/search'))
      data = {
        actors:
          process.env.FIXTURE_MALE === '1' ? [{ id: 'actor1', name: u.searchParams.get('q') }] : []
      }
    else throw new Error('未声明的 API fixture：' + url)
    return Response.json({ success: 1, data })
  }
  throw new Error('测试禁止访问未声明网络地址：' + url)
}

// 网页复核调用系统 curl；测试只替换此进程边界，不访问实际网站。
if (process.env.FIXTURE_GENDER_HTML) {
  require('child_process').execSync = () => process.env.FIXTURE_GENDER_HTML
}
// 批量复核工具的 curl 边界：按人物 ID 返回固定网页，不接触代理或外网。
if (process.env.FIXTURE_WEB_PROBE) {
  const attempted = new Set()
  const mock = () => {
    throw new Error('请通过 promisify 调用测试 curl')
  }
  mock[require('util').promisify.custom] = async (_file, args) => {
    const url = args[args.length - 1]
    const id = new URL(url).pathname.split('/').pop()
    if (process.env.FIXTURE_WEB_TLS_RETRY && !attempted.has(id)) {
      attempted.add(id)
      throw Object.assign(new Error('TLS handshake failed'), { code: 35 })
    }
    await new Promise(resolve => setTimeout(resolve, 5))
    const html =
      process.env.FIXTURE_WEB_PROBE === 'blocked'
        ? '<html>Access denied</html>'
        : `<title>Test | JavDB</title><span class="section-meta">${id === 'actor2' ? '男優, ' : ''}42 部影片</span>`
    return { stdout: html + '\nEFFECTIVE_URL:' + url, stderr: '' }
  }
  require('child_process').execFile = mock
}

// 目录 curl 通过同一合成 fetch 数据源验证，禁止测试触网。
if (!process.env.FIXTURE_WEB_PROBE) {
  const mock = () => {
    throw new Error('测试仅支持异步 curl')
  }
  mock[require('util').promisify.custom] = async (_file, args) => {
    const url = args[args.length - 1]
    if (new URL(url).pathname !== '/actress_list.php') throw new Error('测试未声明 curl URL')
    return { stdout: await (await global.fetch(url)).text(), stderr: '' }
  }
  require('child_process').execFile = mock
}
