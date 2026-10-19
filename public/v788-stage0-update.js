// V788 stage 0: no persistence, no workflow trigger and no destructive endpoint.
(()=>{
'use strict';
if(document.body?.dataset?.page!=='settings')return;
const output=document.getElementById('v788Stage0UpdateResult');
const button=document.getElementById('v788Stage0UpdateRefresh');
if(!output||!button)return;
let reading=false;
async function readStatus(){
  if(reading)return;
  reading=true;button.disabled=true;
  output.textContent='正在读取本机已安装版本（不访问业务数据）…';
  try{
    const response=await fetch('/api/admin/v788-stage0-update',{
      method:'GET',credentials:'same-origin',cache:'no-store',
      headers:{Accept:'application/json'},signal:AbortSignal.timeout(8500)
    });
    if(!response.ok)throw Error(response.status===403?
      '需要管理员登录才能查看本机更新状态。':'无法获取本机版本，请先检查5177后台和登录。');
    const data=await response.json();
    if(data?.probeId!=='2026-10-19-v788-stage0-main-update-readonly-v1'||
        data?.readOnly!==true||data?.authorizedToClear!==false)
      throw Error('本机检查接口与预期版本不一致；没有放行。');
    const short=s=>String(s||'').slice(0,12)||'未能读取';
    const same=data.localMainMatchesCachedRemote===true;
    output.textContent=[
      '第一步：本机5177后台已响应，阶段0只读检查入口可用。',
      '当前已安装提交：'+short(data.installedCommit),
      '本机分支：'+String(data.installedBranch||'未知'),
      '缓存的远端main提交：'+short(data.cachedOriginMainCommit),
      '已安装提交与本机缓存main：'+(same?'一致（不代表已核实实时GitHub）':'不一致或缺少Git元数据'),
      '完整V788：尚未安装或完成真实业务验收。',
      '七业务日报与真实Excel：尚未通过实机逐票核对。',
      '清空旧数据：未放行。此页面不会自动安装、备份、清空或调用TMS。'
    ].join('\n');
  }catch(error){
    output.textContent='本机更新检查没有完成：'+String(error?.message||'连接不可用')+
      '\n不会改变现有业务数据，不能据此清空或重传。';
  }finally{reading=false;button.disabled=false}
}
button.addEventListener('click',()=>{void readStatus()});
const interfaceTab=document.querySelector('#v625SettingsTabs [data-settings-tab="interface"]');
interfaceTab?.addEventListener('click',()=>{void readStatus()});
void readStatus();
})();
