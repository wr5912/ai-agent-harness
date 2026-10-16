import { visualTokens } from './tokens.ts'

export const baseTheme = `${visualTokens}
.harness-platform{position:absolute;inset:0;height:100%;min-height:0;display:flex;flex-direction:column;font:14px/1.6 system-ui,"Microsoft YaHei",sans-serif;color:var(--hep-text);background:var(--hep-bg)}
.harness-platform *{box-sizing:border-box}
.harness-platform [hidden]{display:none!important}
/* :where 降低公共控件权重；原生对话控件继续由 DSH 管理。 */
.harness-platform :where(button,input,select,textarea):not(:where(.harness-assistant-chat *)){font:inherit}
.harness-platform :where(button):not(:where(.harness-assistant-chat *)){border:1px solid var(--hep-border);border-radius:var(--hep-control-radius);background:var(--hep-surface);color:var(--hep-text);padding:7px 12px;min-height:max(38px,var(--hep-hit-target));cursor:pointer;transition:background-color var(--hep-motion-fast),border-color var(--hep-motion-fast),box-shadow var(--hep-motion-fast),transform var(--hep-motion-fast)}
.harness-platform :where(button):not(:where(.harness-assistant-chat *)):hover:enabled{border-color:var(--hep-primary);background:var(--hep-primary-soft);color:var(--hep-link)}
.harness-platform :where(button):not(:where(.harness-assistant-chat *)):active:enabled{transform:translateY(1px)}
.harness-platform :where(button):not(:where(.harness-assistant-chat *)):disabled{opacity:.45;cursor:default}
.harness-platform :where(button,a,input,select,textarea,summary):not(:where(.harness-assistant-chat *)):focus-visible{outline:2px solid var(--hep-primary);outline-offset:3px}
.harness-platform :where(input:not([type=checkbox]):not([type=radio]),select,textarea):not(:where(.harness-assistant-chat *)){border:1px solid var(--hep-border);border-radius:var(--hep-control-radius);background:var(--hep-surface);color:var(--hep-text);padding:8px 10px;min-width:0;max-width:100%;transition:border-color var(--hep-motion-fast),box-shadow var(--hep-motion-fast)}
.harness-platform :where(input,textarea):not(:where(.harness-assistant-chat *))::placeholder{color:var(--hep-muted);opacity:.8}
.harness-platform :where(input[type=checkbox],input[type=radio]){accent-color:var(--hep-primary)}
.harness-platform h1{font-size:24px;margin:0 0 8px}
.harness-platform h2{font-size:18px;line-height:1.4}
.harness-platform p{line-height:1.7}
.harness-platform pre{max-height:440px;overflow:auto;font-size:12px;line-height:1.7;color:var(--hep-text);background:var(--hep-surface-muted);padding:16px;border-radius:8px;overflow-wrap:anywhere}
.harness-platform table{width:100%;border-collapse:collapse;text-align:left;font-size:14px;font-variant-numeric:tabular-nums}
.harness-platform th{color:var(--hep-muted);font-weight:500;background:var(--hep-surface-muted)}
.harness-platform td,.harness-platform th{padding:12px 16px;border-bottom:1px solid var(--hep-border);overflow-wrap:anywhere;vertical-align:top}
.harness-platform td button{white-space:nowrap}
.harness-table-scroll{max-height:480px;overflow:auto;scrollbar-width:thin}
.harness-platform [role=alert]{color:var(--dsw-alias-state-error-primary,#b93838)}
.harness-topbar{min-height:68px;flex-shrink:0;display:flex;align-items:center;gap:24px;padding:12px var(--hep-page-padding);background:var(--hep-surface);border-bottom:1px solid var(--hep-border)}
.harness-brand{display:flex;gap:10px;align-items:center;flex-shrink:0}
.harness-brand strong{display:block;font-size:17px;font-weight:600;white-space:nowrap}
.harness-brand small{font-size:12px;color:var(--hep-muted)}
.harness-nav{display:flex;gap:4px;min-width:0;overflow-x:auto;scrollbar-width:thin}
.harness-topbar>.harness-nav{flex:1}
.harness-nav button{flex-shrink:0;white-space:nowrap;border:0;background:transparent;padding:9px 12px;color:var(--hep-muted)}
.harness-nav button[aria-current=page]{color:var(--hep-link);background:var(--hep-primary-soft);font-weight:600}
.harness-account{margin-left:auto;display:flex;align-items:center;gap:10px;color:var(--hep-muted);flex-shrink:0}
.harness-avatar{display:grid;place-items:center;width:32px;height:32px;border-radius:10px;background:var(--hep-primary-soft);color:var(--hep-link)}
.harness-body{display:flex;flex:1;min-width:0;min-height:0}
.harness-content{position:relative;flex:1;min-width:0;min-height:0;overflow:auto;scrollbar-width:thin}
.harness-breadcrumb{padding:18px var(--hep-page-padding) 0;color:var(--hep-muted);font-size:12px}
.harness-page-heading{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:20px}
.harness-page-heading p{margin:0;color:var(--hep-muted)}
.harness-card{border:1px solid var(--hep-border);background:var(--hep-surface);border-radius:var(--hep-radius);padding:24px;min-width:0}
.harness-platform .harness-primary{background:var(--hep-primary);color:#fff;border-color:var(--hep-primary);font-weight:500}
.harness-platform .harness-primary:hover:enabled{background:var(--hep-primary-hover);border-color:var(--hep-primary-hover);color:#fff;box-shadow:0 3px 10px #0075ca20}
.harness-section-heading{display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px}
.harness-section-heading h2{margin:0}
.harness-section-heading button{border:0;font-size:12px;color:var(--hep-link);background:transparent}
.harness-run-row{display:flex;align-items:center;gap:12px;padding:16px 0;border-bottom:1px solid var(--hep-border)}
.harness-run-row>div{min-width:0;flex:1}
.harness-run-row strong{display:block;font-size:14px;overflow-wrap:anywhere}
.harness-run-row small{display:block;color:var(--hep-muted);font-size:12px;margin-top:4px}
.harness-run-state{font-size:12px;background:var(--hep-primary-soft);color:var(--hep-link);border-radius:6px;padding:4px 8px;flex-shrink:0}
.harness-guide{color:var(--hep-muted);background:var(--hep-surface-muted);padding:16px;border-radius:8px;margin-top:16px;line-height:1.8;font-size:12px}
.harness-source{font-size:12px;color:var(--hep-muted);margin-top:18px;overflow-wrap:anywhere}
.harness-fields{margin:8px 0;overflow-wrap:anywhere}.harness-fields>div{margin:10px 0}.harness-fields dt{font-size:12px;color:var(--hep-muted)}.harness-fields dd{margin:4px 0 0}
.harness-password-field{display:flex;align-items:center;position:relative;min-width:0}.harness-platform .harness-password-field input{width:100%;padding-right:calc(max(36px,var(--hep-hit-target)) + 8px)}.harness-platform .harness-password-field button{position:absolute;right:4px;display:grid;place-items:center;width:max(36px,var(--hep-hit-target));min-height:max(36px,var(--hep-hit-target));padding:4px;border:0;background:transparent;color:var(--hep-muted)}
.harness-platform[data-page=conversations]{background:transparent;pointer-events:none}.harness-platform[data-page=conversations] .harness-topbar{pointer-events:auto}.harness-platform[data-page=conversations] .harness-content{display:flex;flex-direction:column;overflow:hidden}
.harness-platform dialog::backdrop{background:#10283e52}
@media(prefers-reduced-motion:no-preference){.harness-platform dialog[open]{animation:hep-enter var(--hep-motion) var(--hep-ease)}}
@media(max-width:1100px){.harness-topbar{flex-wrap:wrap;gap:10px 16px}.harness-topbar>.harness-nav{order:3;flex-basis:100%;width:100%}.harness-brand small{display:none}}
@media(max-width:680px){.harness-topbar{padding:12px 16px;gap:8px}.harness-brand strong{font-size:14px}.harness-topbar>.harness-nav{gap:2px}.harness-nav button{font-size:13px;padding:8px 10px}.harness-account{gap:6px;font-size:12px}.harness-account button{padding:6px 8px}.harness-card{padding:16px}.harness-run-row{flex-wrap:wrap}}
@media(pointer:coarse){.harness-platform :where(button,input:not([type=checkbox]):not([type=radio]),select):not(:where(.harness-assistant-chat *)){min-height:44px}}
@media(prefers-reduced-motion:reduce){.harness-platform :where(button):not(:where(.harness-assistant-chat *)):active:enabled{transform:none}}
`
