// Preserve the existing deck and update only the financial explanation and tables.
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath,pathToFileURL} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=process.env.ARTGUARD_ARTIFACT_RUNTIME||path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies');
process.env.RUNTIME_NODE_MODULES=path.join(runtime,'node/node_modules');
const skill=process.env.ARTGUARD_PRESENTATION_SKILL||path.join(os.homedir(),'.codex/plugins/cache/openai-primary-runtime/presentations/26.1104.22356/skills/presentations');
const {FileBlob,PresentationFile}=await import(pathToFileURL(runtime+'/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs'));
const work=path.join(root,'artifacts/submission-review/deck'),out=path.join(root,'deliverables/final-project');
await fs.mkdir(work,{recursive:true});
const source=path.resolve(process.argv[2]||path.join(out,'Team03_FP_Presentation.pptx'));
const model=JSON.parse(await fs.readFile(path.join(root,'artifacts/submission-review/financial-model.json'),'utf8'));
const b=model.scenarios.base,m=b.metrics,fmt=x=>(x/1e6).toFixed(2);
const p=await PresentationFile.importPptx(await FileBlob.load(source));
const records=(await p.inspect({kind:'slide,textbox,table',maxChars:100000})).records;
function text(n,match,value){
 const found=records.filter(r=>r.kind==='textbox'&&r.slideIndex===n-1&&match(r));
 if(found.length!==1)throw new Error(`Expected one text target on slide ${n}; found ${found.length}`);
 const r=found[0];p.resolve(r.id).text.replace(r.text,value);
}
const title=(n,v)=>text(n,r=>r.position.top<60,v);
const at=(n,y,v)=>text(n,r=>r.position.top===y,v);
function table(n,rows){
 const found=records.filter(r=>r.kind==='table'&&r.slideIndex===n-1);
 if(found.length!==1)throw new Error('Expected one table on slide '+n);
 const t=p.resolve(found[0].id);
 for(let r=0;r<rows.length;r++)for(let c=0;c<rows[r].length;c++)t.cells.set(r,c,rows[r][c]);
}
at(10,477,'Licence: $30. Weighted fee: 6.5%. Processing: 2.5% of full buyer payments plus subscriptions.\n\nCash payroll: KZT 0. Founders develop without pay; no hires are assumed. Planning FX: 447.94 KZT/USD.');
p.slides.getItem(9).speakerNotes.text='Founder work is unpaid, as in the Endterm. No hires are assumed and opportunity cost is excluded. Audit, legal review, marketing, tools, gas, hosting, processing and planning tax remain included.';
title(11,'The forecast assumes unpaid founder development');
table(11,[['Metric','Year 1','Year 2','Year 3'],['Platform revenue',...b.annual.map(y=>fmt(y.revenue))],['Cash operating costs',...b.annual.map(y=>fmt(y.costs))],['Operating free cash flow',...b.annual.map(y=>fmt(y.fcf))],['Cash after financing',...b.annual.map(y=>fmt(y.closingCash))]]);
at(11,544,'Cash salaries are KZT 0 in every year. Unpaid founder time is a non-cash contribution; its opportunity cost is excluded.');
p.slides.getItem(10).speakerNotes.text='FCF includes planning tax. Launch/security expenses exceed early revenue in Year 1. Creator proceeds and escrow are not company income. Cash after financing retains the old 40m proposal for comparison.';
title(12,'Unpaid founder work changes the cash forecast');
at(12,170,'KZT +'+fmt(m.npvThreeYears)+'m');
at(12,286,'Three-year cash NPV at 25%');
at(12,365,`First positive monthly EBITDA: Month ${m.firstPositiveEbitdaMonth}.\nCumulative cash recovery: Month ${m.simplePaybackMonth}.\nNPV with 5% terminal growth: KZT ${fmt(m.npvWithTerminal)}m.\n\nThis cash forecast excludes founder opportunity cost and assumes unpaid work continues.`);
p.slides.getItem(11).speakerNotes.text='Only the added salaries and hires were removed; other inputs are unchanged. NPV excludes financing. Annual discounted operating FCF becomes cumulatively positive by end of Year 2. Terminal value is speculative.';
title(13,'Downside cases reduce the forecast return');
const sc=['base','demand','costs','combined'].map(k=>model.scenarios[k].metrics);
table(13,[['Metric','Base','A','B','C'],['NPV Years 1–3',...sc.map(x=>fmt(x.npvThreeYears))],['Peak cash need',...sc.map(x=>fmt(x.peakNeed))],['Extra above KZT 40m',...sc.map(x=>fmt(x.extraFunding))],['Cash recovery month',...sc.map(x=>String(x.simplePaybackMonth??'Not reached'))]]);
at(13,547,'All cases retain unpaid founder work. Peak cash need stays below KZT 40m; the original raise should be resized and justified.');
p.slides.getItem(12).speakerNotes.text='These are conditional cash scenarios, not validated probabilities. They exclude paid hiring. Lower demand weakens investor IRR even while cash project NPV remains positive.';
table(14,[['Term','Illustration'],['Funding','KZT 25m in Month 1 + KZT 15m in Month 10'],['Equity','26% after both tranches'],['Implied post-money value','KZT 153.85m'],['Base peak cash need','KZT '+fmt(m.peakNeed)+'m'],['Illustrative investor return',m.investorMoic.toFixed(2)+'× MOIC; '+(m.illustrativeInvestorIrr*100).toFixed(1)+'% annual IRR']]);
at(14,550,'The old KZT 40m proposal exceeds the corrected cash need. Resize it; demand, unpaid labour and the exit multiple remain unverified.');
p.slides.getItem(13).speakerNotes.text='Illustrated IRR now exceeds 25% in the base case. It assumes an unverified 2.5x exit multiple and unpaid founders. Retaining old terms does not prove that 40m is necessary. Future pay requires a new scenario.';
at(16,160,`The local prototype demonstrates registration, escrow, a wallet-bound licence and a real co-author withdrawal.\n\nWith unpaid founders, three-year cash NPV is KZT ${fmt(m.npvThreeYears)}m and cumulative cash recovery is Month ${m.simplePaybackMonth}. Founder opportunity cost is excluded.\n\nValidate demand and labour capacity, review security and resize the original funding proposal.\n\nThe course uses fictional data and test assets only.`);
p.slides.getItem(15).speakerNotes.text='This restores the Endterm self-development assumption. Positive cash forecasts are not proof of commercial profitability. Other cost and demand assumptions remain explicit.';
for(let i=0;i<p.slides.items.length;i++){
 const slide=p.slides.getItem(i),blob=await p.export({slide,format:'png',scale:1});
 await fs.writeFile(path.join(work,`slide-${String(i+1).padStart(2,'0')}.png`),new Uint8Array(await blob.arrayBuffer()));
}
const candidate=path.join(work,'salary-correction-candidate.pptx');
await(await PresentationFile.exportPptx(p)).save(candidate);
const {finalizePresentation}=await import(pathToFileURL(path.join(skill,'container_tools/artifact_tool_utils.mjs')));
const revision=Date.now(),destination=path.join(out,`Team03_FP_Presentation_revised-${revision}.pptx`),owners=[...new Set(records.filter(r=>r.kind==='table').map(r=>r.slideIndex+1))];
const result=await finalizePresentation({workspaceDir:root,candidatePath:candidate,finalPath:destination,pythonExecutable:path.join(runtime,'python/python.exe'),integrityValidatorPath:path.join(skill,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(skill,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit',...owners.flatMap(n=>['--require-native-table-slide',String(n)])],explicitTotalSlideCount:18,requiredNativeTableOwnerSlides:owners,fontPolicy:{basis:'reference',families:['Arial'],referencePath:source,referenceSha256:createHash('sha256').update(await fs.readFile(source)).digest('hex')},verifyArtifactToolImport:true,receiptPath:path.join(work,`validation-${revision}.json`)});
const stable=path.join(out,'Team03_FP_Presentation.pptx');await fs.copyFile(destination,stable);
await fs.writeFile(path.join(work,'latest-validation.json'),JSON.stringify({...result,stableCopy:stable},null,2));
console.log(JSON.stringify({slideCount:p.slides.items.length,finalSha256:result.finalSha256}));
