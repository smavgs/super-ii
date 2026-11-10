export async function api<T=any>(path:string,body?:unknown):Promise<T>{
 const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:body===undefined?{}:{'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const data=await response.json().catch(()=>({error:'Please try again shortly.'}));
 if(response.status===401){location.assign('/sign-in?redirect_url='+encodeURIComponent(location.pathname+location.search));throw new Error('Sign in to continue.');}
 if(!response.ok)throw new Error((data as {error?:string}).error??'Please try again shortly.');return data as T;
}
export function status(text:string,error=false,root:ParentNode=document){const el=root.querySelector<HTMLElement>('[data-status]');if(el){el.textContent=text;el.dataset.error=String(error);}}
export function node<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string,className?:string){const el=document.createElement(tag);if(text!==undefined)el.textContent=text;if(className)el.className=className;return el;}
export const memberApi=(body:unknown)=>api('/api/aliens-list/member',body);

export function append(parent:Node,...children:Node[]){for(const child of children)parent.appendChild(child);}
