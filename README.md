# Scan to LMS Web

Safari/iOS web app version of the `Scan to LMS` iPhone app. It keeps the same scan -> lookup -> review -> save/reject flow, adds Add to Home Screen support, and syncs books through Supabase.

## Stack

- Vite + React
- `@zxing/browser` for ISBN barcode scanning
- Supabase JS for table sync + Realtime
- Supabase Edge Function for the OpenAI cataloging step
- PWA manifest + service worker for iOS/Safari installation

## Local setup

1. Install dependencies:

```bash
npm install
```

2. Create `.env` from `.env.example` and set:

```bash
VITE_SUPABASE_URL=https://uwvwstnwtjexgwwnljmj.supabase.co
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
```

3. Apply the SQL in [20260309_create_books.sql](/Users/tankuannien/Scan%20to%20LMS%20web/supabase/migrations/20260309_create_books.sql) to the Supabase project.

4. In Supabase, set the Edge Function secrets:

```bash
OPENAI_API_KEY=your_openai_api_key
GOOGLE_BOOKS_API_KEY=your_google_books_api_key
```

Do not put `GOOGLE_BOOKS_API_KEY` in the frontend `.env` file. It is only used by the `complete-book-info` Edge Function.

5. Deploy the Edge Function:

```bash
supabase functions deploy complete-book-info --project-ref uwvwstnwtjexgwwnljmj
```

6. Start the app:

```bash
npm run dev
```

## Processed database upload

- The `CHECK No. Perolehan` screen now accepts `.csv`, `.xlsx`, and `.xls` uploads.
- The latest uploaded database is parsed in the app and the resulting records are stored in `public.processed_database_files` as the shared lookup source for all devices.
- The app reads the current shared database metadata from `public.processed_database_files` and falls back to bundled `book.csv` only when no shared upload exists.
- Open devices subscribe to `processed_database_files` changes through Supabase Realtime and refresh when a new database is uploaded.

## Production notes

- The current SQL policies are public `anon` read/write policies because the native app did not have authentication. If this app will be used outside a trusted internal environment, add auth and tighten RLS before shipping.
- The web app expects the `complete-book-info` Edge Function to be deployed in the same Supabase project as the `books` table.
- Camera barcode scanning needs HTTPS on iPhone.
- Apply the processed-database SQL migration before using the shared upload flow.
- For GitHub Pages project-site deploys, the app builds with the `/Scan-to-LMS-web/` base path through the workflow in [.github/workflows/deploy.yml](/Users/tankuannien/Scan%20to%20LMS%20web/.github/workflows/deploy.yml).
- Add GitHub repository secrets `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` before enabling the Pages workflow.

## Build

```bash
npm run build
```
