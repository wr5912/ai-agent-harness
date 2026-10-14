import type { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import type { ILayout } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'

export async function startConversation(ctx: Pick<Context, 'workspaces' | 'uiWorkspace' | 'sessions' | 'conversation'>, root: string, prompt: string) {
  const workspace = await ctx.workspaces.create({ path: root })
  await ctx.uiWorkspace.openWorkspace(workspace.workspaceId, sessionId => {
    const binding = ctx.sessions.binding(sessionId)
    if (!binding) throw new Error('DSH 会话尚未就绪，请重试。')
    const input = ctx.conversation.input
    if (input.requestDraftInitialization(binding, { prompt }) !== 'applied') throw new Error('会话已有草稿或正在发送，请在管理对话中继续。')
    input.for(binding.ctx).submit(undefined, 'click')
  })
}

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
