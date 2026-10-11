# Runbook: matters, documents and the client portal (Phase 3)

## Storage (once per firm)

1. Create the firm's own S3 bucket with:
   - versioning on;
   - all public access blocked;
   - default encryption SSE-KMS with a key created for this firm.
2. Create an IAM user (or role) allowed only:
   - `s3:PutObject` and `s3:GetObject` on this bucket;
   - `kms:Encrypt`, `kms:Decrypt` and `kms:GenerateDataKey` on this key;
   - `textract:StartDocumentTextDetection` and `textract:GetDocumentTextDetection`.
3. Set these on the Render environment group: `S3_BUCKET`, `S3_REGION`, `KMS_KEY_ID`,
   `AWS_ACCESS_KEY_ID`, `AWS_SECRET_ACCESS_KEY`. `OCR_ENGINE` defaults to `textract` when
   `S3_BUCKET` is set.
4. **VERIFY** by uploading a scanned test notice in staging:
   - the object is encrypted with the firm's key;
   - Textract can read it;
   - the download link expires after five minutes.

Without S3, production refuses uploads. Development and demos store files in `STORAGE_DIR`
(default `./.storage`).

## Daily use

- **Retaining a client (A9).** On the lead page:
  1. Clear the conflict pre-screen.
  2. Select **Retain**: choose the matter type, enter the fee terms, and paste the signing link
     from the firm's e-signature tool.
  3. Approve the letter in Approvals to send it. Reminders go out on days 2, 4 and 7.
  4. When the client signs, select **Mark signed and open matter**. Copy the one-time portal setup
     link that appears and send it to the client yourself.
- **Matter page.** Here staff can:
  - set the stage (B6 drafts a client update for approval) and assignments;
  - upload documents, then check each document's type and confirm the B3 fields on tax notices;
  - add tasks, notes and parties (adverse and related parties are checked against new
    enquiries);
  - request a summary (B7) or a draft (B8);
  - close the matter (B10).
- **Pipeline** shows matters past their stage threshold, matters waiting on the client, unsigned
  letters and checklist completion.
- **Settings > Engagement letter** holds the firm's own letter. Until it is set, the product
  default (marked for attorney review) is used.

## Automations

| ID  | When                                                 | What                                                                                     |
| --- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| B1  | Matter opened                                        | Checklist from the matter type; client portal account; B9 questionnaire for estate plans |
| B2  | Daily                                                | Reminders on days 3, 7 and 14 for missing required documents, then a task                |
| B3  | Upload classified as a tax notice                    | Fields, summary, review task, respond-by task                                            |
| B4  | Any upload                                           | OCR, type, firm file name, checklist match, unreadable or missing-page flags             |
| B5  | Daily                                                | Task for the attorney when a matter is past its stage threshold                          |
| B6  | Stage change, or 14 days without client contact      | Client update drafted for approval                                                       |
| B7  | After notice triage, on demand, weekly (Monday 6:20) | Summary and timeline with sources                                                        |
| B8  | On request                                           | Draft in Approvals, labelled DRAFT                                                       |
| B9  | Client submits the questionnaire                     | Review task                                                                              |
| B10 | Matter closed                                        | Retention date, closing letter for approval, document return task                        |

The worker's one-minute sweep reprocesses uploads whose processing job was lost.
