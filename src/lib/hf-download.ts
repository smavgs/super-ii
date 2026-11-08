import { encodeHfPath, hfApiBase, HfSourceError, type HfFile, type HfListing } from './hf-catalogue';

export function allowedHfDownloadUrl(value: string) {
  const url = new URL(value);
  return url.protocol === 'https:' && !url.username && !url.password && !url.port &&
    (url.hostname === 'huggingface.co' || url.hostname === 'cas-bridge.xethub.hf.co' || url.hostname === 'us.aws.cdn.hf.co' ||
      /^cdn-lfs(?:-[a-z0-9-]+)?\.(?:hf\.co|huggingface\.co)$/.test(url.hostname));
}

export async function streamHfFile(request: Request, item: HfListing, file: HfFile, fetcher: typeof fetch = fetch) {
  hfApiBase(item); // Validate the stored kind, repository and immutable revision.
  const etag = `"${file.sha256 ? 'sha256:'+file.sha256 : 'git:'+file.oid}"`;
  const filename = file.path.split('/').at(-1)!;
  const headers = new Headers({
    'content-type':'application/octet-stream',
    'content-disposition':`attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g,'_')}"; filename*=UTF-8''${encodeURIComponent(filename).replace(/['()*]/g,c=>'%'+c.charCodeAt(0).toString(16))}`,
    'content-length':String(file.size),'accept-ranges':'bytes',etag,
    'cache-control':'private, no-store, no-transform','x-content-type-options':'nosniff','referrer-policy':'no-referrer',
  });
  const range = request.headers.get('range');
  const useRange = Boolean(range && (!request.headers.has('if-range') || request.headers.get('if-range') === etag));
  let start = 0, end = file.size - 1;
  if (useRange) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range!);
    if (!match || (!match[1] && !match[2])) return new Response(null,{status:416,headers:{'content-range':`bytes */${file.size}`}});
    start = match[1] ? Number(match[1]) : Math.max(0,file.size-Number(match[2]));
    end = match[1] && match[2] ? Math.min(Number(match[2]),file.size-1) : file.size-1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start > end || start >= file.size) return new Response(null,{status:416,headers:{'content-range':`bytes */${file.size}`}});
  }
  const outgoing = new Headers({'accept-encoding':'identity','user-agent':'SuperiiCatalog/1.0'});
  if (useRange) outgoing.set('range',`bytes=${start}-${end}`);
  // No browser cookies, provider tokens or user supplied URLs reach the source.
  let url = `https://huggingface.co/${item.kind === 'model' ? '' : item.kind === 'dataset' ? 'datasets/' : 'spaces/'}${encodeHfPath(item.provider_repo_id)}/resolve/${item.source_revision}/${encodeHfPath(file.path)}?download=true`;
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  request.signal.addEventListener('abort',onAbort,{once:true});
  const timer = setTimeout(onAbort,25000);
  let response: Response;
  try {
    for (let redirects=0;;redirects++) {
      if (!allowedHfDownloadUrl(url)) throw new HfSourceError(502,'Unsupported source download destination.');
      response = await fetcher(url,{method:request.method === 'HEAD' ? 'HEAD' : 'GET',headers:outgoing,redirect:'manual',signal:controller.signal,cache:'no-store'});
      if (![301,302,303,307,308].includes(response.status)) break;
      await response.body?.cancel();
      if (redirects >= 4 || !response.headers.get('location')) throw new HfSourceError(502,'Source download redirect failed.');
      url = new URL(response.headers.get('location')!,url).href;
    }
  } finally { clearTimeout(timer); request.signal.removeEventListener('abort',onAbort); }
  const expectedSize = end-start+1;
  if (response.status !== (useRange ? 206 : 200) ||
    (request.method !== 'HEAD' && file.size > 0 && !response.body) ||
    (response.headers.has('content-length') && Number(response.headers.get('content-length')) !== expectedSize) ||
    (useRange && response.headers.get('content-range') !== `bytes ${start}-${end}/${file.size}`)) {
    await response.body?.cancel();
    throw new HfSourceError([401,403].includes(response.status) ? 403 : 502,'Hugging Face could not deliver this file. Check access or try again.');
  }
  headers.set('content-length',String(expectedSize));
  if (useRange) headers.set('content-range',`bytes ${start}-${end}/${file.size}`);
  // Streaming preserves bounded memory, browser cancellation and range/resume.
  return new Response(request.method === 'HEAD' ? null : response.body,{status:useRange ? 206 : 200,headers});
}
