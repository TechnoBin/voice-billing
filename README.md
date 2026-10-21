# Kirana Voice Billing — starter project

A phone-first Next.js app for a small kirana counter. Includes voice-assisted item entry, quick product search, quantity editing, discount, totals, CSV product import, local bill history, print/save PDF, and optional Supabase cloud storage.

## Important before real use

This is a starter MVP, not a certified accounting system. Local demo mode stores data in the current browser only. Cloud mode needs Supabase configuration. The SQL file deliberately labels its anonymous RLS policies **test-only**: do not use those policies for a public production deployment with real business data. Before real use, add Supabase Auth, an owner identity, owner-scoped RLS policies, and an atomic database RPC/transaction for bill + line-item creation. Cloud bill save currently inserts the bill and line items as two requests, so a network failure between them can leave an incomplete bill; the UI warns about this.

## 1. Upload this ZIP to GitHub from Android

1. Download and extract `kirana-voice-billing.zip` using your Android Files app.
2. Open GitHub in Chrome and sign in. Create a **private** repository named `kirana-voice-billing`.
3. On the repo page, choose **Add file → Upload files**. Upload the files and folders *inside* the extracted project folder (not an extra enclosing folder if GitHub allows choosing contents).
4. Commit the upload to `main`. If mobile GitHub cannot upload folders, use GitHub’s web upload from a browser with Desktop site enabled, or use GitHub’s app/another file manager that supports folder selection.

## 2. Create Supabase project (cloud sync)

1. Create a project at https://supabase.com and wait until it is ready.
2. Open **SQL Editor → New query**. Copy all of `supabase/schema.sql`, paste it, and run it. The included anonymous policies are for private testing only.
3. Open **Project Settings → API** (labels can vary). Copy the Project URL and the publishable/anon key. Never put a `service_role` secret in frontend code or GitHub.

## 3. Deploy on Vercel

1. Open https://vercel.com and sign in with GitHub. Import `kirana-voice-billing`.
2. In project **Settings → Environment Variables**, add:
   - `NEXT_PUBLIC_SUPABASE_URL` = your Supabase Project URL
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = your publishable/anon key
3. Redeploy after adding environment variables.
4. Open the deployed URL on your Android phone and laptop.

## 4. Add products

You can use **Add product** for individual items. For bulk import, create a spreadsheet with columns `name`, `price`, `aliases`, for example:

```csv
name,price,aliases
Oreo,5,oreo biscuit
KitKat,10,kit kat
Dairy Milk,10,dairy milk|silk
Bourbon,10,bourbon biscuit
```

Export/download it as **CSV UTF-8**, then tap **Import CSV** in the app. Check prices and quantities before billing.

## 5. Voice input

Try current Chrome on Android and allow microphone access. Tap the microphone and say a product name followed by quantity, such as “Oreo 5”. The browser speech API may require internet and support varies by browser/device. This version listens in Hindi (`hi-IN`); product names are matched against catalogue names and aliases. It is not guaranteed to understand every Hinglish accent. If a phrase is not recognized, use quick add.

## 6. Local development (optional)

Requires Node.js 20.9 or newer on a computer or compatible terminal. Copy `.env.example` to `.env.local` and fill values if using cloud mode, then run:

```bash
npm install
npm run dev
```

Open http://localhost:3000. To check a production build, run `npm run build`.

## Current scope

Included: catalogue, manual add/update, CSV import, voice-assisted product entry, editable quantities, optional customer name and discount, totals, bill history, print/save PDF. Not included: payments, stock/inventory accounting, barcode scanner, thermal printer integration, multi-staff roles, login, GST invoice compliance, backup/restore workflow.
