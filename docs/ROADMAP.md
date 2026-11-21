# Roadmap

## 0.8.0: finish phase 8 (done, except the real-Cloudflare load run)
Security review of the remaining areas, abuse tests, final documentation pass, release package. Load test run on real Cloudflare (by the administrator, ADMIN-GUIDE 5c) and calibration of usage coefficients from its report.

## 0.8.1: web installer and release packages (built; needs the signing key and a real-account trial)
Goal: installing Gart is a short guided process that needs only a Cloudflare account and a browser; nothing runs on the administrator's computer.
- **Release package** built by GitHub Actions on every version tag and attached to the GitHub Release: manifest with SHA-256 of every file, bundled Worker, static files, migrations, notes; signed (ECDSA P-256), public key embedded in the app and the bootstrap script.
- **Deploy engine** (one engine for installing and updating) that talks to the Cloudflare API: D1, migrations, static assets, Worker upload with Durable Object migrations and secrets, custom domain, health check.
- **Bootstrap Worker**: a short script the administrator pastes into a new Worker in the Cloudflare dashboard. It serves the web installer and passes the browser's calls to the Cloudflare API and GitHub; it stores nothing. The API token is typed into a page served by the administrator's own Worker and goes only to Cloudflare.
- **Web installer**: API token, company name, domain from the account's zones (optional), administrator e-mail and password.
- **Microsite** (GitHub Pages) with step-by-step instructions, the copyable bootstrap script and the token-creation link.
- The local wizard stays as an advanced path and is not developed further.

## 0.8.2: updates from the admin panel, public repository (built)
- "Updates" tab: reads the latest public release, shows what is new, button for the owner runs the same deploy engine (in a Durable Object, 30 s CPU per step), with rollback to the previous version. Needs the same Cloudflare API token, stored encrypted.
- Repository ready for publication: no installation-specific `wrangler.jsonc`, source-code link in the footer (AGPL), README for outsiders, CONTRIBUTING, vulnerability reporting.

## 0.9.0: presentation polish (host screen and projector only)

**Principle (decision D-026).** The host screen and the projector get sound and animation. Participant screens are remote controls: no sound, no animation beyond the plain state change, and the audio code is never downloaded on a participant's phone (separate lazy chunk).

### 1. QR code to join
- Generated in the browser from `<app address>/play?pin=<PIN>`; no network call, no new service.
- Shown in the lobby on the host screen and, large, on the projector. Opening the link pre-fills the PIN.
- Tests: the QR decodes to the correct address (Playwright), correct after a PIN change.

### 2. Sound (host screen and projector)
- Browsers block sound until a click: both screens show an "Enable sound" button once; the choice is remembered per browser. Mute and volume controls stay visible.
- **Background music: original, composed for Gart, generated in the browser** with the Web Audio API (no audio files: no licensing questions, no storage, no bandwidth). Ukrainian character: Dorian/minor scale with the raised fourth, folk-like plucked melody (sopilka/tsymbaly-like timbres), drone and light percussion, about 110-120 BPM, looping with variations. Calm in the lobby, driving during a question, tempo rises in the last seconds, short fanfare for the leaderboard and the finish.
- Nothing is copied from existing songs; the melody is new. "Recognizable" is a matter of taste that I cannot hear: I will provide a listening page with three variants and refine from your feedback.
- Sound effects: participant joined, countdown ticks, question start, time up, correct answer reveal, rank change, podium.
- Quiz setting "music and sound effects" (already listed in the requirements) becomes real, per quiz; the host can still mute at any time.

### 3. Animation (host screen and projector)
- Transitions between states, lobby avatars popping in, countdown ring, answer bars growing, leaderboard rows moving to their new places, podium reveal.
- CSS transforms only (cheap on old projectors' laptops), no new animation library; respects "reduce motion" system setting.

### 4. Projector design
- Large-display typography and spacing, high contrast, readable from the back of the room; checked at 1280x720 and 1920x1080.
- Brand colours applied through tokens with an automatic contrast check: if an administrator's colours would be unreadable, the editor warns.

### 5. Out of scope for 0.9.0
Sound or animation on participant phones; audio files uploaded by administrators; Cloudflare Analytics API; quiz import/export.

### Verification plan
Automated: QR decoding, audio unlock and mute persistence, reduced-motion behaviour, no audio code requested by the participant page, existing suites stay green. By ear/eye (by you): music, effects, animation feel, projector legibility.
