from pathlib import Path
from pypdf import PdfReader, PdfWriter
import json, hashlib, zipfile, re, xml.etree.ElementTree as ET

root=Path(__file__).resolve().parents[1]
out=root/'deliverables/final-project'
report=PdfReader(out/'Team03_FP_Report.pdf')
assert len(report.pages)==30
texts=[p.extract_text() or '' for p in report.pages]
assert texts[2].splitlines()[2].startswith('1 Introduction')
assert '6 Conclusion' in texts[16] and 'References' in texts[17]
assert all('Responsible student' in t for t in texts)
assert (out/'Team03_FP_Report.pdf').stat().st_size<5_000_000
assert len(PdfReader(out/'Team03_FP_Presentation.pdf').pages)==18
assert (out/'Team03_FP_Presentation.pdf').stat().st_size<10_000_000
forms=[]
for f in out.glob('Team03_FP_SelfEval_*.pdf'):
    reader=PdfReader(f);fields=reader.get_fields()
    assert len(reader.pages)==1 and len(fields)==4 and f.stat().st_size<1_000_000
    assert all(str(v.get('/V',''))=='' for v in fields.values())
    widgets=[a.get_object() for a in reader.pages[0]['/Annots'] if a.get_object().get('/Subtype')=='/Widget']
    assert len(widgets)==4 and all(w.get('/AP',{}).get('/N') for w in widgets)
    assert (reader.pages[0].extract_text() or '').strip().endswith('I confirm that I followed the legal and safety rules of this project (Section 2).')
    writer=PdfWriter();writer.clone_document_from_reader(reader)
    writer.update_page_form_field_values(writer.pages[0],{k:'Validation fixture' for k in fields},auto_regenerate=False)
    temporary=root/'artifacts/submission-review'/('test-'+f.name);writer.write(temporary)
    assert all(str(v.get('/V'))=='Validation fixture' for v in PdfReader(temporary).get_fields().values())
    forms.append(f.name)
validation=json.loads((root/'artifacts/submission-review/deck/latest-validation.json').read_text(encoding='utf-8'))
pptx=out/'Team03_FP_Presentation.pptx'
assert hashlib.sha256(pptx.read_bytes()).hexdigest()==validation['finalSha256']
with zipfile.ZipFile(pptx) as archive:
    assert len([n for n in archive.namelist() if re.fullmatch(r'ppt/slides/slide\d+.xml',n)])==18
    assert len([n for n in archive.namelist() if n.startswith('ppt/media/')])==2
    ns={'a':'http://schemas.openxmlformats.org/drawingml/2006/main'}
    for n,title in [(16,'Conclusion'),(17,'AI Disclosure Statement'),(18,'References')]:
        xml=ET.fromstring(archive.read(f'ppt/slides/slide{n}.xml'))
        assert xml.find('.//a:t',ns).text==title
video=out/'Team03_FP_Demo.mp4'
media=json.loads((out/'evidence/Team03_FP_Demo_validation.json').read_text(encoding='utf-8'))
assert media['durationSeconds']==180 and media['fullDecodePassed'] and not media['simulatedTransactions']
assert hashlib.sha256(video.read_bytes()).hexdigest()==media['sha256']
with zipfile.ZipFile(out/'Team03_FP_Source.zip') as archive:
    assert archive.testzip() is None
    assert not [n for n in archive.namelist() if re.search(r'(^|/)(node_modules|data|runtime|artifacts|\.git)/|\.sqlite|\.private\.',n)]
    assert '.env' not in archive.namelist() and '.env.example' in archive.namelist()
    assert archive.read('README.md').decode().startswith('Educational project for the course Introduction to Finance.')
    assert 'LICENSE' in archive.namelist() and 'THIRD_PARTY_NOTICES.md' in archive.namelist()
with zipfile.ZipFile(out/'Team03_FP_Package.zip') as archive:
    assert archive.testzip() is None
summary={
    'reportPages':len(report.pages),'mainPages':15,'presentationSlides':18,
    'embeddedPresentationImages':2,'formsValidated':len(forms),'videoSeconds':180,
    'videoHashVerified':True,'sourceAndPackageZipChecks':'passed',
    'teamReviewAndPublication':'pending',
    'files':{f.name:f.stat().st_size for f in out.iterdir() if f.is_file() and not f.name.startswith('.') and '_revised' not in f.name},
}
(root/'artifacts/submission-review/final-validation.json').write_text(json.dumps(summary,indent=2),encoding='utf-8')
print(json.dumps(summary,indent=2))
