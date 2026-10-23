/** JavDB移动端共用线路和应用签名；不使用用户登录凭据。 */
const crypto = require('crypto')
/*
 * JavDB 移动端 API：候选线路共享应用级签名算法，不使用用户账号或登录 token。
 */
const JDB_LINES = [
  'https://apidd.spthgb.com',
  'https://apidd.czssdgz.com',
  'https://jdforrepam.com'
]
const JDB_P1 =
  '71cf27bb3c0bcdf207b64abecddc970098c7421ee7203b9cdae54478478a199e7d5a6e1a57691123c1a931c057842fb73ba3b3c83bcd69c17ccf174081e3d8aa'
const JDB_P2 = 'lpw6vgqzsp'

/**
 * 构造当前请求的应用签名。时间戳单位是秒；MD5 输入为时间戳字符串与固定常量拼接。
 *
 * @returns {string} 格式为 时间戳.固定标记.MD5十六进制摘要。
 */
function jdbSign() {
  const ts = Math.floor(Date.now() / 1000)
  return (
    ts +
    '.' +
    JDB_P2 +
    '.' +
    crypto
      .createHash('md5')
      .update(String(ts) + JDB_P1)
      .digest('hex')
  )
}

module.exports = { JDB_LINES, jdbSign }
