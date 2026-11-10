import { z } from 'zod';
export const hardwareCategories = { gpu:'GPUs', mac:'Macs', workstation:'PCs & workstations', server:'Servers', edge:'Edge devices', robotics:'Robotics & components', storage:'Storage, RAM & chips', other:'Other AI hardware' } as const;
export const eventCategories = { ai:'AI & open source', 'robotics-event':'Robotics', 'hardware-event':'Hardware & semiconductors', makers:'Makers & meetups', hackathon:'Hackathons' } as const;
export const categories = {...hardwareCategories,...eventCategories};
export const conditions = {used:'Used',refurbished:'Refurbished','open-box':'Open box'} as const;
export const deliveryOptions = {pickup:'Local pickup',domestic:'Domestic shipping',international:'International shipping'} as const;
const optionalUrl = z.string().max(2048).refine(v=>!v || (()=>{try{const u=new URL(v);return u.protocol==='https:'&&!u.username&&!u.password&&!u.hash;}catch{return false;}})(),'Use a full HTTPS link.').default('');
const date = z.string().max(40).refine(v=>!v||Number.isFinite(Date.parse(v)),'Choose a valid date.').default('');
export const listingDocument = z.object({
 kind:z.enum(['sale','wanted','event']).default('sale'),title:z.string().trim().max(120).default(''),description:z.string().trim().max(6000).default(''),
 category:z.enum(['',...Object.keys(categories)] as [string,...string[]]).default(''),condition:z.enum(['','used','refurbished','open-box']).default('used'),
 amount:z.number().finite().min(0).max(1e9).nullable().default(null),currency:z.string().regex(/^[A-Z]{3}$/).default('USD'),negotiable:z.boolean().default(false),
 delivery:z.array(z.enum(['pickup','domestic','international'])).max(3).default(['pickup']),
 city:z.string().trim().max(100).default(''),country:z.string().regex(/^([A-Z]{2})?$/).default(''),area:z.string().trim().max(100).default(''),
 lat:z.number().finite().min(-90).max(90).nullable().default(null),lon:z.number().finite().min(-180).max(180).nullable().default(null),
 specs:z.object({brand:z.string().max(160).optional(),model:z.string().max(160).optional(),ram:z.string().max(160).optional(),vram:z.string().max(160).optional(),chip:z.string().max(160).optional(),storage:z.string().max(160).optional()}).strict().default({}),
 photos:z.array(z.string().regex(/^[a-f0-9]{64}$/)).max(8).default([]),original_photos:z.boolean().default(false),business:z.boolean().default(false),
 all_day:z.boolean().default(false),starts_at:date,ends_at:date,timezone:z.string().max(80).default(''),registration_url:optionalUrl,organizer:z.string().max(160).default(''),source_url:optionalUrl,
}).strict().refine(d=>(d.lat===null)===(d.lon===null),'Choose an approximate location.');
export type ListingDocument=z.infer<typeof listingDocument>;
export type Listing={id:string;document:ListingDocument;status:string;source_kind:string;version:number;published_at:string|null;expires_at:string|null;updated_at:string;owned:boolean;seller:{id:string;handle:string;name:string;joined_at:string}};
export const searchFilters=z.object({kind:z.enum(['hardware','sale','wanted','event']).optional(),category:z.enum(Object.keys(categories) as [string,...string[]]).optional(),q:z.string().trim().max(160).optional(),city:z.string().trim().max(100).optional(),condition:z.enum(['used','refurbished','open-box']).optional(),shipping:z.enum(['pickup','domestic','international']).optional(),lat:z.number().finite().min(-90).max(90).optional(),lon:z.number().finite().min(-180).max(180).optional(),radius:z.number().finite().min(1).max(20000).optional(),max_price:z.number().finite().min(0).max(1e9).optional(),currency:z.string().regex(/^[A-Z]{3}$/).optional()}).strict().refine(f=>(f.lat===undefined)===(f.lon===undefined)).refine(f=>f.max_price===undefined||!!f.currency);
export type SearchFilters=z.infer<typeof searchFilters>;
export function parseFilters(params:URLSearchParams):SearchFilters {
 const raw:Record<string,unknown>={};
 for(const key of ['kind','category','q','city','condition','shipping','lat','lon','radius','max_price','currency']) { const v=params.get(key); if(v) raw[key]=['lat','lon','radius','max_price'].includes(key)?Number(v):v; }
 return searchFilters.parse(raw);
}
export function filterHref(filters:SearchFilters) { const p=new URLSearchParams(); for(const [k,v] of Object.entries(filters)) if(v!==undefined&&v!=='') p.set(k,String(v));return '/aliens-list?'+p; }
export function priceLabel(d:ListingDocument,locale='en') {
 if(d.amount===null)return d.kind==='event'?'See event details':d.kind==='wanted'?'Budget open':'Ask member';
 if(d.amount===0)return d.kind==='wanted'?'Wanted · free':'Free';
 let amount:string;try{amount=new Intl.NumberFormat(locale,{style:'currency',currency:d.currency,maximumFractionDigits:2}).format(d.amount);}catch{amount=`${d.currency} ${d.amount}`;}
 return `${d.kind==='wanted'?'Up to ':''}${amount}${d.negotiable?' · negotiable':''}`;
}
export function publicationIssues(d:ListingDocument):string[] {
 const issues:string[]=[];
 if(d.title.length<6)issues.push('Add a title of at least 6 characters.');
 if(d.description.length<20)issues.push('Describe the item or event in at least 20 characters.');
 if(!d.category)issues.push('Choose a category.');
 if(d.city.length<2||!d.country||d.lat===null||d.lon===null)issues.push('Choose a city and approximate map location.');
 if(d.kind==='sale'&&(!d.condition||d.amount===null||d.photos.length<2||!d.original_photos))issues.push('For sale: add a price (0 for Free), condition, and two different original photos. Confirm they show your item.');
 if(d.kind!=='event'&&!d.delivery.length)issues.push('Choose pickup or a shipping option.');
 if(d.kind==='event') {
  if(!Object.hasOwn(eventCategories,d.category))issues.push('Choose an event category.');
  if(!d.organizer||!d.registration_url)issues.push('Add the organizer and official event link.');
  if(!['san francisco','shenzhen'].includes(d.city.toLowerCase())||!((d.city.toLowerCase()==='san francisco'&&d.country==='US')||(d.city.toLowerCase()==='shenzhen'&&d.country==='CN')))issues.push('Events currently cover San Francisco and Shenzhen.');
  if(!d.starts_at||!d.ends_at||Date.parse(d.ends_at)<=Date.now()||Date.parse(d.ends_at)<=Date.parse(d.starts_at)||Date.parse(d.ends_at)-Date.parse(d.starts_at)>31*864e5)issues.push('Choose upcoming start and end times, no more than 31 days apart.');
  try{new Intl.DateTimeFormat('en',{timeZone:d.timezone});}catch{issues.push('Choose a valid event time zone.');}
 }else if(!Object.hasOwn(hardwareCategories,d.category))issues.push('Choose a hardware category.');
 return issues;
}
