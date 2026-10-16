export const mcpPageTheme = `
.harness-composition-workspace{display:grid;grid-template-columns:250px minmax(0,1fr);gap:16px;align-items:start}
.harness-composition-sidebar ul{list-style:none;padding:0;margin:0}
.harness-composition-sidebar li{margin:6px 0}
.harness-composition-sidebar li button{display:block;width:100%;text-align:left;overflow-wrap:anywhere}
.harness-composition-sidebar li button[aria-current=true]{background:#edf5ff;border-color:#9cc3ff;color:#006eff}
.harness-composition-sidebar small{display:block;margin-top:5px}
.harness-composition-detail{min-width:0}
.harness-composition-detail .harness-mcp-actions{margin:12px 0;flex-wrap:wrap}
.harness-composition-editor label{display:grid;gap:5px;margin:12px 0}
.harness-composition-editor input,.harness-composition-editor textarea,.harness-composition-editor select{width:100%;box-sizing:border-box}
.harness-composition-sidebar .harness-mcp-actions{flex-wrap:wrap}
@media(max-width:900px){.harness-composition-workspace{grid-template-columns:minmax(0,1fr)}}
.harness-composition-layout{display:grid;grid-template-columns:minmax(180px,1fr) minmax(0,2fr);gap:20px;align-items:start}
.harness-mcp-flow button[aria-pressed=true]{background:#edf5ff;border-color:#9cc3ff;color:#006eff}
.harness-composition-layout{grid-template-columns:minmax(0,2fr) minmax(230px,1fr)}
.harness-mcp-flow article{position:relative}
.harness-mcp-flow article:not(:last-child)::after{content:'→';position:absolute;right:-13px;top:50%;color:#006eff}
@media(max-width:900px){.harness-composition-layout{grid-template-columns:minmax(0,1fr)}}
.harness-mcp-page{width:100%;min-width:0;padding:24px clamp(16px,3vw,36px)}
.harness-mcp-toolbar{display:flex;align-items:center;flex-wrap:wrap;gap:12px;margin:0 0 16px;border-bottom:1px solid #dce6f2;padding-bottom:10px}
.harness-mcp-actions{display:flex;gap:8px}
.harness-mcp-toolbar>.harness-mcp-actions{margin-left:auto;flex-shrink:0}
.harness-mcp-tabs{display:flex;gap:8px;flex-wrap:wrap;min-width:0}
.harness-platform .harness-mcp-tabs [aria-current=page]{color:#006eff;background:#edf5ff;border-color:#9cc3ff}
.harness-mcp-page .mcp-manager{--mcp-blue:#006eff;--mcp-tint:#f6f9fe;width:100%;margin:0;overflow-wrap:anywhere}
.harness-mcp-page .mcp-manager .mcp-tabs{display:none}
.harness-mcp-page .mcp-manager .mcp-content{padding:20px;min-height:0}
.harness-mcp-page .mcp-manager .mcp-layout{grid-template-columns:200px minmax(0,1fr);gap:16px}
.harness-mcp-page .mcp-manager .mcp-card-head{flex-wrap:wrap}
.harness-mcp-flow{display:flex;gap:14px;align-items:stretch;flex-wrap:wrap}
.harness-mcp-flow article{flex:1;min-width:min(240px,100%);padding:18px;border:1px solid #dce6f3;border-radius:12px;background:#f6f9fe}
.harness-mcp-flow small{color:#6b7890}
.harness-mcp-flow code{overflow-wrap:anywhere}
@media(max-width:1000px){.harness-mcp-page .mcp-manager .mcp-layout{grid-template-columns:160px minmax(0,1fr)}}
@media(max-width:760px){.harness-mcp-page .mcp-manager .mcp-layout{grid-template-columns:minmax(0,1fr)}.harness-mcp-page .mcp-manager .mcp-content{padding:14px}}
@media(max-width:680px){.harness-mcp-page{padding:16px}.harness-mcp-tabs{gap:4px}}
`
