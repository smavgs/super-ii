#!/usr/bin/env python3
"""Refresh the small city lookup from GeoNames, CC BY 4.0. No user geocoding calls."""
import io, json, pathlib, urllib.request, zipfile
root=pathlib.Path(__file__).resolve().parents[1]
url='https://download.geonames.org/export/dump/cities15000.zip'
with urllib.request.urlopen(url,timeout=60) as response: data=response.read()
rows=[]
with zipfile.ZipFile(io.BytesIO(data)) as archive:
 for line in archive.read('cities15000.txt').decode().splitlines():
  c=line.split('\t')
  # Name, country, coordinates, timezone, ASCII name. No personal information.
  rows.append([c[1],c[8],round(float(c[4]),2),round(float(c[5]),2),c[17],c[2],int(c[14])])
rows.sort(key=lambda c:c[-1],reverse=True)
folder=root/'public'/'aliens';folder.mkdir(exist_ok=True)
(folder/'cities.json').write_text(json.dumps([c[:-1] for c in rows],ensure_ascii=False,separators=(',',':'))+'\n')
(folder/'cities-source.txt').write_text('City data: GeoNames cities15000, https://www.geonames.org/\nSource: '+url+'\nLicense: Creative Commons Attribution 4.0, https://creativecommons.org/licenses/by/4.0/\nModified: selected fields; coordinates rounded to two decimal places; sorted by population.\n')
print(f'Prepared {len(rows)} city records.')
