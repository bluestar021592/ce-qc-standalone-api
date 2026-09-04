import fs from 'node:fs';
import path from 'node:path';

const ROOT=path.resolve(process.cwd());
const SCAN_ROOTS=['src','public','scripts'];
const SOURCE_EXT=new Set(['.js','.mjs','.cjs','.html','.json','.css']);
const VERSION_RE=/(?:^|\/)(?:v|V)(\d+)[^/]*\.(?:js|mjs|cjs|css|html)$/;
const RETIRED_RE=/\b(?:retired|deprecated|historical marker|no-?op|compat(?:ibility)? shell|legacy only|not startup-active|must not execute)\b/i;
const EXPRESS_WRAP_RE=/express\.application\.(?:use|get|post|put|patch|delete)\s*=|const\s+previous(?:Use|Get|Post|Put|Patch|Delete)\s*=\s*express\.application\./g;
const GLOBAL_OWNER_RE=/globalThis?\.__CE_QC_|global\.__CE_QC_|globalThis?\.[A-Za-z0-9_$]+\s*=|global\.[A-Za-z0-9_$]+\s*=/g;

function posix(file){return file.split(path.sep).join('/');}
function walk(dir){
  const out=[];
  if(!fs.existsSync(dir))return out;
  const stack=[dir];
  while(stack.length){
    const current=stack.pop();
    for(const entry of fs.readdirSync(current,{withFileTypes:true})){
      if(entry.name==='node_modules'||entry.name==='.git')continue;
      const full=path.join(current,entry.name);
      if(entry.isDirectory())stack.push(full);
      else if(entry.isFile()&&SOURCE_EXT.has(path.extname(entry.name).toLowerCase()))out.push(full);
    }
  }
  return out;
}
function read(file){try{return fs.readFileSync(file,'utf8');}catch{return'';}}
function resolveRef(from,ref){
  const value=String(ref||'').split('?')[0].split('#')[0];
  if(!value)return'';
  let candidate='';
  if(value.startsWith('/'))candidate=path.join(ROOT,'public',value.slice(1));
  else if(value.startsWith('.'))candidate=path.resolve(path.dirname(from),value);
  else return'';
  const attempts=[candidate];
  if(!path.extname(candidate))attempts.push(`${candidate}.js`,`${candidate}.mjs`,`${candidate}.cjs`,path.join(candidate,'index.js'));
  for(const item of attempts)if(fs.existsSync(item)&&fs.statSync(item).isFile())return posix(path.relative(ROOT,item));
  return'';
}
function refsFrom(file,source){
  const refs=new Set();
  const patterns=[
    /(?:import\s+(?:[^'\"]*?\s+from\s+)?|export\s+[^'\"]*?\s+from\s+|import\s*\()\s*['\"]([^'\"]+)['\"]/g,
    /<script[^>]+src=['\"]([^'\"]+)['\"]/gi,
    /<link[^>]+href=['\"]([^'\"]+)['\"]/gi,
    /(?:readFileSync|readFile|createReadStream)\s*\(\s*['\"]([^'\"]+)['\"]/g
  ];
  for(const re of patterns){
    let m;while((m=re.exec(source))){const resolved=resolveRef(file,m[1]);if(resolved)refs.add(resolved);}
  }
  return [...refs];
}
function packageEntries(){
  const file=path.join(ROOT,'package.json');
  const source=read(file);const refs=new Set();
  try{
    const pkg=JSON.parse(source);
    for(const command of Object.values(pkg.scripts||{})){
      const re=/(?:node(?:\s+--check)?\s+)([^\s;&|]+)/g;let m;
      while((m=re.exec(String(command)))){
        const candidate=path.resolve(ROOT,m[1]);if(fs.existsSync(candidate))refs.add(posix(path.relative(ROOT,candidate)));
      }
    }
  }catch{}
  return [...refs];
}

const files=[...new Set([
  ...SCAN_ROOTS.flatMap(root=>walk(path.join(ROOT,root))),
  ...['bootstrap.js','server.js','package.json'].map(name=>path.join(ROOT,name)).filter(fs.existsSync)
])];
const sources=new Map(files.map(file=>[posix(path.relative(ROOT,file)),read(file)]));
const graph=new Map();const incoming=new Map();
for(const [rel,source] of sources){
  const abs=path.join(ROOT,...rel.split('/'));const refs=refsFrom(abs,source);graph.set(rel,refs);
  for(const ref of refs){if(!incoming.has(ref))incoming.set(ref,new Set());incoming.get(ref).add(rel);}
}
for(const ref of packageEntries()){if(!incoming.has(ref))incoming.set(ref,new Set());incoming.get(ref).add('package.json#scripts');}

const runtimeRoots=['bootstrap.js','server.js','public/index.html'].filter(root=>sources.has(root));
const runtimeReachable=new Set();const queue=[...runtimeRoots];
while(queue.length){const rel=queue.shift();if(runtimeReachable.has(rel))continue;runtimeReachable.add(rel);for(const ref of graph.get(rel)||[])if(!runtimeReachable.has(ref))queue.push(ref);}
const testRoots=new Set([...packageEntries(),...sources.keys()].filter(rel=>/^scripts\//.test(rel)));
const testReachable=new Set();const tq=[...testRoots];
while(tq.length){const rel=tq.shift();if(testReachable.has(rel))continue;testReachable.add(rel);for(const ref of graph.get(rel)||[])if(!testReachable.has(ref))tq.push(ref);}

const versioned=[];
for(const [rel,source] of sources){
  const match=rel.match(VERSION_RE);if(!match)continue;
  const refs=[...(incoming.get(rel)||[])];
  const runtime=runtimeReachable.has(rel),test=testReachable.has(rel),retired=RETIRED_RE.test(source);
  let classification='orphan-unreferenced';
  if(runtime)classification=retired?'runtime-retired-marker':'active-runtime';
  else if(test)classification='test-only';
  else if(refs.length)classification=retired?'referenced-retired':'referenced-compat';
  else if(retired)classification='orphan-retired';
  versioned.push({
    file:rel,version:Number(match[1]),bytes:Buffer.byteLength(source),classification,
    referencedBy:refs.sort(),expressWrappers:(source.match(EXPRESS_WRAP_RE)||[]).length,
    globalOwners:(source.match(GLOBAL_OWNER_RE)||[]).length,retiredMarker:retired
  });
}
versioned.sort((a,b)=>a.version-b.version||a.file.localeCompare(b.file));
const byClass={};for(const row of versioned)byClass[row.classification]=(byClass[row.classification]||0)+1;
const ownerHotspots=versioned.filter(row=>row.expressWrappers||row.globalOwners).sort((a,b)=>(b.expressWrappers+b.globalOwners)-(a.expressWrappers+a.globalOwners)).slice(0,40);
const deletionCandidates=versioned.filter(row=>['orphan-unreferenced','orphan-retired'].includes(row.classification));
const mergeCandidates=versioned.filter(row=>['active-runtime','referenced-compat'].includes(row.classification)&&(row.expressWrappers||row.globalOwners));
const report={
  generatedAt:new Date().toISOString(),root:ROOT,filesScanned:sources.size,versionedFiles:versioned.length,
  classificationCounts:byClass,runtimeReachableFiles:runtimeReachable.size,testReachableFiles:testReachable.size,
  deletionCandidates,mergeCandidates,ownerHotspots,versioned
};
const outDir=path.join(ROOT,'runtime-audit');fs.mkdirSync(outDir,{recursive:true});
const outFile=path.join(outDir,'system-version-audit.json');fs.writeFileSync(outFile,JSON.stringify(report,null,2));
console.log('[SYSTEM VERSION AUDIT]',JSON.stringify({versionedFiles:report.versionedFiles,classificationCounts:byClass,deletionCandidates:deletionCandidates.length,mergeCandidates:mergeCandidates.length,ownerHotspots:ownerHotspots.length,outFile}));
console.log(JSON.stringify(report,null,2));
