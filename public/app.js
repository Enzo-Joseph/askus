'use strict';

/* global AVATAR_IDS, GROUP_ICONS, isSprite, spriteSvg, drawSprite */

const COLORS = ['#c9d3e6', '#e2cfdc', '#cfe0d6', '#e6d3c3', '#e3dfc2', '#e6c9c4', '#d6d0e6', '#d9d9d6'];
// Colours picked under earlier themes, mapped onto the current tints by position.
const LEGACY_COLORS = [
  ['#3a4a6b', '#5b3f5e', '#3f5e55', '#6b4a35', '#5e5a3a', '#6b3a3a', '#45405e', '#4a4d57'],
  ['#ffb3c7', '#c9b3ff', '#a8dcff', '#b5ecc8', '#ffe08a', '#ffc9a3', '#ff9e9e', '#e8e2f4'],
];
function tint(color) {
  for (const set of LEGACY_COLORS) {
    const i = set.indexOf(color);
    if (i >= 0) return COLORS[i];
  }
  return color;
}
const POLL_INTERVAL = 6000;

const $app = document.getElementById('app');
const $toasts = document.getElementById('toasts');

const state = {
  me: null,
  config: null,
  group: null,
  history: null,
  tab: 'today',
  threads: {}, // pollId -> comments
  openThreads: new Set(),
  replyTo: {}, // pollId -> comment
  drafts: {}, // pollId -> text
  animated: new Set(), // pollIds whose result bars already animated
  fingerprint: '',
  poller: null,
  nav: 0,
};

// ---------------------------------------------------------------------------
// accounts (several can live on one device, handy to play with friends around one phone)

const storage = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage unavailable: session-only */
    }
  },
};

const accounts = { list: storage.get('askus.accounts', []), current: storage.get('askus.current', null) };

function currentAccount() {
  return accounts.list.find((a) => a.id === accounts.current) || accounts.list[0] || null;
}

function saveAccounts() {
  storage.set('askus.accounts', accounts.list);
  storage.set('askus.current', currentAccount()?.id ?? null);
}

function addAccount({ token, user }) {
  accounts.list = accounts.list.filter((a) => a.id !== user.id);
  accounts.list.push({ id: user.id, token, name: user.name, avatar: user.avatar, color: user.color });
  accounts.current = user.id;
  saveAccounts();
}

function removeAccount(id) {
  accounts.list = accounts.list.filter((a) => a.id !== id);
  if (accounts.current === id) accounts.current = accounts.list[0]?.id ?? null;
  saveAccounts();
}

function switchAccount(id) {
  accounts.current = id;
  saveAccounts();
  state.threads = {};
  state.openThreads.clear();
  state.group = null;
  go('#/');
}

// Navigates, re-running the router even when the hash is already the target.
function go(hash) {
  if (location.hash === hash) route();
  else location.hash = hash;
}

function syncAccount(me) {
  const acc = accounts.list.find((a) => a.id === me.id);
  if (acc) Object.assign(acc, { name: me.name, avatar: me.avatar, color: me.color });
  saveAccounts();
}

// ---------------------------------------------------------------------------
// helpers

async function api(method, path, body) {
  const acc = currentAccount();
  const res = await fetch(`/api${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(acc ? { Authorization: `Bearer ${acc.token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && acc) removeAccount(acc.id);
    const err = new Error(data.error || 'Une erreur est survenue');
    err.status = res.status;
    throw err;
  }
  return data;
}

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style') {
      if (typeof v === 'string') el.setAttribute('style', v);
      else for (const [sk, sv] of Object.entries(v)) sk.startsWith('--') ? el.style.setProperty(sk, sv) : (el.style[sk] = sv);
    } else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k in el) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    el.append(c instanceof Node ? c : String(c));
  }
  return el;
}

// A sprite by name; anything else (older emoji data) is shown as plain text.
const art = (name, px = 2) => (isSprite(name) ? spriteSvg(name, px) : h('span', null, name));
const ic = (name, px = 2) => spriteSvg(name, px);

const avatarEl = (u, size = '') =>
  h('div', { class: `avatar px flat ${size}`, style: { '--c': tint(u.color) }, title: u.name, 'aria-hidden': 'true' }, art(u.avatar, 4));

function toast(message, { icon = null, error = false } = {}) {
  const el = h('div', { class: `toast px${error ? ' error' : ''}` }, icon ? ic(icon, 2) : null, message);
  $toasts.append(el);
  setTimeout(() => el.classList.add('out'), 2600);
  setTimeout(() => el.remove(), 3000);
}
const toastError = (message) => toast(message, { error: true });

function timeAgo(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'à l’instant';
  if (s < 3600) return `${Math.floor(s / 60)}\u00a0min`;
  if (s < 86400) return `${Math.floor(s / 3600)}\u00a0h`;
  return `${Math.floor(s / 86400)}\u00a0j`;
}

function dayLabel(key, today) {
  const diff = Math.round((new Date(`${today}T00:00:00Z`) - new Date(`${key}T00:00:00Z`)) / 86400000);
  if (diff === 0) return 'Aujourd’hui';
  if (diff === 1) return 'Hier';
  return new Date(`${key}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', month: 'short', day: 'numeric' });
}

function untilTomorrow() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  const mins = Math.ceil((next - now) / 60000);
  return `${Math.floor(mins / 60)}\u00a0h\u00a0${String(mins % 60).padStart(2, '0')}`;
}

setInterval(() => {
  for (const el of document.querySelectorAll('.countdown-time')) el.textContent = untilTomorrow();
}, 30000);

function openSheet(title, build) {
  const overlay = h('div', { class: 'sheet-overlay' });
  const onKey = (e) => e.key === 'Escape' && close();
  const close = () => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  overlay.addEventListener('click', (e) => e.target === overlay && close());
  document.addEventListener('keydown', onKey);
  overlay.append(
    h('div', { class: 'sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'sheet-title' }, h('h2', null, title), h('button', { class: 'icon-btn px', 'aria-label': 'Fermer', onclick: close }, 'x')),
      build(close)),
  );
  document.body.append(overlay);
  overlay.querySelector('input')?.focus();
  return close;
}

const closeSheets = () => document.querySelectorAll('.sheet-overlay').forEach((el) => el.remove());

function choiceGrid(cls, items, selected, onPick, render) {
  const grid = h('div', { class: cls });
  for (const item of items) {
    const btn = render(item, item === selected);
    btn.type = 'button';
    btn.addEventListener('click', () => {
      grid.querySelectorAll('.selected').forEach((el) => el.classList.remove('selected'));
      btn.classList.add('selected');
      onPick(item);
    });
    grid.append(btn);
  }
  return grid;
}

// Wraps an async click handler: disables the button meanwhile and reports errors.
function action(fn) {
  return async (e) => {
    const btn = e?.currentTarget;
    if (btn) btn.disabled = true;
    try {
      await fn(e);
    } catch (err) {
      if (err.status === 401) return route();
      toastError(err.message);
    } finally {
      if (btn && btn.isConnected) btn.disabled = false;
    }
  };
}

function topbar({ back, title, right = [] }) {
  return h(
    'header',
    { class: 'topbar' },
    back ? h('button', { class: 'icon-btn px', 'aria-label': 'Retour', onclick: () => (location.hash = back) }, ic('back', 3)) : null,
    h('div', { class: 'title' }, title),
    right,
  );
}

const logo = () => h('div', { class: 'logo' }, ic('chat', 3), h('span', null, 'ask', h('b', null, 'Us')));

const profileBtn = () =>
  h('button', { class: 'icon-btn', 'aria-label': 'Profil', style: { background: 'transparent', boxShadow: 'none' }, onclick: () => (location.hash = '#/profile') }, avatarEl(state.me, 'sm'));

function setScreen(header, ...content) {
  $app.replaceChildren(header || '', h('div', { class: 'screen' }, content));
}

const spinner = () => h('div', { class: 'loading', role: 'status', 'aria-label': 'Chargement' }, h('i'), h('i'), h('i'));

// ---------------------------------------------------------------------------
// router

window.addEventListener('hashchange', route);
document.addEventListener('visibilitychange', () => !document.hidden && state.poller && refreshGroup());

async function route() {
  const nav = ++state.nav;
  stopPolling();
  closeSheets();
  const parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'join' && parts[1]) {
    sessionStorage.setItem('askus.join', parts[1]);
    history.replaceState(null, '', '#/');
    parts.length = 0;
  }
  if (parts[0] === 'login') return renderLogin();
  if (!currentAccount() || parts[0] === 'new') return renderOnboarding();

  setScreen(null, spinner());
  try {
    [state.me, state.config] = await Promise.all([api('GET', '/me'), api('GET', '/config')]);
    syncAccount(state.me);
  } catch (err) {
    if (err.status === 401) return route();
    return renderError(err);
  }
  if (nav !== state.nav) return;
  if (state.me.needsCredentials) return renderSetCredentials();

  const pending = sessionStorage.getItem('askus.join');
  if (pending) {
    sessionStorage.removeItem('askus.join');
    try {
      const g = await api('POST', '/groups/join', { code: pending });
      toast(`Bienvenue dans ${g.name}`, { icon: 'heart' });
      location.hash = `#/g/${g.id}`;
      return;
    } catch (err) {
      toastError(err.message);
    }
  }

  if (parts[0] === 'g' && parts[1]) return showGroup(parts[1], parts[2], nav);
  if (parts[0] === 'profile') return renderProfile();
  return renderHome(nav);
}

function renderError(err) {
  setScreen(
    null,
    h('div', { class: 'card px empty' }, ic('ghost', 5), h('div', { class: 'h2' }, 'Impossible de joindre le serveur'), h('p', { class: 'muted' }, err.message),
      h('button', { class: 'btn btn-primary px', onclick: route }, 'Réessayer')),
  );
}

// ---------------------------------------------------------------------------
// onboarding & profile

let fieldCount = 0;
function field(label, input, hint) {
  input.id ||= `field-${++fieldCount}`;
  return h('div', { class: 'field' }, h('label', { htmlFor: input.id }, label), input, hint ? h('p', { class: 'muted small' }, hint) : null);
}

// autocomplete values let password managers fill and save logins.
const pseudoInput = (value = '') =>
  h('input', { class: 'input px flat', name: 'username', maxLength: 20, autocomplete: 'username', autocapitalize: 'none', spellcheck: false, placeholder: 'ex. enzo.j', value, required: true });
const passwordInput = (autocomplete, { placeholder = '', required = true } = {}) =>
  h('input', { class: 'input px flat', type: 'password', name: autocomplete, autocomplete, maxLength: 100, placeholder, required });

function profileForm(initial, submitLabel, onSubmit, { credentials = false } = {}) {
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const sel = {
    avatar: isSprite(initial.avatar) ? initial.avatar : pick(AVATAR_IDS),
    color: COLORS.includes(tint(initial.color)) ? tint(initial.color) : pick(COLORS),
  };
  const preview = avatarEl({ ...sel, name: '' }, 'xl');
  const refresh = () => {
    preview.replaceChildren(art(sel.avatar, 4));
    preview.style.setProperty('--c', sel.color);
  };
  const name = h('input', { class: 'input px flat', id: 'name', maxLength: 20, placeholder: 'Ton prénom', value: initial.name || '', autocomplete: 'nickname', required: true });
  const username = credentials ? pseudoInput() : null;
  const password = credentials ? passwordInput('new-password', { placeholder: '6 caractères minimum' }) : null;
  const submit = h('button', { class: 'btn btn-primary btn-block px', type: 'submit' }, submitLabel);
  return h(
    'form',
    {
      class: 'card px',
      style: { display: 'flex', flexDirection: 'column', gap: '22px' },
      onsubmit: async (e) => {
        e.preventDefault();
        submit.disabled = true;
        try {
          await onSubmit({ name: name.value, ...sel, ...(credentials ? { username: username.value, password: password.value } : {}) });
        } catch (err) {
          toastError(err.message);
        } finally {
          submit.disabled = false;
        }
      },
    },
    h('div', { style: { display: 'grid', placeItems: 'center', paddingTop: '6px' } }, preview),
    h('div', { class: 'field' }, h('label', { htmlFor: 'name' }, 'Prénom'), name),
    credentials ? [field('Pseudo', username, 'Pour te connecter. Tes potes voient ton prénom.'), field('Mot de passe', password)] : null,
    h('div', { class: 'field' }, h('label', null, 'Avatar'),
      choiceGrid('emoji-grid', AVATAR_IDS, sel.avatar, (a) => { sel.avatar = a; refresh(); },
        (a, on) => h('button', { class: `emoji-choice px flat${on ? ' selected' : ''}`, 'aria-label': a }, ic(a, 3)))),
    h('div', { class: 'field' }, h('label', null, 'Couleur'),
      choiceGrid('color-grid', COLORS, sel.color, (c) => { sel.color = c; refresh(); },
        (c, on) => h('button', { class: `swatch px${on ? ' selected' : ''}`, style: { '--c': c }, 'aria-label': `Couleur ${c}` }))),
    submit,
  );
}

function renderOnboarding() {
  const adding = accounts.list.length > 0;
  setScreen(
    adding ? topbar({ back: '#/profile', title: 'Ajouter un joueur' }) : null,
    adding
      ? null
      : h('div', { class: 'hero' },
          logo(),
          h('p', { class: 'muted' }, 'Une question par jour sur tes potes. Vote, puis découvre ce qu’ils ont dit de toi.'),
          h('p', { class: 'prompt' }, '> crée ton compte')),
    profileForm({}, adding ? 'Ajouter' : 'Créer mon compte', async (data) => {
      addAccount(await api('POST', '/users', data));
      go('#/');
    }, { credentials: true }),
    h('p', { class: 'center muted' }, 'Déjà un compte\u00a0? ', h('button', { class: 'link-btn', onclick: () => (location.hash = '#/login') }, 'Se connecter')),
  );
}

function renderLogin() {
  const adding = accounts.list.length > 0;
  const username = pseudoInput();
  const password = passwordInput('current-password');
  setScreen(
    adding ? topbar({ back: '#/profile', title: 'Se connecter' }) : null,
    adding ? null : h('div', { class: 'hero' }, logo(), h('p', { class: 'prompt' }, '> connecte-toi')),
    h('form', {
      class: 'card px',
      style: { display: 'flex', flexDirection: 'column', gap: '18px' },
      onsubmit: action(async (e) => {
        e.preventDefault();
        addAccount(await api('POST', '/login', { username: username.value, password: password.value }));
        go('#/');
      }),
    },
    field('Pseudo', username),
    field('Mot de passe', password),
    h('button', { class: 'btn btn-primary btn-block px', type: 'submit' }, 'Se connecter')),
    h('p', { class: 'center muted' }, 'Pas encore de compte\u00a0? ',
      h('button', { class: 'link-btn', onclick: () => (location.hash = adding ? '#/new' : '#/') }, 'Créer un compte')),
    h('p', { class: 'center muted small' }, 'Mot de passe oublié\u00a0? Demande à la personne qui gère le jeu de le réinitialiser.'),
  );
}

// Accounts created before logins existed choose a pseudo and password once.
function renderSetCredentials() {
  const username = pseudoInput();
  const password = passwordInput('new-password', { placeholder: '6 caractères minimum' });
  setScreen(
    null,
    h('div', { class: 'hero' },
      logo(),
      h('p', { class: 'muted' }, `Salut ${state.me.name}\u00a0! Les comptes ont maintenant un pseudo et un mot de passe, pour jouer depuis n’importe quel appareil.`),
      h('p', { class: 'prompt' }, '> sécurise ton compte')),
    h('form', {
      class: 'card px',
      style: { display: 'flex', flexDirection: 'column', gap: '18px' },
      onsubmit: action(async (e) => {
        e.preventDefault();
        state.me = await api('POST', '/me/credentials', { username: username.value, password: password.value });
        toast('Compte sécurisé', { icon: 'check' });
        route();
      }),
    },
    field('Pseudo', username, 'Pour te connecter. Tes potes voient toujours ton prénom.'),
    field('Mot de passe', password),
    h('button', { class: 'btn btn-primary btn-block px', type: 'submit' }, 'Enregistrer')),
  );
}

function accountCard(me) {
  const username = pseudoInput(me.username || '');
  const current = passwordInput('current-password');
  const next = passwordInput('new-password', { placeholder: 'Laisse vide pour le garder', required: false });
  return h('form', {
    class: 'card px',
    style: { display: 'flex', flexDirection: 'column', gap: '14px' },
    onsubmit: action(async (e) => {
      e.preventDefault();
      const body = { currentPassword: current.value };
      if (username.value.trim().toLowerCase() !== me.username) body.username = username.value;
      if (next.value) body.password = next.value;
      state.me = { ...state.me, ...(await api('POST', '/me/credentials', body)) };
      toast('Compte mis à jour', { icon: 'check' });
      renderProfile();
    }),
  },
  h('div', { class: 'h2' }, 'Compte'),
  field('Pseudo', username),
  field('Mot de passe actuel', current),
  field('Nouveau mot de passe', next),
  h('button', { class: 'btn btn-block px', type: 'submit' }, 'Mettre à jour'));
}

function renderProfile() {
  const me = state.me;
  const { minMembers } = state.config;
  setScreen(
    topbar({ back: '#/', title: 'Profil' }),
    profileForm(me, 'Enregistrer', async (data) => {
      state.me = { ...state.me, ...(await api('PATCH', '/me', data)) };
      syncAccount(state.me);
      toast('Enregistré', { icon: 'check' });
    }),
    accountCard(me),
    h('div', { class: 'card px' },
      h('div', { class: 'h2' }, 'Comment ça marche'),
      h('ul', { class: 'howto' },
        h('li', null, ic('heart'), h('span', null, minMembers > 1 ? `Crée un groupe et fais venir au moins ${minMembers - 1} potes avec le code.` : 'Crée un groupe et partage le code avec tes potes.')),
        h('li', null, ic('star'), h('span', null, 'Une nouvelle question tombe chaque jour. Vote pour quelqu’un ou choisis ton camp.')),
        h('li', null, ic('eye'), h('span', null, 'Tu ne vois les résultats qu’après avoir voté.')),
        h('li', null, ic('flame'), h('span', null, 'Vote tous les jours pour enchaîner une série.')),
        h('li', null, ic('pencil'), h('span', null, 'Tout le monde peut poser sa propre question au groupe, à tout moment.')))),
    h('div', { class: 'card px', style: { display: 'flex', flexDirection: 'column', gap: '14px' } },
      h('div', { class: 'h2' }, 'Joueurs sur cet appareil'),
      h('p', { class: 'muted small' }, 'Un seul téléphone pour tout le monde\u00a0? Ajoute chaque joueur ici et passe de l’un à l’autre.'),
      accounts.list.map((a) =>
        h('button', { class: `account-row px${a.id === me.id ? ' current' : ''}`, onclick: () => a.id !== me.id && switchAccount(a.id) },
          avatarEl(a, 'sm'), h('span', { class: 'n' }, a.name), h('span', { class: 'small' }, a.id === me.id ? 'en jeu' : 'changer'))),
      h('button', { class: 'btn btn-ghost btn-block px', onclick: () => (location.hash = '#/new') }, ic('plus'), 'Ajouter un joueur'),
      h('button', {
        class: 'btn btn-danger btn-block px',
        onclick: action(async () => {
          if (!confirm(`Te déconnecter de cet appareil\u00a0? Tu pourras revenir avec ton pseudo «\u00a0${me.username}\u00a0».`)) return;
          await api('POST', '/logout').catch(() => {});
          removeAccount(me.id);
          go('#/');
        }),
      }, 'Se déconnecter')),
    state.config.dev
      ? h('div', { class: 'card px', style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
          h('div', { class: 'h2' }, 'Outils de dev'),
          h('p', { class: 'muted small' }, `Jour du serveur\u00a0: ${state.config.today}`),
          h('button', {
            class: 'btn btn-secondary btn-block px',
            onclick: action(async () => {
              const { today } = await api('POST', '/dev/next-day');
              state.config.today = today;
              toast(`On est le ${today}`, { icon: 'clock' });
              renderProfile();
            }),
          }, 'Passer au jour suivant', ic('next')))
      : null,
  );
}

// ---------------------------------------------------------------------------
// home

async function renderHome(nav) {
  setScreen(homeTopbar(), spinner());
  let groups;
  try {
    groups = await api('GET', '/groups');
  } catch (err) {
    return err.status === 401 ? route() : renderError(err);
  }
  if (nav !== state.nav) return;

  const actions = h('div', { class: 'btn-row' },
    h('button', { class: 'btn btn-primary px', onclick: createGroupSheet }, ic('plus'), 'Nouveau groupe'),
    h('button', { class: 'btn px', onclick: joinGroupSheet }, ic('key'), 'Rejoindre'));

  const waiting = groups.filter((g) => g.pending).length;
  setScreen(
    homeTopbar(),
    h('div', null,
      h('div', { class: 'h1' }, 'Groupes'),
      groups.length ? h('p', { class: 'muted', style: { marginTop: '6px' } }, waiting ? `${waiting} en attente de ton vote.` : 'Tu es à jour. Prochaine question à minuit.') : null),
    groups.length
      ? [groups.map(groupCard), actions]
      : h('div', { class: 'card px empty' },
          h('div', { class: 'h2' }, 'Aucun groupe pour l’instant'),
          h('p', { class: 'muted' }, 'Crées-en un pour tes potes, ou rejoins le leur avec un code.'), actions),
  );
}

const homeTopbar = () => topbar({ title: logo(), right: [profileBtn()] });

function groupCard(g) {
  let status;
  if (g.waiting) status = h('span', { class: 'badge' }, `${g.memberCount}/${state.config.minMembers} membres`);
  else if (g.pending) status = h('span', { class: 'badge new' }, g.pending > 1 ? `${g.pending} nouvelles` : 'Nouveau\u00a0!');
  else status = h('span', { class: 'badge done' }, 'Voté');
  const q = g.question;
  const sub = g.waiting ? 'En attente de tes potes' : q ? (q.type === 'who' && q.prefix ? `${q.prefix} ${q.text}` : q.text) : '';
  return h('button', { class: 'group-card px', onclick: () => (location.hash = `#/g/${g.id}`) },
    h('div', { class: 'tile px flat' }, art(g.icon, 4)),
    h('div', { class: 'info' }, h('div', { class: 'name' }, g.name), h('div', { class: 'sub' }, sub),
      h('div', { class: 'avatar-stack' }, g.members.map((m) => avatarEl(m, 'xs')), g.memberCount > 5 ? h('span', { class: 'muted small' }, `+${g.memberCount - 5}`) : null)),
    h('div', { class: 'side' }, status, g.streak.current ? h('span', { class: 'stat' }, ic('flame'), g.streak.current) : null));
}

function createGroupSheet() {
  openSheet('Nouveau groupe', (close) => {
    let icon = GROUP_ICONS[0];
    const name = h('input', { class: 'input px flat', maxLength: 30, placeholder: 'Les colocs', required: true });
    return h('form', {
      style: { display: 'flex', flexDirection: 'column', gap: '20px' },
      onsubmit: action(async (e) => {
        e.preventDefault();
        const g = await api('POST', '/groups', { name: name.value, icon });
        close();
        location.hash = `#/g/${g.id}`;
        setTimeout(() => inviteSheet(g), 300);
      }),
    },
    h('div', { class: 'field' }, h('label', null, 'Nom'), name),
    h('div', { class: 'field' }, h('label', null, 'Icône'),
      choiceGrid('emoji-grid', GROUP_ICONS, icon, (i) => (icon = i), (i, on) => h('button', { class: `emoji-choice px flat${on ? ' selected' : ''}`, 'aria-label': i }, ic(i, 3)))),
    h('button', { class: 'btn btn-primary btn-block px', type: 'submit' }, 'Créer'));
  });
}

function joinGroupSheet() {
  openSheet('Rejoindre un groupe', (close) => {
    const code = h('input', { class: 'input code px flat', maxLength: 6, placeholder: 'ABC123', autocomplete: 'off', required: true });
    return h('form', {
      style: { display: 'flex', flexDirection: 'column', gap: '20px' },
      onsubmit: action(async (e) => {
        e.preventDefault();
        const g = await api('POST', '/groups/join', { code: code.value });
        close();
        toast(`Bienvenue dans ${g.name}`, { icon: 'heart' });
        location.hash = `#/g/${g.id}`;
      }),
    },
    h('p', { class: 'muted' }, 'Demande le code à 6 caractères à la personne qui a créé le groupe.'),
    code,
    h('button', { class: 'btn btn-primary btn-block px', type: 'submit' }, 'Rejoindre'));
  });
}

function inviteSheet(g) {
  const link = `${location.origin}/#/join/${g.code}`;
  const text = `Rejoins «\u00a0${g.name}\u00a0» sur askUs. Code\u00a0: ${g.code}`;
  openSheet('Inviter des potes', () => [
    h('p', { class: 'muted' }, `Envoie-leur le code ou le lien.${state.config.minMembers > 1 ? ` Il faut ${state.config.minMembers} personnes pour commencer.` : ''}`),
    h('div', { class: 'invite-code px flat' }, g.code),
    h('div', { class: 'btn-row' },
      h('button', {
        class: 'btn px',
        onclick: action(async () => {
          await navigator.clipboard.writeText(`${text}\n${link}`);
          toast('Lien copié', { icon: 'check' });
        }),
      }, 'Copier le lien'),
      navigator.share ? h('button', { class: 'btn btn-primary px', onclick: () => navigator.share({ title: 'askUs', text, url: link }).catch(() => {}) }, ic('up'), 'Partager') : null),
  ]);
}

// ---------------------------------------------------------------------------
// group screen

async function showGroup(id, tab = 'today', nav = state.nav) {
  if (state.group?.id !== id) {
    state.group = null;
    state.history = null;
    state.fingerprint = '';
  }
  state.tab = ['today', 'history', 'members', 'packs'].includes(tab) ? tab : 'today';
  if (!state.group) setScreen(topbar({ back: '#/', title: '' }), spinner());
  try {
    state.group = await api('GET', `/groups/${id}`);
    if (state.tab === 'history') state.history = await api('GET', `/groups/${id}/history`);
  } catch (err) {
    if (err.status === 401) return route();
    toastError(err.message);
    location.hash = '#/';
    return;
  }
  if (nav !== state.nav) return;
  renderGroup();
  startPolling();
}

function startPolling() {
  stopPolling();
  state.poller = setInterval(() => !document.hidden && refreshGroup(), POLL_INTERVAL);
}

function stopPolling() {
  clearInterval(state.poller);
  state.poller = null;
}

async function refreshGroup() {
  const g = state.group;
  if (!g || document.querySelector('.sheet-overlay')) return;
  try {
    const [group, history, ...threads] = await Promise.all([
      api('GET', `/groups/${g.id}`),
      state.tab === 'history' ? api('GET', `/groups/${g.id}/history`) : null,
      ...[...state.openThreads].map((pid) => api('GET', `/polls/${pid}/comments`).then((c) => [pid, c]).catch(() => null)),
    ]);
    if (state.group?.id !== g.id) return;
    state.group = group;
    if (history) state.history = history;
    for (const t of threads) if (t) state.threads[t[0]] = t[1];
    renderGroup();
  } catch {
    /* transient network error: try again next tick */
  }
}

function renderGroup() {
  const g = state.group;
  const fingerprint = JSON.stringify([g, state.tab, state.history, state.threads, [...state.openThreads], state.replyTo]);
  if (fingerprint === state.fingerprint && $app.querySelector('.tabs')) return;
  state.fingerprint = fingerprint;

  // Keep focus & scroll across re-renders (the poller refreshes the screen in the background).
  const focusKey = document.activeElement?.dataset?.key;
  const scroll = window.scrollY;

  const tabs = [['today', 'star', 'Du jour'], ['history', 'calendar', 'Archives'], ['members', 'heart', 'Potes'], ['packs', 'gift', 'Packs']];
  const content = { today: todayTab, history: historyTab, members: membersTab, packs: packsTab }[state.tab](g);

  setScreen(
    topbar({
      back: '#/',
      title: [art(g.icon, 2), h('span', null, g.name)],
      right: [h('button', { class: 'icon-btn px', 'aria-label': 'Inviter des potes', onclick: () => inviteSheet(g) }, ic('plus', 3))],
    }),
    h('nav', { class: 'tabs px flat', role: 'tablist' },
      tabs.map(([key, icon, label]) => h('button', {
        class: `tab${state.tab === key ? ' active' : ''}`,
        role: 'tab',
        'aria-selected': String(state.tab === key),
        onclick: () => switchTab(key),
      }, ic(icon, 2), label))),
    content,
  );

  window.scrollTo(0, scroll);
  if (focusKey) {
    const el = $app.querySelector(`[data-key="${focusKey}"]`);
    if (el) {
      el.focus({ preventScroll: true });
      if (el.setSelectionRange) el.setSelectionRange(el.value.length, el.value.length);
    }
  }
}

async function switchTab(tab) {
  state.tab = tab;
  history.replaceState(null, '', `#/g/${state.group.id}${tab === 'today' ? '' : `/${tab}`}`);
  if (tab === 'history' && !state.history) {
    renderGroup();
    try {
      state.history = await api('GET', `/groups/${state.group.id}/history`);
    } catch (err) {
      toastError(err.message);
      state.history = [];
    }
  }
  renderGroup();
  window.scrollTo(0, 0);
}

function replacePoll(poll) {
  const list = state.tab === 'history' ? state.history : state.group.polls;
  const i = list.findIndex((p) => p.id === poll.id);
  if (i >= 0) list[i] = poll;
  renderGroup();
}

// ---- today

function todayTab(g) {
  if (g.waiting) return waitingCard(g);
  return [
    streakBanner(g),
    g.polls.map((p) => pollCard(p, g)),
    h('button', { class: 'ask-card px', onclick: () => askSheet(g) },
      ic('pencil', 3),
      h('span', { class: 't' }, h('strong', null, 'Pose ta propre question'), 'Tout le groupe la reçoit aujourd’hui')),
    h('div', { class: 'countdown' }, ic('clock'), 'Prochaine question dans ', h('span', { class: 'countdown-time' }, untilTomorrow())),
  ];
}

function waitingCard(g) {
  const n = g.members.length;
  const left = g.minMembers - n;
  return h('div', { class: 'card px waiting-card' },
    ic('clock', 5),
    h('div', { class: 'h2' }, 'En attente de tes potes'),
    h('p', { class: 'muted' }, `Les questions commencent à ${g.minMembers} personnes. Encore ${left}\u00a0!`),
    h('div', { class: 'progress-dots' }, Array.from({ length: g.minMembers }, (_, i) => h('i', { class: `px flat${i < n ? ' on' : ''}` }))),
    h('div', { class: 'invite-code px flat', style: { width: '100%' } }, g.code),
    h('button', { class: 'btn btn-primary btn-block px', onclick: () => inviteSheet(g) }, ic('up'), 'Inviter des potes'));
}

function streakBanner(g) {
  const s = g.streak;
  if (!s.current) {
    return h('div', { class: 'streak-banner px' }, ic('flame', 4),
      h('span', { class: 'txt' }, h('strong', null, 'Pas encore de série'), 'Vote chaque jour pour en lancer une.'));
  }
  return h('div', { class: 'streak-banner px' }, ic('flame', 4),
    h('span', { class: 'txt' }, h('strong', null, `${s.current} jour${s.current > 1 ? 's' : ''} d’affilée`),
      s.doneToday ? `Reviens demain. Record\u00a0: ${s.best}` : 'Vote aujourd’hui pour continuer'));
}

function pollCard(p, g) {
  const isWho = p.type === 'who';
  const head = h('div', { class: 'poll-head' },
    p.author
      ? h('span', { class: 'chip' }, avatarEl(p.author, 'xs'), `de ${p.author.name}`)
      : h('span', { class: 'chip' }, p.pack ? [art(p.pack.icon, 2), p.pack.name] : 'Du jour'),
    h('span', null, `${p.voteCount}/${p.memberCount} ont voté`));

  const body = [h('div', null, p.prefix ? h('div', { class: 'poll-prefix' }, p.prefix) : null, h('div', { class: 'poll-text' }, p.text))];
  if (!p.results) {
    if (isWho) {
      body.push(h('div', { class: 'vote-grid' }, g.members.map((m) =>
        h('button', { class: 'vote-option px', onclick: action(() => vote(p, m.id)) }, avatarEl(m, 'lg'), h('span', null, m.me ? 'Moi' : m.name)))));
    } else {
      body.push(h('div', { class: 'wyr-options' },
        h('button', { class: 'wyr-option a px', onclick: action(() => vote(p, 'a')) }, p.a),
        h('button', { class: 'wyr-option b px', onclick: action(() => vote(p, 'b')) }, p.b)));
    }
    body.push(h('div', { class: 'poll-hint' }, isWho ? 'Tout le monde verra pour qui tu as voté' : 'Tout le monde verra ton camp'));
  } else {
    body.push(isWho ? whoResults(p) : wyrResults(p));
    body.push(h('div', { class: 'poll-actions' },
      h('button', {
        class: 'btn btn-sm px',
        'aria-expanded': String(state.openThreads.has(p.id)),
        onclick: () => {
          state.openThreads.has(p.id) ? state.openThreads.delete(p.id) : state.openThreads.add(p.id);
          renderGroup();
        },
      }, ic('chat'), p.commentCount ? `Messages (${p.commentCount})` : 'Messages'),
      h('button', { class: 'btn btn-sm px', onclick: action(() => shareImage(p, g)) }, ic('camera'), 'Exporter')));
    if (state.openThreads.has(p.id)) body.push(threadEl(p));
  }

  return h('article', { class: 'poll-card px', style: p.pack ? { '--accent': p.pack.color } : null },
    head, h('div', { class: 'poll-body' }, body));
}

async function vote(p, choice) {
  const res = await api('POST', `/polls/${p.id}/vote`, { choice });
  if (p.daily && res.streak.current > 1) toast(`${res.streak.current} jours d’affilée`, { icon: 'flame' });
  state.group.streak = res.streak;
  replacePoll(res.poll);
  refreshGroup(); // member streaks changed too
}

// Animates bars only the first time a poll's results appear, not on every background refresh.
function animated(p, el, prop, value) {
  if (state.animated.has(p.id)) {
    el.style[prop] = value;
  } else {
    requestAnimationFrame(() => requestAnimationFrame(() => (el.style[prop] = value)));
  }
}

function whoResults(p) {
  const rows = p.results.rows.map((r) => {
    const fill = h('div', { class: 'result-fill' });
    animated(p, fill, 'width', `${Math.max(r.pct, r.votes ? 4 : 0)}%`);
    return h('div', { class: `result-row${r.top ? ' top' : ''}${r.votes ? '' : ' zero'}` },
      avatarEl(r, 'sm'),
      h('div', { class: 'result-main' },
        h('div', { class: 'result-label' },
          h('span', { class: 'n' }, r.top ? ic('crown', 2) : null, r.name,
            r.id === state.me.id ? h('span', { class: 'you-tag' }, 'toi') : null,
            p.myVote === r.id ? h('span', { class: 'you-tag' }, 'ton choix') : null),
          h('span', null, `${r.pct}%`)),
        h('div', { class: 'result-bar' }, fill),
        r.voters.length
          ? h('div', { class: 'result-voters' }, h('span', { class: 'muted small' }, 'par'), r.voters.map((v) => h('span', { class: 'voter' }, avatarEl(v, 'xs'), v.name)))
          : null));
  });
  queueMicrotask(() => state.animated.add(p.id));
  return h('div', { class: 'results' }, p.results.total ? null : h('div', { class: 'poll-hint' }, 'Personne n’a voté.'), rows);
}

function wyrResults(p) {
  const side = (key) => {
    const s = p.results[key];
    const fill = h('div', { class: 'fill' });
    animated(p, fill, 'height', `${s.pct}%`);
    return h('div', { class: `wyr-side px flat ${key}${p.myVote === key ? ' mine' : ''}` },
      fill,
      h('div', { class: 'label' }, p[key]),
      h('div', { class: 'small' }, `${s.votes} vote${s.votes === 1 ? '' : 's'}${p.myVote === key ? ' · toi' : ''}`),
      h('div', { class: 'avatar-stack' }, s.voters.map((v) => avatarEl(v, 'xs'))),
      h('div', { class: 'pct' }, `${s.pct}%`));
  };
  queueMicrotask(() => state.animated.add(p.id));
  return h('div', { class: 'wyr-results' }, side('a'), side('b'));
}

// ---- comments

function threadEl(p) {
  const comments = state.threads[p.id];
  if (!comments) {
    loadThread(p.id);
    return h('div', { class: 'thread' }, spinner());
  }
  const replies = (id) => comments.filter((c) => c.replyTo === id);
  const commentEl = (c) =>
    h('div', { class: `comment${c.replyTo ? ' reply' : ''}${c.mine ? ' mine' : ''}` },
      avatarEl(c.author, 'xs'),
      h('div', { class: 'bubble px flat' },
        h('div', { class: 'who' }, h('span', null, `${c.author.name} · ${timeAgo(c.createdAt)}`),
          h('button', {
            class: 'link-btn',
            onclick: () => {
              state.replyTo[p.id] = c;
              renderGroup();
              $app.querySelector(`[data-key="c-${p.id}"]`)?.focus();
            },
          }, 'répondre')),
        h('div', { class: 'txt' }, c.text)));

  const input = h('input', {
    class: 'input px flat',
    'data-key': `c-${p.id}`,
    maxLength: 300,
    placeholder: state.replyTo[p.id] ? `Répondre à ${state.replyTo[p.id].author.name}` : 'Écris un message',
    value: state.drafts[p.id] || '',
    oninput: (e) => (state.drafts[p.id] = e.target.value),
  });
  const replying = state.replyTo[p.id];
  return h('div', { class: 'thread' },
    comments.length ? null : h('div', { class: 'muted small center' }, 'Aucun message pour l’instant.'),
    comments.filter((c) => !c.replyTo).map((c) => [commentEl(c), replies(c.id).map(commentEl)]),
    replying
      ? h('div', { class: 'replying' }, `En réponse à ${replying.author.name}`,
          h('button', { class: 'link-btn', onclick: () => { delete state.replyTo[p.id]; renderGroup(); } }, 'annuler'))
      : null,
    h('form', {
      class: 'comment-form',
      onsubmit: async (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        try {
          const list = await api('POST', `/polls/${p.id}/comments`, { text, replyTo: replying?.id });
          state.threads[p.id] = list;
          state.drafts[p.id] = '';
          delete state.replyTo[p.id];
          p.commentCount = list.length;
          renderGroup();
        } catch (err) {
          toastError(err.message);
        }
      },
    }, input, h('button', { class: 'btn btn-primary btn-sm px', type: 'submit', 'aria-label': 'Envoyer' }, ic('next'))));
}

async function loadThread(pollId) {
  try {
    state.threads[pollId] = await api('GET', `/polls/${pollId}/comments`);
  } catch (err) {
    state.threads[pollId] = [];
    toastError(err.message);
  }
  renderGroup();
}

// ---- ask

function askSheet(g) {
  openSheet('Demande au groupe', (close) => {
    let type = 'who';
    const text = h('input', { class: 'input px flat', maxLength: 140, required: true });
    const a = h('input', { class: 'input px flat', maxLength: 40, placeholder: 'Plage' });
    const b = h('input', { class: 'input px flat', maxLength: 40, placeholder: 'Montagne' });
    const options = h('div', { class: 'field', hidden: true }, h('label', null, 'Les deux camps'), a, b);
    const seg = h('div', { class: 'segmented px flat' });
    const setType = (t) => {
      type = t;
      seg.querySelectorAll('button').forEach((x) => x.classList.toggle('active', x.dataset.t === t));
      options.hidden = t !== 'wyr';
      a.required = b.required = t === 'wyr';
      text.placeholder = t === 'who' ? 'Qui survivrait une semaine sans téléphone\u00a0?' : 'Le dimanche idéal\u00a0?';
    };
    seg.append(
      h('button', { type: 'button', 'data-t': 'who', onclick: () => setType('who') }, 'Choisir un pote'),
      h('button', { type: 'button', 'data-t': 'wyr', onclick: () => setType('wyr') }, 'Ceci ou cela'));
    setType('who');
    return h('form', {
      style: { display: 'flex', flexDirection: 'column', gap: '18px' },
      onsubmit: action(async (e) => {
        e.preventDefault();
        const res = await api('POST', `/groups/${g.id}/ask`, { type, text: text.value, a: a.value, b: b.value });
        close();
        state.group.polls.push(res.poll);
        toast('Publiée', { icon: 'check' });
        renderGroup();
      }),
    },
    seg,
    h('div', { class: 'field' }, h('label', null, 'Question'), text),
    options,
    h('p', { class: 'muted small' }, 'Elle part à tout le groupe aujourd’hui. Reste sympa.'),
    h('button', { class: 'btn btn-primary btn-block px', type: 'submit' }, 'Publier'));
  });
}

// ---- history

function historyTab(g) {
  if (!state.history) return spinner();
  if (!state.history.length) {
    return h('div', { class: 'card px empty' }, ic('calendar', 5), h('div', { class: 'h2' }, 'Rien pour l’instant'),
      h('p', { class: 'muted' }, 'Les anciennes questions et leurs résultats arrivent ici.'));
  }
  const out = [];
  let last = null;
  for (const p of state.history) {
    if (p.date !== last) {
      out.push(h('div', { class: 'date-header' }, dayLabel(p.date, g.today)));
      last = p.date;
    }
    out.push(pollCard(p, g));
  }
  return out;
}

// ---- members

function membersTab(g) {
  return [
    h('div', { class: 'card px' },
      g.members.map((m) => h('div', { class: 'member-row' },
        avatarEl(m),
        h('span', { class: 'n' }, m.name, m.me ? h('span', { class: 'you-tag' }, 'toi') : null),
        h('span', { class: 'stats' },
          h('span', { class: 'stat', title: 'Questions gagnées' }, ic('crown'), m.wins),
          h('span', { class: 'stat', title: 'Jours d’affilée' }, ic('flame'), m.streak))))),
    h('p', { class: 'muted small center' }, 'Couronne\u00a0: questions gagnées. Flamme\u00a0: jours d’affilée.'),
    state.config.dev ? devBotsCard(g) : null,
    h('button', { class: 'btn btn-primary btn-block px', onclick: () => inviteSheet(g) }, ic('plus'), `Inviter · ${g.code}`),
    h('button', {
      class: 'btn btn-danger btn-block px',
      onclick: action(async () => {
        if (!confirm(`Quitter ${g.name}\u00a0? Tu pourras revenir avec le code.`)) return;
        await api('POST', `/groups/${g.id}/leave`);
        toast(`Tu as quitté ${g.name}`);
        location.hash = '#/';
      }),
    }, 'Quitter le groupe'),
  ];
}

// Dev mode only: fake friends that join the group and vote at random.
function devBotsCard(g) {
  const run = (path, message) => action(async () => {
    state.group = await api('POST', `/dev/groups/${g.id}${path}`);
    toast(message, { icon: 'check' });
    renderGroup();
  });
  return h('div', { class: 'card px', style: { display: 'flex', flexDirection: 'column', gap: '12px' } },
    h('div', { class: 'h2' }, 'Outils de dev'),
    h('p', { class: 'muted small' }, 'Les bots répondent au hasard à toutes les questions ouvertes quand ils arrivent ou quand tu le demandes.'),
    h('div', { class: 'btn-row' },
      h('button', { class: 'btn btn-secondary px', onclick: run('/bots', 'Bot ajouté') }, ic('plus'), 'Ajouter un bot'),
      h('button', { class: 'btn px', onclick: run('/bots/vote', 'Les bots ont voté') }, 'Faire voter')));
}

// ---- packs

function packsTab(g) {
  return [
    h('p', { class: 'muted' }, 'La question du jour est tirée de tous ces packs.'),
    g.packs.map((pack) => h('div', { class: 'card px pack-card' },
      h('div', { class: 'head' },
        h('div', { class: 'pack-tile px flat', style: { '--c': pack.color } }, art(pack.icon, 3)),
        h('div', { style: { flex: 1 } }, h('div', { class: 'pack-name' }, pack.name), h('div', { class: 'muted small' }, `${pack.count} questions`))),
      h('div', null, pack.description),
      h('ul', null, pack.samples.map((s) => h('li', null, s))))),
  ];
}

// ---------------------------------------------------------------------------
// results image

function wrapText(ctx, text, maxWidth) {
  const words = text.split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const test = line ? `${line} ${w}` : w;
    if (ctx.measureText(test).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = test;
  }
  if (line) lines.push(line);
  return lines;
}

// Pixel frame with notched corners, matching the .px look of the app.
function pixelBox(ctx, x, y, w, hgt, fill, b = 6) {
  ctx.fillStyle = '#1c1c1c';
  ctx.fillRect(x, y - b, w, hgt + b * 3);
  ctx.fillRect(x - b, y, w + b * 2, hgt);
  ctx.fillStyle = fill;
  ctx.fillRect(x, y, w, hgt);
}

async function shareImage(p, g) {
  await document.fonts.ready;
  const W = 1080;
  const H = 1350;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  const font = (size, weight = 700) => (weight === 700 ? `${Math.round(size * 0.62)}px Silkscreen, monospace` : `${Math.round(size * 1.2)}px VT323, monospace`);

  // checkerboard background
  for (let y = 0; y < H; y += 54) {
    for (let x = 0; x < W; x += 54) {
      ctx.fillStyle = (x + y) / 54 % 2 ? '#e6e1d5' : '#efebe2';
      ctx.fillRect(x, y, 54, 54);
    }
  }

  pixelBox(ctx, 60, 60, W - 120, H - 140, '#f8f6f0', 8);
  ctx.fillStyle = p.pack?.color || '#c8402f';
  ctx.fillRect(60, 60, W - 120, 110);
  ctx.fillStyle = '#1c1c1c';
  ctx.fillRect(60, 170, W - 120, 8);

  ctx.textBaseline = 'middle';
  drawSprite(ctx, 'chat', 96, 88, 6);
  ctx.font = font(52);
  ctx.fillText('askUs', 166, 116);
  ctx.textAlign = 'right';
  ctx.font = font(36, 500);
  ctx.fillText(g.name.slice(0, 24), W - 100, 116);
  ctx.textAlign = 'left';

  ctx.textBaseline = 'top';
  let y = 220;
  ctx.fillStyle = '#6b675e';
  ctx.font = font(38, 500);
  ctx.fillText(p.prefix, 100, y);
  y += 58;
  ctx.fillStyle = '#1c1c1c';
  ctx.font = font(64, 500);
  for (const line of wrapText(ctx, p.text, W - 200).slice(0, 4)) {
    ctx.fillText(line, 100, y);
    y += 76;
  }
  y += 40;

  if (p.type === 'who') {
    const rows = p.results.rows.filter((r) => r.votes).slice(0, 5);
    for (const r of rows) {
      pixelBox(ctx, 106, y, 84, 84, tint(r.color), 4);
      drawSprite(ctx, r.avatar, 112, y + 6, 6);
      ctx.fillStyle = '#1c1c1c';
      ctx.font = font(38, 500);
      let nameX = 220;
      if (r.top) {
        drawSprite(ctx, 'crown', 220, y + 4, 4);
        nameX = 266;
      }
      ctx.fillText(r.name, nameX, y + 2);
      ctx.textAlign = 'right';
      ctx.fillText(`${r.pct}%`, W - 106, y + 2);
      ctx.textAlign = 'left';
      const barW = W - 106 - 224;
      pixelBox(ctx, 224, y + 54, barW, 24, '#e6e1d5', 4);
      ctx.fillStyle = r.top ? '#c8402f' : '#6b675e';
      const filled = Math.max(12, Math.round((barW * r.pct) / 100 / 12) * 12);
      for (let x = 0; x < filled; x += 12) ctx.fillRect(224 + x, y + 54, 10, 24);
      y += 130;
    }
    if (!rows.length) {
      ctx.font = font(40, 500);
      ctx.fillStyle = '#6b675e';
      ctx.fillText('Personne n’a voté.', 100, y);
    }
  } else {
    const colW = (W - 260) / 2;
    const boxH = Math.min(520, H - y - 190);
    [['a', 100, '#ecc6bf'], ['b', 160 + colW, '#c3d1df']].forEach(([key, x, color]) => {
      const s = p.results[key];
      pixelBox(ctx, x, y, colW, boxH, '#e6e1d5', 6);
      const fillH = Math.round((boxH * s.pct) / 100 / 20) * 20;
      ctx.fillStyle = color;
      ctx.fillRect(x, y + boxH - fillH, colW, fillH);
      ctx.fillStyle = '#1c1c1c';
      ctx.font = font(40, 500);
      wrapText(ctx, p[key], colW - 50).slice(0, 3).forEach((line, i) => ctx.fillText(line, x + 26, y + 26 + i * 48));
      ctx.font = font(100);
      ctx.fillText(`${s.pct}%`, x + 26, y + boxH - 130);
    });
  }

  ctx.font = font(32, 500);
  ctx.fillStyle = '#6b675e';
  ctx.textAlign = 'center';
  ctx.fillText(`${p.results.total} vote${p.results.total === 1 ? '' : 's'} · ${dayLabel(p.date, g.today)}`, W / 2, H - 150);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  const file = new File([blob], 'askus-results.png', { type: 'image/png' });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'Résultats askUs' });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;
    }
  }
  const url = URL.createObjectURL(blob);
  const a = h('a', { href: url, download: 'askus-results.png' });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
  toast('Image enregistrée', { icon: 'camera' });
}

route();
