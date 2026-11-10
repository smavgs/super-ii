import {initLocationMap} from './map';
import {memberApi,status} from './shared';
const map=initLocationMap();
const form=document.querySelector<HTMLFormElement>('[data-browse-form]');
form?.addEventListener('submit',event=>{event.preventDefault();const data=new FormData(form);const params=new URLSearchParams();for(const [k,v] of data.entries())if(typeof v==='string'&&v)params.set(k,v);
 if(!params.get('lat')||!params.get('lon')){params.delete('lat');params.delete('lon');params.delete('radius');if(params.get('place'))params.set('city',params.get('place')!);}
 if(!params.get('max_price'))params.delete('currency');location.assign('/aliens-list?'+params);
});
document.querySelector<HTMLButtonElement>('[data-map-toggle]')?.addEventListener('click',async event=>{const button=event.currentTarget as HTMLButtonElement;const open=button.getAttribute('aria-pressed')!=='true';button.setAttribute('aria-pressed',String(open));button.textContent=open?'List':'Map';document.querySelector<HTMLElement>('[data-discovery]')!.dataset.view=open?'map':'list';(await map).refresh();});
document.querySelector<HTMLButtonElement>('[data-save-search]')?.addEventListener('click',async event=>{const button=event.currentTarget as HTMLButtonElement;const filters=JSON.parse(button.dataset.filters??'{}');const name=[filters.q,filters.category,document.querySelector<HTMLInputElement>('[data-city-query]')?.value,filters.kind==='event'?'Events':'Hardware'].filter(Boolean).join(' · ').slice(0,100);button.disabled=true;
 try{await memberApi({action:'search',id:crypto.randomUUID(),name,filters,remove:false});status('Search saved. New matches will appear in your bell.');button.textContent='✓ Search saved';}catch(e){status((e as Error).message,true);button.disabled=false;}
});
