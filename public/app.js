// BioLifeDrive standalone UI — talks to /api/*
// Adult mode is off by default (minor-safe). 18+ content is hidden unless
// the visitor confirms they are 18+.
let adult = false, me = null, skins = {};
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
async function api(path, opts) { const token = (() => { try { return localStorage.getItem('authToken'); } catch { return null; } })(); const headers = { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) }; const r = await fetch(path, { headers, ...opts }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = { error: t }; } if (!r.ok) throw new Error(j.error || r.statusText); return j; }

// ---------- Accounts: email + password, top-right sign in ----------
// Clicking the BioLifeDrive logo goes home. The top-right "Create Profile"
// button asks you to sign in (or create an account) with email + password.
let currentUser = null, authMode = 'signup';
function goHome() {
  document.querySelectorAll('[data-nav]').forEach((x) => x.classList.remove('active'));
  const home = document.querySelector('[data-nav=discover]'); if (home) home.classList.add('active');
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  $('view-discover').classList.remove('hidden');
  window.scrollTo(0, 0);
}
function refreshAuthArea() {
  const el = $('authArea'); if (!el) return;
  el.innerHTML = currentUser
    ? `<span>${esc(currentUser.email)}</span><button onclick="topCreateProfile()">Create Profile</button><button onclick="signOut()">Sign out</button>`
    : `<button onclick="showAuth('signup')">Create Profile</button><button onclick="showAuth('signin')">Sign in</button>`;
}
function topCreateProfile() {
  if (!currentUser) { showAuth('signup'); return; }
  document.querySelector('[data-nav=create-profile]').click();
  refreshCreateProfile();
}
// ---------- Search people by username (top-right search bar) ----------
async function searchPeople() {
  const q = $('peopleSearch').value.trim().toLowerCase();
  const box = $('peopleSearchResults');
  if (!q) { box.classList.add('hidden'); box.innerHTML = ''; return; }
  const list = await api('/api/authors');
  const matches = list.filter((a) => a.name.toLowerCase().includes(q)).slice(0, 8);
  box.innerHTML = matches.length
    ? matches.map((a) => `<button onclick="openProfile(${a.id});$('peopleSearchResults').classList.add('hidden')">${esc(a.name)} — ${esc(a.bio || '')}</button>`).join('')
    : `<p>No one found for "${esc($('peopleSearch').value.trim())}".</p>`;
  box.classList.remove('hidden');
}
$('peopleSearch').addEventListener('input', searchPeople);
$('peopleSearch').addEventListener('keydown', async (e) => {
  if (e.key === 'Enter') {
    const list = await api('/api/authors');
    const q = $('peopleSearch').value.trim().toLowerCase();
    const m = list.find((a) => a.name.toLowerCase().includes(q));
    $('peopleSearchResults').classList.add('hidden');
    if (m) openProfile(m.id);
  }
});
document.addEventListener('click', (e) => { if (!$('peopleSearch').contains(e.target) && !$('peopleSearchResults').contains(e.target)) $('peopleSearchResults').classList.add('hidden'); });
function showAuth(mode) {
  authMode = mode || 'signup';
  $('authTitle').textContent = authMode === 'signup' ? 'Create your account' : 'Sign in';
  $('authSubmitBtn').textContent = authMode === 'signup' ? 'Create account' : 'Sign in';
  $('authName').style.display = authMode === 'signup' ? '' : 'none';
  $('authSwitchBtn').textContent = authMode === 'signup' ? 'Already have an account? Sign in' : 'No account yet? Create one';
  $('authMsg').textContent = '';
  $('authModal').classList.remove('hidden');
}
function closeAuth() { $('authModal').classList.add('hidden'); }
async function submitAuth() {
  const email = $('authEmail').value.trim(), password = $('authPassword').value, name = $('authName').value.trim();
  $('authMsg').textContent = 'Please wait…';
  try {
    const d = await api(authMode === 'signup' ? '/api/auth/signup' : '/api/auth/signin', { method: 'POST', body: JSON.stringify({ email, password, name }) });
    try { localStorage.setItem('authToken', d.token); } catch {}
    currentUser = d.user;
    closeAuth(); refreshAuthArea();
    const me = await api('/api/auth/me');
    if (me.profile) { try { localStorage.setItem('myProfileId', String(me.profile.id)); } catch {} }
    if (authMode === 'signup') topCreateProfile();
  } catch (e) { $('authMsg').textContent = e.message; }
}
async function signOut() {
  try { await api('/api/auth/signout', { method: 'POST', body: JSON.stringify({}) }); } catch {}
  try { localStorage.removeItem('authToken'); localStorage.removeItem('myProfileId'); } catch {}
  currentUser = null; refreshAuthArea(); refreshCreateProfile();
}
$('authSubmitBtn').onclick = submitAuth;
$('authSwitchBtn').onclick = () => showAuth(authMode === 'signup' ? 'signin' : 'signup');
async function checkAuth() {
  refreshAuthArea();
  try {
    const me = await api('/api/auth/me');
    currentUser = me.user; refreshAuthArea();
    if (me.profile) { try { localStorage.setItem('myProfileId', String(me.profile.id)); } catch {} }
  } catch { currentUser = null; }
}
checkAuth();

document.querySelectorAll('[data-nav]').forEach((b) => b.onclick = () => {
  document.querySelectorAll('[data-nav]').forEach((x) => x.classList.remove('active')); b.classList.add('active');
  document.querySelectorAll('.view').forEach((v) => v.classList.add('hidden'));
  $('view-' + b.dataset.nav).classList.remove('hidden');
  if (b.dataset.nav === 'record-video') loadVideos();
  if (b.dataset.nav === 'create-profile') refreshCreateProfile();
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
  $('stories').innerHTML = list.map((s) => `<div class="card" onclick="openStory(${s.id})" style="cursor:pointer"><h3>${esc(s.title)}</h3><p>${esc(s.body.slice(0, 300))}</p><p>👁 ${s.reads} · ❤️ ${s.likes} · ${esc(s.category)} ${s.audience === 'adult' ? '· 18+' : ''}</p><button onclick="event.stopPropagation();openStory(${s.id})">Read</button> <button onclick="event.stopPropagation();likeStory(${s.id})">Like</button> <button onclick="event.stopPropagation();shareStory(${s.id},'${esc(s.title).replace(/'/g, '')}')">Share</button> <button onclick="event.stopPropagation();report('story',${s.id})">🚩 Report</button></div>`).join('') || '<p>No stories yet — publish the first one.</p>';
}
async function shareStory(id, title) {
  const url = location.origin + '/#story-' + id;
  const text = `${title} — read it on BioLifeDrive`;
  try {
    if (navigator.share) { await navigator.share({ title: 'BioLifeDrive', text, url }); return; }
    await navigator.clipboard.writeText(url);
    alert('Link copied — share it anywhere.');
  } catch { prompt('Copy this link to share:', url); }
}
async function openStory(id) {
  // Same hidden-view fix as profiles: the story detail lives in the
  // Discover view, so switch to it first or nothing is visible.
  const navBtn = document.querySelector('[data-nav=discover]'); if (navBtn) navBtn.click();
  const s = await api(`/api/stories/${id}?adult=${adult ? 1 : 0}&viewer=${myProfileId() || ''}`);
  const isOwner = String(s.author_id) === String(myProfileId()) || (currentUser && s.author_user_id && String(s.author_user_id) === String(currentUser.id));
  $('storyDetail').innerHTML = `<div class="card"><button onclick="$('storyDetail').innerHTML='';loadStories()">← Back to all stories</button>
    <h3>${esc(s.title)}</h3><p>${esc(s.body)}</p>
    <p>👁 ${s.reads} · ❤️ ${s.likes} · ${esc(s.category)} ${s.audience === 'adult' ? '· 18+' : ''}</p>
    <button onclick="likeStory(${s.id})">❤️ Like</button> <button onclick="shareStory(${s.id},'${esc(s.title).replace(/'/g, '')}')">Share</button> <button onclick="report('story',${s.id})">🚩 Report</button>
    ${isOwner ? `<button onclick="editStory(${s.id})">✏️ Edit</button> <button onclick="deleteStory(${s.id})">🗑️ Delete</button>` : ''}
    <p id="storyMsg"></p>
    <div id="editBox"></div>
    <h4>Comments</h4><div>${(s.comments || []).map((c) => `<p><b>${esc(c.author_name)}</b>: ${esc(c.body)}</p>`).join('') || '<p>No comments yet.</p>'}</div>
    <input id="commentName" placeholder="Your name"><input id="commentBody" placeholder="Write a comment…"><button onclick="addComment(${s.id})">Post comment</button><p id="commentMsg"></p></div>`;
  $('storyDetail').scrollIntoView();
  loadStories();
}
async function editStory(id) {
  const s = await api(`/api/stories/${id}?adult=${adult ? 1 : 0}&viewer=${myProfileId() || ''}`);
  $('editBox').innerHTML = `<h4>Edit story</h4>
    <input id="editTitle" value="${esc(s.title)}">
    <textarea id="editBody">${esc(s.body)}</textarea>
    <button onclick="saveStory(${s.id})">Save changes</button> <button onclick="$('editBox').innerHTML=''">Cancel</button>
    <p id="editMsg"></p>`;
}
async function saveStory(id) {
  try {
    const s = await api(`/api/stories/${id}`, { method: 'PATCH', body: JSON.stringify({ title: $('editTitle').value, body: $('editBody').value }) });
    $('storyMsg').textContent = s.audience === 'adult' ? 'Saved as 18+ adults-only.' : 'Saved!';
    openStory(id);
  } catch (e) { $('editMsg').textContent = e.message; }
}
async function deleteStory(id) {
  if (!confirm('Delete this story? This cannot be undone.')) return;
  try { await api(`/api/stories/${id}`, { method: 'DELETE' }); $('storyDetail').innerHTML = ''; loadStories(); alert('Story deleted.'); if (myProfileId()) openProfile(Number(myProfileId())); }
  catch (e) { alert(e.message); }
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
  // The old code asked for a profile name but secretly needed a numeric
  // profile ID, defaulting to ID 1 — Lara's deleted profile — so publishing
  // failed silently and went nowhere. Now: use her own profile if she has
  // one, else match the name she typed, else send her to Create Profile.
  // After publishing, open the story so she lands somewhere.
  $('publishMsg').textContent = 'Publishing…';
  try {
    let authorId = Number(myProfileId()) || null;
    if (!authorId) {
      const name = $('newAuthor').value.trim();
      if (name) { const list = await api('/api/authors'); const m = list.find((a) => a.name.toLowerCase() === name.toLowerCase()); if (m) authorId = m.id; }
    }
    if (!authorId) { $('publishMsg').textContent = 'Create a profile first — tap Create Profile at the top, then come back here to publish.'; document.querySelector('[data-nav=create-profile]').click(); refreshCreateProfile(); return; }
    const s = await api('/api/stories', { method: 'POST', body: JSON.stringify({ author_id: authorId, title: $('newTitle').value, body: $('newBody').value, category: $('category').value || 'Life story' }) });
    $('publishMsg').textContent = s.audience === 'adult' ? 'Published as 18+ adults-only.' : 'Published!';
    $('newTitle').value = ''; $('newBody').value = '';
    await loadStories(); openStory(s.id);
  }
  catch (e) { $('publishMsg').textContent = e.message; }
};
// One profile per person: once a profile has been created in this browser,
// the Create Profile form is locked and the button will not create another.
// (Without login yet, this is enforced per browser/device — someone using a
// different device or clearing their browser data could still create one.
// Real one-per-account enforcement needs login.)
async function refreshCreateProfile() {
  // A profile saved in this browser may have been deleted on the server
  // (for example Lara's two duplicate profiles, deleted 2026-11-23). If
  // the saved profile no longer exists, clear it and unlock the form so a
  // new profile can be created — otherwise the form stays locked forever
  // and "Open my profile" tries to open a deleted profile.
  let mine = myProfileId();
  if (mine) {
    try { await api('/api/authors/' + mine); }
    catch { try { localStorage.removeItem('myProfileId'); } catch {} if (me && String(me.id) === String(mine)) me = null; mine = null; }
  }
  const locked = !!mine;
  $('profileName').disabled = locked; $('profileBio').disabled = locked; $('createProfileBtn').disabled = locked;
  $('profileMsg').innerHTML = locked
    ? `You already have a profile — one profile per person. <button onclick="openProfile(${mine})">Open my profile</button>`
    : '';
}
$('createProfileBtn').onclick = async () => {
  if (!currentUser) { $('profileMsg').textContent = 'Sign in first — create an account with your email and password.'; showAuth('signup'); return; }
  if (myProfileId()) { refreshCreateProfile(); return; }
  try { const a = await api('/api/authors', { method: 'POST', body: JSON.stringify({ name: $('profileName').value, bio: $('profileBio').value }) }); me = a; try { localStorage.setItem('myProfileId', String(a.id)); } catch {} $('profileMsg').textContent = `Profile created — taking you to your page…`; refreshCreateProfile(); await loadAuthors(); document.querySelector('[data-nav=profiles]').click(); openProfile(a.id); }
  catch (e) { $('profileMsg').textContent = e.message; }
};
refreshCreateProfile();
function myProfileId() { try { return localStorage.getItem('myProfileId') || (me ? String(me.id) : null); } catch { return me ? String(me.id) : null; } }
function claimProfile(id) { try { localStorage.setItem('myProfileId', String(id)); } catch {} me = { id }; openProfile(id); }

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
  // The profile is rendered inside the Profiles view. If we are on another
  // tab (for example Create Profile, where "Open my profile" lives), the
  // Profiles view is hidden — so the page loaded but nothing was visible.
  // Switch to the Profiles tab first, then render.
  const navBtn = document.querySelector('[data-nav=profiles]'); if (navBtn) navBtn.click();
  let a;
  try { a = await api('/api/authors/' + id); }
  catch (e) {
    // Deleted profile (or a stale saved ID): clear it so the Create Profile
    // form unlocks, and say so instead of failing silently.
    if (String(id) === String(myProfileId())) { try { localStorage.removeItem('myProfileId'); } catch {} if (me && String(me.id) === String(id)) me = null; refreshCreateProfile(); }
    $('profileDetail').innerHTML = `<div class="card"><p>That profile couldn't be opened — it may have been deleted. You can create a new profile from the Create Profile tab.</p></div>`;
    return;
  }
  const skin = skins[a.skin] || {};
  // Editing controls are private: only the profile owner sees them, on
  // their own profile. Everyone else sees the picture, friends, song and
  // AI companion — but no editing controls.
  const isMine = String(a.id) === String(myProfileId()) || (currentUser && a.user_id && String(a.user_id) === String(currentUser.id));
  const friendsById = Object.fromEntries((a.friends || []).map((f) => [String(f.id), f]));
  const topSlots = [1, 2, 3, 4, 5].map((rank) => {
    const t = (a.topFriends || []).find((x) => Number(x.rank) === rank);
    const f = t ? friendsById[String(t.friend_id)] : null;
    return f || null;
  });
  // If no Top 5 was picked yet, show the first 5 friends as the Top 5.
  const top5 = topSlots.some(Boolean) ? topSlots : (a.friends || []).slice(0, 5);
  const top5Html = top5.map((f, i) => f
    ? `<div class="top5-friend"><button onclick="openProfile(${f.id})" style="all:unset;cursor:pointer;display:block">${f.avatar_url ? `<img src="${esc(f.avatar_url)}" alt="">` : `<span class="top5-initial">${esc((f.name || '?')[0])}</span>`}<b>${esc(f.name)}</b></button></div>`
    : `<div class="top5-friend top5-empty"><span class="top5-initial">·</span><b>Top ${i + 1} — open</b></div>`).join('');
  const picHtml = a.avatar_url
    ? `<img class="profile-pic" src="${esc(a.avatar_url)}" alt="${esc(a.name)}">`
    : `<div class="profile-pic profile-pic-empty">${esc((a.name || '?')[0])}</div>`;
  const ytId = youtubeId(a.song_url || '');
  const songPlayer = a.song_url ? (ytId ? `<iframe width="100%" height="160" src="https://www.youtube.com/embed/${ytId}" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen></iframe>` : `<audio controls preload="none" src="${esc(a.song_url)}" style="width:100%"></audio>`) : '';
  const musicHtml = `
    <div class="music-box"><h4>🎵 ${esc(a.song_title || 'No song yet')}</h4>
    <p>${esc(a.song_artist || '')}</p>
    ${songPlayer}
    ${isMine ? `
    <p>Add a song from YouTube: <input id="songLink" placeholder="Paste a YouTube link…"> <button onclick="addSongFromLink(${a.id})">Add song</button></p>
    <p id="songLinkMsg"></p>` : ''}
    </div>`;
  const editHtml = isMine ? `
    <p>Custom skin — paste a direct image link, or a whole profile layout code: <input id="csUrl" placeholder="Paste image link or layout code…"> <button onclick="addCustomSkin(${a.id})">Import skin</button></p>
    <h4>Pick your Top 5</h4>
    ${[1, 2, 3, 4, 5].map((rank) => `<p>#${rank} <select id="top5-${rank}" onchange="setTopFive(${a.id}, ${rank}, this.value)"><option value="">— none —</option>${(a.friends || []).map((f) => `<option value="${f.id}" ${(topSlots[rank - 1] && String(topSlots[rank - 1].id) === String(f.id)) ? 'selected' : ''}>${esc(f.name)}</option>`).join('')}</select></p>`).join('')}`
    : `<p><button onclick="claimProfile(${a.id})">This is my profile</button></p>`;
  $('profileDetail').innerHTML = `<div class="card" style="${a.custom_skin_url ? `background-image:url('${esc(a.custom_skin_url)}');background-size:cover;background-position:center;` : `background:${skin.bg || '#fff'}`}">
    <div class="profile-layout">
      <div class="profile-left">
        ${picHtml}
        ${isMine ? `<p><input type="file" id="avatarFile" accept="image/*"> <button onclick="uploadAvatar(${a.id})">Upload picture</button></p><p id="avatarMsg"></p>` : ''}
        <h3>${esc(a.name)}</h3><p>${esc(a.bio || '')}</p>
        <p>${esc(a.name)} has ${a.friendCount} friends · Total reads: ${a.totalReads}</p>
        ${musicHtml}
      </div>
      <div class="profile-right">
        <h4>${esc(a.name)}'s Top 5 Friends</h4>
        <div class="top5-grid">${top5Html}</div>
        <p>${(a.friends || []).map((f) => esc(f.name)).join(', ') || 'No friends yet — add friends from the Profiles tab.'}</p>
        ${editHtml}
        <div class="chatbox"><b>🤖 ${esc(a.name)}'s AI Companion</b><p>${esc(a.bot_greeting || 'I am your AI companion, chat with me about anything')}</p>
        <input id="chatMsg" placeholder="Ask about their life story…"><button onclick="chat(${a.id})">Send</button> <button onclick="voiceChat(${a.id})">🎤 Voice call</button><div id="chatOut"></div></div>
      </div>
    </div>
    <div class="profile-below">
      <h4>${esc(a.name)}'s stories</h4><div id="profileStories">${(a.stories || []).map((s) => `<div class="card"><b>${esc(s.title)}</b><p>${esc((s.body || '').slice(0, 200))}</p><button onclick="openStory(${s.id})">Read</button> <button onclick="event.stopPropagation();shareStory(${s.id},'${esc(s.title).replace(/'/g, '')}')">Share</button>${isMine ? ` <button onclick="openStory(${s.id}).then(()=>editStory(${s.id}))">✏️ Edit</button> <button onclick="deleteStory(${s.id})">🗑️ Delete</button>` : ''}</div>`).join('') || '<p>No stories yet.</p>'}</div>
      <h4>${esc(a.name)}'s videos</h4><div id="profileVideos"><p>Loading videos…</p></div>
      ${isMine ? `<h4>Publish on your page</h4>
      <input id="pfTitle" placeholder="Story title"><textarea id="pfBody" placeholder="Write your story…"></textarea><button onclick="publishProfileStory(${a.id})">Publish story</button><p id="pfMsg"></p>
      <p><button onclick="document.querySelector('[data-nav=record-video]').click()">🎥 Record a video for your page</button></p>` : ''}
    </div></div>`;
  $('profileDetail').scrollIntoView();
  const vids = await api(`/api/videos?adult=${adult ? 1 : 0}`);
  $('profileVideos').innerHTML = vids.filter((v) => v.author_id === a.id).map((v) => `<div class="card"><b>${esc(v.title)}</b> — ${fmtTime(v.duration_seconds || 0)} · 👁 ${v.views} ${v.audience === 'adult' ? '· 18+' : ''}<br><video controls preload="metadata" src="${esc(v.file_path)}" style="width:100%;max-width:560px"></video></div>`).join('') || '<p>No videos yet.</p>';
}
async function uploadAvatar(id) {
  const f = $('avatarFile').files && $('avatarFile').files[0];
  if (!f) { $('avatarMsg').textContent = 'Choose a picture first.'; return; }
  if (f.size > 5 * 1024 * 1024) { $('avatarMsg').textContent = 'That picture is over 5 MB. Pick a smaller one.'; return; }
  $('avatarMsg').textContent = 'Uploading…';
  try {
    const r = await fetch(`/api/authors/${id}/avatar-upload`, { method: 'POST', headers: { 'Content-Type': f.type || 'image/jpeg' }, body: f });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Upload failed.');
    await api(`/api/authors/${id}/style`, { method: 'POST', body: JSON.stringify({ avatar_url: d.url }) });
    openProfile(id);
  } catch (e) { $('avatarMsg').textContent = e.message; }
}
async function setTopFive(id, rank, friendId) {
  if (!friendId) return;
  await api(`/api/authors/${id}/top-five`, { method: 'POST', body: JSON.stringify({ friendId: Number(friendId), rank }) });
  openProfile(id);
}
async function publishProfileStory(id) {
  try { const s = await api('/api/stories', { method: 'POST', body: JSON.stringify({ author_id: id, title: $('pfTitle').value, body: $('pfBody').value, category: 'Life story' }) }); $('pfMsg').textContent = s.audience === 'adult' ? 'Published as 18+ adults-only.' : 'Published on your page!'; openProfile(id); }
  catch (e) { $('pfMsg').textContent = e.message; }
}
async function setSkin(id, skin) { await api(`/api/authors/${id}/style`, { method: 'POST', body: JSON.stringify({ skin }) }); loadAuthors(); openProfile(id); }
async function addCustomSkin(id) {
  // Easy for users: paste a direct image link, OR paste a whole profile layout
  // layout code block — we pull the background image URL out of it.
  const raw = $('csUrl').value || '';
  const found = raw.match(/https?:\/\/[^\s"'\)]+\.(?:jpg|jpeg|png|gif|webp)(?:\?[^\s"'\)]*)?/i);
  const imageUrl = found ? found[0] : raw.trim();
  if (!imageUrl) { alert('Paste an image link or a profile layout code with an image in it.'); return; }
  try { const s = await api(`/api/authors/${id}/custom-skins`, { method: 'POST', body: JSON.stringify({ name: 'Custom skin', image_url: imageUrl }) }); await api(`/api/authors/${id}/style`, { method: 'POST', body: JSON.stringify({ custom_skin_url: s.image_url, custom_skin_name: s.name }) }); alert('Custom skin imported and applied.'); loadAuthors(); openProfile(id); } catch (e) { alert(e.message); } }
let songResults = [];
function youtubeId(url) { const m = String(url || '').match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/); return m ? m[1] : null; }
async function addSongFromLink(id) {
  const url = ($('songLink').value || '').trim();
  const vid = youtubeId(url);
  if (!vid) { $('songLinkMsg').textContent = 'That does not look like a YouTube link. Paste a youtube.com or youtu.be link.'; return; }
  $('songLinkMsg').textContent = 'Adding song…';
  try {
    let title = 'YouTube song', artist = '';
    try { const r = await fetch(`https://www.youtube.com/oembed?url=${encodeURIComponent('https://www.youtube.com/watch?v=' + vid)}&format=json`); const j = await r.json(); title = j.title || title; artist = j.author_name || ''; } catch {}
    await api(`/api/authors/${id}/style`, { method: 'POST', body: JSON.stringify({ song_title: title, song_artist: artist, song_url: 'https://www.youtube.com/watch?v=' + vid }) });
    openProfile(id);
  } catch (e) { $('songLinkMsg').textContent = e.message; }
}
async function searchSongs(id) {
  const q = ($('songSearch').value || '').trim();
  if (!q) { $('songResults').innerHTML = '<p>Type a song or artist to search.</p>'; return; }
  $('songResults').innerHTML = '<p>Searching…</p>';
  try {
    const r = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=8`);
    const j = await r.json();
    songResults = j.results || [];
    $('songResults').innerHTML = songResults.length ? songResults.map((s, i) => `<div class="card"><b>${esc(s.trackName)}</b> — ${esc(s.artistName)}<br><audio controls preload="none" src="${esc(s.previewUrl)}" style="width:100%;max-width:320px"></audio><br><button onclick="pickSong(${id}, ${i})">Use this song</button></div>`).join('') : '<p>No songs found. Try a different search.</p>';
  } catch (e) { $('songResults').innerHTML = '<p>Song search failed. Check your connection and try again.</p>'; }
}
async function pickSong(id, i) {
  const s = songResults[i]; if (!s) return;
  try { await api(`/api/authors/${id}/style`, { method: 'POST', body: JSON.stringify({ song_title: s.trackName, song_artist: s.artistName, song_url: s.previewUrl }) }); openProfile(id); }
  catch (e) { $('songMsg').textContent = e.message; }
}
async function uploadSong(id) {
  const f = $('songFile').files && $('songFile').files[0];
  if (!f) { $('songMsg').textContent = 'Choose an audio file first.'; return; }
  if (f.size > 15 * 1024 * 1024) { $('songMsg').textContent = 'That file is over 15 MB. Pick a smaller file.'; return; }
  $('songMsg').textContent = 'Uploading…';
  try {
    const r = await fetch(`/api/authors/${id}/song-upload?title=${encodeURIComponent(f.name.replace(/\.[^.]+$/, ''))}`, { method: 'POST', headers: { 'Content-Type': f.type || 'audio/mpeg' }, body: f });
    const d = await r.json();
    if (!r.ok) throw new Error(d.error || 'Upload failed.');
    await api(`/api/authors/${id}/style`, { method: 'POST', body: JSON.stringify({ song_title: d.title, song_artist: '', song_url: d.url }) });
    openProfile(id);
  } catch (e) { $('songMsg').textContent = e.message; }
}
async function chat(id) { const m = $('chatMsg').value; const d = await api(`/api/companion/${id}/chat`, { method: 'POST', body: JSON.stringify({ message: m, adult }) }); $('chatOut').innerHTML += `<p><b>You:</b> ${esc(m)}</p><p><b>AI:</b> ${esc(d.reply)}</p>`; }
let voiceState = null;
function speakReply(text) {
  try { speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'en-US'; speechSynthesis.speak(u); } catch {}
}
function stopVoice() {
  if (!voiceState) return;
  voiceState.active = false;
  try { voiceState.rec && voiceState.rec.stop(); } catch {}
  try { voiceState.mediaRecorder && voiceState.mediaRecorder.state !== 'inactive' && voiceState.mediaRecorder.stop(); } catch {}
  try { voiceState.stream && voiceState.stream.getTracks().forEach((t) => t.stop()); } catch {}
  speechSynthesis.cancel();
  voiceState = null;
  const s = $('voiceStatus'); if (s) s.textContent = 'Voice call ended.';
}
async function voiceChat(id) {
  // Voice call in the browser — no phone number is dialled.
  // iPhone Safari has no built-in speech recognition, so on iPhone we
  // record your voice and send it to the site to transcribe (needs the
  // AI key on the server). On browsers with speech recognition, we use
  // that directly and keep listening until you tap Stop.
  if (voiceState) { stopVoice(); return; }
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  $('chatOut').innerHTML += `<p id="voiceStatus">Voice call started — speak now. <button onclick="stopVoice()">Stop voice call</button></p>`;
  voiceState = { active: true, id };
  if (SR) {
    const rec = new SR(); rec.lang = 'en-US'; rec.continuous = true; rec.interimResults = false;
    voiceState.rec = rec;
    rec.onresult = async (e) => {
      const text = e.results[e.results.length - 1][0].transcript;
      try { const d = await api(`/api/companion/${id}/chat`, { method: 'POST', body: JSON.stringify({ message: text, adult }) }); speakReply(d.reply); $('chatOut').innerHTML += `<p><b>You (voice):</b> ${esc(text)}</p><p><b>AI:</b> ${esc(d.reply)}</p>`; }
      catch (err) { $('chatOut').innerHTML += `<p>Voice reply failed: ${esc(err.message)}. Try text chat.</p>`; }
    };
    rec.onerror = (e) => { const s = $('voiceStatus'); if (!s) return; s.textContent = e.error === 'not-allowed' ? 'Microphone was blocked. Allow microphone access in your browser settings, then try again.' : e.error === 'no-speech' ? 'Listening… I did not hear anything. Speak again.' : 'Voice listening had a problem (' + e.error + '). Try text chat instead.'; };
    rec.onend = () => { if (voiceState && voiceState.active) { try { rec.start(); } catch {} } };
    try { rec.start(); } catch (e) { $('chatOut').innerHTML += `<p>Could not start listening. Try text chat instead.</p>`; voiceState = null; }
    return;
  }
  // No built-in speech recognition (iPhone Safari): record and transcribe.
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    voiceState.stream = stream;
    const mr = new MediaRecorder(stream); voiceState.mediaRecorder = mr;
    const chunks = [];
    mr.ondataavailable = (e) => chunks.push(e.data);
    mr.onstop = async () => {
      if (!voiceState || !voiceState.active) return;
      const blob = new Blob(chunks, { type: mr.mimeType || 'audio/webm' });
      if (!blob.size) return;
      try {
        const r = await fetch(`/api/companion/${id}/voice?adult=${adult ? 1 : 0}`, { method: 'POST', headers: { 'Content-Type': blob.type }, body: blob });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || 'Voice transcription failed.');
        speakReply(d.reply);
        $('chatOut').innerHTML += `<p><b>You (voice):</b> ${esc(d.transcript)}</p><p><b>AI:</b> ${esc(d.reply)}</p>`;
      } catch (err) { $('chatOut').innerHTML += `<p>${esc(err.message)}</p>`; }
      // Record the next turn, so the call keeps going until Stop.
      if (voiceState && voiceState.active) { try { chunks.length = 0; mr.start(); setTimeout(() => { try { mr.state !== 'inactive' && mr.stop(); } catch {} }, 8000); } catch {} }
    };
    mr.start();
    // One turn at a time: stop after 8 seconds of recording, transcribe, repeat.
    setTimeout(() => { try { mr.state !== 'inactive' && mr.stop(); } catch {} }, 8000);
  } catch (e) {
    $('chatOut').innerHTML += `<p>Voice call could not start — microphone access was blocked or is not available on this device. Allow microphone access, or use text chat instead.</p>`;
    voiceState = null;
  }
}
$('earnBtn').onclick = async () => { const d = await api('/api/earnings/' + $('earnAuthor').value); $('earnOut').innerHTML = `<p>Total reads: ${d.totalReads} / 10,000 · Eligible: ${d.eligible ? 'Yes' : 'No'} · Creator share: $${d.creatorShare} of $${d.adRevenue} (50/50)</p>`; };
$('memberBtn').onclick = async () => { await api('/api/memberships', { method: 'POST', body: JSON.stringify({ author_id: Number($('earnAuthor').value) || 1 }) }); alert('Creator Membership recorded (model only — no payment taken).'); };
$('taxBtn').onclick = () => { window.open(`/api/tax/${$('earnAuthor').value || 1}/2026?format=csv`, '_blank'); };
$('reportBtn').onclick = async () => { await api('/api/reports', { method: 'POST', body: JSON.stringify({ target_type: 'manual', target_id: 0, reason: $('reportReason').value, details: $('reportTarget').value }) }); $('reportMsg').textContent = 'Reported.'; const r = await api('/api/reports'); $('reports').innerHTML = r.map((x) => `<div class="card">${esc(x.reason)} — ${esc(x.status)}</div>`).join(''); };

loadStories(); loadAuthors(); loadVideos();

// Shared story link: biolifedrive.com/#story-12 opens that story.
if (location.hash.startsWith('#story-')) { const sid = Number(location.hash.replace('#story-', '')); if (sid) setTimeout(() => openStory(sid), 300); }
