// Géométrie du terrain en perspective (caméra "derrière l'attaquant", face au but).
// Coordonnées monde en mètres : x = latéral (0 = axe), d = distance à la ligne de but, z = hauteur.
// Le SVG du terrain et les éléments HTML (cartes, ballon) utilisent la même projection,
// donc tout reste aligné quelle que soit la taille de l'écran.

export const VB = { w: 1000, h: 700 }
const CAM = { dist: 20, height: 4.5, focal: 489, horizon: 140, cx: 500 }

export function project(x, d, z = 0) {
  const dist = Math.max(0.6, CAM.dist - d)
  return { x: CAM.cx + (CAM.focal * x) / dist, y: CAM.horizon + (CAM.focal * (CAM.height - z)) / dist }
}

// Le SVG est rendu en "xMidYMid slice" : même transformation pour les overlays HTML.
export function stageMap(W, H) {
  const s = Math.max(W / VB.w, H / VB.h)
  const ox = (W - VB.w * s) / 2
  const oy = (H - VB.h * s) / 2
  return { s, px: (p) => ({ x: ox + p.x * s, y: oy + p.y * s }) }
}

const pts = (list) => list.map(([x, d, z]) => { const p = project(x, d, z); return `${p.x.toFixed(1)},${p.y.toFixed(1)}` }).join(' ')

// Formes du terrain (calculées une fois).
export function buildPitch() {
  const stripes = []
  const edges = [-0.01, 2, 4.5, 7, 9.5, 12, 14.5, 16.4, 18.2]
  for (let i = 0; i < edges.length - 1; i++) {
    stripes.push(pts([[-60, edges[i]], [60, edges[i]], [60, edges[i + 1]], [-60, edges[i + 1]]]))
  }
  const G = 3.66 // demi-largeur du but
  const H = 2.44 // hauteur du but
  return {
    behind: pts([[-60, -9], [60, -9], [60, 0], [-60, 0]]),
    stripes,
    goalLine: pts([[-60, 0], [60, 0]]),
    sixYard: pts([[-9.16, 0], [-9.16, 5.5], [9.16, 5.5], [9.16, 0]]),
    box: pts([[-20.16, 0], [-20.16, 16.5], [20.16, 16.5], [20.16, 0]]),
    spot: project(0, 11),
    arc: pts(Array.from({ length: 25 }, (_, i) => {
      const a = (-60 + (i * 120) / 24) * (Math.PI / 180)
      return [Math.sin(a) * 9.15, 11 + Math.cos(a) * 9.15]
    }).filter(([, d]) => d >= 16.5)),
    // panneaux LED derrière le but
    boards: pts([[-60, -3.2, 0], [60, -3.2, 0], [60, -3.2, 0.95], [-60, -3.2, 0.95]]),
    boardsTop: project(0, -3.2, 0.95).y,
    boardsBottom: project(0, -3.2, 0).y,
    // le but : cadre avant + filets (fond, côtés, toit)
    netBack: pts([[-G, -2, 0], [G, -2, 0], [G, -1.3, H - 0.2], [-G, -1.3, H - 0.2]]),
    netLeft: pts([[-G, 0, 0], [-G, -2, 0], [-G, -1.3, H - 0.2], [-G, 0, H]]),
    netRight: pts([[G, 0, 0], [G, -2, 0], [G, -1.3, H - 0.2], [G, 0, H]]),
    netRoof: pts([[-G, 0, H], [G, 0, H], [G, -1.3, H - 0.2], [-G, -1.3, H - 0.2]]),
    posts: pts([[-G, 0, 0], [-G, 0, H], [G, 0, H], [G, 0, 0]]),
    goalCenter: project(0, -0.6, 1.2),
  }
}

// Points d'intérêt en coordonnées écran (px) pour une scène de taille W×H.
export function stageLayout(W, H) {
  const m = stageMap(W, H)
  const P = (x, d, z = 0) => m.px(project(x, d, z))
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v))
  const kw = clamp(Math.min(W * 0.1, H * 0.17), 76, 150) // largeur carte gardien
  const aw = clamp(Math.min(W * 0.15, H * 0.235), 104, 212) // largeur carte attaquant
  const keeperFeet = P(0, 2.4)
  const atkFeet = P(0, 13.8)
  const kh = kw * (4.1 / 3)
  const ah = aw * (4.1 / 3)
  const keeper = { x: keeperFeet.x, y: keeperFeet.y - kh / 2, w: kw, h: kh }
  const attacker = { x: atkFeet.x, y: atkFeet.y - ah / 2, w: aw, h: ah }
  return {
    W, H, keeper, attacker,
    clash: { x: (keeper.x + attacker.x) / 2, y: (keeper.y + keeper.h / 2 + attacker.y - attacker.h / 2) / 2 },
    ball: { x: atkFeet.x + aw * 0.22, y: atkFeet.y - 4 },
    targets: {
      tl: P(-3.05, -0.2, 2.15), tr: P(3.05, -0.2, 2.15),
      bl: P(-3.2, -0.2, 0.35), br: P(3.2, -0.2, 0.35),
      top: P(0.6, -0.4, 2.2),
      over: P(1.4, -1.5, 3.9), wideL: P(-5.2, -0.5, 0.5), wideR: P(5.2, -0.5, 0.5),
      keeper: { x: keeper.x, y: keeper.y },
      goal: P(0, -0.6, 1.2),
    },
  }
}
