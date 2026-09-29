import assert from 'node:assert/strict'
import { test } from 'node:test'

test('EXP-007 系统消息从输入状态读取排队消息', async () => {
  let plugin
  let panel
  globalThis.window = { __ModuleLoader__: { load: value => { plugin = value } } }
  globalThis.document = {
    createElement: () => ({ dataset: {}, remove() {} }),
    head: { appendChild() {} },
  }
  try {
    await import('../../evolution/experiments/EXP-security-operations-expert-007/candidate/dsh/managed/security-operations-ui/client.js')
    const { apply } = plugin.factory(name => {
      assert.equal(name, 'react')
      return { createElement: (type, props, ...children) => ({ type, props, children }) }
    })
    apply({
      effect: run => run(),
      sidebarRightTabs: { register() {} },
      sidebarRight: { openTab() {} },
      slots: {
        inject: (_name, run) => run(),
        register: (options, component) => {
          if (options.name === 'sidebar.right.pane.tab') panel = component
        },
      },
    })
    const session = {
      pendingSubmissions: [{}], running: false, promptAttempted: false,
      awaitingFirstTurn: false, lastAgentError: null, promptError: null, openError: null,
    }
    const view = panel({
      useSession: selector => selector(session),
      useInput: selector => selector({ queue: [{}] }),
    })
    assert.equal(view.children[2].children[0], '当前会话有 2 项待处理消息。')
  } finally {
    delete globalThis.window
    delete globalThis.document
  }
})
