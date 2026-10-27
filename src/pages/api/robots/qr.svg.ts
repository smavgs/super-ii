import type { APIRoute } from 'astro';
import QRCode from 'qrcode';
import {robotExplorerDetail} from '@/lib/robot-explorer';
import {productPublicRate} from '@/lib/product-http';
export const GET:APIRoute=async({locals,url,request})=>{
  const denial=await productPublicRate(locals,request);if(denial)return denial;
  try{const card=await robotExplorerDetail(locals,url.searchParams.get('id')??'');if(!card)return new Response(null,{status:404});
    const href=`https://superii.site/robots?${card.record_type==='company'?'company':'product'}=${card.id}`;
    const svg=await QRCode.toString(href,{type:'svg',errorCorrectionLevel:'M',margin:2,width:180});
    return new Response(svg,{headers:{'content-type':'image/svg+xml','cache-control':'public, max-age=300','x-content-type-options':'nosniff'}});
  }catch{return new Response(null,{status:503,headers:{'cache-control':'no-store'}});}
};
