(function installImportSuccessWhppV66(global){
  const VERSION='2026-08-12-v66-import-success-whpp-v1';
  let latestWhppCount=null;
  const originalFetch=global.fetch.bind(global);
  const originalAlert=global.alert.bind(global);

  global.fetch=async function v66Fetch(input,init){
    const response=await originalFetch(input,init);
    try{
      const rawUrl=typeof input==='string'?input:(input&&input.url)||'';
      const url=new URL(rawUrl,global.location.origin);
      const method=String((init&&init.method)||(input&&input.method)||'GET').toUpperCase();
      if(method==='POST'&&url.pathname==='/api/import/unified-daily-report'){
        const payload=await response.clone().json().catch(()=>null);
        if(payload&&payload.ok!==false){
          const count=Number(payload?.classificationCounts?.WHPP ?? payload?.whpp?.count ?? 0);
          latestWhppCount=Number.isFinite(count)?count:0;
        }
      }
    }catch{}
    return response;
  };

  global.alert=function v66Alert(message){
    let text=String(message??'');
    if(/^综合日报导入成功：/.test(text)&&!/WHPP本土/.test(text)){
      const count=Number.isFinite(latestWhppCount)?latestWhppCount:0;
      text=text.replace(/。?\s*$/,`，WHPP本土 ${count}。`);
    }
    return originalAlert(text);
  };

  console.info('[CE-QC][V66_IMPORT_SUCCESS_WHPP]',VERSION);
})(window);
