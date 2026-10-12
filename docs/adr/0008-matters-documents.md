# ADR 0008: Matters, documents and the client portal

Status: accepted (Phase 3)

## Context

Phase 3 adds the firm's working files: matters, tasks, documents, the client portal, B1 to B10 and
A9. Its acceptance criteria are:

- a sample IRS notice uploads, extracts the correct fields with identifiers masked, and creates a
  matter summary;
- a client sees only their own matter.

The spec fixes the main technology choices: S3 with SSE-KMS and 5-minute signed URLs; Textract
before the model; mask before send. It names no e-signature vendor.

## Decisions

1. **Matter types are product defaults in the practice modules.**
   - Each practice module (`practice/<area>/matters.ts`) defines its matter types: stages with
     stall thresholds, "waiting on client" flags, document checklists and retention years.
   - A firm can retime or rename them in a later phase. They are not firm data, so they are not
     firm config (rule 8).
2. **Visibility is enforced twice.**
   - `can()` decides with a matter scope: responsible attorney, assigned staff, and the client's
     portal users.
   - Every list query also filters rows in SQL (`modules/matters/queries.ts`), so a list never
     depends on a per-row check that could be forgotten.
   - Clients are routed to `/portal` and can never reach the staff app (`requireClient`,
     `requireSession`).
3. **Files.**
   - Each file goes to the firm's bucket under `matters/<matter id>/<document id>`. The key holds
     no names, and the object is encrypted with the firm's KMS key.
   - The type is read from the bytes. Only PDF, JPEG, PNG and TIFF are accepted, up to 25 MB.
   - Downloads go through a route that checks permission and writes an audit row
     (`documents.downloaded`), then redirects to a 5-minute signed URL.
   - Development and demos use a local directory. Production without S3 refuses uploads rather
     than storing files on a web server's disk.
4. **Text before models.**
   - OCR runs first: Textract asynchronous text detection, or a PDF's own text layer.
   - The text is masked once in the job and again in the command that stores it
     (`document_texts`).
   - Models only ever receive masked text, and the original file never leaves the bucket.
5. **B3 is parser first, model second.**
   - A deterministic parser reads the printed fields: agency, notice number, tax years, amount,
     notice date and respond-by date.
   - A model value is used only if it appears in the document text. When the two disagree, the
     parser wins and the field is flagged for the reviewer.
   - Extracted fields stay "proposed" until a person confirms or corrects them.
   - The respond-by date becomes a task marked as dated from the document, carrying the rule-7
     notice. Phase 4's deadline engine (C1) will take these over.
   - A 21-case eval runs on every build.
6. **B7 summaries must cite their sources.**
   - Each timeline entry must name a record the model was shown; any entry that does not is
     dropped.
   - Without a model, the summary and timeline are built from records.
   - Summaries are internal, so they do not go through approval. Anything addressed to the client
     does: B6 updates, A9 letters, B10 closing letters.
7. **Client portal access is a credential.**
   - B1 creates the client's account and a one-time setup link.
   - The link is shown once to the staff member who opened the matter, as staff invites are
     (ADR 0001). It is never put in an automatic message, because the outbox stores message
     text.
8. **A9 e-signature is provider-neutral.**
   - `lib/esign` defines the interface, and V1 ships a "manual" provider: the attorney prepares the
     letter in the firm's own e-signature tool, pastes the signing link, and marks the letter
     signed. The link is checked to be https.
   - A vendor provider can replace it after its API has been verified against live docs.
   - No engagement letter can be drafted until a lawyer has cleared the conflict pre-screen.
     Marking the letter signed opens the matter (B1).
9. **Fixed text where the firm speaks; models where they help.**
   - The engagement letter (firm template or a product default marked VERIFY), the B10 closing
     letter and the B8 skeletons are fixed text.
   - Models draft B6 updates (checked by the draft guard) and fill B8 drafts. Every B8 draft is
     labelled DRAFT and is never sent.

## Consequences

- Scanned notices need Textract in production; the text-layer reader only handles PDFs with
  embedded text. Before going live, VERIFY Textract's access to the KMS key, the bucket policy and
  account limits.
- Until Phase 4, deadlines read from notices are tasks, not deadline records.
- The manual e-sign step relies on staff marking the letter signed. A vendor integration would
  remove that step.
