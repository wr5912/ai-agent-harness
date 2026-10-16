// 平台与登录页共用的视觉规则；颜色继承 DSH 主题，业务页只消费语义变量。
export const visualTokens = `
:root,.harness-platform,.harness-assistant-proposals,.harness-operation-inline{
  --hep-primary:#0075ca;--hep-primary-hover:#0063ab;
  --hep-link:var(--hep-primary);--hep-link-hover:var(--hep-primary-hover);
  --hep-surface:var(--dsw-alias-bg-layer-1,#fff);
  --hep-bg:color-mix(in srgb,var(--dsw-alias-bg-base,#fff) 97%,#0075ca);
  --hep-surface-muted:color-mix(in srgb,var(--hep-surface) 96%,#0075ca);
  --hep-primary-soft:color-mix(in srgb,var(--hep-surface) 92%,var(--hep-primary));
  --hep-text:var(--dsw-alias-label-primary,#20344c);
  --hep-muted:var(--dsw-alias-label-secondary,#607186);
  --hep-border:var(--dsw-alias-border-l3,#dfe6ee);
  --hep-shadow:0 8px 28px #16395910;
  --hep-hit-target:0px;--hep-radius:12px;--hep-control-radius:8px;--hep-page-padding:32px;
  --hep-motion-fast:140ms;--hep-motion:200ms;--hep-ease:cubic-bezier(.2,.8,.2,1);
}
body[data-ds-dark-theme],body[data-ds-dark-theme] :is(.harness-platform,.harness-assistant-proposals,.harness-operation-inline){
  --hep-link:var(--dsw-alias-link,#7aaaff);--hep-link-hover:var(--dsw-alias-link,#7aaaff);
}
@media(max-width:900px){:root,.harness-platform{--hep-page-padding:24px}}
@media(max-width:680px){:root,.harness-platform{--hep-page-padding:16px}}
@media(pointer:coarse){:root,.harness-platform,.harness-assistant-proposals,.harness-operation-inline{--hep-hit-target:44px}}
@keyframes hep-enter{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:translateY(0)}}
@media(prefers-reduced-motion:reduce){:root,.harness-platform,.harness-assistant-proposals,.harness-operation-inline{--hep-motion-fast:0ms;--hep-motion:0ms}}
`
