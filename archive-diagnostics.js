const { performance } = require('node:perf_hooks');
const sensitive = /^(authorization|token|access_token|api_?key|key|password|secret|signature|sig)$/i;
function safeUrl(value) {
  try {
    const url = new URL(value); url.username='';url.password='';
    for (const key of [...url.searchParams.keys()]) if (sensitive.test(key)) url.searchParams.set(key,'[redacted]');
    return url.href;
  } catch { return '[invalid URL]'; }
}
async function errorResponseDetails(response) {
  const headers=Object.fromEntries(['content-type','server','via','x-cache','retry-after']
    .map(key=>[key,response.headers?.get(key)]).filter(([,value])=>value));
  const reader=response.body?.getReader?.();
  if (!reader) return {responseHeaders:headers,bodyPreview:null};
  const parts=[];let size=0,timer;
  try {
    const read=async()=>{
      while (size<4096) {
        const {value,done}=await reader.read();if(done)break;
        const chunk=Buffer.from(value).subarray(0,4096-size);parts.push(chunk);size+=chunk.length;
      }
    };
    // Error diagnostics must not turn a quick HTTP 502 into another long wait.
    await Promise.race([read(),new Promise(resolve=>{timer=setTimeout(resolve,1500);})]);
    const preview=Buffer.concat(parts).toString('utf8')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')
      .replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim()
      .replace(/https?:\/\/[^\s<>"']+/g,value=>safeUrl(value))
      .replace(/\b(authorization|access_token|token|api_?key|password|secret|signature|sig)=([^\s&<>"']+)/gi,'$1=[redacted]')
      .slice(0,1000);
    return {responseHeaders:headers,bodyPreview:preview || null};
  } catch(error) { return {responseHeaders:headers,bodyPreview:null,previewError:error.message}; }
  finally { clearTimeout(timer);reader.cancel().catch(()=>{}); }
}

function logTrace(event) { console.info('[Planet X archive]', JSON.stringify(event)); }
async function archiveRequest(url, milliseconds, stage, read, {requestId,log=logTrace,fetchOptions={},acceptedStatuses}={}) {
  const started=performance.now();
  const base={requestId,stage,url:safeUrl(url),method:fetchOptions.method || 'GET'};
  log({...base,event:'start',query:fetchOptions.body?.get?.('QUERY')});
  let status=null;
  try {
    const response=await fetch(url,{...fetchOptions,signal:AbortSignal.timeout(milliseconds)});
    status=response.status;
    log({...base,event:'headers',status,elapsedMs:Math.round(performance.now()-started),contentType:response.headers?.get('content-type') || null});
    if (acceptedStatuses ? !acceptedStatuses.includes(status) : !response.ok) {
      const details=await errorResponseDetails(response);
      log({...base,event:'http-error',status,elapsedMs:Math.round(performance.now()-started),...details});
      throw new Error(`HTTP ${status}`);
    }
    const result=await read(response);
    const recordCount = Array.isArray(result?.data) ? result.data.length
      : result?.VOTABLE?.RESOURCE_ARRAY?.find(r=>r.TABLE)?.TABLE.DATA?.TABLEDATA?.length;
    log({...base,event:'complete',status,elapsedMs:Math.round(performance.now()-started),
      recordCount,byteSize:Buffer.isBuffer(result)?result.length:undefined});
    return result;
  } catch (error) {
    const timeout=error.name==='TimeoutError' || error.name==='AbortError';
    const message=timeout ? `${stage} timed out after ${milliseconds/1000} seconds. Please retry.` : `${stage} failed: ${error.message}`;
    log({...base,event:'error',status,elapsedMs:Math.round(performance.now()-started),exception:{name:error.name,message:error.message,cause:error.cause?.message,code:error.cause?.code}});
    const failure=new Error(message,{cause:error});
    failure.httpStatus=status;
    failure.requestStage=stage;
    throw failure;
  }
}
module.exports={safeUrl,logTrace,archiveRequest,errorResponseDetails};
