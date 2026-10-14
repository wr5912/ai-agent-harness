import assert from 'node:assert/strict'
import test from 'node:test'
import { prepareConversation } from '../src/conversation.ts'

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
