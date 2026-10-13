# Mealio

Mealio is a household meal library for finding dishes that use the ingredients you have at home. It only recommends meals saved in your library.

## Run locally

The app has no package dependencies. From this folder, start a local static server:

```sh
python3 -m http.server 4173
```

Then open <http://127.0.0.1:4173>. The current app stores meals and photos in that browser profile only.

## MVP features

- Save and edit meals, optional instructions, and meal photos.
- Add ingredients once and reuse them across meals.
- Search saved meals by name, ingredient text, or multiple selected ingredients.
- With blank cloud settings, store data in this browser's IndexedDB. After Supabase setup, authenticated household data and photos use the shared cloud database.

## Enable shared household storage

The shared client, database schema, and invitation function are included, but they are **not connected to a live Supabase project yet**. Until project setup is complete, Mealio continues to use this browser's IndexedDB only. These steps require a Supabase account/project and an email provider:

1. Apply `supabase/migrations/20261013090000_household_data.sql` to a new Supabase project. It creates household-scoped tables and RLS, private photo storage, and atomic meal/ingredient operations.
2. In Supabase Auth, configure the email provider and set the site URL plus allowed redirect URLs to your local URL and the eventual GitHub Pages URL. Keep public self-signup disabled; the first account should be invited by the project administrator.
3. Deploy the `supabase/functions/invite-household-member` Edge Function with the Supabase CLI (`supabase functions deploy invite-household-member`). Set `APP_ORIGIN` to the exact site origin and `APP_URL` to the complete app URL (including the GitHub Pages repository path, if applicable). Supabase provides `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` to Edge Functions; verify those platform secrets are available. The service-role key belongs only in the Edge Function runtime, never in this repository or browser code.
4. For local development, copy `src/cloud-config.example.js` to `src/cloud-config.js` and add the project's URL and publishable/anon key. The latter is public client config and safe only with the RLS migration applied. `src/cloud-config.js` is git-ignored.
5. A signed-in user creates the household and invites the second person by email. The invited person uses the emailed auth link. Do not invite an address without the account holder's consent.
6. Use **Paylaşım ayarları → Bu cihazdaki tarifleri ortak arşive aktar** on each device that has local data. The review screen shows the destination household name/ID, exact meal names, photo count, new ingredient count, and previously transferred record IDs that will be skipped. Meal IDs are preserved, so same-named meals can both transfer and retries remain idempotent. Confirm only if that target is correct. A failed batch reports how many meals completed and can be retried; the local source is never deleted. Use the JSON backup button before transferring if desired.

The client stores only the publishable/anon key. The security-sensitive invite flow runs in the Edge Function and checks the caller's authenticated household-admin membership before inviting and attaching a user. The database RLS is still the authority for data access.

### GitHub Pages

`.github/workflows/pages.yml` packages only the static app files and publishes them from `main`; the workflow does not include local browser data or the SQL/agent files. It grants only the Pages deployment token permissions and uses no GitHub secrets. If connecting Supabase, optionally set repository **Variables** `MEALIO_SUPABASE_URL` and `MEALIO_SUPABASE_PUBLISHABLE_KEY` so the workflow writes public browser config into the generated artifact. Never place a service-role key in Actions variables or the client.

Before the first Pages deployment, open repository **Settings → Pages → Build and deployment → Source** and choose **GitHub Actions**. Pushes to `main` (or manual `workflow_dispatch` from the Actions tab) trigger a deployment; pushes to feature branches do not. This configuration is ready but has not been run here. A successful deployment publishes the static app, not IndexedDB records from any device.

On GitHub Pages, local IndexedDB remains private to each visitor's browser. The public repository and website do not upload or reveal those local records; shared use is available only after configuring Supabase.

The architecture and acceptance criteria are in [PROJECT-PLAN.md](PROJECT-PLAN.md). The `.github/agents/` folder contains the reusable agent team roles from the template.

## Agent action approvals

The read-only `security-guardian` reviews consequential actions; only the user can approve them. The VS Code Local pre-tool hook in `.github/hooks/` asks for approval for covered high-impact commands, external mutations, and edits to the security policy. Hooks require a trusted workspace and `chat.useHooks`; coverage depends on the selected agent harness. They are not a universal security boundary.
