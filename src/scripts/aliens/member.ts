import {append} from './shared';
import type { Listing, SearchFilters } from '@/lib/aliens/input';
import { priceLabel, filterHref } from '@/lib/aliens/input';
import { api, memberApi, node, status } from './shared';
type Mine = {
    profile_id: string;
    page:number;size:number;listings_total:number;threads_total:number;unread_total:number;
    admin: boolean;
    listings: Listing[];
    threads: {
        id: string;
        listing_id: string;
        title: string;
        other: string;
        unread: number;
        updated_at: string;
    }[];
    searches: {
        id: string;
        name: string;
        filters: SearchFilters;
    }[];
    email_enabled: boolean;
    email_available: boolean;
};
type Message = {
    id: string;
    body: string;
    mine: boolean;
    created_at: string;
    read_at: string | null;
};
type Thread = {
    id: string;
    listing_id: string;
    title: string;
    other: {
        id: string;
        handle: string;
        name: string;
    };
    blocked: boolean;
    blocked_by_me: boolean;
    messages: Message[];
};
let oldest:Message|null=null,hasOlder=true,lastReadSent='';
const view = document.querySelector<HTMLElement>('[data-member-view]')!;
const tab = view.dataset.tab;
const page=Math.max(0,Math.min(200,Math.floor(Number(new URLSearchParams(location.search).get('page'))||0)));
let unreadTotal=0;
const list = view.querySelector<HTMLElement>('[data-member-list]')!;
let selected = new URLSearchParams(location.search).get('thread'), thread: Thread | null = null, pendingId = crypto.randomUUID(), loadedIds = new Set<string>(), loading = false;
function original<K extends keyof HTMLElementTagNameMap>(tag:K,text:string){const el=node(tag,text);el.setAttribute('data-no-translate','');return el;}
function link(text: string, href: string, className = '') { const el = node('a', text, className); el.href = href; return el; }
function button(text: string, fn: () => Promise<unknown>, className = 'alien-button') { const el = node('button', text, className); el.type = 'button'; el.addEventListener('click', async () => { el.disabled = true; try {
    await fn();
}
catch (e) {
    status((e as Error).message, true);
}
finally {
    el.disabled = false;
} }); return el; }
function empty(title: string, detail: string, action?: HTMLElement) { const el = node('div', undefined, 'alien-empty'); append(el, node('h2', title), node('p', detail)); if (action)
    append(el, action); append(list, el); }
async function load() {
    const mine = await api<Mine>('/api/aliens-list/member?page='+page);
    document.querySelector<HTMLElement>('[data-moderation-link]')!.hidden = !mine.admin;
    const email = document.querySelector<HTMLInputElement>('[data-email-toggle]')!;
    email.checked = mine.email_enabled;
    email.disabled = !mine.email_available && !mine.email_enabled;
    if (!mine.email_available)
        document.querySelector<HTMLElement>('[data-email-status]')!.textContent = 'Email alerts are temporarily unavailable. Your bell alerts remain active.';
    const unread = unreadTotal = Number(mine.unread_total);
    document.querySelector<HTMLElement>('[data-unread]')!.textContent = unread ? `(${unread})` : '';
    list.replaceChildren();
    if (tab === 'listings') {
        for (const item of mine.listings) {
            const row = node('article', undefined, 'alien-listing');
            if (item.document.photos[0]) {
                const a = link('', `/aliens-list/${item.id}`, 'alien-thumb'), img = node('img');
                img.src = `/api/aliens-list/media/${item.id}/${item.document.photos[0]}.jpg`;
                img.alt = '';
                img.loading = 'lazy';
                append(a, img);
                append(row, a);
            }
            else
                append(row, node('span', item.document.kind === 'wanted' ? '⌕' : '▤', 'alien-thumb'));
            const body = node('div');
            append(body, node('span', item.status, 'alien-tag'));
            const h = node('h2');h.setAttribute('data-no-translate','');
            append(h, link(item.document.title || 'Untitled draft', '/aliens-list/' + item.id));
            append(body, h, node('p', priceLabel(item.document)), node('p', item.document.city, 'alien-muted'));
            const actions = node('div', undefined, 'alien-actions');
            append(actions, link('Edit', '/aliens-list/new?id=' + item.id, 'alien-text-button'));
            const act = async (action: string) => { await api('/api/aliens-list/listings', { id: item.id, version: item.version, action }); await load(); status(action === 'renew' ? 'Renewed for 30 days.' : 'Listing updated.'); };
            if (item.status !== 'hidden') {
                if (['active', 'expired', 'removed'].includes(item.status) && item.document.kind !== 'event')
                    append(actions, button('Renew 30 days', () => act('renew')));
                if (item.status === 'active')
                    append(actions, button(item.document.kind === 'wanted' ? 'Mark found' : item.document.kind === 'event' ? 'Close event' : 'Mark sold', () => act('sold')));
                if (item.status !== 'removed')
                    append(actions, button('Remove', async () => { if (confirm('Remove this listing from public browsing? Your conversations will remain.'))
                        await act('remove'); }));
            }
            append(body, actions);
            append(row, body);
            append(list, row);
        }
        if (!mine.listings.length)
            empty('Your next listing starts here.', 'Offer useful hardware, post what you need, or add an event.', link('Post free +', '/aliens-list/new', 'alien-button alien-button--yellow'));
    }
    else if (tab === 'searches') {
        for (const saved of mine.searches) {
            const row = node('div', undefined, 'alien-saved-row');
            append(row, link(saved.name, filterHref(saved.filters)), button('Remove', async () => { await memberApi({ action: 'search', id: saved.id, name: saved.name, filters: saved.filters, remove: true }); await load(); status('Saved search removed.'); }, 'alien-text-button'));
            append(list, row);
        }
        if (!mine.searches.length)
            empty('Let the next find come to you.', 'Search for hardware or events, then choose Save search. New matches appear in your bell.', link('Browse Aliens List', '/aliens-list', 'alien-button'));
    }
    else if (tab === 'messages') {
        for (const t of mine.threads) {
            const row = link('', `?tab=messages&page=${page}&thread=${t.id}`, 'alien-thread-row');
            row.dataset.threadId=t.id;row.dataset.unread=String(t.unread);row.dataset.other=t.other;
            if (selected === t.id)
                row.setAttribute('aria-current', 'true');
            append(row, original('strong', t.title), node('small', `@${t.other}${Number(t.unread) ? ` · ${t.unread} unread` : ''}`));
            append(list, row);
        }
        if (!mine.threads.length)
            empty('A conversation starts with a listing.', 'Find an item and message its member. Your email stays private.', link('Browse hardware', '/aliens-list', 'alien-button'));
        if (selected)
            await loadThread();
    }
    else if (tab === 'moderation' && mine.admin) {
        const reports = await api<Array<{
            id: string;
            reason: string;
            title: string | null;
            listing_id: string | null;
            message_id: string | null;
            reported_message: string | null;
            reporter: string; listing_status:string; status:string;
        }>>('/api/aliens-list/member?moderate=1');
        for (const r of reports) {
            const row = node('article', undefined, 'alien-moderation-row');
            append(row, node('h2', r.title ?? 'Reported message'), original('p', r.reason), node('small', `Reported by @${r.reporter}`));
            if (r.reported_message)
                append(row, original('blockquote', r.reported_message));
            if (r.listing_id)
                append(row, link('View listing', '/aliens-list/' + r.listing_id));
            const actions = node('div', undefined, 'alien-actions');
            if (r.listing_id && r.listing_status==='hidden') append(actions,button('Restore listing',async()=>{await memberApi({action:'moderate',report:r.id,operation:'restore'});await load();}));
            if (r.listing_id && r.listing_status!=='hidden')
                append(actions, button('Hide listing', async () => { if (confirm('Hide this listing and notify its owner?')) {
                    await memberApi({ action: 'moderate', report: r.id, operation: 'hide' });
                    await load();
                } }));
            append(actions, button('Resolve report', async () => { await memberApi({ action: 'moderate', report: r.id, operation: 'resolve' }); await load(); }));
            append(row, actions);
            append(list, row);
        }
        if (!reports.length)
            empty('No open reports.', 'Reported listings and messages will appear here.');
    }
    else if (tab === 'moderation')
        empty('This area is for moderators.', 'Return to your listings or messages.');
    const total=tab==='listings'?mine.listings_total:tab==='messages'?mine.threads_total:0;
    if(total>mine.size){const nav=node('nav',undefined,'alien-pagination');nav.setAttribute('aria-label','Member pages');if(page>0)append(nav,link('← Previous',`?tab=${tab}&page=${page-1}`,'alien-button'));append(nav,node('span',`${page+1} / ${Math.ceil(total/mine.size)}`));if((page+1)*mine.size<total)append(nav,link('Next →',`?tab=${tab}&page=${page+1}`,'alien-button'));append(list,nav);}
    status('');
}
function messageElement(m: Message) { const row = node('article', undefined, 'alien-message'); row.dataset.mine = String(m.mine); append(row, original('p', m.body), node('small', new Date(m.created_at).toLocaleString())); if (!m.mine)
    append(row, button('Report', async () => { const reason = prompt('What should a moderator review about this message?'); if (reason && reason.trim().length >= 5) {
        await memberApi({ action: 'report', listing: null, message: m.id, reason });
        status('Message reported.');
    }
    else if (reason)
        status('Please describe the issue in at least 5 characters.', true); }, '')); return row; }
async function loadThread(older = false) {
    if (!selected || loading)
        return;
    loading = true;
    try {
        const log = document.querySelector<HTMLElement>('[data-message-log]')!;
        const before = older && oldest?.created_at;
        const next = await api<Thread>('/api/aliens-list/member?thread=' + selected + (before ? '&before=' + encodeURIComponent(before)+'&before_id='+oldest!.id : ''));
        if (!older) {
            thread = next;
            document.querySelector<HTMLElement>('[data-conversation]')!.hidden = false;
            document.querySelector('[data-thread-title]')!.textContent = next.title;
            document.querySelector('[data-thread-member]')!.textContent = `Conversation with @${next.other.handle}`;
            const listingLink = document.querySelector<HTMLAnchorElement>('[data-thread-listing]')!;
            listingLink.href = '/aliens-list/' + next.listing_id;
            const block = document.querySelector<HTMLButtonElement>('[data-block]')!;
            block.textContent = next.blocked_by_me ? 'Unblock member' : 'Block member';
            const form = document.querySelector<HTMLFormElement>('[data-message-form]')!;
            form.querySelectorAll<HTMLInputElement | HTMLButtonElement>('textarea,button').forEach(el => el.disabled = next.blocked);
            document.querySelector('[data-message-status]')!.textContent = next.blocked ? 'Messaging is unavailable while either member has blocked the other.' : '';
        }
        // A long background interval can contain more than a page of new messages.
        if(!older && loadedIds.size && next.messages.length===100 && next.messages.every(m=>!loadedIds.has(m.id))){loadedIds.clear();log.replaceChildren();oldest=null;}
        if(older || !oldest){oldest=next.messages[0]??oldest;hasOlder=next.messages.length===100;}
        const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
        const fresh = next.messages.filter(m => !loadedIds.has(m.id));
        if (older) {
            const fragment = document.createDocumentFragment();
            fresh.forEach(m => { loadedIds.add(m.id); append(fragment, messageElement(m)); });
            const height = log.scrollHeight;
            log.insertBefore(fragment, log.firstChild);
            log.scrollTop += log.scrollHeight - height;
            if (thread)
                thread.messages = [...next.messages, ...thread.messages];
        }
        else {
            fresh.forEach(m => { loadedIds.add(m.id); append(log, messageElement(m)); });
            if (nearBottom || loadedIds.size === fresh.length)
                log.scrollTop = log.scrollHeight;
        }
        document.querySelector<HTMLButtonElement>('[data-load-older]')!.hidden = !hasOlder;
        if (!older && next.messages.some(m=>!m.mine&&!m.read_at) && document.visibilityState === 'visible' && lastReadSent!==next.messages.at(-1)!.created_at) {
            const through=next.messages.at(-1)!.created_at;
            await memberApi({ action: 'read', thread: selected, through });lastReadSent=through;
            const row=list.querySelector<HTMLElement>(`[data-thread-id="${selected}"]`);if(row){unreadTotal=Math.max(0,unreadTotal-Number(row.dataset.unread??0));row.dataset.unread='0';row.querySelector('small')!.textContent='@'+row.dataset.other;document.querySelector('[data-unread]')!.textContent=unreadTotal?`(${unreadTotal})`:'';}
        }
    }
    finally {
        loading = false;
    }
}
document.querySelector<HTMLFormElement>('[data-message-form]')?.addEventListener('submit', async (event) => { event.preventDefault(); if (!selected)
    return; const form = event.currentTarget as HTMLFormElement; const body = form.querySelector<HTMLTextAreaElement>('textarea')!; const submit = form.querySelector('button')!; submit.disabled = true; const out = document.querySelector<HTMLElement>('[data-message-status]')!; try {
    await memberApi({ action: 'message', id: pendingId, listing: null, thread: selected, body: body.value });
    pendingId = crypto.randomUUID();
    body.value = '';
    out.textContent = '';
    await loadThread();
}
catch (e) {
    out.textContent = (e as Error).message;
}
finally {
    submit.disabled = thread?.blocked ?? false;
} });
document.querySelector<HTMLButtonElement>('[data-block]')?.addEventListener('click', async () => { if (!thread)
    return; try {
    await memberApi({ action: 'block', profile: thread.other.id, active: !thread.blocked_by_me });
    await loadThread();
}
catch (e) {
    status((e as Error).message, true);
} });
document.querySelector('[data-load-older]')?.addEventListener('click', () => void loadThread(true).catch(e => status(e.message, true)));
document.querySelector<HTMLInputElement>('[data-email-toggle]')?.addEventListener('change', async (event) => { const input = event.target as HTMLInputElement; input.disabled = true; try {
    await memberApi({ action: 'email', enabled: input.checked });
    document.querySelector('[data-email-status]')!.textContent = input.checked ? 'Email summary enabled for your verified account email.' : 'Email summary off. Bell alerts remain active.';
}
catch (e) {
    input.checked = !input.checked;
    document.querySelector('[data-email-status]')!.textContent = (e as Error).message;
}
finally {
    input.disabled = false;
} });
setInterval(() => { if (selected && document.visibilityState === 'visible')
    void loadThread().catch(() => { document.querySelector('[data-message-status]')!.textContent = 'Messages could not refresh. Reconnecting…'; }); }, 15000);
void load().catch(e => status(e.message, true));
