import {append} from './shared';
import type * as Leaflet from 'leaflet';
import 'leaflet/dist/leaflet.css';
type City = [
    string,
    string,
    number,
    number,
    string,
    string
];
let cities: City[] | null = null;
const normalize = (s: string) => s.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
export async function initLocationMap() {
    const surface = document.querySelector<HTMLElement>('[data-alien-map]');
    const locationBox = document.querySelector<HTMLElement>('[data-location]');
    const latInput = locationBox?.querySelector<HTMLInputElement>('[name=lat]');
    const lonInput = locationBox?.querySelector<HTMLInputElement>('[name=lon]');
    const query = locationBox?.querySelector<HTMLInputElement>('[data-city-query]');
    const picker = (locationBox?.querySelector('[data-city-options]') as HTMLSelectElement | null | undefined);
    const hint = locationBox?.querySelector<HTMLElement>('[data-city-status]');
    const radiusInput = (locationBox?.querySelector('[data-radius]') as HTMLSelectElement | null | undefined);
    const mode = surface?.dataset.mapMode;
    let map: Leaflet.Map | undefined, center: Leaflet.Marker | undefined, radiusHandle: Leaflet.Marker | undefined, circle: Leaflet.Circle | undefined, L: typeof Leaflet | undefined;
    const round = (v: number) => Math.round(v * 50) / 50;
    function position(lat: number, lon: number, fly = true) {
        lat = round(Math.max(-85, Math.min(85, lat)));
        lon = round(((lon + 180) % 360 + 360) % 360 - 180);
        if (latInput)
            latInput.value = String(lat);
        if (lonInput)
            lonInput.value = String(lon);
        if (map && L) {
            const point: Leaflet.LatLngExpression = [lat, lon];
            const radius = mode === 'editor' || mode === 'detail' ? 1800 : Number(radiusInput?.value ?? 50) * 1000;
            if (!center) {
                center = L.marker(point, { draggable: mode !== 'detail', keyboard: true, icon: L.divIcon({ className: '', html: '<div class="alien-center-pin"></div>', iconSize: [22, 22], iconAnchor: [11, 11] }), title: mode === 'detail' ? 'Approximate location' : 'Drag to change approximate location' }).addTo(map);
                center.on('dragend', () => { const p = center!.getLatLng(); position(p.lat, p.lng, false); if (hint)
                    hint.textContent = mode === 'editor' ? 'Approximate location set.' : 'Search circle moved. Press Search to update results.'; });
            }
            center.setLatLng(point);
            if (!circle)
                circle = L.circle(point, { radius, color: '#8950bc', fillColor: '#b786df', fillOpacity: .12, weight: 2 }).addTo(map);
            else
                circle.setLatLng(point).setRadius(radius);
            if(mode==='browse' && radiusInput){
                const handlePoint:Leaflet.LatLngExpression=[lat,lon+Math.min(179,radius/(111320*Math.max(.05,Math.cos(lat*Math.PI/180))))];
                if(!radiusHandle){radiusHandle=L.marker(handlePoint,{draggable:true,keyboard:true,icon:L.divIcon({className:'',html:'<div class="alien-radius-pin"></div>',iconSize:[16,16],iconAnchor:[8,8]}),title:'Drag to change search distance'}).addTo(map);radiusHandle.on('dragend',()=>{const km=Math.max(1,Math.min(20000,Math.round(map!.distance(center!.getLatLng(),radiusHandle!.getLatLng())/1000)));if(!Array.from(radiusInput.options).some(o=>Number(o.value)===km)){const option=document.createElement('option');option.value=String(km);option.textContent=km+' km';radiusInput.appendChild(option);}radiusInput.value=String(km);position(center!.getLatLng().lat,center!.getLatLng().lng,false);if(hint)hint.textContent='Distance updated. Press Search to update results.';});}
                radiusHandle.setLatLng(handlePoint);
            }
            if (fly)
                map.fitBounds(circle.getBounds(), { padding: [20, 20], maxZoom: mode === 'detail' ? 12 : 11, animate: false });
        }
    }
    if (locationBox && query && picker && hint) {
        const find = locationBox.querySelector<HTMLButtonElement>('[data-city-find]')!;
        find.addEventListener('click', async () => {
            const entered = normalize(query.value.trim());
            const aliases:Record<string,string>={'深圳':'shenzhen','深圳市':'shenzhen','шэньчжэнь':'shenzhen','旧金山':'san francisco','三藩市':'san francisco','сан-франциско':'san francisco'};
            const term=aliases[entered]??entered;
            if (term.length < 2) {
                hint.textContent = 'Enter at least two letters of a city.';
                return;
            }
            find.disabled = true;
            hint.textContent = 'Finding cities…';
            try {
                if (!cities) {
                    const r = await fetch('/aliens/cities.json');
                    if (!r.ok)
                        throw new Error();
                    cities = await r.json();
                }
                const matches = cities!.filter(c => normalize(c[0]).includes(term) || normalize(c[5]).includes(term)).slice(0, 30);
                picker.replaceChildren();
                for (const c of matches) {
                    const option = document.createElement('option');
                    option.textContent = `${c[0]} · ${c[1]}`;
                    option.value = JSON.stringify(c);
                    append(picker, option);
                }
                picker.hidden = !matches.length;
                if (matches.length) {
                    picker.selectedIndex = -1;
                    picker.focus();
                    hint.textContent = 'Choose your city below.';
                }
                else
                    hint.textContent = 'No matching city. Enter your city and place an approximate pin on the map.';
            }
            catch {
                hint.textContent = 'City lookup is unavailable. Enter the city and place an approximate pin on the map.';
            }
            finally {
                find.disabled = false;
            }
        });
        query.addEventListener('keydown', e => { if (e.key === 'Enter') {
            e.preventDefault();
            find.click();
        } });
        query.addEventListener('input', () => { if (latInput)
            latInput.value = ''; if (lonInput)
            lonInput.value = ''; picker.hidden = true; });
        picker.addEventListener('change', () => {
            if (!picker.value)
                return;
            const c = JSON.parse(picker.value) as City;
            query.value = c[0];
            const country = locationBox.querySelector<HTMLInputElement>('[data-country]');
            if (country)
                country.value = c[1];
            const countrySelect = (document.querySelector('[data-country-select]') as HTMLSelectElement | null);
            if (countrySelect)
                countrySelect.value = c[1];
            const timezone = (document.querySelector('[name=timezone]') as HTMLSelectElement | null);
            if (timezone && ['America/Los_Angeles', 'Asia/Shanghai'].includes(c[4]))
                timezone.value = c[4];
            position(c[2], c[3]);
            picker.hidden = true;
            hint.textContent = `${c[0]} · ${c[1]}. Approximate location selected.`;
            query.focus();
        });
        (document.querySelector('[data-country-select]') as HTMLSelectElement | null)?.addEventListener('change', e => { const country = locationBox.querySelector<HTMLInputElement>('[data-country]'); if (country)
            country.value = (e.target as HTMLSelectElement).value; });
        radiusInput?.addEventListener('change', () => { if (latInput?.value && lonInput?.value)
            position(Number(latInput.value), Number(lonInput.value)); });
    }
    if (surface) {
        try {
            L = await import('leaflet');
            const lat = Number(surface.dataset.lat), lon = Number(surface.dataset.lon);
            map = L.map(surface, { scrollWheelZoom: false, worldCopyJump: true }).setView([lat, lon], surface.dataset.hasLocation === 'true' ? 10 : 2);
            const tile = surface.dataset.tileUrl ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
            if (/^https:\/\//.test(tile))
                L.tileLayer(tile, { maxZoom: 17, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors', referrerPolicy: 'strict-origin-when-cross-origin' }).addTo(map);
            if (surface.dataset.hasLocation === 'true')
                position(lat, lon);
            if (mode !== 'detail')
                map.on('click', e => { position(e.latlng.lat, e.latlng.lng, false); if (hint)
                    hint.textContent = mode === 'editor' ? 'Approximate pin set.' : 'Search circle set. Press Search to update results.'; });
            document.querySelectorAll<HTMLElement>('[data-listing-id]').forEach(row => {
                const a = Number(row.dataset.lat), b = Number(row.dataset.lon);
                if (!Number.isFinite(a) || !Number.isFinite(b))
                    return;
                const link = document.createElement('a');
                link.href = '/aliens-list/' + row.dataset.listingId;
                link.textContent = row.dataset.title ?? 'View listing';
                L!.marker([a, b], { icon: L!.divIcon({ className: '', html: '<div class="alien-pin"></div>', iconSize: [15, 15] }), title: row.dataset.title }).bindPopup(link).addTo(map!);
            });
            new ResizeObserver(() => map?.invalidateSize()).observe(surface);
        }
        catch {
            surface.textContent = 'Map could not load. City and text search still work.';
        }
    }
    return { refresh: () => map?.invalidateSize() };
}
