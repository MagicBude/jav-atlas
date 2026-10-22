/** @file 统一头像尺寸并处理404；头像加载失败不影响人物身份、收藏或资料访问。 */
import { useState } from 'react'
import { asset } from '../data/repository'
export function PersonAvatar({
  file,
  name,
  large = false
}: {
  file: string | null
  name: string
  large?: boolean
}) {
  // 只记住失败的文件，而非永久失败状态。切换人物或更新图片后，新文件仍应尝试加载。
  const [failedFile, setFailedFile] = useState<string | null>(null)
  return (
    <div className={`avatar ${large ? 'large' : ''}`}>
      {file && file !== failedFile ? (
        <img
          src={asset(file)}
          loading="lazy"
          width={large ? 112 : 64}
          height={large ? 140 : 80}
          alt={`${name}的头像`}
          onError={() => setFailedFile(file)}
        />
      ) : (
        <span aria-label="暂无可用头像">{name?.slice(0, 1) || '人'}</span>
      )}
    </div>
  )
}
