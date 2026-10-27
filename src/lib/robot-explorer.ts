import { sqlClient } from './db';
import { productUuid } from './product-http';

import type { ExplorerCard, ExplorerSearch, ExplorerQuery } from './robot-explorer-ui';
export { countryLabel, explorerName } from './robot-explorer-ui';
export type { ExplorerCard, ExplorerSearch, ExplorerQuery } from './robot-explorer-ui';
export function explorerQuery(params: URLSearchParams): ExplorerQuery {
  const record_type = params.get('view') === 'companies' ? 'company' : 'product';
  const q=(params.get('q')??'').trim();
  const category=params.get('category')??(q?'all':'robot');
  const source=params.get('source')??'all';
  const company=params.get('company_id')||null;
  const country=params.get('country')??'';
  const letter=params.get('letter')??'';
  const limit=Number(params.get('limit')??(record_type==='company'?12:6));
  const offset=Number(params.get('offset')??0);
  if(q.length>120||!['all','robot','hand','component'].includes(category)||!['all','reference','company','community'].includes(source)
    ||company&&!productUuid.test(company)||country&&!/^[A-Z]{2}$/u.test(country)||letter&&!/^[A-Z0-9]$/u.test(letter)
    ||!Number.isInteger(limit)||limit<1||limit>24||!Number.isInteger(offset)||offset<0||offset>10000) throw new Error('Invalid catalogue query');
  return {record_type,q,category,source,company,country,letter,limit,offset};
}
export async function searchRobotExplorer(locals:App.Locals,query:ExplorerQuery):Promise<ExplorerSearch>{
  const sql=sqlClient(locals); if(!sql)throw new Error('Catalogue unavailable');
  const rows=await sql`select app.search_robot_explorer(${query.record_type},${query.q},${query.category},${query.source},${query.company}::uuid,${query.country},${query.letter},${query.limit},${query.offset}) as result`;
  return rows[0]?.result as ExplorerSearch;
}
export async function robotExplorerDetail(locals:App.Locals,id:string):Promise<ExplorerCard|null>{
  if(!productUuid.test(id))return null;
  const sql=sqlClient(locals); if(!sql)throw new Error('Catalogue unavailable');
  const rows=await sql`select app.robot_explorer_detail(${id}::uuid) as detail`;
  return rows[0]?.detail as ExplorerCard|null;
}
export const explorerPublicHeaders={'cache-control':'public, max-age=30, s-maxage=60','access-control-allow-origin':'*','x-content-type-options':'nosniff'};
