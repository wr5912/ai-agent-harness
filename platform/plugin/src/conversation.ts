import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

export function prepareConversation(layout: ILayout, sidebarCollapsed?: boolean) {
  // 首次进入或首页新任务按原生实际状态收起；普通导航保留用户选择。
  if (sidebarCollapsed === false) layout.toggleSidebar()
  if (layout.panelInfo.getSnapshot().activePanelId !== null) layout.selectPanel(null)
}
