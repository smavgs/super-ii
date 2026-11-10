import {append} from './shared';
import { listingDocument, publicationIssues, hardwareCategories, eventCategories, type ListingDocument, type Listing } from '@/lib/aliens/input';
import { initLocationMap } from './map';
import { api, status, node } from './shared';
const form = document.querySelector<HTMLFormElement>('[data-alien-editor]');
if (form) {
    let id = form.dataset.id || crypto.randomUUID(), version = Number(form.dataset.version), saved = version > 0, busy = false, dirty = false;
    let documentValue = listingDocument.parse(JSON.parse(form.dataset.document ?? '{}'));
    let photos = [...documentValue.photos];
    const initial = JSON.stringify(documentValue);
    const field = (name: string) => form.elements.namedItem(name) as HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;
    const checked = (name: string) => (field(name) as HTMLInputElement).checked;
    function localDate(iso: string, zone: string) { if (!iso)
        return ''; const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)); const p = Object.fromEntries(parts.map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; }
    function utcDate(value: string, zone: string) { if (!value)
        return ''; let time = Date.parse(value + 'Z'); const target = time; for (let i = 0; i < 4; i++) {
        const rendered = Date.parse(localDate(new Date(time).toISOString(), zone) + 'Z');
        const delta = target - rendered;
        if (!delta)
            break;
        time += delta;
    } if (localDate(new Date(time).toISOString(), zone) !== value)
        throw new Error('This local time does not exist because of a daylight-saving change. Choose another time.'); return new Date(time).toISOString(); }
    function dateOnlyMode(){const only=checked('all_day');for(const name of ['event_start','event_end']){const input=field(name) as HTMLInputElement;const value=input.value;input.type=only?'date':'datetime-local';input.value=only?value.slice(0,10):value.length===10?value+'T09:00':value;}}
    field('all_day').addEventListener('change',dateOnlyMode);
    if (documentValue.starts_at)
        field('event_start').value = localDate(documentValue.starts_at, documentValue.timezone);
    if (documentValue.ends_at)
        field('event_end').value = localDate(documentValue.all_day?new Date(Date.parse(documentValue.ends_at)-864e5).toISOString():documentValue.ends_at, documentValue.timezone);
    dateOnlyMode();
    function read(): ListingDocument {
        const data = new FormData(form!);
        const kind = String(data.get('kind')) as ListingDocument['kind'];
        const val = (name: string) => String(data.get(name) ?? '').trim();
        const specs: Record<string, string> = {};
        for (const key of ['brand', 'model', 'ram', 'vram', 'chip', 'storage']) {
            const value = val('spec_' + key);
            if (value)
                specs[key] = value;
        }
        const timezone = val('timezone');
        return listingDocument.parse({ kind, title: val('title'), description: val('description'), category: val('category'), condition: val('condition'), amount: val('amount') === '' ? null : Number(val('amount')), currency: val('currency'), negotiable: checked('negotiable'), delivery: kind === 'event' ? [] : data.getAll('delivery'), city: val('city'), country: val('country'), area: val('area'), lat: val('lat') === '' ? null : Number(val('lat')), lon: val('lon') === '' ? null : Number(val('lon')), specs, photos, original_photos: checked('original_photos'), business: checked('business'), all_day: kind === 'event' && checked('all_day'), organizer: kind === 'event' ? val('organizer') : '', registration_url: kind === 'event' ? val('registration_url') : '', timezone: kind === 'event' ? timezone : '', starts_at: kind === 'event' ? utcDate(val('event_start')+(checked('all_day')&&val('event_start')?'T00:00':''), timezone) : '', ends_at: kind === 'event' ? utcDate(checked('all_day')&&val('event_end')?new Date(Date.parse(val('event_end')+'T00:00:00Z')+864e5).toISOString().slice(0,10)+'T00:00':val('event_end'), timezone) : '', source_url: documentValue.source_url });
    }
    function updateKind() {
        const kind = (new FormData(form!)).get('kind') as string;
        form!.querySelectorAll<HTMLElement>('[data-kind-field]').forEach(el => el.hidden = el.dataset.kindField !== (kind === 'event' ? 'event' : 'hardware'));
        const select = field('category') as HTMLSelectElement;
        Array.from(select.options).forEach(option => { const hide = !!option.value && !Object.hasOwn(kind === 'event' ? eventCategories : hardwareCategories, option.value); option.hidden = hide; option.disabled = hide; });
        if (select.selectedOptions[0]?.disabled)
            select.value = '';
        const price = form!.querySelector<HTMLElement>('[data-price-label]')!;
        price.firstChild!.textContent = kind === 'wanted' ? 'Maximum budget · optional' : kind === 'event' ? 'Entry price · optional' : 'Price · 0 for Free';
    }
    form.querySelectorAll<HTMLInputElement>('[name=kind]').forEach(el => el.addEventListener('change', updateKind));
    updateKind();
    function renderPhotos() { const grid = form!.querySelector('[data-photo-grid]')!; grid.replaceChildren(); photos.forEach((hash, index) => { const wrap = node('div'), image = node('img'), remove = node('button', '×'); image.src = `/api/aliens-list/media/${id}/${hash}.jpg`; image.alt = `Your photo ${index + 1}`; remove.type = 'button'; remove.setAttribute('aria-label', `Remove photo ${index + 1}`); remove.addEventListener('click', () => { if (busy)
        return; photos = photos.filter(h => h !== hash); dirty = true; renderPhotos(); }); append(wrap, image, remove); append(grid, wrap); }); }
    renderPhotos();
    function lock(value: boolean) { busy = value; form!.querySelectorAll<HTMLButtonElement>('button').forEach(el => el.disabled = value); const input = form!.querySelector<HTMLInputElement>('[data-photos]'); if (input)
        input.disabled = value; }
    async function save(action: 'save' | 'publish') {
        documentValue = read();
        if (action === 'publish') {
            const issues = publicationIssues(documentValue);
            if (issues.length)
                throw new Error(issues.join(' '));
        }
        const item = await api<Listing>('/api/aliens-list/listings', { id, version, action, document: documentValue });
        version = item.version;
        saved = true;
        dirty = false;
        documentValue = item.document;
        history.replaceState(null, '', '/aliens-list/new?id=' + id);
        status(action === 'publish' ? 'Your listing is live.' : 'Draft saved. You can continue later.');
        return item;
    }
    form.addEventListener('submit', async (event) => { event.preventDefault(); if (busy)
        return; const action = ((event as SubmitEvent).submitter as HTMLButtonElement)?.value === 'publish' ? 'publish' : 'save'; lock(true); status(action === 'publish' ? 'Publishing…' : 'Saving…'); try {
        await save(action);
        if (action === 'publish')
            location.assign('/aliens-list/' + id);
    }
    catch (e) {
        status(e instanceof Error ? e.message : 'Could not save. Please try again.', true);
    }
    finally {
        lock(false);
    } });
    async function jpeg(file: File) { if (file.size > 20000000)
        throw new Error('Choose photos smaller than 20 MB.'); const bitmap = await createImageBitmap(file); try {
        if (bitmap.width * bitmap.height > 48000000)
            throw new Error('This photo is too large. Choose a smaller image.');
        const canvas = document.createElement('canvas'), context = canvas.getContext('2d')!;
        for (const max of [1800, 1200, 900]) {
            const scale = Math.min(1, max / Math.max(bitmap.width, bitmap.height));
            canvas.width = Math.round(bitmap.width * scale);
            canvas.height = Math.round(bitmap.height * scale);
            context.fillStyle = '#fff';
            context.fillRect(0, 0, canvas.width, canvas.height);
            context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
            for (const quality of [.85, .65, .5]) {
                const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', quality));
                if (blob && blob.size < 600000)
                    return blob;
            }
        }
        throw new Error('This photo could not be prepared.');
    }
    finally {
        bitmap.close();
    } }
    form.querySelector<HTMLInputElement>('[data-photos]')?.addEventListener('change', async (event) => {
        const input = event.target as HTMLInputElement;
        const files = Array.from(input.files ?? []);
        if (!files.length || busy)
            return;
        if (photos.length + files.length > 8) {
            status('Choose up to 8 photos in total.', true);
            input.value = '';
            return;
        }
        lock(true);
        const progress = form!.querySelector<HTMLProgressElement>('[data-upload-progress]')!;
        progress.hidden = false;
        progress.value = 0;
        try {
            if (!saved)
                await save('save');
            for (let i = 0; i < files.length; i++) {
                status(`Preparing and uploading photo ${i + 1} of ${files.length}…`);
                const blob = await jpeg(files[i]);
                const response = await fetch(`/api/aliens-list/media/${id}`, { method: 'POST', headers: { 'content-type': 'image/jpeg' }, body: blob });
                const result = await response.json() as {hash:string;error?:string};
                if (!response.ok)
                    throw new Error(result.error ?? 'Photo upload failed.');
                if (!photos.includes(result.hash))
                    photos.push(result.hash);
                progress.value = Math.round((i + 1) / files.length * 100);
                renderPhotos();
                dirty = true;
            }
            // Save photos on drafts; published listings change only through Update listing.
            if (!form!.dataset.published)
                await save('save');
            status('Photos added. Review your details, then publish.');
        }
        catch (e) {
            status((e as Error).message, true);
        }
        finally {
            lock(false);
            input.value = '';
            progress.hidden = true;
        }
    });
    form.addEventListener('input', () => dirty = true);
    window.addEventListener('beforeunload', event => { if (dirty) {
        event.preventDefault();
        event.returnValue = '';
    } });
    void initial;
    void initLocationMap();
}
