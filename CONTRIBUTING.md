# Team contribution

This course requires each member to commit from their own GitHub account. A role
in the report is not evidence of actual contribution. Work together on review,
but do not create commits using someone else's name or account.

## Each member's workflow

1. Ask the repository owner to add your actual GitHub account as a collaborator.
   Use your verified GitHub noreply address if you prefer not to publish your email.
2. Clone the repository and create a personal branch:

   ```powershell
   git clone https://github.com/ONI-COLLI/Artguard.git
   cd Artguard
   git switch -c contribution/your-github-name
   npm ci
   ```

3. Make and verify a meaningful contribution you can explain: investigate and fix
   a bug, add a relevant test, verify a financial assumption, or improve a technical
   explanation against the code. Do not create empty commits for a count.
4. Review the diff and stage specific files. Commit with a clear description, push
   your branch and open a pull request. Another member reviews it and checks CI.
   Never force-push over another member's work.
5. Record actual pages, slides, code and review work in your self-evaluation.
   Percentages must reflect an agreed, honest account of the team work.

Run the relevant checks from README. A complete check uses `npm test`.
Tests create isolated fictional data and local EVM nodes. Real money, mainnet
wallets, personal customer data and private runtime configuration are unnecessary.

## Before committing

- Read `git diff --cached --stat` and the staged diff.
- Keep `.env`, keys/seeds, databases, uploads, runtime state and node_modules out.
- Keep licence notices and identify research sources accurately.
- Disclose AI tools and exact models actually used. An AI result does not replace
  understanding or independent review of design and calculations.
- Do not replace the real transaction video with an illustrated simulation.

The initial import is one publication action. It does not certify historical
authorship or fulfil the individual-commit requirement for the other members.
