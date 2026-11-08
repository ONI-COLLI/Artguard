"""Make an exact 3:00 cut using the real recording and clearly labeled reading pauses."""
from pathlib import Path
from functools import lru_cache
import copy, hashlib, json, math, shutil, subprocess, sys
import cv2
from PIL import Image, ImageDraw, ImageFont

ROOT=Path(__file__).resolve().parents[1]
SOURCE=ROOT/'deliverables/real/Team03_FP_Demo.mp4'
SOURCE_META=json.loads((SOURCE.parent/'Team03_FP_Demo_validation.json').read_text(encoding='utf-8'))
assert hashlib.sha256(SOURCE.read_bytes()).hexdigest()==SOURCE_META['sha256']
OUT=ROOT/'deliverables/three-minute';OUT.mkdir(exist_ok=True)
QA=ROOT/'artifacts/three-minute-video';QA.mkdir(exist_ok=True)
FPS=60;SOURCE_FRAMES=7660;TOTAL_FRAMES=10800
# The original motion and command output play at normal speed. Insertions only
# pause already recorded evidence, with an explicit recorded-frame label.
PAUSES=[
 (41,480,'DEPLOYMENT PROOF','A successful deployment receipt creates this contract address. Non-empty runtime bytecode confirms that Solidity code exists on the local EVM.'),
 (65.5,360,'THE SIGNED OFFER','The EIP-712 signature binds the buyer, file and terms fingerprints, amount, fee, shares and expiry. Changing a signed value invalidates the offer.'),
 (74,420,'ESCROW HOLDS THE PAYMENT','The 0.012 test ETH stays in the contract after deposit. The license has not started, and recipients cannot withdraw this order’s proceeds yet.'),
 (85.5,360,'LICENSE OWNERSHIP','Acceptance records the buyer wallet, artwork and selected license on-chain. ArtGuard verifies the release before unlocking the protected original file.'),
 (91,420,'REVENUE ALLOCATION','0.012 test ETH minus 10% leaves 0.0108: creator credit 0.0081, co-author credit 0.0027. Each recipient withdraws separately; gas is additional.'),
 (110,600,'VERIFY THE TRANSACTIONS','Deposit, release and withdrawal have different transaction hashes. The local EVM confirms successful receipts, canonical blocks and the active license.'),
 (118.5,500,'READ THE ACTUAL TEST RESULTS','This recorded run passed 21 selected application unit tests and 10 EVM escrow tests: 0 failures, exit code 0. These are actual results from the saved run.'),
]
assert SOURCE_FRAMES+sum(p[1]for p in PAUSES)==TOTAL_FRAMES
plan=[];shift=0
for second,frames,title,caption in PAUSES:
 n=round(second*FPS);start=(n+1+shift)/FPS
 plan.append({'sourceFrame':n,'sourceTime':second,'frames':frames,'start':start,'end':start+frames/FPS,'title':title,'caption':caption,'kind':'reading-pause'})
 shift+=frames
(QA/'edit-plan.json').write_text(json.dumps(plan,indent=2),encoding='utf-8')
lookup={p['sourceFrame']:p for p in plan}

@lru_cache(None)
def font(size,bold=False):
 return ImageFont.truetype('C:/Windows/Fonts/'+('segoeuib.ttf'if bold else'segoeui.ttf'),size)

def reading_frame(frame,pause):
 im=frame.copy();d=ImageDraw.Draw(im)
 d.rectangle((0,976,1919,1079),fill='#111111');d.line((0,976,1919,976),fill='#303030')
 d.text((36,991),pause['title'],font=font(13,True),fill='#f69a79')
 line='';y=1017
 for word in pause['caption'].split():
  test=(line+' '+word).strip()
  if line and d.textlength(test,font=font(20))>1830:
   d.text((36,y),line,font=font(20),fill='#ececec');y+=27;line=word
  else:line=test
 if line:d.text((36,y),line,font=font(20),fill='#ececec')
 assert y+25<=1079,'Caption exceeds the native footer.'
 d.rounded_rectangle((1040,12,1378,44),radius=15,fill='#222222',outline='#373737')
 d.text((1056,20),'READING PAUSE · RECORDED FRAME',font=font(12,True),fill='#f69a79')
 return im

def ease(p):p=max(0,min(1,p));return p*p*(3-2*p)

sys.path.insert(0,str(ROOT/'artifacts/video-tools'));import imageio_ffmpeg
target=OUT/'Team03_FP_Demo.mp4';temporary=OUT/'Team03_FP_Demo.encoding.mp4'
cap=cv2.VideoCapture(str(SOURCE));assert cap.isOpened()
assert round(cap.get(cv2.CAP_PROP_FRAME_COUNT))==SOURCE_FRAMES and abs(cap.get(cv2.CAP_PROP_FPS)-FPS)<.001
with (QA/'encode.log').open('w',encoding='utf-8')as log:
 encoder=subprocess.Popen([imageio_ffmpeg.get_ffmpeg_exe(),'-y','-f','rawvideo','-pix_fmt','rgb24','-s','1920x1080','-r',str(FPS),'-i','-','-an','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',str(temporary)],stdin=subprocess.PIPE,stdout=log,stderr=log)
 written=0;source_count=0;last_progress=-1
 while True:
  ok,bgr=cap.read()
  if not ok:break
  rgb=cv2.cvtColor(bgr,cv2.COLOR_BGR2RGB);encoder.stdin.write(rgb.tobytes());written+=1
  pause=lookup.get(source_count)
  if pause:
   original=Image.fromarray(rgb);annotated=reading_frame(original,pause);steady=annotated.tobytes()
   annotated.save(QA/f'pause-{pause["sourceTime"]}.jpg',quality=94)
   for k in range(pause['frames']):
    opacity=ease(min(k/12,(pause['frames']-1-k)/12))
    encoder.stdin.write(steady if opacity>=1 else Image.blend(original,annotated,opacity).tobytes());written+=1
  source_count+=1
  progress=(written//(FPS*15))*15
  if progress!=last_progress:print(f'Encoded {min(180,progress)}/180 seconds',flush=True);last_progress=progress
 cap.release();encoder.stdin.close();assert encoder.wait()==0
assert source_count==SOURCE_FRAMES and written==TOTAL_FRAMES
print('Encoded exact 3:00. Validating all 10,800 frames.',flush=True)

cap=cv2.VideoCapture(str(temporary));assert cap.isOpened()
fps=cap.get(cv2.CAP_PROP_FPS);size=[int(cap.get(3)),int(cap.get(4))]
assert fps==60 and size==[1920,1080]
sample_times=[3,20]+[(p['start']+p['end'])/2 for p in plan]+[177]
samples={round(t*fps):t for t in sample_times};count=0;thumbs=[]
while True:
 ok,frame=cap.read()
 if not ok:break
 if count in samples:
  t=samples[count];assert frame.mean()>7
  im=Image.fromarray(cv2.cvtColor(frame,cv2.COLOR_BGR2RGB));im.save(QA/f'encoded-{t:06.2f}.jpg',quality=94)
  thumb=im.resize((640,360));ImageDraw.Draw(thumb).text((8,8),f'{t:.1f}s',font=font(18,True),fill='#f69a79');thumbs.append(thumb)
 count+=1
cap.release();assert count==10800 and count/fps==180
sheet=Image.new('RGB',(1920,360*math.ceil(len(thumbs)/3)),'#111111')
for i,thumb in enumerate(thumbs):sheet.paste(thumb,((i%3)*640,(i//3)*360))
sheet.save(QA/'contact.jpg',quality=94)
temporary.replace(target)

old_timeline=json.loads((SOURCE.parent/'Team03_FP_Demo_timeline.json').read_text(encoding='utf-8'))
timeline=[]
def shifted(t):return t+sum(p['frames']/FPS for p in plan if p['sourceTime']<t)
for section in old_timeline:
 cuts=[p for p in plan if section['start']<p['sourceTime']+1/FPS<section['end']]
 source_start=section['start']
 for pause in cuts:
  timeline.append({**section,'start':shifted(source_start),'end':pause['start'],'kind':'recorded-footage'})
  timeline.append({k:pause[k]for k in ['start','end','title','caption','kind']})
  source_start=pause['sourceTime']+1/FPS
 timeline.append({**section,'start':shifted(source_start),'end':shifted(section['end']),'kind':'recorded-footage'})
assert abs(timeline[-1]['end']-180)<.001
for a,b in zip(timeline,timeline[1:]):assert abs(a['end']-b['start'])<.001,(a,b)
def srt_time(t):
 ms=round(t*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
(OUT/'Team03_FP_Demo_timeline.json').write_text(json.dumps(timeline,indent=2),encoding='utf-8')
(OUT/'Team03_FP_Demo.srt').write_text('\n\n'.join(f'{i+1}\n{srt_time(t["start"])} --> {srt_time(t["end"])}\n{t["title"]}\n{t["caption"]}'for i,t in enumerate(timeline))+'\n',encoding='utf-8')
media={'file':target.name,'kind':'Actual native-site recording with labeled explanatory reading pauses','durationSeconds':180,'fps':fps,'resolution':size,'decodedFrames':count,'fullDecodePassed':True,'audio':False,'simulatedTransactions':False,'sourceRecording':SOURCE_META['sourceRecording'],'sourceClipSha256':SOURCE_META['sha256'],'originalFrames':SOURCE_FRAMES,'readingPauseFrames':sum(p['frames']for p in plan),'playbackSpeed':1,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'checkedSections':sample_times,'edit':'Seven labeled reading pauses added to the original verified recording. Original motion and command output remain at normal speed; no new transaction or test run is implied.','readingPauses':plan}
(OUT/'Team03_FP_Demo_validation.json').write_text(json.dumps(media,indent=2),encoding='utf-8')
evidence=copy.deepcopy(json.loads((SOURCE.parent/'Team03_FP_Demo_evidence.json').read_text(encoding='utf-8')));evidence['media']=media;evidence['videoTimeline']=timeline
(OUT/'Team03_FP_Demo_evidence.json').write_text(json.dumps(evidence,indent=2),encoding='utf-8')
for name in ['run.json','on-chain-proof.json','canonical-receipts.json']:shutil.copyfile(SOURCE.parent/name,OUT/name)
shutil.copyfile(QA/'pause-110.jpg',OUT/'Team03_FP_Demo_poster.jpg')
(OUT/'Team03_FP_Demo_submission.txt').write_text('TEAM 03 - EXACT THREE-MINUTE EDIT\n\nTeam03_FP_Demo.mp4\nDuration: exactly 3:00 (10,800 frames at 60 fps)\n1920x1080, H.264, English on-screen explanation, no audio.\n\nThe real recorded deployment and purchase workflow are preserved at normal playback speed. Seven clearly labeled reading pauses explain deployment proof, signed quotes, escrow, license ownership, revenue shares, transaction receipts and actual test results. The underlying run passed 21 selected application unit tests and 10 EVM escrow tests; this edit does not execute or invent new tests or transactions. Original evidence and canonical receipts are included.\n\nUniversity OneDrive upload and institutional sharing URL remain pending. Use People in Astana IT University, Can view, no expiry, and add that same URL to the report title page, presentation title slide and README.\n',encoding='utf-8')
for filename in ['Team03_FP_Demo.mp4','Team03_FP_Demo_validation.json','Team03_FP_Demo_evidence.json','Team03_FP_Demo_timeline.json','Team03_FP_Demo.srt','Team03_FP_Demo_poster.jpg','Team03_FP_Demo_submission.txt']:
 shutil.copyfile(OUT/filename,ROOT/'deliverables'/filename)
readme=ROOT/'README.md';text=readme.read_text(encoding='utf-8');start=text.index('## Team 03 demo video');end=text.index('For a full public test server',start)
section=text[start:end].replace('deliverables/real/','deliverables/three-minute/').replace('— 2:08,','— exactly 3:00,').replace('Only trailing idle time was trimmed.','This three-minute edit adds seven labeled reading pauses to explain the recorded evidence. Original motion and command output play at normal speed; the edit does not create or replace any transaction or test result.')
readme.write_text(text[:start]+section+text[end:],encoding='utf-8')
print(json.dumps({'file':str(target),'durationSeconds':180,'frames':count,'fps':fps,'bytes':target.stat().st_size,'fullDecodePassed':True,'sha256':media['sha256']},indent=2),flush=True)
