# BioLifeDrive — standalone copy

Rebuilt from the feature list for the Muse fullstack site (slug `life-bios`).
The Muse source, logs and data were **not** read. This is a fresh,
standalone Node.js + Express + Postgres app, ready for Railway.

> **It is not live.** Nothing here has been deployed, no domain has been
> pointed at it, and no payments have been taken. It starts empty — the
> Muse site's saved stories/profiles do **not** carry over.

## What is copied

- Life-story publishing: profiles, stories, read counts, likes, comments,
  followers, search / categories / trending
- MySpace-style profiles: mutual friends, ranked Top 5 Friends, profile
  song (title/artist/link, YouTube link), 8 built-in skins
  (Classic Blue default, Classic Cream, Sunset Glow, Ocean Drive,
  Grape Soda, Forest Trail, Midnight Stars, Bubblegum Pop, Golden Hour),
  custom skins by direct image link (`.jpg/.png/.gif/.webp`, not a web page)
- AI companion per profile: text chat + voice call (browser speech
  recognition/synthesis — no phone number is dialled), customisable
  greeting/personality/topics/tone, minor-safe, always identifies as AI
- AI moderation before publication (keyword first pass; blocked = slurs/
  hate, explicit content, sexual content involving minors, threats, scams;
  strong profanity / non-explicit sexual themes = 18+ only), minor-safe
  browsing by default with 18+ check, adults-only hidden from minors,
  comment reporting, blocking, Safety page
- Docuseries: YouTube episodes linked to stories; episode views add to
  the parent story's read count
- Earnings: eligible at **10,000 total reads**, **50/50 split**,
  **$25/month Creator Membership** for videos over 5 minutes,
  Earnings dashboard, Creator Tax Center (1099-style summaries + CSV —
  templates, not tax advice)
- Legal pages: Terms, Privacy, Copyright, Creator Agreement — templates
  for lawyer review. Sole owner: BioLifeDrive. **No partnership:**
  creators are independent creators, not partners/employees/agents.
- Bright blue theme (`#0091FF` primary), ad slots as placeholders
  until AdSense approves `biolifedrive.com`

## What is NOT copied / missing

- **The Muse site's data.** All stories, profiles, friends, comments,
  skins and bot history in Muse stay in Muse. This copy starts empty.
  To migrate, export the data from the Muse site first (not done here).
- **The exact logo file.** The pink/blue chat-bubble heart logo was not
  copied. Add it as `public/logo.png` (or `.svg`) and reference it in
  `public/index.html`. The header currently uses a text/emoji mark.
- **Real Stripe payments.** Membership and earnings are a model only.
  No card is charged. Wire Stripe Checkout + webhooks after Stripe's
  live account is activated (address verification was pending).
- **Real OpenAI replies.** Without `OPENAI_API_KEY` the companion uses
  a grounded fallback that quotes the creator's own stories. With a key
  set, wire the OpenAI call in `server.js` (`/api/companion/:id/chat`).
- **Real AdSense ads.** Ad slots are placeholders. Set
  `ADSENSE_CLIENT_ID` after AdSense approves `biolifedrive.com`.
- **Accounts / passwords.** Profiles here have no login yet. Add auth
  (e.g. email + password, or Railway/Clerk/Auth.js) before opening
  sign-ups to the public — otherwise anyone can post as any profile ID.
- **Video watching.** The AI checks a video's title/description/link;
  it cannot watch the YouTube video itself (same limitation as the
  Muse site).

## Files

```
biolifedrive-standalone/
  server.js            Express API + static UI, Postgres or memory fallback
  package.json         express, pg, cors — no build step
  Dockerfile           node:20-alpine, runs `node server.js` on $PORT
  railway.json         Railway build/deploy config, healthcheck /api/health
  .env.example         env vars to set on Railway (DATABASE_URL, PORT, …)
  db/schema.sql        Postgres tables for authors, stories, comments,
                       friendships, top_five, follows, episodes,
                       memberships, reports, blocks, bot_messages,
                       custom_skins
  db/seed.sql          one demo author + story (optional, for testing only)
  public/index.html    Discover / Profiles / Docuseries / Earnings /
                       Safety / Legal UI
  public/styles.css    bright-blue theme
  public/app.js        frontend: stories, friends, Top 5, skins, song,
                       AI companion text + voice, earnings, reporting
  README.md            this file
```

## Run locally

```bash
cd biolifedrive-standalone
cp .env.example .env        # optional; without DATABASE_URL it uses memory
npm install
npm start                   # http://localhost:3000
curl http://localhost:3000/api/health
# With Postgres: psql "$DATABASE_URL" -f db/schema.sql
#                psql "$DATABASE_URL" -f db/seed.sql   # demo data only
```

## Deploy to Railway (exact next steps)

Prerequisites already done: Railway account
`laramaclaren95@yahoo.com`, project **BioLifeDrive**, Postgres service
online. Domain `biolifedrive.com` bought on Namecheap.

1. **Put this code in GitHub** (Railway deploys from a repo):
   ```bash
   cd biolifedrive-standalone
   git init && git add . && git commit -m "BioLifeDrive standalone"
   # create a repo on github.com (e.g. biolifedrive/biolifedrive), then:
   git remote add origin https://github.com/<you>/biolifedrive.git
   git push -u origin main
   ```
   Do not commit `.env`. Never commit Stripe secret keys.
2. **In Railway** (project BioLifeDrive, already signed in):
   New Project → **Deploy from GitHub** → pick the repo → Railway
   detects the `Dockerfile` / `railway.json` and builds it.
   Or: on the project canvas, **New → GitHub Repo**.
3. **Link the database:** on the new web service, Variables →
   add a reference variable `DATABASE_URL` → Postgres service →
   `DATABASE_URL`. Railway will restart the service; `server.js`
   creates the schema on start. Check **Deployments → Logs** for
   `Postgres connected, schema ready`, and visit
   `https://<railway-url>/api/health` — it should say `"db":"postgres"`.
4. **Test the live app** at the Railway URL: create a profile, publish
   a story, add a friend / Top 5, set a song and skin, try the AI
   companion, check Earnings. Delete the demo data if you seeded it.
5. **Connect the domain** (only after step 4 works):
   Railway service → **Settings → Domains → Custom Domain** →
   enter `biolifedrive.com` (and `www.biolifedrive.com`).
   Railway will show DNS records (a CNAME, usually).
   In **Namecheap → Domain List → biolifedrive.com → Advanced DNS**,
   add the CNAME Railway gives you, and remove any conflicting A/CNAME
   for `@` / `www`. DNS can take minutes to a few hours.
   Railway provisions HTTPS automatically.
6. **Add the site to AdSense:** AdSense → Sites → Add site →
   `https://biolifedrive.com`. AdSense will ask you to verify ownership
   (paste its code into the site, or a DNS TXT record in Namecheap).
   Approval needs a public site with real stories, Privacy Policy and
   Contact — the Legal pages in this copy are templates for lawyer
   review, so get those reviewed before applying.
7. **Stripe (after its live account is activated):** in Stripe, finish
   address verification, connect the Wells Fargo account for payouts,
   then wire Stripe Checkout for the $25/month Creator Membership and
   payouts in this code (replace the model-only `/api/memberships` and
   `/api/earnings` with real Stripe calls). Do not charge anyone until
   that is done and tested in Stripe test mode first.
8. **Before opening sign-ups:** add real auth, review the legal
   templates with a lawyer, and test moderation / 18+ / reporting end
   to end on the live domain.

## Costs (as found in the conversation)

- Domain: $12.28 first year, $19.98/yr + $0.20 ICANN on renewal (Namecheap)
- Railway: Trial 30 days or $5 limited trial; Hobby is about $5/mo
  plus usage; Postgres is billed by usage on top
- Stripe: standard US fees are about 2.9% + 30¢ per payment; basic
  Radar fraud protection is included — the extra fraud plan is optional
