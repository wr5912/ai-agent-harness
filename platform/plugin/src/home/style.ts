export const homePageTheme = `
.harness-home{width:100%;max-width:1440px;padding:24px var(--hep-page-padding) 32px;margin:auto}
.harness-hero{position:relative;text-align:center;padding:32px 0 24px;isolation:isolate}
.harness-hero h1{position:relative;max-width:1080px;margin:0 auto;font-size:clamp(26px,2.6vw,34px);font-weight:600;line-height:1.4;letter-spacing:-.025em;text-wrap:balance}
.harness-hero>p{position:relative;max-width:720px;color:var(--hep-muted);margin:16px auto 28px;font-size:14px;text-wrap:pretty}
.harness-hero-art{position:absolute;width:144px;top:18px;--hep-art-opacity:.45;opacity:var(--hep-art-opacity);pointer-events:none;z-index:-1;filter:drop-shadow(0 12px 18px #0075ca0a)}
.harness-hero-art.left{left:0}.harness-hero-art.right{right:0;transform:scaleX(-1)}
.harness-task-composer{position:relative;max-width:760px;margin:auto;padding:12px 16px 16px;background:var(--hep-surface);border:1px solid color-mix(in srgb,var(--hep-primary) 28%,var(--hep-border));border-radius:16px;box-shadow:var(--hep-shadow);text-align:left;transition:border-color var(--hep-motion),box-shadow var(--hep-motion)}
.harness-task-composer:focus-within{border-color:var(--hep-primary);box-shadow:0 0 0 3px var(--hep-primary-soft),var(--hep-shadow)}
.harness-entry-modes{display:flex;gap:4px;padding:4px;background:var(--hep-surface-muted);border-radius:10px}
.harness-platform .harness-entry-modes button{flex:1;min-width:0;border:0;background:transparent;font-size:14px;color:var(--hep-muted);padding:8px}
.harness-platform .harness-entry-modes button[aria-pressed=true]{background:var(--hep-surface);color:var(--hep-link);font-weight:600;box-shadow:0 1px 4px #16395912}
.harness-entry{display:flex;flex-direction:column;gap:12px;margin-top:12px}
.harness-entry textarea{width:100%;min-height:0;max-height:240px;resize:none;overflow-y:auto;border:0;line-height:1.65;background:transparent;padding:8px 4px;scrollbar-width:thin}
.harness-entry textarea:placeholder-shown{white-space:nowrap}
.harness-entry textarea:focus-visible{outline:2px solid var(--hep-primary-soft);outline-offset:1px}
.harness-entry-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:0 4px}
.harness-entry-footer span{font-size:12px;color:var(--hep-muted);line-height:1.6}
.harness-entry-footer button{flex-shrink:0;min-width:108px;margin-left:auto}
.harness-task-composer>p{font-size:14px;margin:12px 4px 0}
.harness-platform .harness-example-toggle{margin-top:12px;border-color:transparent;background:transparent;color:var(--hep-muted);font-size:14px}
.harness-example{position:relative;max-width:760px;margin:12px auto 0;padding:20px;text-align:left;background:var(--hep-surface);border:1px solid var(--hep-border);border-radius:var(--hep-radius)}
.harness-example label{display:grid;gap:8px;min-width:0;font-size:14px;color:var(--hep-text)}
.harness-example p{font-size:14px;color:var(--hep-muted);margin:8px 0 16px}
.harness-example>div{display:flex;gap:8px;flex-wrap:wrap}
.harness-example select{margin-bottom:16px;width:100%;min-width:0}
.harness-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin:8px 0 24px}
.harness-platform .harness-stat{text-align:left;padding:20px 24px;background:var(--hep-surface);border:1px solid var(--hep-border);border-radius:var(--hep-radius)}
.harness-stat span{color:var(--hep-muted);font-size:14px}
.harness-stat strong{display:block;font-size:30px;font-weight:600;font-variant-numeric:tabular-nums;line-height:1.3;color:var(--hep-text);margin:8px 0}
.harness-stat small{font-size:12px;line-height:1.6;color:var(--hep-muted)}
.harness-home-columns{display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:24px;align-items:start}
.harness-home .harness-run-row:last-child{border-bottom:0;padding-bottom:0}
.harness-home .harness-run-row>div>small{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.harness-platform .harness-run-link{display:block;max-width:100%;padding:0;min-height:0;border:0;border-radius:4px;background:transparent;color:var(--hep-text);font-size:14px;text-align:left;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.harness-platform .harness-run-link:hover:enabled{background:transparent;color:var(--hep-link)}
.harness-capabilities{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:16px}
.harness-platform .harness-capability{text-align:left;padding:16px;border-color:transparent;background:var(--hep-surface-muted)}
.harness-capability span{display:grid;place-items:center;width:32px;height:32px;border-radius:8px;background:var(--hep-primary-soft);color:var(--hep-link);font-size:20px;margin-bottom:12px}
.harness-capability strong{display:block;font-size:14px;font-weight:600}
.harness-capability small{display:block;line-height:1.6;font-size:12px;color:var(--hep-muted);margin-top:6px}
@media(prefers-reduced-motion:no-preference){.harness-hero-art.left{animation:hep-art-left 320ms var(--hep-ease)}.harness-hero-art.right{animation:hep-art-right 320ms var(--hep-ease)}.harness-example{animation:hep-enter var(--hep-motion) var(--hep-ease)}}
@keyframes hep-art-left{from{opacity:0;transform:translateY(6px)}to{opacity:var(--hep-art-opacity);transform:translateY(0)}}
@keyframes hep-art-right{from{opacity:0;transform:scaleX(-1) translateY(6px)}to{opacity:var(--hep-art-opacity);transform:scaleX(-1) translateY(0)}}
@media(hover:hover) and (prefers-reduced-motion:no-preference){.harness-platform .harness-stat:hover:enabled,.harness-platform .harness-capability:hover:enabled{transform:translateY(-1px);box-shadow:var(--hep-shadow)}}
@media(max-width:1100px){.harness-hero-art{width:112px;--hep-art-opacity:.25}.harness-hero-art.left{left:-8px}.harness-hero-art.right{right:-8px}.harness-home-columns{grid-template-columns:1fr}.harness-home .harness-run-row{flex-wrap:nowrap}}
@media(max-width:680px){.harness-home{padding-top:16px}.harness-hero{padding:16px 0 24px}.harness-hero h1{max-width:18em;font-size:26px;line-height:1.5}.harness-hero>p{margin:14px auto 24px}.harness-task-composer{padding:10px 12px 12px}.harness-entry-modes{gap:0;padding:3px}.harness-platform .harness-entry-modes button{font-size:12px;padding:8px 4px}.harness-hero-art{display:none}.harness-stats{grid-template-columns:1fr 1fr;gap:12px;margin-top:0}.harness-platform .harness-stat{padding:16px}.harness-stat strong{font-size:26px}.harness-capabilities{gap:8px}.harness-platform .harness-capability{padding:12px}.harness-home .harness-run-row{display:grid;grid-template-columns:32px minmax(0,1fr);gap:8px 12px}.harness-home .harness-run-state{grid-column:2;justify-self:start}.harness-example{padding:16px}.harness-home-columns{gap:16px}.harness-home .harness-section-heading{gap:8px}.harness-home .harness-section-heading button{flex-shrink:0}}
`
