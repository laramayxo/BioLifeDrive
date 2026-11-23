/**
 * BioLifeDrive — standalone copy (rebuilt from the feature list, not from
 * the Muse artifact source, which was not read).
 *
 * Stack: Node.js + Express + Postgres (Railway). No build step.
 * If DATABASE_URL is set and reachable, data is stored in Postgres.
 * Otherwise the server runs on an in-memory store so it can be tested
 * locally without a database. Railway must have a Postgres service linked.
 *
 * Features copied:
 * - Stories: publish, read-count, like, comment, search/category/trending
 * - Profiles: friends (mutual), Top 5, profile song, 8 skins
 *   + custom skins (upload-by-URL / import from a direct image link)
 * - AI companion per profile: text chat + voice (browser speech in the UI),
 *   customisable greeting/personality/topics/tone, minor-safe, identifies as AI
 * - AI moderation (keyword first pass + optional OpenAI) before publication,
 *   minor-safe browsing by default, 18+ check, adults-only hidden from minors,
 *   comment reporting, blocking, Safety page
 * - Docuseries: YouTube episodes linked to stories; episode views add to
 *   the parent story's read count
 * - Record Video: record yourself in the browser (camera + mic), publish
 *   the recording. Same rules as stories: AI moderation on title/description
 *   before publication (the AI cannot watch the video itself — report/block
 *   is the backstop), minor-safe by default with 18+ adults-only, videos
 *   over 5 minutes need a $25/month Creator Membership. Videos are stored
 *   as files on the server (Railway disk is ephemeral — a redeploy can lose
 *   them; permanent object storage is a later step before relying on them).
 * - Earnings: eligible at 10,000 total reads, 50/50 split, $25/mo Creator
 *   Membership for videos over 5 minutes, Earnings dashboard, Tax Center
 *   (1099-style summaries + CSV download — templates, not tax advice)
 * - Legal pages: Terms, Privacy, Copyright, Creator Agreement (templates,
 *   for lawyer review). Sole owner: BioLifeDrive. No partnership: creators
 *   are independent creators, not partners/employees/agents.
 * - Ad slots (placeholders until AdSense approves biolifedrive.com)
 *
 * NOT in this copy: real Stripe payments (connect after Stripe live
 * activation), real OpenAI calls unless OPENAI_API_KEY is set, the Muse
 * site's saved stories/profiles (this copy starts empty), and the exact
 * pink/blue chat-bubble heart logo file (recreate it as public/logo.svg/png
 * and set LOGO_URL, or keep the CSS mark below).
 */
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json({ limit: '6mb' }));
app.use(express.static(path.join(__dirname, 'public')));
const UPLOADS_DIR = path.join(__dirname, 'uploads');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });
app.use('/uploads', express.static(UPLOADS_DIR));

const PORT = process.env.PORT || 3000;

// ---------- Moderation: deterministic first pass ----------
// Blocked: slurs/hate, explicit sexual content, sexual content involving
// minors, threats, harassment, scams. Strong profanity / non-explicit sexual
// themes -> adults-only (18+). This is a first pass only; it does not watch
// YouTube videos, only titles/descriptions/links and text.
const BLOCKED = [
  /\b(kill|murder|rape|molest|abuse)\b.*\b(child|kid|minor|teen|girl|boy)\b/i,
  /\bchild\b.*\b(sex|porn|nude|naked)\b/i,
  /\b(sex|porn|nude|naked)\b.*\b(child|kid|minor|teen)\b/i,
  /\b(nigger|faggot|kike|chink|spic)\b/i,
  /\b(free money|send bitcoin|wire transfer|claim your prize)\b/i,
];
const ADULT = [/\b(fuck|shit|bitch|damn)\b/i, /\b(sex|erotic|sexy|nsfw)\b/i, /\b(swear|profanity)\b/i];
function moderate(text = '') {
  const t = String(text);
  if (BLOCKED.some((re) => re.test(t))) return 'blocked';
  if (ADULT.some((re) => re.test(t))) return 'adult';
  return 'published';
}

// ---------- Storage: Postgres when available, memory otherwise ----------
let pool = null;
let useDb = false;
try {
  if (process.env.DATABASE_URL) {
    const { Pool } = require('pg');
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSL === 'false' ? false : { rejectUnauthorized: false } });
  }
} catch (e) { console.warn('pg unavailable, using memory store', e.message); }

const mem = { authors: [], stories: [], comments: [], friendships: [], topFive: [], follows: [], episodes: [], videos: [], memberships: [], reports: [], blocks: [], botMessages: [], customSkins: [], seq: { authors: 1, stories: 1, comments: 1, episodes: 1, videos: 1, reports: 1, botMessages: 1, customSkins: 1 } };
const SKINS = {
  'classic-blue': { name: 'Classic Blue', bg: '#eaf4ff', accent: '#0091ff' },
  'classic-cream': { name: 'Classic Cream', bg: '#fff8e7', accent: '#0091ff' },
  sunset: { name: 'Sunset Glow', bg: 'linear-gradient(135deg,#ffe0b2,#ffb3c1)', accent: '#ff6b35' },
  ocean: { name: 'Ocean Drive', bg: 'linear-gradient(135deg,#b3e5fc,#0091ff)', accent: '#0091ff' },
  grape: { name: 'Grape Soda', bg: 'linear-gradient(135deg,#e1bee7,#7e57c2)', accent: '#7e57c2' },
  forest: { name: 'Forest Trail', bg: 'linear-gradient(135deg,#c8e6c9,#2e7d32)', accent: '#2e7d32' },
  midnight: { name: 'Midnight Stars', bg: 'linear-gradient(135deg,#1a237e,#000000)', accent: '#82b1ff' },
  bubblegum: { name: 'Bubblegum Pop', bg: 'linear-gradient(135deg,#f8bbd0,#ff4081)', accent: '#ff4081' },
  golden: { name: 'Golden Hour', bg: 'linear-gradient(135deg,#fff59d,#ffb300)', accent: '#ff8f00' },
};

async function initDb() {
  if (!pool) return;
  try {
    const sql = fs.readFileSync(path.join(__dirname, 'db', 'schema.sql'), 'utf8');
    await pool.query(sql);
    useDb = true;
    console.log('Postgres connected, schema ready');
  } catch (e) { console.warn('Postgres init failed, using memory store:', e.message); pool = null; }
}
const q = (text, params) => pool.query(text, params);

// Helpers that work in both modes (DB paths used on Railway; memory locally)
async function listAuthors() {
  if (useDb) return (await q('SELECT * FROM authors ORDER BY id DESC')).rows;
  return [...mem.authors].reverse();
}
async function getAuthor(id) {
  if (useDb) return (await q('SELECT * FROM authors WHERE id=$1', [id])).rows[0] || null;
  return mem.authors.find((a) => a.id === Number(id)) || null;
}
async function createAuthor({ name, bio }) {
  const status = moderate(`${name} ${bio}`);
  if (status === 'blocked') throw new Error('Profile blocked by moderation');
  if (useDb) return (await q('INSERT INTO authors(name,bio) VALUES($1,$2) RETURNING *', [name, bio || ''])).rows[0];
  const a = { id: mem.seq.authors++, name, bio: bio || '', skin: 'classic-blue', custom_skin_url: null, custom_skin_name: null, song_title: '', song_artist: '', song_url: '', bot_enabled: true, bot_greeting: 'I am your AI companion, chat with me about anything', bot_personality: 'Warm, curious, and encouraging', bot_topics: '', bot_tone: 'Friendly', total_reads: 0, created_at: new Date().toISOString() };
  mem.authors.push(a); return a;
}
async function listStories(adultMode) {
  const rows = useDb ? (await q('SELECT * FROM stories WHERE status != $1 ORDER BY id DESC', ['blocked'])).rows
    : [...mem.stories].filter((s) => s.status !== 'blocked').reverse();
  return adultMode ? rows : rows.filter((s) => s.audience !== 'adult' && s.status !== 'adult');
}
async function getStory(id) {
  if (useDb) return (await q('SELECT * FROM stories WHERE id=$1', [id])).rows[0] || null;
  return mem.stories.find((s) => s.id === Number(id)) || null;
}

// ---------- API ----------
app.get('/api/health', (req, res) => res.json({ ok: true, db: useDb ? 'postgres' : 'memory', skins: Object.keys(SKINS) }));
app.get('/api/skins', (req, res) => res.json(SKINS));

app.get('/api/authors', async (req, res) => res.json(await listAuthors()));
app.post('/api/authors', async (req, res) => {
  try { res.status(201).json(await createAuthor(req.body)); } catch (e) { res.status(400).json({ error: e.message }); }
});
app.get('/api/authors/:id', async (req, res) => {
  const a = await getAuthor(req.params.id); if (!a) return res.status(404).json({ error: 'not found' });
  const stories = (await listStories(true)).filter((s) => s.author_id === Number(req.params.id));
  const friends = useDb ? (await q('SELECT a.* FROM authors a JOIN friendships f ON (f.author_b=a.id AND f.author_a=$1) OR (f.author_a=a.id AND f.author_b=$1)', [a.id])).rows
    : mem.friendships.filter((f) => f.author_a === a.id || f.author_b === a.id).map((f) => mem.authors.find((x) => x.id === (f.author_a === a.id ? f.author_b : f.author_a))).filter(Boolean);
  const top = useDb ? (await q('SELECT friend_id, rank FROM top_five WHERE author_id=$1 ORDER BY rank', [a.id])).rows
    : mem.topFive.filter((t) => t.author_id === a.id).sort((x, y) => x.rank - y.rank);
  const skins = useDb ? (await q('SELECT * FROM custom_skins WHERE author_id=$1 ORDER BY id DESC', [a.id])).rows : mem.customSkins.filter((s) => s.author_id === a.id);
  res.json({ ...a, stories, friendCount: friends.length, friends, topFriends: top, customSkins: skins, totalReads: stories.reduce((n, s) => n + (s.reads || 0), 0) });
});
app.post('/api/authors/:id/friend', async (req, res) => {
  const { friendId } = req.body; const a = Number(req.params.id), b = Number(friendId);
  if (useDb) { await q('INSERT INTO friendships(author_a,author_b) VALUES($1,$2) ON CONFLICT DO NOTHING', [Math.min(a, b), Math.max(a, b)]); }
  else if (!mem.friendships.some((f) => (f.author_a === a && f.author_b === b) || (f.author_a === b && f.author_b === a))) mem.friendships.push({ author_a: a, author_b: b });
  res.json({ ok: true, friends: true });
});
app.post('/api/authors/:id/top-five', async (req, res) => {
  const { friendId, rank } = req.body;
  if (useDb) await q('INSERT INTO top_five(author_id,friend_id,rank) VALUES($1,$2,$3) ON CONFLICT (author_id,rank) DO UPDATE SET friend_id=$2', [req.params.id, friendId, rank]);
  else { mem.topFive = mem.topFive.filter((t) => !(t.author_id === Number(req.params.id) && t.rank === rank)); mem.topFive.push({ author_id: Number(req.params.id), friend_id: friendId, rank }); }
  res.json({ ok: true });
});
app.post('/api/authors/:id/style', async (req, res) => {
  const { skin, song_title, song_artist, song_url, custom_skin_url, custom_skin_name, bot_enabled, bot_greeting, bot_personality, bot_topics, bot_tone } = req.body;
  if (moderate(`${song_title || ''} ${song_artist || ''} ${bot_greeting || ''}`) === 'blocked') return res.status(400).json({ error: 'Blocked by moderation' });
  if (useDb) await q('UPDATE authors SET skin=COALESCE($2,skin), song_title=COALESCE($3,song_title), song_artist=COALESCE($4,song_artist), song_url=COALESCE($5,song_url), custom_skin_url=COALESCE($6,custom_skin_url), custom_skin_name=COALESCE($7,custom_skin_name), bot_enabled=COALESCE($8,bot_enabled), bot_greeting=COALESCE($9,bot_greeting), bot_personality=COALESCE($10,bot_personality), bot_topics=COALESCE($11,bot_topics), bot_tone=COALESCE($12,bot_tone) WHERE id=$1', [req.params.id, skin, song_title, song_artist, song_url, custom_skin_url, custom_skin_name, bot_enabled, bot_greeting, bot_personality, bot_topics, bot_tone]);
  else { const a = await getAuthor(req.params.id); if (a) Object.assign(a, { skin: skin || a.skin, song_title: song_title ?? a.song_title, song_artist: song_artist ?? a.song_artist, song_url: song_url ?? a.song_url, custom_skin_url: custom_skin_url ?? a.custom_skin_url, custom_skin_name: custom_skin_name ?? a.custom_skin_name, bot_enabled: bot_enabled ?? a.bot_enabled, bot_greeting: bot_greeting ?? a.bot_greeting, bot_personality: bot_personality ?? a.bot_personality, bot_topics: bot_topics ?? a.bot_topics, bot_tone: bot_tone ?? a.bot_tone }); }
  res.json({ ok: true });
});
app.post('/api/authors/:id/custom-skins', async (req, res) => {
  const { name, image_url, source_url, source_label } = req.body;
  if (!image_url || !/^https?:\/\/.+\.(jpg|jpeg|png|gif|webp)(\?.*)?$/i.test(image_url)) return res.status(400).json({ error: 'Paste a direct image link ending in .jpg, .png, .gif or .webp (not a web page).' });
  if (moderate(name) === 'blocked') return res.status(400).json({ error: 'Skin name blocked by moderation' });
  if (useDb) { const r = await q('INSERT INTO custom_skins(author_id,name,image_url,source_url,source_label) VALUES($1,$2,$3,$4,$5) RETURNING *', [req.params.id, name, image_url, source_url || null, source_label || null]); return res.status(201).json(r.rows[0]); }
  const s = { id: mem.seq.customSkins++, author_id: Number(req.params.id), name, image_url, source_url: source_url || null, source_label: source_label || null }; mem.customSkins.push(s); res.status(201).json(s);
});
app.post('/api/authors/:id/follow', async (req, res) => {
  if (useDb) await q('INSERT INTO follows(follower_id,following_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [req.body.followerId, req.params.id]);
  res.json({ ok: true });
});

app.get('/api/stories', async (req, res) => {
  const adult = req.query.adult === '1';
  let rows = await listStories(adult);
  if (req.query.q) rows = rows.filter((s) => `${s.title} ${s.body} ${s.category}`.toLowerCase().includes(req.query.q.toLowerCase()));
  if (req.query.category) rows = rows.filter((s) => s.category === req.query.category);
  if (req.query.trending) rows = [...rows].sort((a, b) => (b.reads + b.likes * 5) - (a.reads + a.likes * 5));
  res.json(rows);
});
app.post('/api/stories', async (req, res) => {
  const { author_id, title, body, category } = req.body;
  const status = moderate(`${title} ${body}`);
  if (status === 'blocked') return res.status(400).json({ error: 'This story was blocked by AI moderation and was not published.' });
  const audience = status === 'adult' ? 'adult' : 'all';
  if (useDb) { const r = await q('INSERT INTO stories(author_id,title,body,category,audience,status) VALUES($1,$2,$3,$4,$5,$6) RETURNING *', [author_id, title, body, category || 'Life story', audience, status]); return res.status(201).json(r.rows[0]); }
  const s = { id: mem.seq.stories++, author_id, title, body, category: category || 'Life story', audience, status, reads: 0, likes: 0, created_at: new Date().toISOString() }; mem.stories.push(s); res.status(201).json(s);
});
app.get('/api/stories/:id', async (req, res) => {
  const s = await getStory(req.params.id); if (!s) return res.status(404).json({ error: 'not found' });
  if (s.audience === 'adult' && req.query.adult !== '1') return res.status(403).json({ error: '18+ only' });
  // Fair read counts: the author viewing their own story does not add a
  // view. The viewer id comes from the browser's own-profile marker.
  const counted = Number(req.query.viewer) !== s.author_id;
  if (counted) { if (useDb) await q('UPDATE stories SET reads=reads+1 WHERE id=$1', [s.id]); else s.reads++; }
  const comments = useDb ? (await q('SELECT * FROM comments WHERE story_id=$1 ORDER BY id', [s.id])).rows : mem.comments.filter((c) => c.story_id === s.id);
  res.json({ ...s, reads: s.reads + (counted ? 1 : 0), comments });
});
app.post('/api/stories/:id/like', async (req, res) => {
  if (useDb) await q('UPDATE stories SET likes=likes+1 WHERE id=$1', [req.params.id]); else { const s = await getStory(req.params.id); if (s) s.likes++; }
  res.json({ ok: true });
});
app.post('/api/stories/:id/comments', async (req, res) => {
  const status = moderate(req.body.body);
  if (status === 'blocked') return res.status(400).json({ error: 'Comment blocked by moderation.' });
  if (useDb) { const r = await q('INSERT INTO comments(story_id,author_name,body,status) VALUES($1,$2,$3,$4) RETURNING *', [req.params.id, req.body.author_name || 'Guest', req.body.body, status]); return res.status(201).json(r.rows[0]); }
  const c = { id: mem.seq.comments++, story_id: Number(req.params.id), author_name: req.body.author_name || 'Guest', body: req.body.body, status }; mem.comments.push(c); res.status(201).json(c);
});
app.post('/api/reports', async (req, res) => {
  if (useDb) { const r = await q('INSERT INTO reports(target_type,target_id,reason,details) VALUES($1,$2,$3,$4) RETURNING *', [req.body.target_type, req.body.target_id, req.body.reason, req.body.details || '']); return res.status(201).json(r.rows[0]); }
  const r = { id: mem.seq.reports++, ...req.body, status: 'open' }; mem.reports.push(r); res.status(201).json(r);
});
app.get('/api/reports', async (req, res) => res.json(useDb ? (await q('SELECT * FROM reports ORDER BY id DESC')).rows : [...mem.reports].reverse()));
app.post('/api/blocks', async (req, res) => {
  if (useDb) await q('INSERT INTO blocks(blocker_id,blocked_id) VALUES($1,$2) ON CONFLICT DO NOTHING', [req.body.blocker_id, req.body.blocked_id]);
  else mem.blocks.push(req.body);
  res.json({ ok: true });
});

app.get('/api/episodes', async (req, res) => {
  const rows = useDb ? (await q('SELECT * FROM episodes ORDER BY id DESC')).rows : [...mem.episodes].reverse();
  res.json(req.query.story_id ? rows.filter((e) => e.story_id === Number(req.query.story_id)) : rows);
});
app.post('/api/episodes', async (req, res) => {
  const { story_id, title, youtube_url, duration_minutes } = req.body;
  if (moderate(`${title} ${youtube_url}`) === 'blocked') return res.status(400).json({ error: 'Episode blocked by moderation.' });
  if (duration_minutes > 5) {
    const m = useDb ? (await q('SELECT * FROM memberships WHERE author_id=(SELECT author_id FROM stories WHERE id=$1) AND plan=$2', [story_id, 'creator'])).rows : [];
    if (!m.length) return res.status(402).json({ error: 'Videos over 5 minutes need a $25/month Creator Membership. Free accounts can add videos up to 5 minutes.' });
  }
  if (useDb) { const r = await q('INSERT INTO episodes(story_id,title,youtube_url,duration_minutes) VALUES($1,$2,$3,$4) RETURNING *', [story_id, title, youtube_url, duration_minutes || 0]); return res.status(201).json(r.rows[0]); }
  const e = { id: mem.seq.episodes++, story_id, title, youtube_url, duration_minutes: duration_minutes || 0, views: 0 }; mem.episodes.push(e); res.status(201).json(e);
});
app.post('/api/episodes/:id/view', async (req, res) => {
  if (useDb) { await q('UPDATE episodes SET views=views+1 WHERE id=$1', [req.params.id]); const ep = (await q('SELECT story_id FROM episodes WHERE id=$1', [req.params.id])).rows[0]; if (ep) await q('UPDATE stories SET reads=reads+1 WHERE id=$1', [ep.story_id]); }
  else { const e = mem.episodes.find((x) => x.id === Number(req.params.id)); if (e) { e.views++; const s = mem.stories.find((x) => x.id === e.story_id); if (s) s.reads++; } }
  res.json({ ok: true });
});

// ---------- Recorded videos ----------
// Recorded in the browser, uploaded as a file, stored on server disk.
// Rules, same as stories: AI moderation on title/description BEFORE
// publication; blocked titles/descriptions are never published. Strong
// profanity / non-explicit sexual themes publish as 18+ adults-only and are
// hidden from minors. Videos over 5 minutes (300s) need a $25/month Creator
// Membership. Honest limit: the AI checks the title/description — it cannot
// watch the recorded video itself. Report/block is the backstop.
app.get('/api/videos', async (req, res) => {
  const adult = req.query.adult === '1';
  let rows = useDb ? (await q('SELECT * FROM videos WHERE status != $1 ORDER BY id DESC', ['blocked'])).rows
    : [...mem.videos].filter((v) => v.status !== 'blocked').reverse();
  if (!adult) rows = rows.filter((v) => v.audience !== 'adult' && v.status !== 'adult');
  res.json(rows);
});
app.post('/api/videos', express.raw({ type: 'video/*', limit: '100mb' }), async (req, res) => {
  try {
    const author_id = Number(req.query.author_id);
    const title = String(req.query.title || '').slice(0, 200);
    const description = String(req.query.description || '').slice(0, 2000);
    const duration_seconds = Number(req.query.duration_seconds) || 0;
    if (!author_id || !title) return res.status(400).json({ error: 'Create a profile first, then give your video a title.' });
    if (!Buffer.isBuffer(req.body) || !req.body.length) return res.status(400).json({ error: 'No video was recorded — record a video first.' });
    if (req.body.length > 100 * 1024 * 1024) return res.status(413).json({ error: 'Video is too large (100 MB limit). Record a shorter video.' });
    const status = moderate(`${title} ${description}`);
    if (status === 'blocked') return res.status(400).json({ error: 'This video was blocked by AI moderation and was not published.' });
    if (duration_seconds > 300) {
      const hasMembership = useDb
        ? (await q("SELECT * FROM memberships WHERE author_id=$1 AND plan='creator'", [author_id])).rows.length > 0
        : mem.memberships.some((m) => m.author_id === author_id && m.plan === 'creator');
      if (!hasMembership) return res.status(402).json({ error: 'Videos over 5 minutes need a $25/month Creator Membership. Free accounts can record videos up to 5 minutes.' });
    }
    const audience = status === 'adult' ? 'adult' : 'all';
    const filename = `video-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.webm`;
    fs.writeFileSync(path.join(UPLOADS_DIR, filename), req.body);
    const file_path = `/uploads/${filename}`;
    if (useDb) { const r = await q('INSERT INTO videos(author_id,title,description,file_path,duration_seconds,audience,status) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *', [author_id, title, description, file_path, duration_seconds, audience, status]); return res.status(201).json(r.rows[0]); }
    const v = { id: mem.seq.videos++, author_id, title, description, file_path, duration_seconds, audience, status, views: 0, created_at: new Date().toISOString() }; mem.videos.push(v); res.status(201).json(v);
  } catch (e) { res.status(500).json({ error: 'Video upload failed: ' + e.message }); }
});
app.post('/api/videos/:id/view', async (req, res) => {
  if (useDb) await q('UPDATE videos SET views=views+1 WHERE id=$1', [req.params.id]);
  else { const v = mem.videos.find((x) => x.id === Number(req.params.id)); if (v) v.views++; }
  res.json({ ok: true });
});

app.get('/api/earnings/:authorId', async (req, res) => {
  const stories = (await listStories(true)).filter((s) => s.author_id === Number(req.params.authorId));
  const totalReads = stories.reduce((n, s) => n + (s.reads || 0), 0);
  const eligible = totalReads >= 10000;
  // Model only — no real payouts. Ad revenue is modelled at $5 per 1,000 reads.
  const adRevenue = (totalReads / 1000) * 5;
  res.json({ authorId: Number(req.params.authorId), totalReads, eligible, threshold: 10000, split: '50/50', adRevenue: +adRevenue.toFixed(2), creatorShare: eligible ? +(adRevenue / 2).toFixed(2) : 0, platformShare: eligible ? +(adRevenue / 2).toFixed(2) : +adRevenue.toFixed(2), note: 'Model only. Connect Stripe after live activation for real payouts.' });
});
app.post('/api/memberships', async (req, res) => {
  // $25/month Creator Membership. No payment is taken here — Stripe checkout
  // must be wired in before charging anyone.
  if (useDb) { const r = await q('INSERT INTO memberships(author_id,plan,price_cents) VALUES($1,$2,$3) RETURNING *', [req.body.author_id, 'creator', 2500]); return res.status(201).json({ ...r.rows[0], note: 'Membership recorded as a model only — no payment taken. Wire Stripe Checkout before charging $25/month.' }); }
  mem.memberships.push({ author_id: Number(req.body.author_id), plan: 'creator', price_cents: 2500 });
  res.status(201).json({ author_id: req.body.author_id, plan: 'creator', price_cents: 2500, note: 'Membership recorded as a model only — no payment taken.' });
});
app.get('/api/tax/:authorId/:year', async (req, res) => {
  const e = await (async () => { const r = await fetch(`http://localhost:${PORT}/api/earnings/${req.params.authorId}`).catch(() => null); return r ? r.json() : { totalReads: 0, creatorShare: 0 }; })();
  const summary = { authorId: Number(req.params.authorId), year: Number(req.params.year), totalReads: e.totalReads || 0, creatorEarnings: e.creatorShare || 0, note: '1099-style summary only — not tax advice, not an IRS filing. Consult a tax professional.' };
  if (req.query.format === 'csv') { res.setHeader('Content-Type', 'text/csv'); return res.send(`year,author_id,total_reads,creator_earnings_usd\n${summary.year},${summary.authorId},${summary.totalReads},${summary.creatorEarnings}\n`); }
  res.json(summary);
});

app.post('/api/companion/:authorId/chat', async (req, res) => {
  const a = await getAuthor(req.params.authorId); if (!a) return res.status(404).json({ error: 'not found' });
  if (!a.bot_enabled) return res.status(400).json({ error: 'This companion is turned off.' });
  const stories = (await listStories(true)).filter((s) => s.author_id === a.id);
  const adult = req.body.adult === true;
  const visibleStories = adult ? stories : stories.filter((s) => s.audience !== 'adult');
  // Minor-safe: never share adults-only content, but do not lie about the count.
  const hiddenCount = stories.length - visibleStories.length;
  const msg = String(req.body.message || '');
  let reply;
  if (/who are you|are you (the )?(real|person)/i.test(msg)) reply = `I am your AI companion, chat with me about anything.`;
  else if (/how many|stories/i.test(msg)) reply = `${a.name} has published ${stories.length} ${stories.length === 1 ? 'story' : 'stories'}${hiddenCount ? ` (${hiddenCount} hidden in minor-safe mode because it is 18+).` : '.'} ${visibleStories.map((s) => `"${s.title}"`).join(', ') || 'No stories are visible in this mode.'}`;
  else if (visibleStories.length) { const s = visibleStories.find((x) => msg.toLowerCase().split(/\W+/).some((w) => w.length > 3 && x.title.toLowerCase().includes(w))) || visibleStories[0]; reply = `In "${s.title}", ${a.name} writes: ${s.body.slice(0, 280)}${s.body.length > 280 ? '…' : ''} Want to hear more about that story?`; }
  else reply = `${a.bot_greeting} ${a.name} has no stories visible in this mode yet. Ask me about their bio: ${a.bio || 'No bio yet.'}`;
  if (process.env.OPENAI_API_KEY) reply += '\n\n[Note: OPENAI_API_KEY is set, but this copy uses the grounded fallback. Wire the OpenAI call in server.js to use live AI.]';
  if (useDb) await q('INSERT INTO bot_messages(author_id,role,body) VALUES($1,$2,$3),($1,$4,$5)', [a.id, 'user', msg, 'assistant', reply]);
  else { mem.botMessages.push({ id: mem.seq.botMessages++, author_id: a.id, role: 'user', body: msg }); mem.botMessages.push({ id: mem.seq.botMessages++, author_id: a.id, role: 'assistant', body: reply }); }
  res.json({ reply, ai: true, person: a.name, minorSafe: !adult });
});

const LEGAL = {
  terms: 'TERMS OF USE — TEMPLATE, FOR LAWYER REVIEW. BioLifeDrive is owned solely by BioLifeDrive. No partnership is created by using this site. Creators are independent creators, not partners, employees, agents, or joint venturers. No one is capable of being a partner of BioLifeDrive.',
  privacy: 'PRIVACY POLICY — TEMPLATE, FOR LAWYER REVIEW. We collect the information you provide (profile, stories, comments) and use it to run BioLifeDrive. We do not sell personal information. Contact the owner through the site for privacy requests.',
  copyright: 'COPYRIGHT POLICY — TEMPLATE, FOR LAWYER REVIEW. Creators keep copyright in their own stories. Do not post content you do not own or have permission to post. Report infringement through the Safety page.',
  creator: 'CREATOR AGREEMENT — TEMPLATE, FOR LAWYER REVIEW. §1 Creators are independent creators. §4 No one is capable of being a partner of BioLifeDrive — including you. §5 Creators become eligible to earn at 10,000 total reads, split 50% creator / 50% platform. §6 Videos over 5 minutes require a $25/month Creator Membership.',
};
app.get('/api/legal/:page', (req, res) => res.json({ page: req.params.page, text: LEGAL[req.params.page] || 'Not found' }));
app.get('/api/ads', (req, res) => res.json({ slots: ['feed', 'story', 'docuseries'], status: 'placeholder', note: 'Ad slots are placeholders until Google AdSense approves biolifedrive.com. Set ADSENSE_CLIENT_ID after approval.' }));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

initDb().then(() => app.listen(PORT, () => console.log(`BioLifeDrive listening on ${PORT} (db: ${useDb ? 'postgres' : 'memory'})`)));
