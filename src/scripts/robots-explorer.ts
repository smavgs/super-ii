import { countryLabel, explorerName, type ExplorerCard, type ExplorerSearch, type ExplorerQuery } from '@/lib/robot-explorer-ui';
import { robotExplorerText } from '@/lib/robot-explorer-localization';
type Spec={label:string;formatted?:string;value?:unknown;unit?:string;group?:string;conditions?:string;evidenceKind?:string;conflict?:boolean;sources?:Array<{url:string;title?:string}>;source_url?:string};
type Detail=ExplorerCard&{description?:{en?:string;zh?:string};images?:Array<{url:string;alt?:string;source_url?:string}>;specs?:Spec[];resources?:Array<{url:string;label:string;kind?:string}>;variants?:Array<{id:string;name:string}>;makers?:Array<{id:string;name:string}>;status?:string;source_images?:string[];contact?:Record<string,string>};
type Connection={from:string;to:string;relationship:string;variant:string;description:string;sources:string[];checked_at:string};
const root=document.querySelector<HTMLElement>('[data-robots-explorer]');
if(root)initialize(root);
function initialize(root:HTMLElement){
  const locale=root.dataset.locale??'en';const t=(s:string)=>robotExplorerText(s,locale);
  const $=<T extends HTMLElement=HTMLElement>(s:string)=>root.querySelector<T>(s)!;
  const initial=JSON.parse(root.dataset.initial??'{}') as {products:ExplorerSearch;companies:ExplorerSearch;query:ExplorerQuery};
  let products=initial.products,companies=initial.companies,query=initial.query;
  let companyQuery={q:'',letter:'',offset:0};let productRequest:AbortController|null=null,companyRequest:AbortController|null=null,detailRequest:AbortController|null=null;
  const dialog=$<HTMLDialogElement>('[data-robot-detail]');const body=$('[data-detail-body]');
  let current:Detail|null=null;let tab='overview';let trail:Array<{id:string;name:string}>=[];let opener:HTMLElement|null=null;let previousOverflow='';let previousScroll={x:0,y:0};let closing=false;
  const localPath=(path:string)=>(locale==='zh-CN'?'/zh-cn':locale==='ru'?'/ru':'')+path;
  function append(parent:Node,...children:Node[]){for(const child of children)parent.appendChild(child);}
  function el<K extends keyof HTMLElementTagNameMap>(tag:K,text='',className=''){const n=document.createElement(tag);if(text)n.textContent=text;if(className)n.className=className;return n;}
  function safeLink(value:string){try{const u=new URL(value,location.origin);return (u.protocol==='https:'||u.origin===location.origin)&&!u.username&&!u.password?u.href:'';}catch{return '';}}
  function link(label:string,href:string,className=''){const a=el('a',label,className);const valid=safeLink(href);if(valid){a.href=valid;if(new URL(valid).origin!==location.origin){a.target='_blank';a.rel='noopener noreferrer';}}return a;}
  function image(url:string,alt:string){const i=el('img');i.src=safeLink(url);i.alt=alt;i.loading='lazy';i.decoding='async';i.referrerPolicy='no-referrer';i.addEventListener('error',()=>{i.dataset.failed='true';i.hidden=true;});return i;}
  function imageFailures(scope:HTMLElement){for(const i of scope.querySelectorAll<HTMLImageElement>('img')){i.addEventListener('error',()=>{i.dataset.failed='true';i.hidden=true;});if(i.complete&&!i.naturalWidth){i.dataset.failed='true';i.hidden=true;}}}
  function responsibility(item:ExplorerCard){return t(item.source==='company'?'Company maintained':item.source==='community'?'Community build':'Super ii reference');}
  function card(item:ExplorerCard){
    const company=item.record_type==='company';const a=link('',localPath(`/robots?${company?'company':'product'}=${item.id}`),'robot-explorer-card'+(company?' robot-company-tile':''));
    a.dataset.explorerOpen=item.id;a.dataset.explorerType=item.record_type;a.setAttribute('aria-label',`${explorerName(item,locale)} · ${t('Open details')}`);
    const visual=el('div','','robot-card-image');const url=company?item.logo:item.cover;if(url)append(visual,image(url,explorerName(item,locale)));
    const fallback=el('span',company?item.name.slice(0,2).toUpperCase():'◇','robot-photo-fallback');fallback.setAttribute('aria-hidden','true');append(fallback,el('small',t(company?'Logo not supplied':'Photo not yet available')));append(visual,fallback);
    const copy=el('div','','robot-card-copy');if(!company){const maker=el('span','','robot-card-maker');if(item.logo)append(maker,image(item.logo,''));append(maker,document.createTextNode(item.company_name??''));append(copy,maker);}
    append(copy,el('strong',item.family_name||explorerName(item,locale)),el('span',countryLabel(item.country??'',locale),'robot-card-country'));
    if(!company){const facts=el('div','','robot-card-facts');for(const f of (item.highlights??[]).slice(0,2)){const fact=el('span',`${t(f.label)}: ${f.value}`);fact.title=f.label;append(facts,fact);}append(copy,facts,el('span',responsibility(item)+(item.family_id?` · ${t('Family')}`:''),`robot-responsibility robot-responsibility--${item.source}`));}
    append(a,visual,copy);return a;
  }
  async function json<T>(path:string,signal?:AbortSignal):Promise<T>{const res=await fetch(path,{signal,credentials:'same-origin',headers:{Accept:'application/json'}});if(!res.ok)throw new Error('unavailable');return res.json() as Promise<T>;}
  function params(input:Record<string,unknown>){return new URLSearchParams(Object.entries(input).filter(([,v])=>v!==null&&v!==undefined&&v!=='').map(([k,v])=>[k,String(v)]));}
  function results(kind:'products'|'companies',data:ExplorerSearch){
    const gallery=$(kind==='products'?'[data-robot-gallery]':'[data-company-grid]');gallery.replaceChildren(...data.items.map(card));gallery.removeAttribute('aria-busy');
    $(`[data-${kind}-empty]`).hidden=data.items.length>0;
    $<HTMLButtonElement>(`[data-${kind}-prev]`).disabled=data.offset===0;$<HTMLButtonElement>(`[data-${kind}-next]`).disabled=data.offset+data.limit>=data.total;
    $(`[data-${kind}-page]`).textContent=`${Math.floor(data.offset/data.limit)+1} / ${Math.max(1,Math.ceil(data.total/data.limit))}`;
    if(kind==='products')$('[data-products-count]').textContent=`${data.total} ${t('results')}`;
  }
  async function loadProducts(offset=0){
    productRequest?.abort();const request=new AbortController();productRequest=request;query.offset=offset;
    $('[data-robot-gallery]').setAttribute('aria-busy','true');$('[data-explorer-error]').hidden=true;
    try{products=await json<ExplorerSearch>(`/api/robots/explore?${params({...query,company_id:query.company,view:'products'})}`,request.signal);results('products',products);
      const u=new URL(location.href);for(const key of ['q','category','source','offset']){const value=String(query[key as keyof ExplorerQuery]??'');if(value&&value!=='0')u.searchParams.set(key,value);else u.searchParams.delete(key);}history.replaceState(history.state,'',u);
    }catch(error){if(!request.signal.aborted){$('[data-explorer-error]').hidden=false;$('[data-robot-gallery]').removeAttribute('aria-busy');}}
  }
  async function loadCompanies(offset=0){
    companyRequest?.abort();const request=new AbortController();companyRequest=request;companyQuery.offset=offset;$('[data-company-grid]').setAttribute('aria-busy','true');
    try{companies=await json<ExplorerSearch>(`/api/robots/explore?${params({...companyQuery,view:'companies',category:'all',limit:12})}`,request.signal);results('companies',companies);}
    catch{if(!request.signal.aborted){$('[data-explorer-error]').hidden=false;$('[data-company-grid]').removeAttribute('aria-busy');}}
  }
  const search=$<HTMLFormElement>('[data-robot-search]');
  search.addEventListener('submit',event=>{event.preventDefault();const data=new FormData(search);query.q=String(data.get('q')??'').trim();query.category=String(data.get('category'));query.source=String(data.get('source'));void loadProducts();});
  search.querySelector<HTMLInputElement>('[name=q]')?.addEventListener('input',()=>{const field=search.querySelector('[name=category]') as unknown as HTMLSelectElement;if(field.value==='robot')field.value='all';});
  $<HTMLFormElement>('[data-company-search]').addEventListener('submit',event=>{event.preventDefault();const data=new FormData(event.currentTarget as HTMLFormElement);companyQuery={q:String(data.get('q')??'').trim(),letter:String(data.get('letter')??''),offset:0};void loadCompanies();});
  $('[data-products-prev]').addEventListener('click',()=>void loadProducts(Math.max(0,products.offset-products.limit)));
  $('[data-products-next]').addEventListener('click',()=>void loadProducts(products.offset+products.limit));
  $('[data-companies-prev]').addEventListener('click',()=>void loadCompanies(Math.max(0,companies.offset-companies.limit)));
  $('[data-companies-next]').addEventListener('click',()=>void loadCompanies(companies.offset+companies.limit));
  root.addEventListener('click',event=>{const target=(event.target as Element).closest<HTMLAnchorElement>('[data-explorer-open]');if(!target)return;if((event as MouseEvent).metaKey||(event as MouseEvent).ctrlKey||(event as MouseEvent).shiftKey)return;event.preventDefault();if(!dialog.open)opener=target;void open(target.dataset.explorerOpen!);});

  function normalized(card:ExplorerCard,reference:Detail|null):Detail{
    const d={...reference,...card} as Detail;
    if(card.record_type==='company'&&reference?.summary)d.description={en:reference.summary};
    if(card.source==='company'&&card.maintained&&typeof card.maintained==='object'){
      const maintained=card.maintained as {product?:Record<string,unknown>;company?:Record<string,string>;images?:Array<{image_url:string;alt_text:string}>}&Record<string,unknown>;
      if(card.record_type==='product'&&maintained.product){
        const p=maintained.product;d.description={en:String(p.description??''),zh:String(p.description_zh??'')};d.specs=p.specs as Spec[];d.resources=p.resources as Detail['resources'];
        d.images=(maintained.images??[]).map(i=>({url:i.image_url,alt:i.alt_text}));d.contact=maintained.company;d.website=String(p.source_url??'');
      }else if(card.record_type==='company'){d.contact=maintained as Record<string,string>;d.description={en:String(maintained.summary??''),zh:String(maintained.summary_zh??'')};}
    }
    return d;
  }
  async function open(id:string,push=true){
    if(!/^[0-9a-f-]{36}$/iu.test(id))return;
    detailRequest?.abort();const request=new AbortController();detailRequest=request;current=null;body.replaceChildren();tab='overview';$('[data-detail-status]').textContent=t('Loading…');$('[data-detail-qr-box]').hidden=true;
    for(const selector of ['#robot-detail-title','[data-detail-responsibility]','[data-detail-maker]'])$(selector).textContent='';
    if(!dialog.open){previousScroll={x:window.scrollX,y:window.scrollY};previousOverflow=document.body.style.overflow;document.body.style.overflow='hidden';dialog.showModal();}
    try{
      const c=await json<ExplorerCard>(`/api/robots/explore?id=${encodeURIComponent(id)}`,request.signal);
      const reference=c.details_url&&c.details_url===`/robot-library/records/${id}.json`?await json<Detail>(c.details_url,request.signal):null;
      if(request.signal.aborted)return;current=normalized(c,reference);
      if(push){trail.push({id,name:explorerName(c,locale)});const u=new URL(location.href);u.searchParams.delete('product');u.searchParams.delete('company');u.searchParams.set(c.record_type==='company'?'company':'product',id);history.pushState({robotDetail:id},'',u);}
      else{const index=trail.findLastIndex(x=>x.id===id);if(index>=0)trail=trail.slice(0,index+1);else trail=[{id,name:explorerName(c,locale)}];}
      $('[data-detail-trail]').textContent=trail.map(x=>x.name).join(' → ');$('[data-detail-status]').textContent='';$('#robot-detail-title').textContent=explorerName(c,locale);$('[data-detail-responsibility]').textContent=responsibility(c);
      $('[data-detail-maker]').textContent=[c.company_name,countryLabel(c.country??'',locale)].filter(Boolean).join(' · ');
      const inside=$<HTMLButtonElement>('[data-detail-tab=inside]');inside.hidden=c.record_type==='company';await render();$('#robot-detail-title').focus();
    }catch{if(!request.signal.aborted){$('[data-detail-status]').textContent=t('The catalogue is temporarily unavailable. Try again.');const retry=el('button',t('Try again'),'button button--secondary');retry.onclick=()=>void open(id,push);append(body,retry);}}
  }
  function close(update=true){
    detailRequest?.abort();closing=true;if(dialog.open)dialog.close();closing=false;document.body.style.overflow=previousOverflow;
    if(update){const u=new URL(location.href);u.searchParams.delete('product');u.searchParams.delete('company');history.replaceState({},'',u);}trail=[];current=null;opener?.focus({preventScroll:true});window.scrollTo({left:previousScroll.x,top:previousScroll.y,behavior:'instant'});
  }
  $('[data-detail-close]').addEventListener('click',()=>close());dialog.addEventListener('cancel',event=>{event.preventDefault();close();});dialog.addEventListener('close',()=>{if(!closing)close();});
  $('[data-detail-back]').addEventListener('click',()=>{if(trail.length>1)history.back();else close();});
  window.addEventListener('popstate',()=>{const u=new URL(location.href);const id=u.searchParams.get('product')||u.searchParams.get('company');if(id)void open(id,false);else close(false);});
  for(const button of root.querySelectorAll<HTMLButtonElement>('[data-detail-tab]'))button.addEventListener('click',()=>{tab=button.dataset.detailTab!;void render();});
  $('[data-detail-copy]').addEventListener('click',async()=>{try{await navigator.clipboard.writeText(location.href);$('[data-detail-status]').textContent=t('Link copied');}catch{$('[data-detail-status]').textContent=t('Copy failed. Copy the page address instead.');}});
  $('[data-detail-qr]').addEventListener('click',()=>{if(!current)return;const box=$('[data-detail-qr-box]');const img=box.querySelector('img')!;img.src=`/api/robots/qr.svg?id=${current.id}`;box.hidden=!box.hidden;});

  function linksFor(resources:NonNullable<Detail['resources']>){const links=el('div','','robot-detail-links');for(const r of resources){if(!safeLink(r.url))continue;const host=new URL(safeLink(r.url)).hostname;const badge=host==='github.com'?'GitHub · ':host==='huggingface.co'?'🤗 Hugging Face · ':'';append(links,link(badge+r.label,r.url,badge?'robot-link-brand':''));}return links;}
  function gallery(d:Detail){
    if(!d.images?.length){append(body,el('p',t('Photo not yet available')));return;}
    const box=el('div','','robot-detail-gallery');const main=link('',d.images[0].url);main.setAttribute('aria-label',t('View original'));const pic=image(d.images[0].url,d.images[0].alt||d.name);pic.loading='eager';append(main,pic);const thumbs=el('div','','robot-detail-thumbnails');thumbs.setAttribute('aria-label',t('Gallery'));
    d.images.forEach((p,i)=>{const b=el('button');b.type='button';b.setAttribute('aria-label',`${t('Gallery')} ${i+1}`);b.setAttribute('aria-pressed',String(i===0));append(b,image(p.url,p.alt||d.name));b.onclick=()=>{pic.src=safeLink(p.url);pic.hidden=false;delete pic.dataset.failed;main.href=safeLink(p.url);for(const other of thumbs.querySelectorAll('button'))other.setAttribute('aria-pressed',String(other===b));};append(thumbs,b);});append(box,main,thumbs);append(body,box);
  }
  function variant(d:Detail){if(!d.variants?.length)return;const label=el('label',t('Model variant'),'robot-detail-variant');const select=el('select');for(const v of d.variants){const option=el('option',v.name);option.value=v.id;option.selected=v.id===d.id;append(select,option);}select.onchange=()=>void open(select.value);append(label,select);append(body,label);}
  function provenance(d:Detail){const note=el('div','','robot-source-note');append(note,el('p',t('Information and photographs belong to their identified sources. Hardware has not been tested by Super ii.')));if(d.source_url)append(note,link(t('Source collection'),d.source_url));if(d.source_date)append(note,el('p',`${t('Source date')}: ${d.source_date.slice(0,10)}`));append(note,link(t('Download data'),`/api/robots/explore?id=${d.id}`));if(d.details_url)append(note,document.createTextNode(' · '),link(t('Source evidence'),d.details_url));append(body,note);}
  async function companyProducts(d:Detail){
    append(body,el('h3',t('Other products from this company')));const holder=el('div','','robot-related-grid');append(body,holder);const query=params({company_id:d.id,category:'all',limit:6});
    try{const found=await json<ExplorerSearch>(`/api/robots/explore?${query}`,detailRequest?.signal);if(current?.id!==d.id||tab!=='overview')return;holder.replaceChildren(...found.items.map(card));if(!found.items.length)append(holder,el('p',t('No matching products. Try another search or filter.')));
      if(found.total>6){const more=el('button',`${t('Next')} →`,'button button--secondary');let offset=0;more.onclick=async()=>{offset+=6;try{const page=await json<ExplorerSearch>(`/api/robots/explore?${query}&offset=${offset}`,detailRequest?.signal);if(current?.id!==d.id)return;holder.replaceChildren(...page.items.map(card));more.disabled=offset+6>=page.total;holder.scrollIntoView({block:'nearest'});}catch{more.textContent=t('Try again');offset-=6;}};append(body,more);}
    }catch{if(current?.id===d.id)append(holder,el('p',t('The catalogue is temporarily unavailable. Try again.')));}
  }
  function specs(d:Detail){
    append(body,el('h3',t('Specifications')));if(!d.specs?.length)append(body,el('p',t('No specifications supplied.')));
    const groups=new Map<string,Spec[]>();for(const s of d.specs??[]){const key=s.group||t('Specifications');groups.set(key,[...(groups.get(key)??[]),s]);}
    let groupIndex=0;for(const [name,values]of groups){const section=el('details');section.name='robot-specification-groups';section.open=groupIndex++===0;append(section,el('summary',`${name} · ${values.length}`));const table=el('table','','robot-spec-table');const tbody=el('tbody');for(const s of values){const tr=el('tr');const th=el('th',s.label);th.scope='row';const td=el('td',s.formatted??String(s.value??t('Not disclosed')));if(s.conflict)append(td,el('small',t('Conflicting source values')));if(s.conditions)append(td,el('small',s.conditions));const sources=s.sources??(s.source_url?[{url:s.source_url}]:[]);if(sources.length){const detail=el('details');append(detail,el('summary',t('Source evidence')));for(const source of sources)append(detail,link(source.title||t('View source'),source.url));append(td,detail);}append(tr,th,td);append(tbody,tr);}append(table,tbody);append(section,table);append(body,section);}
    append(body,el('h3',t('Resources')),d.resources?.length?linksFor(d.resources):el('p',t('No resources supplied.')));provenance(d);
  }
  async function inside(d:Detail){
    append(body,el('p',t('A complete parts list has not been disclosed.')));
    try{const edges=await json<Connection[]>('/robot-library/relationships.json',detailRequest?.signal);const relevant=edges.filter(e=>e.from===d.id||e.to===d.id);for(const edge of relevant){
      const target=await json<ExplorerCard>(`/api/robots/explore?id=${edge.from===d.id?edge.to:edge.from}`,detailRequest?.signal);if(current?.id!==d.id||tab!=='inside')return;
      const box=el('section','','robot-connection');append(box,el('strong',t(edge.relationship==='used-in-model'?'Used in this model':edge.relationship==='compatible-option'?'Compatible option':'Related component')),el('p',`${edge.variant}\n${edge.description}`),card(target),linksFor(edge.sources.map(url=>({url,label:t('Source evidence')}))));append(body,box);
    }}catch{if(current?.id===d.id&&tab==='inside')append(body,el('p',t('The catalogue is temporarily unavailable. Try again.')));}
    if(current?.id===d.id&&tab==='inside'){const links=el('div','','robot-detail-links');append(links,link(t('Explore components'),localPath('/robots?category=component')),link(t('Make Robot'),localPath('/robot#make')));append(body,links);}
  }
  async function render(){
    const d=current;if(!d)return;body.replaceChildren();for(const b of root.querySelectorAll<HTMLButtonElement>('[data-detail-tab]'))b.setAttribute('aria-pressed',String(b.dataset.detailTab===tab));
    if(tab==='specs'){specs(d);return;}if(tab==='inside'){await inside(d);return;}
    if(d.record_type==='product'){gallery(d);variant(d);if(d.images?.length&&d.source==='reference')append(body,el('small',t('Manufacturer imagery may show optional configurations.')));}else if(d.logo){const logo=image(d.logo,d.name);logo.width=120;logo.height=70;logo.style.objectFit='contain';append(body,logo);}
    const description=locale==='zh-CN'?d.description?.zh||d.description?.en||d.summary:d.description?.en||d.summary;if(description)append(body,el('p',description));
    if(d.record_type==='company'&&d.country)append(body,el('p',`${t('Company origin')}: ${countryLabel(d.country,locale)}${d.city?` · ${d.city}`:''}`));
    if(d.source==='community')append(body,el('p',t(d.stage==='production'?'Built':d.stage==='prototype'||d.stage==='testing'?'Prototype':'Concept')));
    if(d.record_type==='product'&&d.source==='reference')append(body,el('small',t(d.status==='unknown'?'Availability not confirmed':'Manufacturer-listed availability')+(d.status&&d.status!=='unknown'?`: ${d.status}`:'')));
    const links=el('div','','robot-detail-links');if(d.website)append(links,link(t(d.record_type==='company'?'Official website':'Product website'),d.website,'robot-main-link'));
    if(d.product_url)append(links,link(t(d.source==='community'?'Open project':'View maintained page'),localPath(d.product_url),'robot-main-link'));
    if(d.record_type==='company'){if(d.details_url)append(links,link(t(d.claimed?'Request access':'Manage this company'),localPath(`/workspace/robots/companies/${d.id}`),'robot-main-link'));if(d.company_url)append(links,link(t('View maintained page'),localPath(d.company_url)));}
    else if(d.source!=='community')for(const maker of d.makers??(d.company_ids??[]).map(id=>({id,name:d.company_name||t('Manufacturer')}))){const a=link(`${t('Manufacturer')} · ${maker.name}`,localPath(`/robots?company=${maker.id}`));a.dataset.explorerOpen=maker.id;append(links,a);}
    const contact=d.contact;if(contact?.email){const a=el('a',t('Contact company'));a.href=`mailto:${contact.email}`;append(links,a);}if(contact?.wechat)append(links,el('span',`WeChat: ${contact.wechat}`));if(contact?.phone)append(links,el('span',contact.phone));append(body,links);
    if(d.resources?.length)append(body,linksFor(d.resources.filter(r=>r.kind==='video'||/^(?:https:\/\/)(?:github\.com|huggingface\.co)\//u.test(r.url))));
    if(d.record_type==='company')await companyProducts(d);
    if(current?.id===d.id&&tab==='overview')provenance(d);
  }
  imageFailures(root);results('products',products);results('companies',companies);
  const selected=new URL(location.href).searchParams;const id=selected.get('product')||selected.get('company');if(id)void open(id,false);
}
