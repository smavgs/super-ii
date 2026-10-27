export type ExplorerCard = {
  id: string; record_type: 'company' | 'product'; source: 'reference' | 'company' | 'community';
  name: string; name_zh?: string; summary?: string; category: string; country?: string; city?: string;
  company_name?: string; company_ids?: string[]; logo?: string; cover?: string; website?: string;
  family_id?: string | null; family_name?: string; product_count?: number; spec_count?: number;
  highlights?: Array<{label:string;value:string}>; source_url?: string; source_date?: string;
  details_url?: string; product_url?: string; company_url?: string; stage?: string; claimed?: boolean;
  maintained?: unknown;
};
export type ExplorerSearch = { items: ExplorerCard[]; total: number; offset: number; limit: number };
export type ExplorerQuery = { record_type:'product'|'company'; q:string; category:string; source:string; company:string|null; country:string; letter:string; limit:number; offset:number };
export function countryLabel(code:string,locale='en'){
  if(!/^[A-Z]{2}$/u.test(code))return '';
  const flag=Array.from(code).map(c=>String.fromCodePoint(127397+c.charCodeAt(0))).join('');
  try{return `${flag} ${new Intl.DisplayNames([locale],{type:'region'}).of(code)}`;}catch{return `${flag} ${code}`;}
}
export function explorerName(item:{name:string;name_zh?:string},locale:string){return locale==='zh-CN'&&item.name_zh?item.name_zh:item.name;}
