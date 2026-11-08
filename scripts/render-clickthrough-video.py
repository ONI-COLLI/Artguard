"""Code-rendered ArtGuard product animation. No screen capture, browser playback,
or screenshot crops. Every purchase/withdrawal in this film is illustrative.
"""
from pathlib import Path
from functools import lru_cache
import argparse
import hashlib
import json
import math
import re
import subprocess
import sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT=Path(__file__).resolve().parents[1]
ASSETS=ROOT/'artifacts/clickthrough-video'; ASSETS.mkdir(exist_ok=True)
OUT=ROOT/'deliverables'; OUT.mkdir(exist_ok=True)
W,H,FPS=1920,1080,60
BG,PANEL,INSET,LINE,TEXT,MUTED,PEACH='#111111','#212121','#191919','#373737','#ececec','#919191','#f69a79'
UNIT=json.loads((ROOT/'artifacts/demo-video/evidence.json').read_text(encoding='utf-8'))['tests']
CHAIN=json.loads((ROOT/'artifacts/demo-video/blockchain-results.json').read_text(encoding='utf-8'))
assert UNIT['exitCode']==0 and CHAIN['exitCode']==0 and CHAIN['failed']==0
SCENES=[
 (8,'THE SERVICE','ArtGuard brings artwork, usage licenses and shared earnings into one workspace.','home'),
 (10,'LOCAL SMART CONTRACT','Illustration: deploy the registry and escrow contract to a local EVM test network.','setup'),
 (10,'FIND THE PROJECT','The buyer searches the marketplace and opens the collaborative artwork.','catalog'),
 (14,'CHOOSE A LICENSE','Preview the project, choose Personal use and open the license checkout.','project'),
 (12,'CONNECT THE WALLET','The buyer selects the demo wallet. Connecting a wallet does not authorize a payment.','connect'),
 (14,'REVIEW & PAY','Review the terms and amount, then confirm the illustrated 0.012 test ETH payment.','payment'),
 (10,'FUNDS HELD IN ESCROW','The payment stays in escrow. No license or creator revenue is issued at deposit.','deposit'),
 (12,'CREATOR CONFIRMS DELIVERY','Switch to the creator. Confirming delivery opens the buyer’s 24-hour review period.','delivery'),
 (14,'BUYER ACCEPTS THE WORK','The buyer inspects the preview and accepts delivery. Release starts the license.','accept'),
 (10,'LICENSE READY','The license appears in the buyer’s profile, together with the document and original file.','license'),
 (12,'CREATOR’S REVENUE VIEW','The Free plan takes 10%. The remaining amount is split 75/25 between creator and co-author.','split'),
 (14,'CO-AUTHOR WITHDRAWAL','The co-author withdraws their own credit. This is a separate wallet transaction.','withdraw'),
 (14,'CHECK THE TRANSACTION RECORDS','A live purchase can be checked against EVM receipts. These example records illustrate the three separate transactions.','verify'),
 (16,'RECORDED UNIT TESTS','These are actual saved test results, shown separately from the simulated purchase flow.','tests'),
 (8,'ARTGUARD','One purchase. Clear usage rights. Transparent shared earnings.','outro'),
]
STARTS=[]; TOTAL=0
for scene in SCENES: STARTS.append(TOTAL); TOTAL+=scene[0]
assert TOTAL==178

@lru_cache(None)
def font(size,bold=False,mono=False):
 return ImageFont.truetype('C:/Windows/Fonts/'+('consola.ttf' if mono else 'segoeuib.ttf' if bold else 'segoeui.ttf'),size)
def txt(d,xy,s,size=20,color=TEXT,bold=False,mono=False):
 # Draw interface chevrons directly so Windows font coverage cannot produce tofu.
 x,y=xy;face=font(size,bold,mono)
 for part in re.split('([▾▸☰])',str(s)):
  if part in ['▾','▸','☰']:
   advance=max(size*.72,d.textlength(part,font=face));cx=x+advance/2;cy=y+size*.67;radius=size*.2
   if part=='▾':d.line([(cx-radius,cy-radius/2),(cx,cy+radius/2),(cx+radius,cy-radius/2)],fill=color,width=max(1,round(size/12)))
   elif part=='▸':d.line([(cx-radius/2,cy-radius),(cx+radius/2,cy),(cx-radius/2,cy+radius)],fill=color,width=max(1,round(size/12)))
   else:
    for row in [-1,0,1]:d.line((cx-radius,cy+row*radius,cx+radius,cy+row*radius),fill=color,width=max(1,round(size/12)))
   x+=advance
  else:d.text((x,y),part,font=face,fill=color);x+=d.textlength(part,font=face)
def wrap(d,s,x,y,width,size=22,color=TEXT,bold=False):
 line=''
 for word in str(s).split():
  candidate=(line+' '+word).strip()
  if line and d.textlength(candidate,font=font(size,bold))>width:
   txt(d,(x,y),line,size,color,bold);y+=size+10;line=word
  else:line=candidate
 if line:txt(d,(x,y),line,size,color,bold)
 return y+size+10
def card(d,box,fill=PANEL,r=20,outline=LINE): d.rounded_rectangle(box,r,fill=fill,outline=outline,width=1)
def button(d,box,label,primary=False,disabled=False,size=18):
 color='#8e604f' if disabled and primary else PEACH if primary else '#2c2c2c'
 card(d,box,color,r=(box[3]-box[1])//2,outline=color if primary else LINE)
 width=d.textlength(label,font=font(size,primary));txt(d,((box[0]+box[2]-width)/2,(box[1]+box[3]-size)/2-3),label,size,'#222222' if primary else MUTED if disabled else TEXT,primary)
def check(d,x,y,scale=1,color=PEACH):d.line([(x,y+6*scale),(x+5*scale,y+11*scale),(x+14*scale,y)],fill=color,width=max(2,round(2*scale)))
def field(d,box,label,value='',placeholder=False):
 txt(d,(box[0],box[1]-28),label,16,MUTED);card(d,box,'#2b2b2b',10);txt(d,(box[0]+16,box[1]+13),value,18,MUTED if placeholder else TEXT)
def pill(d,x,y,label,accent=False):
 width=d.textlength(label,font=font(15))+26;card(d,(x,y,x+width,y+31),'#352820' if accent else '#2b2b2b',15, '#6e4c3e' if accent else LINE);txt(d,(x+13,y+5),label,15,PEACH if accent else MUTED)
def icon(d,x,y,kind='shield',size=23,color=MUTED):
 if kind=='wallet':
  d.rounded_rectangle((x,y+3,x+size,y+size-1),4,outline=color,width=2);d.rectangle((x+size*.55,y+size*.38,x+size,y+size*.69),outline=color,width=2)
 elif kind=='check':check(d,x,y,1.4,color)
 elif kind=='search':d.ellipse((x,y,x+size*.68,y+size*.68),outline=color,width=2);d.line((x+size*.57,y+size*.57,x+size,y+size),fill=color,width=2)
 elif kind=='file':d.rounded_rectangle((x+2,y,x+size-2,y+size),3,outline=color,width=2);d.line((x+7,y+8,x+size-7,y+8),fill=color,width=2)
 else:d.line([(x+size*.5,y),(x+size,y+5),(x+size-3,y+size*.7),(x+size*.5,y+size),(x+3,y+size*.7),(x,y+5),(x+size*.5,y)],fill=color,width=2);check(d,x+size*.25,y+size*.3,.8,color)
def art(d,box,variant=0):
 x,y,r,b=box;sw,sh=r-x,b-y
 card(d,box,['#2c3038','#333238','#2c3532'][variant%3],14,'#2c3038')
 d.polygon([(x+sw*.12,y+sh*.24),(x+sw*.35,y+sh*.34),(x+sw*.35,y+sh*.86),(x+sw*.12,y+sh*.86)],fill=['#8598b4','#a996af','#87a69b'][variant%3])
 d.rectangle((x+sw*.49,y+sh*.73,x+sw*.88,y+sh*.82),fill='#d1c6b7')
 radius=min(sw*.21,sh*.35);cx,cy=x+sw*.62,y+sh*.42
 d.ellipse((cx-radius,cy-radius,cx+radius,cy+radius),fill=['#de9971','#c2ad78','#bc8b87'][variant%3])
 if sw>250 and sh>250:txt(d,(x+18,b-31),'ARTGUARD  /  PREVIEW',12,'#a2a2a2')

def shell(route='Home',role='Buyer',sidebar=False):
 im=Image.new('RGB',(W,H),BG);d=ImageDraw.Draw(im)
 txt(d,(48,20),'ANIMATED PRODUCT WALKTHROUGH',13,MUTED)
 txt(d,(1490,20),'SIMULATION · NO REAL TRANSACTIONS',13,PEACH)
 icon(d,49,80,size=28,color=PEACH);txt(d,(91,76),'artguard.',30,TEXT,True)
 card(d,(355,73,793,131),'#191919',17)
 for i,name in enumerate(['Home','Marketplace','Profile']):
  x=364+i*140
  if name==route:card(d,(x,81,x+132,123),PEACH,13,PEACH)
  txt(d,(x+18,90),name,17,'#222222' if name==route else MUTED,name==route)
 button(d,(1412,83,1516,125),'USD  ▾',size=16);icon(d,1544,94,'search',20)
 card(d,(1600,77,1858,130),'#232323',26)
 d.ellipse((1611,86,1647,122),fill=PEACH);txt(d,(1622,91),role[0],18,'#222222',True)
 txt(d,(1661,85),'Demo '+role,17,TEXT,True);txt(d,(1661,106),'Free workspace  ▾',12,MUTED)
 d.line((48,161,1872,161),fill=LINE)
 if sidebar:
  card(d,(48,196,273,874),INSET,15)
  txt(d,(70,220),'YOUR WORKSPACE',13,MUTED)
  for i,name in enumerate(['Profile','My artwork','Licenses','Orders & escrow','Earnings','Co-authors','Billing','Security','Reports','Wallet']):
   y=267+i*52
   if name==sidebar:card(d,(60,y-8,260,y+35),'#342720',9,'#82543f');active=True
   else:active=False
   icon(d,76,y, 'wallet' if name=='Wallet' else 'file' if name in ['Licenses','My artwork'] else 'shield',18,PEACH if active else MUTED)
   txt(d,(108,y-1),name,16,PEACH if active else MUTED,active)
 txt(d,(49,905),'ArtGuard Local  /  test network illustration',14,MUTED)
 txt(d,(1420,905),'Demo studio     Blockchain lab',14,MUTED)
 return im,d
def heading(d,kicker,title,x=320):txt(d,(x,197),kicker,13,MUTED);txt(d,(x,224),title,36,TEXT,True)
def project():
 im,d=shell('Marketplace');txt(d,(64,188),'← Back to marketplace',17,MUTED)
 art(d,(64,237,1082,796));card(d,(1112,237,1856,796));pill(d,1144,267,'Available for licensing',True)
 txt(d,(1144,317),'Shared Horizons',34,TEXT,True);txt(d,(1144,367),'Created by Demo Creator',18,MUTED)
 field(d,(1144,447,1824,501),'License','Personal license                                    ▾')
 wrap(d,'For private, non-commercial projects. Copyright stays with the creator.',1144,526,625,19,MUTED)
 txt(d,(1144,611),'$12.00',45,TEXT,True);txt(d,(1675,633),'Perpetual',16,MUTED)
 button(d,(1144,703,1824,759),'Get this license  →',True)
 card(d,(64,816,1856,874));txt(d,(87,831),'Description',18,TEXT,True)
 txt(d,(252,832),'Warm circular forms, muted architectural shapes and a calm, dark background.',18,MUTED)
 return im
def checkout_header(d,active=0):
 # Continue inside the purchase card instead of opening a separate popup.
 card(d,(1112,237,1856,796))
 txt(d,(1144,265),'Get a license',30,TEXT,True)
 txt(d,(1144,315),'Shared Horizons · Personal · Perpetual',18,MUTED)
 for i,title in enumerate(['Wallet','Payment','Escrow']):
  x=1144+i*225;col=PEACH if i==active else '#424242'
  d.ellipse((x,365,x+27,392),fill=col)
  txt(d,(x+9,369),i+1,13,'#222' if i==active else MUTED,True)
  txt(d,(x+39,367),title,16,TEXT if i==active else MUTED)
 d.line((1144,414,1824,414),fill=LINE)
def order_view(role,status,buttons=None):
 im,d=shell('Profile',role,'Orders & escrow');heading(d,'YOUR ORDERS','Orders & escrow')
 txt(d,(320,285),'The license starts when payment is released.',19,MUTED)
 card(d,(320,341,1856,740));pill(d,350,370,status,True);txt(d,(350,426),'Shared Horizons',28,TEXT,True)
 txt(d,(350,468),'You are the '+('seller' if role=='Creator' else 'buyer'),18,MUTED)
 txt(d,(1660,377),'$12.00',27,TEXT,True);txt(d,(1644,418),'0.012 test ETH',16,MUTED)
 if status=='Payment held in escrow':message='The seller has 72 hours to confirm delivery. The payment is held and the license has not started.'
 elif status=='Ready for your review':message='Inspect the delivered file, then accept it or open a dispute within 24 hours.'
 else:message='Your license is ready. Creator and co-author credits can be withdrawn separately.'
 wrap(d,message,350,520,1300,20,MUTED)
 if buttons:
  for box,label,primary in buttons:button(d,box,label,primary)
 d.line((350,663,1826,663),fill=LINE);txt(d,(350,686),'▸ Transaction details',17,MUTED)
 return im
def license_view():
 im,d=shell('Profile','Buyer','Licenses');heading(d,'YOUR CREATIVE TOOLKIT','Your licenses');txt(d,(320,286),'Purchased usage rights and original files, ready to use.',19,MUTED)
 card(d,(320,350,1856,671));art(d,(350,384,503,559));pill(d,531,385,'Payment verified · illustration',True)
 txt(d,(531,437),'Shared Horizons',29,TEXT,True);txt(d,(531,482),'Personal license · Demo Creator',19,MUTED);txt(d,(531,524),'Perpetual license',17,MUTED)
 button(d,(531,571,781,622),'License document');button(d,(801,571,1011,622),'Original file')
 txt(d,(1673,393),'$12.00',26,TEXT,True);txt(d,(1628,436),'0.012 test ETH',18,MUTED)
 return im
def profile_view(role):
 im,d=shell('Profile',role,'Profile');heading(d,'YOUR ACCOUNT','Demo '+role)
 txt(d,(320,286),'Your workspace, artwork and earnings in one place.',19,MUTED)
 for i,(label,value) in enumerate([('Artwork','1' if role=='Creator' else '0'),('Plan','Free'),('Wallet','Connected')]):
  x=320+i*521;card(d,(x,355,x+494,574));txt(d,(x+27,385),label,19,MUTED);txt(d,(x+27,448),value,37,TEXT,True)
 card(d,(320,608,1856,786));txt(d,(350,638),'Workspace settings',25,TEXT,True);txt(d,(350,692),'Choose a section in the sidebar to manage your account.',20,MUTED)
 return im

# Cursor keyframes: time, x, y, click. They animate clicks; no UI/API calls occur.
TRACKS=[
 [(0,1760,855,0),(5.5,1570,912,0),(6.2,1570,912,1)],
 [(0,1570,912,0),(3,1360,656,0),(3.5,1360,656,1),(8.2,576,105,0),(8.7,576,105,1)],
 [(0,576,105,0),(1.7,598,315,0),(2,598,315,1),(7,430,490,0),(8.5,430,490,1)],
 [(0,430,490,0),(2.5,1688,475,0),(3,1688,475,1),(5.6,1438,532,0),(6,1438,532,1),(12.2,1491,730,0),(13.2,1491,730,1)],
 [(0,1491,730,0),(2.2,1484,618,0),(3,1484,618,1),(6.5,1484,493,0),(7,1484,493,1)],
 [(0,1484,493,0),(5.6,1157,620,0),(6,1157,620,1),(10.7,1484,730,0),(11.2,1484,730,1)],
 [(0,1484,730,0),(6.4,1484,730,0),(7,1484,730,1)],
 [(0,1730,107,0),(1,1730,107,1),(3,1620,250,0),(3.5,1620,250,1),(7.5,501,612,0),(8.2,501,612,1)],
 [(0,1650,107,0),(1,1650,107,1),(2.8,1630,220,0),(3.3,1630,220,1),(5.2,467,612,0),(5.5,467,612,1),(8.5,1806,375,0),(8.7,1806,375,1),(10.7,772,612,0),(11.2,772,612,1)],
 [(0,772,612,0),(1.5,161,380,0),(2,161,380,1),(5.5,658,598,0),(6,658,598,1),(8.6,1815,386,0),(9,1815,386,1)],
 [(0,1660,107,0),(1,1660,107,1),(2.5,1620,250,0),(3,1620,250,1),(5.2,165,481,0),(5.7,165,481,1)],
 [(0,1660,107,0),(1,1660,107,1),(2.5,1638,291,0),(3,1638,291,1),(4,164,742,0),(4.5,164,742,1),(6,1467,662,0),(6.5,1467,662,1),(8.5,1475,716,0),(9,1475,716,1)],
 [(0,1475,716,0),(3,1618,310,0),(3.5,1618,310,1),(8,669,751,0),(8.5,669,751,1)],
 [(0,669,751,0),(3,1450,311,0),(3.5,1450,311,1)],
 [(0,1450,311,0),(5,638,105,0)],
]

@lru_cache(48)
def plate(index,state,typed=0):
 kind=SCENES[index][3]
 if kind in ['project','connect','payment','deposit']:im=project();d=ImageDraw.Draw(im)
 else:im,d=shell('Marketplace' if kind=='catalog' else 'Home' if kind in ['home','outro'] else 'Profile','Creator' if kind in ['delivery','split'] else 'Coauthor' if kind=='withdraw' else 'Administrator' if kind in ['setup','verify','tests'] else 'Buyer',False if kind in ['home','outro','catalog','setup'] else 'Earnings' if kind=='split' else 'Wallet' if kind=='withdraw' else 'Orders & escrow' if kind in ['delivery','accept'] else 'Licenses' if kind=='license' else 'Profile')
 if kind=='home':
  txt(d,(97,225),'ARTGUARD · A MARKETPLACE FOR CREATIVE WORK',15,MUTED);txt(d,(97,292),'Original work.',68,TEXT,True);txt(d,(97,380),'Clear licenses.',68,PEACH,True)
  wrap(d,'Discover digital artwork, buy usage rights and share the proceeds with your collaborators.',97,497,835,24,MUTED)
  button(d,(97,636,425,694),'Explore marketplace  →',True);button(d,(447,636,741,694),'Publish your work')
  art(d,(1110,226,1820,700));txt(d,(1110,729),'Shared Horizons',27,TEXT,True);txt(d,(1110,771),'A collaborative demo project',18,MUTED)
  txt(d,(97,805),'Registered files. Wallet-bound licenses. Shared earnings.',22,MUTED)
 elif kind=='setup':
  heading(d,'TECHNOLOGY','Local smart contract setup',64)
  txt(d,(64,291),'Illustrated deployment sequence · no command is executed by this animation',19,MUTED)
  card(d,(64,345,1035,821),INSET);txt(d,(96,373),'Example command',16,MUTED);txt(d,(96,418),'> npm run chain',26,PEACH,mono=True)
  lines=['Start the local Anvil EVM  ·  chain 31337','Compile the Solidity contracts','Deploy ArtworkRegistry','Deploy EscrowLicenseMarketplace v4','Read the deployment receipt and runtime bytecode']
  for i,line in enumerate(lines):
   if state>=1 and typed>=i:check(d,99,494+i*51,1.2);txt(d,(130,488+i*51),line,19,TEXT)
  card(d,(1065,345,1856,821));icon(d,1100,379,size=38,color=PEACH);txt(d,(1100,449),'Test network',18,MUTED);txt(d,(1100,481),'ArtGuard Local',38,TEXT,True)
  pill(d,1100,555,'Ready · illustration' if state>=2 else 'Not deployed',state>=2)
  button(d,(1100,630,1818,685),'Deployment illustrated' if state>=2 else 'Illustrate deployment',True,state>=2)
  txt(d,(1100,730),'Test ETH only · local prototype',18,MUTED)
 elif kind=='catalog':
  heading(d,'EXPLORE ORIGINAL WORK','Marketplace',64);field(d,(64,293,1394,349),'Search','Shared Horizons'[:typed] if typed else 'Search artwork, creators, or ideas…',not typed);button(d,(1420,293,1644,349),'All categories  ▾');button(d,(1666,293,1856,349),'Filters  ☰')
  names=['Shared Horizons','Quiet City','Future Forms','Still in Motion','Soft Architecture','Night Signals']
  count=1 if typed>4 else 6
  for i,name in enumerate(names[:count]):
   x=64+(i%3)*605;y=382+(i//3)*239
   card(d,(x,y,x+575,y+217));art(d,(x+12,y+12,x+232,y+205),i);txt(d,(x+255,y+31),name,24,TEXT,True);txt(d,(x+255,y+80),'Demo Creator' if i==0 else 'Sample creator',17,MUTED);txt(d,(x+255,y+130),'$12.00' if i==0 else '$24.00',25,TEXT,True);txt(d,(x+255,y+175),'View project  →',16,PEACH)
 elif kind=='project':
  if state==1:
   card(d,(1144,503,1824,674),'#2c2c2c',12)
   for i,label in enumerate(['Personal license','Commercial license','Extended license']):
    if i==0:card(d,(1152,511,1816,558),'#3d3029',8,'#3d3029')
    txt(d,(1172,520+i*50),label,18,PEACH if i==0 else TEXT)
 elif kind=='connect':
  checkout_header(d,0)
  if state==0:
   icon(d,1146,448,'wallet',36,PEACH);txt(d,(1203,446),'Connect your wallet',26,TEXT,True)
   wrap(d,'Use the buyer’s demo wallet on the local test network.',1144,513,630,20,MUTED)
   button(d,(1144,590,1824,645),'Connect demo wallet',True)
   txt(d,(1144,694),'Connecting does not authorize a payment.',17,MUTED)
  elif state==1:
   txt(d,(1144,435),'Choose a wallet',21,TEXT,True)
   card(d,(1144,477,1824,552),INSET,12);icon(d,1165,502,'wallet',25,PEACH);txt(d,(1210,497),'ArtGuard demo wallet',22,TEXT,True)
   txt(d,(1144,614),'Local test network · no extension required',17,MUTED)
  else:
   check(d,1148,456,2);txt(d,(1193,446),'Demo wallet connected',25,TEXT,True)
   txt(d,(1144,523),'Buyer wallet · chain 31337',20,MUTED);pill(d,1144,601,'Ready to review payment',True)
 elif kind=='payment':
  checkout_header(d,1)
  card(d,(1144,437,1824,518),INSET,12);txt(d,(1166,452),'Escrow protection',20,TEXT,True);txt(d,(1166,486),'Payment is held until delivery and acceptance.',17,MUTED)
  txt(d,(1144,547),'Total payment',19,MUTED);txt(d,(1599,530),'$12.00',36,TEXT,True);txt(d,(1657,581),'0.012 test ETH',17,MUTED)
  card(d,(1144,607,1169,632),PEACH if state>=1 else '#292929',4)
  if state>=1:check(d,1149,612,.9,'#222222')
  txt(d,(1182,605),'I have reviewed the quoted usage terms.',17,TEXT)
  txt(d,(1144,661),'Test ETH only · gas is additional',16,MUTED)
  button(d,(1144,703,1824,759),'Confirming payment…' if state>=2 else 'Pay 0.012 test ETH',True,state<1 or state>=2)
 elif kind=='deposit':
  checkout_header(d,2)
  if state==0:txt(d,(1144,468),'Confirming the payment…',27,TEXT,True);txt(d,(1144,523),'Illustrated local transaction',19,MUTED)
  elif state==1:
   check(d,1149,455,2);txt(d,(1198,446),'Payment held in escrow',26,TEXT,True);txt(d,(1144,516),'The license has not started yet.',20,MUTED)
   wrap(d,'The creator confirms delivery. Then the buyer reviews and accepts the work.',1144,570,630,20,MUTED)
   button(d,(1144,703,1824,759),'Open escrow orders',True)
  else:im=order_view('Buyer','Payment held in escrow');d=ImageDraw.Draw(im)
 elif kind=='delivery':
  im=order_view('Buyer' if state<2 else 'Creator','Ready for your review' if state>=3 else 'Payment held in escrow',[((350,582,665,636),'Confirm file delivery',True),((686,582,902,636),'Refund buyer',False)] if state==2 else None);d=ImageDraw.Draw(im)
  if state==1:account_menu(d,'Creator')
  if state>=3:pill(d,350,603,'Delivery confirmed · awaiting buyer review',True)
 elif kind=='accept':
  im=order_view('Creator' if state<2 else 'Buyer','Completed · license issued' if state>=5 else 'Ready for your review',[((350,582,620,636),'Inspect preview',False),((642,582,933,636),'Accept & release',True),((955,582,1157,636),'Open dispute',False)] if 2<=state<5 else None);d=ImageDraw.Draw(im)
  if state==1:account_menu(d,'Buyer')
  if state==3:
   card(d,(320,341,1856,840));art(d,(350,374,1090,796));txt(d,(1126,387),'Review the delivery',29,TEXT,True)
   wrap(d,'A watermarked preview is available before you accept the work.',1126,461,635,22,MUTED)
   wrap(d,'The original file unlocks after payment is released.',1126,559,635,20,MUTED);txt(d,(1796,355),'×',30,MUTED)
  if state>=5:pill(d,350,603,'License active · payment released',True)
 elif kind=='license':
  im=order_view('Buyer','Completed · license issued') if state==0 else license_view();d=ImageDraw.Draw(im)
  if state==2:
   card(d,(1096,350,1856,854));txt(d,(1126,377),'Personal license',28,TEXT,True);txt(d,(1803,365),'×',30,MUTED);pill(d,1126,431,'Illustrative document',True)
   rows=[('Project','Shared Horizons'),('License holder','Demo Buyer wallet'),('Period','Perpetual'),('Usage','Private, non-commercial projects'),('Territory','Kazakhstan')]
   for i,(a,b) in enumerate(rows):txt(d,(1126,494+i*48),a,16,MUTED);txt(d,(1320,490+i*48),b,18,TEXT)
   wrap(d,'Copyright remains with the creator. These are the selected usage rights.',1126,755,680,18,MUTED)
 elif kind=='split':
  heading(d,'CREATOR WORKSPACE','Earnings');txt(d,(320,287),'Shared Horizons · revenue from one illustrated license',19,MUTED)
  card(d,(320,348,1856,824));txt(d,(352,377),'License payment',20,MUTED);txt(d,(1556,368),'0.012 test ETH',32,TEXT,True)
  rows=[('Platform','10% of the payment','0.0012',.1),('Creator','75% of net proceeds','0.0081',.675),('Co-author','25% of net proceeds','0.0027',.225)]
  for i,(name,rule,value,fraction) in enumerate(rows):
   y=446+i*98;card(d,(352,y,1824,y+82),INSET,12);txt(d,(376,y+12),name,22,TEXT,True);txt(d,(376,y+46),rule,16,MUTED);card(d,(655,y+32,1457,y+45),'#272727',5,'#272727');card(d,(655,y+32,655+max(8,int(800*fraction*typed/100)),y+45),PEACH,5,PEACH);txt(d,(1562,y+22),value,29,PEACH,True);txt(d,(1676,y+33),'test ETH',16,MUTED)
  txt(d,(352,771),'Credits inside the contract · each recipient withdraws separately.',18,MUTED)
  if state<3:
   im=profile_view('Creator') if state==2 else license_view();d=ImageDraw.Draw(im)
   if state==1:account_menu(d,'Creator')
 elif kind=='withdraw':
  heading(d,'CO-AUTHOR WORKSPACE','Wallet');txt(d,(320,284),'Manage the wallet balance and available earnings.',19,MUTED)
  card(d,(320,343,1856,419));pill(d,349,365,'ArtGuard Local · connected',True);txt(d,(1517,370),'Chain 31337',17,MUTED)
  card(d,(320,441,1068,807));txt(d,(350,474),'Wallet balance',20,TEXT,True);txt(d,(350,534),'10000.00266' if state>=6 else '10000',49,TEXT,True);txt(d,(350,601),'test ETH',21,MUTED)
  txt(d,(350,688),'Illustrated network fee: 0.00004 test ETH',16,MUTED);pill(d,350,745,'Co-author wallet')
  card(d,(1096,441,1856,807));txt(d,(1126,474),'Available earnings',20,TEXT,True);txt(d,(1126,534),'0' if state>=6 else '0.0027',49,TEXT,True);txt(d,(1126,601),'test ETH · contract credit',20,MUTED);button(d,(1126,635,1826,691),'Withdrawal complete' if state>=6 else 'Confirming withdrawal…' if state==5 else 'Withdraw test earnings',True,state>=5)
  if state<3:
   im=profile_view('Coauthor') if state==2 else plate(10,3,100).copy();d=ImageDraw.Draw(im)
   if state==1:account_menu(d,'Coauthor')
  if state==4:
   card(d,(1096,441,1856,807));txt(d,(1126,473),'Review withdrawal',23,TEXT,True);txt(d,(1126,528),'0.0027 test ETH',38,TEXT,True)
   txt(d,(1126,590),'From contract to co-author wallet',20,MUTED);txt(d,(1126,630),'A separate signature authorizes this payment.',18,MUTED);button(d,(1126,686,1826,744),'Confirm withdrawal',True)
  if state>=6:pill(d,1126,729,'Withdrawal complete · wallet updated',True)
 elif kind=='verify':
  heading(d,'TECHNOLOGY · ILLUSTRATED RECORDS','Blockchain transaction records');txt(d,(320,286),'Example IDs are shown below, not live transaction hashes.',19,MUTED);button(d,(1469,284,1856,336),'Show example records',True)
  rows=[('Escrow deposit','demo-deposit-01','Payment held by the contract'),('License release','demo-release-01','Buyer accepts · license starts'),('Co-author withdrawal','demo-withdraw-01','Separate payment to the wallet')]
  if state>=1:
   for i,(name,tx,detail) in enumerate(rows):
    y=371+i*104;card(d,(320,y,1856,y+88));icon(d,347,y+26,'file',25,PEACH);txt(d,(394,y+15),name,23,TEXT,True);txt(d,(394,y+52),detail,16,MUTED);txt(d,(1519,y+31),tx,18,PEACH,mono=True)
   button(d,(320,713,1008,769),'Additional information  ▾')
  if state>=2:
   card(d,(1040,706,1856,842),INSET,13);wrap(d,'On a real purchase, ArtGuard compares the EVM receipt, contract events, sending wallet and signed order. Open Blockchain lab to verify a live test-chain transaction.',1065,725,760,18,MUTED)
 elif kind=='tests':
  heading(d,'TECHNICAL WORKSPACE','Recorded test results');txt(d,(320,285),'Actual saved command runs · 8 Nov 2026 · no tests are executed in this animation',18,MUTED);button(d,(1256,284,1856,337),'View recorded checks',True)
  if state>=1:
   rows=[('Application unit tests',UNIT['command'],str(UNIT['passed']),'24 test files'),('Smart contract / EVM tests',CHAIN['command'],str(CHAIN['passed']),'Contract and escrow scenarios')]
   for i,(name,command,passed,detail) in enumerate(rows):
    x=320+i*782;card(d,(x,370,x+754,796),INSET);txt(d,(x+30,402),name,23,TEXT,True);wrap(d,'> '+command,x+30,459,690,18,PEACH);txt(d,(x+30,543),passed,63,TEXT,True);txt(d,(x+136,578),'passed',24,MUTED);txt(d,(x+30,649),'0 failed · process exit code 0',21,TEXT);txt(d,(x+30,700),detail,18,MUTED);pill(d,x+30,743,'Recorded actual run',True)
 elif kind=='outro':
  art(d,(95,235,802,800));txt(d,(880,250),'A clear path from',48,TEXT,True);txt(d,(880,318),'artwork to a license.',48,PEACH,True)
  for i,label in enumerate(['A buyer receives usage rights','Escrow protects the payment process','Creators share the proceeds']):check(d,884,446+i*80,1.8);txt(d,(926,438+i*80),label,26,TEXT,True)
  pill(d,880,748,'Team 03 · ArtGuard · illustrated product tour',True)
 return im

def account_menu(d,role):
 card(d,(1462,144,1858,325),'#292929',15);txt(d,(1485,165),'Switch account in this tab',17,MUTED)
 for i,name in enumerate(['Buyer','Creator','Coauthor']):
  y=210+i*35
  if name==role:card(d,(1473,y-4,1847,y+29),'#403128',7,'#403128')
  txt(d,(1490,y),'Demo '+name,17,PEACH if name==role else TEXT)
def ease(p):
 p=max(0,min(1,p))
 return p*p*p*(p*(p*6-15)+10)

TYPE_TIMES=[2.18,2.32,2.41,2.58,2.72,2.89,3.04,3.19,3.35,3.43,3.61,3.74,3.91,4.08,4.24]
STATE_CUES={
 'setup':[3.5,4,4.5,5,5.5,6.5],
 'project':[3.1,6.1], 'connect':[3.1,7.1], 'payment':[6.1,11.4],
 'deposit':[2.6,7.2], 'delivery':[1.1,3.6,8.4],
 'accept':[1.1,3.4,5.6,8.8,11.4], 'license':[2.1,6.1,9.1],
 'split':[1.1,3.2,5.9], 'withdraw':[1.1,3.1,4.6,6.6,9.2,10.5],
 'verify':[3.6,8.6], 'tests':[3.7],
}
def state_for(kind,t):
 if kind=='setup':return (0 if t<3.5 else 1 if t<6.5 else 2),min(4,max(0,int((t-3.5)*2)))
 if kind=='catalog':return 0,sum(t>=stamp for stamp in TYPE_TIMES)
 if kind=='project':return (1 if 3.1<=t<6.1 else 0),0
 if kind=='connect':return (0 if t<3.1 else 1 if t<7.1 else 2),0
 if kind=='payment':return (2 if t>=11.4 else 1 if t>=6.1 else 0),0
 if kind=='deposit':return (2 if t>=7.2 else 1 if t>=2.6 else 0),0
 if kind=='delivery':return (3 if t>=8.4 else 2 if t>=3.6 else 1 if t>=1.1 else 0),0
 if kind=='accept':return (5 if t>=11.4 else 4 if t>=8.8 else 3 if t>=5.6 else 2 if t>=3.4 else 1 if t>=1.1 else 0),0
 if kind=='license':return (3 if t>=9.1 else 2 if t>=6.1 else 1 if t>=2.1 else 0),0
 if kind=='split':return (3 if t>=5.9 else 2 if t>=3.2 else 1 if t>=1.1 else 0),round(100*ease((t-5.9)/1.8))
 if kind=='withdraw':return (6 if t>=10.5 else 5 if t>=9.2 else 4 if t>=6.6 else 3 if t>=4.6 else 2 if t>=3.1 else 1 if t>=1.1 else 0),0
 if kind=='verify':return (2 if t>=8.6 else 1 if t>=3.6 else 0),0
 if kind=='tests':return (1 if t>=3.7 else 0),0
 return 0,0
# A single continuous path prevents cursor jumps between chapters.
GLOBAL_TRACK=[]
for index,events in enumerate(TRACKS):
 for event in events if index==0 else events[1:]:
  stamp,x,y,clicked=event;GLOBAL_TRACK.append((STARTS[index]+stamp,x,y,clicked))
CLICK_EVENTS=[event for event in GLOBAL_TRACK if event[3]]

def cursor_position(index,t):
 return cursor_position_global(STARTS[index]+t)

def cursor_position_global(time):
 previous=GLOBAL_TRACK[0]
 for segment,following in enumerate(GLOBAL_TRACK[1:]):
  if time<following[0]:
   dx,dy=following[1]-previous[1],following[2]-previous[2];distance=math.hypot(dx,dy)
   if distance<.01:return previous[1],previous[2]
   duration=min(following[0]-previous[0],max(.36,min(1.2,.38+distance/1700)))
   begin=following[0]-duration
   if time<=begin:return previous[1],previous[2]
   p=ease((time-begin)/max(.001,duration));q=1-p
   bend=min(28,distance*.035)*(1 if segment%2 else -1)
   nx,ny=-dy/distance,dx/distance
   c1=(previous[1]+dx*.31+nx*bend,previous[2]+dy*.31+ny*bend)
   c2=(previous[1]+dx*.72+nx*bend*.6,previous[2]+dy*.72+ny*bend*.6)
   return q**3*previous[1]+3*q*q*p*c1[0]+3*q*p*p*c2[0]+p**3*following[1],q**3*previous[2]+3*q*q*p*c1[1]+3*q*p*p*c2[1]+p**3*following[2]
  previous=following
 return previous[1],previous[2]

@lru_cache(96)
def cursor_sprite(subx=0,suby=0,press=0):
 # Antialiased standard pointer, 28px tall, with a subtle soft shadow.
 scale=4;shrink=1-.015*press;ox,oy=8+subx/4,6+suby/4
 points=[(0,0),(0,23),(5.7,17.4),(10.5,28),(14.8,26),(10,15.6),(19.5,15.6)]
 polygon=[((ox+x*shrink)*scale,(oy+y*shrink)*scale)for x,y in points]
 shadow=Image.new('RGBA',(40*scale,44*scale));sd=ImageDraw.Draw(shadow)
 sd.polygon([(x+.4*scale,y+1.1*scale)for x,y in polygon],fill=(0,0,0,75))
 shadow=shadow.filter(ImageFilter.GaussianBlur(1.05*scale));d=ImageDraw.Draw(shadow)
 d.polygon(polygon,fill='#fcfcfc',outline='#202020',width=scale)
 return shadow.resize((40,44),Image.Resampling.LANCZOS)

def cursor(im,index,t):
 time=STARTS[index]+t;x,y=cursor_position_global(time);press=0
 for stamp,cx,cy,_ in CLICK_EVENTS:
  age=time-stamp
  if 0<=age<.36:
   radius=6+10*ease(age/.36);ring=Image.new('RGBA',(48,48));d=ImageDraw.Draw(ring)
   d.ellipse((24-radius,24-radius,24+radius,24+radius),outline=(246,154,121,round(85*(1-age/.36))),width=2)
   im.paste(ring,(round(cx)-24,round(cy)-24),ring)
  if 0<=age<.16:press=round(4*math.sin(math.pi*age/.16))
 floorx,floory=math.floor(x),math.floor(y)
 sprite=cursor_sprite(round((x-floorx)*3),round((y-floory)*3),press)
 im.paste(sprite,(floorx-8,floory-6),sprite)

def content_at(index,t):
 kind=SCENES[index][3];state,typed=state_for(kind,t)
 im=plate(index,state,typed).copy()
 cue=max((stamp for stamp in STATE_CUES.get(kind,[])if stamp<=t),default=None)
 duration=.24 if kind in ['project','payment'] else .38
 if cue is not None and t<cue+duration:
  previous=state_for(kind,cue-.001)
  im=Image.blend(plate(index,*previous),im,ease((t-cue)/duration))
 if kind=='catalog' and TYPE_TIMES[4]<=t<TYPE_TIMES[4]+.28:
  box=(64,382,1856,840);before=plate(index,0,4).crop(box)
  im.paste(Image.blend(before,im.crop(box),ease((t-TYPE_TIMES[4])/.28)),box[:2])
 return im

@lru_cache(None)
def narration(index):
 scene=SCENES[index];im=Image.new('RGB',(W,135),BG);d=ImageDraw.Draw(im)
 d.line((48,0,1872,0),fill=LINE);txt(d,(48,15),f'{index+1:02} / {scene[1]}',14,PEACH,True)
 wrap(d,scene[2],48,47,1780,25,TEXT)
 return im

def frame_at(time):
 index=max(i for i,start in enumerate(STARTS)if start<=time);local=time-STARTS[index]
 im=content_at(index,local);band=narration(index)
 if index>0 and local<.48:
  progress=ease(local/.48)
  im=Image.blend(content_at(index-1,SCENES[index-1][0]-.001),im,progress)
  band=Image.blend(narration(index-1),band,progress)
 im.paste(band,(0,945));d=ImageDraw.Draw(im)
 d.rectangle((48,1069,48+1824*time/TOTAL,1072),fill=PEACH)
 cursor(im,index,local)
 return im
def srt_time(t):
 ms=round(t*1000);return f'{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}'
def metadata():
 return [{'start':start,'end':start+s[0],'chapter':s[1],'caption':s[2],'scene':s[3]}for start,s in zip(STARTS,SCENES)]
def motion_report():
 positions=[cursor_position_global(n/FPS)for n in range(TOTAL*FPS)]
 max_step=max(math.dist(a,b)for a,b in zip(positions,positions[1:]))
 boundary_jump=max(math.dist(cursor_position_global(stamp-.000001),cursor_position_global(stamp+.000001))for stamp in STARTS[1:])
 click_error=max(math.dist(cursor_position_global(stamp),(x,y))for stamp,x,y,_ in CLICK_EVENTS)
 assert max_step<75,max_step
 assert boundary_jump<.01,boundary_jump
 assert click_error<.001,click_error
 return {'revision':2,'fps':FPS,'cursorHeightPx':28,'cursorAntialiasScale':4,'path':'Curved, minimum-jerk gestures with hover pauses','maxCursorStepPx':round(max_step,4),'maxChapterBoundaryCursorJumpPx':round(boundary_jump,7),'maxClickTargetErrorPx':round(click_error,7),'chapterTransitionSeconds':.48,'stateTransitionSeconds':.38,'separateModalWindows':0,'blackFrameTransitions':False}

def main():
 args=argparse.ArgumentParser();args.add_argument('--preview',action='store_true');args.add_argument('--motion-check',action='store_true');opts=args.parse_args()
 motion=motion_report()
 if opts.motion_check:
  print(json.dumps(motion,indent=2));return
 if opts.preview:
  stamps=[4,15,25,33,47,62,74,87,99,111,121,137,149,165,174];thumbs=[]
  for stamp in stamps:
   im=frame_at(stamp);im.save(ASSETS/f'preview-{stamp:03}.jpg',quality=94);thumb=im.resize((640,360));ImageDraw.Draw(thumb).text((10,10),f'{stamp}s',font=font(16,True),fill=PEACH);thumbs.append(thumb)
  sheet=Image.new('RGB',(1920,1800),BG)
  for i,thumb in enumerate(thumbs):sheet.paste(thumb,((i%3)*640,(i//3)*360))
  sheet.save(ASSETS/'contact.jpg',quality=93);print('Animated UI previews ready.');return
 sys.path.insert(0,str(ROOT/'artifacts/video-tools'));import imageio_ffmpeg
 temporary=OUT/'Team03_FP_Demo_simulation.mp4'
 with (ASSETS/'render.log').open('w',encoding='utf-8') as log:
  proc=subprocess.Popen([imageio_ffmpeg.get_ffmpeg_exe(),'-y','-f','rawvideo','-pix_fmt','rgb24','-s',f'{W}x{H}','-r',str(FPS),'-i','-','-an','-c:v','libx264','-preset','veryfast','-crf','18','-pix_fmt','yuv420p','-movflags','+faststart',str(temporary)],stdin=subprocess.PIPE,stdout=log,stderr=log)
  for n in range(TOTAL*FPS):
   proc.stdin.write(frame_at(n/FPS).tobytes())
   if n%(FPS*15)==0:print(f'Rendered {n//FPS}/{TOTAL}s',flush=True)
  proc.stdin.close();assert proc.wait()==0
 print('Encoding complete. Ready for full video validation.',flush=True)
 (ASSETS/'timeline.json').write_text(json.dumps(metadata(),indent=2),encoding='utf-8')
 (ASSETS/'motion-validation.json').write_text(json.dumps(motion,indent=2),encoding='utf-8')
 (ASSETS/'captions.srt').write_text('\n\n'.join(f'{i+1}\n{srt_time(s)} --> {srt_time(s+item[0])}\n{item[2]}'for i,(s,item)in enumerate(zip(STARTS,SCENES)))+'\n',encoding='utf-8')

if __name__=='__main__':main()
