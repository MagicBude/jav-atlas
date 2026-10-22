/** @file 使用浏览器原生 dialog 获得焦点约束和背景 inert；业务仍决定是否允许关闭。 */
import { useEffect, useRef, type ReactNode } from 'react'
// 抽屉上还可能出现“未保存”确认框，二者不能各自恢复 overflow。
// 计数归零才释放滚动，避免按卸载顺序把已经关闭的页面永久锁住。
let lockCount = 0
let originalOverflow = ''
export function Modal({
  children,
  close,
  drawer = false,
  title
}: {
  children: ReactNode
  close: () => void
  drawer?: boolean
  title: string
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const dialog = ref.current!,
      previous = document.activeElement as HTMLElement | null
    if (lockCount++ === 0) {
      originalOverflow = document.body.style.overflow
      document.body.style.overflow = 'hidden'
    }
    dialog.showModal()
    return () => {
      dialog.close()
      if (--lockCount === 0) document.body.style.overflow = originalOverflow
      previous?.focus({ preventScroll: true })
    }
  }, [])
  return (
    <dialog
      ref={ref}
      className={drawer ? 'drawer' : 'modal'}
      aria-label={title}
      onCancel={event => {
        event.preventDefault()
        close()
      }}
      onClick={event => {
        const rect = ref.current!.getBoundingClientRect()
        if (
          event.target === ref.current &&
          (event.clientX < rect.left ||
            event.clientX > rect.right ||
            event.clientY < rect.top ||
            event.clientY > rect.bottom)
        )
          close()
      }}
    >
      {children}
    </dialog>
  )
}
