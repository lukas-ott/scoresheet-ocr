# Scoresheet to PGN

A static browser app for transcribing photographed chess scoresheets.

## Run locally

```sh
python3 -m http.server 8765 --bind 127.0.0.1 --directory dist
```

Open http://127.0.0.1:8765/. Choose a straight-on photo to start scanning.
The app looks for a regular table with paired move columns. If it cannot
locate the grid, it opens the manual alignment controls. Scan additional
pages in the order they were written. Use **Undo last scan** to rescan a
page or align it manually. Check the transcribed moves against the crops
before copying or downloading the PGN.

OCR and chess validation run in the browser. The first scan needs
network access to download the 41 MB recognition model and its runtime.
Photos and crops stay in the page session. The editor accepts English,
German, French, and Spanish notation. The model was trained on English
moves, so correct other piece letters and enter or check clock notes
and draw offers during review. Clock modes interpret `1:27` as minutes and
seconds and `87` as seconds. Literal mode preserves the original wording.

## Test

```sh
node --test tests/scan.test.mjs
```

The crop benchmark at `/benchmark.html` uses BenjaminKost/processed_hcs,
derived from the Handwritten Chess Scoresheet Dataset by Owen Eicher,
Denzel Farmer, Yiyan Li, and Nishatul Majid (CC BY 3.0). Full-sheet tests
use BenjaminKost/unprocessed_hcs. Gerhard Trippen's Chess OCR BiLSTM was
trained on HCS, so these tests check the integration and are not a
held-out accuracy benchmark.

## Hosting and accounts

Cloudflare Pages can deploy the static app directly from GitHub. Select
the static site preset, leave the build command empty, and set the output
directory to `dist`. The scanner runs without authentication.

### Enable optional PGN sync

1. Create a Supabase project and run [the schema](supabase/schema.sql) in its
   SQL Editor. This grants access only to the signed-in owner of each game.
2. Set the project URL and **publishable** key in `dist/sync-config.mjs`.
   Keep secret and service-role keys out of the repository.
3. In Supabase Auth, set the Cloudflare Pages URL as the Site URL. Allow
   `http://127.0.0.1:8765/` as an additional redirect URL for local testing.
   Use the default magic-link email template. Configure custom SMTP before
   inviting users outside the Supabase project team.
4. Push the configuration to deploy it. Sign in on the phone and desktop,
   then use **Save current PGN** after reviewing the game.

The library uploads only the PGN and title. If the Supabase configuration
is empty, the scanner and local PGN export are available without an account.
