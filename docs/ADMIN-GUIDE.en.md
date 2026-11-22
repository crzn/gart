# Gart: Administrator Guide (basic level)

This guide is for the person who installs and looks after Gart. You do **not** need to be a programmer. Allow about 30 minutes for the first installation.

> **What this build contains.** This is the **platform foundation (phase 1)**: the installer, the database, the web shell and the shared game rules. Administrator sign-in, the quiz editor, live games and the usage monitor are built in the next phases. Everything in sections 1–4 and 7–9 already works; sections about quizzes and games will be added as those phases ship. See `CHANGELOG.md`.

---

## 1. What you need before you start

| You need | Where to get it | Cost |
|---|---|---|
| A computer with Windows 10/11, macOS or Linux | – | – |
| **Node.js 22.12 or newer** | https://nodejs.org (download the "LTS" or "Current" installer; pick a version ≥ 22.12) | Free |
| A **Cloudflare account** | https://dash.cloudflare.com/sign-up | Free, no card needed |
| An internet connection and a web browser | – | – |

To check Node.js, open a terminal (Windows: *PowerShell*; macOS: *Terminal*) and type `node -v`. You should see `v22.12.0` or higher.

Gart runs on Cloudflare's **Free plan**. The installer never enables paid services and never changes your plan.

## 2. One-time Cloudflare preparation

1. Sign up at https://dash.cloudflare.com/sign-up and confirm your e-mail address.
2. Log in to the dashboard. In the left menu open **Workers & Pages**.
3. If Cloudflare asks you to choose a **workers.dev subdomain** (the address ending of your app, for example `acme.workers.dev`), choose a name and confirm. This is free. If you are not asked, you probably already have one.

That is all. You do **not** create databases or services by hand; the installer does it.

## 2b. Install from the browser (recommended)

Nothing is installed on your computer. You only need a browser. The page with step-by-step instructions and the script you need is the **Gart install page** (the address is in the project README, "Install").

1. Sign up at Cloudflare (see section 2).
2. **Create an access token.** Cloudflare → profile → **API Tokens → Create Token → Create Custom Token**. Permissions: *Account → Workers Scripts → Edit*, *Account → D1 → Edit*, *Account → Account Settings → Read*. For your own domain also *Zone → Zone → Read* and *Zone → DNS → Edit*. Under *Account Resources* choose your account. Copy the token (it is shown once).
3. **Create the bootstrap Worker.** Cloudflare → **Workers & Pages → Create → Start with Hello World → Deploy → Edit code**. Delete the code, paste the script from the install page, press **Deploy**.
4. **Open the Worker's address.** The wizard asks for the token, then the account, the company name, your e-mail and (optionally) your own domain, and installs Gart. Each step is shown; if something fails, press *Try again*: steps are safe to repeat.
5. At the end the wizard opens your new site's **setup page**. Type your name and a password there. That creates the owner account. The password is typed only on your own site.
6. Afterwards you may delete the bootstrap Worker. Keep the token if you want one-click updates later (planned for the next version); otherwise delete it in Cloudflare.

What to know:
- The wizard checks the digital signature of the Gart package before installing anything. A forged or damaged package is refused.
- The token is typed on a page served by your own Worker and sent only to Cloudflare. It is not stored.
- If the Worker name you chose already exists in your account, choose another one.
- The local wizard in section 3 still works and is meant for technical users; use either, not both, for the same site.

## 3. Install Gart with the local wizard (advanced, needs Node.js)

1. **Unpack** the archive `gart-0.8.1.zip` into a folder, for example `C:\gart` or `~/gart`.
2. Open a terminal **in that folder**.
   - Windows: open the folder in Explorer, click the address bar, type `powershell`, press Enter.
   - macOS/Linux: `cd ~/gart`
3. Start the installer:
   - **Windows:** `powershell -ExecutionPolicy Bypass -File .\install.ps1`
   - **macOS / Linux:** `bash install.sh`
4. The terminal prints a link like `http://127.0.0.1:47615/?t=…` and tries to open it. If your browser did not open, **copy the whole link** into the browser. The link only works on your own computer and only while the installer runs.
5. In the wizard:
   1. **Welcome.** Check the requirements. If it says "Dependencies not installed", click **Prepare** and wait (about a minute).
   2. **Cloudflare.** Click **Sign in to Cloudflare**. A Cloudflare page opens: confirm the access. Return to the wizard; it shows your e-mail.
   3. **Settings.** Pick your Cloudflare account. Keep the default names (`gart` and `gart-db`) unless you need others (lowercase letters, digits and hyphens only). Optionally enter your company name and colour.
   4. **First administrator.** On the same screen enter your e-mail, display name and a password (at least 12 characters, typed twice). This account becomes the **owner** of the platform. The wizard never saves or logs the password; the server keeps only a one-way hash.
   5. **Install.** Click **Start installation**. The wizard creates the database, builds and publishes the app and tests it. This takes 3–6 minutes. Near the end the wizard measures how strong the password hashing can be on your Cloudflare account (about 40 short requests) and then creates your administrator. Do not close the terminal.
6. At the end the wizard shows **your app address** (for example `https://gart.acme.workers.dev`) and the administrator e-mail. Open the address, choose **Administration** and sign in. Bookmark it.

If the administrator step fails or you closed the wizard before it finished, start the wizard again: Welcome shows **Create administrator**. This is possible only while no administrator exists; after the first one is created, nobody can create another one this way.

If a step fails, the wizard shows what went wrong and a hint. Fix the cause and press **Try again**; it is safe to repeat (it reuses what already exists and never duplicates your data).

## 4. Everything the wizard can do later

Start the wizard again the same way. On the Welcome screen you will see **Manage installation**:

| Button | Use it when | Does it touch my data? |
|---|---|---|
| **Update** | You received a new version of Gart (unzip it over the old folder, then Update) | No. Data and secrets are kept |
| **Repair** | Something broke or you moved to a new computer | No. Reuses the existing database |
| **Backup** | Before any update, and regularly | Only reads. Saves a copy to the `backups` folder |
| **Uninstall** | You want to remove Gart | Removes the app. **Keeps the database** unless you type its name separately |

Moving to a new computer: unzip Gart there and run **Repair** with the **same names** you used before. Your data stays in Cloudflare.

## 5. Creating quizzes and branding

Sign in at your app address → **Administration**.

**Quizzes tab**
1. Type a title, optionally pick a **template** (Classic, Speed, Assessment, True or false, Corporate training, Cybersecurity; the page lists exactly what each one sets) and press **Create**. A template only pre-fills the game settings; you can change them afterwards.
2. **Add question**: write the text, choose *one correct answer* (2–4 options, mark the correct one) or *True/False*. Optionally add a picture, a time limit, points and an explanation shown after the answer.
3. Use the arrows to reorder questions. Settings (timer, points, speed bonus, shuffling, leaderboard, and so on) are at the bottom of the quiz page and save automatically.
4. Set the status to **Active** when the quiz is ready. A quiz needs at least one valid question to become active. *Draft* is for work in progress, *Archived* hides old quizzes from future use.
5. **Duplicate** copies a quiz with all questions. Editors can delete only their own quizzes; administrators and owners can delete any.

**Pictures.** Choose a file (PNG, JPEG, WebP or GIF). The browser shrinks and compresses it automatically before uploading (limit 200 KB per picture after compression; total storage 150 MB). Identical pictures are stored once.

**Menu.** At the top: **Quizzes, Games, Settings, My account**. **Settings** (owner and administrators) holds System status, Updates (owner only), Administrators, Usage and Branding. An editor sees only Quizzes, Games and My account. On the right of the header is the **user menu**: name, **"Gart sound: on/off"** (any role can switch it; the speaker icon is visible even when the menu is closed), language and sign out. Settings has a side panel with its sections.

**Branding tab** (administrators and owners). Company name, logo and its position, four colours, background image and welcome and final messages. A preview is shown on the right, and a warning appears when the contrast with white text is too low. Branding applies immediately to the whole app.

*Live games, the host screen and import/export arrive in later phases.*

## 5a. Running a game

1. In the **Quizzes** tab press **Start game** next to an active quiz. The host screen opens with a large **PIN**. At most **3 games** can run at once.
2. Press **Projector screen**: a separate tab without menus or buttons opens. Show it on a projector. It only works in a browser where you are signed in to the administration (sign in on that computer too).
3. Participants open the app address on a phone, enter the PIN, a nickname (2-20 characters) and pick an avatar. You can remove a participant with the button next to their name in the lobby.
4. Press **Start game** (at least one participant is needed). A question closes when time is up, when everyone has answered (if that setting is on in the quiz settings), or when you press **Close question**. Then **Leaderboard** (optional) and **Next**; on the last question the button reads **Finish game**.
5. **Pause** stops the timer on all screens; after **Resume** no time is lost.
6. If a phone loses its connection or the page is refreshed, the participant returns to the same game with the same score. If you reload the host page, the game goes on.
7. **Games** tab: the list of games, returning to an unfinished one, and for finished games a results table, per-question statistics and a **CSV** download (opens in Excel).

Do not close the host tab needlessly, and do not open it in two places at once: the second tab replaces the first.

**QR code, sound and animation (host screen and projector).** The lobby shows a **QR code**: participants point their phone camera at it and land on the join page with the PIN already filled in. There are no animations anywhere. The top of the projector (and the player waiting screen) shows the logo, company name and slogan (default "Знай. Дій. Перемагай!", editable in Branding). Answer time is set for the whole quiz (default 15 s); questions have no time of their own. **Sound** starts switched off because browsers allow it only after a click: press **Enable sound** on the screen that is connected to the speakers (usually the projector tab; if you enable it on both the host tab and the projector on one computer you will hear everything twice). Volume and the choice of music (Sopilka, Tsymbaly, Hopak) are on the same panel; **Listen to the variants** opens `/listen`, where you can try every music variant and effect and save a sample. When the lobby opens you hear the six-second Gart intro, then a monotone waiting theme that builds as players join. The intro and the join sound are controlled only by **Branding → Gart sound (Yes/No)**; a quiz can switch the music and the other effects off in its own settings. The host screen also shows the join link with the PIN and a Copy button, to paste into a messenger: the chat (WhatsApp, for example) shows a preview under the link with the quiz title, its description and its cover (the logo if there is no cover, the slogan if there is no description). With automatic advance, the correct answer and the ranking stay on screen for 3 seconds each. Participants' phones are always silent.

## 5a-2. Privacy and data retention

**Settings → Privacy** (owner and administrators) sets how long finished games are kept (30 days, 90 days, 1 year or until you delete them), your contact for data questions and an optional extra text. They appear on the public page `/privacy`, which is linked in the footer and on the join form. Old games are deleted automatically (at most once a day, on a sign-in or a new game; a shorter period applies as soon as you save). To erase one game at once, open its results in **Games** and press **Delete game**: all nicknames and answers go with it. The site is closed to search engines and AI crawlers by `robots.txt`.

## 5b. The Usage tab

For administrators and the owner. It shows how much of the free Cloudflare allowances was used today (the day is counted in UTC) and whether the next game fits.

- **Three kinds of numbers.** *Estimate* is the application's model. *Measured by app* are counters the application keeps about itself (a lower bound: page and API requests are not counted one by one). *Official* are figures from the Cloudflare dashboard that you type in (Workers & Pages → your app → Metrics). Only the last are official. No API token is needed.
- **Alerts.** Default levels: 50 % info, 75 % warning, 90 % critical, 100 % quota reached. The first three can be changed. Alerts use the larger of the measured and official values.
- **Calculator.** Enter games per month, participants, questions, length, reconnects, messages, images and retention. You get the cost per game, per busiest day and per month, the percentage of the daily limit, the worst case, and how many games of that size fit per day (naming the resource that runs out first).
- **Before a game.** If a new game would, by estimate, push any resource to 75 % or more, pressing "Start game" shows a warning: which resource, how much it uses now and after the game, and how many more such games fit. You can cancel, start anyway, or turn on **safe mode** (up to 60 participants, no extras). Paid Cloudflare features are never switched on and the plan is never changed.
- This has not been checked on a real Cloudflare account yet: the model rests on local measurements, so every few games compare with the Cloudflare dashboard and enter its figures.

## 5c. Load test (optional, before the first big event)

The package contains `tests/load/load-test.mjs`: it runs one real game with up to 120 simulated participants against **your** site and writes a report. It needs Node.js 22 and the source folder, and uses real daily quota (about 1 % of the daily allowance for 120 participants and 5 questions).

1. Open a terminal in the Gart folder.
2. Set your details (Windows PowerShell: `$env:GART_URL="https://..."`; macOS/Linux: `export GART_URL=...`): `GART_URL` (your app address), `GART_EMAIL`, `GART_PASSWORD` (an administrator or editor).
3. Look first, without running: `node tests/load/load-test.mjs --players 120 --questions 5` prints the plan and the app's own quota forecast.
4. Run it for real by adding `--yes`. The script creates a temporary quiz, runs the game, deletes the quiz and prints **RESULT: PASS** or a list of problems. A file `load-report-<time>.json` is saved.
5. Open the **Usage** tab and compare: the measured numbers should be close to the forecast. If a resource shows much more than forecast, send us the report and the Usage numbers.

Do not run it in the middle of a working day if a real game is planned: it uses the shared daily quota.


## 6. Daily use and limits of the Free plan

- Cloudflare's free allowances are **daily** and reset at **00:00 UTC** (02:00 in Kyiv in winter, 03:00 in summer).
- If a daily allowance is used up, further operations of that kind **fail until the reset**; nothing is charged. From local measurements, a full 120-player quiz allows roughly 30 games per day by the write limit (plan for no more than 10 to stay safe). This is an estimate; measurements on a real Cloudflare account come with the load tests in phase 8.
- Do not run several big games at the same time on the same day if you expect a busy day.
- The built-in usage monitor (phase 6) will warn you before a game starts if a limit is close.
- Official figures: Cloudflare dashboard → **Workers & Pages** → your app → **Metrics**.

## 7. Security basics

- Share the app address, never the installer link.
- Give each person their own administrator account (Administration → Administrators), use long unique passwords, and **disable** the accounts of people who leave. Roles: *owner* (everything, manages administrators), *admin* (manages editors), *editor* (quizzes only).
- Passwords need at least 12 characters, must not be a common password and must not contain part of the e-mail address. Use a password manager or a passphrase of several words.
- Wrong sign-in attempts are limited (8 wrong passwords per account per 15 minutes, 20 attempts per network address per 10 minutes). Sessions end after 8 hours of inactivity or 14 days at most. Changing a password signs out the other devices (see Administration → My account for the list of sessions).
- **Keep at least two owners.** A password reset by e-mail is not part of this build. If the only owner forgets the password, access cannot be restored from the web app in this version.
- The installer creates two random secrets and stores them only inside Cloudflare. They are never written to the project folder.
- The wizard signs you in with Cloudflare's official sign-in; you never paste a password or key. To sign out of Cloudflare on this computer: `npx wrangler logout` in the project folder.

## 8. Backups and recovery

**Two layers protect your data:**

1. **Cloudflare Time Travel (automatic, recommended for recovery).** Cloudflare keeps the history of your database for **7 days** on the Free plan, with no setup. If something is deleted by mistake, a developer or administrator can roll the database back (this *overwrites the database in place*, so be sure first):
   ```
   cd apps/worker
   npx wrangler d1 time-travel info gart-db -c wrangler.jsonc
   npx wrangler d1 time-travel restore gart-db --timestamp=<UNIX_TIME> -c wrangler.jsonc
   ```
   The restore prints a bookmark you can use to undo the restore.
2. **Wizard backup (your own offline copy).** **Manage installation → Backup** saves, in the `backups/<date>` folder: the database as an SQL file (without login sessions), the installation record and the deploy configuration. Keep these files somewhere safe. They contain quiz content and results, so treat them as confidential. Use **Backup** before every update.

> Restoring from the SQL file into a new database is a developer task and will get a guided tool in phase 8. Time Travel is the quick path for the first 7 days.

## 9. Updating Gart

### From the admin panel (owner, simplest)

Open **Admin → Updates**. The first time, create a Cloudflare token (the tab shows the steps: Workers Scripts → Edit, D1 → Edit, Account Settings → Read, for your account), enter the Worker's name and paste the token. The token is stored encrypted on your own site and you can delete it from the same tab at any time.

Press **Check for updates**: the tab shows the newest release and what is new. **Update** downloads the signed package, verifies it, applies new database migrations and publishes the new code; keep the page open until it says "Done", then reload it. If a release removes data, you are asked to confirm first. The same tab can install an earlier release (database changes stay; they only add data). A copy installed before 0.8.2 has no Updates tab yet: update it once by one of the methods below.

### Other ways

1. Run **Backup**.
2. Unzip the new version **over** the old folder (keep the hidden `.gart` folder and `apps/worker/wrangler.jsonc` if present).
3. Run the installer and choose **Update**.

### Automatic updates from GitHub (recommended after the first install)

The code lives in your **private** GitHub repository. A new version reaches Cloudflare without the wizard and without your computer. Your quizzes, results, administrators and secrets are not touched.

**Two steps on the development side.** When you say "push to GitHub", the new files go to the `main` branch (after tests pass); nothing changes on Cloudflare. When you say "release", the `release` branch moves to `main` and Cloudflare builds and deploys the new version by itself.

**One-time setup:**
1. The repository holds nothing specific to your installation. Your Worker name, database name and database id are given to the build as variables (step 4).
2. Cloudflare → Workers & Pages → your Worker → **Settings → Builds → Connect** → pick the GitHub repository.
3. Production branch: `release`. Build command: `npm ci && npm run check`. Deploy command: `npm run deploy:cloudflare`.
4. In the same place add build variables: `NODE_VERSION` = `22`, `GART_WORKER_NAME` = your Worker name, `GART_D1_NAME` = your database name, `GART_D1_ID` = the database id (Cloudflare → Storage & Databases → D1 → your database). They are names and ids, not secrets.

**What happens on a release:** the build runs the tests, then new database migrations are applied, then the code is published. If something fails before publishing, the previous version keeps running. Progress is visible in Cloudflare → your Worker → **Deployments** (or Builds).

**Rollback:** Cloudflare → your Worker → **Deployments** → pick a previous version → **Rollback**. Code returns instantly. The database is **not** rolled back, which is why new migrations only add things (tables, columns, indexes) and a test in the repository rejects data-destroying ones.

**Free build limits:** 3,000 minutes a month and one build at a time; a typical build takes a few minutes.

The wizard (**Update**) remains the fallback.

## 10. Troubleshooting

| What you see | What to do |
|---|---|
| "Node.js is too old" / not found | Install Node.js 22.12+ from https://nodejs.org, open a new terminal, retry |
| Link does not open | Copy the **entire** link from the terminal, including `?t=…` |
| "Sign in" never finishes | Make sure no other `wrangler login` is open; port 8976 must be free; retry |
| "workers.dev subdomain" message | Do section 2, step 3, then press **Repair** |
| "limit … databases" | Delete unused D1 databases in the Cloudflare dashboard (Storage & databases → D1) |
| Health check fails right after deploy | New deployments can need a minute. Press **Try again** |
| Page shows "Problem" for database | Run **Repair** (re-applies database migrations) |
| "Waiting for the setup token" repeats many times | Cloudflare needs a moment to publish new secrets. Wait a minute and press **Try again** |
| "Too many attempts" when signing in | Wait 15 minutes, or ask another administrator to check the account |
| Anything else | Copy the red message and the last lines of the log from the wizard and send them to your developer |

## 11. Uninstalling

**Manage installation → Uninstall.** Type the service name to remove the app. To also delete **all quizzes and results forever**, additionally type the database name in the second box. If you leave it empty, the database is kept and a later install with the same names will find it again.

**Importing quizzes from files (gart.json).** In the Quizzes tab, **Import quizzes from a file** accepts up to 5 files at once, one quiz per file; each becomes a draft that you review and activate. **Download template** gives you `gart-template.json` with comments written for an AI assistant: send it to the assistant and ask for a quiz on your topic in that format, then import the file it returns. If a file is refused, the page says which question and field is wrong. Images are not included in the files: add them in the editor afterwards.
