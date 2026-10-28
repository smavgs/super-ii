#!/usr/bin/env python3
import argparse, json, re, time
from pathlib import Path
from io import BytesIO

import requests
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
RECORDS = ROOT / "public" / "robot-library" / "records"
OUT = ROOT / "tmp-component-images"

def safe(s):
    s = re.sub(r'[\\/:*?"<>|]+', '-', str(s or '').strip())
    s = re.sub(r'\s+', ' ', s).strip(' .-')
    return s[:120] or 'unknown'

def load_cards():
    comps=[]
    for p in RECORDS.glob("*.json"):
        try:
            j=json.loads(p.read_text(encoding="utf-8"))
        except Exception:
            continue
        if j.get("record_type")=="product" and j.get("category")=="component":
            comps.append(j)
    grouped={}
    for c in comps:
        key=(c.get("family_id") or "").strip() or c["id"]
        cur=grouped.get(key)
        rank=lambda x: (0 if x.get("images") else 1, str(x.get("name") or "").lower(), x["id"])
        if cur is None or rank(c) < rank(cur):
            grouped[key]=c
    special={
      '7db14f2d-e355-4d4c-aef2-1c8495fc6c57':0,
      'f939b660-25ed-4a19-baa5-0c9e22ab807b':1,
      '4c4bb7e0-8732-4837-9be7-cf5c4fc0b9dd':2,
      '14f49143-3f3e-4a3e-94ad-86ccd1ca22b9':3,
      'd88d2080-fdba-4078-9068-6ac64980767e':4,
      '188215cb-f5b2-4c7a-af1f-4db178a96841':5,
    }
    cards=list(grouped.values())
    cards.sort(key=lambda x: (
        0 if x.get("images") else 1,
        special.get(x["id"],6),
        str(x.get("name") or "").lower(),
        x["id"],
    ))
    if len(cards) != 516:
        raise SystemExit(f"Expected 516 grouped component cards, got {len(cards)}")
    return cards

def maker_name(c):
    return " · ".join(m.get("name","") for m in c.get("makers",[]) if m.get("name")) or "Unknown"

def save_jpg(data, dest):
    im=Image.open(BytesIO(data))
    im.load()
    if im.mode in ("RGBA","LA") or (im.mode=="P" and "transparency" in im.info):
        rgba=im.convert("RGBA")
        bg=Image.new("RGB", rgba.size, "white")
        bg.paste(rgba, mask=rgba.getchannel("A"))
        im=bg
    else:
        im=im.convert("RGB")
    im.thumbnail((2400,2400), Image.Resampling.LANCZOS)
    im.save(dest, "JPEG", quality=93, optimize=True)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--start", type=int, default=1)
    args=ap.parse_args()
    cards=load_cards()
    OUT.mkdir(exist_ok=True)
    session=requests.Session()
    session.headers.update({
        "User-Agent":"Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 Chrome/155.0.0.0 Safari/537.36",
        "Accept":"image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8",
        "Accept-Language":"en-US,en;q=0.9",
    })
    manifest=[]
    subset=cards[args.start-1:]
    if args.limit:
        subset=subset[:args.limit]
    for offset,c in enumerate(subset, start=args.start):
        urls=[u for u in c.get("source_images",[]) if isinstance(u,str) and u.startswith("https://")]
        rec={"index":offset,"id":c["id"],"name":c.get("name",""),"manufacturer":maker_name(c),"family":(c.get("family") or {}).get("name","") if isinstance(c.get("family"),dict) else "","source_url":c.get("source_url",""),"source_image":urls[0] if urls else "","status":"missing_source"}
        if not urls:
            manifest.append(rec); continue
        url=urls[0]
        try:
            headers={"Referer":c.get("source_url") or "https://www.robots.com/","Origin":"https://www.robots.com"}
            resp=session.get(url,headers=headers,timeout=30)
            rec["http_status"]=resp.status_code
            rec["content_type"]=resp.headers.get("content-type","")
            if resp.status_code==200 and len(resp.content)>500:
                family=rec["family"]
                parts=[f"{offset:03d}", safe(rec["manufacturer"])]
                if family: parts.append(safe(family))
                parts.append(safe(rec["name"]))
                dest=OUT / (" - ".join(parts)+".jpg")
                save_jpg(resp.content,dest)
                rec["file"]=dest.name
                rec["status"]="saved"
            else:
                rec["status"]="download_failed"
        except Exception as e:
            rec["status"]="error"; rec["error"]=str(e)[:300]
        manifest.append(rec)
        time.sleep(0.05)
    (OUT/"manifest.json").write_text(json.dumps(manifest,ensure_ascii=False,indent=2),encoding="utf-8")
    saved=sum(1 for x in manifest if x["status"]=="saved")
    print(json.dumps({"requested":len(manifest),"saved":saved,"failed":len(manifest)-saved},indent=2))
if __name__=="__main__":
    main()
