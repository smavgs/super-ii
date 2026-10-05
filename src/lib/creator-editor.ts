import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';
import { CARD_MAX_BYTES, creatorTemplate, readCard, suggestedSlug, uploadPath } from './creator-card';
import { renderRepositoryMarkdown, type CardFile } from './repository-markdown';
import { createUploader } from './creator-upload';
import { translateCreator } from './creator-localization';

type QueuedFile = { file: File; path: string; state: string; done: boolean };
export function initializeCreatorEditors() {
  document.querySelectorAll<HTMLFormElement>('[data-creator-editor]').forEach(form => {
    if (form.dataset.initialized) return;
    form.dataset.initialized = 'true';
    const context = { repositoryId: form.dataset.repositoryId ?? '', revisionId: form.dataset.revisionId ?? '', branchId: form.dataset.branchId ?? '' };
    let version = Number(form.dataset.version ?? 0);
    let queue: QueuedFile[] = [];
    let busy = false;
    let dirty = false;
    const markDirty = () => { dirty = true; form.dataset.dirty = 'true'; };
    let pause = false;
    let manualSlug = false;
    let readmeSha = form.dataset.readmeSha ?? '';
    const originalFiles = JSON.parse(form.dataset.cardFiles ?? '[]') as CardFile[];
    const localImages = new Map<string, CardFile>();
    const t = (text: string, values: Record<string, string | number> = {}) => translateCreator(text, form.dataset.locale, values);
    const upload = createUploader(context, t);
    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
    const value = (name: string) => field(name)?.value ?? '';
    const status = form.querySelector<HTMLElement>('[data-creator-status]')!;
    const progress = form.querySelector<HTMLProgressElement>('[data-creator-progress]');
    const save = form.querySelector<HTMLButtonElement>('[data-save-creator]');
    const pauseButton = form.querySelector<HTMLButtonElement>('[data-pause-upload]');
    const page = form.querySelector<HTMLDetailsElement>('[data-page-panel]')!;
    const list = form.querySelector<HTMLElement>('[data-upload-queue]');
    const note = form.querySelector<HTMLElement>('[data-selection-status]');
    const api = (suffix: string) => `/api/repositories/${context.repositoryId}/${suffix}?branch=${encodeURIComponent(context.branchId)}`;
    const localHref = (href: string) => form.dataset.locale === 'ru' ? `/ru${href}` : form.dataset.locale === 'zh-CN' ? `/zh-cn${href}` : href;
    async function post(url: string, body: unknown) {
      const response = await fetch(url,{method:'POST', headers:{'content-type':'application/json'},body:JSON.stringify(body)});
      const result = await response.json() as Record<string, unknown>;
      if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : t('Could not save. Please retry.'));
      return result;
    }
    function message(text: string, error = false) {
      status.textContent = text;
      status.dataset.state = error ? 'error' : 'success';
    }
    function preview() {
      const title = form.querySelector('[data-preview-title]');
      const summary = form.querySelector('[data-preview-summary]');
      const card = form.querySelector('[data-card-preview]');
      if (title) title.textContent = value('title') || t('Your page title');
      if (summary) summary.textContent = value('summary');
      if (card) card.innerHTML = renderRepositoryMarkdown(value('card_markdown'), {
        files: [...originalFiles.filter(file => !localImages.has(file.path)), ...localImages.values()],
        sourceUrl: form.dataset.sourceUrl,
      });
      const imageSelect=form.querySelector('[data-insert-image]') as unknown as HTMLSelectElement | null;
      if(imageSelect){
        imageSelect.replaceChildren(new Option(t('Choose an uploaded image'),''));
        for(const file of [...originalFiles,...localImages.values()].filter(file=>['image/png','image/jpeg','image/webp','image/gif'].includes(file.mime_type ?? ''))){
          const option = new Option(file.path,file.path); option.dataset.noTranslate=''; imageSelect.add(option);
        }
      }
    }
    function renderQueue() {
      if (!list) return;
      const count = form.querySelector('[data-file-count]');
      if (count) count.textContent = t('{count} files',{count:new Set([...originalFiles.map(file=>file.path),...queue.map(file=>file.path)]).size});
      list.replaceChildren();
      for (const item of queue) {
        const row = document.createElement('li');
        const name = document.createElement('span'); name.dataset.noTranslate=''; name.textContent = item.path;
        const state = document.createElement('small'); state.textContent = item.state;
        const remove = document.createElement('button'); remove.type='button'; remove.className='text-button';
        remove.textContent=t('Remove'); remove.dataset.noTranslate=''; remove.disabled=busy || item.done;
        remove.setAttribute('aria-label',t('Remove {path}', {path: item.path}));
        remove.addEventListener('click', () => {
          queue = queue.filter(entry => entry !== item);
          const image = localImages.get(item.path); if (image) URL.revokeObjectURL(image.url);
          localImages.delete(item.path); renderQueue(); preview();
        });
        row.appendChild(name);row.appendChild(state);row.appendChild(remove);list.appendChild(row);
      }
    }
    function suggest(name: string, suggestion: string) {
      const input = field(name);
      if (input && !input.value.trim() && suggestion) input.value=suggestion;
    }
    async function useReadme(file: File) {
      if (file.size > CARD_MAX_BYTES) throw new Error(t('This README is larger than 100 KB. Shorten it before using it as your card.'));
      const card = new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer());
      if (value('card_markdown').trim() && value('card_markdown') !== card
          && !window.confirm(t('Replace the current card with this README?'))) return false;
      field('card_markdown')!.value=card;
      const parsed = readCard(card);
      suggest('title', parsed.title); suggest('summary', parsed.summary);
      suggest('license', parsed.metadata.license ?? ''); suggest('task', parsed.metadata.pipeline_tag ?? '');
      suggest('library', parsed.metadata.library_name ?? '');
      if (!manualSlug) suggest('slug', suggestedSlug(value('title')));
      markDirty(); preview(); return true;
    }
    async function selectFiles(files: File[], folder: boolean) {
      if (busy) return;
      let skipped = 0;
      try {
        for (const file of files) {
          const path = uploadPath(file.name,file.webkitRelativePath,folder);
          if (!path || path.split('/').includes('.git') || path.endsWith('.DS_Store')) { skipped++; continue; }
          if (!file.size || file.size > 10*1024**3) throw new Error(t('{path}: choose a non-empty file up to 10 GiB.',{path}));
          if (queue.some(entry => entry.path === path)) throw new Error(t('{path} is already selected. Remove it before choosing a replacement.',{path}));
          if (path === 'README.md' && !await useReadme(file)) continue;
          queue.push({file,path,state:t('Ready to upload'),done:false});
          if (['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)) {
            localImages.set(path,{path,mime_type:file.type,url:URL.createObjectURL(file)});
          }
          if (path === 'config.json' && file.size < 100_000) {
            try {
              const config = JSON.parse(await file.text()) as Record<string, unknown>;
              if (config.vision_config) suggest('modality','image-text');
              else if (Array.isArray(config.architectures) && config.architectures.some(name => typeof name === 'string' && name.endsWith('ForCausalLM'))) {
                suggest('task','text-generation'); suggest('modality','text');
              }
            } catch { /* Configuration suggestions are optional; file checks run on upload. */ }
          }
        }
        if (folder && files[0]?.webkitRelativePath) suggest('title',files[0].webkitRelativePath.split('/')[0]);
        if (!manualSlug) suggest('slug',suggestedSlug(value('title')));
        if (note) note.textContent=t('{count} files selected. Review suggested details before saving.',{count:queue.length}) + (skipped ? ' ' + t('{count} system or invalid paths skipped.',{count:skipped}) : '');
        markDirty();
      } catch (error) { message(error instanceof Error ? error.message : t('Files could not be selected.'),true); }
      renderQueue(); preview();
    }
    for (const [selector,folder] of [['[data-choose-files]',false],['[data-choose-folder]',true]] as const) {
      const input=form.querySelector<HTMLInputElement>(selector);
      input?.addEventListener('change',async()=>{ await selectFiles(Array.from(input.files ?? []),folder); input.value=''; });
    }
    form.querySelector<HTMLInputElement>('[data-read-card]')?.addEventListener('change',async event=>{
      const input=event.currentTarget as HTMLInputElement;
      const file=input.files?.[0]; if (!file) return;
      try { await useReadme(file); page.open=true; } catch(error) { message(error instanceof Error ? error.message : t('README could not be read.'),true); }
      input.value='';
    });
    const drop=form.querySelector<HTMLElement>('[data-file-dropzone]');
    drop?.addEventListener('dragover',event=>{event.preventDefault();drop.dataset.dragging='true';});
    drop?.addEventListener('dragleave',()=>{delete drop.dataset.dragging;});
    drop?.addEventListener('drop',event=>{
      event.preventDefault(); delete drop.dataset.dragging;
      if (Array.from(event.dataTransfer?.items ?? []).some(item=>item.webkitGetAsEntry?.()?.isDirectory)) {
        message(t('Use Choose folder to preserve all nested files.'),true); return;
      }
      void selectFiles(Array.from(event.dataTransfer?.files ?? []),false);
    });
    field('slug')?.addEventListener('input',()=>{manualSlug=true;});
    field('title')?.addEventListener('input',()=>{if (!manualSlug && field('slug')) field('slug')!.value=suggestedSlug(value('title'));});
    form.addEventListener('input',()=>{markDirty();preview();});
    form.querySelector('[data-card-template]')?.addEventListener('click',()=>{
      if (value('card_markdown').trim() && !window.confirm(t('Replace the current card with a starter template?'))) return;
      field('card_markdown')!.value=creatorTemplate(value('kind'),value('title')); markDirty();preview();
    });
    const insert=(before:string,after='',placeholder='Text')=>{
      const input=field('card_markdown');if(!(input instanceof HTMLTextAreaElement))return;
      const selected=input.value.slice(input.selectionStart,input.selectionEnd)||placeholder;
      input.setRangeText(`${before}${selected}${after}`,input.selectionStart,input.selectionEnd,'end');
      input.focus();markDirty();preview();
    };
    form.querySelectorAll<HTMLButtonElement>('[data-format]').forEach(button=>button.addEventListener('click',()=>{
      if(button.dataset.format==='heading')insert('\n## ','\n','Section title');
      if(button.dataset.format==='bold')insert('**','**');
      if(button.dataset.format==='link')insert('[','](https://example.com)','Link text');
      if(button.dataset.format==='code')insert('\n```\n','\n```\n','Add your code');
      if(button.dataset.format==='table')insert('\n','\n','| Field | Value |\n| --- | --- |\n| Name | Description |');
    }));
    const insertImage = form.querySelector('[data-insert-image]') as unknown as HTMLSelectElement | null;
    insertImage?.addEventListener('change',event=>{
      const input=event.currentTarget as HTMLSelectElement;
      if(input.value)insert('\n![',`](${input.value.split('/').map(encodeURIComponent).join('/')})\n`,'Describe the image');
    });
    pauseButton?.addEventListener('click',()=>{pause=true;pauseButton.disabled=true;message(t('The queue will pause after the current file finishes.'));});
    form.querySelector<HTMLButtonElement>('[data-start-update]')?.addEventListener('click',async event=>{
      const button=event.currentTarget as HTMLButtonElement;button.disabled=true;
      try {
        if (form.dataset.demo) { message('Preview only. A real update creates a separate draft.'); return; }
        const result=await post(api('revisions'),{branch_id:context.branchId,message:'Update page and files'});
        if (typeof result.edit_href === 'string') location.assign(localHref(result.edit_href));
      } catch(error) {message(error instanceof Error ? error.message : t('Could not start an update.'),true);}
      finally {button.disabled=false;}
    });
    form.addEventListener('submit',async event=>{
      event.preventDefault();if(busy || form.dataset.editable === 'false')return;
      page.open=true;
      if(!form.reportValidity())return;
      const data=Object.fromEntries(new FormData(form).entries());
      const card=String(data.card_markdown ?? '');
      if(new TextEncoder().encode(card).length>CARD_MAX_BYTES){message(t('Keep the model card within 100 KB.'),true);return;}
      if(form.dataset.demo){message('Preview only. Your files have not been uploaded.');return;}
      busy=true;form.dataset.saving='true';pause=false;if(save)save.disabled=true;
      form.querySelectorAll<HTMLInputElement>('[type=file]').forEach(input=>input.disabled=true);
      form.querySelectorAll<HTMLFieldSetElement>('fieldset').forEach(element=>element.disabled=true);
      if(pauseButton){pauseButton.hidden=false;pauseButton.disabled=false;}
      if(progress)progress.hidden=false;
      try {
        if(!context.repositoryId){
          message(t('Creating your draft…'));
          const result=await post('/api/repositories',{...data,source_urls:[],card_markdown:''});
          context.repositoryId=String(result.repository_id);context.revisionId=String(result.revision_id);context.branchId=String(result.branch_id);
          if(typeof result.edit_href==='string')history.replaceState({},'',localHref(result.edit_href));
          ['kind','organization_id','slug'].forEach(name=>{const input=field(name);if(input)input.disabled=true;});
        }
        message(t('Checking the current draft…'));
        const current = await fetch(api('presentation'), {cache:'no-store'});
        const latest = await current.json() as {revision_id?:string;version?:number;editable?:boolean};
        if(!current.ok || latest.revision_id!==context.revisionId || latest.version!==version || !latest.editable){
          throw new Error(t('The draft changed in another tab. Reload it before uploading or saving.'));
        }
        for(const item of queue){
          if(item.done)continue;
          item.state=t('Uploading and checking…');renderQueue();
          try {
            await upload(item.file,item.path,status,progress);
            item.done=true;item.state=t('Uploaded · checks passed');
            if(item.path==='README.md')readmeSha=bytesToHex(sha256(new Uint8Array(await item.file.arrayBuffer())));
          }catch(error){item.state=t('Needs attention · retry to resume');throw error;}
          renderQueue();
          if(pause){message(t('Paused. Save draft resumes the remaining files.'));return;}
        }
        const cardSha=bytesToHex(sha256(new TextEncoder().encode(card)));
        if(card && cardSha!==readmeSha){
          await upload(new File([card],'README.md',{type:'text/markdown',lastModified:0}),'README.md',status,progress);
          readmeSha=cardSha;
        }
        const saved=await post(api('presentation'),{...data,card_markdown:card,revision_id:context.revisionId,version});
        version=Number(saved.version);dirty=false;delete form.dataset.dirty;busy=false;
        message(t('Draft saved. Review the publication checks when you are ready.'));
        location.assign(localHref(`/repositories/${context.repositoryId}/edit?branch=${encodeURIComponent(context.branchId)}#publication`));
      }catch(error){message(error instanceof Error ? error.message : t('Could not save. Retry to resume.'),true);}
      finally{
        busy=false;delete form.dataset.saving;if(save){save.disabled=false;save.textContent=t('Save draft');}
        if(pauseButton)pauseButton.hidden=true;
        form.querySelectorAll<HTMLInputElement>('[type=file]').forEach(input=>input.disabled=false);
        form.querySelectorAll<HTMLFieldSetElement>('fieldset').forEach(element=>element.disabled=false);
        renderQueue();
      }
    });
    window.addEventListener('beforeunload',event=>{if(dirty||busy)event.preventDefault();});
    preview();
  });
}
