/** 只做静态语法检查，不加载采集器，避免检查时意外联网或写数据。 */
const fs = require('fs')
const path = require('path')
const { spawnSync } = require('child_process')
function check(dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, item.name)
    if (item.isDirectory()) check(file)
    else if (file.endsWith('.js')) {
      const result = spawnSync(process.execPath, ['--check', file], { stdio: 'inherit' })
      if (result.status !== 0) process.exit(result.status || 1)
    }
  }
}
check(__dirname)
check(path.join(__dirname, '..', 'tests'))
console.log('脚本语法检查通过')
