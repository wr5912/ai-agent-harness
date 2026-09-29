# 报告存储 MCP 只读探查（2026-09-28）

目标地址：`http://172.16.138.228:58215/mcp/persistence`。本轮执行 initialize、notifications/initialized、工具和资源目录查询，以及随机不存在 ID 的只读查询；没有调用保存工具，没有远端写入。地址由用户提供，不作为候选资产中的硬编码连接配置。

## 实际观察

- HTTP POST JSON-RPC 可用，响应为 application/json。initialize 返回服务 ai-persistence 1.0.0、协议 2025-11-25；以该版本重新 initialize 成功。请求 Accept 为 application/json, text/event-stream；通知 initialized 返回 HTTP 202。
- tools/list 返回 get_persistence_result、save_persistence_result，没有 outputSchema。resources/list、resources/templates/list、prompts/list 均为空。
- get_persistence_result 的必填参数为 id:string。随机不存在 ID 查询返回 result.isError=true、文本“存储结果不存在”。不能仅依据 HTTP 200 判为工具调用成功。
- /v3/api-docs、/swagger-ui/index.html、/openapi.json 均返回 404；这些文档入口不可用，不证明服务不存在其他文档。

## 工具参数与调用

保存工具描述为“保存结构化结果或文件并返回存储标识”。其 inputSchema 全部字段如下，required 为 []，没有枚举、长度限制或默认值说明。空 required 只说明目录未声明必填项，不证明运行时允许空参数。

| 参数 | 类型 | 对接含义或待确认内容 |
|---|---|---|
| businessId | string | 建议映射事件 ID，实际约束待确认 |
| contentType | string | HTML 报告拟用 text/html，服务接受值待验证 |
| fileContentBase64 | string | 拟传 report.html 的 UTF-8 字节 Base64；不是容器文件路径 |
| fileName | string | 拟用事件 ID 与 run_id 组合，避免同一事件多次运行混淆 |
| payloadJson | string | 名称表明可接收 JSON 字符串；与文件字段是否互斥未知 |
| resultType | string | 分类取值未说明 |
| revision | integer | 版本及覆盖规则未说明 |
| sourceModule | string | 来源模块取值未说明 |

MCP 初始化并发送 initialized 通知后，使用 tools/call。以下只展示文件字段映射，未执行，不能当作已验证成功的业务请求：

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/call",
  "params": {
    "name": "save_persistence_result",
    "arguments": {
      "businessId": "INC-20260917-000001",
      "fileName": "INC-20260917-000001_run-82edf8ab-7ec6-45e6-ae4a-16414b9195c5.html",
      "contentType": "text/html",
      "fileContentBase64": "<report.html 字节的 Base64>"
    }
  }
}
```

查询使用相同 endpoint、tools/call，name=get_persistence_result，arguments={"id":"<保存返回的标识>"}。若服务返回 Mcp-Session-Id，后续请求应带回；本轮没有鉴权头仍能完成上述只读请求，不扩展为写入权限结论。

## 与当前要求的符合程度

接口层面具备文件保存参数，适合作为候选报告存储 MCP。尚不能判定完整满足“保存 HTML 并返回浏览器可下载 URL”：保存成功响应未知，工具说明仅承诺标识；查询成功是否返回 URL、下载响应内容类型与附件文件名、浏览器是否需额外鉴权、链接有效期均未验证。不能把 MCP 地址或存储标识当作下载地址。

摘要仍使用另一模块的占位配置；本次没有因为 payloadJson 字段存在而自动把摘要接入该服务。下一步需要服务接口文档或已有结果 ID 只读核对成功响应；实际保存和下载验证应使用明确的测试报告及独立标识，接入时核实 resultType/sourceModule/revision 等约束。

展示已改为“摘要存储 / 报告存储 / 报告下载”。在当前容器新 Python 进程中对用户运行 run-82edf8ab-7ec6-45e6-ae4a-16414b9195c5 只读重渲染，Markdown 与 HTML 均包含新名称；历史运行未改写。8 项入口/交付回归通过。本轮未重新运行 MCP 研判或网页交互。

## 后续确认（2026-09-28）

用户确认接口暂不提供返回下载 URL 的能力，正在开发。暂停进一步探查，待用户通知开发完成后再核对；本次确认没有新增接口请求或远端写入。当前接入状态见 Agent 的 definition.md。


## 服务更新后复查（2026-09-28）

initialize 和 tools/list 成功；save_persistence_result 现在返回 data.id、storageKind 和 downloadUrl。文件输入仍为 fileContentBase64，没有 reportHtml 原始字符串参数。返回外层 JSON-RPC result.content 文本中的业务 code=200；HTTP 成功本身不代表保存成功。

使用独立探针业务 ID harness-probe-15522601-bb16-4264-8aa7-5ffeece49f89 保存 160 字节 HTML，返回 file-59743ce4-8b8f-4fbe-8d19-8d58bb962644；实际下载 HTTP 200，Content-Type 为 text/html;charset=UTF-8，Content-Disposition 为 attachment，内容与探针一致。get_persistence_result 可回读文件，但回读响应未包含 downloadUrl，因此使用保存响应中的 URL。

接口探索阶段还保存了一条通用 JSON 测试记录 record-81e8ab88-abda-4497-aec8-0cbc72881261。这仅证明工具具备该能力，不是摘要回写。用户随后明确本 MCP 只用于报告，最终程序不调用该 JSON 保存能力；SOC 回写接口尚未实现和提供。

当前下载地址可匿名读取；这与 issue #102 所设计的 SOC 登录后下载不是同一接口。远端 1MB 边界尚未实测；本地按原 HTML 的 UTF-8 字节数限制为 1048576，Base64 只用于该报告 MCP 的传输，不进入本地 SOC 回写字段 reportHtml。
