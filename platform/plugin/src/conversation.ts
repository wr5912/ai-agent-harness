import type { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'

export function prepareConversation(slots: Pick<SlotCore, 'entries'>, layout: ILayout) {
  // 原生 root 与 workspace 注册的 create() 返回同一共享实例，不另建状态副本。
  const root = slots.entries('root').find(entry => entry.store)?.store as unknown as {
    create(): { getSnapshot(): { layoutInfo: { sidebar: number; viewportWidth: number; narrowExpanded: boolean } } }
  }
  const workspace = slots.entries('sidebar.workspaces').find(entry => entry.store)?.store as unknown as {
    create(): { actions: { setGroupBy(mode: 'flat'): void } }
  }
  if (!root?.create || !workspace?.create) throw new Error('DSH 会话布局尚未就绪，请稍后重试。')
  const { sidebar, viewportWidth, narrowExpanded } = root.create().getSnapshot().layoutInfo
  if (viewportWidth < 1024 ? narrowExpanded : sidebar !== 0) layout.toggleSidebar()
  workspace.create().actions.setGroupBy('flat')
  if (layout.panelInfo.getSnapshot().activePanelId !== null) layout.selectPanel(null)
}
