import type { APIRoute } from 'astro';
import { explorerQuery, explorerPublicHeaders as headers, robotExplorerDetail, searchRobotExplorer } from '@/lib/robot-explorer';
import { productPublicRate } from '@/lib/product-http';
export const GET:APIRoute=async({locals,request,url})=>{
  const denied=await productPublicRate(locals,request);if(denied)return denied;
  try{
    const id=url.searchParams.get('id');
    if(id){const detail=await robotExplorerDetail(locals,id);return Response.json(detail??{error:'Entry unavailable'},{status:detail?200:404,headers});}
    const result=await searchRobotExplorer(locals,explorerQuery(url.searchParams));
    return Response.json(result,{headers});
  }catch(error){const invalid=error instanceof Error&&error.message==='Invalid catalogue query';return Response.json({error:invalid?'Invalid catalogue query':'Catalogue unavailable'},{status:invalid?422:503,headers:{...headers,'cache-control':'no-store'}});}
};
