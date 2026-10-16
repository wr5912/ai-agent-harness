// 仅保留 DSH 0.2.1-alpha.2 已验收的原生布局适配；不在页面样式中新增内部类名依赖。
export const nativeConversationCompatibility = `
.harness-assistant-chat [data-slot="conversation.hero.agentPreset"],.harness-assistant-chat [class$="_heroWorkspaceRow"]{display:none}
.harness-assistant-chat [class$="_titleGroup"]{display:none}
.harness-assistant-chat [class$="_headline"]{font-size:20px}
.harness-conversation-frame [class$="_titleGroup"],.harness-conversation-frame [class$="_panelList"],.harness-conversation-frame [class$="_heroWorkspaceRow"]{display:none}
.harness-conversation-frame [class$="_logoRow"]{display:contents}
.harness-conversation-frame [class$="_logoRow"] [class*="_brand"]{display:none}
.harness-conversation-frame [class$="_toggle"] [class$="_railMark"]{display:none}
.harness-conversation-frame [class$="_toggle"] [class$="_panelIcon"]{display:inline}
`
