# Runbook: provision a new firm

Time: about 20 minutes. Requires: Render workspace access, the firm's details, and its owner
attorney's email.

1. **Create the database.** In Render, create the Postgres instance from the Blueprint (step 3), or
   for a dry run locally, use `--local`.
2. **Run provisioning** from a clean checkout of `main`:

   ```bash
   pnpm provision-firm \
     --slug <firm-slug> --legal-name "<Legal Name PLLC>" --display-name "<Short Name>" \
     --tier solo|firm --timezone America/Chicago --practice tax,business,estate \
     --city <City> --state TX \
     --owner-name "<Owner Name>" --owner-email <owner@firm.com> \
     --app-url https://<firm-slug>.<domain> \
     --database-url "<external connection string of the empty database>"
   ```

   The script stops before changing anything if the inputs are invalid or the database already
   holds a firm. If it is interrupted, re-run the same command: secrets are reused.

3. **Create the Render services.** Import `.provision/<slug>/render.yaml` as a Blueprint. Paste the
   values from `.provision/<slug>/env` into the `lexdesk-<slug>-config` env group. **VERIFY** the
   Blueprint fields against Render's current spec on first use.
4. **Deploy** web and worker. `preDeployCommand` applies migrations (already applied, so a no-op).
   Confirm `https://<app-url>/api/health` returns `{"status":"ok"}`.
5. **Hand over.** Send the owner the one-time setup link printed by the script, by a channel other
   than the one carrying their username. It expires in 72 hours; issue a new one from
   Settings > Users if needed.
6. **Store secrets** from `.provision/<slug>/env` in the company password manager, then delete the
   local `.provision/<slug>/` directory.
7. **Record** the firm in the client register: slug, tier, Render project, provisioned date and
   commit (from `manifest.json`).

Rollback: delete the Render services and database. Nothing outside them was changed.
