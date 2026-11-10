-- Small, source-linked event collection. No fabricated hardware or test posts.
-- Conditional on the existing curator profile; reruns never overwrite member edits.
begin;
do $seed$
declare curator uuid; entry jsonb; doc jsonb;
begin
 select id into curator from app.profiles where lower(handle)='smavgs';
 if curator is null then return; end if;
 for entry in select * from jsonb_array_elements($events$[
  {
    "id": "730aa0ea-6ee8-53b3-be21-c15744116e04",
    "checked_at": "2026-11-09",
    "document": {
      "kind": "event",
      "category": "ai",
      "condition": "",
      "amount": null,
      "currency": "USD",
      "negotiable": false,
      "delivery": [],
      "specs": {},
      "photos": [],
      "original_photos": false,
      "business": true,
      "all_day": true,
      "area": "Union Square",
      "source_url": "https://ai.engineer/code/2026",
      "title": "AI Engineer Code Summit 2026",
      "description": "A gathering for engineers building coding agents and AI software workflows, with workshops, sessions and an expo at Hilton Union Square. Attendance is by application. Check the organizer’s page for admission, prices and the daily schedule.",
      "city": "San Francisco",
      "country": "US",
      "lat": 37.78,
      "lon": -122.42,
      "organizer": "AI Engineer",
      "timezone": "America/Los_Angeles",
      "starts_at": "2026-11-10T08:00:00Z",
      "ends_at": "2026-11-13T08:00:00Z",
      "registration_url": "https://ai.engineer/code/2026"
    }
  },
  {
    "id": "e2cd0112-3b40-514b-9013-04d6ebe124cf",
    "checked_at": "2026-11-09",
    "document": {
      "kind": "event",
      "category": "hardware-event",
      "condition": "",
      "amount": null,
      "currency": "CNY",
      "negotiable": false,
      "delivery": [],
      "specs": {},
      "photos": [],
      "original_photos": false,
      "business": true,
      "all_day": true,
      "area": "Bao’an · Shenzhen World",
      "source_url": "https://www.chtf.com/english/Info/ForVisitors/First/",
      "title": "China Hi-Tech Fair 2026",
      "description": "The 28th China Hi-Tech Fair brings technology exhibitors and visitors to Shenzhen World Exhibition & Convention Center. Explore the official program and exhibitor information, and follow the organizer’s visitor registration instructions before attending.",
      "city": "Shenzhen",
      "country": "CN",
      "lat": 22.7,
      "lon": 113.76,
      "organizer": "China Hi-Tech Fair organizers",
      "timezone": "Asia/Shanghai",
      "starts_at": "2026-11-25T16:00:00Z",
      "ends_at": "2026-11-28T16:00:00Z",
      "registration_url": "https://www.chtf.com/english/Info/ForVisitors/First/"
    },
    "location_source": "https://www.openstreetmap.org/way/785606096"
  },
  {
    "id": "14fee367-5dc6-5a5c-b8dd-c0186bed8b2d",
    "checked_at": "2026-11-09",
    "document": {
      "kind": "event",
      "category": "ai",
      "condition": "",
      "amount": null,
      "currency": "USD",
      "negotiable": false,
      "delivery": [],
      "specs": {},
      "photos": [],
      "original_photos": false,
      "business": true,
      "all_day": true,
      "area": "SoMa · Moscone West",
      "source_url": "https://ai.engineer/worldsfair/2027",
      "title": "AI Engineer World’s Fair 2027",
      "description": "AI Engineer’s World’s Fair returns to Moscone West for technical sessions, workshops and an AI tools expo. The organizer has announced the dates; the detailed program and ticket information are still to follow. Use the official page for updates.",
      "city": "San Francisco",
      "country": "US",
      "lat": 37.78,
      "lon": -122.4,
      "organizer": "AI Engineer",
      "timezone": "America/Los_Angeles",
      "starts_at": "2027-06-29T07:00:00Z",
      "ends_at": "2027-07-02T07:00:00Z",
      "registration_url": "https://ai.engineer/worldsfair/2027"
    }
  }
]$events$::jsonb) loop
  doc:=entry->'document';
  if not app.alien_valid_document(doc,true) then raise exception 'invalid curated event'; end if;
  insert into app.alien_listings(id,owner_id,document,status,source_kind,published_at,expires_at)
  values((entry->>'id')::uuid,curator,doc,'active','official-source',now(),(doc->>'ends_at')::timestamptz)
  on conflict(id) do nothing;
 end loop;
end $seed$;
commit;
