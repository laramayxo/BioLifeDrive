// BioLifeDrive standalone UI — talks to /api/*
// Adult mode is off by default (minor-safe). 18+ content is hidden unless
// the visitor confirms they are 18+.
let adult = false, me = null, skins = {};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
async function api(path, opts) { const r = await fetch(path, { headers: { 'Content-Type': 'application/json' }, ...opts }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { error: t }; } if (!r.ok) throw new Error(j.error || r.statusText); return j; }

document.querySelectorAll('[data-nav]').forEach((b) => b.onclick = () => {
  document.querySelectorAll('[data-nav]').forEach((x) => x.classList.remove('active')); b.classList.add('active');
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  $('view-' + b.dataset.nav).classList.remove('hidden');
  if (b.dataset.nav === 'record-video') loadVideos();
});

// ---------- Record Video: in-browser camera + mic ----------
// MediaRecorder records locally in the browser. Nothing is uploaded until
// the creator taps Publish — then the title/description go through the same
// AI moderation as stories, and the 5-minute / $25 membership rule applies.
let camStream = null, recorder = null, recChunks = [], recBlob = null, recSeconds = 0, recTimerId = null;
function fmtTime(s) { return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
$('cameraBtn').onclick = async () => {
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
    const pv = $('camPreview'); pv.srcObject = camStream; pv.style.display = 'block';
    $('recBtn').disabled = false; $('videoMsg').textContent = 'Camera on — tap Start recording when you are ready.';
  } catch (e) { $('videoMsg').textContent = 'Camera/microphone access was blocked. Allow camera and microphone in your browser to record.'; }
};
$('recBtn').onclick = () => {
  if (!camStream) return;
  recChunks = []; recSeconds = 0; recBlob = null; $('videoPreview').style.display = 'none'; $('publishVideoBtn').disabled = true;
  recorder = new MediaRecorder(camStream, { mimeType: MediaRecorder.isTypeSupported('video/webm') ? 'video/webm' : undefined });
  recorder.ondataavailable = (e) => { if (e.data.size) recChunks.push(e.data); };
  recorder.onstop = () => {
    recBlob = new Blob(recChunks, { type: 'video/webm' });
    const pv = $('videoPreview'); pv.src = URL.createObjectURL(recBlob); pv.style.display = 'block';
    $('publishVideoBtn').disabled = false;
    $('videoMsg').textContent = `Recorded ${fmtTime(recSeconds)} — watch it back, then tap Publish video.`;
  };
  recorder.start(250); $('recBtn').disabled = true; $('stopBtn').disabled = false;
  recTimerId = setInterval(() => { recSeconds++; $('recTimer').textContent = fmtTime(recSeconds); if (recSeconds === 300) $('videoMsg').textContent = '5 minutes reached — videos over 5 minutes need a $25/month Creator Membership.'; }, 1000);
};
$('stopBtn').onclick = () => { if (recorder && recorder.state !== 'inactive') recorder.stop(); clearInterval(recTimerId); $('recBtn').disabled = false; $('stopBtn').disabled = true; };
$('publishVideoBtn').onclick = async () => {
  if (!recBlob) return;
  const authorId = Number($('videoAuthor').value);
  if (!authorId) { $('videoMsg').textContent = 'Enter your Profile ID first — create a profile on the Create Profile tab if you have not yet.'; return; }
  $('videoMsg').textContent = 'Publishing — AI is checking your title and description…';
  try {
    const url = `/api/videos?author_id=${authorId}&title=${encodeURIComponent($('videoTitle').value)}&description=${encodeURIComponent($('videoDesc').value)}&duration_seconds=${recSeconds}`;
    const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'video/webm' }, body: recBlob });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || r.statusText);
    $('videoMsg').textContent = j.audience === 'adult' ? 'Published as 18+ adults-only.' : 'Video published!';
    if (camStream) camStream.getTracks().forEach((t) => t.stop());
    loadVideos();
  } catch (e) { $('videoMsg').textContent = e.message; }
};
async function loadVideos() {
  const list = await api(`/api/videos?adult=${adult ? 1 : 0}`);
  $('videos').innerHTML = list.map((v) => `<div class="card"><b>${esc(v.title)}</b> — ${fmtTime(v.duration_seconds || 0)} · 👁 ${v.views} ${v.audience === 'adult' ? '· 18+' : ''}<br><video controls preload="metadata" src="${esc(v.file_path)}" style="width:100%;max-width:560px"></video><br><button onclick="viewVideo(${v.id})">Mark viewed</button> <button onclick="report('video',${v.id})">🚩 Report</button></div>`).join('') || '<p>No recorded videos yet — be the first to record one.</p>';
}
async function viewVideo(id) { await api(`/api/videos/${id}/view`, { method: 'POST' }); loadVideos(); }
$('adultMode').onchange = (e) => { adult = e.target.checked; $('modeNote').textContent = adult ? 'Adult mode on — 18+ content visible' : 'Minor-safe browsing on'; loadStories(); loadAuthors(); loadVideos(); };
document.querySelectorAll('[data-legal]').forEach((b) => b.onclick = async () => { const d = await api('/api/legal/' + b.dataset.legal); $('legalOut').textContent = d.text; });

async function loadStories() {
  const q = $('search').value, cat = $('category').value;
  const list = await api(`/api/stories?adult=${adult ? 1 : 0}&q=${encodeURIComponent(q)}&category=${encodeURIComponent(cat)}`);
  $('stories').innerHTML = list.map((s) => `<div class="card" onclick="openStory(${s.id})" style="cursor:pointer"><h3>${esc(s.title)}</h3><p>${esc(s.body.slice(0, 300))}</p><p>👁 ${s.reads} · ❤️ ${s.likes} · ${esc(s.category)} ${s.audience === 'adult' ? '· 18+' : ''}</p><button onclick="event.stopPropagation();openStory(${s.id})">Read</button> <button onclick="event.stopPropagation();likeStory(${s.id})">Like</button> <button onclick="event.stopPropagation();report('story',${s.id})">🚩 Report</button></div>`).join('') || '<p>No stories yet — publish the first one.</p>';
}
async function openStory(id) {
  const s = await api(`/api/stories/${id}?adult=${adult ? 1 : 0}`);
  $('storyDetail').innerHTML = `<div class="card"><button onclick="$('storyDetail').innerHTML='';loadStories()">← Back to all stories</button>
    <h3>${esc(s.title)}</h3><p>${esc(s.body)}</p>
    <p>👁 ${s.reads} · ❤️ ${s.likes} · ${esc(s.category)} ${s.audience === 'adult' ? '· 18+' : ''}</p>
    <button onclick="likeStory(${s.id})">❤️ Like</button> <button onclick="report('story',${s.id})">🚩 Report</button>
    <h4>Comments</h4><div>${(s.comments || []).map((c) => `<p><b>${esc(c.author_name)}</b>: ${esc(c.body)}</p>`).join('') || '<p>No comments yet.</p>'}</div>
    <input id="commentName" placeholder="Your name"><input id="commentBody" placeholder="Write a comment…"><button onclick="addComment(${s.id})">Post comment</button><p id="commentMsg"></p></div>`;
  $('storyDetail').scrollIntoView();
  loadStories();
}
async function addComment(id) {
  try { await api(`/api/stories/${id}/comments`, { method: 'POST', body: JSON.stringify({ author_name: $('commentName').value || 'Guest', body: $('commentBody').value }) }); openStory(id); }
  catch (e) { $('commentMsg').textContent = e.message; }
}
async function likeStory(id) { await api(`/api/stories/${id}/like`, { method: 'POST' }); loadStories(); }
async function report(type, id) { const reason = prompt('Reason for report?') || 'Reported'; await api('/api/reports', { method: 'POST', body: JSON.stringify({ target_type: type, target_id: id, reason }) }); alert('Reported to the Safety queue.'); }
$('search').oninput = loadStories; $('category').onchange = loadStories;
$('trendingBtn').onclick = async () => { const list = await api(`/api/stories?adult=${adult ? 1 : 0}&trending=1`); $('stories').innerHTML = list.map((s) => `<div class="card"><h3>${esc(s.title)}</h3><p>👁 ${s.reads} · ❤️ ${s.likes}</p></div>`).join(''); };

$('publishBtn').onclick = async () => {
  try { const s = await api('/api/stories', { method: 'POST', body: JSON.stringify({ author_id: Number($('newAuthor').value) || 1, title: $('newTitle').value, body: $('newBody').value, category: $('category').value || 'Life story' }) }); $('publishMsg').textContent = s.audience === 'adult' ? 'Published as 18+ adults-only.' : 'Published!'; loadStories(); }
  catch (e) { $('publishMsg').textContent = e.message; }
};
$('createProfileBtn').onclick = async () => {
  try { const a = await api('/api/authors', { method: 'POST', body: JSON.stringify({ name: $('profileName').value, bio: $('profileBio').value }) }); me = a; $('profileMsg').textContent = `Profile created — ID ${a.id}. Use this ID to publish stories.`; loadAuthors(); }
  catch (e) { $('profileMsg').textContent = e.message; }
};

async function loadAuthors() {
  skins = await api('/api/skins');
  const list = await api('/api/authors');
  $('authors').innerHTML = list.map((a) => `<div class="card" style="${a.custom_skin_url ? `background-image:url('${esc(a.custom_skin_url)}');background-size:cover;background-position:center;` : `background:${(skins[a.skin] || {}).bg || '#fff'}`}"><b>${esc(a.name)}</b> — ${esc(a.bio || '')}<br>Song: ${esc(a.song_title || '—')} ${esc(a.song_artist || '')}<br><button onclick="openProfile(${a.id})">Open profile</button> <button onclick="addFriend(${a.id})">Add Friend</button> <button onclick="follow(${a.id})">Follow</button></div>`).join('') || '<p>No profiles yet.</p>';
  const eps = await api('/api/episodes');
  $('episodes').innerHTML = eps.map((e) => `<div class="card"><b>${esc(e.title)}</b> — ${e.duration_minutes} min · ${e.views} views<br><a href="${esc(e.youtube_url)}" target="_blank" rel="noopener">Watch on YouTube</a> <button onclick="viewEp(${e.id})">Mark viewed</button></div>`).join('') || '<p>No episodes yet.</p>';
}
async function addFriend(id) { await api(`/api/authors/${me ? me.id : 1}/friend`, { method: 'POST', body: JSON.stringify({ friendId: id }) }); alert('Friend added (mutual).'); loadAuthors(); }
async function follow(id) { await api(`/api/authors/${id}/follow`, { method: 'POST', body: JSON.stringify({ followerId: me ? me.id : 1 }) }); alert('Following.'); }
async function viewEp(id) { await api(`/api/episodes/${id}/view`, { method: 'POST' }); loadAuthors(); }
async function openProfile(id) {
  const a = await api('/api/authors/' + id);
  const skin = skins[a.skin] || {};
  $('profileDetail').innerHTML = `<div class="card" style="${a.custom_skin_url ? `background-image:url('${esc(a.custom_skin_url)}');background-size:cover;background-position:center;` : `background:${skin.bg || '#fff'}`}">
    <h3>${esc(a.name)}</h3><p>${esc(a.bio || '')}</p>
    <p>Friends: ${a.friendCount} · Top 5: ${(a.topFriends || []).map((t) => '#' + t.rank).join(', ') || '—'}</p>
    <p>🎵 ${esc(a.song_title || 'No song yet')} — ${esc(a.song_artist || '')} ${a.song_url ? `<a href="${esc(a.song_url)}" target="_blank" rel="noopener">Listen</a>` : ''}</p>
    <p>Skins: ${Object.entries(skins).map(([k, v]) => `<span class="skin" onclick="setSkin(${a.id},'${k}')">${esc(v.name)}</span>`).join('')}</p>
    <p>Custom skin (direct image link): <input id="csUrl" placeholder="https://…/skin.jpg"> <button onclick="addCustomSkin(${a.id})">Import skin</button></p>
    <div class="chatbox"><b>🤖 ${esc(a.name)}'s AI Companion</b><p>${esc(a.bot_greeting || '')} — I am an AI, not ${esc(a.name)}.</p>
    <input id="chatMsg" placeholder="Ask about their life story…"><button onclick="chat(${a.id})">Send</button> <button onclick="voiceChat(${a.id})">🎤 Voice call</button><div id="chatOut"></div></div>
    <p>Stories: ${(a.stories || []).map((s) => esc(s.title)).join(', ') || '—'} · Total reads: ${a.totalReads}</p></div>`;
  $('profileDetail').scrollIntoView();
}
async function setSkin(id, skin) { await api(`/api/authors/${id}/style`, { method: 'POST', body: JSON.stringify({ skin }) }); loadAuthors(); openProfile(id); }
async function addCustomSkin(id) { try { const s = await api(`/api/authors/${id}/custom-skins`, { method: 'POST', body: JSON.stringify({ name: 'Custom skin', image_url: $('csUrl').value }) }); await api(`/api/authors/${id}/style`, { method: 'POST', body: JSON.stringify({ custom_skin_url: s.image_url, custom_skin_name: s.name }) }); alert('Custom skin imported and applied.'); } catch (e) { alert(e.message); } }
async function chat(id) { const m = $('chatMsg').value; const d = await api(`/api/companion/${id}/chat`, { method: 'POST', body: JSON.stringify({ message: m, adult }) }); $('chatOut').innerHTML += `<p><b>You:</b> ${esc(m)}</p><p><b>AI:</b> ${esc(d.reply)}</p>`; }
function voiceChat(id) {
  // Voice call in the browser: speech recognition + speech synthesis.
  // No phone number is dialled. Requires a browser with SpeechRecognition.
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) { alert('Voice call needs a browser with speech recognition. Use text chat instead.'); return; }
  const rec = new SR(); rec.lang = 'en-US';
  alert('Voice call started — speak now. The AI will speak its reply aloud.');
  rec.onresult = async (e) => { const text = e.results[0][0].transcript; const d = await api(`/api/companion/${id}/chat`, { method: 'POST', body: JSON.stringify({ message: text, adult }) }); const u = new SpeechSynthesisUtterance(d.reply); speechSynthesis.speak(u); $('chatOut').innerHTML += `<p><b>You (voice):</b> ${esc(text)}</p><p><b>AI:</b> ${esc(d.reply)}</p>`; };
  rec.start();
}
$('earnBtn').onclick = async () => { const d = await api('/api/earnings/' + $('earnAuthor').value); $('earnOut').innerHTML = `<p>Total reads: ${d.totalReads} / 10,000 · Eligible: ${d.eligible ? 'Yes' : 'No'} · Creator share: $${d.creatorShare} of $${d.adRevenue} (50/50)</p>`; };
$('memberBtn').onclick = async () => { await api('/api/memberships', { method: 'POST', body: JSON.stringify({ author_id: Number($('earnAuthor').value) || 1 }) }); alert('Creator Membership recorded (model only — no payment taken).'); };
$('taxBtn').onclick = () => { window.open(`/api/tax/${$('earnAuthor').value || 1}/2026?format=csv`, '_blank'); };
$('reportBtn').onclick = async () => { await api('/api/reports', { method: 'POST', body: JSON.stringify({ target_type: 'manual', target_id: 0, reason: $('reportReason').value, details: $('reportTarget').value }) }); $('reportMsg').textContent = 'Reported.'; const r = await api('/api/reports'); $('reports').innerHTML = r.map((x) => `<div class="card">${esc(x.reason)} — ${esc(x.status)}</div>`).join(''); };

loadStories(); loadAuthors(); loadVideos();
