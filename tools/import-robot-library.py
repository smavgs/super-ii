#!/usr/bin/env python3
"""Import the user-supplied reference library. Never execute captured site code."""
import argparse
import hashlib
import json
import re
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser()
parser.add_argument('library', type=Path)
args = parser.parse_args()
raw = (args.library / 'data/master.json').read_bytes()
library = json.loads(raw)
media_file = ROOT / 'src/content/robot-reference-media.json'
media = json.loads(media_file.read_text()) if media_file.exists() else {}
out = ROOT / 'public/robot-library/records'
out.mkdir(parents=True, exist_ok=True)


def https(value):
    try:
        u = urlparse(value or '')
        host = (u.hostname or '').lower()
        if u.scheme == 'http':
            return ''  # Do not silently claim an HTTP-only site supports HTTPS.
        if u.scheme != 'https' or u.username or u.password or u.port not in (None, 443):
            return ''
        if '.' not in host or ':' in host or re.fullmatch(r'[\d.]+', host) or host.endswith(('.local', '.internal', '.test', '.invalid', '.onion')):
            return ''
        return value if len(value) <= 2048 else ''
    except (ValueError, TypeError):
        return ''


def text(value, size=600):
    return str(value or '').strip()[:size]


def summary(value):
    full = text(value, 100000)
    if len(full) <= 600:
        return full
    prefix = full[:599]
    end = max(prefix.rfind('. '), prefix.rfind('。'))
    return prefix[:end + 1] if end >= 80 else prefix.rsplit(' ', 1)[0] + '…'


def value(spec):
    v = spec.get('value')
    unit = spec.get('unit') or ''
    if unit == 'evidence_level':
        return {'official_claim':'Manufacturer claim','verified':'Source reports a test','unknown':'Not disclosed'}.get(str(v),str(v).replace('_',' '))
    if isinstance(v, bool):
        return 'Yes' if v else 'No'
    if isinstance(v, (int, float)):
        if unit == 'h' and 0 < v < 1:
            v = format(v*60,'.6g'); unit = 'min'
        else:
            v = format(v,'.6g')
    if isinstance(v, (dict, list)):
        v = json.dumps(v, ensure_ascii=False)
    rendered = str(v if v is not None else 'Not disclosed').strip()
    if unit in ('count','boolean','string','text') or rendered.endswith(' '+unit):
        unit = ''
    return text(f"{rendered} {unit}".strip(), 2000)


def highlights(specs):
    priorities = [('Total degrees of freedom','DOF'),('Height','Height'),('Weight','Weight'),('Payload per arm','Payload / arm'),('Whole-body payload','Payload'),('Battery swap time','Battery swap'),('Reach','Reach')]
    selected=[]
    for name,label in priorities:
        match=next((s for s in specs if s['label'].lower()==name.lower() and s.get('unit')!='evidence_level'),None)
        if match: selected.append({'label':label,'value':match['formatted']})
    return selected[:2]


def write(doc):
    (out / f"{doc['id']}.json").write_text(json.dumps(doc, ensure_ascii=False, separators=(',', ':')) + '\n')


companies = {c['id']: c for c in library['companies']}
products = {p['id']: p for p in library['products']}
index = []
release = library['meta']['dataRelease']
for company in companies.values():
    cid = company['id']
    name = company['name'].get('en') or company['name'].get('zh') or cid
    website = https(company.get('website'))
    asset = media.get(cid, {})
    logo = https(asset.get('logo'))
    seed = dict(name=text(name, 160), name_zh=text(company['name'].get('zh'), 160),
                summary=summary(company.get('description')), summary_zh='', website=website,
                logo_url=logo, email='', phone='', wechat='', representative_card_url='')
    doc = dict(id=cid, record_type='company', name=name, name_zh=company['name'].get('zh') or '',
               summary=text(company.get('description'), 5000), website=website, logo=logo,
               country=company.get('country') or '', city=company.get('city') or '',
               categories=company.get('categories', []), product_ids=company.get('productIds', []),
               source_url=f'https://www.robots.com/companies/{cid}/', source_date=release,
               source_label='Supplied Robots.com reference', media_source=asset.get('source', ''),
               seed=seed)
    write(doc)
    index.append({k: doc[k] for k in ('id', 'record_type', 'name', 'name_zh', 'website', 'logo', 'country', 'city', 'source_url', 'source_date', 'seed')} | {'summary': summary(doc['summary']), 'product_count':len(doc['product_ids']), 'category':'company', 'company_ids':[], 'family_id':None})

for product in products.values():
    pid = product['id']
    makers = [m for m in product['makers'] if m['id'] in companies]
    company_ids = [m['id'] for m in makers]
    category = 'hand' if product['folder'] == 'dexterous-hand' else 'component' if product['folder'].startswith('components') else 'robot'
    name = product['name'].get('en') or product['model'] or pid
    description = product.get('description') or {}
    asset = media.get(pid, {})
    pictures = [{'url':https(a['url']), 'source_url':https(a.get('source_url') or asset.get('source')), 'alt':text(name, 240)} for a in asset.get('images', []) if https(a.get('url'))][:12]
    sources = list(dict.fromkeys(https(s.get('url')) for spec in product['specs'] for s in spec.get('sources', []) if https(s.get('url'))))
    specs = [{**s, 'formatted':value(s), 'sources':[{**source,'url':https(source.get('url'))} for source in s.get('sources', []) if https(source.get('url'))]} for s in product['specs']]
    resources = [{'label':text(s.get('title') or 'Source',100), 'label_zh':'', 'kind':'datasheet' if '.pdf' in s.get('url','').lower() else 'documentation', 'url':https(s.get('url'))} for spec in product['specs'] for s in spec.get('sources',[]) if https(s.get('url'))]
    resources = list({r['url']:r for r in resources}.values())[:12]
    official = https(product.get('website')) or next((s for s in sources if any((urlparse(s).hostname or '').removeprefix('www.') == (urlparse(companies[c].get('website') or '').hostname or 'invalid').removeprefix('www.') for c in company_ids)), '')
    stage = {'commercial':'available','prototype':'prototype','discontinued':'discontinued'}.get(product['status'],'research')
    seed = dict(name=text(name,160),name_zh=text(product['name'].get('zh'),160),summary=summary(description.get('en')),summary_zh=summary(description.get('zh')),
                description=text(description.get('en'),12000),description_zh=text(description.get('zh'),12000),kind='robot' if category=='robot' else 'component',stage=stage,source_url=official,
                specs=[{'label':text(s['label'],100),'label_zh':'','value':text(s['formatted'] + (f" · {s['conditions']}" if s.get('conditions') else ''),2000),'value_zh':'','source_url':s['sources'][0]['url'] if s['sources'] else ''} for s in specs],
                resources=resources,image_ids=[],external_images=pictures)
    doc = dict(id=pid,record_type='product',name=name,name_zh=product['name'].get('zh') or '',model=product.get('model') or name,
               category=category,subcategory=product['folder'],company_ids=company_ids,makers=makers,summary=text(description.get('en')),description=description,
               country=companies[company_ids[0]].get('country','') if company_ids else '',images=pictures,source_images=product.get('images',[]),
               website=official,status=product.get('status') or 'unknown',specs=specs,resources=resources,
               family=product.get('group'),family_id=product.get('groupId'),
               variants=[{'id':p['id'],'name':p['name'].get('en') or p['model']} for p in products.values() if product.get('groupId') and p.get('groupId')==product['groupId']],
               source_url=product['url'],source_date=release,source_label='Supplied Robots.com reference',seed=seed)
    write(doc)
    row={k:doc[k] for k in ('id','record_type','name','name_zh','model','category','company_ids','country','summary','family_id','source_url','source_date','status')}
    row.update(company_name=' · '.join(m['name'] for m in makers),cover=pictures[0]['url'] if pictures else '',highlights=highlights(specs),family_name=(product.get('group') or {}).get('name'),spec_count=len(specs),seed=seed)
    index.append(row)

# Fixed registry is owned by the release, never by a claimant or the web role.
sql=['-- Generated by tools/import-robot-library.py from the supplied reference snapshot.','begin;']
for row in index:
    encoded=json.dumps(row,ensure_ascii=False,separators=(',', ':')).replace("'","''")
    sql.append(f"insert into app.robot_reference_records(id,record_type,document) values('{row['id']}'::uuid,'{row['record_type']}','{encoded}'::jsonb) on conflict(id) do nothing;")
sql.append('commit;')
(ROOT/'database/migrations/0038_robot_reference_library.sql').write_text('\n'.join(sql)+'\n')
public_index=[{k:v for k,v in row.items() if k!='seed'} for row in index]
(ROOT/'src/content/robot-reference-index.json').write_text(json.dumps(public_index,ensure_ascii=False,separators=(',',':'))+'\n')
(ROOT/'public/robot-library/manifest.json').write_text(json.dumps({'source':library['meta']['source'],'source_date':release,'source_sha256':hashlib.sha256(raw).hexdigest(),'companies':len(companies),'products':len(products),'specifications':sum(len(p['specs']) for p in products.values()),'media_note':'External manufacturer images only; original collection links retained as source_images.','relationship_evidence':'/robot-library/relationships.json'},indent=2)+'\n')
print(f'Imported {len(companies)} companies and {len(products)} products; originals unchanged.')
