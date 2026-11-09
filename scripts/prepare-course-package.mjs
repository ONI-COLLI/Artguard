import { readFileSync, writeFileSync, readdirSync, lstatSync, mkdirSync, copyFileSync, existsSync } from 'node:fs';
import { resolve, join, relative, extname } from 'node:path';
import { createHash } from 'node:crypto';
import { sourceZip } from './source-archive.mjs';
const root=process.cwd(),out=resolve('deliverables/final-project');mkdirSync(out,{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex');
for(const name of ['Team03_FP_Demo.mp4','Team03_FP_Demo.srt'])copyFileSync(resolve('deliverables/three-minute',name),join(out,name));
const evidence=join(out,'evidence');mkdirSync(evidence,{recursive:true});
for(const name of ['Team03_FP_Demo_validation.json','Team03_FP_Demo_evidence.json','on-chain-proof.json','canonical-receipts.json','run.json'])copyFileSync(resolve('deliverables/three-minute',name),join(evidence,name));
copyFileSync(resolve('artifacts/submission-review/financial-model.json'),resolve('submission/financial-model.json'));
for(const [source,target] of [['artifacts/submission-review/api-tests.log','api-tests.log'],['artifacts/submission-review/client-tests.log','client-tests.log'],['artifacts/criteria-audit/escrow-test.log','escrow-tests.log'],['artifacts/submission-review/deployment-tests.log','deployment-tests.log'],['artifacts/submission-review/finance-tests.log','finance-tests.log'],['artifacts/submission-review/source-export-tests.log','source-export-tests.log']]){
 if(!existsSync(source))throw new Error('Missing evidence log '+source);
 const text=readFileSync(source,'utf8').replaceAll(root,'<workspace>').replaceAll(root.replaceAll('\\','/'),'<workspace>');
 if(!/(?:# pass \d+|Tests\s+\d+ passed)/.test(text)||/(?:# fail [1-9]|Tests\s+\d+ failed|not ok \d)/.test(text))throw new Error('Evidence is incomplete or failing: '+source);
 writeFileSync(join(evidence,target),text);
}
copyFileSync(resolve('artifacts/defense-video/ccab5e4f-561c-473b-b35c-44019c1d437c/canonical-receipts.json'),join(evidence,'canonical-receipts-review.json'));
const notice=resolve('node_modules/@openzeppelin/contracts/LICENSE');
if(existsSync(notice)){mkdirSync(resolve('third-party'),{recursive:true});copyFileSync(notice,resolve('third-party/OpenZeppelin-MIT.txt'));}
const files=[];
const roots=['src','server','shared','contracts','scripts','tests','docs','submission','third-party','.github'];
const rootFiles=['package.json','package-lock.json','index.html','README.md','CONTRIBUTING.md','LICENSE','THIRD_PARTY_NOTICES.md','.env.example','.gitignore','.gitattributes','.prettierrc.json','.prettierignore','vite.config.ts','vitest.config.ts','tsconfig.json','tsconfig.server.json','Dockerfile','.dockerignore','compose.public.yaml'];
const allowed=new Set(['.ts','.tsx','.js','.mjs','.py','.css','.json','.html','.md','.sol','.yaml','.yml','.txt','.svg']);
function add(file){
 const stat=lstatSync(file);if(stat.isSymbolicLink())throw new Error('No symlinks in course source');
 if(stat.isDirectory()){for(const n of readdirSync(file))add(join(file,n));return;}
 const name=relative(root,file).replaceAll('\\','/');
 if(/(^|\/)(node_modules|data|runtime|artifacts|dist|\.git|__pycache__)(\/|$)|\.private\.|\.sqlite/i.test(name))return;
 if(!rootFiles.includes(name)&&!allowed.has(extname(name)))return;
 const bytes=readFileSync(file);
 if(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/.test(bytes.toString('utf8')))throw new Error('Unexpected private-key file');
 files.push({path:name,bytes,sha256:hash(bytes)});
}
for(const dir of roots)if(existsSync(dir))add(resolve(dir));
for(const name of rootFiles)if(existsSync(name))add(resolve(name));
// Keep the actual README video link usable when the source archive is uploaded to GitHub.
for(const name of ['Team03_FP_Demo.mp4','Team03_FP_Demo.srt','Team03_FP_Demo_evidence.json','Team03_FP_Demo_validation.json','on-chain-proof.json','canonical-receipts.json','run.json']){
 const bytes=readFileSync(resolve('deliverables/three-minute',name));files.push({path:'deliverables/three-minute/'+name,bytes,sha256:hash(bytes)});
}
for(const name of ['Team03_FP_Report.pdf','Team03_FP_Presentation.pdf','Team03_FP_Presentation.pptx','Team03_FP_Speech.pdf']){
 const bytes=readFileSync(join(out,name));files.push({path:'deliverables/final-project/'+name,bytes,sha256:hash(bytes)});
}
files.sort((a,b)=>a.path.localeCompare(b.path));
const bytes=sourceZip(files);writeFileSync(join(out,'Team03_FP_Source.zip'),bytes);
writeFileSync(join(out,'SOURCE_MANIFEST.json'),JSON.stringify({createdAt:new Date().toISOString(),sha256:hash(bytes),fileCount:files.length,excluded:'Keys, .env files other than the blank example, databases, uploads, runtime state, dependencies, logs and unrelated 3D assets',files:files.map(({path,sha256,bytes})=>({path,sha256,size:bytes.length}))},null,2));
writeFileSync(join(out,'START_HERE.txt'),readFileSync(resolve('docs/FINAL_SUBMISSION.md'),'utf8'));
const packageFiles=[];
function collect(dir){for(const n of readdirSync(dir)){const file=join(dir,n);if(lstatSync(file).isDirectory())collect(file);else if(n!=='Team03_FP_Package.zip'&&!n.startsWith('.')&&!n.includes('_revised'))packageFiles.push({path:relative(out,file).replaceAll('\\','/'),bytes:readFileSync(file)});}}
collect(out);writeFileSync(join(out,'Team03_FP_Package.zip'),sourceZip(packageFiles));
console.log(JSON.stringify({directory:out,sourceFiles:files.length,sourceBytes:bytes.length,packageFiles:packageFiles.length,videoSha256:hash(readFileSync(join(out,'Team03_FP_Demo.mp4')))}));
