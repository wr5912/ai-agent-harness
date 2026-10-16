import { nativeConversationCompatibility } from './native-compat.ts'

export const assistantTheme = `${nativeConversationCompatibility}
.harness-operation-inline{font-size:14px;line-height:1.7;overflow-wrap:anywhere}
.harness-operation-inline>.harness-operation-result{margin:4px 0}
.harness-operation-inline summary{cursor:pointer;color:var(--hep-muted)}
.harness-operation-inline summary strong{font-weight:500}
.harness-operation-inline [role=alert]{color:#b42318}
.harness-confirmation-summary p{margin:6px 0;line-height:1.6}
.harness-confirmation-summary small{display:block;line-height:1.5}
.harness-confirmation-summary>details{margin-top:8px}
.harness-confirmation-actions{position:sticky;bottom:0;z-index:1;display:flex;flex-wrap:wrap;gap:8px;margin-top:16px;border-top:1px solid var(--hep-border);padding:12px 0 2px;background:var(--hep-surface)}
.harness-confirmation-actions .harness-primary{background:var(--hep-primary);color:#fff;border-color:var(--hep-primary)}
.harness-assistant-proposals-dock .harness-assistant-proposals{max-height:clamp(180px,calc(100dvh - var(--harness-conversation-top,160px) - 190px),520px)}
.harness-assistant-floating .harness-assistant-proposals{max-height:min(420px,calc(100dvh - 270px))}
@media(max-width:680px){.harness-assistant-proposals-dock .harness-assistant-proposals{padding:8px}.harness-assistant-proposals .harness-operation-card{margin:6px 0;padding:10px}.harness-assistant-proposals .harness-operation-card header{gap:6px}.harness-confirmation-budget{padding:6px 8px;background:var(--hep-primary-soft);border-radius:6px}.harness-confirmation-actions{padding-top:8px}}
.harness-platform button.harness-assistant-toggle{position:fixed;right:24px;bottom:22px;z-index:45;display:grid;place-items:center;width:60px;height:60px;padding:0;border:1px solid #c7e0f8;border-radius:20px;background:var(--hep-surface);color:var(--hep-primary);box-shadow:0 8px 26px #174c8b24,0 2px 6px #174c8b0d;transition:transform var(--hep-motion) var(--hep-ease),box-shadow var(--hep-motion),border-color var(--hep-motion)}
.harness-assistant-icon{display:block;width:44px;height:44px;pointer-events:none}
.harness-platform button.harness-assistant-toggle:hover:enabled{transform:translateY(-2px);border-color:#8acaf2;background:var(--hep-primary-soft);box-shadow:0 10px 30px #174c8b30,0 2px 6px #174c8b0d}
.harness-platform button.harness-assistant-toggle[aria-expanded=true]{border-color:#8acaf2;box-shadow:0 0 0 3px #2ec5ff1f,0 8px 26px #174c8b24}
.harness-assistant-toggle[data-status]::after{content:"";position:absolute;right:3px;bottom:3px;width:10px;height:10px;border:2px solid var(--hep-surface);border-radius:50%;background:var(--hep-primary)}
.harness-assistant-toggle[data-status=waiting]::after{background:#eaa127}
.harness-assistant-toggle[data-status=unread]::after{background:#10b5ce}
@media(prefers-reduced-motion:reduce){.harness-platform button.harness-assistant-toggle{transition:none}.harness-platform button.harness-assistant-toggle:hover:enabled{transform:none}}
.harness-assistant{z-index:44;display:flex;flex-direction:column;min-height:0;background:var(--hep-surface);border:1px solid var(--hep-border);border-radius:14px;box-shadow:0 12px 48px #12396326;overflow:hidden;--dsh-composer-card-max-width:100%;--dsh-conversation-content-max-width:100%}
.harness-assistant-floating{position:fixed;right:24px;bottom:88px;width:480px;height:min(640px,calc(100dvh - 112px));max-width:calc(100vw - 32px)}
.harness-assistant-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:12px 14px;background:var(--hep-surface-muted);border-bottom:1px solid var(--hep-border);flex-shrink:0}
.harness-assistant-heading>div{display:flex;align-items:center;gap:6px}
.harness-assistant-heading>div:first-child{align-items:flex-start;flex-direction:column}
.harness-assistant-heading small{color:var(--hep-muted);font-size:12px}
.harness-assistant-heading button{font-size:12px;padding:6px 8px}
.harness-assistant-workspace{display:flex;flex:1;min-height:0;min-width:0}
.harness-assistant-chat{flex:1;min-height:0;min-width:0;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary,var(--hep-text))}
.harness-assistant-chat>[data-conversation-content]{flex:1;min-height:0}
.harness-assistant-empty{margin:auto;text-align:center;padding:24px;max-width:100%}
.harness-assistant-empty p{color:var(--hep-muted)}
.harness-assistant-scope{margin:0;padding:8px 14px;border-bottom:1px solid var(--hep-border);color:var(--hep-muted);font-size:12px}
.harness-assistant-error{margin:0;padding:8px 14px;border-bottom:1px solid #f2dddd;background:#fff8f8;font-size:12px}
.harness-assistant-proposals-dock{box-sizing:border-box;width:100%;min-width:0;flex:none;padding-inline:calc(var(--dsh-composer-side-clearance) + 16px)}
.harness-assistant-proposals{scrollbar-width:thin;overscroll-behavior:contain;box-sizing:border-box;width:100%;min-width:0;max-width:var(--dsh-chat-content-width);margin:0 auto;font-size:12px;max-height:260px;overflow:auto;border:1px solid var(--hep-border);border-radius:var(--hep-radius);background:var(--hep-surface);padding:12px 16px}
.harness-assistant-proposals>summary{cursor:pointer;color:var(--hep-text)}
.harness-operation-card button{padding:8px 12px;border:1px solid var(--hep-border);border-radius:7px;cursor:pointer}
.harness-operation-card{padding:16px;margin:12px 0;border:1px solid var(--hep-border);border-radius:var(--hep-radius);background:var(--hep-surface);font-size:14px;line-height:1.7;overflow-wrap:anywhere}
.harness-operation-card header{display:flex;flex-wrap:wrap;align-items:baseline;justify-content:space-between;gap:8px 16px;padding-bottom:12px;border-bottom:1px solid var(--hep-border)}
.harness-operation-card header>span{color:var(--hep-muted);font-size:12px}
.harness-fusion-confirmation h4{margin:12px 0 6px}
.harness-fusion-confirmation p{margin:5px 0}
.harness-fusion-confirmation small{display:block;color:var(--hep-muted);overflow-wrap:anywhere}
.harness-operation-result{margin:10px 0}
.harness-operation-result>summary{cursor:pointer}
.harness-operation-state{font-weight:500}
.harness-operation-card dl{margin:8px 0}
.harness-operation-card dl>div{display:grid;grid-template-columns:minmax(70px,auto) minmax(0,1fr);gap:10px;margin:6px 0}
.harness-operation-card dt{color:var(--hep-muted)}
.harness-operation-card dd{margin:0;min-width:0}
.harness-operation-card ul{margin:4px 0;padding-left:18px}
.harness-operation-card [role=alert]{margin-bottom:0}
.harness-conversation-frame{box-sizing:border-box;padding-top:var(--harness-conversation-top);padding-left:var(--harness-conversation-left)}
.harness-platform[data-page=conversations] .harness-assistant-toggle{pointer-events:auto}
.harness-conversation-viewport{flex:1;min-height:0}
.harness-assistant-chat .harness-conversation-welcome{font-size:17px;flex-direction:column}
.harness-assistant-chat button,.harness-assistant-chat input,.harness-assistant-chat textarea{font:inherit}
@media(max-width:580px){.harness-assistant-floating{right:8px;bottom:76px;max-width:calc(100vw - 16px);width:calc(100vw - 16px);height:calc(100dvh - 92px)}.harness-platform button.harness-assistant-toggle{right:12px;bottom:12px;width:54px;height:54px;border-radius:18px}.harness-assistant-icon{width:40px;height:40px}.harness-assistant-heading{padding:10px}.harness-assistant-heading strong{font-size:13px}}
.harness-conversation-welcome{display:inline-flex;align-items:center;gap:12px;color:var(--hep-text);font-size:24px}

.harness-operation-card summary,.harness-operation-inline summary{padding:6px 0;line-height:1.7;cursor:pointer;color:var(--hep-muted)}
.harness-operation-card summary:focus-visible,.harness-operation-inline summary:focus-visible{outline:2px solid var(--hep-primary);outline-offset:3px;border-radius:4px}
.harness-operation-card button{font:inherit;min-height:38px;background:var(--hep-surface);color:var(--hep-text);transition:background-color var(--hep-motion-fast),border-color var(--hep-motion-fast);}
.harness-operation-card button:hover:enabled{border-color:var(--hep-primary);background:var(--hep-primary-soft)}
.harness-operation-card button:disabled{opacity:.45;cursor:default}
.harness-operation-card button:focus-visible{outline:2px solid var(--hep-primary);outline-offset:3px}
.harness-confirmation-actions .harness-primary:hover:enabled{background:var(--hep-primary-hover);border-color:var(--hep-primary-hover);color:#fff}
.harness-assistant-proposals>.harness-operation-card{border:0;border-radius:0;padding:12px 0;margin:8px 0 0;border-top:1px solid var(--hep-border)}
.harness-confirmation-summary>details{border-top:1px solid var(--hep-border);padding-top:8px;margin-top:16px}
.harness-confirmation-budget{padding:12px;background:var(--hep-surface-muted);border-radius:8px}
.harness-assistant-proposals>summary{font-size:12px;font-weight:500;padding:4px 0}
@media(prefers-reduced-motion:no-preference){.harness-assistant-floating{animation:hep-enter var(--hep-motion) var(--hep-ease)}}
@media(pointer:coarse){.harness-operation-card button,.harness-operation-card summary,.harness-operation-inline summary{min-height:44px}}
`
