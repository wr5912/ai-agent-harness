import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

export function initializeConversationLayout(layout: ILayout, viewportWidth: number) {
  // 窄屏由 DSH 默认折叠；宽屏仅在客户端初始化时收起，后续由用户切换。
  if (viewportWidth >= 1024) layout.toggleSidebar()
}

export function prepareConversation(layout: ILayout) {
  // 保留原生工作区分组和侧栏折叠偏好，只切回当前会话面板。
  if (layout.panelInfo.getSnapshot().activePanelId !== null) layout.selectPanel(null)
}
