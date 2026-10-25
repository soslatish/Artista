// Интерьеры для «Примерить на стену». Рисуются в SVG в едином масштабе и рендерятся в JPG
// скриптом render.mjs. Масштаб: 3.2 px = 1 см, линия пола (низ стены) на y = 860.
// Важное (стена над мебелью и поверхность для скульптуры) — в центре кадра около x = 900:
// на телефоне края сцены обрезаются.
export const W = 1800;
export const H = 1100;
export const FLOOR = 860;
export const K = 3.2;
const cm = (v) => v * K;

const C = {
  plank: '#D6B188',
  plankLine: '#C29B70',
  base: '#FBF6EE',
  wood: '#B88A5E',
  woodDark: '#966B45',
  woodLight: '#D3AD82',
  leaf: '#5E8C61',
  leafDark: '#477650',
  leafLight: '#7AA77A',
  pot: '#F7F3EC',
  potShade: '#E6DED2',
  shade: '#F2E4C4',
  brass: '#B98B52',
  shadow: '#5A4130',
};

const shadow = (cx, cy, rx, ry, o = 0.16) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${C.shadow}" opacity="${o}"/>`;

function wall(color, light) {
  return `
  <defs>
    <linearGradient id="wallg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${light}"/><stop offset="1" stop-color="${color}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.5" cy="0.35" r="0.6">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.35"/><stop offset="1" stop-color="#FFFFFF" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="floorg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#CFA77C"/><stop offset="1" stop-color="${C.plank}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${FLOOR}" fill="url(#wallg)"/>
  <rect width="${W}" height="${FLOOR}" fill="url(#glow)"/>`;
}

function floor() {
  let lines = '';
  for (let x = -600; x <= W + 600; x += 150) {
    const top = W / 2 + (x - W / 2) * 0.55;
    lines += `<line x1="${top}" y1="${FLOOR}" x2="${x}" y2="${H}" stroke="${C.plankLine}" stroke-width="2" opacity="0.55"/>`;
  }
  for (const y of [905, 965, 1040]) lines += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="${C.plankLine}" stroke-width="1.5" opacity="0.35"/>`;
  return `<rect y="${FLOOR}" width="${W}" height="${H - FLOOR}" fill="url(#floorg)"/>${lines}
  <rect y="${FLOOR - cm(8)}" width="${W}" height="${cm(8)}" fill="${C.base}"/>
  <line x1="0" y1="${FLOOR}" x2="${W}" y2="${FLOOR}" stroke="#E4D6C2" stroke-width="3"/>`;
}

const leaf = (x, y, len, wid, ang, fill) =>
  `<g transform="translate(${x} ${y}) rotate(${ang})"><path d="M0 0 Q ${wid} ${-len * 0.45} 0 ${-len} Q ${-wid} ${-len * 0.45} 0 0 Z" fill="${fill}"/><path d="M0 0 L0 ${-len * 0.9}" stroke="#ffffff" stroke-opacity="0.25" stroke-width="2"/></g>`;

/** Фикус: горшок на полу, листья до высоты h см. */
function figPlant(cx, baseY, h = 170) {
  const potH = cm(42);
  const potW = cm(36);
  const top = baseY - cm(h);
  let g = shadow(cx, baseY + 4, potW * 0.7, 10);
  g += `<path d="M${cx - 6} ${baseY - potH + 10} C ${cx - 10} ${top + 200} ${cx + 8} ${top + 120} ${cx} ${top + 40}" stroke="${C.leafDark}" stroke-width="7" fill="none"/>`;
  const leaves = [
    [-1, 0.86, 120, 40, -58],
    [1, 0.8, 125, 42, 55],
    [-1, 0.68, 130, 44, -40],
    [1, 0.6, 135, 45, 38],
    [-1, 0.48, 125, 42, -30],
    [1, 0.4, 120, 42, 28],
    [-1, 0.28, 110, 38, -18],
    [1, 0.18, 105, 36, 16],
    [0, 0.06, 95, 34, 0],
  ];
  leaves.forEach(([side, t, len, wid, ang], i) => {
    const y = top + (baseY - potH - top) * t;
    g += leaf(cx + side * 6, y, len, wid, ang, i % 3 === 0 ? C.leafDark : i % 3 === 1 ? C.leaf : C.leafLight);
  });
  g += `<path d="M${cx - potW / 2} ${baseY - potH} L${cx + potW / 2} ${baseY - potH} L${cx + potW * 0.4} ${baseY} L${cx - potW * 0.4} ${baseY} Z" fill="${C.pot}"/>
  <path d="M${cx + potW * 0.1} ${baseY - potH} L${cx + potW / 2} ${baseY - potH} L${cx + potW * 0.4} ${baseY} L${cx + potW * 0.05} ${baseY} Z" fill="${C.potShade}"/>
  <rect x="${cx - potW / 2 - 6}" y="${baseY - potH - 12}" width="${potW + 12}" height="16" rx="6" fill="${C.pot}"/>`;
  return g;
}

/** Высокая трава / сансевиерия в корзине. */
function grassPlant(cx, baseY, h = 110) {
  const potW = cm(34);
  const potH = cm(32);
  let g = shadow(cx, baseY + 4, potW * 0.7, 9);
  const blades = [-34, -22, -12, -4, 5, 14, 24, 34];
  blades.forEach((a, i) => {
    g += leaf(cx + (i - 3.5) * 6, baseY - potH + 6, cm(h) * (0.65 + ((i * 37) % 30) / 100), 16, a, i % 2 ? C.leaf : C.leafDark);
  });
  g += `<rect x="${cx - potW / 2}" y="${baseY - potH}" width="${potW}" height="${potH}" rx="10" fill="#CDB08A"/>`;
  for (let y = baseY - potH + 14; y < baseY - 6; y += 16) g += `<line x1="${cx - potW / 2 + 6}" y1="${y}" x2="${cx + potW / 2 - 6}" y2="${y}" stroke="#B39470" stroke-width="3"/>`;
  return g;
}

/** Кашпо с ниспадающим растением, висит от потолка. */
function hangingPlant(cx, potY) {
  let g = `<line x1="${cx - 30}" y1="0" x2="${cx - 26}" y2="${potY}" stroke="#C9B79C" stroke-width="3"/><line x1="${cx + 30}" y1="0" x2="${cx + 26}" y2="${potY}" stroke="#C9B79C" stroke-width="3"/>`;
  for (const [dx, len] of [[-40, 190], [-18, 250], [8, 220], [32, 170], [48, 120]]) {
    g += `<path d="M${cx + dx} ${potY + 30} q ${dx > 0 ? 14 : -14} ${len / 2} 0 ${len}" stroke="${C.leafDark}" stroke-width="3" fill="none"/>`;
    for (let i = 1; i < len / 26; i++) {
      const y = potY + 30 + i * 26;
      g += leaf(cx + dx, y, 26, 10, i % 2 ? 60 : -60, i % 2 ? C.leaf : C.leafLight);
    }
  }
  g += `<path d="M${cx - 48} ${potY} L${cx + 48} ${potY} L${cx + 36} ${potY + 48} L${cx - 36} ${potY + 48} Z" fill="${C.pot}"/>`;
  return g;
}

/** Настольная лампа: основание стоит на y. */
function tableLamp(cx, y, h = 55) {
  const shadeH = cm(h * 0.4);
  const shadeTop = y - cm(h);
  return `<path d="M${cx - 18} ${y} Q ${cx - 30} ${y - cm(h * 0.35)} ${cx} ${y - cm(h * 0.6)} Q ${cx + 30} ${y - cm(h * 0.35)} ${cx + 18} ${y} Z" fill="${C.brass}"/>
  <rect x="${cx - 3}" y="${shadeTop + shadeH}" width="6" height="${cm(h * 0.12)}" fill="#8F6A42"/>
  <path d="M${cx - 34} ${shadeTop} L${cx + 34} ${shadeTop} L${cx + 60} ${shadeTop + shadeH} L${cx - 60} ${shadeTop + shadeH} Z" fill="${C.shade}"/>
  <path d="M${cx + 10} ${shadeTop} L${cx + 34} ${shadeTop} L${cx + 60} ${shadeTop + shadeH} L${cx + 26} ${shadeTop + shadeH} Z" fill="#E6D4AE"/>`;
}

/** Торшер на полу. */
function floorLamp(cx, baseY, h = 160) {
  const top = baseY - cm(h);
  return `${shadow(cx, baseY + 3, 50, 7)}<rect x="${cx - 3}" y="${top + 70}" width="6" height="${cm(h) - 70}" fill="#3F3530"/>
  <ellipse cx="${cx}" cy="${baseY - 4}" rx="44" ry="9" fill="#3F3530"/>
  <path d="M${cx - 50} ${top} L${cx + 50} ${top} L${cx + 75} ${top + 90} L${cx - 75} ${top + 90} Z" fill="${C.shade}"/>`;
}

function curtain(x, w) {
  let g = `<rect x="${x - 20}" y="40" width="${w + 40}" height="10" rx="5" fill="#C8B49A"/>`;
  g += `<path d="M${x} 50 L${x + w} 50 L${x + w + 14} ${FLOOR + 10} L${x - 10} ${FLOOR + 10} Z" fill="#EADBC6"/>`;
  for (let i = 1; i < 5; i++) g += `<line x1="${x + (w / 5) * i}" y1="54" x2="${x + (w / 5) * i + i * 2}" y2="${FLOOR + 8}" stroke="#DCCAB2" stroke-width="5"/>`;
  return g;
}

function windowFrame(x, y, w, h, sky = '#E9EEF0') {
  return `<rect x="${x - 14}" y="${y - 14}" width="${w + 28}" height="${h + 28}" rx="6" fill="#FBF8F3"/>
  <rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${sky}"/>
  <path d="M${x} ${y + h} L${x} ${y + h * 0.7} Q ${x + w * 0.3} ${y + h * 0.55} ${x + w * 0.6} ${y + h * 0.68} T ${x + w} ${y + h * 0.62} L${x + w} ${y + h} Z" fill="#C9D8C9"/>
  <rect x="${x + w / 2 - 6}" y="${y}" width="12" height="${h}" fill="#FBF8F3"/>
  <rect x="${x}" y="${y + h * 0.45}" width="${w}" height="12" fill="#FBF8F3"/>
  <rect x="${x - 26}" y="${y + h + 10}" width="${w + 52}" height="16" rx="4" fill="#F3EDE3"/>`;
}

function rug(cx, y1, y2, wTop, wBottom, fill, border) {
  const p = (dx, y) => `${cx + dx} ${y}`;
  return `<path d="M${p(-wTop / 2, y1)} L${p(wTop / 2, y1)} L${p(wBottom / 2, y2)} L${p(-wBottom / 2, y2)} Z" fill="${fill}"/>
  <path d="M${p(-wTop / 2 + 22, y1 + 10)} L${p(wTop / 2 - 22, y1 + 10)} L${p(wBottom / 2 - 34, y2 - 14)} L${p(-wBottom / 2 + 34, y2 - 14)} Z" fill="none" stroke="${border}" stroke-width="4"/>`;
}

function books(x, y, count, maxH = 36) {
  const cols = ['#C46A4E', '#6E8A9E', '#D8B35C', '#7F9C7A', '#A6735A', '#E3D3BC', '#55707F'];
  let g = '';
  let cx = x;
  for (let i = 0; i < count; i++) {
    const w = 14 + ((i * 7) % 10);
    const h = cm(maxH * (0.7 + ((i * 13) % 30) / 100));
    g += `<rect x="${cx}" y="${y - h}" width="${w}" height="${h}" rx="2" fill="${cols[i % cols.length]}"/>`;
    cx += w + 3;
  }
  return g;
}

function svg(body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;
}

// ───────────── Гостиная ─────────────
function living() {
  const top = FLOOR - cm(85); // спинка дивана 85 см
  const sx1 = 900 - cm(105);
  const sx2 = 900 + cm(105);
  const sofa = `
  ${shadow(900, FLOOR + 10, cm(115), 16, 0.18)}
  <rect x="${sx1 + 30}" y="${top}" width="${sx2 - sx1 - 60}" height="${cm(50)}" rx="34" fill="#E9D9C3"/>
  <rect x="${sx1 + 48}" y="${top + 16}" width="${(sx2 - sx1) / 2 - 58}" height="${cm(40)}" rx="28" fill="#F3E8D8"/>
  <rect x="${900 + 10}" y="${top + 16}" width="${(sx2 - sx1) / 2 - 58}" height="${cm(40)}" rx="28" fill="#F3E8D8"/>
  <rect x="${sx1 + 40}" y="${FLOOR - cm(46)}" width="${sx2 - sx1 - 80}" height="${cm(30)}" rx="18" fill="#E2D0B7"/>
  <rect x="${sx1 + 52}" y="${FLOOR - cm(50)}" width="${(sx2 - sx1) / 2 - 62}" height="${cm(12)}" rx="14" fill="#F1E5D3"/>
  <rect x="${900 + 10}" y="${FLOOR - cm(50)}" width="${(sx2 - sx1) / 2 - 62}" height="${cm(12)}" rx="14" fill="#F1E5D3"/>
  <rect x="${sx1}" y="${FLOOR - cm(64)}" width="${cm(24)}" height="${cm(56)}" rx="26" fill="#E6D4BC"/>
  <rect x="${sx2 - cm(24)}" y="${FLOOR - cm(64)}" width="${cm(24)}" height="${cm(56)}" rx="26" fill="#DCC8AD"/>
  <rect x="${sx2 - cm(70)}" y="${top + cm(18)}" width="${cm(40)}" height="${cm(34)}" rx="14" fill="#FBF6EE" transform="rotate(-8 ${sx2 - cm(50)} ${top + cm(35)})"/>
  <rect x="${sx1 + 50}" y="${FLOOR - cm(16)}" width="12" height="${cm(8) + 10}" rx="3" fill="${C.woodDark}"/>
  <rect x="${sx2 - 62}" y="${FLOOR - cm(16)}" width="12" height="${cm(8) + 10}" rx="3" fill="${C.woodDark}"/>`;
  const tableTop = 935;
  const table = `
  ${shadow(900, 1040, 210, 16, 0.2)}
  <rect x="${900 - 205}" y="${tableTop}" width="410" height="22" rx="10" fill="${C.wood}"/>
  <rect x="${900 - 195}" y="${tableTop + 22}" width="390" height="10" fill="${C.woodDark}"/>
  <rect x="${900 - 170}" y="${tableTop + 30}" width="14" height="${1035 - tableTop - 30}" fill="${C.woodDark}"/>
  <rect x="${900 + 156}" y="${tableTop + 30}" width="14" height="${1035 - tableTop - 30}" fill="${C.woodDark}"/>
  <path d="M${900 - 150} ${tableTop} q 40 -46 80 0 Z" fill="#E8DCCB"/>
  <rect x="${900 + 110}" y="${tableTop - 30}" width="34" height="30" rx="5" fill="#FBF6EE"/>
  <path d="M${900 + 144} ${tableTop - 22} q 16 6 0 16" stroke="#FBF6EE" stroke-width="5" fill="none"/>`;
  const sideboard = `
  ${shadow(1450, FLOOR + 10, 170, 10)}
  <rect x="1290" y="${FLOOR - cm(60)}" width="${cm(100)}" height="${cm(48)}" rx="8" fill="${C.woodLight}"/>
  <rect x="1300" y="${FLOOR - cm(55)}" width="${cm(48)}" height="${cm(38)}" rx="5" fill="${C.wood}"/>
  <rect x="${1300 + cm(50)}" y="${FLOOR - cm(55)}" width="${cm(46)}" height="${cm(38)}" rx="5" fill="${C.wood}"/>
  <rect x="1310" y="${FLOOR - cm(12)}" width="10" height="${cm(12)}" fill="${C.woodDark}"/>
  <rect x="${1290 + cm(100) - 20}" y="${FLOOR - cm(12)}" width="10" height="${cm(12)}" fill="${C.woodDark}"/>
  ${tableLamp(1550, FLOOR - cm(60), 50)}
  ${books(1330, FLOOR - cm(60), 4, 22)}`;
  return svg(`${wall('#EFDCC2', '#F7EBDA')}${floor()}
  ${curtain(80, 170)}
  ${rug(900, 885, 1095, 820, 1180, '#EFE4D4', '#E0CFB8')}
  ${figPlant(430, 890, 175)}
  ${sideboard}
  ${hangingPlant(1600, 150)}
  ${sofa}
  ${table}`);
}

// ───────────── Спальня ─────────────
function bedroom() {
  const headTop = FLOOR - cm(105);
  const bx1 = 900 - cm(90);
  const bx2 = 900 + cm(90);
  const bed = `
  ${shadow(900, FLOOR + 14, cm(100), 16, 0.18)}
  <rect x="${bx1 - 20}" y="${headTop}" width="${bx2 - bx1 + 40}" height="${FLOOR - headTop}" rx="36" fill="#C9D3C2"/>
  <rect x="${bx1}" y="${headTop + 20}" width="${bx2 - bx1}" height="${cm(40)}" rx="26" fill="#D7DFCF"/>
  <rect x="${bx1 + 30}" y="${FLOOR - cm(70)}" width="${(bx2 - bx1) / 2 - 45}" height="${cm(26)}" rx="22" fill="#FBF8F2"/>
  <rect x="${900 + 15}" y="${FLOOR - cm(70)}" width="${(bx2 - bx1) / 2 - 45}" height="${cm(26)}" rx="22" fill="#FBF8F2"/>
  <rect x="${900 - 70}" y="${FLOOR - cm(62)}" width="140" height="${cm(20)}" rx="18" fill="#E7B9A2"/>
  <rect x="${bx1 - 10}" y="${FLOOR - cm(50)}" width="${bx2 - bx1 + 20}" height="${cm(42)}" rx="18" fill="#F2EBE0"/>
  <path d="M${bx1 - 10} ${FLOOR - cm(36)} L${bx2 + 10} ${FLOOR - cm(36)} L${bx2 + 10} ${FLOOR - cm(10)} Q 900 ${FLOOR + 6} ${bx1 - 10} ${FLOOR - cm(10)} Z" fill="#E3D6C3"/>
  <line x1="${bx1 - 10}" y1="${FLOOR - cm(36)}" x2="${bx2 + 10}" y2="${FLOOR - cm(36)}" stroke="#D2C2AA" stroke-width="4"/>`;
  const stand = (x) => `
  ${shadow(x + cm(22), FLOOR + 8, cm(28), 8)}
  <rect x="${x}" y="${FLOOR - cm(55)}" width="${cm(44)}" height="${cm(45)}" rx="8" fill="${C.woodLight}"/>
  <rect x="${x + 10}" y="${FLOOR - cm(48)}" width="${cm(44) - 20}" height="${cm(16)}" rx="4" fill="${C.wood}"/>
  <circle cx="${x + cm(22)}" cy="${FLOOR - cm(40)}" r="5" fill="${C.woodDark}"/>
  <rect x="${x + 10}" y="${FLOOR - cm(10)}" width="10" height="${cm(10)}" fill="${C.woodDark}"/>
  <rect x="${x + cm(44) - 20}" y="${FLOOR - cm(10)}" width="10" height="${cm(10)}" fill="${C.woodDark}"/>
  ${tableLamp(x + cm(22), FLOOR - cm(55), 48)}`;
  const benchTop = 955;
  const bench = `
  ${shadow(900, 1050, 240, 14, 0.2)}
  <rect x="${900 - 230}" y="${benchTop}" width="460" height="${cm(12)}" rx="16" fill="#D7B9A0"/>
  <rect x="${900 - 210}" y="${benchTop + cm(12)}" width="12" height="${1045 - benchTop - cm(12)}" fill="${C.woodDark}"/>
  <rect x="${900 + 198}" y="${benchTop + cm(12)}" width="12" height="${1045 - benchTop - cm(12)}" fill="${C.woodDark}"/>
  <path d="M${900 + 60} ${benchTop + 4} L${900 + 210} ${benchTop + 4} L${900 + 200} ${benchTop + 70} L${900 + 80} ${benchTop + 60} Z" fill="#B8C4B0" opacity="0.9"/>`;
  return svg(`${wall('#D9E0D0', '#E8EDE1')}${floor()}
  ${windowFrame(130, 190, 230, 380)}
  ${rug(900, 885, 1095, 900, 1260, '#EDE6DA', '#D9CDBB')}
  ${stand(bx1 - cm(60))}
  ${stand(bx2 + cm(16))}
  ${grassPlant(1560, 885, 115)}
  ${bed}
  ${bench}`);
}

// ───────────── Кабинет ─────────────
function office() {
  const deskTop = FLOOR - cm(75);
  const dx1 = 900 - cm(80);
  const dx2 = 900 + cm(80);
  const shelf = () => {
    const x = 170;
    const w = cm(80);
    const t = FLOOR - cm(190);
    let g = `${shadow(x + w / 2, FLOOR + 8, w * 0.6, 8)}<rect x="${x}" y="${t}" width="${w}" height="${FLOOR - t}" rx="6" fill="${C.woodLight}"/>`;
    for (let i = 0; i < 5; i++) {
      const y = t + 14 + i * cm(36);
      g += `<rect x="${x + 12}" y="${y}" width="${w - 24}" height="${cm(34)}" fill="#C79F74"/>`;
      g += books(x + 20 + (i % 2) * 30, y + cm(34), 6 + (i % 3), 28);
    }
    return g;
  };
  const desk = `
  ${shadow(900, FLOOR + 10, cm(90), 12, 0.18)}
  <rect x="${dx1}" y="${deskTop}" width="${dx2 - dx1}" height="${cm(5)}" rx="4" fill="${C.wood}"/>
  <rect x="${dx1 + 14}" y="${deskTop + cm(5)}" width="12" height="${cm(70)}" fill="${C.woodDark}"/>
  <rect x="${dx2 - 26}" y="${deskTop + cm(5)}" width="12" height="${cm(70)}" fill="${C.woodDark}"/>
  <rect x="${dx2 - cm(45)}" y="${deskTop + cm(5)}" width="${cm(40)}" height="${cm(52)}" rx="4" fill="${C.woodLight}"/>
  <rect x="${dx2 - cm(42)}" y="${deskTop + cm(10)}" width="${cm(34)}" height="${cm(18)}" rx="3" fill="${C.wood}"/>
  <rect x="${dx2 - cm(42)}" y="${deskTop + cm(32)}" width="${cm(34)}" height="${cm(18)}" rx="3" fill="${C.wood}"/>
  ${tableLamp(dx1 + 70, deskTop, 45)}
  ${books(dx1 + 140, deskTop, 3, 26)}
  <rect x="${dx2 - cm(48)}" y="${deskTop - cm(2)}" width="${cm(34)}" height="${cm(2)}" rx="2" fill="#8E9AA3"/>`;
  const chair = `
  ${shadow(1080, 1032, 120, 12, 0.2)}
  <rect x="${1080 - cm(23)}" y="${FLOOR - cm(70)}" width="${cm(46)}" height="${cm(44)}" rx="28" fill="#7E8F8A"/>
  <rect x="${1080 - cm(19)}" y="${FLOOR - cm(66)}" width="${cm(38)}" height="${cm(34)}" rx="22" fill="#8C9D98"/>
  <rect x="1074" y="${FLOOR - cm(26)}" width="12" height="40" fill="#3F3530"/>
  <rect x="${1080 - cm(26)}" y="${FLOOR - cm(30)}" width="${cm(52)}" height="${cm(12)}" rx="16" fill="#6F807B"/>
  <rect x="1074" y="${FLOOR - cm(18)}" width="12" height="${1000 - (FLOOR - cm(18))}" fill="#3F3530"/>
  <path d="M1080 1000 L990 1022 M1080 1000 L1170 1022 M1080 1000 L1040 1030 M1080 1000 L1120 1030" stroke="#3F3530" stroke-width="9" stroke-linecap="round"/>
  ${[990, 1170, 1040, 1120].map((x, i) => `<circle cx="${x}" cy="${i < 2 ? 1026 : 1034}" r="8" fill="#2E2724"/>`).join('')}`;
  return svg(`${wall('#E5DFD6', '#F0ECE6')}${floor()}
  ${shelf()}
  ${windowFrame(1360, 170, 230, 360)}
  ${rug(900, 890, 1095, 760, 1100, '#E6E0D6', '#CFC4B4')}
  ${figPlant(1500, 890, 150)}
  ${desk}
  ${chair}`);
}

// ───────────── Столовая ─────────────
function dining() {
  const tableTop = 735;
  const tx1 = 900 - cm(90);
  const tx2 = 900 + cm(90);
  const chair = (cx, flip) => `
  ${shadow(cx, 990, 80, 10, 0.18)}
  <rect x="${cx - cm(22)}" y="${tableTop - cm(32)}" width="${cm(44)}" height="${cm(52)}" rx="18" fill="${C.woodLight}"/>
  <rect x="${cx - cm(18)}" y="${tableTop - cm(26)}" width="${cm(36)}" height="${cm(30)}" rx="12" fill="#E8D5BC"/>
  <rect x="${cx - cm(24)}" y="${tableTop + cm(20)}" width="${cm(48)}" height="${cm(8)}" rx="6" fill="${C.wood}"/>
  <rect x="${cx - cm(20)}" y="${tableTop + cm(28)}" width="10" height="${985 - tableTop - cm(28)}" fill="${C.woodDark}" transform="rotate(${flip ? 4 : -4} ${cx} 985)"/>
  <rect x="${cx + cm(20) - 10}" y="${tableTop + cm(28)}" width="10" height="${985 - tableTop - cm(28)}" fill="${C.woodDark}" transform="rotate(${flip ? -4 : 4} ${cx} 985)"/>`;
  const table = `
  ${shadow(900, 985, cm(100), 14, 0.2)}
  <rect x="${tx1}" y="${tableTop}" width="${tx2 - tx1}" height="${cm(6)}" rx="6" fill="${C.wood}"/>
  <rect x="${tx1 + 20}" y="${tableTop + cm(6)}" width="${tx2 - tx1 - 40}" height="${cm(6)}" fill="${C.woodDark}"/>
  <path d="M${tx1 + 50} ${tableTop + cm(12)} L${tx1 + 30} 980 L${tx1 + 46} 980 L${tx1 + 70} ${tableTop + cm(12)} Z" fill="${C.woodDark}"/>
  <path d="M${tx2 - 50} ${tableTop + cm(12)} L${tx2 - 30} 980 L${tx2 - 46} 980 L${tx2 - 70} ${tableTop + cm(12)} Z" fill="${C.woodDark}"/>
  <rect x="${tx1 + 60}" y="${tableTop - cm(18)}" width="${cm(12)}" height="${cm(18)}" rx="10" fill="#FBF6EE"/>
  ${leaf(tx1 + 60 + cm(6), tableTop - cm(18), 70, 18, -20, C.leaf)}${leaf(tx1 + 60 + cm(6), tableTop - cm(18), 80, 18, 14, C.leafDark)}
  <circle cx="${tx1 + 60 + cm(6) - 26}" cy="${tableTop - cm(18) - 64}" r="12" fill="#E7B9A2"/><circle cx="${tx1 + 60 + cm(6) + 22}" cy="${tableTop - cm(18) - 74}" r="10" fill="#F2D27A"/>
  <path d="M${tx2 - 190} ${tableTop} q 70 -50 140 0 Z" fill="#E8DCCB"/>
  <circle cx="${tx2 - 140}" cy="${tableTop - 18}" r="14" fill="#E39A5E"/><circle cx="${tx2 - 112}" cy="${tableTop - 22}" r="14" fill="#C9C15E"/><circle cx="${tx2 - 90}" cy="${tableTop - 14}" r="12" fill="#D9604C"/>`;
  const shelves = `
  <rect x="1360" y="${FLOOR - cm(170)}" width="${cm(80)}" height="10" rx="4" fill="${C.wood}"/>
  <rect x="1360" y="${FLOOR - cm(125)}" width="${cm(80)}" height="10" rx="4" fill="${C.wood}"/>
  <rect x="1380" y="${FLOOR - cm(170) - cm(26)}" width="${cm(16)}" height="${cm(26)}" rx="8" fill="#F7F3EC"/>
  <rect x="1450" y="${FLOOR - cm(170) - cm(20)}" width="${cm(20)}" height="${cm(20)}" rx="30" fill="#D7B9A0"/>
  <rect x="1540" y="${FLOOR - cm(170) - cm(30)}" width="${cm(10)}" height="${cm(30)}" rx="6" fill="#9FB3B9"/>
  ${books(1380, FLOOR - cm(125), 7, 22)}`;
  return svg(`${wall('#EDD5C2', '#F6E6D9')}${floor()}
  ${windowFrame(140, 170, 240, 400)}
  ${shelves}
  ${grassPlant(1520, 885, 120)}
  ${chair(tx1 - cm(10), false)}
  ${chair(tx2 + cm(10), true)}
  ${table}`);
}

// ───────────── Прихожая ─────────────
function hallway() {
  const top = FLOOR - cm(80);
  const cx1 = 900 - cm(65);
  const cx2 = 900 + cm(65);
  const consoleTable = `
  ${shadow(900, FLOOR + 10, cm(75), 10, 0.18)}
  <rect x="${cx1}" y="${top}" width="${cx2 - cx1}" height="${cm(5)}" rx="4" fill="${C.wood}"/>
  <rect x="${cx1 + 10}" y="${top + cm(5)}" width="${cx2 - cx1 - 20}" height="${cm(12)}" rx="3" fill="${C.woodLight}"/>
  <path d="M${cx1 + 20} ${top + cm(17)} L${cx1 + 10} ${FLOOR + 6} L${cx1 + 24} ${FLOOR + 6} L${cx1 + 34} ${top + cm(17)} Z" fill="${C.woodDark}"/>
  <path d="M${cx2 - 20} ${top + cm(17)} L${cx2 - 10} ${FLOOR + 6} L${cx2 - 24} ${FLOOR + 6} L${cx2 - 34} ${top + cm(17)} Z" fill="${C.woodDark}"/>
  <rect x="${cx1 + 34}" y="${FLOOR - cm(18)}" width="${cx2 - cx1 - 68}" height="8" fill="${C.woodDark}"/>
  <rect x="${cx1 + 70}" y="${FLOOR - cm(18) - cm(24)}" width="${cm(38)}" height="${cm(24)}" rx="10" fill="#CDB08A"/>
  <rect x="${cx2 - 70 - cm(38)}" y="${FLOOR - cm(18) - cm(24)}" width="${cm(38)}" height="${cm(24)}" rx="10" fill="#CDB08A"/>
  <rect x="${cx1 + 40}" y="${top - cm(30)}" width="${cm(14)}" height="${cm(30)}" rx="18" fill="#9FB3B9"/>
  <path d="M${cx1 + 40 + cm(7)} ${top - cm(30)} q -20 -90 -40 -140 M${cx1 + 40 + cm(7)} ${top - cm(30)} q 10 -100 30 -150 M${cx1 + 40 + cm(7)} ${top - cm(30)} q 4 -70 -6 -120" stroke="#8C7A60" stroke-width="4" fill="none"/>
  <path d="M${cx2 - 150} ${top} q 50 -30 100 0 Z" fill="#E8DCCB"/>`;
  const hooks = `
  <rect x="200" y="${FLOOR - cm(175)}" width="${cm(70)}" height="16" rx="6" fill="${C.wood}"/>
  ${[0, 1, 2].map((i) => `<circle cx="${230 + i * 70}" cy="${FLOOR - cm(175) + 24}" r="7" fill="${C.brass}"/>`).join('')}
  <path d="M230 ${FLOOR - cm(175) + 26} q -36 8 -46 40 l -14 ${cm(78)} q 60 14 120 0 l -14 ${-cm(78)} q -10 -32 -46 -40 Z" fill="#B6876A"/>
  <path d="M230 ${FLOOR - cm(175) + 34} l -16 ${cm(70)} M230 ${FLOOR - cm(175) + 34} l 16 ${cm(70)}" stroke="#A07457" stroke-width="4"/>
  <path d="M370 ${FLOOR - cm(175) + 26} q -24 10 -28 40 q -6 70 6 ${cm(52)} q 22 8 44 0 q 12 -70 6 ${-cm(40)} q -4 -30 -28 -40 Z" fill="#7E8F8A"/>
  <path d="M352 ${FLOOR - cm(175) + 60} q 18 30 36 0" stroke="#6C7C78" stroke-width="5" fill="none"/>
  ${shadow(330, FLOOR + 6, 70, 7)}
  <rect x="${300}" y="${FLOOR - cm(45)}" width="${cm(22)}" height="${cm(45)}" rx="8" fill="#C9B79C"/>
  <line x1="320" y1="${FLOOR - cm(45)}" x2="310" y2="${FLOOR - cm(95)}" stroke="#3F3530" stroke-width="6"/>`;
  return svg(`${wall('#DCE2E4', '#EAEEEF')}${floor()}
  ${hooks}
  ${rug(900, 900, 1095, 380, 560, '#D9C9B4', '#C2AE93')}
  ${figPlant(1430, 890, 160)}
  ${floorLamp(1620, 880, 165)}
  ${consoleTable}`);
}

/**
 * Сцены и их геометрия (в пикселях исходника): wallX — где по умолчанию висит работа,
 * surface — где стоит скульптура (центр по x и верх поверхности по y).
 */
export const scenes = {
  living: { draw: living, wallX: 900, surface: { x: 900, y: 935 } },
  bedroom: { draw: bedroom, wallX: 900, surface: { x: 840, y: 955 } },
  office: { draw: office, wallX: 900, surface: { x: 880, y: FLOOR - cm(75) } },
  dining: { draw: dining, wallX: 900, surface: { x: 900, y: 735 } },
  hallway: { draw: hallway, wallX: 900, surface: { x: 900, y: FLOOR - cm(80) } },
};
