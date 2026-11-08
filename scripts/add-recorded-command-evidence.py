"""Add clearly labeled command-output replays inside the native site's stage.

The full OBS frame is retained. Text comes from real saved command runs; the
overlay never claims to execute commands during playback.
"""
from pathlib import Path
import hashlib
import json
import re
import shutil
import subprocess
import sys
import textwrap
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
folder = root / 'artifacts/site-recording'
out = root / 'deliverables'
final = out / 'Team03_FP_Demo.mp4'
base = folder / 'native-trimmed.mp4'
if not base.exists(): shutil.copyfile(final, base)
sys.path.insert(0, str(root / 'artifacts/video-tools'))
import imageio_ffmpeg
mono = ImageFont.truetype('C:/Windows/Fonts/consola.ttf', 18)
label = ImageFont.truetype('C:/Windows/Fonts/segoeui.ttf', 14)
logs = root / 'artifacts/demo-video'
deployment = ['> node scripts/video-demo.mjs'] + (logs/'deploy.log').read_text(encoding='utf-8').strip().splitlines()
unit = (logs/'unit-tests.log').read_text(encoding='utf-8')
contract = (logs/'blockchain-tests.log').read_text(encoding='utf-8')
unit_lines = [line.strip() for line in unit.splitlines() if re.match(r'\s*(> artguard|> vitest|RUN |Test Files |Tests |Duration )',line)]
contract_lines = [line.strip() for line in contract.splitlines() if re.match(r'(#|ℹ) (tests |pass |fail )',line)]
tests = ['> npm run test:unit -- --maxWorkers=1 --no-file-parallelism'] + unit_lines + ['','> npm run test:blockchain'] + contract_lines
def lines_for(values):
    result=[]
    for line in values:
        result.extend(textwrap.wrap(line,width=109,break_long_words=False,break_on_hyphens=False) or [''])
    assert len(result) <= 14, len(result)
    return result
deployment, tests = lines_for(deployment), lines_for(tests)
def overlay(frame, time):
    if 10 <= time < 22: values, local = deployment, time-10
    elif 154 <= time < 166: values, local = tests, time-154
    else: return frame
    im=Image.fromarray(cv2.cvtColor(frame,cv2.COLOR_BGR2RGB))
    layer=im.copy(); draw=ImageDraw.Draw(layer)
    draw.rounded_rectangle((437,284,1685,751 if time>=154 else 676),radius=16,fill='#191919',outline='#333333',width=1)
    draw.rectangle((1340,181,1680,208),fill='#212121')
    draw.text((1460,188),'Recorded command replay',font=label,fill='#919191')
    draw.text((459,302),'ACTUAL RECORDED COMMAND OUTPUT · EDITED FOR TIME',font=label,fill='#b4b4b4')
    draw.line((459,329,1663,329),fill='#333333',width=1)
    show=min(len(values),int(local*2)+1)
    for index,value in enumerate(values[:show]):
        draw.text((459,341+index*22),value,font=mono,fill='#f69a79' if value.startswith('> ') else '#ececec')
    fade=min(1,local/.2,(12-local)/.2)
    im=Image.blend(im,layer,max(0,fade))
    return cv2.cvtColor(np.asarray(im),cv2.COLOR_RGB2BGR)
capture=cv2.VideoCapture(str(base))
assert capture.isOpened()
for stamp in [17,161]:
    capture.set(cv2.CAP_PROP_POS_MSEC,stamp*1000);ok,frame=capture.read();assert ok
    Image.fromarray(cv2.cvtColor(overlay(frame,stamp),cv2.COLOR_BGR2RGB)).save(folder/f'command-preview-{stamp}.jpg',quality=93)
capture.release()
if '--preview' in sys.argv:
    print('Command evidence previews saved.');sys.exit()
capture=cv2.VideoCapture(str(base))
temporary=out/'Team03_FP_Demo_evidence-edit.mp4'
with (folder/'evidence-encode.log').open('w',encoding='utf-8') as log:
    encoder=subprocess.Popen([imageio_ffmpeg.get_ffmpeg_exe(),'-y','-f','rawvideo','-pix_fmt','bgr24','-s','1920x1080','-r','30','-i','-','-an','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',str(temporary)],stdin=subprocess.PIPE,stdout=log,stderr=log)
    n=0
    while True:
        ok,frame=capture.read()
        if not ok:break
        encoder.stdin.write(overlay(frame,n/30).tobytes());n+=1
        if n%900==0:print(f'Processed {n//30}/178 seconds',flush=True)
    capture.release();encoder.stdin.close();code=encoder.wait();assert code==0
assert n==5340,n
print('Verifying the complete edited MP4...',flush=True)
capture=cv2.VideoCapture(str(temporary));frames=0
assert [int(capture.get(3)),int(capture.get(4))]==[1920,1080]
assert abs(capture.get(cv2.CAP_PROP_FPS)-30)<.01
while True:
    ok,frame=capture.read()
    if not ok:break
    if frames in [17*30,161*30,174*30]:
        assert frame.mean()>6
        Image.fromarray(cv2.cvtColor(frame,cv2.COLOR_BGR2RGB)).save(folder/f'evidence-final-{frames//30}.jpg',quality=93)
    frames+=1
capture.release();assert frames==5340
temporary.replace(final)
report=json.loads((out/'Team03_FP_Demo_validation.json').read_text(encoding='utf-8'))
report.update({'bytes':final.stat().st_size,'sha256':hashlib.sha256(final.read_bytes()).hexdigest(),'recordedCommandReplays':[{'start':10,'end':22,'source':'actual deployment command and deploy.log'},{'start':154,'end':166,'source':'actual unit and contract test commands and runner summaries'}],'fullDecodePassed':True})
(out/'Team03_FP_Demo_validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
evidence=json.loads((out/'Team03_FP_Demo_evidence.json').read_text(encoding='utf-8'))
evidence['recording']=report
evidence['recordedCommands']={'deployment':deployment,'tests':tests}
evidence['note']='The OBS capture retains the complete website frame. Two stage panels contain clearly labeled, time-compressed replays of actual saved deployment/test command output. No command execution or new payment is claimed during playback. The example withdrawal is labeled as an illustration, and the live proof reads existing EVM receipts.'
(out/'Team03_FP_Demo_evidence.json').write_text(json.dumps(evidence,indent=2),encoding='utf-8')
print(json.dumps(report,indent=2),flush=True)
