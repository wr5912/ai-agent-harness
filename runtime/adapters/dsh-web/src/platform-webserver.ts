import sites from '../sites.json' with { type: 'json' }
import { createMountedWebServer } from './index.ts'
import { runtimeModule } from './resolve-runtime.ts'

const { default: WebServer } = await runtimeModule('@deepseek-ai/dsh-host-webserver')
export default createMountedWebServer(WebServer, sites.platform)
