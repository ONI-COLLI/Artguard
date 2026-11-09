"""Render the team's speech, with financial passages sourced from the same cash model."""
from pathlib import Path
from xml.sax.saxutils import escape
import json
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph, Frame, Spacer

ROOT=Path(__file__).resolve().parents[1]
model=json.loads((ROOT/'submission/financial-model.json').read_text())
base=model['scenarios']['base'];m=base['metrics'];fmt=lambda x:f'{x/1e6:.2f}'
financial={
10:'Our monthly targets remain 400 licence sales by Month 12, 1,300 by Month 24 and 2,500 by Month 36. The average licence is 30 dollars and the blended commission is 6.5%. Processing is 2.5% and planning FX is 447.94 tenge per dollar. We develop and operate the project ourselves without salaries. There are no assumed staff hires. Audit, legal review, marketing and hosting are still included.',
11:f'Platform revenue grows from {fmt(base["annual"][0]["revenue"])} million tenge in Year 1 to {fmt(base["annual"][2]["revenue"])} million in Year 3. With cash payroll at zero, operating cash flow after planning tax is minus {fmt(-base["annual"][0]["fcf"])} million, then plus {fmt(base["annual"][1]["fcf"])} and {fmt(base["annual"][2]["fcf"])} million. The first-year loss comes from launch and security costs before sales grow. Unpaid founder time is a non-cash contribution; its opportunity cost is excluded.',
12:f'At a 25% discount rate, three-year cash NPV is positive {fmt(m["npvThreeYears"])} million tenge. Monthly EBITDA first becomes positive in Month {m["firstPositiveEbitdaMonth"]}, and cumulative operating cash recovers earlier costs in Month {m["simplePaybackMonth"]}. The optional terminal-growth case gives {fmt(m["npvWithTerminal"])} million, but relies on a speculative perpetual-growth assumption. The positive cash result depends on unpaid founder work and unvalidated customer targets.',
13:f'We tested 30% fewer customers, 20% higher operating costs, and both together. Cash NPV falls to {fmt(model["scenarios"]["demand"]["metrics"]["npvThreeYears"])} million, {fmt(model["scenarios"]["costs"]["metrics"]["npvThreeYears"])} million and {fmt(model["scenarios"]["combined"]["metrics"]["npvThreeYears"])} million. Peak cash need ranges from {fmt(model["scenarios"]["demand"]["metrics"]["peakNeed"])} to {fmt(model["scenarios"]["combined"]["metrics"]["peakNeed"])} million, within the old 40-million proposal. All cases assume unpaid founders; paid staffing requires a separate scenario.',
14:f'For comparison, we retain the earlier proposal: 25 million tenge in Month 1 and 15 million in Month 10 for 26% equity. But the corrected base peak cash need is only {fmt(m["peakNeed"])} million, so that raise should be resized. The illustrative exit gives {m["investorMoic"]:.2f} times invested capital and {100*m["illustrativeInvestorIrr"]:.1f}% annual IRR. These depend on an unverified exit multiple, customer growth and unpaid work. We recommend a staged validation pilot before agreeing funding terms.',
16:f'The local prototype demonstrates registration, escrow, a wallet-bound licence and a co-author withdrawal. With unpaid founder development, the corrected three-year cash NPV is positive {fmt(m["npvThreeYears"])} million tenge and cumulative cash recovery is Month {m["simplePaybackMonth"]}. This excludes founder opportunity cost and does not prove demand. Our next steps are to validate customers and labour capacity, review security and resize the original funding proposal.',
}
speech=json.loads((ROOT/'submission/speech.json').read_text(encoding='utf-8'))
for n,f in [('TNR','times.ttf'),('TNR-B','timesbd.ttf')]:pdfmetrics.registerFont(TTFont(n,str(Path('C:/Windows/Fonts')/f)))
styles={'p':ParagraphStyle('p',fontName='TNR',fontSize=11.5,leading=15,spaceAfter=9),
 'h':ParagraphStyle('h',fontName='TNR-B',fontSize=12.5,leading=16,spaceAfter=5),
 'title':ParagraphStyle('title',fontName='TNR-B',fontSize=17,leading=21,spaceAfter=7)}
out=ROOT/'deliverables/final-project/Team03_FP_Speech.pdf';w,h=A4;margin=55
c=canvas.Canvas(str(out),pagesize=A4,pageCompression=1);c.setTitle('ArtGuard Final Project Defence Speech');c.setAuthor('Team 03')
for pageIndex,sections in enumerate(speech['pages']):
 flow=[]
 if pageIndex==0:
  flow.extend([Paragraph('ArtGuard Final Project Defence Speech',styles['title']),Paragraph('Team 3, SE-2533 · Introduction to Finance · Astana IT University<br/>About 7 minutes of speech + 3:00 video on Slide 5',styles['p']),Spacer(1,5)])
 for s in sections:
  body=financial.get(s['slide'],s.get('body',''))
  flow.extend([Paragraph(escape(s['heading']),styles['h']),Paragraph(escape(body),styles['p'])])
 frame=Frame(margin,55,w-2*margin,h-105,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)
 frame.addFromList(flow,c)
 if flow:raise RuntimeError(f'Speech page {pageIndex+1} overflow: {len(flow)} flowables')
 c.setFont('TNR',10);c.drawCentredString(w/2,30,str(pageIndex+1));c.showPage()
c.save();print(json.dumps({'speechPages':len(speech['pages']),'path':str(out)}))
