(function installNetworkSettingsRuntimeV62(global){
  const VERSION='2026-08-12-v62-network-settings-v1';
  let refreshing=false;
  let lastRun=0;

  const esc=value=>String(value??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));

  function render(network={}){
    const target=document.getElementById('networkAccessCards');
    if(!target)return false;
    const publicValue=network.publicConfigured
      ? (network.publicUrl||'尚未配置公网地址')
      : `${network.publicUrl||'尚未配置公网地址'}（待配置DNS/Cloudflare隧道）`;
    const rows=[
      ['当前访问',location.origin],
      ['同一局域网访问',network.lanUrl||'未检测到有效局域网IPv4'],
      ['不同网络/外地访问',publicValue]
    ];
    target.innerHTML=`<div class="access-address-list">${rows.map(([label,url])=>`<div><span>${esc(label)}</span><b>${esc(url)}</b><button class="icon-button" title="复制地址" data-v62-copy="${encodeURIComponent(url)}"><svg class="ui-icon"><use href="/assets/ui-icons.svg#icon-clipboard"></use></svg></button></div>`).join('')}</div><p class="operation-status">公网需 Named Tunnel 与 Cloudflare Access 配置完成后启用。</p>`;
    target.querySelectorAll('[data-v62-copy]').forEach(button=>button.addEventListener('click',()=>navigator.clipboard?.writeText?.(decodeURIComponent(button.dataset.v62Copy||''))));
    return true;
  }

  async function refresh(){
    const target=document.getElementById('networkAccessCards');
    if(!target||refreshing||Date.now()-lastRun<1500)return;
    const text=target.textContent||'';
    if(!/未检测到有效局域网IPv4|尚未配置公网地址/.test(text))return;
    refreshing=true;lastRun=Date.now();
    try{
      const response=await global.fetch('/api/state?compact=1',{cache:'no-store',credentials:'same-origin'});
      const data=await response.json().catch(()=>({}));
      const network=data?.state?.network;
      if(response.ok&&network)render(network);
    }catch(error){console.warn('[CE-QC][NETWORK_V62]',error?.message||error);}
    finally{refreshing=false;}
  }

  function install(){
    void refresh();
    const observer=new MutationObserver(records=>{
      if(records.some(record=>[...record.addedNodes].some(node=>node?.nodeType===1&&(node.id==='networkAccessCards'||node.querySelector?.('#networkAccessCards')))))setTimeout(()=>void refresh(),30);
    });
    observer.observe(document.documentElement,{subtree:true,childList:true});
    document.addEventListener('click',event=>{
      if(event.target?.closest?.('[data-page="settings"],#networkSettingsPanel'))setTimeout(()=>void refresh(),80);
    },true);
    global.addEventListener('focus',()=>setTimeout(()=>void refresh(),50));
    console.info('[CE-QC][NETWORK_V62]',VERSION);
  }

  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',install,{once:true});else install();
})(window);