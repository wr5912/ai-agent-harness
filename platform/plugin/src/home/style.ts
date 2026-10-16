export const homePageTheme = `
.harness-home{max-width:1260px;padding:24px 32px 30px;margin:auto}
.harness-hero{position:relative;text-align:center;min-height:244px;padding:28px 70px 18px;overflow:hidden}
.harness-hero h1{font-size:32px;position:relative;font-weight:600;line-height:1.4}
.harness-hero>p{max-width:700px;color:#72849c;margin:12px auto 26px;font-size:14px}
.harness-hero-art{position:absolute;width:180px;top:20px;opacity:.8;pointer-events:none}
.harness-hero-art.left{left:-10px}
.harness-hero-art.right{right:-10px;transform:scaleX(-1)}
.harness-task-composer{position:relative;max-width:760px;margin:auto;padding:14px 16px;background:white;border:1px solid #c1dbff;border-radius:14px;box-shadow:0 5px 22px #1272db0c;text-align:left}
.harness-entry-modes{display:flex;gap:6px;padding-bottom:12px;border-bottom:1px solid #edf2f8}
.harness-platform .harness-entry-modes button{flex:1;min-width:0;border:0;background:transparent;font-size:13px;color:#667d98}
.harness-platform .harness-entry-modes button[aria-pressed=true]{background:#edf5ff;color:#006eff;font-weight:600}
.harness-entry{display:flex;flex-direction:column;gap:12px;margin-top:12px}
.harness-entry textarea{width:100%;min-height:0;max-height:240px;resize:none;overflow-y:auto;border:0!important;line-height:1.65}
.harness-entry textarea:placeholder-shown{white-space:nowrap}
.harness-entry textarea:focus-visible{outline:2px solid #9bc4ff;outline-offset:2px}
.harness-example label{display:grid;gap:6px;min-width:0;font-size:12px;color:#667d98}
.harness-entry-footer{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap}
.harness-entry-footer span{font-size:12px;color:#8797ac;line-height:1.6}
.harness-entry-footer button{flex-shrink:0;min-width:108px;margin-left:auto}
.harness-task-composer>p{font-size:13px;margin:12px 0 0}
.harness-platform .harness-example-toggle{margin-top:12px;border:0;background:transparent;color:#607d9f}
.harness-example{position:relative;max-width:760px;margin:12px auto 0;padding:18px;text-align:left;background:#f6f9ff;border:1px solid #dce8f8;border-radius:12px}
.harness-example p{font-size:13px;color:#72849c;margin:8px 0 12px}
.harness-example>div{display:flex;gap:8px;flex-wrap:wrap}
.harness-example select{margin-bottom:12px;width:100%;min-width:0}
.harness-shortcuts{position:relative;display:flex;justify-content:center;flex-wrap:wrap;gap:8px}
.harness-shortcuts button{font-size:12px;padding:6px 10px;color:#647d9d}
.harness-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:16px;margin:20px 0}
.harness-platform .harness-stat{text-align:left;padding:18px;background:white;border:1px solid #e3ebf5;border-radius:12px}
.harness-stat span{color:#7185a3}
.harness-stat strong{display:block;font-size:30px;color:#006eff;margin:10px 0 4px}
.harness-stat small{color:#8d9db0}
.harness-home-columns{display:grid;grid-template-columns:1.3fr 1fr;gap:20px}
.harness-capabilities{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:18px}
.harness-platform .harness-capability{text-align:left;padding:16px;border-color:#e5edf7;background:#f9fbff}
.harness-capability span{display:block;color:#006eff;font-size:20px;margin-bottom:10px}
.harness-capability strong{display:block}
.harness-capability small{display:block;line-height:1.6;color:#8798ad;margin-top:6px}
@media(max-width:1000px){.harness-hero{padding:24px 70px}.harness-hero-art{width:120px}.harness-home{padding:20px}.harness-home-columns{grid-template-columns:1fr}}
@media(max-width:680px){.harness-home{padding:16px 12px}.harness-hero{padding:18px 0;min-height:0}.harness-hero h1{font-size:24px}.harness-task-composer{padding:12px}.harness-entry-modes{gap:0}.harness-platform .harness-entry-modes button{font-size:12px;padding:8px 6px}.harness-hero-art{display:none}.harness-stats{grid-template-columns:1fr 1fr;gap:10px}.harness-stat strong{font-size:25px}.harness-capabilities{gap:8px}}
`
