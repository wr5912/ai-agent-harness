export const assistantTheme = `
.harness-operation-inline{font-size:13px;line-height:1.6;overflow-wrap:anywhere}
.harness-operation-inline>.harness-operation-result{margin:4px 0}
.harness-operation-inline summary{cursor:pointer;color:#52657c}
.harness-operation-inline summary strong{font-weight:500}
.harness-operation-inline [role=alert]{color:#b42318}
.harness-confirmation-summary p{margin:6px 0;line-height:1.6}
.harness-confirmation-summary small{display:block;line-height:1.5}
.harness-confirmation-summary>details{margin-top:8px}
.harness-confirmation-actions{position:sticky;bottom:0;display:flex;flex-wrap:wrap;gap:8px;padding:10px 0 2px;background:#f8fbff}
.harness-confirmation-actions .harness-primary{background:#006eff;color:white;border-color:#006eff}
.harness-assistant-proposals-dock .harness-assistant-proposals{max-height:clamp(180px,calc(100dvh - var(--harness-conversation-top,160px) - 190px),520px)}
.harness-assistant-floating .harness-assistant-proposals{max-height:min(420px,calc(100dvh - 270px))}
@media(max-width:680px){.harness-assistant-proposals-dock .harness-assistant-proposals{padding:8px}.harness-assistant-proposals .harness-operation-card{margin:6px 0;padding:10px}.harness-assistant-proposals .harness-operation-card header{gap:6px}.harness-confirmation-budget{padding:6px 8px;background:#edf5ff;border-radius:6px}.harness-confirmation-actions{padding-top:8px}}
.harness-platform button.harness-assistant-toggle{position:fixed;right:24px;bottom:22px;z-index:45;display:grid;place-items:center;width:60px;height:60px;padding:0;border:1px solid #c7e0f8;border-radius:20px;background:linear-gradient(145deg,#fff,#edf8ff);color:#0075ca;box-shadow:0 8px 26px #174c8b24,0 2px 6px #174c8b0d;transition:transform .18s,box-shadow .18s,border-color .18s}
.harness-assistant-icon{display:block;width:44px;height:44px;pointer-events:none}
.harness-platform button.harness-assistant-toggle:hover:enabled{transform:translateY(-2px);border-color:#8acaf2;background:linear-gradient(145deg,#fff,#e5f5ff);box-shadow:0 10px 30px #174c8b30,0 2px 6px #174c8b0d}
.harness-platform button.harness-assistant-toggle[aria-expanded=true]{border-color:#8acaf2;box-shadow:0 0 0 3px #2ec5ff1f,0 8px 26px #174c8b24}
.harness-assistant-toggle[data-status]::after{content:"";position:absolute;right:3px;bottom:3px;width:10px;height:10px;border:2px solid #fff;border-radius:50%;background:#0075ca}
.harness-assistant-toggle[data-status=waiting]::after{background:#eaa127}
.harness-assistant-toggle[data-status=unread]::after{background:#10b5ce}
@media(prefers-reduced-motion:reduce){.harness-platform button.harness-assistant-toggle{transition:none}.harness-platform button.harness-assistant-toggle:hover:enabled{transform:none}}
.harness-assistant{z-index:44;display:flex;flex-direction:column;min-height:0;background:#fff;border:1px solid #d5e0ee;border-radius:14px;box-shadow:0 12px 48px #12396326;overflow:hidden;--dsh-composer-card-max-width:100%;--dsh-conversation-content-max-width:100%}
.harness-assistant-floating{position:fixed;right:24px;bottom:88px;width:480px;height:min(640px,calc(100dvh - 112px));max-width:calc(100vw - 32px)}
.harness-assistant-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;background:#f7faff;border-bottom:1px solid #e3ebf5;flex-shrink:0}
.harness-assistant-heading>div{display:flex;align-items:center;gap:6px}
.harness-assistant-heading>div:first-child{align-items:flex-start;flex-direction:column}
.harness-assistant-heading small{color:#71829b;font-size:11px}
.harness-assistant-heading button{font-size:12px;padding:6px 8px}
.harness-assistant-workspace{display:flex;flex:1;min-height:0;min-width:0}
.harness-assistant-chat{flex:1;min-height:0;min-width:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary,#223550)}
.harness-assistant-chat>[data-conversation-content]{flex:1;min-height:0}
.harness-assistant-empty{margin:auto;text-align:center;padding:24px;max-width:100%}
.harness-assistant-empty p{color:#728299}
.harness-assistant-scope{margin:0;padding:8px 14px;border-bottom:1px solid #e3ebf5;color:#71829b;font-size:12px}
.harness-assistant-error{margin:0;padding:8px 14px;border-bottom:1px solid #f2dddd;background:#fff8f8;font-size:12px}
.harness-assistant-proposals-dock{box-sizing:border-box;width:100%;min-width:0;flex:none;padding-inline:calc(var(--dsh-composer-side-clearance) + 16px)}
.harness-assistant-proposals{box-sizing:border-box;width:100%;min-width:0;max-width:var(--dsh-chat-content-width);margin:0 auto;font-size:12px;max-height:260px;overflow:auto;border:1px solid #d9e6f6;border-radius:9px;background:#f8fbff;padding:8px 10px}
.harness-assistant-proposals>summary{cursor:pointer;color:#345071}
.harness-operation-card button{padding:8px 12px;border:1px solid #dce6f2;border-radius:7px;cursor:pointer}
.harness-operation-card{padding:14px;margin:8px 0;border:1px solid #d9e6f6;border-radius:9px;background:#f8fbff;font-size:13px;overflow-wrap:anywhere}
.harness-operation-card header{display:flex;justify-content:space-between;gap:12px}
.harness-operation-card header>span{color:#728299}
.harness-fusion-confirmation h4{margin:12px 0 6px}
.harness-fusion-confirmation p{margin:5px 0}
.harness-fusion-confirmation small{display:block;color:#728299;overflow-wrap:anywhere}
.harness-operation-result{margin:10px 0}
.harness-operation-result>summary{cursor:pointer}
.harness-operation-state{font-weight:500}
.harness-operation-card dl{margin:8px 0}
.harness-operation-card dl>div{display:grid;grid-template-columns:minmax(70px,auto) minmax(0,1fr);gap:10px;margin:6px 0}
.harness-operation-card dt{color:#728299}
.harness-operation-card dd{margin:0;min-width:0}
.harness-operation-card ul{margin:4px 0;padding-left:18px}
.harness-operation-card [role=alert]{margin-bottom:0}
.harness-assistant-chat [data-slot="conversation.hero.agentPreset"],.harness-assistant-chat [class$="_heroWorkspaceRow"]{display:none}
.harness-assistant-chat [class$="_titleGroup"]{display:none}
.harness-assistant-chat [class$="_headline"]{font-size:20px}
.harness-conversation-frame{box-sizing:border-box;padding-top:var(--harness-conversation-top);padding-left:var(--harness-conversation-left)}
.harness-platform[data-page=conversations] .harness-assistant-toggle{pointer-events:auto}
.harness-conversation-viewport{flex:1;min-height:0}
.harness-conversation-frame [class$="_titleGroup"],.harness-conversation-frame [class$="_panelList"],.harness-conversation-frame [class$="_heroWorkspaceRow"]{display:none}
.harness-conversation-frame [class$="_logoRow"]{display:contents}
.harness-conversation-frame [class$="_logoRow"] [class*="_brand"]{display:none}
.harness-conversation-frame [class$="_toggle"] [class$="_railMark"]{display:none}
.harness-conversation-frame [class$="_toggle"] [class$="_panelIcon"]{display:inline}
.harness-assistant-chat .harness-conversation-welcome{font-size:17px;flex-direction:column}
.harness-assistant-chat button,.harness-assistant-chat input,.harness-assistant-chat textarea{font:inherit}
@media(max-width:580px){.harness-assistant-floating{right:8px;bottom:76px;max-width:calc(100vw - 16px);width:calc(100vw - 16px);height:calc(100dvh - 92px)}.harness-platform button.harness-assistant-toggle{right:12px;bottom:12px;width:54px;height:54px;border-radius:18px}.harness-assistant-icon{width:40px;height:40px}.harness-assistant-heading{padding:10px}.harness-assistant-heading strong{font-size:13px}}
.harness-conversation-welcome{display:inline-flex;align-items:center;gap:12px;color:#223550;font-size:24px}
`
