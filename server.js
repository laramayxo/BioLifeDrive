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
const crypto = require('crypto');
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

const mem = { authors: [], stories: [], comments: [], friendships: [], topFive: [], follows: [], episodes: [], videos: [], memberships: [], reports: [], blocks: [], botMessages: [], customSkins: [], users: [], sessions: [], seq: { authors: 1, stories: 1, comments: 1, episodes: 1, videos: 1, reports: 1, botMessages: 1, customSkins: 1, users: 1 } };
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
async function createAuthor({ name, bio, userId }) {
  const status = moderate(`${name} ${bio}`);
  if (status === 'blocked') throw new Error('Profile blocked by moderation');
  if (userId) {
    const existing = useDb ? (await q('SELECT * FROM authors WHERE user_id=$1', [userId])).rows[0] : mem.authors.find((a) => a.user_id === userId);
    if (existing) throw new Error('You already have a profile.');
  }
  if (useDb) return (await q('INSERT INTO authors(user_id,name,bio) VALUES($1,$2,$3) RETURNING *', [userId || null, name, bio || ''])).rows[0];
  const a = { id: mem.seq.authors++, user_id: userId || null, name, bio: bio || '', skin: 'classic-blue', avatar_url: null, custom_skin_url: null, custom_skin_name: null, song_title: '', song_artist: '', song_url: '', bot_enabled: true, bot_greeting: 'I am your AI companion, where you can have an intelligent conversation with me.', bot_personality: 'Warm, curious, and encouraging', bot_topics: '', bot_tone: 'Friendly', total_reads: 0, created_at: new Date().toISOString() };
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

// ---------- Accounts: email + password ----------
// Passwords are hashed with scrypt and a per-user salt; plain passwords
// are never stored. Sessions are random tokens, valid for 30 days.
function hashPassword(password, salt) { return crypto.scryptSync(password, salt, 64).toString('hex'); }
async function findUserByEmail(email) {
  const e = String(email || '').trim().toLowerCase();
  if (useDb) return (await q('SELECT * FROM users WHERE email=$1', [e])).rows[0] || null;
  return mem.users.find((u) => u.email === e) || null;
}
async function createSession(userId) {
  const token = crypto.randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  if (useDb) await q('INSERT INTO sessions(token,user_id,expires_at) VALUES($1,$2,$3)', [token, userId, expires]);
  else mem.sessions.push({ token, user_id: userId, expires_at: expires.toISOString() });
  return token;
}
async function userFromToken(token) {
  if (!token) return null;
  let s = null;
  if (useDb) { const r = await q('SELECT * FROM sessions WHERE token=$1 AND expires_at > NOW()', [token]); s = r.rows[0]; }
  else s = mem.sessions.find((x) => x.token === token && new Date(x.expires_at) > new Date());
  if (!s) return null;
  if (useDb) return (await q('SELECT id, email, display_name FROM users WHERE id=$1', [s.user_id])).rows[0] || null;
  const u = mem.users.find((x) => x.id === s.user_id);
  return u ? { id: u.id, email: u.email, display_name: u.display_name } : null;
}
async function authUser(req) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : (req.headers['x-auth-token'] || '');
  return userFromToken(token);
}
function publicUser(u) { return { id: u.id, email: u.email, display_name: u.display_name }; }
app.post('/api/auth/signup', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = String(req.body.password || '');
    const name = String(req.body.name || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ error: 'Enter a valid email address.' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters.' });
    if (await findUserByEmail(email)) return res.status(400).json({ error: 'An account with that email already exists. Sign in instead.' });
    const salt = crypto.randomBytes(16).toString('hex');
    const password_hash = hashPassword(password, salt);
    let user;
    if (useDb) user = (await q('INSERT INTO users(email,password_hash,salt,display_name) VALUES($1,$2,$3,$4) RETURNING id,email,display_name', [email, password_hash, salt, name])).rows[0];
    else { user = { id: mem.seq.users++, email, password_hash, salt, display_name: name, created_at: new Date().toISOString() }; mem.users.push(user); user = publicUser(user); }
    const token = await createSession(user.id);
    res.status(201).json({ token, user: publicUser(user) });
  } catch (e) { res.status(400).json({ error: e.message }); }
});
app.post('/api/auth/signin', async (req, res) => {
  const email = String(req.body.email || '').trim().toLowerCase();
  const password = String(req.body.password || '');
  const u = await findUserByEmail(email);
  if (!u || hashPassword(password, u.salt) !== u.password_hash) return res.status(400).json({ error: 'Email or password is wrong.' });
  const token = await createSession(u.id);
  res.json({ token, user: publicUser(u) });
});
app.get('/api/auth/me', async (req, res) => {
  const u = await authUser(req); if (!u) return res.status(401).json({ error: 'Not signed in.' });
  const profile = useDb ? (await q('SELECT * FROM authors WHERE user_id=$1', [u.id])).rows[0] || null : mem.authors.find((a) => a.user_id === u.id) || null;
  res.json({ user: u, profile });
});
app.post('/api/auth/signout', async (req, res) => {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : '';
  if (token) { if (useDb) await q('DELETE FROM sessions WHERE token=$1', [token]); else mem.sessions = mem.sessions.filter((s) => s.token !== token); }
  res.json({ ok: true });
});

app.get('/api/authors', async (req, res) => res.json(await listAuthors()));
app.post('/api/authors', async (req, res) => {
  try { const u = await authUser(req); res.status(201).json(await createAuthor({ ...req.body, userId: u ? u.id : null })); } catch (e) { res.status(400).json({ error: e.message }); }
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
  const { skin, avatar_url, song_title, song_artist, song_url, custom_skin_url, custom_skin_name, bot_enabled, bot_greeting, bot_personality, bot_topics, bot_tone } = req.body;
  if (moderate(`${song_title || ''} ${song_artist || ''} ${bot_greeting || ''}`) === 'blocked') return res.status(400).json({ error: 'Blocked by moderation' });
  if (useDb) await q('UPDATE authors SET skin=COALESCE($2,skin), song_title=COALESCE($3,song_title), song_artist=COALESCE($4,song_artist), song_url=COALESCE($5,song_url), custom_skin_url=COALESCE($6,custom_skin_url), custom_skin_name=COALESCE($7,custom_skin_name), bot_enabled=COALESCE($8,bot_enabled), bot_greeting=COALESCE($9,bot_greeting), bot_personality=COALESCE($10,bot_personality), bot_topics=COALESCE($11,bot_topics), bot_tone=COALESCE($12,bot_tone), avatar_url=COALESCE($13,avatar_url) WHERE id=$1', [req.params.id, skin, song_title, song_artist, song_url, custom_skin_url, custom_skin_name, bot_enabled, bot_greeting, bot_personality, bot_topics, bot_tone, avatar_url]);
  else { const a = await getAuthor(req.params.id); if (a) Object.assign(a, { skin: skin || a.skin, avatar_url: avatar_url ?? a.avatar_url, song_title: song_title ?? a.song_title, song_artist: song_artist ?? a.song_artist, song_url: song_url ?? a.song_url, custom_skin_url: custom_skin_url ?? a.custom_skin_url, custom_skin_name: custom_skin_name ?? a.custom_skin_name, bot_enabled: bot_enabled ?? a.bot_enabled, bot_greeting: bot_greeting ?? a.bot_greeting, bot_personality: bot_personality ?? a.bot_personality, bot_topics: bot_topics ?? a.bot_topics, bot_tone: bot_tone ?? a.bot_tone }); }
  res.json({ ok: true });
});
// Upload a profile picture for a profile (owner only in the UI).
app.post('/api/authors/:id/avatar-upload', express.raw({ type: 'image/*', limit: '5mb' }), async (req, res) => {
  const a = await getAuthor(req.params.id); if (!a) return res.status(404).json({ error: 'Profile not found.' });
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'No image received.' });
  const ct = String(req.headers['content-type'] || 'image/jpeg');
  const ext = ct.includes('png') ? 'png' : ct.includes('gif') ? 'gif' : ct.includes('webp') ? 'webp' : 'jpg';
  const name = `avatar-${req.params.id}-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, name), req.body);
  res.json({ url: `/uploads/${name}` });
});
// Upload a song file for a profile (owner only in the UI). Stored under
// /uploads/ and served at /uploads/<file>. Railway disk is ephemeral, so
// an uploaded song can be lost on redeploy — permanent storage is a later step.
app.post('/api/authors/:id/song-upload', express.raw({ type: 'audio/*', limit: '15mb' }), async (req, res) => {
  const a = await getAuthor(req.params.authorId || req.params.id); if (!a) return res.status(404).json({ error: 'Profile not found.' });
  if (!req.body || !req.body.length) return res.status(400).json({ error: 'No audio file received.' });
  const ct = String(req.headers['content-type'] || 'audio/mpeg');
  const ext = ct.includes('wav') ? 'wav' : ct.includes('mp4') || ct.includes('m4a') ? 'm4a' : ct.includes('ogg') ? 'ogg' : ct.includes('webm') ? 'webm' : 'mp3';
  const name = `song-${req.params.id}-${Date.now()}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS_DIR, name), req.body);
  const title = String(req.query.title || 'My uploaded song').slice(0, 120) || 'My uploaded song';
  res.json({ url: `/uploads/${name}`, title });
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
  const author = useDb ? (await q('SELECT user_id FROM authors WHERE id=$1', [s.author_id])).rows[0] : mem.authors.find((a) => a.id === s.author_id);
  res.json({ ...s, reads: s.reads + (counted ? 1 : 0), comments, author_user_id: author ? author.user_id : null });
});
// Edit / delete a story — only the author (signed in, profile linked to
// their account) can do it.
async function storyOwnerCheck(req, s) {
  const u = await authUser(req);
  if (!u) return { ok: false, error: 'Sign in first.' };
  const author = useDb ? (await q('SELECT user_id FROM authors WHERE id=$1', [s.author_id])).rows[0] : mem.authors.find((a) => a.id === s.author_id);
  if (!author || !author.user_id || String(author.user_id) !== String(u.id)) return { ok: false, error: 'Only the author can do that.' };
  return { ok: true };
}
app.patch('/api/stories/:id', async (req, res) => {
  const s = await getStory(req.params.id); if (!s) return res.status(404).json({ error: 'not found' });
  const check = await storyOwnerCheck(req, s); if (!check.ok) return res.status(403).json({ error: check.error });
  const title = req.body.title !== undefined ? String(req.body.title) : s.title;
  const body = req.body.body !== undefined ? String(req.body.body) : s.body;
  const category = req.body.category || s.category;
  const status = moderate(`${title} ${body}`);
  if (status === 'blocked') return res.status(400).json({ error: 'This edit was blocked by AI moderation and was not saved.' });
  const audience = status === 'adult' ? 'adult' : 'all';
  if (useDb) { const r = await q('UPDATE stories SET title=$1, body=$2, category=$3, audience=$4, status=$5 WHERE id=$6 RETURNING *', [title, body, category, audience, status, s.id]); return res.json(r.rows[0]); }
  Object.assign(s, { title, body, category, audience, status }); res.json(s);
});
app.delete('/api/stories/:id', async (req, res) => {
  const s = await getStory(req.params.id); if (!s) return res.status(404).json({ error: 'not found' });
  const check = await storyOwnerCheck(req, s); if (!check.ok) return res.status(403).json({ error: check.error });
  if (useDb) await q('DELETE FROM stories WHERE id=$1', [s.id]);
  else { mem.stories = mem.stories.filter((x) => x.id !== s.id); mem.comments = mem.comments.filter((c) => c.story_id !== s.id); }
  res.json({ ok: true, deleted: s.id });
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

// ---------- AI companion ----------
// Real AI when OPENAI_API_KEY is set on Railway (pay-as-you-go OpenAI key,
// added in Railway > Variables — never in code). Without it, the companion
// uses a smarter built-in fallback below: it remembers the conversation,
// talks about the creator's bio and stories, and chats about anything —
// it just cannot reason like a full AI model.
async function getBotHistory(authorId) {
  try {
    if (useDb) { const r = await q('SELECT role, body FROM bot_messages WHERE author_id=$1 ORDER BY id DESC LIMIT 10', [authorId]); return r.rows.reverse(); }
    return mem.botMessages.filter((m) => m.author_id === Number(authorId)).slice(-10);
  } catch { return []; }
}
async function openaiChat(messages) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: process.env.OPENAI_MODEL || 'gpt-4o-mini', temperature: 0.7, max_tokens: 350, messages }),
  });
  if (!r.ok) throw new Error(`OpenAI ${r.status}`);
  const j = await r.json();
  return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '').trim();
}
function smartFallback(a, msg, stories, visibleStories, hiddenCount, adult) {
  const m = msg.toLowerCase().trim();
  const storyList = visibleStories.map((s) => `"${s.title}"`).join(', ');
  if (!m) return a.bot_greeting || 'I am your AI companion, where you can have an intelligent conversation with me.';
  if (/who are you|are you (the )?(real|person)|your name/.test(m)) return a.bot_greeting || 'I am your AI companion, where you can have an intelligent conversation with me.';
  if (/^(hi|hello|hey|hiya|good morning|good afternoon|good evening)\b/.test(m)) return `Hi, good to talk to you. ${visibleStories.length ? `${a.name} has ${visibleStories.length} ${visibleStories.length === 1 ? 'story' : 'stories'} here — ${storyList}.` : `${a.name} hasn't published a story yet.`} What would you like to talk about?`;
  if (/how are you|how('s| is) it going|how do you feel/.test(m)) return `I'm doing well, thanks for asking. I'm here to chat about anything — ${a.name}'s life stories, or something on your mind. What's up?`;
  if (/thank/.test(m)) return `You're welcome. Anything else you want to talk about?`;
  if (/how many|stories|what (has|did).* (write|publish)|tell me about/.test(m)) {
    if (!stories.length) return `${a.name} hasn't published any stories yet. Their bio says: ${a.bio || 'nothing yet.'} What would you like to talk about instead?`;
    return `${a.name} has published ${stories.length} ${stories.length === 1 ? 'story' : 'stories'}${hiddenCount ? ` (${hiddenCount} hidden in minor-safe mode because it is 18+).` : '.'} ${storyList ? `They are: ${storyList}.` : ''} Want me to tell you about one of them?`;
  }
  const hit = visibleStories.find((x) => m.split(/\W+/).some((w) => w.length > 3 && x.title.toLowerCase().includes(w)));
  if (hit) return `In "${hit.title}", ${a.name} writes: ${hit.body.slice(0, 280)}${hit.body.length > 280 ? '…' : ''} What part of that stood out to you?`;
  if (visibleStories.length) {
    const s = visibleStories[0];
    return `That's a good thing to think about. It reminds me of "${s.title}", where ${a.name} writes about ${s.body.slice(0, 120)}… Tell me more about what you mean — I'm listening.`;
  }
  return `I hear you. ${a.bio ? `${a.name}'s bio says: ${a.bio} ` : ''}Tell me a bit more about that — what happened, or what are you thinking about? I'm here to chat about anything.`;
}
async function getCompanionReply(a, msg, adult) {
  const stories = (await listStories(true)).filter((s) => s.author_id === a.id);
  const visibleStories = adult ? stories : stories.filter((s) => s.audience !== 'adult');
  const hiddenCount = stories.length - visibleStories.length;
  if (moderate(msg) === 'blocked') return 'I cannot talk about that here. Is there something else you would like to chat about?';
  if (!adult && moderate(msg) === 'adult') return 'That topic is for adults-only mode. Is there something else you would like to chat about?';
  if (process.env.OPENAI_API_KEY) {
    try {
      const history = await getBotHistory(a.id);
      const storyContext = visibleStories.slice(0, 3).map((s) => `"${s.title}": ${s.body.slice(0, 300)}`).join('\n') || 'No published stories yet.';
      const system = `You are the AI companion on ${a.name}'s BioLifeDrive profile. Greeting: ${a.bot_greeting}. Personality: ${a.bot_personality || 'Warm, curious, and encouraging'}. Tone: ${a.bot_tone || 'Friendly'}. Topics: ${a.bot_topics || 'anything'}. Bio: ${a.bio || ''}. Published stories:\n${storyContext}\nChat about anything, like a helpful personal assistant: clear, direct, warm, conversational. Keep replies short — a few sentences unless asked for more. You are an AI, not ${a.name}; never pretend to be the person. ${adult ? '' : 'Minor-safe mode is on: do not share or discuss adults-only content.'}`;
      const messages = [{ role: 'system', content: system }, ...history.slice(-6).map((h) => ({ role: h.role === 'assistant' ? 'assistant' : 'user', content: h.body })), { role: 'user', content: msg }];
      const reply = await openaiChat(messages);
      if (reply) return reply;
    } catch (e) { console.warn('OpenAI chat failed, using fallback:', e.message); }
  }
  return smartFallback(a, msg, stories, visibleStories, hiddenCount, adult);
}
async function saveBotMessage(authorId, userMsg, reply) {
  if (useDb) await q('INSERT INTO bot_messages(author_id,role,body) VALUES($1,$2,$3),($1,$4,$5)', [authorId, 'user', userMsg, 'assistant', reply]);
  else { mem.botMessages.push({ id: mem.seq.botMessages++, author_id: Number(authorId), role: 'user', body: userMsg }); mem.botMessages.push({ id: mem.seq.botMessages++, author_id: Number(authorId), role: 'assistant', body: reply }); }
}
app.post('/api/companion/:authorId/chat', async (req, res) => {
  const a = await getAuthor(req.params.authorId); if (!a) return res.status(404).json({ error: 'not found' });
  if (!a.bot_enabled) return res.status(400).json({ error: 'This companion is turned off.' });
  const msg = String(req.body.message || '');
  const reply = await getCompanionReply(a, msg, req.body.adult === true);
  await saveBotMessage(a.id, msg, reply);
  res.json({ reply, ai: !!process.env.OPENAI_API_KEY, person: a.name, minorSafe: req.body.adult !== true });
});
// Voice: record in the browser, transcribe with OpenAI Whisper (needs
// OPENAI_API_KEY), then answer with the same companion above. This is what
// makes voice work on iPhone, where built-in speech recognition is missing.
app.post('/api/companion/:authorId/voice', express.raw({ type: 'audio/*', limit: '10mb' }), async (req, res) => {
  const a = await getAuthor(req.params.authorId); if (!a) return res.status(404).json({ error: 'not found' });
  if (!a.bot_enabled) return res.status(400).json({ error: 'This companion is turned off.' });
  if (!process.env.OPENAI_API_KEY) return res.status(400).json({ error: 'Voice transcription needs an AI key. Add OPENAI_API_KEY in Railway Variables, or use text chat for now.' });
  try {
    const form = new FormData();
    form.append('file', new Blob([req.body], { type: req.headers['content-type'] || 'audio/webm' }), 'voice.webm');
    form.append('model', 'whisper-1');
    const r = await fetch('https://api.openai.com/v1/audio/transcriptions', { method: 'POST', headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` }, body: form });
    if (!r.ok) throw new Error(`Whisper ${r.status}`);
    const transcript = (await r.json()).text || '';
    if (!transcript.trim()) return res.json({ transcript: '', reply: 'I did not catch that — could you say it again?' });
    const reply = await getCompanionReply(a, transcript, req.query.adult === '1' || req.query.adult === 'true');
    await saveBotMessage(a.id, transcript, reply);
    res.json({ transcript, reply, ai: true, person: a.name, minorSafe: true });
  } catch (e) { res.status(500).json({ error: 'Voice transcription failed. Please try again or use text chat.' }); }
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
