import { hfText as t } from '@/lib/hf-localization';

const root = document.querySelector<HTMLElement>('[data-hf-page]');
if (root) {
  const api = `/api/huggingface/${root.dataset.id}`;
  const filesPanel = root.querySelector<HTMLElement>('#files');
  const table = root.querySelector<HTMLElement>('[data-hf-files]');
  const status = root.querySelector<HTMLElement>('[data-hf-files-status]');
  const downloadStatus = root.querySelector<HTMLElement>('[data-hf-download-status]');
  const previous = root.querySelector<HTMLButtonElement>('[data-hf-previous]');
  const nextButton = root.querySelector<HTMLButtonElement>('[data-hf-next]');
  const up = root.querySelector<HTMLButtonElement>('[data-hf-up]');
  let current = {path:'',cursor:''};
  let history: typeof current[] = [];
  let next = '', busy = false, loaded = false;
  type File = {type:'file'|'directory';path:string;size:number;oid:string;sha256?:string};
  const bytes = (size: number) => size >= 1024**3 ? `${(size/1024**3).toFixed(2)} GiB` : size >= 1024**2 ? `${(size/1024**2).toFixed(1)} MiB` : size >= 1024 ? `${(size/1024).toFixed(1)} KiB` : `${size} B`;
  async function result(response: Response) {
    const data = await response.json() as Record<string,unknown>;
    if (!response.ok) throw new Error(t(typeof data.error === 'string' ? data.error : 'Please try again later.'));
    return data;
  }
  async function load(path='', cursor='', back: typeof history = []) {
    if (busy || !table) return;
    busy = true; table.setAttribute('aria-busy','true');
    if (status) status.textContent = t('Loading source files…');
    try {
      const data = await result(await fetch(`${api}/files?${new URLSearchParams({path,cursor})}`)) as {files:File[];next:string};
      const rows = document.createDocumentFragment();
      for (const file of data.files) {
        const row = document.createElement('tr');
        const name = document.createElement('td');
        const size = document.createElement('td');
        const action = document.createElement('td');
        const filename = file.path.split('/').at(-1)!;
        name.setAttribute('data-no-translate','');
        size.setAttribute('data-no-translate','');
        if (file.type === 'directory') {
          const open = document.createElement('button');
          open.type = 'button'; open.textContent = `▸ ${filename}`;
          open.addEventListener('click',()=>void load(file.path)); name.appendChild(open);
          size.textContent = '—'; action.textContent = t('Folder');
        } else {
          name.textContent = filename;
          const checksum = document.createElement('small');
          checksum.textContent = `${file.sha256 ? 'SHA-256' : 'Git SHA'} ${(file.sha256 ?? file.oid).slice(0,12)}…`;
          checksum.title = file.sha256 ?? file.oid; name.appendChild(checksum);
          size.textContent = bytes(file.size);
          const download = document.createElement('a');
          download.href = `${api}/download?${new URLSearchParams({path:file.path})}`;
          download.download = filename; download.textContent = `↓ ${t('Download')}`;
          download.setAttribute('aria-label',`${t('Download')} ${filename}`);
          download.addEventListener('click',async event=>{
            if (event.button !== 0 || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
            event.preventDefault(); if (download.dataset.busy) return;
            download.dataset.busy = 'true'; download.setAttribute('aria-busy','true');
            if (downloadStatus) downloadStatus.textContent = t('Checking file availability…');
            try {
              const response = await fetch(download.href,{method:'HEAD'});
              if (!response.ok) throw new Error(t(response.status === 403 ? 'This source requires access on Hugging Face.' : 'Download unavailable. Please retry.'));
              const start = document.createElement('a'); start.href=download.href; start.download=filename;
              document.body.appendChild(start); start.click(); start.remove();
              if (downloadStatus) downloadStatus.textContent = t('Download requested. Follow progress in your browser’s downloads.');
            } catch(error) { if(downloadStatus) downloadStatus.textContent = error instanceof Error ? error.message : t('Download unavailable. Please retry.'); }
            finally { delete download.dataset.busy; download.removeAttribute('aria-busy'); }
          });
          action.appendChild(download);
        }
        row.appendChild(name); row.appendChild(size); row.appendChild(action); rows.appendChild(row);
      }
      table.replaceChildren(rows); current={path,cursor}; history=back; next=data.next; loaded=true;
      if(previous) previous.hidden = history.length === 0;
      if(nextButton) nextButton.hidden = !next;
      if(up) up.hidden = !path;
      const folder = root!.querySelector<HTMLElement>('[data-hf-folder]'); if(folder) folder.textContent = '/'+path;
      const page = root!.querySelector<HTMLElement>('[data-hf-file-page]'); if(page) page.textContent = `${t('Page')} ${history.length+1}${next ? ' · '+t('More files available') : ''}`;
      if(status) status.textContent = data.files.length ? t('Choose a folder or download a file.') : t('This folder is empty.');
    } catch(error) { if(status) status.textContent = error instanceof Error ? error.message : t('Please try again later.'); }
    finally { busy=false; table.removeAttribute('aria-busy'); }
  }
  root.querySelector('[data-hf-root]')?.addEventListener('click',()=>void load());
  up?.addEventListener('click',()=>void load(current.path.split('/').slice(0,-1).join('/')));
  nextButton?.addEventListener('click',()=>void load(current.path,next,[...history,current]));
  previous?.addEventListener('click',()=>{const previousPage=history.at(-1);if(previousPage) void load(previousPage.path,previousPage.cursor,history.slice(0,-1));});
  const maybeLoad = () => { if(table && filesPanel && !filesPanel.hidden && !loaded && !busy) void load(); };
  if(filesPanel) new MutationObserver(maybeLoad).observe(filesPanel,{attributes:true,attributeFilter:['hidden']});
  queueMicrotask(maybeLoad);

  const launch = root.querySelector<HTMLButtonElement>('[data-hf-launch]');
  const stop = root.querySelector<HTMLButtonElement>('[data-hf-stop]');
  const appStatus = root.querySelector<HTMLElement>('[data-hf-app-status]');
  const frame = root.querySelector<HTMLElement>('[data-hf-frame]');
  async function openApp() {
    if(!launch || !frame || launch.disabled || frame.querySelector('iframe')) return;
    launch.disabled=true; if(appStatus) appStatus.textContent=t('Checking app availability…');
    try {
      const data = await result(await fetch(`${api}/app`)) as {url:string;title:string};
      if(data.url !== root!.dataset.frameOrigin) throw new Error(t('The source address changed. Reload this page or open the source link.'));
      const iframe=document.createElement('iframe'); iframe.title=data.title; iframe.referrerPolicy='no-referrer';
      iframe.setAttribute('sandbox','allow-scripts allow-forms allow-same-origin allow-downloads');
      iframe.allow='fullscreen'; iframe.src=data.url;
      frame.hidden=false; frame.replaceChildren(iframe); launch.hidden=true; if(stop) stop.hidden=false;
      if(appStatus) appStatus.textContent=t('Hosted by Hugging Face. Use the source link if the app does not load.');
    } catch(error) { if(appStatus) appStatus.textContent=error instanceof Error ? error.message : t('Please try again later.'); }
    finally {launch.disabled=false;}
  }
  launch?.addEventListener('click',()=>void openApp());
  root.querySelector('[data-hf-open]')?.addEventListener('click',()=>void openApp());
  stop?.addEventListener('click',()=>{frame?.replaceChildren();if(frame)frame.hidden=true;if(launch)launch.hidden=false;stop.hidden=true;if(appStatus)appStatus.textContent='';});

  const editor=root.querySelector<HTMLFormElement>('[data-hf-editor]');
  editor?.addEventListener('submit',async event=>{
    event.preventDefault();const button=editor.querySelector<HTMLButtonElement>('button[type=submit]');
    const message=editor.querySelector<HTMLElement>('[data-hf-editor-status]');
    if(button)button.disabled=true;if(message)message.textContent=t('Saving…');
    try {await result(await fetch(api,{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify(Object.fromEntries(new FormData(editor)))}));if(message)message.textContent=t('Saved. Reload the page to see your updated listing.');}
    catch(error){if(message)message.textContent=error instanceof Error ? error.message : t('Could not save. Please retry.');}
    finally{if(button)button.disabled=false;}
  });
}
