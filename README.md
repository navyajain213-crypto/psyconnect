# PsyConnect

A private space to check in with your feelings, journal, and find support. Static site (no build tools, no npm dependencies) plus Supabase for sign-in and saved data. Deploys to Vercel.

```
public/            the site Vercel serves
  index.html       app shell
  css/             styles.css (design), auth.css (sign-in screens)
  js/app.js        the app (feelings wheel, journal, rewards, articles, support directory)
  js/auth.js       Supabase sign-in/sign-up/reset over plain fetch
  js/store.js      loads and saves each user's data
  js/boot.js       sign in -> load -> start; account dialog
  js/config.js     generated at build time from env vars
  privacy.html, terms.html
scripts/build.mjs  writes config.js from env vars, refuses unsafe keys
scripts/dev.mjs    local server (applies the same security headers as production)
supabase/schema.sql  database table, row-level security, delete-account function
tests/             mock Supabase + end-to-end browser tests
vercel.json        build settings and security headers
```

## 1. Set up Supabase (10 minutes)

1. Create a project at supabase.com.
2. Open **SQL Editor**, paste `supabase/schema.sql`, run it.
3. **Project Settings > API**: copy the **Project URL** and the **anon / publishable** key. Never use the `service_role` or `sb_secret_` key; the build refuses them.
4. **Authentication > URL Configuration**: set **Site URL** to your Vercel URL (for example `https://psyconnect.vercel.app`) and add it to **Redirect URLs**. Add `http://localhost:3000` too if you test locally. Confirmation and password-reset emails send people back to this address.
5. **Authentication > Providers > Email**: keep **Confirm email** on.
6. **Authentication > SMTP Settings**: add a real email sender (Resend, Postmark, SES). Supabase's built-in sender is limited to a few emails an hour and is not meant for production, so sign-ups will stall without this.

## 2. Deploy to Vercel (5 minutes)

1. Push this folder to a GitHub repository.
2. In Vercel: **Add New > Project**, import the repo. Leave the framework as "Other"; `vercel.json` sets the build command and output folder.
3. **Settings > Environment Variables**, add for Production and Preview:
   - `SUPABASE_URL` = your Project URL
   - `SUPABASE_ANON_KEY` = your anon / publishable key
4. Deploy. A production build **fails on purpose** if those two variables are missing, so you can never ship demo mode by accident.
5. Open the site, create an account, confirm the email, write a journal entry, reload. Your data should still be there.

If you use a custom Supabase domain instead of `*.supabase.co`, add its origin to `connect-src` in `vercel.json`.

## Run locally

```
node scripts/dev.mjs            # http://localhost:3000, demo mode (data stays in the browser)

SUPABASE_URL=https://xxxx.supabase.co SUPABASE_ANON_KEY=... node scripts/dev.mjs
```

## Tests

```
npm i --no-save playwright && npx playwright install chromium
node tests/e2e.mjs
```

49 checks cover: every screen with empty data, sign-up, sign-in, wrong passwords, consent, session restore, sign-out, account isolation, saving and reloading, streak reset after a missed day, safe handling of a failed load (nothing is overwritten), delete account, email-confirmation flow, escaped journal text, and the security headers. The tests run against `tests/mock-supabase.mjs`, not a real Supabase project, so do the manual check in step 2.5 on your real deployment.

## Before real users sign up

- **Fill in `privacy.html` and `terms.html`** (`[ADD ...]` placeholders: date and contact email) and have a lawyer review them. The build warns until you do. If you will have users in India, check the Digital Personal Data Protection Act, 2023 obligations for sensitive personal data.
- **Replace the sample professionals.** The six profiles, the "verified" badges and the booking flow are demo content. Real listings need real, verified people and a way for them to receive and answer requests. Until then the app labels them as samples, and you should not present them as real.
- **Paid packs are off.** The shop only unlocks free packs; there is no payment integration.
- **Age:** the terms say 18+. If you want to serve students under 18, that needs consent and design decisions first.
- Turn on Supabase backups (Pro plan) and set up an alert for failed sign-ups or errors.
- Decide who can read user data at your organisation. Entries are not end-to-end encrypted.

## Known limits (v1)

- Each user's data is one JSON document (`user_state`). Simple and private, but it is last-write-wins: using two devices at the same moment can overwrite the other device's latest change. Moving to separate tables is the next step if you need history, analytics or professional-side access.
- The app uses inline event handlers, so the content-security policy allows `'unsafe-inline'` scripts. User text is escaped everywhere it is shown, but refactoring to event listeners would let you remove that allowance.
- The login session is kept in the browser's local storage (the same approach Supabase's own client uses).
