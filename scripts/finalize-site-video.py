"""Trim and verify the real OBS browser-source recording; no screenshot montage."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys
import cv2
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parents[1]
folder = root / 'artifacts/site-recording'
out = root / 'deliverables'
raw = sorted(folder.glob('*.mp4'), key=lambda f: f.stat().st_mtime)[-1]
temporary = out / 'Team03_FP_Demo_site.mp4'
target = out / 'Team03_FP_Demo.mp4'
start, duration = 10.1, 178
sys.path.insert(0, str(root / 'artifacts/video-tools'))
import imageio_ffmpeg
ffmpeg = imageio_ffmpeg.get_ffmpeg_exe()
with (folder / 'encode.log').open('w', encoding='utf-8') as log:
    process = subprocess.Popen([ffmpeg, '-y', '-ss', str(start), '-i', str(raw), '-t', str(duration), '-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30', '-movflags', '+faststart', str(temporary)], stdout=log, stderr=log)
    print('Encoding the real full-frame site recording...', flush=True)
    code = process.wait()
    if code:
        raise RuntimeError('FFmpeg failed; see artifacts/site-recording/encode.log')
print('Encoding finished. Decoding every frame for verification...', flush=True)
capture = cv2.VideoCapture(str(temporary))
assert capture.isOpened()
fps = capture.get(cv2.CAP_PROP_FPS)
size = [int(capture.get(3)), int(capture.get(4))]
assert size == [1920, 1080], size
assert abs(fps - 30) < .01, fps
times = [4, 19, 35, 50, 65, 81, 96, 113, 130, 134, 145, 163, 174]
samples = {round(t * fps): t for t in times}
thumbnails = []
frame_count = 0
while True:
    ok, frame = capture.read()
    if not ok:
        break
    if frame_count in samples:
        stamp = samples[frame_count]
        assert frame.mean() > 6, f'Unexpected empty scene at {stamp}s'
        im = Image.fromarray(cv2.cvtColor(frame, cv2.COLOR_BGR2RGB))
        im.save(folder / f'final-{stamp:03}.jpg', quality=93)
        if stamp == 4:
            im.save(out / 'Team03_FP_Demo_poster.jpg', quality=94)
        small = im.resize((640, 360))
        ImageDraw.Draw(small).text((10, 10), f'{stamp}s', font=ImageFont.truetype('C:/Windows/Fonts/segoeuib.ttf', 16), fill='#f69a79')
        thumbnails.append(small)
    frame_count += 1
capture.release()
assert frame_count == duration * 30, frame_count
assert frame_count / fps < 180
assert len(thumbnails) == len(samples)
sheet = Image.new('RGB', (1920, 360 * ((len(thumbnails) + 2) // 3)), '#111111')
for i, im in enumerate(thumbnails):
    sheet.paste(im, ((i % 3) * 640, (i // 3) * 360))
sheet.save(folder / 'final-contact.jpg', quality=92)

# The first MP4 and its matching evidence/captions were preserved before capture.
assert (out / 'previous-illustrated-demo/Team03_FP_Demo.mp4').is_file()
assert temporary.resolve().parent == target.resolve().parent == out.resolve()
temporary.replace(target)
source = (root / 'src/pages/presentation.tsx').read_text(encoding='utf-8').split('] as const;')[0]
pattern = r"short:\s*'((?:\\.|[^'])*)'[\s\S]*?title:\s*'((?:\\.|[^'])*)'[\s\S]*?seconds:\s*(\d+)[\s\S]*?caption:\s*'((?:\\.|[^'])*)'"
chapters = re.findall(pattern, source)
assert len(chapters) == 11, len(chapters)
def timestamp(seconds):
    milliseconds = round(seconds * 1000)
    return f'{milliseconds//3600000:02}:{milliseconds//60000%60:02}:{milliseconds//1000%60:02},{milliseconds%1000:03}'
subtitles, timeline, current = [], [], 0
for index, (name, title, seconds, caption) in enumerate(chapters):
    stop = current + int(seconds) if index < len(chapters)-1 else duration
    caption = caption.replace("\\'", "'")
    subtitles.append(f'{index+1}\n{timestamp(current)} --> {timestamp(stop)}\n{caption}')
    timeline.append({'start': current, 'end': stop, 'chapter': name, 'title': title, 'caption': caption})
    current += int(seconds)
(out / 'Team03_FP_Demo.srt').write_text('\n\n'.join(subtitles)+'\n', encoding='utf-8')
(out / 'Team03_FP_Demo_timeline.json').write_text(json.dumps(timeline, indent=2), encoding='utf-8')
report = {'file': target.name, 'capture': 'Actual ArtGuard website rendered and recorded with OBS Browser Source', 'durationSeconds': frame_count/fps, 'decodedFrames': frame_count, 'fps': fps, 'resolution': size, 'codec': 'H.264', 'audio': False, 'bytes': target.stat().st_size, 'sha256': hashlib.sha256(target.read_bytes()).hexdigest(), 'checkedSections': times, 'fullDecodePassed': True, 'sourceRecording': raw.name, 'sourceTrimStartSeconds': start}
(out / 'Team03_FP_Demo_validation.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
proof = json.loads((root / 'artifacts/demo-video/flow.json').read_text(encoding='utf-8'))
(out / 'Team03_FP_Demo_evidence.json').write_text(json.dumps({'team': 3, 'recording': report, 'onChainEvidence': proof, 'note': 'The guided flow is labeled as an illustration. The on-chain proof and deployment chapters read the local EVM. Test cards are timestamped historical command results. The recording itself does not deploy a contract or execute test commands.'}, indent=2), encoding='utf-8')
(out / 'Team03_FP_Demo_submission.txt').write_text('TEAM 03 - ARTGUARD NATIVE SITE RECORDING\n\nFile: Team03_FP_Demo.mp4\nLength: 2:58\n1920x1080, 30 fps, H.264 MP4, English on-screen explanation, no audio.\n\nThis is a real OBS recording of the in-site guided demonstration, with the initial waiting time trimmed. The whole browser-source frame is retained. Illustrated actions are labeled; EVM proof is read-only; test results are historical recorded runs. This version does not show a fresh contract deployment or test execution during capture. The earlier video with edited actual command output remains in previous-illustrated-demo.\n\nUniversity OneDrive upload is still pending. Upload the MP4 and choose People in Astana IT University / Can view. Put the same sharing URL in the report, presentation and GitHub README.\n', encoding='utf-8')
print(json.dumps(report, indent=2), flush=True)
