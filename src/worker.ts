import server from '@astrojs/cloudflare/entrypoints/server';
import {maintainAliens} from './lib/aliens/mail';
import {prepareEarlyRequest, type EarlyGuardEnv} from './lib/early-request-guard';
export default {
 async fetch(request: Request, env: EarlyGuardEnv, ctx: ExecutionContext) {
  const prepared = await prepareEarlyRequest(request, env);
  if (prepared instanceof Response) return prepared;
  return server.fetch(prepared, env, ctx);
 },
 async scheduled(_controller:ScheduledController,_env:unknown,ctx:ExecutionContext) {
  ctx.waitUntil(maintainAliens({} as App.Locals));
 },
};
