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

The shared client, database schema, and invitation-code functions are included, but they are **not connected to a live Supabase project yet**. Until project setup is complete, Mealio continues to use this browser's IndexedDB only. These steps require a Supabase account/project and an email provider:

1. Apply `supabase/migrations/20261013090000_household_data.sql`, then `supabase/migrations/20261013120000_household_invite_codes.sql`. They create household-scoped tables and RLS, private photo storage, atomic meal/ingredient operations, and hashed one-use invite codes.
2. In Supabase Auth, configure email OTP/magic links and set the site URL plus allowed redirect URLs to your local URL and `https://tutkuayavefe.github.io/Mealio/`. Email sign-up must be enabled because invitees create their own account before entering a household code. A new account has no access to another household unless its code is redeemed.
3. Deploy `create-household-invite` and `redeem-household-invite` (`supabase functions deploy create-household-invite` and `supabase functions deploy redeem-household-invite`). Set the Edge Function secret `APP_ORIGIN` to `https://tutkuayavefe.github.io`. Supabase supplies `SUPABASE_URL`, `SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`; the service-role key belongs only in Edge Function runtime and never in this repository, browser code, or GitHub variables.
4. Set GitHub repository **Variables** `MEALIO_SUPABASE_URL` and `MEALIO_SUPABASE_PUBLISHABLE_KEY` so the Pages workflow can generate the public browser config. For local development, copy `src/cloud-config.example.js` to ignored `src/cloud-config.js` and add the project's URL and publishable/anon key.
5. A signed-in user creates a named household. In **Paylaşım ayarları**, create a named invite code and share it with the other person; codes are one-use and expire after seven days. The recipient signs in, enters the code, and joins the household meal list.
6. Use **Paylaşım ayarları → Bu cihazdaki tarifleri ortak arşive aktar** on each device that has local data. The review screen shows the destination household name/ID, exact meal names, photo count, new ingredient count, and previously transferred record IDs that will be skipped. Meal IDs are preserved, so same-named meals can both transfer and retries remain idempotent. Confirm only if that target is correct. A failed batch reports how many meals completed and can be retried; the local source is never deleted. Use the JSON backup button before transferring if desired.

The client stores only the publishable/anon key. Invite codes are random, stored as hashes, expire, and are redeemed atomically by authenticated Edge Functions. The database RLS remains the authority for meal data access.

### GitHub Pages

The current repository setting publishes the root of `codex/shared-cloud-and-pages` directly. Pushing that branch deploys the site without a merge; this also means the repository's tracked files are part of the Pages source. No local browser data is included.

`.github/workflows/pages.yml` is an alternate, more focused deployment that packages only static app files from `main`, omitting SQL and agent files. To switch to it, set **Settings → Pages → Build and deployment → Source** to **GitHub Actions** and merge the workflow to `main`. The workflow uses only the Pages deployment token and no GitHub secrets. Set repository **Variables** `MEALIO_SUPABASE_URL` and `MEALIO_SUPABASE_PUBLISHABLE_KEY` if enabling cloud storage; it writes only public browser config into the generated artifact. Never place a service-role key in Actions variables or the client.

On GitHub Pages, local IndexedDB remains private to each visitor's browser. The public repository and website do not upload or reveal those local records; shared use is available only after configuring Supabase.

The architecture and acceptance criteria are in [PROJECT-PLAN.md](PROJECT-PLAN.md). The `.github/agents/` folder contains the reusable agent team roles from the template.

## Agent action approvals

The read-only `security-guardian` reviews consequential actions; only the user can approve them. The VS Code Local pre-tool hook in `.github/hooks/` asks for approval for covered high-impact commands, external mutations, and edits to the security policy. Hooks require a trusted workspace and `chat.useHooks`; coverage depends on the selected agent harness. They are not a universal security boundary.
