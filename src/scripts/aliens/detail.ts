import {initLocationMap} from './map';
import {memberApi,status} from './shared';
void initLocationMap();
const listing=document.querySelector<HTMLElement>('[data-detail-id]')?.dataset.detailId;
let pendingId=crypto.randomUUID();
document.querySelector<HTMLFormElement>('[data-contact-form]')?.addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget as HTMLFormElement;const button=form.querySelector('button')!;button.disabled=true;try{const result=await memberApi({action:'message',id:pendingId,listing,thread:null,body:String(new FormData(form).get('message')??'')});pendingId=crypto.randomUUID();location.assign('/aliens-list/mine?tab=messages&thread='+result.thread_id);}catch(e){status((e as Error).message,true);}finally{button.disabled=false;}});
document.querySelector<HTMLFormElement>('[data-report-form]')?.addEventListener('submit',async event=>{event.preventDefault();const form=event.currentTarget as HTMLFormElement;const button=form.querySelector('button')!;button.disabled=true;const message=form.querySelector<HTMLElement>('[data-report-status]')!;try{await memberApi({action:'report',listing,message:null,reason:String(new FormData(form).get('reason')??'')});message.textContent='Report received. Thank you for helping keep this useful.';form.reset();}catch(e){message.textContent=(e as Error).message;}finally{button.disabled=false;}});
