import {translateProduct} from '@/lib/product-localization';
type Inquiry={id:string;subject_id:string;product_name:string;topic:string;message:string;reply_email:string;status:string;created_at:string;sender_name:string};
function append(parent:Node,...children:Node[]){for(const child of children)parent.appendChild(child);}
const t=(s:string)=>translateProduct(s,document.documentElement.lang);
for(const root of document.querySelectorAll<HTMLElement>('[data-robot-inbox]')){
 let offset=0;const status=root.querySelector<HTMLElement>('[data-inbox-status]')!;const next=root.querySelector<HTMLButtonElement>('[data-inbox-next]');const previous=root.querySelector<HTMLButtonElement>('[data-inbox-previous]');
 const text=(tag:string,value:string)=>{const el=document.createElement(tag);el.textContent=value;return el;};
 async function load(){const r=await fetch(`/api/robots/inquiries?organization_id=${root.dataset.inboxOrganization}&offset=${offset}`);if(!r.ok)throw new Error();const data=await r.json() as {total:number;new:number;items:Inquiry[]};const holder=root.querySelector('[data-inbox-items]')!;holder.replaceChildren();
  root.querySelector('[data-inbox-count]')!.textContent=`${data.total} ${t('inquiries')} · ${data.new} ${t('new')}`;
  for(const item of data.items){const row=text('article','');row.className='robot-inbox-card';append(row,text('h3',item.product_name),text('small',`${item.sender_name} · ${t(item.topic)} · ${new Date(item.created_at).toLocaleDateString()} · ${t(item.status)}`),text('p',item.message));
   const actions=text('div','');actions.className='button-row';const mail=document.createElement('a');mail.className='button robot-action-mint';mail.textContent=t('Reply by email')+' ↗';mail.href=`mailto:${item.reply_email}?subject=${encodeURIComponent(item.product_name+' · Super ii inquiry')}&body=${encodeURIComponent('Regarding your inquiry:\n\n'+item.message)}`;append(actions,mail);
   for(const [state,label]of [['replied','Mark replied'],['archived','Archive']]){const button=document.createElement('button');button.type='button';button.textContent=t(label);button.className='button button--secondary';button.dataset.inquiryStatus=state;button.dataset.inquiryId=item.id;append(actions,button);}append(row,actions);append(holder,row);
  }if(next)next.hidden=offset+30>=data.total;if(previous)previous.hidden=offset===0;
 }
 root.addEventListener('click',async e=>{const button=(e.target as Element).closest<HTMLButtonElement>('[data-inquiry-id]');if(!button)return;button.disabled=true;
  try{const r=await fetch('/api/robots/inquiries',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({action:'status',id:button.dataset.inquiryId,status:button.dataset.inquiryStatus})});if(!r.ok)throw new Error();await load();status.textContent=t('Saved.');}catch{status.textContent=t('Please try again.');}finally{button.disabled=false;}
 });
 previous?.addEventListener('click',async()=>{previous.disabled=true;const old=offset;offset=Math.max(0,offset-30);try{await load();}catch{offset=old;status.textContent=t('Please try again.');}finally{previous.disabled=false;}});
 next?.addEventListener('click',async()=>{next.disabled=true;offset+=30;try{await load();}catch{offset-=30;status.textContent=t('Please try again.');}finally{next.disabled=false;}});
}
