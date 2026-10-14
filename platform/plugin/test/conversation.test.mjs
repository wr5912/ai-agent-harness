import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareConversation, startConversation } from '../src/conversation.ts'

test('首页发送复用项目工作区与原生提交，只提交新草稿，初始化失败不发送', async () => {
  for (const result of ['applied', 'preserved', 'blocked', 'missing']) {
    const calls = []
    const binding = { ctx: { session: 'target' } }
    const ctx = {
      workspaces: { create: async request => { calls.push(request); return { workspaceId: 'project' } } },
      uiWorkspace: { openWorkspace: async (id, beforeOpen) => { calls.push(id); beforeOpen('target') } },
      sessions: { binding: id => { assert.equal(id, 'target'); return result === 'missing' ? undefined : binding } },
      conversation: { input: {
        requestDraftInitialization: (target, options) => { assert.equal(target, binding); calls.push(options); return result },
        for: scope => { assert.equal(scope, binding.ctx); return { submit: (...args) => calls.push(args) } },
      } },
    }
    if (result === 'applied') {
      await startConversation(ctx, '/repo', '你好')
      assert.deepEqual(calls, [{ path: '/repo' }, 'project', { prompt: '你好' }, [undefined, 'click']])
    } else {
      await assert.rejects(startConversation(ctx, '/repo', '你好'), /草稿|尚未就绪/)
      assert.equal(calls.some(Array.isArray), false)
    }
  }
  await assert.rejects(startConversation({ workspaces: { create: async () => { throw new Error('离线') } } }, '/repo', '你好'), /离线/)
})

test('进入对话使用原生共享状态：桌面与窄屏默认收起、单列表，保留已选会话', () => {
  for (const [viewportWidth, sidebar, narrowExpanded, activePanelId, toggles] of [
    [1440, 280, false, null, 1], [1440, 0, false, null, 0],
    [900, 280, true, 'settings', 1], [390, 280, false, null, 0],
  ]) {
    const calls = []
    const root = { getSnapshot: () => ({ layoutInfo: { viewportWidth, sidebar, narrowExpanded } }) }
    const workspace = { actions: { setGroupBy: mode => calls.push(mode) } }
    const slots = { entries: name => [{ store: { create: () => name === 'root' ? root : workspace } }] }
    const layout = { panelInfo: { getSnapshot: () => ({ activePanelId }) },
      toggleSidebar: () => calls.push('toggle'), selectPanel: id => calls.push(id) }
    prepareConversation(slots, layout)
    assert.deepEqual(calls, [...Array(toggles).fill('toggle'), 'flat', ...(activePanelId === null ? [] : [null])])
  }
  assert.throws(() => prepareConversation({ entries: () => [] }, {}), /尚未就绪/)
})
