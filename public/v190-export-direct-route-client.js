(function installV190ExportDirectRouteClient(global){
  if(global.__CE_QC_V190_EXPORT_DIRECT_CLIENT__)return;
  const VERSION='2026-08-17-v190-export-direct-route-client-v1';
  const nativeFetch=global.fetch.bind(global);

  function pathOf(input){
    try{
      const raw=typeof input==='string'?input:String(input?.url||'');
      return new URL(raw,location.href).pathname;
    }catch{return '';}
  }
  function businessFrom(init={}){
    try{
      const body=typeof init?.body==='string'?JSON.parse(init.body):init?.body;
      return String(body?.businessType||'').trim().toUpperCase();
    }catch{return '';}
  }
  function rewriteUrl(input,nextPath){
    if(typeof input==='string'){
      try{const u=new URL(input,location.href);u.pathname=nextPath;return u.pathname+u.search+u.hash;}catch{return nextPath;}
    }
    try{
      const u=new URL(input.url,location.href);u.pathname=nextPath;
      return new Request(u.toString(),input);
    }catch{return input;}
  }

  global.fetch=function v190ExportDirectFetch(input,init={}){
    const path=pathOf(input);
    const method=String(init?.method||input?.method||'GET').toUpperCase();
    if(path==='/api/export-period/prepare'&&method==='POST'){
      const business=businessFrom(init);
      if(business&&business!=='ALL'){
        console.info('[CE-QC][V190_EXPORT_DIRECT_CLIENT] routing single-business prepare',business);
        return nativeFetch(rewriteUrl(input,'/api/v190/export-period/prepare'),init);
      }
    }
    return nativeFetch(input,init);
  };

  global.__CE_QC_V190_EXPORT_DIRECT_CLIENT__={version:VERSION,preparePath:'/api/v190/export-period/prepare',statusPath:'/api/v190/export-job/:jobId'};
  console.info('[CE-QC][V190_EXPORT_DIRECT_CLIENT]',VERSION);
})(window);
