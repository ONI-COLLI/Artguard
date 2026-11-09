"""Build the course report and individual fillable self-evaluations using bundled Python.

Only the PDF is a final document. The supplied DOCX is preserved unchanged.
Figures are native vector drawings. Numerical tables read the executable model output.
"""
from pathlib import Path
import json, re, hashlib, textwrap, math
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.platypus import Paragraph, Table, TableStyle, Spacer, Frame, Flowable
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.utils import ImageReader

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'deliverables'/'final-project'; OUT.mkdir(parents=True,exist_ok=True)
WORK=ROOT/'artifacts'/'submission-review'; WORK.mkdir(parents=True,exist_ok=True)
CONFIG=json.loads((ROOT/'submission'/'config.json').read_text(encoding='utf-8'))
MODEL=json.loads((WORK/'financial-model.json').read_text(encoding='utf-8'))
A=MODEL['assumptions']; BASE=MODEL['scenarios']['base']; MET=BASE['metrics']
MEM=[m['name'] for m in CONFIG['members']]
for n,f in [('TNR','times.ttf'),('TNR-B','timesbd.ttf'),('TNR-I','timesi.ttf'),('Arial','arial.ttf'),('Arial-B','arialbd.ttf')]:
    pdfmetrics.registerFont(TTFont(n,str(Path('C:/Windows/Fonts')/f)))
W,H=A4; M=2.5*28.3464567; BW=W-2*M; BH=H-2*M
ST={
 'p':ParagraphStyle('p',fontName='TNR',fontSize=12,leading=18,spaceAfter=8),
 'h1':ParagraphStyle('h1',fontName='TNR-B',fontSize=15,leading=19,spaceAfter=10),
 'h2':ParagraphStyle('h2',fontName='TNR-B',fontSize=12,leading=18,spaceAfter=7),
 'cap':ParagraphStyle('cap',fontName='TNR',fontSize=12,leading=16,spaceAfter=4),
 'source':ParagraphStyle('source',fontName='TNR-I',fontSize=10,leading=13,spaceAfter=8),
 'cell':ParagraphStyle('cell',fontName='TNR',fontSize=12,leading=15),
 'cellb':ParagraphStyle('cellb',fontName='TNR-B',fontSize=12,leading=15),
 'small':ParagraphStyle('small',fontName='TNR',fontSize=10.5,leading=14,spaceAfter=6),
 'ref':ParagraphStyle('ref',fontName='TNR',fontSize=12,leading=18,spaceAfter=10,leftIndent=18,firstLineIndent=-18),
}
def P(t,style='p'): return Paragraph(t,ST[style])
def E(t): return escape(str(t))
def money(n,d=2): return f'{n/1_000_000:,.{d}f}'
def k(n): return f'{n/1000:,.0f}'
def caption(n,t): return P(f'Table {n}. {t}','cap')
def source(t='Own calculations from scripts/finance-model.mjs. Amounts are hypothetical.'): return P('Source: '+t,'source')
def table(headers, rows, widths=None, small=False):
    font=10 if small else 12
    style=ParagraphStyle('c'+str(font),fontName='TNR',fontSize=font,leading=font*1.25)
    bold=ParagraphStyle('b'+str(font),parent=style,fontName='TNR-B')
    data=[[Paragraph(E(x),bold if i==0 else style) for x in row] for i,row in enumerate([headers]+rows)]
    widths=[BW*w/sum(widths) for w in widths] if widths else [BW/len(headers)]*len(headers)
    t=Table(data,colWidths=widths,hAlign='LEFT',repeatRows=1)
    t.setStyle(TableStyle([('GRID',(0,0),(-1,-1),.45,colors.HexColor('#D9D9D9')),('BACKGROUND',(0,0),(-1,0),colors.HexColor('#E8E8E8')),('VALIGN',(0,0),(-1,-1),'MIDDLE'),('LEFTPADDING',(0,0),(-1,-1),5),('RIGHTPADDING',(0,0),(-1,-1),5),('TOPPADDING',(0,0),(-1,-1),4),('BOTTOMPADDING',(0,0),(-1,-1),4)]))
    return t

class Diagram(Flowable):
    def __init__(self,kind,height=180): super().__init__(); self.width=BW; self.height=height; self.kind=kind
    def draw(self):
        c=self.canv; c.setFont('TNR',10)
        if self.kind=='sequence':
            actors=['Creator','Browser / API','Buyer','Anvil contracts']; xs=[34,166,295,416]
            for x,label in zip(xs,actors):
                c.setFillColor(colors.black); c.drawCentredString(x,self.height-12,label)
                c.setStrokeColor(colors.HexColor('#999999')); c.setDash(2,3); c.line(x,5,x,self.height-22); c.setDash()
            messages=[(0,1,'Upload bytes and terms'),(0,3,'Register file and terms hashes'),(2,1,'Request signed quote'),(2,3,'Deposit exact test ETH'),(0,3,'Confirm delivery'),(2,3,'Accept and release'),(3,1,'Verify events and unlock file'),(0,3,'Withdraw recipient credit')]
            for i,(a,b,label) in enumerate(messages):
                y=self.height-37-i*24; x1,x2=xs[a],xs[b]; c.setStrokeColor(colors.black); c.line(x1,y,x2,y)
                direction=1 if x2>x1 else -1
                c.line(x2,y,x2-direction*5,y+3); c.line(x2,y,x2-direction*5,y-3)
                c.setFont('TNR',9); c.setFillColor(colors.black); c.drawCentredString((x1+x2)/2,y+5,label)
        elif self.kind=='architecture':
            boxes=[(0,95,135,55,'React and wallet','Forms and signatures'),(158,95,135,55,'Express and SQLite','Accounts and file access'),(316,95,135,55,'Anvil EVM','Hashes and settlement'),(158,7,135,48,'Private file storage','Originals and previews')]
            for x,y,w,h,title,detail in boxes:
                c.setStrokeColor(colors.HexColor('#888888')); c.setFillColor(colors.HexColor('#F4F4F4')); c.rect(x,y,w,h,fill=1)
                c.setFillColor(colors.black); c.setFont('TNR-B',11);c.drawCentredString(x+w/2,y+h-18,title);c.setFont('TNR',9);c.drawCentredString(x+w/2,y+15,detail)
            for x1,y1,x2,y2 in [(135,122,158,122),(293,122,316,122),(225,95,225,55)]:
                c.setStrokeColor(colors.black);c.line(x1,y1,x2,y2)
        elif self.kind=='cash':
            rows=BASE['rows']; series=[('Cumulative FCF','cumulativeFcf',colors.HexColor('#666666')),('Cash after financing','closingCash',colors.HexColor('#000000'))]
            values=[row[key]/1e6 for _,key,_ in series for row in rows]
            step=20; low=math.floor(min(0,*values)/step)*step; high=math.ceil(max(step,*values)/step)*step
            x0,y0=38,27; pw,ph=BW-48,self.height-48
            c.setFont('TNR',9);c.drawString(0,self.height-7,'KZT million')
            for val in range(low,high+1,step):
                y=y0+(val-low)/(high-low)*ph;c.setStrokeColor(colors.HexColor('#DDDDDD'));c.line(x0,y,x0+pw,y);c.setFillColor(colors.black);c.drawRightString(x0-5,y-3,str(val))
            for label,key,col in series:
                c.setStrokeColor(col);c.setLineWidth(1.4); p=c.beginPath()
                for i,row in enumerate(rows):
                    x=x0+i/35*pw;y=y0+(row[key]/1e6-low)/(high-low)*ph
                    if i==0:p.moveTo(x,y)
                    else:p.lineTo(x,y)
                c.drawPath(p)
            c.setFillColor(colors.black)
            for m in [1,12,24,36]: c.drawCentredString(x0+(m-1)/35*pw,12,str(m))
            c.drawRightString(BW,0,'Month');c.drawString(82,self.height-6,'Black: cash after financing   Grey: cumulative FCF')
        elif self.kind=='risk':
            ratings={'R1':(4,5),'R2':(3,4),'R3':(2,5),'R4':(3,5),'R5':(2,3),'R6':(3,4),'R7':(4,3),'R8':(4,5),'R9':(3,3),'R10':(3,5),'R11':(2,4),'R12':(3,3)}
            x0,y0=50,40;cw,ch=75,42
            c.setFont('TNR',11);c.setFillColor(colors.black);c.drawString(0,self.height-14,'Likelihood')
            for l in range(1,6):
                c.drawRightString(x0-10,y0+(l-1)*ch+16,str(l))
                for impact in range(1,6):
                    score=l*impact;tone='#F1D1C2' if score>=15 else '#E5E5E5' if score>=8 else '#F7F7F7'
                    c.setFillColor(colors.HexColor(tone));c.setStrokeColor(colors.HexColor('#BBBBBB'));c.rect(x0+(impact-1)*cw,y0+(l-1)*ch,cw,ch,fill=1)
                    ids=', '.join(k for k,v in ratings.items() if v==(l,impact))
                    c.setFillColor(colors.black);c.setFont('TNR-B',10);c.drawCentredString(x0+(impact-.5)*cw,y0+(l-1)*ch+17,ids)
            c.setFont('TNR',11)
            for impact in range(1,6):c.drawCentredString(x0+(impact-.5)*cw,y0-17,str(impact))
            c.drawString(x0+185,4,'Impact')

PAGES=[]
def page(title,owner,items,label=None): PAGES.append({'title':title,'owner':owner,'items':items,'label':label})
def h(t): return P(t,'h2')

page('1 Introduction',MEM[0],[
P('ArtGuard is an educational digital-art licensing marketplace. A creator uploads an original file, registers its SHA-256 fingerprint and offers personal, commercial or extended usage rights. The buyer deposits test ETH into escrow. Acceptance activates a wallet-bound licence and credits the platform, creator and co-authors. The project demonstrates a technical process. It has no real customers, investment commitments or monetary revenue.'),
P('The Final Project evaluates two questions separately. First, can the core licence and payment workflow be reproduced and independently checked on a local Ethereum Virtual Machine? Second, could a hypothetical Kazakhstan service cover its costs under explicit commercial assumptions? Working software answers the first question. It does not by itself establish customer demand or an attractive investment return.'),
caption('1','Changes since the Endterm and the earlier report draft'),
table(['Earlier assumption or weakness','Final Project response'],[
['Immediate settlement and a fixed 90/10 split','Escrow, delivery and review deadlines, co-author shares, and 10/5/0 plan commissions.'],
['Hardhat, PostgreSQL and a different contract described as implemented','Document the actual Anvil, SQLite and v4 escrow implementation.'],
['Coverage percentages and gas averages without matching evidence','Remove unsupported measurements and attach actual test and receipt evidence.'],
['A short payback based on incomplete costs','Retain unpaid founder work; include security, payment fees, tax and monthly sales ramp-up.'],
], [1,1.45]),source('Team comparison of the supplied Endterm summary, earlier Final draft and current repository.'),
P('Table 1 summarises the revisions. The cash forecast retains unpaid founder development, as specified in the Endterm. It includes no salaried staff or assumed future hires. It uses the product\'s blended commission, processing fees on full buyer payments, planning tax and monthly demand ramp-up. Positive cash NPV remains conditional on those demand targets and excludes the opportunity cost of founder time.'),
P('The objectives are to document and test the prototype, evaluate market, technical, operational, financial and regulatory risks, produce reproducible three-year statements, and assess a hypothetical investment proposal. Sections 2 and 3 separate implemented controls from future safeguards. Section 4 states all planning inputs and shows their consequences. No company registration, asset purchase or real-money activity forms part of the coursework.'),
])

page('2 Prototype and security',MEM[1],[h('2.1 Platform choice and consensus'),
P('The implemented prototype uses Anvil, an Ethereum-compatible local development node with chain ID 31337 (Foundry, n.d.). The operator creates blocks and controls the node. Anvil does not demonstrate a production validator network, external decentralisation or public-chain finality. Local execution is sufficient to test Solidity rules and inspect real local receipts.'),
P('Table 2 compares Polygon PoS with permissioned BFT. Polygon\'s Bor execution layer and Heimdall-v2 consensus layer coordinate block production, validation and Ethereum checkpoints (Polygon, n.d.). Consensus selection changes who must be trusted, not just transaction speed (Lashkari &amp; Musilek, 2021).'),
caption('2','Public PoS and permissioned BFT comparison'),table(['Criterion','Polygon PoS option','Permissioned BFT option'],[
['Validation','External stake-based validator system','Known approved organisations'],
['Verification','Independent access to public records','Depends on participant access and governance'],
['Cost','Variable gas plus application hosting','Node operations and governance costs'],
['Privacy','Public metadata requires minimisation','Permissioned access helps limit readership'],
['Decision','Candidate for later evaluation','Useful if known institutions share governance'],
],[.65,1.1,1.1]),source('Own comparison based on Polygon (n.d.) and Lashkari and Musilek (2021).'),
h('2.2 Actual roles and trust boundaries'),
P('A regular account can both publish and buy. Demo buyer and creator accounts are personas, not different permission classes. Managers handle financial reporting and disputes. Technical administrators handle site operations. The contract checks wallet addresses directly rather than using OpenZeppelin AccessControl roles.'),
P('The quote signer and arbiter are trusted immutable addresses in v4. A seller confirms delivery, a buyer accepts or disputes, and the arbiter resolves a disputed order. A recipient withdraws its own credit. No implemented multisig, emergency pause or signer-rotation function is claimed. Those are future controls requiring a new design, tests and audit before any commercial use.'),
])

page('2.3 Architecture and the main use case',MEM[1],[
P('Figure 1 shows the implemented architecture. Express validates requests and uses SQLite for accounts, per-tab sessions, project metadata and accounting copies. Original files stay in protected server storage. Solidity contracts store registration claims, escrow state, licence validity and withdrawable balances. The server synchronises only after verifying receipts and expected events.'),
Diagram('architecture',155),P('Figure 1. Implemented local ArtGuard architecture','cap'),source('Current React, Express, SQLite and Anvil implementation.'),
Diagram('sequence',232),P('Figure 2. Registration, escrow settlement and withdrawal sequence','cap'),source('contracts/ArtworkRegistry.sol and contracts/EscrowLicenseMarketplace.sol.'),
P('Figure 2 starts with file bytes and a normalised terms snapshot. A registration transaction records their fingerprints and the registering wallet. A changed byte normally produces a different file hash. This supports an exact comparison, not visual plagiarism detection or a legal finding of authorship. Digital rights systems still need clear off-chain governance and licensing terms (Ciriello et al., 2023).'),
])

page('2.4 Escrow rules and security evidence',MEM[1],[
P('A deposit locks funds and creates neither an active licence nor earned sales revenue. The seller has 72 hours to confirm delivery. The buyer then has 24 hours to accept or dispute. Acceptance releases payment. After review expiry, anyone can submit release for an undisputed order. A dispute blocks ordinary release. The arbiter can decide release or refund, and a refund becomes available after seven unresolved days. Time enables an action; it does not send a transaction.'),
caption('3','Relevant threats and current controls'),table(['Threat','Implemented control','Residual issue and future work'],[
['Reentrancy','Credit is cleared before transfer; nonReentrant protects withdrawals.','Independent hostile-recipient and invariant review before launch.'],
['Quote tampering or replay','EIP-712, buyer checks, expiry, instance binding and consumed quote IDs.','The trusted signer can still authorise incorrect terms.'],
['Unauthorised settlement','Seller, buyer and arbiter address checks plus state transitions.','A compromised arbiter can decide a disputed order.'],
['Key loss and operator outage','Disposable local wallets and restricted signer routes.','Multisig, recovery, monitoring and node resilience remain planned.'],
],[.8,1.3,1.25]),source('Own inspection informed by Kushwaha et al. (2022a, 2022b) and OpenZeppelin (n.d.).'),
P('Table 3 records actual controls. Ten EVM escrow tests passed in the recorded demonstration and again during this review. They cover invalid quotes, exact splits, withdrawal, delivery and dispute timeouts, manager permissions, restart persistence, legacy licence reads and reconciliation. The video separately shows 21 selected application unit tests. The complete client suite later passed 98 tests. These are distinct runs and scopes. No line-coverage percentage is claimed.'),
P('Reproduction uses npm ci, npm run build, npm run test:defense:contracts and npm run demo:defense. The isolated defence page runs on 127.0.0.1:3600. Start real demonstration deploys to its separate Anvil network. Appendix C records the saved run and successful transaction hashes. The planned USD 10,000 audit and subsequent security work are budget assumptions, not a vendor quote or a completed audit.'),
P('Public code, contracts and tests: <link href="https://github.com/ONI-COLLI/Artguard" color="#135DA8">https://github.com/ONI-COLLI/Artguard</link>.'),
])

page('3 Risk assessment',MEM[3],[h('3.1 Likelihood and impact matrix'),
P('Risk scores are team planning judgements, not measured frequencies. Likelihood and impact each range from 1 to 5, and the score is their product. A likelihood of 4 means the team considers the event plausible enough to test early. An impact of 5 means it could stop the proposed launch or require substantial new funding. Table 4 covers the required categories. The complete register includes owners, triggers and responses in Appendix D.'),
caption('4','Main risk matrix'),table(['ID and category','Risk','L','I','Score'],[
['R1 Market','Too few active buyers and paying creators','4','5','20'],
['R3 Technology','Contract defect or incorrect signed quote','2','5','10'],
['R4 Security','Compromised quote signer or arbiter','3','5','15'],
['R6 Operational','Loss of team capacity or original files','3','4','12'],
['R7 Operational','False authorship claims and delivery disputes','4','3','12'],
['R8 Financial','Funding expires before viable operations','4','5','20'],
['R10 Regulatory','A future payment model needs additional authorisation','3','5','15'],
['R11 Regulatory','Personal-data breach or unsuitable hosting','2','4','8'],
],[1.05,2,.28,.28,.48]),source('Own qualitative assessment. L = likelihood and I = impact; score = L × I.'),
P('Market and financing risks remain important because technical success cannot create demand. The founder-operated forecast has positive cash NPV, but this depends on unpaid labour and unvalidated demand. A missing original file can also break the customer experience despite a valid blockchain licence. The chain cannot reconstruct files that the operator has lost.'),
P('Security papers identify recurring vulnerability classes, but using a published checklist cannot establish that this particular deployment is safe (Kushwaha et al., 2022a). The risk register therefore retains key compromise and contract defects after the listed controls. The next funding decision should depend on pilot evidence and independent review, not on the absence of failures in ten tests.'),
])

page('3.2 Kazakhstan regulation and intellectual property',MEM[3],[
P('The legal discussion concerns a hypothetical Kazakhstan service. The current coursework uses fictional accounts and test ETH only. ArtGuard has no commercial licence, registered operating company, certified local hosting arrangement or real payment-provider integration. Consent screens and policy pages demonstrate application behaviour; they do not prove legal compliance.'),
P('Digital assets require a model-specific assessment under the Law on Digital Assets and, where relevant, the AIFC Digital Asset Activities rules. A licence record, custody of customer funds and exchange services raise different questions. A future operator would obtain advice on the precise activity and jurisdiction before accepting any real asset. An AIFC route cannot be assumed merely because the startup is in Kazakhstan (Law No. 193-VII, 2023; AIFC, n.d.).'),
P('A possible first commercial phase would use a licensed provider for tenge payments and keep only appropriate records on a public chain. That fiat path is a proposal, not implemented functionality. It would need new payment integration, chargeback handling, a revised receipt model and tests. Purchasing gas or launching on a main network is outside this educational project.'),
P('Personal-data processing would require a defined operator, lawful purposes, an appropriate consent or other applicable basis, access controls, retention rules and review of database location and transfers. The prototype keeps account details off-chain and offers consent history and privacy requests. Wallet metadata can still be linkable to a person. Off-chain storage alone does not make it anonymous (Law No. 94-V, 2013).'),
P('Copyright arises through creation, while a hash record supports an evidence trail. It does not grant rights over another person\'s work. A future operator needs clear licence scope, duration, territorial terms, co-author permissions, takedown and appeal procedures. Expiry can stop new downloads in ArtGuard but cannot erase copies already downloaded (Law No. 6-I, 1996; WIPO, n.d.).'),
P('An LLP is the hypothetical legal form retained from the team draft. Founder IP assignments, a trademark strategy and third-party licences need review before launch. The model uses a simplified 20% planning tax rate. Payroll and related employment charges are zero in the unpaid-founder base case. Future paid staff require new inputs. No preferential tax treatment, registration or authorisation is assumed already obtained.'),
])

page('3.3 Risk responses and their cost',MEM[3],[
P('Every paid mitigation must appear in the financial model. Table 5 links security and legal measures to specific months. These are explicit budgeting assumptions. Procurement has not occurred and no supplier has promised these prices. Founders provide ordinary development, moderation and incident response without cash compensation. Their finite capacity and unpaid time remain limitations.'),
caption('5','Mitigations included in the forecast'),table(['Measure','Planning cost','Timing and model line'],[
['External contract audit','USD 10,000','Month 4; security'],
['Two re-audits','USD 3,000 each','Months 16 and 28; security'],
['Bug-bounty allocation','USD 2,000 annually','Prorated monthly from Month 5; security'],
['Hardware-wallet allowance','USD 300','Month 4; security'],
['Initial legal review','USD 1,500','Month 1; administration'],
['Further legal reviews','USD 1,000 each','Months 13 and 25; administration'],
],[1.2,.85,1.4]),source(),
P('A hardware-wallet budget does not mean a multisig exists. The current v4 signer and arbiter are immutable. A compromise response therefore includes stopping new off-chain quotes, preserving evidence and assessing a replacement deployment. Existing contract rights and credits require careful migration. There is no emergency pause that can simply freeze this contract.'),
P('The market response is a staged pilot with consenting, anonymous research participants and fictional demonstration data. Adobe Stock already supplies content-licensing terms, while Pixsy focuses on finding and addressing unauthorised image use. These are competitor categories, not partners. ArtGuard\'s proposed difference is an integrated licence, escrow and co-author audit trail. Its value to customers still needs testing (Adobe, n.d.; Pixsy, n.d.).'),
P('Funding is also a control. Any later tranche should require documented pilot retention and unit economics rather than transaction counts created by demo accounts. If milestones fail, management should reduce scope or stop the hypothetical project. No paid hiring is included in this base case. Any future employee or founder compensation requires a new cash forecast and funding decision.'),
])

page('4 Detailed financial plan',MEM[2],[h('4.1 Forecast assumptions and units'),
P('The model covers 36 months, with development in Months 1–4 and sales from Month 5. Table 6 gives demand anchors; Tables A1–A3 show monthly output. Values are hypothetical KZT amounts. A frozen planning rate of 447.94 KZT per USD preserves comparison with the team draft. It is not represented as a verified current exchange rate. Live display-currency conversion on the website is separate and never changes these forecast assumptions.'),
caption('6','Demand and subscription anchors'),table(['Monthly level','Month 5','Month 12','Month 24','Month 36'],[
['Licence sales','50','400','1,300','2,500'],['Premium creators','15','150','350','600'],['Business creators','2','20','60','120'],
],[1.2,.6,.7,.7,.7]),source('Demand targets retained from the team draft; no survey or actual customer adoption is claimed.'),
P('Expected volumes interpolate linearly between anchors. Fractional monthly values are forecast averages. Average licence price is USD 30. Premium costs USD 10 and Business USD 50 per month. The assumed shares of sales value are 50% Free, 30% Premium and 20% Business. The effective commission is therefore 0.50 × 10% + 0.30 × 5% + 0.20 × 0% = 6.5%. Subscriber counts refer to creators, who can also be buyers.'),
P('Processing costs are 2.5% of gross licence payments plus subscriptions, not 2.5% of the platform\'s commission alone. Gas receives a USD 0.10 allowance per sale. Hosting is USD 100 monthly in Year 1, twice that in Year 2 and three times that in Year 3. Promotion revenue is excluded from the base forecast because uptake has not been validated. The implemented USD 5 seven-day promotion remains a possible upside, not a necessary source of forecast profit.'),
P('The founders develop and operate the project themselves without salary, consistent with the Endterm. Cash payroll is KZT 0 throughout the forecast; no community-manager or developer hire is assumed. Unpaid founder time is a non-cash contribution whose opportunity cost is excluded. Marketing remains KZT 100,000 before launch and KZT 300,000/450,000/600,000 monthly thereafter. Administration includes USD 100 tools, KZT 140,000 other monthly costs and the legal reviews in Table 5.'),
])

ann=BASE['annual']
income=[('Gross licence volume','gmv'),('Commission revenue','commissions'),('Subscription revenue','subscriptions'),('Total platform revenue','revenue'),('Processing fees','processing'),('Gas and hosting',None),('Salaries and burden','salaries'),('Marketing','marketing'),('Security','security'),('Administration','administration'),('EBITDA and EBIT','ebitda'),('Planning corporate tax','tax'),('Net income and operating FCF','fcf')]
ir=[]
for title,key in income:
    vals=[(y['gas']+y['hosting'] if key is None else y[key]) for y in ann]
    ir.append([title]+[k(v) for v in vals])
page('4.2 Income and cash flow statements',MEM[2],[
P('Table 7 separates gross marketplace volume from platform revenue; Table 8 reconciles cash. Creator and co-author proceeds are not platform income. The operating model excludes VAT from revenue and does not model VAT remittance, detailed statutory payroll rules or chargebacks. Those are limitations requiring a qualified review before any commercial use. Amounts below are KZT thousand, rounded for presentation.'),
caption('7','Three-year projected income statement'),table(['Item','Year 1','Year 2','Year 3'],ir,[2.1,.7,.7,.7]),source(),
caption('8','Projected cash flow statement in KZT thousand'),table(['Item','Year 1','Year 2','Year 3'],[
['Opening cash']+[k(y['openingCash']) for y in ann],['Operating cash flow']+[k(y['fcf']) for y in ann],['Investing cash flow','0','0','0'],['Equity financing']+[k(y['financing']) for y in ann],['Closing cash']+[k(y['closingCash']) for y in ann],
],[2.1,.7,.7,.7]),source(),
])

page('4.3 Break even and investment value',MEM[2],[
P(f'Table 9 places the first positive monthly EBITDA in Month {MET["firstPositiveEbitdaMonth"]}. This is distinct from cumulative recovery of earlier cash costs in Month {MET["simplePaybackMonth"]}. A later audit can still make an individual month negative. Annual discounted operating FCF becomes cumulatively positive by the end of Year 2. These are forecast milestones, not observed results.'),
P('The annual discount rate is 25%, within the required venture range of 20–30%, to reflect early demand uncertainty, concentrated execution risk and illiquidity. The model uses year-end discounting of annual free cash flow. Initial development outflows are already in Year 1. Equity financing is excluded from project FCF, so subtracting the KZT 40 million raise again would double count funding.'),
caption('9','Base-case investment metrics'),table(['Metric','Result'],[
['Three-year project NPV at 25%',f'KZT {money(MET["npvThreeYears"])} million'],
['Maximum cumulative cash need',f'KZT {money(MET["peakNeed"])} million in Month {MET["troughMonth"]}'],
['Simple cumulative cash recovery',f'Month {MET["simplePaybackMonth"]}; discounted annual FCF positive by end of Year 2'],
['Cash after financing in Month 36',f'KZT {money(MET["endingCash"])} million'],
['Optional terminal value, g = 5%',f'KZT {money(MET["terminalValue"])} million at end of Year 3'],
['NPV including terminal value',f'KZT {money(MET["npvWithTerminal"])} million'],
],[1.35,1.15]),source(),
Diagram('cash',140),P('Figure 3. Cumulative project FCF and financed cash balance','cap'),source(),
P('The optional terminal value assumes Year 3 FCF grows by 5% perpetually. It is a sensitivity assumption, not observed business value. The main decision uses the finite three-year cash NPV without this large extension. Figure 3 separates cumulative operating FCF from cash including financing. Positive cash NPV depends on unpaid founder work and the assumed customers; it does not establish a salary-inclusive economic return.'),
])

scens=[MODEL['scenarios'][x] for x in ['base','demand','costs','combined']]
page('4.4 Sensitivity and downside funding',MEM[2],[
P('Table 10 compares three downside scenarios. Scenario A reduces all sales and subscriber counts by 30%. Scenario B increases all forecast cash operating costs by 20%, including security and payment processing. Scenario C combines both changes. The model recalculates variable costs, tax-loss balances and monthly cash rather than simply subtracting a percentage from final profit.'),
caption('10','Sensitivity of NPV, payback and funding need'),table(['Metric','Base','A','B','C'],[
['NPV Years 1–3, KZT m']+[money(x['metrics']['npvThreeYears']) for x in scens],
['Cash need, KZT m']+[money(x['metrics']['peakNeed']) for x in scens],
['Month of maximum need']+[str(x['metrics']['troughMonth']) for x in scens],
['Extra above KZT 40m']+[money(x['metrics']['extraFunding']) for x in scens],
['First positive EBITDA month']+[str(x['metrics']['firstPositiveEbitdaMonth'] or 'Not reached') for x in scens],
['Cash recovery month']+[str(x['metrics']['simplePaybackMonth'] or 'Not reached') for x in scens],
],[1.45,.6,.6,.6,.6]),source('Own model. A: customers −30%; B: cash operating costs +20%; C: both changes.'),
P(f'The base peak cash need is KZT {money(MET["peakNeed"])} million. Lower demand requires KZT {money(scens[1]["metrics"]["peakNeed"])} million, higher costs KZT {money(scens[2]["metrics"]["peakNeed"])} million and the combined case KZT {money(scens[3]["metrics"]["peakNeed"])} million. Each is below the retained KZT 40 million proposal. Its size should therefore be reconsidered for a founder-operated pilot.'),
P('The stress cases preserve the unpaid-founder operating model. They do not test future paid staffing or founders leaving the project. Positive scenario NPV is conditional on that labour being available. Introducing cash compensation, lower retention or additional compliance costs requires explicit inputs and a new run; the forecast must not treat those resources as economically free.'),
P('A subjective risk-weighted estimate can support discussion but cannot replace evidence. The draft weights of 50% base, 25% lower demand, 15% higher costs and 10% combined now yield a positive weighted cash NPV. Those weights are judgemental, not statistical probabilities. Customer growth, unpaid founder availability and the recurring cost base must still be tested before a funding commitment.'),
P('No terminal value is credited to scenarios with negative Year 3 FCF. This convention avoids applying a perpetual-growth formula to a loss-making year and reporting an implausible asset value. It also shows why a profitable last month alone does not establish a sustainable full-year business.'),
])

upto=BASE['rows'][:MET['troughMonth']]
gross=sum(x['costs'] for x in upto); earned=sum(x['revenue'] for x in upto)
uses=[('Team salaries and burden','salaries'),('Marketing','marketing'),('Security','security'),('Administration','administration'),('Hosting','hosting'),('Gas and processing',None)]
useRows=[]
for label,key in uses:
    amount=sum((x['gas']+x['processing'] if key is None else x[key]) for x in upto)
    useRows.append([label,money(amount),f'{amount/gross:.1%}'])
page('4.5 Use of funds and runway',MEM[2],[
P(f'The earlier KZT 40 million proposal is retained for comparison: KZT 25 million in Month 1 and KZT 15 million in Month 10. Table 11 shows spending to the cash trough in Month {MET["troughMonth"]}. No payroll is paid. Shares refer to spending; customer receipts finance part of it. The proposed raise is substantially greater than the corrected pilot cash need and should be resized.'),
caption('11',f'Spending to Month {MET["troughMonth"]} in KZT million'),table(['Use','Amount','Share of spend'],useRows+[
['Gross spending',money(gross),'100%'],['Less platform revenue',money(earned),'Not a funding tranche'],['Cumulative cash need',money(MET['peakNeed']),'Net of receipts'],['Reserve within KZT 40m',money(40e6-MET['peakNeed']),'Remaining buffer'],
],[1.7,.65,1.1]),source(),
P(f'With no revenue, the full KZT 40 million covers all {MET["noRevenueRunwayCompleteMonths"]} months in this model\'s horizon; the exact later exhaustion date is not forecast. This measure assumes both tranches arrive and removes processing and gas costs because there are no sales. The base minimum financed balance is KZT {money(MET["minFinancedCash"])} million. Locked customer escrow is never company funding.'),
P('The forecast assumes both proposed tranches arrive. A smaller staged commitment should be evaluated against the corrected monthly cash needs, the first tranche timing and an explicit reserve. Retaining the old proposal does not establish that KZT 40 million is necessary. No new investment amount or equity bargain is invented in this correction.'),
P('The corrected model restores unpaid founder development from the Endterm. Earlier added salaries and assumed hires are removed; other forecast inputs remain unchanged. It still applies a 6.5% blended commission, processing on full buyer payments and planning tax. This explains the revised cash result without claiming that founder time has no economic cost.'),
])

page('5 Investment pitch',MEM[0],[h('5.1 Executive summary'),
P('ArtGuard addresses a practical licensing problem. A creator needs to document the work, the permitted use and the agreed price. A buyer needs a clear licence and confidence that payment follows delivery. Co-authors need a traceable account of their agreed shares. A conventional database can support this service, while a public blockchain could make settlement and licence records independently verifiable.'),
P('The working prototype combines a catalogue, project uploads, per-project co-author shares, expiring or perpetual licences, subscription tiers, promotion payments and escrow. Its local demonstration records a buyer deposit, seller delivery, acceptance, an active licence and a co-author withdrawal. Ten EVM escrow tests passed. These are technical milestones using fictional identities, not commercial traction.'),
P('The proposed first market is independent visual creators and small business buyers in Kazakhstan. No verified market-size estimate or customer survey is claimed. Adobe Stock demonstrates an established licensing category, Pixsy addresses infringement, and NFT research discusses a different token-market model (Adobe, n.d.; Pixsy, n.d.; Bhujel &amp; Rahulamathavan, 2022). ArtGuard must test whether its combined workflow provides enough value to justify an additional service.'),
P('Revenue would come from creator subscriptions, plan-dependent sales commissions and optional promotion. Free costs USD 0 with a 10% fee, Premium USD 10 with 5%, and Business USD 50 with 0%. The forecast assumes a 6.5% weighted fee. It excludes unvalidated promotion demand and uses an average licence price of USD 30. Payment processing, support, security and original-file storage remain material costs.'),
P(f'The retained proposal is KZT 40 million in two tranches for an illustrative 26% interest. The unpaid-founder case reaches KZT {money(ann[2]["revenue"])} million Year 3 revenue and KZT {money(MET["npvThreeYears"])} million three-year cash NPV. Cumulative cash recovery is Month {MET["simplePaybackMonth"]}. Peak cash need is only KZT {money(MET["peakNeed"])} million, so the original raise should be reconsidered rather than presented as necessary.'),
P('The recommended decision is a staged validation project, not an unconditional investment commitment. The first work should test creator retention, buyer willingness to pay, expected dispute cost and unit contribution after payment processing. Only a reviewed model that survives credible downside cases should support the next hypothetical round. No actual investment is solicited by this coursework.'),
])

page('5.2 Funding terms and team',MEM[0],[
caption('12','Illustrative investment terms and their limits'),table(['Item','Proposal or calculation'],[
['Funding','KZT 25m initially and KZT 15m in Month 10, subject to evidence-based milestones.'],
['Equity','26% after both tranches; hypothetical terms requiring a formal agreement.'],
['Implied valuation','KZT 153.85m post-money and KZT 113.85m pre-money.'],
['Exit assumption','2.5 × Month 36 annualised revenue, plus cash; an assumption, not a quoted market multiple.'],
['Illustrative outcome',f'{MET["investorMoic"]:.2f}× invested capital and {MET["illustrativeInvestorIrr"]:.1%} annual IRR using the two actual tranche dates.'],
['Decision','Positive cash case with unpaid founders; resize the raise and validate demand and labour capacity.'],
],[.8,2]),source(),
P('Table 12 separates investor IRR from project NPV. The exit multiple is unverified and no sale is committed. The illustrated return exceeds the 25% hurdle in the base case but weakens with lower demand. The KZT 40 million proposal also exceeds the corrected cash need. Funding size, ownership terms and any paid staffing require separate evaluation.'),
caption('13','Team responsibilities'),table(['Member','Role and review responsibility'],[[m['name'],m['role']+'; '+m['area']] for m in CONFIG['members']],[1,1.7]),source('Team roles confirmed by the project representative. Each student confirms their own actual contribution separately.'),
P('The technical lead must explain quote validation, state transitions and withdrawals. The finance lead must reproduce the model and defend its assumptions. The operations lead owns the risk and regulatory discussion. The team lead connects these findings to the investment decision. Responsibilities do not establish who wrote every line of code: individual GitHub commits and self-evaluations must document the actual work.'),
])

page('6 Conclusion',MEM[0],[
P('The prototype demonstrates a complete local blockchain use case. A creator registers exact file and terms fingerprints, a buyer deposits test ETH, and the contract enforces delivery and review conditions. Acceptance activates a licence and credits recipients. A separate withdrawal transfers earnings. Successful receipts, canonical blocks, events and contract state can be inspected without treating an accounting database row as proof of payment.'),
P('This technical result has clear limits. The local Anvil operator controls the network. Demo wallets use a custodial test signer. A trusted manager resolves disputes through the arbiter address. File delivery, account controls and original storage remain server responsibilities. A hash identifies bytes and a registration claim; it does not decide copyright ownership or recover a lost original. The report therefore does not claim a production-ready decentralised rights system.'),
P(f'The financial correction restores unpaid founder work and removes unapproved employee hires. Year 3 platform revenue is KZT {money(ann[2]["revenue"])} million and operating FCF KZT {money(ann[2]["fcf"])} million. Three-year cash NPV at 25% is KZT {money(MET["npvThreeYears"])} million, cumulative cash recovery is Month {MET["simplePaybackMonth"]}, and base peak cash need is KZT {money(MET["peakNeed"])} million. These results exclude the opportunity cost of founder time.'),
P('The specified downside cases now retain positive cash NPV and require less than the proposed KZT 40 million. This is conditional on unvalidated customers and continued unpaid work. A large financed cash balance does not prove that the raise is necessary. The corrected forecast supports resizing the funding proposal and separately testing future founder or employee pay.'),
P('The appropriate next step is an evidence-led pilot and a revised investment decision. Validate buyer and creator retention, inspect the contribution after payment fees and support, obtain independent security and legal reviews, and model any reduced scope or repriced funding terms. The current prototype is a suitable teaching demonstration, while the commercial case remains conditional.'),
P('The team should support a hypothetical investment only after those conditions are met. For this course, no company needs registration, real funds or a token. Each member must understand the code, calculations and limitations, disclose AI assistance and document actual contribution. Positive cash NPV under unpaid-founder assumptions is a conditional model result, not verified profitability or a guaranteed investment return.'),
])

# References are generated from verified DOI metadata and primary official sources.
refs=[]
cross=json.loads((WORK/'crossref-verified.json').read_text(encoding='utf-8'))
for row in cross:
    if row.get('error'): raise RuntimeError('Unverified DOI '+row['DOI'])
    authors=[]
    for au in row['author']:
        initials=' '.join(x[0]+'.' for x in re.split(r'[\s-]+',au.get('given','')) if x)
        authors.append(au['family']+', '+initials)
    names=', '.join(authors[:-1])+', &amp; '+authors[-1] if len(authors)>1 else authors[0]
    yr=row['published']['date-parts'][0][0]
    suffix='a' if row['DOI'].endswith('3140091') else 'b' if row['DOI'].endswith('3169902') else ''
    doi='https://doi.org/'+row['DOI']; journal=row['container-title'][0]
    vol=row.get('volume',''); issue=('('+row['issue']+')') if row.get('issue') else ''
    page_no=row.get('article-number') or row.get('page') or ''
    titles={'10.3390/s22228833':'A survey: Security, transparency, and scalability issues of NFT’s and its marketplaces','10.3390/fi16050169':'Blockchain and smart contracts for digital copyright protection','10.1109/access.2021.3065880':'A comprehensive review of blockchain consensus mechanisms','10.1109/access.2021.3140091':'Systematic review of security vulnerabilities in Ethereum blockchain smart contract','10.1109/access.2022.3169902':'Ethereum smart contract analysis tools: A systematic review','10.1007/s12525-023-00628-5':'Blockchain-based digital rights management systems: Design principles for the music industry'}
    article_title=titles.get(row['DOI'].lower(),row['title'][0])
    refs.append((re.sub('<[^>]+>','',names),f'{names} ({yr}{suffix}). {E(article_title)}. <i>{E(journal)}, {E(vol)}</i>{E(issue)}, {E(page_no)}. <link href="{doi}" color="black">{doi}</link>'))
webrefs=[
('Adobe','Adobe. (n.d.). <i>License information and terms of use</i>.','https://stock.adobe.com/license-terms'),
('AIFC','Astana International Financial Centre. (n.d.). <i>AIFC rules on digital asset activities</i>.','https://aifc.kz/legal-framework/aifc-rules-on-digital-asset-activities/'),
('Foundry','Foundry. (n.d.). <i>Anvil overview</i>.','https://getfoundry.sh/anvil/overview'),
('IEEE','IEEE. (n.d.). <i>IEEE Access bibliometrics and indexing information</i>.','https://ieeeaccess.ieee.org/about/bibliometrics/'),
('Law193','Law of the Republic of Kazakhstan No. 193-VII. (2023, February 6). <i>On digital assets in the Republic of Kazakhstan</i>. Adilet.','https://adilet.zan.kz/eng/docs/Z2300000193'),
('Law94','Law of the Republic of Kazakhstan No. 94-V. (2013, May 21). <i>On personal data and their protection</i>. Adilet.','https://adilet.zan.kz/eng/docs/Z1300000094'),
('Law6','Law of the Republic of Kazakhstan No. 6-I. (1996, June 10). <i>On copyright and related rights</i>. Adilet.','https://adilet.zan.kz/eng/docs/Z960000006_'),
('MDPI','MDPI. (n.d.). <i>Journals covered in Scopus</i>.','https://www.mdpi.com/about/journals/scopus'),
('OpenZeppelin','OpenZeppelin. (n.d.). <i>Contracts 5.x utilities</i>.','https://docs.openzeppelin.com/contracts/5.x/utils'),
('Pixsy','Pixsy. (n.d.). <i>Find and fight image theft</i>.','https://www.pixsy.com/'),
('Polygon','Polygon. (n.d.). <i>Polygon PoS architecture overview</i>.','https://docs.polygon.technology/pos/architecture/overview'),
('WIPO','World Intellectual Property Organization. (n.d.). <i>Frequently asked questions about copyright</i>.','https://www.wipo.int/en/web/copyright/faq-copyright'),
]
for key,txt,url in webrefs: refs.append((key,txt+' Retrieved November 8, 2026, from '+f'<link href="{url}" color="black">{E(url)}</link>'))
refs.sort(key=lambda x:x[0].lower())
for start in range(0,len(refs),9): page('References',MEM[0],[P(txt,'ref') for _,txt in refs[start:start+9]],label='References')

page('AI Disclosure Statement',MEM[0],[
P('We used Codex with GPT-6.1 Sol for AI assistance in this project. Every additional tool and exact model actually used must also be disclosed before submission.'),
P('AI assistance included application and smart-contract code, test code, interface explanations, demonstration tooling, English captions, report editing, reference metadata checks, financial-model code and recalculation, figures and presentation preparation. The revised model applies the team draft\'s demand and cost anchors, adds an explicit plan mix and corrects payment-fee treatment. These are substantial forms of assistance and must not be described as grammar-only editing.'),
P('This disclosure does not claim that students independently produced or already verified every AI-assisted output. Before submission, each member must review the design, assumptions, calculations and conclusions, reproduce the relevant commands, correct any remaining errors and explain any part of the code. Individual self-evaluations must describe actual work and learning in the student\'s own words.'),
P('The financial results remain educational planning estimates. DOI metadata were checked against Crossref. Publisher indexing information supports the journal selection, while the team should retain its own current Scopus source-list checks. No AI chatbot is counted as a literature source. No measured coverage percentage, vendor audit quotation, customer survey or external commercial deployment is invented.'),
P('The supplied report and this revision are different evidence sources. This revision follows the current repository and saved local recording rather than the earlier draft\'s Hardhat commands or hypothetical contract interface. The final submission checklist records the public GitHub URL and the unresolved OneDrive access, individual contributions and student review requirements.'),
],label='AI Disclosure')

for year in [1,2,3]:
    rows=[x for x in BASE['rows'] if x['year']==year]
    page('Appendix A Monthly forecast Year '+str(year),MEM[2],[
    caption(f'A{year}',f'Monthly base forecast Year {year} in KZT thousand'),
    table(['M','Sales','Revenue','Costs','FCF','Cash'],[[x['month'],f'{x["sales"]:.0f}',k(x['revenue']),k(x['costs']),k(x['fcf']),k(x['closingCash'])] for x in rows],[.35,.6,1,1,1,1],small=True),source(),
    P('Forecast averages can be fractional before rounding. No opening assets, debt or capitalised development are assumed. All pre-launch expenses enter operating FCF. Cash includes the scheduled equity tranches, while revenue does not. The full unrounded 36-month output is financial-model.json in this package.'),
    P('Reproduction: node scripts/finance-model.mjs artifacts/submission-review/financial-model.json. Validation: npm run test:finance-model. Six tests check unpaid payroll, tier weighting, processing, cash reconciliation, downside behaviour and two-tranche IRR. These verify calculation consistency, not actual demand. Founder labour is a non-cash contribution; future compensation needs a new scenario.'),
    ],label='Appendix A')

page('Appendix B Formulas and valuation',MEM[2],[
h('Project cash flows'),P('Commission = sales × average licence price × 6.5%. Subscription revenue = Premium creators × USD 10 + Business creators × USD 50, converted at the frozen planning rate. Processing = 2.5% × (gross licence payments + subscriptions). Operating FCF = revenue − cash costs − planning tax. Financing is separate.'),
h('NPV and terminal value'),P('NPV = FCF<sub>1</sub>/1.25 + FCF<sub>2</sub>/1.25<super>2</super> + FCF<sub>3</sub>/1.25<super>3</super>. No additional initial investment is subtracted because build expenses already appear in Year 1. Optional TV = max(0, Year 3 FCF) × 1.05 / (0.25 − 0.05). Terminal-value NPV adds TV/1.25<super>3</super>.'),
h('Investor calculation'),P(f'The proposed 26% interest implies post-money value 40/0.26 = KZT 153.85 million. The illustrative exit value is 2.5 × Month 36 revenue × 12 + closing cash = KZT {money(MET["exitEquityValue"])} million. The multiple is an assumption. Investor proceeds are KZT {money(MET["investorExit"])} million. IRR solves −25 −15/(1+r)<super>0.75</super> + proceeds/(1+r)<super>3</super> = 0, with all figures in KZT million.'),
P('This illustration gives the same final 26% after both tranches and assumes no later dilution, debt, dividends or transaction costs. It is not a promise of return. The specified downside cases require no capital beyond KZT 40 million under unpaid payroll; future paid staffing, a resized raise or new capital terms need a separate valuation.'),
h('Tax and timing limits'),P('The simplified model carries operating losses forward and applies the planning 20% rate only after those losses are used. It is not a tax filing or advice on eligibility. Annual NPV uses year-end aggregation; the investor calculation uses explicit tranche dates. Different timing conventions must not be mixed without explanation.'),
h('Unit contribution and volume break even'),
P('At the assumed tier mix, a licence contributes USD 30 × (6.5% − 2.5%) − USD 0.10 = USD 1.10, or KZT 492.73, before fixed costs. Premium and Business monthly contributions after processing are KZT 4,367.42 and KZT 21,837.08. Required licence sales = max(0, fixed costs − subscription contributions) / 492.73. Fixed costs exclude gas and processing. Apply the subscriber base and cost level of the same month.'),
],label='Appendix B')

RUNID='ccab5e4f-561c-473b-b35c-44019c1d437c'
receipts=json.loads((ROOT/'deliverables'/'three-minute'/'canonical-receipts.json').read_text(encoding='utf-8'))
run=json.loads((ROOT/'deliverables'/'three-minute'/'run.json').read_text(encoding='utf-8'))
page('Appendix C Actual contract interface',MEM[1],[
caption('C1','Core functions in the supplied repository'),table(['Contract or function','Access and effect'],[
['ArtworkRegistry.registerArtwork(fileHash, termsHash)','Caller registers a new nonzero fingerprint and terms hash.'],
['EscrowLicenseMarketplace.buyLicenses(quotes, signatures)','Buyer deposits the exact total; validates quotes and opens pending orders.'],
['markDelivered(id)','Seller confirms delivery within 72 hours.'],['dispute(id)','Buyer disputes during the review window.'],
['release(id)','Buyer accepts, or anyone releases after review expiry if undisputed.'],['refund(id)','Conditional refund credit under contract state and deadline rules.'],
['resolveDispute(id, refundBuyer)','Immutable arbiter resolves an open dispute.'],['withdraw(), withdrawRefund()','Caller withdraws its own proceeds or refund credit.'],['hasLicense(), licenseExpiry(), getEscrow()','Read wallet-bound rights, period and order state.'],
],[1.15,1.55],small=True),source('contracts/ArtworkRegistry.sol and contracts/EscrowLicenseMarketplace.sol.'),
P('Table C1 lists the core interface. Build compiler: solc 0.8.37 with optimiser 200 runs, viaIR and Cancun EVM target. Contract pragmas permit compatible 0.8.x versions. OpenZeppelin Contracts 5.6.1 supplies EIP712, ECDSA and ReentrancyGuard under MIT. The separate registry is a supporting contract. The escrow contract is the core purchase use case. Legacy, subscription and promotion contracts do not change that boundary.'),
P('Licence duration is 30, 90 or 365 days, or perpetual. An active licence or pending order blocks a repeat purchase of the same licence type for the same wallet and file. A timed licence starts at release and can be purchased again after expiry. It is a stored wallet-bound record, not an NFT or a transferable token.'),
P('An EIP-712 quote binds the buyer, seller, file and terms hashes, amount, fee, recipients, duration, expiry and chain instance. The contract checks the recovered signer and registered seller. It trusts the signer for the offered terms rather than judging their legal validity.'),
],label='Appendix C')

evmtests=[
'Deposit holds funds, rejects invalid quotes and checks permissions.',
'Acceptance allocates exact fees and shares, starts validity and supports withdrawal.',
'No delivery after 72 hours permits refund credit, withdrawal and repurchase.',
'Review expiry enables a transaction; API reads do not release funds.',
'A dispute blocks ordinary release and enforces manager authority.',
'Manager release and seven-day unresolved-dispute refund follow contract rules.',
'Bulk deposits settle independently and restart preserves state.',
'Legacy licence expiry and earlier credits remain readable.',
'Reconciliation distinguishes locked funds, proceeds credits and refund credits.',
'Restricted prepared-wallet signer supports the complete escrow scenario.',
]
page('Appendix C Test and transaction evidence',MEM[1],[
P(f'The video uses saved run {RUNID}. Its two test commands passed 21 selected application unit tests and 10 EVM escrow tests, with zero failures and exit code zero. Table C2 summarises the EVM cases. A later client-wide run passed 98 tests. Coverage was not measured and no percentage is supplied.'),
caption('C2','Actual EVM escrow tests'),table(['Test','Verified result'],[[str(i+1)+'. '+t,'Passed'] for i,t in enumerate(evmtests)],[3.7,.6],small=True),source('tests/escrow.test.ts; saved contracts.log and the subsequent review run.'),
P('Direct proof reads the transaction, successful receipt, canonical block, deployed bytecode, decoded events and live contract storage. It distinguishes deposit, release and withdrawal. This proves state changes in the local operator-controlled EVM, not payment on Ethereum mainnet.'),
P('Deposit: 0x34ae9d9494b596fbeca51f0a9bd436af51b6e6f6696c054f4898b402b2c3f11d','small'),
P('Release: 0x00cecaaa23803fbdd83f8501d11ac405a4657eb57fce9f52590e634b98f7991e','small'),
P('Withdrawal: 0x580fdebd429abfe00ce413e5c9e16e5d4570f8c412c0f8f711a78e8e2bf1294a','small'),
P('The package includes run.json, on-chain-proof.json and canonical-receipts.json from this run. The MP4 is exactly 180 seconds with English burned-in captions. Seven labelled reading pauses explain recorded evidence without creating new transaction or test results.'),
],label='Appendix C')

page('Appendix D Full risk register',MEM[3],[
caption('D1','Risk owner, trigger and response'),table(['ID','Owner','Trigger and planned response'],[
['R1',MEM[0],'Sales below 70% of target for two months; review acquisition and stop the next tranche until justified.'],
['R2',MEM[0],'Customers prefer existing licensing tools; test narrower value proposition.'],
['R3',MEM[1],'High-severity finding or inconsistent events; stop new quotes and assess replacement deployment.'],
['R4',MEM[1],'Signer compromise; incident review and a migration design, not fictional key rotation.'],
['R5',MEM[1],'Gas or outage exceeds budget; defer public-network plan and update the forecast.'],
['R6',MEM[3],'Key member unavailable or backup restore fails; documented handover and recovery exercise.'],
['R7',MEM[3],'Disputes exceed 2% of orders; review evidence policy and support capacity.'],
['R8',MEM[2],'Cash below six months of revised costs; reduce commitments and rerun funding scenarios.'],
['R9',MEM[2],'USD costs exceed planning FX budget; revise pricing and tools.'],
['R10',MEM[3],'Regulatory classification remains unclear; no real-asset launch before review.'],
['R11',MEM[3],'Data incident or unsuitable transfer; contain access and assess notification obligations.'],
['R12',MEM[3],'Repeated copyright complaints; takedown and appeal review, preserving necessary evidence.'],
],[.3,1.1,2.4],small=True),source('Own planning assessment. Triggers are proposed management thresholds, not observed incidents.'),
P('Likelihood and impact are qualitative estimates. Periodic review should update both after pilot research, restore exercises and independent security analysis. Planned controls must not be described as implemented features or guaranteed protections.'),
],label='Appendix D')

page('Appendix D Risk likelihood and impact map',MEM[3],[
P('Figure 4 places all twelve risks on the same 1–5 likelihood and impact scale. The position gives both ratings, and the risk score equals their product. This map supplements the response register in Table D1 and the main risks in Table 4.'),
Diagram('risk',285),P('Figure 4. Likelihood and impact map for all twelve risks','cap'),source('Own qualitative assessment. Darker cells indicate higher likelihood × impact scores.'),
P('The full ratings are R1 4/5, R2 3/4, R3 2/5, R4 3/5, R5 2/3, R6 3/4, R7 4/3, R8 4/5, R9 3/3, R10 3/5, R11 2/4 and R12 3/3. The order in each pair is likelihood/impact. These values are scenario-planning judgements and should be updated after new evidence.'),
P('The high-priority financial and market cells correspond to the downside funding results, not just to software defects. A successful demonstration cannot reduce a demand rating without customer evidence. Similarly, a budgeted hardware wallet does not reduce key risk until a reviewed custody and recovery design is implemented.'),
],label='Appendix D')

page('Appendix E Literature and source verification',MEM[0],[
P('Table E1 maps six 2021–2024 journal articles to this report. DOI titles, authors, years and publication details were checked against Crossref on 8 November 2026. Three papers are in IEEE Access, one in Sensors, one in Future Internet and one in Electronic Markets. At least the first five form the required post-2020 academic set.'),
caption('E1','Academic sources and their specific use'),table(['Paper','Use in this report'],[
['Lashkari and Musilek (2021)','Consensus and validator trust comparison.'],['Kushwaha et al. (2022a)','Threat classes and residual contract risk.'],['Kushwaha et al. (2022b)','Why analysis tools and tests do not replace independent review.'],['Bhujel and Rahulamathavan (2022)','Difference between an NFT market and a licensing service.'],['Frattolillo (2024)','Smart contracts and watermarking as complementary rights-management techniques.'],['Ciriello et al. (2023)','Governance and design issues in digital rights systems.'],
],[1,1.5]),source('Verified DOI metadata and the cited publications.'),
P('IEEE lists Scopus among its indexing providers (IEEE, n.d.). MDPI lists Sensors and Future Internet among Scopus-covered journals (MDPI, n.d.). These publisher records support selection; the team should retain a current Scopus source-list check by journal and ISSN before submission. This report does not claim that the reviewer logged into an institutional Scopus account.'),
P('Frattolillo (2024) studies smart-contract-supported watermarking. ArtGuard uses protected previews and exact-byte hashes, and does not claim to implement the paper\'s complete watermarking protocol. This distinction matters because a paper about a protection technique is not evidence that this prototype provides the same security guarantees.'),
P('Market growth, customer counts, audit budgets, processing rates and the exit multiple remain declared assumptions. No anonymous blog, invented survey, AI chatbot or unsupported market statistic is used as a factual substitute. Retrieved dates describe this review, not evidence of a future production certification.'),
],label='Appendix E')

page('Appendix F Team and reproducibility',MEM[0],[
P('All four members are Software Engineering students in group SE-2533. The project representative confirmed the names and roles in Table 13. The descriptions below identify responsibilities rather than inventing employment experience or qualifications.'),
*[P(f'<b>{E(m["name"])}.</b> {E(m["role"])}. Review responsibility: {E(m["area"])}. The member must document actual pages, slides, code changes and learning in their own self-evaluation.') for m in CONFIG['members']],
P('The source package contains the application, Solidity contracts, tests, build scripts and this report builder. It excludes accounts, uploads, SQLite databases, runtime keys, .env files and local chain state. OpenZeppelin attribution and licence notices are retained. Each member must contribute through their own GitHub account; no historical authorship or commit history is fabricated.'),
P('The public source repository is https://github.com/ONI-COLLI/Artguard. The university OneDrive sharing URL remains pending and must appear on the report title, presentation title and README. The video must use the university account, Can view permissions and the specified audience. Access should be checked by a teammate from their own institutional account before submission.'),
P('The team lead submits the report and presentation as PDFs within the 5 MB and 10 MB limits. Each student submits a separate PDF self-evaluation of at most one page and 1 MB. The supplied self-evaluation forms require personal completion; they are not declarations already made by the students.'),
],label='Appendix F')

def draw_page(c, number, title, owner, items):
    c.setFillColor(colors.black);c.setFont('TNR',8.5)
    c.drawString(M,H-M+24,'Team 03  ArtGuard  Responsible student: '+owner)
    c.drawRightString(W-M,M-24,str(number))
    story=[P(title,'h1')]+items
    frame=Frame(M,M,BW,BH,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0,showBoundary=0)
    frame.addFromList(story,c)
    if story: raise RuntimeError(f'Page {number} {title} overflows by {len(story)} blocks. First remaining: '+str(getattr(story[0],'text',story[0]))[:100])
    c.showPage()

def build_report():
    target=OUT/'Team03_FP_Report.pdf'; c=canvas.Canvas(str(target),pagesize=A4,pageCompression=1)
    c.setTitle('ArtGuard Final Project Risk Assessment Prototype and Investment Pitch');c.setAuthor('Team 03')
    # The university logo and name appear only on the title page.
    c.setFillColor(colors.HexColor('#17212B'));c.rect(W/2-92,H-148,184,74,fill=1,stroke=0)
    logo=WORK/'aitu-logo-white.png';c.drawImage(ImageReader(str(logo)),W/2-78,H-136,width=156,height=52,preserveAspectRatio=True,anchor='c',mask='auto')
    title=[P('Astana IT University','h1'),P('ArtGuard','h1'),P('Risk Assessment Prototype and Investment Pitch for a Blockchain Startup','h1'),P('Introduction to Finance<br/>Final Project<br/>Team 03','p'),P('<br/>'.join(E(m['name']+', '+m['group']) for m in CONFIG['members'])),P('Supervisor: Nurkhat Ibadildin, Associate Professor'),P(CONFIG['date']),P('GitHub repository: '+E(CONFIG.get('githubUrl') or 'publication pending')),P('University OneDrive video: '+E(CONFIG.get('oneDriveUrl') or 'upload and institutional sharing pending')),P('Network: local Anvil, chain ID 31337. No public testnet address.'),P('Educational simulation. Fictional clients, planning figures and test assets only. No real investment or financial advice.')]
    frame=Frame(M,M,BW,H-2*M-110,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0);frame.addFromList(title,c)
    if title: raise RuntimeError('Cover overflow')
    c.setFillColor(colors.black);c.setFont('TNR',8.5);c.drawString(M,M-24,'Responsible student: '+MEM[0])
    c.showPage()
    toc=[P('Contents','h1')]
    ai_page=next(i for i,p in enumerate(PAGES,1) if p['title']=='AI Disclosure Statement')
    sections=[('1 Introduction',1),('2 Prototype and security',2),('3 Risk assessment',5),('4 Detailed financial plan',8),('5 Investment pitch',13),('6 Conclusion',15),('References',16),('AI Disclosure Statement',ai_page),('Appendices A to F',ai_page+1)]
    for label,num in sections: toc.append(P(E(label)+f' ................................ {num}'))
    toc.extend([Spacer(1,18),P('Main text consists of exactly 15 pages from Introduction through Conclusion. References and appendices are outside this count. Body text is Times New Roman 12 pt with 1.5 line spacing and 2.5 cm page margins.'),P('All financial forecasts are educational assumptions. The website\'s live display currencies, custodial test-wallet balances and demo transaction totals are separate from the commercial financial model.'),P('Release status: the public GitHub URL is recorded. University OneDrive sharing, individual contributions and student review remain required before submission. No working institutional URL is invented.')])
    frame=Frame(M,M,BW,BH,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0);frame.addFromList(toc,c)
    if toc: raise RuntimeError('TOC overflow')
    c.setFillColor(colors.black);c.setFont('TNR',8.5);c.drawString(M,H-M+24,'Team 03  ArtGuard  Responsible student: '+MEM[0])
    c.showPage()
    for i,pg in enumerate(PAGES,1): draw_page(c,i,pg['title'],pg['owner'],pg['items'])
    c.save();return target

def build_forms():
    paths=[]
    for m in CONFIG['members']:
        first,last=m['name'].split(' ',1);path=OUT/f'Team03_FP_SelfEval_{last}_{first}.pdf'
        c=canvas.Canvas(str(path),pagesize=A4);c.setTitle('Team 03 Individual Self Evaluation '+m['name']);c.setAuthor(m['name'])
        c.setFont('TNR-B',15);c.drawString(M,H-M,'Individual Self Evaluation');c.setFont('TNR',12)
        c.drawString(M,H-M-26,m['name']+'  '+m['group']+'  Team 03')
        y=H-M-58
        fields=[('work','Pages slides and code I actually completed',95),('share','My share of the team work in percent',25),('learned','What I learned and can explain independently',95),('ai','AI tools exact models and what I used them for',80)]
        for name,label,height in fields:
            c.setFont('TNR',12);c.drawString(M,y,label);y-=height+9
            c.acroForm.textfield(name=name,tooltip=label,x=M,y=y,width=BW,height=height,borderWidth=.5,borderColor=colors.grey,fillColor=colors.white,textColor=colors.black,fontName='Times-Roman',fontSize=11,fieldFlags='multiline' if height>25 else '')
            y-=24
        c.setFont('TNR',10);c.drawString(M,y-8,'Complete the fields personally and review the declaration before submission.')
        text='I confirm that I followed the legal and safety rules of this project (Section 2).'
        p=P(text);p.wrap(BW,55);p.drawOn(c,M,y-60)
        c.showPage();c.save();paths.append(path)
    return paths

def build_deck_pdf():
    images=sorted((WORK/'deck').glob('slide-*.png'))
    if len(images)!=18: raise RuntimeError('Expected all 18 reviewed native slide renders')
    target=OUT/'Team03_FP_Presentation.pdf'
    c=canvas.Canvas(str(target),pagesize=(960,540),pageCompression=1)
    c.setTitle('ArtGuard Final Project Presentation');c.setAuthor('Team 03')
    for image in images:
        c.drawImage(ImageReader(str(image)),0,0,width=960,height=540)
        c.showPage()
    c.save()
    return target

if __name__=='__main__':
    path=build_report();forms=build_forms()
    if (WORK/'deck'/'slide-18.png').exists(): build_deck_pdf()
    result={'report':str(path),'mainPages':15,'numberedPages':len(PAGES),'totalPdfPages':len(PAGES)+2,'forms':[str(x) for x in forms],'publicationPending':not(CONFIG.get('githubUrl') and CONFIG.get('oneDriveUrl'))}
    (WORK/'build-result.json').write_text(json.dumps(result,indent=2),encoding='utf-8');print(json.dumps(result,indent=2))
