const MAX_DOCUMENT = 2 * 1024 * 1024;
const MAX_RESULT = 1024 * 1024;
const methods = new Set(['get', 'post', 'put', 'patch', 'delete']);
export function validateSpecUrl(value) {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) {
        throw new Error('OpenAPI 规范地址须为不含凭据和片段的 HTTP(S) URL');
    }
    return url.href;
}
async function limitedText(response, limit) {
    if (Number(response.headers.get('content-length')) > limit)
        throw new Error('上游响应过大');
    const body = await response.arrayBuffer();
    if (body.byteLength > limit)
        throw new Error('上游响应过大');
    return new TextDecoder().decode(body);
}
function resolveObject(spec, value) {
    if (!value?.$ref)
        return value;
    const path = String(value.$ref).split('/');
    if (path[0] !== '#' || path[1] !== 'components')
        throw new Error(`不支持的 OpenAPI 引用：${value.$ref}`);
    const target = path.slice(1).reduce((item, part) => item?.[part.replace(/~1/g, '/').replace(/~0/g, '~')], spec);
    if (!target)
        throw new Error(`OpenAPI 引用不存在：${value.$ref}`);
    return target;
}
function schemaOf(spec, value, defs) {
    if (Array.isArray(value))
        return value.map(item => schemaOf(spec, item, defs));
    if (!value || typeof value !== 'object')
        return value;
    if (value.$ref) {
        const prefix = '#/components/schemas/';
        if (!String(value.$ref).startsWith(prefix))
            throw new Error(`不支持的 Schema 引用：${value.$ref}`);
        const name = String(value.$ref).slice(prefix.length);
        const original = spec.components?.schemas?.[name];
        if (!original)
            throw new Error(`Schema 不存在：${name}`);
        if (!(name in defs)) {
            defs[name] = {};
            defs[name] = schemaOf(spec, original, defs);
        }
        return { ...value, $ref: `#/$defs/${name}` };
    }
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, schemaOf(spec, item, defs)]));
}
function operationUrl(base, path) {
    return new URL(`${base.pathname.replace(/\/$/, '')}${path}`, base.origin);
}
function operationSchema(spec, parameters, body) {
    const defs = {};
    const properties = {};
    const required = [];
    for (const parameter of parameters) {
        properties[parameter.name] = schemaOf(spec, parameter.schema ?? { type: 'string' }, defs);
        if (parameter.description)
            properties[parameter.name].description = parameter.description;
        if (parameter.required || parameter.in === 'path')
            required.push(parameter.name);
    }
    if (body) {
        const content = body.content?.['application/json'];
        if (!content)
            throw new Error('当前仅支持 application/json 请求体');
        properties.body = schemaOf(spec, content.schema ?? { type: 'object' }, defs);
        if (body.required)
            required.push('body');
    }
    return { type: 'object', properties, ...(required.length ? { required: [...new Set(required)] } : {}),
        ...(Object.keys(defs).length ? { $defs: defs } : {}) };
}
function authHeaders(spec, operation, apiKey) {
    if (!apiKey)
        return {};
    const names = Object.keys((operation.security ?? spec.security ?? [])[0] ?? {});
    if (!names.length)
        return { Authorization: `Bearer ${apiKey}` };
    const scheme = spec.components?.securitySchemes?.[names[0]];
    if (scheme?.type === 'apiKey' && scheme.in === 'header')
        return { [scheme.name]: apiKey };
    if (scheme?.type === 'http' && scheme.scheme?.toLowerCase() === 'bearer')
        return { Authorization: `Bearer ${apiKey}` };
    throw new Error('当前仅支持 Header API Key 或 Bearer 认证');
}
export async function loadOpenApi(server) {
    const specUrl = validateSpecUrl(server.specUrl);
    const response = await fetch(specUrl, { headers: server.apiKey ? { Authorization: `Bearer ${server.apiKey}` } : {},
        signal: AbortSignal.timeout(20_000) });
    if (!response.ok)
        throw new Error(`读取 OpenAPI 规范失败：HTTP ${response.status}`);
    const spec = JSON.parse(await limitedText(response, MAX_DOCUMENT));
    if (!spec.openapi || !spec.paths || typeof spec.paths !== 'object')
        throw new Error('OpenAPI 规范缺少 openapi 或 paths');
    const base = new URL(spec.servers?.[0]?.url ?? '/', specUrl);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.search || base.hash) {
        throw new Error('OpenAPI servers[0].url 无效');
    }
    const tools = [];
    const resources = [];
    const resourceTemplates = [];
    const operations = new Map();
    const readable = [];
    for (const [path, pathItem] of Object.entries(spec.paths)) {
        for (const [method, raw] of Object.entries(pathItem)) {
            if (!methods.has(method))
                continue;
            const name = String(raw.operationId || `${method}_${path}`).replace(/[^A-Za-z0-9_.-]/g, '_');
            if (operations.has(name))
                throw new Error(`OpenAPI 操作名重复：${name}`);
            const parameters = [...(pathItem.parameters ?? []), ...(raw.parameters ?? [])].map(item => resolveObject(spec, item));
            const body = raw.requestBody ? resolveObject(spec, raw.requestBody) : undefined;
            const uri = operationUrl(base, path).href;
            const description = raw.summary || raw.description || `${method.toUpperCase()} ${path}`;
            const item = { name, method, path, parameters, body, raw, uri, description };
            operations.set(name, item);
            if (method === 'get' && !body && parameters.every(parameter => parameter.in === 'path')) {
                readable.push(item);
                const info = { name, description, mimeType: 'application/json' };
                if (parameters.length)
                    resourceTemplates.push({ ...info, uriTemplate: uri.replace(/%7B/gi, '{').replace(/%7D/gi, '}') });
                else
                    resources.push({ ...info, uri });
            }
            else {
                tools.push({ name, description, inputSchema: operationSchema(spec, parameters, body) });
            }
        }
    }
    return { spec, base, tools, resources, resourceTemplates, operations, readable, apiKey: server.apiKey };
}
async function execute(source, item, args) {
    const url = operationUrl(source.base, item.path);
    for (const parameter of item.parameters) {
        const value = args?.[parameter.name];
        if (value === undefined || value === null) {
            if (parameter.required || parameter.in === 'path')
                throw new Error(`缺少参数：${parameter.name}`);
            continue;
        }
        if (parameter.in === 'path')
            url.pathname = url.pathname.replace(encodeURIComponent(`{${parameter.name}}`), encodeURIComponent(String(value)));
        if (parameter.in === 'query')
            for (const entry of Array.isArray(value) ? value : [value])
                url.searchParams.append(parameter.name, String(entry));
    }
    const headers = { ...authHeaders(source.spec, item.raw, source.apiKey) };
    for (const parameter of item.parameters.filter((entry) => entry.in === 'header')) {
        if (args?.[parameter.name] !== undefined)
            headers[parameter.name] = String(args[parameter.name]);
    }
    if (item.body)
        headers['content-type'] = 'application/json';
    const response = await fetch(url, { method: item.method.toUpperCase(), headers,
        body: item.body && args?.body !== undefined ? JSON.stringify(args.body) : undefined,
        signal: AbortSignal.timeout(20_000) });
    const raw = await limitedText(response, MAX_RESULT);
    const text = source.apiKey ? raw.replaceAll(source.apiKey, '[redacted]') : raw;
    return { response, text, uri: url.href };
}
export async function callOpenApiTool(source, name, args) {
    const item = source.operations.get(name);
    if (!item || source.readable.includes(item))
        throw new Error('工具不属于当前 OpenAPI 范围');
    const { response, text } = await execute(source, item, args);
    return { content: [{ type: 'text', text: text || `HTTP ${response.status}` }], isError: !response.ok };
}
export async function readOpenApiResource(source, uri) {
    const request = new URL(uri);
    if (request.search || request.hash)
        throw new Error('Resource URI 不属于当前 OpenAPI 范围');
    for (const item of source.readable) {
        const template = new URL(item.uri);
        if (request.origin !== template.origin)
            continue;
        const expected = template.pathname.split('/').map(decodeURIComponent);
        const actual = request.pathname.split('/');
        if (expected.length !== actual.length)
            continue;
        const args = {};
        if (!expected.every((part, index) => {
            const variable = /^\{([^{}]+)\}$/.exec(part);
            if (variable) {
                args[variable[1]] = decodeURIComponent(actual[index]);
                return true;
            }
            return part === actual[index];
        }))
            continue;
        const { response, text } = await execute(source, item, args);
        if (!response.ok)
            throw new Error(`Resource 读取失败：HTTP ${response.status}`);
        return { contents: [{ uri, mimeType: response.headers.get('content-type')?.split(';')[0] || 'application/json', text }] };
    }
    throw new Error('Resource URI 不属于当前 OpenAPI 范围');
}
