export function localDate(iso: string, zone: string) { if (!iso)
        return ''; const parts = new Intl.DateTimeFormat('en-CA', { timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)); const p = Object.fromEntries(parts.map(x => [x.type, x.value])); return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`; }
export function utcDate(value: string, zone: string) { if (!value)
        return ''; let time = Date.parse(value + 'Z'); const target = time; for (let i = 0; i < 4; i++) {
        const rendered = Date.parse(localDate(new Date(time).toISOString(), zone) + 'Z');
        const delta = target - rendered;
        if (!delta)
            break;
        time += delta;
    } if (localDate(new Date(time).toISOString(), zone) !== value)
        throw new Error('This local time does not exist because of a daylight-saving change. Choose another time.'); return new Date(time).toISOString(); }

export function lastEventDate(iso:string,zone:string){return localDate(new Date(Date.parse(iso)-1).toISOString(),zone);}
