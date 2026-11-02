type Notice = {id:string;title:string;body:string;href:string|null;read_at:string|null;created_at:string;needs_action:boolean};
type Cursor = {before:string;before_id:string}|null;
type Feed = {unread:number;needs_action:number;latest:string|null;items:Notice[];next:Cursor};

function mount(root: HTMLElement) {
  if (root.dataset.mounted) return;
  root.dataset.mounted = 'true';
  const get = <T extends HTMLElement>(selector:string) => root.querySelector<T>(selector)!;
  const bell=get<HTMLButtonElement>('[data-notification-toggle]'), panel=get<HTMLElement>('[data-notification-panel]'), count=get<HTMLElement>('[data-notification-count]');
  const list=get<HTMLOListElement>('[data-notification-list]'), status=get<HTMLElement>('[data-notification-status]'), more=get<HTMLButtonElement>('[data-notification-more]');
  let filter='unread', cursor:Cursor=null, items:Notice[]=[], latest:string|null|undefined, generation=0, pending=false;
  const channel = typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel('superii-notifications') : null;
  const element = <K extends keyof HTMLElementTagNameMap>(tag:K,text='') => { const e=document.createElement(tag);e.textContent=text;return e; };
  function close() { panel.hidden=true;bell.setAttribute('aria-expanded','false'); }
  function render() {
    list.replaceChildren();
    const groups = new Map<string,Notice[]>();
    for (const item of items) { const key=item.href ?? item.id;groups.set(key,[...(groups.get(key) ?? []),item]); }
    for (const group of groups.values()) {
      const item=group[0], unread=group.filter(n=>!n.read_at), li=element('li');
      li.dataset.unread=String(unread.length>0);
      li.appendChild(element('strong',item.title + (group.length>1 ? ` · ${group.length} updates` : '')));li.appendChild(element('p',item.body));
      const time=element('time',new Date(item.created_at).toLocaleString([], {dateStyle:'medium',timeStyle:'short'}));time.dateTime=item.created_at;li.appendChild(time);
      const actions=element('div');actions.className='notification-row-actions';
      if(item.href && /^\/(?!\/)/.test(item.href)) { const link=element('a','Open ↗');link.href=item.href;actions.appendChild(link); }
      if(unread.length) {
        const read=element('button',unread.length>30?'Mark 30 read':'Mark read');read.type='button';
        read.addEventListener('click',async()=>{
          read.disabled=true;
          try {
            const response=await fetch('/api/notifications',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({ids:unread.slice(0,30).map(n=>n.id)})});
            if(!response.ok) throw new Error();
            const result=await response.json() as {marked:string[]};
            items=items.map(n=>result.marked.includes(n.id)?{...n,read_at:new Date().toISOString()}:n);
            if(filter==='unread') items=items.filter(n=>!n.read_at);
            render();status.textContent='Marked as read.';bell.focus();
            channel?.postMessage('refresh');void refresh(false,true);
          } catch {status.textContent='Could not mark this update as read. Try again.';read.disabled=false;}
        });actions.appendChild(read);
      }
      li.appendChild(actions);list.appendChild(li);
    }
    more.hidden=!cursor;
  }
  async function refresh(append=false,summary=false) {
    if(pending && summary) return;
    const version=++generation;pending=true;
    const params=new URLSearchParams({filter});
    if(summary)params.set('summary','1');
    if(append && cursor){params.set('before',cursor.before);params.set('before_id',cursor.before_id);}
    if(!summary) status.textContent='Refreshing…';
    more.disabled=true;
    try {
      const response=await fetch(`/api/notifications?${params}`,{cache:'no-store',signal:AbortSignal.timeout(15000)});
      if(response.status===401){count.hidden=true;bell.classList.remove('has-unread');items=[];list.replaceChildren();status.textContent='Sign in again to see your notifications.';return;}
      if(!response.ok)throw new Error();
      const feed=await response.json() as Feed;
      if(version!==generation)return;
      count.textContent=feed.unread>99?'99+':String(feed.unread);count.hidden=feed.unread===0;
      bell.classList.toggle('has-unread',feed.unread>0);bell.setAttribute('aria-label',feed.unread?`Notifications, ${feed.unread} unread`:'Notifications, all read');
      if(latest!==undefined && latest!==feed.latest && feed.unread>0){
        bell.classList.remove('is-ringing');requestAnimationFrame(()=>bell.classList.add('is-ringing'));
        get<HTMLElement>('[data-notification-announcement]').textContent='New activity in your work.';
      }
      latest=feed.latest;
      if(!summary){
        items=append?[...items,...feed.items.filter(n=>!items.some(old=>old.id===n.id))]:feed.items;cursor=feed.next;render();
        status.textContent=items.length ? `${feed.unread} unread · ${feed.needs_action} need your attention` : filter==='action'?'Nothing needs your attention.':filter==='unread'?'You’re all caught up.':'No notifications yet. Your work updates will appear here.';
      }
      bell.removeAttribute('data-refresh-failed');
    } catch {
      if(version!==generation)return;
      bell.dataset.refreshFailed='true';bell.setAttribute('aria-label','Notifications, refresh unavailable');
      status.textContent='Could not refresh. Your saved updates are still here. Try Refresh.';
    } finally {if(version===generation){pending=false;more.disabled=false;}}
  }
  bell.addEventListener('animationend',()=>bell.classList.remove('is-ringing'));
  bell.addEventListener('click',()=>{if(!panel.hidden){close();return;}panel.hidden=false;bell.setAttribute('aria-expanded','true');void refresh();});
  get<HTMLButtonElement>('[data-notification-close]').addEventListener('click',()=>{close();bell.focus();});
  root.querySelectorAll<HTMLButtonElement>('[data-notification-filter]').forEach(button=>button.addEventListener('click',()=>{
    filter=button.dataset.notificationFilter!;cursor=null;items=[];
    root.querySelectorAll('[data-notification-filter]').forEach(other=>other.setAttribute('aria-pressed',String(other===button)));void refresh();
  }));
  more.addEventListener('click',()=>void refresh(true));
  get<HTMLButtonElement>('[data-notification-refresh]').addEventListener('click',()=>void refresh());
  document.addEventListener('pointerdown',event=>{if(!root.contains(event.target as Node))close();});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.hidden){close();bell.focus();}});
  const sync=()=>{if(!document.hidden&&navigator.onLine)void refresh(false,Boolean(panel.hidden));};
  document.addEventListener('visibilitychange',sync);window.addEventListener('online',sync);window.addEventListener('focus',sync);
  window.addEventListener('superii:notifications-changed',()=>{channel?.postMessage('refresh');sync();});
  if(channel) channel.onmessage=sync;
  setInterval(sync,30000);void refresh(false,true);
}
document.querySelectorAll<HTMLElement>('[data-notifications]').forEach(mount);
// Clerk may mount a signed-in header after the initial script has run.
const observer=new MutationObserver(()=>document.querySelectorAll<HTMLElement>('[data-notifications]:not([data-mounted])').forEach(mount));
observer.observe(document.body,{childList:true,subtree:true});
