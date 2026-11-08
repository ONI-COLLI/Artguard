"""Validate every frame of the new simulated click-through, then publish locally."""
from pathlib import Path
import hashlib
import json
import shutil
import cv2
from PIL import Image, ImageDraw, ImageFont

root=Path(__file__).resolve().parents[1]
out=root/'deliverables'
assets=root/'artifacts/clickthrough-video'
candidate=out/'Team03_FP_Demo_simulation.mp4'
target=out/'Team03_FP_Demo.mp4'
cap=cv2.VideoCapture(str(candidate))
assert cap.isOpened()
fps=cap.get(cv2.CAP_PROP_FPS)
size=[int(cap.get(3)),int(cap.get(4))]
codec=''.join(chr(int(cap.get(cv2.CAP_PROP_FOURCC))>>(i*8)&255) for i in range(4))
assert size==[1920,1080],size
assert abs(fps-60)<.01,fps
assert codec in ['h264','avc1'],codec
points=[4,8.24,15,25,28.24,33,42.24,47,49.6,54.24,62,65.4,68.24,74,78.24,82,87,90.24,95,97,99.3,103,104.24,107,111,114.24,120,123,126.24,130,133,135,138,140.24,145,150,154.24,165,170.24,174]
frames={int(t*fps):t for t in points}
count=0; thumbs=[];min_luma=255
while True:
 ok,frame=cap.read()
 if not ok:break
 min_luma=min(min_luma,float(frame[::32,::32].mean()))
 assert min_luma>7,f'Blank or black transition at frame {count}'
 if count in frames:
  stamp=frames[count]
  assert frame.mean()>5,f'Unexpected blank section at {stamp}s'
  image=Image.fromarray(cv2.cvtColor(frame,cv2.COLOR_BGR2RGB))
  image.save(assets/f'encoded-{stamp:06.2f}.jpg',quality=94)
  if stamp==33:image.save(out/'Team03_FP_Demo_poster.jpg',quality=94)
  thumb=image.resize((480,270))
  ImageDraw.Draw(thumb).text((8,8),f'{stamp}s',font=ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf',15),fill='#f69a79')
  thumbs.append(thumb)
 count+=1
cap.release()
assert count==10680,count
assert count/fps==178 and count/fps<180
assert len(thumbs)==len(points)
sheet=Image.new('RGB',(1920,270*((len(thumbs)+3)//4)),'#111111')
for i,thumb in enumerate(thumbs):sheet.paste(thumb,((i%4)*480,(i//4)*270))
sheet.save(assets/'encoded-contact.jpg',quality=93)
assert candidate.resolve().parent==target.resolve().parent==out.resolve()
assert (out/'previous-animation-v1/Team03_FP_Demo.mp4').exists()
candidate.replace(target)
for source,destination in [('timeline.json','Team03_FP_Demo_timeline.json'),('captions.srt','Team03_FP_Demo.srt')]:shutil.copyfile(assets/source,out/destination)
motion=json.loads((assets/'motion-validation.json').read_text(encoding='utf-8'))
assert motion['fps']==60 and motion['separateModalWindows']==0 and motion['maxClickTargetErrorPx']<.001
report={'file':target.name,'revision':2,'kind':'Smooth code-rendered interface simulation with continuous antialiased cursor','screenRecording':False,'usesScreenshotFrames':False,'durationSeconds':178,'decodedFrames':count,'fps':fps,'resolution':size,'codec':codec,'audio':False,'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'checkedSections':points,'fullDecodePassed':True,'minimumSampledFrameLuma':round(min_luma,3),'motion':motion,'realTransactionsSent':0}
(out/'Team03_FP_Demo_validation.json').write_text(json.dumps(report,indent=2),encoding='utf-8')
unit=json.loads((root/'artifacts/demo-video/evidence.json').read_text(encoding='utf-8'))['tests']
chain=json.loads((root/'artifacts/demo-video/blockchain-results.json').read_text(encoding='utf-8'))
evidence={'team':3,'video':report,'simulation':{'project':'Shared Horizons','identities':['Demo Buyer','Demo Creator','Demo Coauthor'],'license':'Personal, perpetual','paymentTestEth':'0.012','platformFeeTestEth':'0.0012','creatorCreditTestEth':'0.0081','coauthorCreditTestEth':'0.0027','illustrativeGasTestEth':'0.00004','exampleIds':['demo-deposit-01','demo-release-01','demo-withdraw-01']},'recordedActualTests':{'application':unit,'blockchain':chain},'note':'All project, purchase, role-switch, deployment and withdrawal interactions are an animated illustration. Example IDs are not EVM hashes. Only the separately labeled recorded test cards refer to actual saved test runs. No command or financial operation is executed by the animation.'}
(out/'Team03_FP_Demo_evidence.json').write_text(json.dumps(evidence,indent=2),encoding='utf-8')
(out/'Team03_FP_Demo_submission.txt').write_text('ARTGUARD - TEAM 03 ANIMATED CLICK-THROUGH, REVISION 2\n\nFile: Team03_FP_Demo.mp4\nLength: 2:58 (under 3 minutes)\n1920x1080 / 60 fps / H.264 MP4 / English on-screen text / no voice\n\nA directly rendered interface simulation with a small antialiased pointer, continuous curved motion, hover pauses and soft UI transitions. Wallet connection, checkout, document review and withdrawal stay within page cards. Separate modal windows, floating success toasts and black frame transitions are removed. The account dropdown is retained to explain role switching.\n\nAll purchases and payments are fictional and labeled as a simulation. The final test cards cite actual saved runs; they do not depict a fresh test execution. The deployment scene is illustrative. Earlier versions remain in previous-animation-v1, previous-site-recording and previous-illustrated-demo. Use genuine execution footage if the university requires a live contract deployment and test launch.\n\nOneDrive upload remains pending. Upload the file, share with People in Astana IT University, Can view, and put the same sharing URL in the report, presentation and GitHub README.\n',encoding='utf-8')
for directory in ['animated','smooth']:
 final=out/directory;final.mkdir(exist_ok=True)
 for filename in ['Team03_FP_Demo.mp4','Team03_FP_Demo.srt','Team03_FP_Demo_timeline.json','Team03_FP_Demo_validation.json','Team03_FP_Demo_evidence.json','Team03_FP_Demo_submission.txt','Team03_FP_Demo_poster.jpg']:
  shutil.copyfile(out/filename,final/filename)
 assert hashlib.sha256((final/target.name).read_bytes()).hexdigest()==report['sha256']
print(json.dumps(report,indent=2))
