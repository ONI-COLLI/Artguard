"""Synchronize captions, documentation and aliases for the already verified native recording."""
from pathlib import Path
from datetime import datetime
import json, re, shutil

root=Path(__file__).resolve().parents[1];out=root/'deliverables/real'
media=json.loads((out/'Team03_FP_Demo_validation.json').read_text(encoding='utf-8'))
evidence=json.loads((out/'Team03_FP_Demo_evidence.json').read_text(encoding='utf-8'))
run=json.loads((out/'run.json').read_text(encoding='utf-8'))
source=root/'artifacts/site-recording'/media['sourceRecording']
created=getattr(source.stat(),'st_birthtime',source.stat().st_ctime)
stamp=lambda s:datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()-created
code=(root/'src/pages/defense.tsx').read_text(encoding='utf-8')
captions=dict(re.findall(r"await\s+stage\(\s*'([^']+)',\s*'([^']+)'",code))
timeline=[{'start':0,'title':'ArtGuard · real local-network demonstration','caption':'Deploy a smart contract, buy a license, release escrow and verify a co-author payout.'},
 {'start':stamp(run['startedAt']),'title':'01 · Deploy contracts and launch real checks','caption':'These commands run now. Solidity contracts deploy to Anvil, chain 31337. Selected unit and escrow tests run independently.'}]
for e in evidence['stages']:
 title=e['text'];caption=captions.get(title)
 if title=='Completed':title='ArtGuard · verified on a local blockchain';caption='Contract deployed. License purchased through escrow. Co-author paid. Selected unit and EVM tests passed.'
 assert caption,title
 timeline.append({'start':stamp(e['at']),'title':title,'caption':caption})
def time(t):
 ms=round(max(0,t)*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
for i,item in enumerate(timeline):item['end']=timeline[i+1]['start'] if i+1<len(timeline) else media['durationSeconds']
(out/'Team03_FP_Demo_timeline.json').write_text(json.dumps(timeline,indent=2),encoding='utf-8')
(out/'Team03_FP_Demo.srt').write_text('\n\n'.join(f'{i+1}\n{time(t["start"])} --> {time(t["end"])}\n{t["title"]}\n{t["caption"]}'for i,t in enumerate(timeline))+'\n',encoding='utf-8')
poster=root/'artifacts/defense-video'/evidence['runId']/'frames/proof-110.jpg'
if poster.exists():shutil.copyfile(poster,out/'Team03_FP_Demo_poster.jpg')
for name in ['Team03_FP_Demo.srt','Team03_FP_Demo_timeline.json','Team03_FP_Demo_validation.json','Team03_FP_Demo_evidence.json','Team03_FP_Demo_poster.jpg','Team03_FP_Demo_submission.txt']:
 shutil.copyfile(out/name,root/'deliverables'/name)
readme=root/'README.md';text=readme.read_text(encoding='utf-8');start=text.index('## Team 03 demo video');end=text.index('For a full public test server',start)
seconds=round(media['durationSeconds']);duration=f'{seconds//60}:{seconds%60:02}'
section=f'''## Team 03 demo video

[Watch / download Team03_FP_Demo.mp4](deliverables/real/Team03_FP_Demo.mp4) — {duration}, 1920×1080 at 60 fps, English on-screen captions, no audio. This version records the actual React application on a fresh isolated Anvil EVM: contract deployment, buyer escrow deposit, creator delivery, buyer acceptance, active license, creator credit, co-author withdrawal and direct transaction verification. The recorded run passed {run['jobs']['unit']['passed']} selected application unit tests and {run['jobs']['contracts']['passed']} EVM escrow tests, with zero failures and exit code 0. This is a selected-suite result, not a claim that every repository test was run. Five successful canonical receipts were reread from the live EVM after recording. Only trailing idle time was trimmed. [English captions](deliverables/real/Team03_FP_Demo.srt), [EVM and test evidence](deliverables/real/Team03_FP_Demo_evidence.json) and [media validation](deliverables/real/Team03_FP_Demo_validation.json) accompany the MP4. Earlier simulated interface animations remain in `deliverables/smooth/` and `deliverables/previous-animation-v1/`.

University OneDrive submission is pending. Upload through the university account, share with **People in Astana IT University**, permission **Can view**, and leave expiry unset. If that option is unavailable, use **People you choose** and the instructor address from the assignment. Add the institutional sharing URL to the report title page, presentation title slide and GitHub README. Keep the video and link available until final grades, and do not move or rename after submission. The local file link above is not an institutional sharing link.

'''
text=text[:start]+section+text[end:]
if '## Live defense using the actual site' not in text:
 section='''## Live defense using the actual site

Run `npm run build`, then `npm run demo:defense`, and open **http://127.0.0.1:3600/#/defense**. The isolated teaching server uses ports 3600/8665 and a fresh `runtime/defense-*` directory, preserving the existing private/public instances. **Start real demonstration** launches fixed deployment and test commands and drives the actual React checkout, escrow, license and wallet pages using fictional demo accounts. This creates real local test-chain transactions. No private keys, seed phrases, `.env` content or fixture passwords are sent to the presentation UI.

After the run, **Review this verified run** exposes Deployment, Completed purchase, License, Creator wallet, Co-author wallet, EVM proof and Test results. Technical evidence can be reviewed without signing in. Role pages use the prepared fictional demo identities. Review does not repeat purchases or tests; the proof component reads the current EVM and test results remain identified as saved output of that run. A new full run requires a fresh isolated launcher instance. Command endpoints require the explicit local defense flag, isolated data directory, loopback socket, exact local host/origin and a custom request header; they remain disabled on shared public servers.

'''
 text=text.replace('## Team 03 demo video',section+'## Team 03 demo video',1)
readme.write_text(text,encoding='utf-8')
print(json.dumps({'file':'deliverables/real/Team03_FP_Demo.mp4','duration':duration,'captionSections':len(timeline),'applicationUnitTests':run['jobs']['unit']['passed'],'evmTests':run['jobs']['contracts']['passed'],'canonicalReceipts':len(evidence['canonicalReceipts']['receipts'])}))
