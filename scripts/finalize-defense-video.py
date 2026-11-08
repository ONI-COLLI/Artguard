"""Export the successful native-site recording; verify the media and its saved EVM evidence."""
from pathlib import Path
from datetime import datetime
import argparse, hashlib, json, math, shutil, subprocess, sys
import cv2
from PIL import Image, ImageDraw, ImageFont

root=Path(__file__).resolve().parents[1]
args=argparse.ArgumentParser();args.add_argument('--source',required=True);args.add_argument('--run',required=True)
opts=args.parse_args();source=(root/opts.source).resolve();run_dir=root/'artifacts/defense-video'/opts.run
assert source.is_relative_to(root/'artifacts/site-recording') and run_dir.is_relative_to(root/'artifacts/defense-video')
run=json.loads((run_dir/'run.json').read_text(encoding='utf-8'))
proof=json.loads((run_dir/'on-chain-proof.json').read_text(encoding='utf-8'))
receipts=json.loads((run_dir/'canonical-receipts.json').read_text(encoding='utf-8'))
assert run['phase']=='ready' and all(j['status']=='passed' and j['exitCode']==0 and j['failed']==0 for j in run['jobs'].values())
assert proof['status']=='verified' and all(c['passed'] for c in proof['checks'])
assert any(o['licenseActive'] and o['withdrawals'] for o in proof['orders'])
assert len(receipts['receipts'])>=5 and all(r['status']=='success' for r in receipts['receipts'])
stages=[e for e in run['events'] if e['channel']=='stage'];completed=next(e for e in stages if e['text']=='Completed')
created=getattr(source.stat(),'st_birthtime',source.stat().st_ctime)
stamp=lambda s:datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()
duration=math.ceil((stamp(completed['at'])-created+6)*60)/60
assert 60<duration<180,duration
out=root/'deliverables/real';out.mkdir(exist_ok=True)
target=out/'Team03_FP_Demo.mp4';candidate=out/'Team03_FP_Demo.encoding.mp4'
sys.path.insert(0,str(root/'artifacts/video-tools'));import imageio_ffmpeg
ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
with (run_dir/'export.log').open('w',encoding='utf-8') as log:
 subprocess.run([ffmpeg,'-y','-i',str(source),'-t',str(duration),'-map','0:v:0','-an','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',str(candidate)],stdout=log,stderr=log,check=True)
print('Native recording exported. Decoding every frame for validation.',flush=True)
cap=cv2.VideoCapture(str(candidate));assert cap.isOpened()
fps=cap.get(cv2.CAP_PROP_FPS);size=[int(cap.get(3)),int(cap.get(4))]
assert size==[1920,1080] and abs(fps-60)<.01,(size,fps)
points=[3,20,40]+[min(duration-1,max(0,stamp(e['at'])-created+2))for e in stages]
selected={round(t*fps):t for t in points};count=0;thumbs=[]
qa=run_dir/'frames';qa.mkdir(exist_ok=True)
while True:
 ok,frame=cap.read()
 if not ok:break
 if count in selected:
  t=selected[count];im=Image.fromarray(cv2.cvtColor(frame,cv2.COLOR_BGR2RGB));im.save(qa/f'{t:06.2f}.jpg',quality=94)
  thumb=im.resize((480,270));ImageDraw.Draw(thumb).text((8,8),f'{t:.1f}s',font=ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf',15),fill='#f69a79');thumbs.append(thumb)
 count+=1
cap.release();assert abs(count/fps-duration)<.06,(count,duration)
assert len(thumbs)==len(selected)
sheet=Image.new('RGB',(1920,270*math.ceil(len(thumbs)/4)),'#111111')
for i,thumb in enumerate(thumbs):sheet.paste(thumb,((i%4)*480,(i//4)*270))
sheet.save(run_dir/'contact.jpg',quality=94)
candidate.replace(target)
media={'file':target.name,'kind':'Recording of the actual React application and fresh local EVM operations','simulatedTransactions':False,'sourceRecording':source.name,'durationSeconds':count/fps,'fps':fps,'resolution':size,'decodedFrames':count,'fullDecodePassed':True,'audio':False,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'checkedSections':points,'edit':'Trimmed trailing idle time only; no scenario steps or command output were replaced.'}
evidence={'team':3,'runId':opts.run,'startedAt':run['startedAt'],'media':media,'deployments':run['contracts'],'tests':run['jobs'],'proof':proof,'canonicalReceipts':receipts,'stages':stages}
(out/'Team03_FP_Demo_validation.json').write_text(json.dumps(media,indent=2),encoding='utf-8')
(out/'Team03_FP_Demo_evidence.json').write_text(json.dumps(evidence,indent=2),encoding='utf-8')
for name in ['run.json','on-chain-proof.json','canonical-receipts.json']:shutil.copyfile(run_dir/name,out/name)
proof_time=next(t for i,t in enumerate(points[3:])if stages[i]['text'].startswith('10'))
shutil.copyfile(qa/f'{proof_time:06.2f}.jpg',out/'Team03_FP_Demo_poster.jpg')
(out/'Team03_FP_Demo_submission.txt').write_text(f'TEAM 03 - ACTUAL LOCAL PROTOTYPE DEMO\n\nFile: Team03_FP_Demo.mp4\nDuration: {count/fps:.2f} seconds (under 3 minutes)\n1920x1080, 60 fps, English captions in the site, no audio.\n\nThis recording shows fresh deployment, actual buyer escrow deposit, creator delivery, buyer release, issued license, co-author withdrawal, independent EVM checks and fresh selected unit / contract tests. It uses the real React pages, not a redrawn imitation. Only trailing idle time was trimmed.\n\nThe selected suites passed {run["jobs"]["unit"]["passed"]} application unit tests and {run["jobs"]["contracts"]["passed"]} EVM escrow tests; this is not a claim that every repository suite was run. Five canonical receipts were reread from the live EVM after recording. No private keys, seed phrases or .env content appear in the recorded page.\n\nOneDrive upload is still pending. Upload using the university account, share with People in Astana IT University, Can view, no expiry; if unavailable, use People you choose and the instructor address from the assignment. Keep the same URL in the report title page, presentation title slide and GitHub README. Keep the file and link until final grades, and do not move or rename after submission.\n',encoding='utf-8')
shutil.copyfile(target,root/'deliverables/Team03_FP_Demo.mp4')
print(json.dumps(media,indent=2))
subprocess.run([sys.executable,'-X','utf8',str(root/'scripts/package-defense-delivery.py')],check=True)
