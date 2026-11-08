"""Decode the entire deliverable and save frames from the encoded MP4 for QA."""
from pathlib import Path
import hashlib
import json
import cv2
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
video = root / 'deliverables/Team03_FP_Demo.mp4'
assets = root / 'artifacts/demo-video'
cap = cv2.VideoCapture(str(video))
assert cap.isOpened(), 'MP4 cannot be opened'
fps = cap.get(cv2.CAP_PROP_FPS)
width, height = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)), int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
codec = ''.join(chr(int(cap.get(cv2.CAP_PROP_FOURCC)) >> (8*i) & 255) for i in range(4))
assert (width, height) == (1280, 720)
assert abs(fps - 24) < .01
assert codec in ('avc1', 'h264'), codec
times = [3, 16, 27, 50, 67, 77, 89, 97, 105, 115, 124, 131, 140, 149, 157, 166, 173]
targets = {round(t*fps): t for t in times}
thumbs = []
count = 0
while True:
    ok, frame = cap.read()
    if not ok:
        break
    if count in targets:
        assert frame.mean() > 5, f'Unexpected blank section at {targets[count]}s'
        im = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        im.save(assets / f'encoded-{targets[count]:03}.jpg', quality=91)
        if targets[count] == 3:
            im.save(root / 'deliverables/Team03_FP_Demo_poster.jpg', quality=93)
        thumb = im.resize((426, 240))
        ImageDraw.Draw(thumb).text((8, 8), f'{targets[count]}s', font=ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf', 15), fill='#f79b7b')
        thumbs.append(thumb)
    count += 1
cap.release()
assert count == 176*24, f'Incomplete video: {count} frames'
assert len(thumbs) == len(times)
sheet = Image.new('RGB', (1278, 240*((len(thumbs)+2)//3)), '#0d1015')
for i, im in enumerate(thumbs):
    sheet.paste(im, ((i%3)*426, (i//3)*240))
sheet.save(assets / 'encoded-contact-sheet.jpg', quality=92)
report = {'file': video.name, 'durationSeconds': count/fps, 'decodedFrames': count, 'fps': fps, 'resolution': [width, height], 'codec': codec, 'bytes': video.stat().st_size, 'sha256': hashlib.sha256(video.read_bytes()).hexdigest(), 'checkedSections': times, 'fullDecodePassed': True}
(root/'deliverables/Team03_FP_Demo_validation.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, indent=2))
