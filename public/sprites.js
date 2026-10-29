'use strict';

// Hand-drawn pixel sprites. Each row is a string; each character maps to a
// colour in the sprite's palette ('.' is transparent). Shared by the DOM
// (rendered as crisp SVG) and the results-image canvas.

const INK = '#0f1015';
const BASE = { k: INK, w: '#f2efe6', p: '#ff9eb5', o: '#ffa53d', y: '#ffd966', r: '#ff5c7a', g: '#5fd38d' };

const SPRITES = {
  // ---- avatars (12×12)
  cat: { pal: { b: '#c98a4b', p: '#c98a4b' }, rows: [
    '............', '.k........k.', '.kk......kk.', '.kbk....kbk.', '.kbbkkkkbbk.', 'kbbbbbbbbbbk',
    'kbbkbbbbkbbk', 'kbbkbbbbkbbk', 'kpbbbkkbbbpk', 'kbbbbbbbbbbk', '.kbbbbbbbbk.', '..kkkkkkkk..'] },
  kitty: { pal: { b: '#6f6a8c', p: '#a0607a' }, rows: [
    '............', '.k........k.', '.kk......kk.', '.kpk....kpk.', '.kbbkkkkbbk.', 'kbbbbbbbbbbk',
    'kbwkbbbbwkbk', 'kbkkbbbbkkbk', 'kpbbbkkbbbpk', 'kbbbbbbbbbbk', '.kbbbbbbbbk.', '..kkkkkkkk..'] },
  frog: { pal: { b: '#6aa85a', l: '#b9d49a', p: '#6aa85a' }, rows: [
    '.kkk....kkk.', 'kwkbk..kwkbk', 'kbbbkkkkbbbk', 'kbbbbbbbbbbk', 'kbbbbbbbbbbk', 'kpbbbbbbbbpk',
    'kbbkkkkkkbbk', 'kbbbbbbbbbbk', '.kllllllllk.', '.kllllllllk.', '.kbbkkkkbbk.', '..kk....kk..'] },
  bunny: { pal: { b: '#d8d2e0', p: '#b08a98' }, rows: [
    '..kk....kk..', '.kbpk..kpbk.', '.kbpk..kpbk.', '.kbpk..kpbk.', '.kbbkkkkbbk.', 'kbbbbbbbbbbk',
    'kbbkbbbbkbbk', 'kbbkbbbbkbbk', 'kpbbbkkbbbpk', 'kbbbbbbbbbbk', '.kbbbbbbbbk.', '..kkkkkkkk..'] },
  bear: { pal: { b: '#8a6046', l: '#c4a07c', p: '#6e4a35' }, rows: [
    '............', '.kkk....kkk.', 'kbpbkkkkbpbk', 'kbbbbbbbbbbk', 'kbbbbbbbbbbk', 'kbbkbbbbkbbk',
    'kbbkbbbbkbbk', 'kbbbllllbbbk', 'kpbblkklbbpk', 'kbbbllllbbbk', '.kbbbbbbbbk.', '..kkkkkkkk..'] },
  chick: { pal: { b: '#d9b84a', p: '#d9b84a' }, rows: [
    '............', '....kkkk....', '...kbbbbk...', '..kbbbbbbk..', '.kbbkbbkbbk.', '.kbbkbbkbbk.',
    'kbpbboobbpbk', 'kbbbbbbbbbbk', 'kbbbbbbbbbbk', '.kbbbbbbbbk.', '..kkkkkkkk..', '...oo..oo...'] },
  ghost: { pal: { b: '#d8dbe4', p: '#d8dbe4' }, rows: [
    '...kkkkkk...', '..kbbbbbbk..', '.kbbbbbbbbk.', '.kbbkbbkbbk.', '.kbbkbbkbbk.', '.kpbbbbbbpk.',
    '.kbbbkkbbbk.', '.kbbbbbbbbk.', '.kbbbbbbbbk.', '.kbbbbbbbbk.', '.kbkbkkbkbk.', '..k.k..k.k..'] },
  slime: { pal: { b: '#4f93b8', l: '#a9cfe0', p: '#4f93b8' }, rows: [
    '............', '............', '.....kk.....', '....kbbk....', '...kblbbk...', '..kblbbbbk..',
    '.kbbkbbkbbk.', '.kbbkbbkbbk.', 'kbpbbbbbbpbk', 'kbbbbkkbbbbk', 'kbbbbbbbbbbk', '.kkkkkkkkkk.'] },
  robot: { pal: { b: '#9aa3b3', p: '#d9574a' }, rows: [
    '.....kk.....', '.....pk.....', '..kkkkkkkk..', '.kbbbbbbbbk.', '.kbkkbbkkbk.', '.kbkwbbkwbk.',
    '.kbbbbbbbbk.', 'kkbkkkkkkbkk', '.kbbbbbbbbk.', '.kkkkkkkkkk.', '..kb....bk..', '..kk....kk..'] },
  mushroom: { pal: { b: '#c4544a', l: '#e3d6c0', p: '#e3d6c0' }, rows: [
    '...kkkkkk...', '..kbbwwbbk..', '.kbwwbbbwbk.', 'kbbwbbbbwwbk', 'kbbbbbbbbbbk', 'kkkkkkkkkkkk',
    '..kllllllk..', '..klkllklk..', '..kpllllpk..', '..kllllllk..', '..kllllllk..', '...kkkkkk...'] },
  penguin: { pal: { b: '#2f3046', p: '#ffffff' }, rows: [
    '...kkkkkk...', '..kbbbbbbk..', '.kbbwwbwwbk.', '.kbwkwwkwbk.', '.kbwwoowwbk.', 'kbpwwwwwwpbk',
    'kbbwwwwwwbbk', 'kbbwwwwwwbbk', '.kbwwwwwwbk.', '.kbbwwwwbbk.', '..kkkkkkkk..', '..oo....oo..'] },
  fox: { pal: { b: '#d0763a', l: '#ede3d6' }, rows: [
    'k..........k', 'kk........kk', 'kbk......kbk', 'kbbkkkkkkbbk', 'kbbbbbbbbbbk', 'kbbkbbbbkbbk',
    'klbkbbbbkblk', 'kllbbbbbbllk', 'kllllkkllllk', '.kllllllllk.', '..kllllllk..', '...kkkkkk...'] },

  // ---- icons
  coin: { rows: ['..kkkk..', '.kyyyyk.', 'kyywyyok', 'kywyyyok', 'kywyyyok', 'kyyyyook', '.kyoook.', '..kkkk..'],
    pal: { y: '#ffd966', o: '#e8a317', w: '#fff6c2' } },
  heart: { rows: ['.kk..kk.', 'krrkkrrk', 'krwrrrrk', 'krrrrrrk', '.krrrrk.', '..krrk..', '...kk...'] },
  flame: { rows: ['...k....', '..kok...', '..kook..', '.kooook.', '.koyook.', 'kooyyook', 'koyyyyok', '.kyyyyk.', '..kkkk..'],
    pal: { o: '#ff7a3d' } },
  crown: { rows: ['k...k...k', 'kk.kyk.kk', 'kykyyykyk', 'kyyyyyyyk', 'kyryyyryk', 'kyyyyyyyk', 'kkkkkkkkk'] },
  star: { rows: ['....k....', '...kyk...', 'kkkyyykkk', 'kyyyyyyyk', '.kyyyyyk.', '..kyyyk..', '.kyykyyk.', '.kyk.kyk.', '.kk...kk.'] },
  chat: { rows: ['.kkkkkkk.', 'kwwwwwwwk', 'kwkwkwkwk', 'kwwwwwwwk', '.kwkkkkk.', '.kk......'] },
  camera: { rows: ['...kkkk...', 'kkkggggkkk', 'kgggkkgggk', 'kggkwbkggk', 'kggkbbkggk', 'kgggkkgggk', 'kkkkkkkkkk'],
    pal: { g: '#d9d2f2', b: '#6ec6ff' } },
  plus: { rows: ['..kkk..', '..kwk..', 'kkkwkkk', 'kwwwwwk', 'kkkwkkk', '..kwk..', '..kkk..'] },
  back: { rows: ['...k....', '..kk....', '.kwkkkkk', 'kwwwwwwk', '.kwkkkkk', '..kk....', '...k....'] },
  next: { rows: ['....k...', '....kk..', 'kkkkkwk.', 'kwwwwwwk', 'kkkkkwk.', '....kk..', '....k...'] },
  up: { rows: ['...k...', '..kwk..', '.kwwwk.', 'kkkwkkk', '..kwk..', '..kwk..', '..kkk..'] },
  check: { rows: ['......kk', '.....kgk', 'kk..kgk.', 'kgkkgk..', '.kggk...', '..kk....'] },
  eye: { rows: ['..kkkkk..', '.kwwwwwk.', 'kwwkkkwwk', 'kwwkbkwwk', '.kwwwwwk.', '..kkkkk..'], pal: { b: '#6ec6ff' } },
  gift: { rows: ['..kk.kk..', '.krrkrrk.', 'kkkkkkkkk', 'kppprpppk', 'kkkkrkkkk', '.kpprppk.', '.kpprppk.', '.kpprppk.', '.kkkkkkk.'],
    pal: { p: '#b48cff' } },
  calendar: { rows: ['.k.....k.', 'kkkkkkkkk', 'krrrrrrrk', 'kkkkkkkkk', 'kwwwwwwwk', 'kwkwkwkwk', 'kwwwwwwwk', 'kwkwkwwwk', 'kkkkkkkkk'] },
  pencil: { rows: ['.......kk', '......kpk', '.....kyk.', '....kyk..', '...kyk...', '..kyk....', '.kwk.....', 'kkk......'] },
  clock: { rows: ['..kkkkk..', '.kwwwwwk.', 'kwwwkwwwk', 'kwwwkwwwk', 'kwwwkkkwk', 'kwwwwwwwk', '.kwwwwwk.', '..kkkkk..'] },
  key: { rows: ['.kkk......', 'kyyykkkkkk', 'kykykyyyyk', 'kyyykkykyk', '.kkk..kkk.'] },
  question: { rows: ['kkkkkkkkk', 'koyyyyyok', 'kyykkkyyk', 'kyyyyykyk', 'kyyykkyyk', 'kyyykyyyk', 'kyyyyyyyk', 'koyykyyok', 'kkkkkkkkk'],
    pal: { o: '#e8a317' } },
  flag: { rows: ['kkkkk...', 'krrrrkkk', 'krrrrrrk', 'krrrrrrk', 'kkkkrrrk', 'k..kkkkk', 'k.......', 'k.......', 'k.......'] },
};

const AVATAR_IDS = ['cat', 'frog', 'bunny', 'bear', 'chick', 'ghost', 'slime', 'robot', 'mushroom', 'penguin', 'fox', 'kitty'];
const GROUP_ICONS = ['star', 'heart', 'flame', 'crown', 'chat', 'gift', 'coin', 'question', 'flag', 'cat', 'frog', 'mushroom', 'ghost', 'slime', 'chick', 'bunny'];

const isSprite = (name) => Object.prototype.hasOwnProperty.call(SPRITES, name);

function spriteColor(sprite, ch) {
  return (sprite.pal && sprite.pal[ch]) || BASE[ch];
}

// Merges horizontal runs of the same colour into single rects to keep the SVG small.
function spriteRects(name) {
  const sprite = SPRITES[name];
  const rects = [];
  sprite.rows.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      const ch = row[x];
      let end = x + 1;
      while (end < row.length && row[end] === ch) end++;
      if (ch !== '.') rects.push({ x, y, w: end - x, fill: spriteColor(sprite, ch) });
      x = end;
    }
  });
  return { rects, width: Math.max(...sprite.rows.map((r) => r.length)), height: sprite.rows.length };
}

const SVG_NS = 'http://www.w3.org/2000/svg';
const svgCache = new Map();

// Returns an <svg> element for a sprite; `px` is the size of one sprite pixel in CSS px.
function spriteSvg(name, px = 2, cls = 'px-icon') {
  if (!svgCache.has(name)) svgCache.set(name, spriteRects(name));
  const { rects, width, height } = svgCache.get(name);
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('width', width * px);
  svg.setAttribute('height', height * px);
  svg.setAttribute('shape-rendering', 'crispEdges');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', cls);
  for (const r of rects) {
    const rect = document.createElementNS(SVG_NS, 'rect');
    rect.setAttribute('x', r.x);
    rect.setAttribute('y', r.y);
    rect.setAttribute('width', r.w);
    rect.setAttribute('height', 1);
    rect.setAttribute('fill', r.fill);
    svg.append(rect);
  }
  return svg;
}

function drawSprite(ctx, name, x, y, px) {
  if (!isSprite(name)) return;
  if (!svgCache.has(name)) svgCache.set(name, spriteRects(name));
  for (const r of svgCache.get(name).rects) {
    ctx.fillStyle = r.fill;
    ctx.fillRect(x + r.x * px, y + r.y * px, r.w * px, px);
  }
}
