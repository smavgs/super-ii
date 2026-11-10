import server from '@astrojs/cloudflare/entrypoints/server';
import {maintainAliens} from './lib/aliens/mail';
export default {
 fetch:server.fetch,
 async scheduled(_controller:ScheduledController,_env:unknown,ctx:ExecutionContext) {
  ctx.waitUntil(maintainAliens({} as App.Locals));
 },
};
