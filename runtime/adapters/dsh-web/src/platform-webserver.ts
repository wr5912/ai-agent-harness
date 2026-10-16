import { sitePath } from './sites.ts'
import { createMountedWebServer } from './index.ts'
import { runtimeModule } from './resolve-runtime.ts'

const { default: WebServer } = await runtimeModule('@deepseek-ai/dsh-host-webserver')
export default createMountedWebServer(WebServer, sitePath('platform'), 'Harness工程平台')
