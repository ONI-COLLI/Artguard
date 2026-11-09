# Final Project submission

The local package is in `deliverables/final-project`. It contains a revised PDF
report, a PDF presentation, an editable PowerPoint presentation, four individual
self-evaluation forms, the verified video and a clean source archive. The original
downloaded DOCX and PDF are preserved. The revised PDF is the submission version.

## Required human completion

1. Review and take responsibility for the revised unpaid-founder assumptions, cash NPV,
   conclusions, citations and code. Confirm actual contribution through each
   student's own work and commits. Check the current Scopus source list for the
   journals used and retain evidence. DOI metadata and publisher indexing records
   were checked; no institutional Scopus login is claimed.
2. The public source repository is https://github.com/ONI-COLLI/Artguard.
   Each member still needs to contribute from their own account; follow
   `CONTRIBUTING.md`. Do not fabricate past commit authorship. The initial
   publication does not establish contributions by all four students.
3. Upload **Team03_FP_Demo.mp4** through the university OneDrive account. Share with
   **People in Astana IT University**, **Can view**, no expiry. If unavailable, use
   **People you choose** and `ibadildin.nurkhat@astanait.edu.kz`. Keep the file and
   link until grades are final; do not move or rename after submission.
4. The GitHub URL is recorded in `submission/config.json`, README, report and
   presentation. Add the real university OneDrive URL to the same config and
   README, regenerate the PDFs and recheck layout. Do not substitute localhost
   or a fabricated URL for the missing institutional sharing link.
5. Each student completes their own one-page fillable self-evaluation. Describe
   actual pages, slides, code, percentage share, learning and AI models. The form
   ends with the exact required declaration. Blank forms are not ready to submit.
6. Check GitHub in a private window and ask a teammate to open the video from their
   own institutional account. Add the GitHub URL to the Moodle submission comment.
7. Team lead submits the report (PDF, ≤5 MB), presentation (PDF, ≤10 MB), and their
   own self-evaluation (PDF, ≤1 MB). Other members submit their own self-evaluation.
   Do not upload a DOCX or PPTX instead of the required PDFs. Meet the Moodle deadline.

## Defence timing

Use roughly seven minutes for the pitch and three minutes for the actual video.
The 18 slides finish with Conclusion, AI Disclosure Statement and References.
Every member should be ready for five minutes of questions about code and finance.
The recording already shows real local deployment, escrow deposit, delivery,
acceptance, an active licence, co-author withdrawal, chain proof and passing tests.
Use the final-project MP4, not the older simulated animations.

## Technical reproduction

```powershell
npm ci
npm run build
npm run test:unit -- --maxWorkers=2
npm run test:api
npm run test:defense:contracts
npm run test:finance-model
node --import tsx --test tests/deployment.test.ts
npm run demo:defense
```

Open `http://127.0.0.1:3600/#/defense`. The isolated launcher checks its ports and
uses a fresh data directory. If its ports are occupied, review the existing stand
or stop that particular stand deliberately; do not kill an unknown process or
reset the private/public application data. Use fictional data and local test ETH.
Do not use mainnet, real funds, real customer data or advertise a real service.

The recording belongs to saved run
`ccab5e4f-561c-473b-b35c-44019c1d437c`. Its test scope was 21 selected client tests
and 10 EVM escrow tests. Later review runs have their own logs and must not be
presented as tests executed during the recording. Canonical receipts identify
the actual local chain transactions; test ETH has no monetary value.

## Financial interpretation

Run `npm run finance:model` or save the complete JSON with
`node scripts/finance-model.mjs artifacts/submission-review/financial-model.json`.
The 447.94 KZT/USD rate is a frozen planning assumption, not a current-rate claim.
Founder and employee cash salaries are **KZT 0**, consistent with unpaid
self-development in the Endterm. Founder labour has an excluded opportunity cost.
Three-year cash NPV is about **KZT 24.97 million**, cumulative cash recovery is
**Month 19**, and base peak cash need is **KZT 7.52 million**. Year 1 FCF remains
**−KZT 5.75 million** because launch/security costs precede sufficient revenue.
The old 40m/26% proposal is retained for evaluation, not claimed as necessary:
the corrected combined downside cash need is **KZT 11.10 million**. Validate demand,
resize the raise and model any future salaries before making investment claims.

The source archive excludes keys, databases, uploads, runtime chain state,
dependencies and unrelated 3D scene files. Keep `.env` and all private runtime
configuration outside version control. See THIRD_PARTY_NOTICES.md and
docs/AI_DISCLOSURE.md.
