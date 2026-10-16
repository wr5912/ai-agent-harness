// 原生会话仍由 DSH 渲染；这里只为平台整页与浮窗共用的公开 DOM 席位提供主题。
export const nativeConversationTheme = `
:is(.harness-conversation-frame,.harness-assistant-chat){
  --dsw-specific-sidebar-fill:var(--hep-surface);
  --dsw-specific-input-major:var(--hep-surface);
  --dsw-alias-button-info-fill:var(--hep-primary);
  --dsw-alias-button-info-hover:var(--hep-primary-hover);
  --dsw-alias-state-business-primary:var(--hep-link);
  --dsw-alias-state-business-tertiary:var(--hep-primary-soft);
  --dsw-radius-sm:var(--hep-control-radius);
  --dsw-radius-md:var(--hep-radius);
  --dsw-radius-lg:var(--hep-radius);
  --dsw-radius-xl:var(--hep-radius);
  --dsw-specific-bubble:var(--hep-primary-soft);
  --dsw-font-markdown-base:400 var(--dsh-content-font-size,14px)/1.7 var(--dsw-font-family);
  --dsw-font-markdown-base-strong:600 var(--dsh-content-font-size,14px)/1.7 var(--dsw-font-family);
  color:var(--hep-text);font-size:14px;line-height:1.6;
}
.harness-conversation-frame{background:var(--hep-bg)}
.harness-conversation-frame>:has(>[data-slot="sidebar"]){background:transparent;border-right:0}
.harness-conversation-frame>:has(>[data-slot="main"]){margin:16px var(--hep-page-padding) 24px 16px;border:1px solid var(--hep-border);border-radius:var(--hep-radius);background:var(--hep-surface)}
.harness-conversation-frame [data-slot="sidebar"]>div{background:var(--hep-surface)}
.harness-conversation-frame:not([data-sidebar-collapsed]) [data-slot="sidebar"]>div{box-sizing:border-box;margin:16px 0 24px 16px;width:calc(100% - 16px);max-width:calc(100% - 16px);height:calc(100% - 40px);border:1px solid var(--hep-border);border-radius:var(--hep-radius)}
.harness-conversation-frame[data-sidebar-collapsed] [data-slot="sidebar"]>div{border-right:1px solid var(--hep-border)}
:is(.harness-conversation-frame,.harness-assistant-chat) [data-conversation-content]{background:var(--hep-surface);color:var(--hep-text)}
:is(.harness-conversation-frame,.harness-assistant-chat) [data-slot="conversation.header"]>header{padding:12px 20px;border-bottom:1px solid var(--hep-border);background:var(--hep-surface);min-height:56px;gap:12px}
:is(.harness-conversation-frame,.harness-assistant-chat) [data-conversation-tabs]{gap:20px;padding:0 20px;border-color:var(--hep-border)}
:is(.harness-conversation-frame,.harness-assistant-chat) [data-conversation-tabs] [role="tab"]{min-height:max(40px,var(--hep-hit-target));padding:10px 0;font-size:14px;color:var(--hep-muted);transition:color var(--hep-motion-fast)}
:is(.harness-conversation-frame,.harness-assistant-chat) [data-conversation-tabs] [role="tab"][aria-selected=true]{color:var(--hep-link);font-weight:600}
:is(.harness-conversation-frame,.harness-assistant-chat) [data-conversation-tabs] [role="tab"][aria-selected=true]::after{background:var(--hep-primary)}
:is(.harness-conversation-frame,.harness-assistant-chat) [data-conversation-scroll]{scrollbar-width:thin;overscroll-behavior:contain}
:is(.harness-conversation-frame,.harness-assistant-chat) [data-composer-card]{border:1px solid var(--hep-border);border-radius:var(--hep-radius);background:var(--hep-surface);box-shadow:var(--hep-shadow);transition:border-color var(--hep-motion),box-shadow var(--hep-motion)}
:is(.harness-conversation-frame,.harness-assistant-chat) [data-composer-card]:focus-within{border-color:var(--hep-primary);box-shadow:0 0 0 3px var(--hep-primary-soft),var(--hep-shadow)}
:is(.harness-conversation-frame,.harness-assistant-chat) [data-composer-input]{font-size:var(--dsh-content-font-size,14px);line-height:1.7;color:var(--hep-text)}
:is(.harness-conversation-frame,.harness-assistant-chat) :where(button){border-radius:var(--hep-control-radius);transition:background-color var(--hep-motion-fast),border-color var(--hep-motion-fast),color var(--hep-motion-fast)}
/* 虚拟树的行高由原生布局管理，行内操作保持原尺寸。 */
:is(.harness-conversation-frame,.harness-assistant-chat) :where(button):not(:where([data-slot="sidebar.workspaces"] [role="treeitem"] button)){min-height:max(32px,var(--hep-hit-target))}
:is(.harness-conversation-frame,.harness-assistant-chat) [data-composer-card] :where(button){min-width:max(32px,var(--hep-hit-target));min-height:max(36px,var(--hep-hit-target))}
:is(.harness-conversation-frame,.harness-assistant-chat) :where(button,a,[tabindex="0"]):focus-visible{outline:2px solid var(--hep-primary);outline-offset:2px}
:is(.harness-conversation-frame,.harness-assistant-chat) a{color:var(--hep-link)}
:is(.harness-conversation-frame,.harness-assistant-chat) a:hover{color:var(--hep-link-hover)}
:is(.harness-conversation-frame,.harness-assistant-chat) [data-slot="sidebar.workspaces"]{font-size:13px;line-height:1.6}
:is(.harness-conversation-frame,.harness-assistant-chat) [data-slot="sidebar.workspaces"] [role="treeitem"][aria-selected=true]{color:var(--hep-link);background:var(--hep-primary-soft)}
:is(.harness-conversation-frame,.harness-assistant-chat) [data-tool]{--dsw-radius-lg:var(--hep-control-radius);--dsw-alias-markdown-code-block:var(--hep-surface-muted);--dsw-alias-border-l1:var(--hep-border)}
:is(.harness-conversation-frame,.harness-assistant-chat) [data-chat-node-key] pre{max-width:100%;max-height:420px;overflow:auto;scrollbar-width:thin;border-radius:var(--hep-control-radius)}
:is(.harness-conversation-frame,.harness-assistant-chat) [data-chat-node-key] div:has(>table){max-width:100%;overflow-x:auto;overscroll-behavior-x:contain;scrollbar-width:thin}
:is(.harness-conversation-frame,.harness-assistant-chat) [data-chat-node-key] table{width:max-content;max-width:none}
:is(.harness-conversation-frame,.harness-assistant-chat) [data-chat-node-key] :is(th,td){min-width:100px;max-width:320px;vertical-align:top}
.harness-conversation-frame .harness-conversation-welcome{font-size:24px;font-weight:600;line-height:1.4}
@media(max-width:900px){.harness-conversation-frame>:has(>[data-slot="main"]){margin-right:var(--hep-page-padding)}}
@media(max-width:680px){
  .harness-conversation-frame>:has(>[data-slot="main"]){margin:8px 8px 12px;border-radius:var(--hep-radius)}
  .harness-conversation-frame:not([data-sidebar-collapsed])>:has(>[data-slot="sidebar"]){position:absolute;top:calc(var(--harness-conversation-top) + 8px);left:8px;bottom:12px;width:min(280px,calc(100% - 64px));z-index:20;border-radius:var(--hep-radius);box-shadow:0 12px 40px #10283e38}
  .harness-conversation-frame:not([data-sidebar-collapsed]) [data-slot="sidebar"]>div{margin:0;width:100%;max-width:100%;height:100%;border-radius:var(--hep-radius)}
  .harness-conversation-frame:not([data-sidebar-collapsed])>:has(>[data-slot="main"]){grid-column:1 / 3;margin-left:64px}
  .harness-conversation-frame [data-side="sidebar"]{display:none}
  :is(.harness-conversation-frame,.harness-assistant-chat) [data-slot="conversation.header"]>header{padding:8px 12px;gap:8px}
  :is(.harness-conversation-frame,.harness-assistant-chat) [data-conversation-tabs]{padding:0 12px;gap:16px}
  .harness-conversation-frame .harness-conversation-welcome{font-size:20px}
}
@media(pointer:coarse){
  :is(.harness-conversation-frame,.harness-assistant-chat) :where(button,[role="tab"]):not(:where([data-slot="sidebar.workspaces"] [role="treeitem"] button)){min-width:44px;min-height:44px}
}
@media(prefers-reduced-motion:reduce){
  :is(.harness-conversation-frame,.harness-assistant-chat) :where(button,[data-composer-card]){transition:none}
}
`
