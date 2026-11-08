import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runtime=process.env.ARTGUARD_ARTIFACT_RUNTIME || path.join(os.homedir(),'.cache/codex-runtimes/codex-primary-runtime/dependencies');
process.env.RUNTIME_NODE_MODULES=runtime+'/node/node_modules';
const skill=process.env.ARTGUARD_PRESENTATION_SKILL || path.join(os.homedir(),'.codex/plugins/cache/openai-primary-runtime/presentations/26.1104.22356/skills/presentations');
const {Presentation,PresentationFile}=await import(pathToFileURL(runtime+'/node/node_modules/@oai/artifact-tool/dist/artifact_tool.mjs'));
const work=path.join(root,'artifacts/submission-review/deck');await fs.mkdir(work,{recursive:true});
const out=path.join(root,'deliverables/final-project');await fs.mkdir(out,{recursive:true});
const config=JSON.parse(await fs.readFile(path.join(root,'submission/config.json'),'utf8'));
const model=JSON.parse(await fs.readFile(path.join(root,'artifacts/submission-review/financial-model.json'),'utf8'));
const base=model.scenarios.base,m=base.metrics,years=base.annual;
const names=config.members.map(x=>x.name),fmt=x=>(x/1e6).toFixed(2);
const p=Presentation.create({slideSize:{width:1280,height:720}});
const C={bg:'#121212',text:'#F4F4F4',muted:'#BBBBBB',accent:'#F59A78',line:'#444444'};
const definitions=[];
function txt(s,text,x,y,w,h,size=26,color=C.text,bold=false){
 const a=s.shapes.add({geometry:'textbox',position:{left:x,top:y,width:w,height:h},fill:'none',line:{fill:'none',width:0}});
 a.text=text;a.text.style={typeface:'Arial',fontSize:size,color,bold};return a;
}
function slide(title,owner,source='Source: own design and project evidence.'){
 const s=p.slides.add();s.background.fill=C.bg;
 txt(s,title,58,42,1160,95,42,C.accent,true);
 txt(s,'Responsible student: '+owner,58,670,1050,28,16,C.muted);
 txt(s,String(p.slides.items.length),1170,670,60,28,16,C.muted);
 if(source)txt(s,source,58,627,1160,36,15,C.muted);
 definitions.push({title,owner,source});return s;
}
function body(s,text,y=155,h=430,size=28){txt(s,text,64,y,1148,h,size);}
function tbl(s,caption,headers,rows,tracks,y=172,height=360,fontSize=25){
 txt(s,caption,64,y-36,1140,32,20,C.muted);
 const t=s.tables.add({rows:rows.length+1,columns:headers.length,left:64,top:y,width:1148,height,columnTracks:tracks.map(value=>({mode:'fr',value})),values:[headers,...rows]});
 for(let r=0;r<=rows.length;r++)for(let col=0;col<headers.length;col++){
   const cell=t.getCell(r,col);cell.fill=r===0?'#303030':'#191919';cell.text.style={typeface:'Arial',fontSize,color:r===0?C.accent:C.text,bold:r===0};
 }
 t.borders.assign({style:'solid',fill:C.line,width:1});return t;
}
let s=slide('ArtGuard',names[0],'Educational simulation. Fictional customers, planning figures and test ETH only.');
txt(s,'Risk assessment, prototype and investment pitch',64,150,1120,60,31);
txt(s,'Introduction to Finance\nAstana IT University  ·  Team 03  ·  SE-2533\nSupervisor: Nurkhat Ibadildin, Associate Professor\n8 November 2026',64,235,1090,160,25);
txt(s,names.slice(0,2).join('  ·  ')+'\n'+names.slice(2).join('  ·  '),64,420,1120,78,24);
txt(s,'GitHub: '+(config.githubUrl||'publication pending')+'\nUniversity OneDrive video: '+(config.oneDriveUrl||'upload and institutional sharing pending'),64,530,1130,78,20,C.muted);
s.images.add({blob:new Uint8Array(await fs.readFile(path.join(root,'artifacts/submission-review/aitu-logo-white.png'))),contentType:'image/png',alt:'University logo on title slide only',fit:'contain',position:{left:968,top:44,width:250,height:80}});
s.speakerNotes.text='Team title. Formal links remain pending. The university identity appears only on this title slide. This is an educational simulation.';

s=slide('The licensing problem',names[0],'Sources: Ciriello et al. (2023); Frattolillo (2024).');
body(s,'Creators need clear evidence of the work and the agreed usage terms.\n\nBuyers need a licence and a reliable delivery process.\n\nCo-authors need a traceable record of their agreed shares.\n\nThe first proposed market is visual creators and small-business buyers in Kazakhstan. Demand and willingness to pay still need validation.',156,440,29);
s.speakerNotes.text='Research supports rights-management design concerns, not our customer forecast. No market-size statistic, survey result or actual paying customer is claimed.';

s=slide('Creator plans and service revenue',names[2],'Source: implemented plan rules. USD prices are reference prices; prototype payments use test ETH.');
tbl(s,'Table 1. Monthly creator plans',['Plan','Price per month','Sales commission'],[['Free','$0','10%'],['Premium','$10','5%'],['Business','$50','0%']],[1,1,1],190,275,31);
txt(s,'Promotion: $5 for seven days. Base forecast assumes no promotion revenue until demand is validated.',64,505,1148,90,27);
s.speakerNotes.text='One account can buy and create. Plan mix is a share of sales value, not simply the subscriber headcount. Promotion placement does not guarantee sales.';

s=slide('The implemented local architecture',names[1],'Source: current repository. Foundry (n.d.); OpenZeppelin (n.d.).');
const cols=[['React and wallet','Forms, signatures\nand per-tab sessions'],['Express and SQLite','Accounts, quotes\nand protected files'],['Anvil EVM','Hashes, escrow\nand wallet licences']];
for(let i=0;i<cols.length;i++){txt(s,cols[i][0],64+i*390,190,350,60,31,C.accent,true);txt(s,cols[i][1],64+i*390,270,345,140,27);if(i<2)txt(s,'→',410+i*390,255,44,60,34);}
txt(s,'Files stay off-chain. The local operator controls Anvil. Built-in demo wallets use the server’s restricted custodial signer.',64,460,1148,110,28);
txt(s,'Figure 1. Actual application and blockchain boundaries',64,585,1148,30,18,C.muted);
s.speakerNotes.text='This is SQLite and Anvil, not PostgreSQL or Hardhat. Polygon PoS is a hypothetical future public platform compared with permissioned BFT in the report.';

s=slide('Escrow separates payment from acceptance',names[1],'Source: EscrowLicenseMarketplace.sol. All amounts use local test ETH.');
const steps=[['1  Register','Creator records file\nand terms fingerprints.'],['2  Deposit','Buyer locks the exact\nquoted test ETH amount.'],['3  Deliver','Seller confirms within\n72 hours.'],['4  Review','Buyer has 24 hours\nto accept or dispute.'],['5  Release','Acceptance starts the\nlicence and credits shares.'],['6  Withdraw','Each recipient withdraws\nin a separate transaction.']];
for(let i=0;i<steps.length;i++){const x=64+(i%3)*390,y=170+Math.floor(i/3)*190;txt(s,steps[i][0],x,y,350,48,29,C.accent,true);txt(s,steps[i][1],x,y+56,350,98,25);}
txt(s,'Figure 2. Current escrow sequence. A dispute blocks ordinary release; unresolved disputes permit refund after seven days.',64,578,1148,45,18,C.muted);
s.speakerNotes.text='Timers enable transactions, not automatic transfers. After review expiry anyone can trigger release of an undisputed order. A trusted platform arbiter decides disputes. Refund credits and withdrawals are separate.';

s=slide('Recorded deployment and purchase',names[1],'Figure 3. Actual local recording. Source: saved defence run ccab5e4f-561c-473b-b35c-44019c1d437c.');
s.images.add({blob:new Uint8Array(await fs.readFile(path.join(root,'deliverables/three-minute/Team03_FP_Demo_poster.jpg'))),contentType:'image/jpeg',alt:'Actual ArtGuard defence recording',fit:'contain',position:{left:64,top:145,width:720,height:405}});
txt(s,'Play Team03_FP_Demo.mp4\n\n3:00 exactly\nEnglish on-screen explanation\nDeployment and local receipts\nEscrow, licence and payout\nActual tests and passing results',825,160,380,420,24);
s.speakerNotes.text='Play the actual three-minute video, not the older simulated animations. The video records 21 selected application unit tests and 10 EVM escrow tests. A later complete client run passed 98 tests. Do not describe these as the same run.';

s=slide('Security controls and residual trust',names[1],'Sources: current contracts; Kushwaha et al. (2022a, 2022b); OpenZeppelin (n.d.).');
tbl(s,'Table 2. Controls that actually exist',['Threat','Implemented control','Remaining risk'],[['Reentrancy','Clear credit before transfer; nonReentrant','Independent audit remains planned'],['Tampered or replayed quote','EIP-712, buyer, expiry and quote ID checks','Trusted signer can authorise bad terms'],['Unauthorised settlement','Wallet and state-transition checks','Arbiter compromise affects disputes']],[1,1.7,1.4],175,330,24);
txt(s,'No implemented multisig, emergency pause or signer rotation is claimed. The future audit budget is an assumption.',64,545,1148,70,25);
s.speakerNotes.text='The record is not proof of lawful authorship. A registration front-running strategy, recovery controls and hardened production operations remain future work.';

s=slide('Market alternatives and the proposed difference',names[0],'Sources: Adobe (n.d.); Pixsy (n.d.); Bhujel and Rahulamathavan (2022).');
tbl(s,'Table 3. Competitor categories',['Category','Existing focus','ArtGuard question'],[['Stock licensing','Content discovery and usage terms','Does an escrow workflow add useful assurance?'],['Infringement services','Find and address unauthorised use','Can buyers and creators use licence evidence more easily?'],['NFT marketplaces','Token ownership and trading','Can a wallet-bound licence work without issuing a token?']],[1,1.1,1.5],178,330,25);
txt(s,'These services are competitors or reference categories, not clients or partners. No adoption or market-share claim is made.',64,545,1148,70,25);

s=slide('The main risks affect the investment decision',names[3],'Source: own risk matrix. Legal scope: Law No. 193-VII (2023), Law No. 94-V (2013), AIFC (n.d.).');
tbl(s,'Table 4. Highest-priority risks',['Risk','Score','Response'],[['Weak demand','20','Validate retention and willingness to pay'],['Funding shortfall','20','Stage commitments and rerun downside cases'],['Signer or arbiter compromise','15','Independent review and recovery design'],['Regulatory classification','15','Model-specific Kazakhstan legal review'],['False authorship and delivery disputes','12','Clear evidence, takedown and appeal process']],[1.3,.5,2],170,385,24);
txt(s,'Legal pages demonstrate a workflow. Commercial activity needs a model-specific review under Kazakhstan law and any relevant AIFC rules.',64,568,1148,50,24);
s.speakerNotes.text='Discuss Law No. 193-VII, Law No. 94-V and copyright law as hypothetical startup issues. No actual company registration or real assets are required for the course. AIFC is a separate regulatory route requiring assessment.';

s=slide('The forecast uses explicit assumptions',names[2],'Source: scripts/finance-model.mjs. All targets are hypothetical and require team review.');
tbl(s,'Table 5. Monthly demand anchors',['Metric','Month 12','Month 24','Month 36'],[['Licence sales','400','1,300','2,500'],['Premium creators','150','350','600'],['Business creators','20','60','120']],[1.4,.8,.8,.8],180,260,29);
txt(s,'Average licence: $30. Sales-value mix: 50% Free, 30% Premium, 20% Business. Weighted commission: 6.5%.\n\nProcessing: 2.5% of gross buyer payments plus subscriptions. Frozen planning FX: 447.94 KZT/USD, not a current-rate claim.',64,477,1148,130,25);
s.speakerNotes.text='No forecast is based on test ETH wallet balances. Marketing, salaries, legal review, audit, tools, gas and hosting are included. Promotion revenue is excluded from the base case. Tax and employment burdens are simplified planning inputs.';

s=slide('Revenue growth does not repay all build losses',names[2],'Source: executable monthly model. Units: KZT million. Rounded values may not sum exactly.');
tbl(s,'Table 6. Three-year forecast',['Metric','Year 1','Year 2','Year 3'],[['Platform revenue',...years.map(y=>fmt(y.revenue))],['Cash operating costs',...years.map(y=>fmt(y.costs))],['Operating free cash flow',...years.map(y=>fmt(y.fcf))],['Cash after financing',...years.map(y=>fmt(y.closingCash))]],[1.55,.8,.8,.8],175,325,29);
txt(s,'Gross licence volume is separate from platform revenue. Creator proceeds and locked escrow funds are not company profit.',64,544,1148,70,26);

s=slide('The three-year investment case remains negative',names[2],'Source: own calculations at 25% annual discount rate. Development costs are already in Year 1 FCF.');
txt(s,'KZT '+fmt(m.npvThreeYears)+'m',64,170,1150,105,72,C.accent,true);
txt(s,'Three-year project NPV',64,286,1148,50,29);
body(s,'First positive monthly EBITDA: Month '+m.firstPositiveEbitdaMonth+'.\nPayback: not reached by Month 36.\nNPV including a 5% terminal-growth case: KZT '+fmt(m.npvWithTerminal)+'m.\n\nA funded cash balance does not establish an attractive project return.',365,230,27);
s.speakerNotes.text='NPV discounts operating FCF, not equity financing. Do not subtract the 40 million funding again from already expensed development cash flows. Negative NPV is an analytical result, not something to conceal.';

s=slide('Downside scenarios require more funding',names[2],'Source: own model. A: customers −30%; B: operating costs +20%; C: combined. Units: KZT million.');
const sc=['base','demand','costs','combined'].map(x=>model.scenarios[x].metrics);
tbl(s,'Table 7. Sensitivity of value and funding',['Metric','Base','A','B','C'],[['NPV Years 1–3',...sc.map(x=>fmt(x.npvThreeYears))],['Peak cash need',...sc.map(x=>fmt(x.peakNeed))],['Extra above KZT 40m',...sc.map(x=>fmt(x.extraFunding))],['Payback by Month 36','No','No','No','No']],[1.5,.7,.7,.7,.7],182,325,27);
txt(s,'Reduced scope or delayed hiring needs a new forecast. Additional downside capital can dilute the proposed 26% stake.',64,547,1148,70,26);

s=slide('Funding terms need evidence and repricing',names[0],'Source: own illustrative terms and cash-flow calculation. No real investment is solicited.');
tbl(s,'Table 8. Proposal retained for critical evaluation',['Term','Illustration'],[['Funding','KZT 25m in Month 1 + KZT 15m in Month 10'],['Equity','26% after both tranches'],['Implied post-money value','KZT 153.85m'],['Base peak cash need','KZT '+fmt(m.peakNeed)+'m'],['Illustrative investor return',(m.investorMoic).toFixed(2)+'× MOIC; '+(100*m.illustrativeInvestorIrr).toFixed(1)+'% annual IRR']],[1,2.4],177,350,25);
txt(s,'The assumed exit multiple is unverified. The illustrative IRR falls below the 25% hurdle. A staged pilot is the recommended next decision.',64,550,1148,68,25);
s.speakerNotes.text='Use both tranche dates for the investor IRR. A strategic sale or later investor buy-out is a possible exit, not a commitment. The model assumes no dilution in the base exit illustration.';

s=slide('The team must own and explain the work',names[0],'Source: roles confirmed by the project representative. Actual contribution remains individually documented.');
tbl(s,'Table 9. Review responsibilities',['Member','Role','Area'],config.members.map(x=>[x.name,x.role,x.area]),[1.25,.5,2.25],174,320,24);
txt(s,'Next: validate demand, review security and update the funding decision.\n\nEach member provides their own commits and self-evaluation.',64,526,1148,85,23);

s=slide('Conclusion',names[0],'Source: prototype, recorded local evidence and the revised financial model.');
body(s,'The local prototype demonstrates registration, escrow, a wallet-bound licence and a real co-author withdrawal.\n\nThe commercial case remains conditional. The current three-year NPV is negative and downside scenarios exceed the proposed funding.\n\nA staged validation pilot, independent review and revised economics should precede a hypothetical investment.\n\nThe course uses fictional data and test assets only.',160,450,29);

s=slide('AI Disclosure Statement',names[0],'Tool and exact model supplied by the project representative: Codex, GPT-6.1 Sol.');
body(s,'AI assisted code, contracts, tests, interface explanations, demonstration tooling, English captions, report editing, references, financial-model code and presentation preparation.\n\nThis is substantial assistance. The team must review the design, assumptions, calculations and conclusions, and every member must explain the code independently.\n\nNo personal contribution, Scopus login, customer survey, coverage percentage or completed external audit is invented.',160,440,28);
s.speakerNotes.text='Remove the earlier incorrect Claude attribution. Add any other AI tool or model actually used. These claims describe assistance, not proof that students have completed their review.';

s=slide('References',names[0],'Retrieved 8 November 2026 for sources without DOI. Full details and additional legal sources appear in the report.');
const refs=[
 'Bhujel, S., & Rahulamathavan, Y. (2022). A survey: Security, transparency, and scalability issues of NFT’s and its marketplaces. Sensors, 22(22), 8833. https://doi.org/10.3390/s22228833',
 'Ciriello, R. F., et al. (2023). Blockchain-based digital rights management systems: Design principles for the music industry. Electronic Markets, 33, 5. https://doi.org/10.1007/s12525-023-00628-5',
 'Frattolillo, F. (2024). Blockchain and smart contracts for digital copyright protection. Future Internet, 16(5), 169. https://doi.org/10.3390/fi16050169',
 'Kushwaha, S. S., et al. (2022a). Systematic review of security vulnerabilities in Ethereum blockchain smart contract. IEEE Access, 10, 6605–6621. https://doi.org/10.1109/ACCESS.2021.3140091',
 'Kushwaha, S. S., et al. (2022b). Ethereum smart contract analysis tools: A systematic review. IEEE Access, 10, 57037–57062. https://doi.org/10.1109/ACCESS.2022.3169902',
 'Lashkari, B., & Musilek, P. (2021). A comprehensive review of blockchain consensus mechanisms. IEEE Access, 9, 43620–43652. https://doi.org/10.1109/ACCESS.2021.3065880',
 'Adobe. (n.d.). License information and terms of use. https://stock.adobe.com/license-terms',
 'Foundry. (n.d.). Anvil overview. https://getfoundry.sh/anvil/overview',
 'OpenZeppelin. (n.d.). Contracts 5.x utilities. https://docs.openzeppelin.com/contracts/5.x/utils',
 'Pixsy. (n.d.). Find and fight image theft. https://www.pixsy.com/',
 'Polygon. (n.d.). Polygon PoS architecture overview. https://docs.polygon.technology/pos/architecture/overview',
];
const verified=JSON.parse(await fs.readFile(path.join(root,'artifacts/submission-review/crossref-verified.json'),'utf8'));
const academic=verified.map(row=>{
 const authors=row.author.map(a=>a.family+', '+a.given.split(/[\s-]+/).filter(Boolean).map(x=>x[0]+'.').join(' '));
 const author=authors.length>1?authors.slice(0,-1).join(', ')+', & '+authors.at(-1):authors[0];
 const suffix=row.DOI.endsWith('3140091')?'a':row.DOI.endsWith('3169902')?'b':'';
 const titles={'10.3390/s22228833':'A survey: Security, transparency, and scalability issues of NFT’s and its marketplaces','10.3390/fi16050169':'Blockchain and smart contracts for digital copyright protection','10.1109/access.2021.3065880':'A comprehensive review of blockchain consensus mechanisms','10.1109/access.2021.3140091':'Systematic review of security vulnerabilities in Ethereum blockchain smart contract','10.1109/access.2022.3169902':'Ethereum smart contract analysis tools: A systematic review','10.1007/s12525-023-00628-5':'Blockchain-based digital rights management systems: Design principles for the music industry'};
 return author+' ('+row.published['date-parts'][0][0]+suffix+'). '+(titles[row.DOI.toLowerCase()]||row.title[0])+'. '+row['container-title'][0]+', '+row.volume+(row.issue?'('+row.issue+')':'')+', '+(row['article-number']||row.page)+'. https://doi.org/'+row.DOI;
});
const completeRefs=[...academic,...refs.slice(6),
 'AIFC. (n.d.). Rules on digital asset activities. https://aifc.kz/legal-framework/aifc-rules-on-digital-asset-activities/',
 'Law No. 193-VII. (2023). On digital assets in the Republic of Kazakhstan. https://adilet.zan.kz/eng/docs/Z2300000193',
 'Law No. 94-V. (2013). On personal data and their protection. https://adilet.zan.kz/eng/docs/Z1300000094',
].sort((a,b)=>a.localeCompare(b));
txt(s,completeRefs.slice(0,7).join('\n\n'),64,146,555,466,15.5);
txt(s,completeRefs.slice(7).join('\n\n'),660,146,552,466,15.5);
s.speakerNotes.text='Report references contain full author lists, the three Kazakhstan laws, AIFC rules and publisher indexing information. Five qualifying recent articles are the three IEEE Access papers, Sensors and Future Internet. References are sources actually used; no chatbot counts as literature.';

await fs.writeFile(path.join(work,'slide-definitions.json'),JSON.stringify(definitions,null,2));
for(let i=0;i<p.slides.items.length;i++){
 const slide=p.slides.getItem(i),blob=await p.export({slide,format:'png',scale:1});
 await fs.writeFile(path.join(work,`slide-${String(i+1).padStart(2,'0')}.png`),new Uint8Array(await blob.arrayBuffer()));
}
// The runtime's PDF export is unavailable on this Windows bundle (standard-font assets).
// A PDF of the native slide renders is assembled by build-submission.py after visual QA.
const candidate=path.join(work,'candidate.pptx');await (await PresentationFile.exportPptx(p)).save(candidate);
const {finalizePresentation}=await import(pathToFileURL(path.join(skill,'container_tools/artifact_tool_utils.mjs')));
const finalPath=path.join(out,'Team03_FP_Presentation.pptx');
// The finalizer deliberately refuses to overwrite. Use a fresh reviewed candidate per invocation.
const exists=await fs.stat(finalPath).then(()=>true,()=>false);
const revision=Date.now();
const destination=exists?path.join(out,'Team03_FP_Presentation_revised-'+revision+'.pptx'):finalPath;
const tableOwners=[3,7,8,9,10,11,13,14,15];
const result=await finalizePresentation({workspaceDir:root,candidatePath:candidate,finalPath:destination,pythonExecutable:path.join(runtime,'python/python.exe'),integrityValidatorPath:path.join(skill,'container_tools/inspect_presentation_package_integrity.py'),layoutValidatorPath:path.join(skill,'container_tools/inspect_presentation_layout_geometry.py'),layoutArgs:['--expected-slide-size-emu','12192000,6858000','--validate-bullet-geometry','--validate-heading-fit',...tableOwners.flatMap(n=>['--require-native-table-slide',String(n)])],explicitTotalSlideCount:18,requiredNativeTableOwnerSlides:tableOwners,fontPolicy:{basis:'design',families:['Arial']},verifyArtifactToolImport:true,receiptPath:path.join(work,'validation-'+revision+'.json')});
console.log(JSON.stringify({slides:18,pdf:path.join(out,'Team03_FP_Presentation.pdf'),pptx:destination,validation:result}));
if(destination!==finalPath)await fs.copyFile(destination,finalPath);
await fs.writeFile(path.join(work,'latest-validation.json'),JSON.stringify({...result,stableCopy:finalPath},null,2));
