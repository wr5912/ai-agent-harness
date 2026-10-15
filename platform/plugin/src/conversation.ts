import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

export function prepareConversation(layout: ILayout) {
  // 保留原生工作区分组和侧栏折叠偏好，只切回当前会话面板。
  if (layout.panelInfo.getSnapshot().activePanelId !== null) layout.selectPanel(null)
}
