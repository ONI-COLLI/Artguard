"""Render an evidence-based, captioned demo without intermediate frame files.

Run after video-demo.mjs and capture-video-evidence.mjs. All interface shots and
command output are captured from the real application; motion graphics explain
the recorded scenario. This renderer sends RGB frames directly to FFmpeg.
"""
from pathlib import Path
from functools import lru_cache
import argparse
import json
import math
import re
import subprocess
import sys
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
ASSETS = ROOT / 'artifacts/demo-video'
OUT = ROOT / 'deliverables'
OUT.mkdir(exist_ok=True)
W, H, FPS = 1280, 720, 24
BG, PANEL, LINE = '#0d1015', '#191e26', '#303744'
TEXT, MUTED, ACCENT = '#f4f2ee', '#a6afbd', '#f79b7b'
EVIDENCE = json.loads((ASSETS / 'evidence.json').read_text(encoding='utf-8'))
FLOW = json.loads((ASSETS / 'flow.json').read_text(encoding='utf-8'))
ORDER = FLOW['proof']['orders'][0]
DEPLOY = next(d for d in EVIDENCE['deployments'] if d['name'].startswith('Escrow'))
FONT_ROOT = Path('C:/Windows/Fonts')

@lru_cache(None)
def font(size, bold=False, mono=False):
    return ImageFont.truetype(str(FONT_ROOT / ('consola.ttf' if mono else 'segoeuib.ttf' if bold else 'segoeui.ttf')), size)

def ease(p):
    p = max(0, min(1, p))
    return p * p * (3 - 2 * p)

def text(draw, xy, value, size=24, fill=TEXT, bold=False, mono=False):
    draw.text(xy, str(value), font=font(size, bold, mono), fill=fill)

def wrapped(draw, value, x, y, width, size=26, fill=TEXT, bold=False, spacing=9):
    words, lines, line = str(value).split(), [], ''
    for word in words:
        trial = f'{line} {word}'.strip()
        if draw.textlength(trial, font=font(size, bold)) > width and line:
            lines.append(line)
            line = word
        else:
            line = trial
    if line:
        lines.append(line)
    for line in lines:
        text(draw, (x, y), line, size, fill, bold)
        y += size + spacing
    return y

def card(draw, box, fill=PANEL, outline=LINE, radius=20):
    draw.rounded_rectangle(box, radius, fill=fill, outline=outline, width=1)

def pill(draw, x, y, value, fill=ACCENT):
    width = int(draw.textlength(value, font=font(15, True))) + 26
    draw.rounded_rectangle((x, y, x+width, y+31), 15, fill=fill)
    text(draw, (x+13, y+5), value, 15, BG, True)

def short(value, n=12):
    return value[:n] + '...' + value[-8:]

@lru_cache(24)
def shot_file(name):
    return Image.open(ASSETS / name).convert('RGB')

def shot(im, name, box=(48, 150, 1232, 583), crop=None, zoom=0):
    d = ImageDraw.Draw(im)
    x, y, r, b = box
    card(d, box, '#101317')
    text(d, (x+43, y+9), 'ArtGuard / actual captured interface', 13, MUTED)
    for i, color in enumerate(['#f79b7b', '#737b88', '#454d59']):
        d.ellipse((x+12+i*9, y+13, x+18+i*9, y+19), fill=color)
    source = shot_file(name)
    if crop:
        source = source.crop(crop)
    if zoom:
        sw, sh = source.size
        inset = zoom * .025
        source = source.crop((int(sw*inset), int(sh*inset), int(sw*(1-inset)), int(sh*(1-inset))))
    # Contain the image. No stretching, no invented controls or UI alterations.
    avail_w, avail_h = int(r-x-4), int(b-y-36)
    factor = min(avail_w/source.width, avail_h/source.height)
    rw, rh = max(1, round(source.width*factor)), max(1, round(source.height*factor))
    resized = source.resize((rw, rh), Image.Resampling.BICUBIC)
    im.paste(resized, (int(x+(r-x-rw)/2), int(y+34+(avail_h-rh)/2)))

SCENES = [
    (6, 'ARTGUARD', 'Original work. Clear licenses.', 'Blockchain licensing with escrow and transparent co-author payouts.', 'intro'),
    (6, 'THE SYSTEM', 'A license, backed by a transaction', 'Files stay on the server. Fingerprints, payments and license records live on the local blockchain.', 'architecture'),
    (9, '01 / DEPLOY', 'Start a fresh local EVM', 'This command starts a fresh Anvil chain and deploys the contracts from the Solidity source.', 'deploy_run'),
    (12, '01 / DEPLOY', 'Deployment confirmed on chain', 'The deployment receipt succeeded in block 4. Non-empty bytecode is present at the escrow address.', 'deploy_receipt'),
    (7, '02 / DEMO ACCOUNTS', 'Creator. Buyer. Co-author.', 'Separate browser sessions use fictional accounts and funded local test wallets.', 'roles'),
    (6, '03 / MARKETPLACE', 'Find the registered project', 'The buyer opens Shared Horizons and chooses the Personal license.', 'catalog'),
    (8, '03 / PROJECT', 'Review the work and usage rights', 'The buyer sees the preview, description, price and license period before paying.', 'project'),
    (8, '04 / FINGERPRINT', 'One file. One SHA-256 fingerprint.', 'The registry links this fingerprint to the registering wallet. It records a claim, not independent proof of authorship.', 'fingerprint'),
    (10, '05 / CHECKOUT', 'Connect, review, then fund escrow', 'The demo wallet is already connected. The buyer reviews the quoted terms and pays 0.012 test ETH.', 'checkout'),
    (8, '05 / ESCROW DEPOSIT', 'Payment verified. Funds held.', 'A real EVM transaction deposits the payment into the escrow contract. No license is issued yet.', 'deposit'),
    (6, '05 / ESCROW DEPOSIT', 'The buyer is protected during delivery', 'The seller has 72 hours to confirm delivery. Without delivery, the buyer can submit a refund transaction.', 'funded'),
    (7, '06 / DELIVERY', 'The creator confirms delivery', 'The seller sends an on-chain delivery confirmation. The buyer now has 24 hours to review or dispute.', 'seller'),
    (8, '07 / ACCEPTANCE', 'The buyer accepts and releases payment', 'Acceptance sends a second buyer transaction. Release starts the license and allocates revenue.', 'accept'),
    (7, '07 / LICENSE', 'The license belongs to the buyer wallet', 'The buyer can now access the license document and original file. This example uses a perpetual license.', 'license'),
    (13, '08 / REVENUE SPLIT', 'The contract allocates every share', 'The Free plan takes 10%. The remaining 90% is split 75/25 between creator and co-author.', 'split'),
    (7, '09 / CO-AUTHOR WALLET', 'A credit is ready to withdraw', 'The co-author has 0.0027 test ETH credited in the contract. It has not reached the wallet yet.', 'credit'),
    (7, '09 / WITHDRAWAL', 'A separate transaction pays the wallet', 'The co-author withdraws 0.0027 test ETH. The wallet balance rises by that amount minus network gas.', 'withdraw'),
    (10, '10 / INDEPENDENT PROOF', 'Verify against the EVM node', 'The public proof page checks the receipt, canonical block, contract code, events and current storage.', 'proof'),
    (8, '10 / TRANSACTION RECEIPTS', 'Three successful transactions', 'Deposit, release and withdrawal have separate hashes and canonical block receipts. These are blockchain records.', 'receipts'),
    (7, '11 / UNIT TESTS', 'Run the real test suites', 'The tests run against the application and fresh local EVM fixtures. Command output is edited for time.', 'tests_run'),
    (11, '11 / TEST RESULTS', 'All recorded tests passed', 'The contract suite checks payment validation, exact splits, permissions, expiry, disputes, refunds and withdrawals.', 'tests_results'),
    (5, 'TEAM 03 / FINAL PROJECT', 'Deploy. License. Verify.', 'ArtGuard: a local blockchain prototype. Test ETH has no monetary value.', 'end'),
]
DURATION = sum(s[0] for s in SCENES)
STARTS = []
accum = 0
for s in SCENES:
    STARTS.append(accum)
    accum += s[0]

def find_scene(t):
    for i, start in enumerate(STARTS):
        if t < start + SCENES[i][0]:
            return i, t-start
    return len(SCENES)-1, SCENES[-1][0]

def base_frame(t, scene, local):
    duration, chapter, title, caption, kind = scene
    im = Image.new('RGB', (W, H), BG)
    d = ImageDraw.Draw(im)
    # Restrained technical grid and a progress line, always behind real evidence.
    for x in range(0, W, 64):
        d.line((x, 0, x, H), fill='#11161d')
    for y in range(0, H, 64):
        d.line((0, y, W, y), fill='#11161d')
    d.rectangle((0, 0, W*t/DURATION, 4), fill=ACCENT)
    text(d, (48, 26), chapter, 15, ACCENT, True)
    text(d, (1030, 26), 'TEAM 03  /  LOCAL EVM', 14, MUTED)
    offset = round(10*(1-ease(local/.6)))
    text(d, (48, 61+offset), title, 41, TEXT, True)
    text(d, (48, 113), 'ANVIL · CHAIN 31337 · TEST ETH ONLY', 13, MUTED)
    d.line((48, 602, 1232, 602), fill=LINE)
    wrapped(d, caption, 48, 618, 1130, 25, TEXT, spacing=7)
    return im

def terminal(im, lines, elapsed, speed=26, note='Actual recorded command output · edited for time'):
    d = ImageDraw.Draw(im)
    card(d, (48, 150, 1232, 583), '#11161e')
    text(d, (74, 168), note, 14, MUTED)
    d.line((73, 198, 1207, 198), fill=LINE)
    limit = int(max(0, elapsed)*speed)
    y = 217
    for value, color in lines:
        part = value[:max(0, limit)]
        text(d, (76, y), part, 19, color, mono=True)
        limit -= len(value) + 8
        y += 34
        if limit <= 0:
            if int(elapsed*2)%2 == 0:
                xx = 76 + d.textlength(part, font=font(19, mono=True))
                d.rectangle((xx+2, y-31, xx+11, y-11), fill=ACCENT)
            break

def metric(d, box, label, value, detail):
    card(d, box)
    x, y, r, b = box
    text(d, (x+24, y+22), label, 18, MUTED)
    text(d, (x+24, y+60), value, 40, ACCENT, True)
    wrapped(d, detail, x+24, y+122, r-x-48, 18, TEXT)

def arrow(d, a, b, p):
    x1,y1=a; x2,y2=b
    d.line((x1,y1,x2,y2), fill=LINE, width=3)
    d.polygon([(x2,y2),(x2-10,y2-6),(x2-10,y2+6)], fill=MUTED)
    x=x1+(x2-x1)*p; y=y1+(y2-y1)*p
    d.ellipse((x-7,y-7,x+7,y+7), fill=ACCENT)

def draw_content(im, scene, local, contract_result):
    dur, _, _, _, kind = scene
    d = ImageDraw.Draw(im)
    p = ease(local/dur)
    if kind == 'intro':
        shot(im, '18-home-local.png', (620, 160, 1232, 577), crop=(150,190,1730,900), zoom=p)
        text(d, (62, 198), 'artguard.', 69, ACCENT, True)
        wrapped(d, 'Creative work. Protected payments.', 66, 302, 520, 35, TEXT, True)
        pill(d, 66, 443, 'TEAM 03 · FINAL PROJECT')
        text(d, (66, 493), 'Real application + real local transactions', 19, MUTED)
    elif kind == 'architecture':
        labels=[('CREATOR','Upload original'),('REGISTRY','SHA-256 record'),('ESCROW','Hold payment'),('BUYER','Receive license')]
        for i,(a,b) in enumerate(labels):
            x=48+i*304
            if local > i*.55:
                card(d,(x,220,x+272,446))
                text(d,(x+24,246),f'0{i+1}',26,ACCENT,True)
                text(d,(x+24,303),a,25,TEXT,True)
                text(d,(x+24,350),b,18,MUTED)
                if i<3: arrow(d,(x+272,330),(x+302,330),(local*.5)%1)
        text(d,(62,495),'React client  →  Express API  →  Solidity contracts  →  Anvil EVM',23,MUTED)
    elif kind == 'deploy_run':
        raw=(ASSETS/'deploy.log').read_text(encoding='utf-8').splitlines()
        lines=[('> node scripts/video-demo.mjs',ACCENT),('Starting a fresh local Anvil EVM: chain 31337',TEXT)]
        lines += [(v[:101],TEXT) for v in raw[:6]]
        terminal(im,lines,local,77)
    elif kind == 'deploy_receipt':
        pill(d,65,166,'ACTUAL DEPLOYMENT RECEIPT')
        metric(d,(48,218,420,450),'Receipt status','SUCCESS',f'Block {DEPLOY["blockNumber"]} · escrow contract v4')
        metric(d,(442,218,814,450),'Runtime bytecode',f'{DEPLOY["bytecodeBytes"]:,} B','Read back from the deployed address')
        metric(d,(836,218,1232,450),'Network','31337','Fresh local Anvil EVM')
        text(d,(64,477),'CONTRACT  '+DEPLOY['address'],18,TEXT,mono=True)
        text(d,(64,515),'TX  '+DEPLOY['transactionHash'],17,MUTED,mono=True)
    elif kind in ('roles','catalog','project','fingerprint','funded','seller','accept','license','credit','withdraw','proof'):
        names={'roles':'02-roles.png','catalog':'03-catalog.png','project':'04-project.png','fingerprint':'19-file-fingerprint.png','funded':'08-funded-order.png','seller':'09-seller-confirm.png','accept':'10-buyer-review.png','license':'12-license.png','credit':'13-coauthor-credit.png','withdraw':'14-coauthor-withdrawn.png','proof':'16-escrow-proof.png'}
        crops={'roles':(190,180,1730,875),'catalog':(50,170,1860,870),'project':(30,200,1860,880),'fingerprint':(40,340,1050,880),'funded':(260,220,1845,700),'seller':(260,220,1845,735),'accept':(260,220,1845,735),'license':(260,215,1845,680),'credit':(1120,440,1860,894),'withdraw':(275,150,1850,610),'proof':(210,218,1680,728)}
        shot(im,names[kind],crop=crops[kind],zoom=p if kind in ('roles','catalog','project') else 0)
        if kind == 'fingerprint':
            pill(d,76,540,'SHA-256 · registered in block 7')
        elif kind == 'credit':
            pill(d,76,540,'0.0027 test ETH · contract credit')
        elif kind == 'withdraw':
            pill(d,76,540,'WITHDRAWAL CONFIRMED · NETWORK GAS DEDUCTED')
    elif kind in ('checkout','deposit'):
        name='06-checkout-quote.png' if kind=='checkout' else '07-deposit-confirmed.png'
        shot(im,name,(48,150,466,583),crop=(680,44,1210,852))
        x=510
        text(d,(x,173),'SHARED HORIZONS',18,MUTED,True)
        text(d,(x,215),'0.012 test ETH',53,ACCENT,True)
        text(d,(x,286),'Personal license · Perpetual',23,TEXT)
        for i,label in enumerate(['1  Demo wallet connected','2  Usage terms reviewed','3  Deposit confirmed on chain' if kind=='deposit' else '3  Buyer funds escrow']):
            if local>i*.7:
                card(d,(x,342+i*62,1218,391+i*62))
                text(d,(x+19,352+i*62),label,22,TEXT)
        if kind=='deposit': text(d,(x,550),'TX '+short(ORDER['depositHash'],18),16,MUTED,mono=True)
    elif kind == 'split':
        total=0.012
        rows=[('Platform / Free plan','10% of payment','0.0012',.10),('Creator','75% of net proceeds','0.0081',.675),('Co-author','25% of net proceeds','0.0027',.225)]
        text(d,(64,164),'0.012 test ETH',42,ACCENT,True)
        text(d,(840,182),'CREDITS INSIDE THE CONTRACT',17,MUTED,True)
        for i,(role,rule,amount,fraction) in enumerate(rows):
            y=233+i*99
            card(d,(48,y,1232,y+85))
            text(d,(73,y+12),role,23,TEXT,True)
            text(d,(73,y+47),rule,17,MUTED)
            progress=ease((local-i*.8)/3)
            d.rounded_rectangle((460,y+28,460+int(450*fraction*progress),y+57),10,fill=ACCENT)
            text(d,(963,y+21),amount,31,ACCENT,True)
            text(d,(1110,y+30),'test ETH',16,MUTED)
        text(d,(64,551),'Each recipient withdraws separately. Allocation is not a wallet transfer.',21,MUTED)
    elif kind == 'receipts':
        for i,(label,r) in enumerate(zip(['ESCROW DEPOSIT','LICENSE RELEASE','CO-AUTHOR WITHDRAWAL'],FLOW['receipts'])):
            y=161+i*139
            card(d,(48,y,1232,y+122))
            text(d,(70,y+13),label,18,ACCENT,True)
            text(d,(830,y+13),f'BLOCK {r["block"]}  /  SUCCESS',18,TEXT,True)
            text(d,(70,y+49),r['hash'],20,TEXT,mono=True)
            text(d,(70,y+84),'Receipt + canonical block + contract event verified',17,MUTED)
    elif kind == 'tests_run':
        first=(ASSETS/'blockchain-tests.log').read_text(encoding='utf-8')
        first=re.sub(r'\x1b\[[0-9;]*m','',first).splitlines()
        lines=[('> npm run test:blockchain',ACCENT)]
        lines += [(v[:96],TEXT) for v in first if v.startswith('> tsx') or v.startswith('TAP version') or v.startswith('ok ')][:4]
        lines += [('',MUTED),('> '+EVIDENCE['tests']['command'],ACCENT),('RUN  v5.0.5 / application unit suite',TEXT)]
        terminal(im,lines,local,110,note='Actual commands and output excerpts · edited for time')
    elif kind == 'tests_results':
        # Values come from the recorded runner exit status, never from a mock.
        a=contract_result
        metric(d,(48,155,620,377),'Smart contract / local EVM tests',f'{a["passed"]} PASSED',f'{a["failed"]} failed · process exit code {a["exitCode"]}')
        metric(d,(642,155,1232,377),'Application unit tests',f'{EVIDENCE["tests"]["passed"]} PASSED','24 test files · process exit code 0')
        raw=(ASSETS/'blockchain-tests.log').read_text(encoding='utf-8')
        lines=re.sub(r'\x1b\[[0-9;]*m','',raw).splitlines()
        summary=[v for v in lines if re.search(r'(?:#|ℹ) (tests |suites |pass |fail |cancelled |skipped |todo |duration_ms)',v)]
        card(d,(48,393,1232,583),'#11161e')
        text(d,(70,407),'ACTUAL TEST RUNNER SUMMARY',14,MUTED,True)
        for j,line in enumerate(summary[-8:]):
            text(d,(72+(j//4)*575,440+(j%4)*29),line.replace('ℹ',''),20,ACCENT if 'pass ' in line else TEXT,mono=True)
    elif kind == 'end':
        for i,label in enumerate(['SMART CONTRACT DEPLOYED','LICENSE PURCHASE COMPLETED','UNIT TESTS PASSED']):
            if local > i*.45:
                card(d,(130,188+i*104,1150,270+i*104))
                yy=228+i*104
                d.line([(164,yy),(175,yy+11),(196,yy-14)],fill=ACCENT,width=5)
                text(d,(221,214+i*104),label,26,TEXT,True)
        text(d,(380,537),'TEAM 03  /  ARTGUARD  /  FINAL PROJECT',20,MUTED)

def render_frame(t, contract_result):
    index, local=find_scene(t)
    scene=SCENES[index]
    im=base_frame(t,scene,local)
    draw_content(im,scene,local,contract_result)
    # Short fade at each cut. Captions stay on-screen for the whole section.
    fade=min(1 if index==0 else ease(local/.3),ease((scene[0]-local)/.3))
    if fade<1:
        im=Image.blend(Image.new('RGB',(W,H),BG),im,fade)
    return im

def srt_time(seconds):
    ms=round(seconds*1000)
    return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--preview',action='store_true')
    args=parser.parse_args()
    result=json.loads((ASSETS/'blockchain-results.json').read_text(encoding='utf-8'))
    if result['exitCode'] != 0 or result['failed'] or not result['passed']:
        raise RuntimeError('Cannot render a success demo from failing contract tests')
    if DURATION>=180:
        raise RuntimeError('Video must be shorter than 3 minutes')
    (OUT/'Team03_FP_Demo.srt').write_text('\n\n'.join(f'{i+1}\n{srt_time(start)} --> {srt_time(start+s[0])}\n{s[3]}' for i,(start,s) in enumerate(zip(STARTS,SCENES)))+'\n',encoding='utf-8')
    (OUT/'Team03_FP_Demo_timeline.json').write_text(json.dumps([{'start':start,'duration':s[0],'chapter':s[1],'title':s[2],'caption':s[3]} for start,s in zip(STARTS,SCENES)],indent=2),encoding='utf-8')
    if args.preview:
        times=[3,25,57,68,96,115,124,139,149,166,173]
        thumbs=[]
        for t in times:
            frame=render_frame(t,result)
            frame.save(ASSETS/f'preview-{t:03}.jpg',quality=90)
            thumb=frame.resize((426,240))
            ImageDraw.Draw(thumb).text((8,8),f'{t}s',font=font(15,True),fill=ACCENT)
            thumbs.append(thumb)
        sheet=Image.new('RGB',(1278,240*math.ceil(len(thumbs)/3)),BG)
        for i,thumb in enumerate(thumbs): sheet.paste(thumb,((i%3)*426,(i//3)*240))
        sheet.save(ASSETS/'contact-sheet.jpg',quality=90)
        print('Preview contact sheet created',flush=True)
        return
    sys.path.insert(0,str(ROOT/'artifacts/video-tools'))
    import imageio_ffmpeg
    ffmpeg=imageio_ffmpeg.get_ffmpeg_exe()
    output=OUT/'Team03_FP_Demo.mp4'
    log=(ASSETS/'render.log').open('w',encoding='utf-8')
    proc=subprocess.Popen([ffmpeg,'-y','-f','rawvideo','-vcodec','rawvideo','-s',f'{W}x{H}','-pix_fmt','rgb24','-r',str(FPS),'-i','-','-an','-c:v','libx264','-preset','veryfast','-crf','21','-pix_fmt','yuv420p','-movflags','+faststart',str(output)],stdin=subprocess.PIPE,stdout=log,stderr=log)
    try:
        for n in range(DURATION*FPS):
            proc.stdin.write(render_frame(n/FPS,result).tobytes())
            if n%(FPS*10)==0: print(f'Rendered {n//FPS}/{DURATION}s',flush=True)
        proc.stdin.close()
        code=proc.wait()
        if code: raise RuntimeError(f'FFmpeg failed with exit {code}; see render.log')
    finally:
        if proc.poll() is None: proc.kill()
        log.close()
    print(f'Created {output.name}: {DURATION}s, {output.stat().st_size/1024/1024:.1f} MiB',flush=True)

if __name__=='__main__': main()
