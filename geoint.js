'use strict';

// ═══════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════
const COLORS = ['#00d4ff','#ff5f2e','#a259ff','#7fff6e','#ffc107','#ff4d8a'];

const TILES = {
  osm: {
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attr: '© OpenStreetMap',
    cls: '',
  },
  sat: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attr: '© Esri, Maxar, GeoEye',
    cls: 'tile-satellite',
  },
  topo: {
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attr: '© OpenTopoMap',
    cls: 'tile-topo',
  },
};

// ═══════════════════════════════════════
//  STATE
// ═══════════════════════════════════════
const S = {
  map: null,
  tileLayer: null,
  tileKey: 'osm',
  layerGroup: null,
  intersectionLayer: null,
  heatLayer: null,
  heatVisible: false,
  searchCenter: null,
  searchRadius: 5,
  searchPinLayer: null,
  pinMode: false,
  bearingMode: false,
  bearingAngle: 0,
  bearingLayer: null,
  bearingCenter: null,
  exifCoords: null,
  exifDatetime: null,
  photoUrl: null,
  clues: [],
  nextId: 1,
  allPoints: [],
  sunLayer: null,
  sunActive: false,
  region: null,
  distConstraints: [],
};

// ═══════════════════════════════════════
//  TAG DICTIONARY
// ═══════════════════════════════════════
// ── TAG DICTIONARY (flat, built from grouped JSON at runtime) ──
// TAG DICTIONARY — загружается из tags.json
let TAGS = [];
let TIER_COLORS = {};

async function loadTags() {
  const input = document.getElementById('clueInput');
  const btn   = document.getElementById('btnAdd');
  const hint  = document.getElementById('hintText');

  // Блокируем поле пока словарь не загружен
  input.disabled = true;
  input.placeholder = 'загрузка словаря...';
  btn.disabled = true;

  try {
    const res = await fetch('tags.json');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    TAGS = json.flatMap(g => g.entries);
    S.tagsDict = TAGS; // доступен для AI-анализа
    TIER_COLORS = {};
    json.forEach(g => {
      g.entries.forEach(e => { TIER_COLORS[e.label] = { color: g.color, tier: g.tier }; });
    });
    input.placeholder = 'церковь, мост, АЗС Shell...';
    hint.textContent = '✓ словарь загружен: ' + TAGS.length + ' объектов';
    setTimeout(() => { if (hint.textContent.startsWith('✓')) hint.textContent = ''; }, 3000);
  } catch(e) {
    console.error('Не удалось загрузить tags.json:', e);
    input.placeholder = 'ошибка загрузки словаря';
    hint.textContent = '⚠ tags.json недоступен';
    toast('Ошибка загрузки словаря тегов', true);
    return; // оставляем кнопку заблокированной
  } finally {
    input.disabled = false;
    btn.disabled = false;
  }
}

function resolveTag(text) {
  const t = text.toLowerCase();
  const matches = TAGS.filter(e => e.keys.some(k => t.includes(k)));
  if (!matches.length) return null;
  // Sort by weight desc, prefer longer key match
  return matches.sort((a, b) => (b.weight || 0) - (a.weight || 0))[0];
}

function buildPopupHtml(name, tagLabel, lat, lon) {
  const coordStr = lat.toFixed(5) + ', ' + lon.toFixed(5);
  const osmLink = 'https://www.openstreetmap.org/?mlat=' + lat + '&mlon=' + lon + '&zoom=17';
  const googleLink = 'https://www.google.com/maps?q=' + lat + ',' + lon;
  const yandexLink = 'https://yandex.ru/maps/?ll=' + lon + ',' + lat + '&z=17&pt=' + lon + ',' + lat;

  let html = '<b>' + (name || tagLabel || '—') + '</b>';
  if (tagLabel && tagLabel !== name) html += '<br><span style="color:var(--muted);font-size:9px">' + tagLabel + '</span>';
  html += '<br><span style="color:var(--muted)">' + coordStr + '</span>';
  html += '<br><a href="' + osmLink + '" target="_blank" style="color:var(--accent);font-size:9px">OSM</a>';
  html += ' · <a href="' + googleLink + '" target="_blank" style="color:var(--accent);font-size:9px">Google</a>';
  html += ' · <a href="' + yandexLink + '" target="_blank" style="color:var(--accent);font-size:9px">Яндекс</a>';
  return html;
}

// ═══════════════════════════════════════
//  HELPERS
// ═══════════════════════════════════════
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let toastTimer = null;
function toast(msg, err = false) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = 'toast show' + (err ? ' err' : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), err ? 4000 : 2500);
}

// ═══════════════════════════════════════
//  OVERPASS STATUS
// ═══════════════════════════════════════
async function fetchOverpassStatus() {
  const dot   = document.getElementById('statusDot');
  const text  = document.getElementById('statusText');
  const slots = document.getElementById('statusSlots');
  try {
    const r = await fetch('https://overpass-api.de/api/status');
    const t = await r.text();
    const m = t.match(/(\d+) slots available/);
    const available = m ? parseInt(m[1]) : 0;
    dot.style.background = available > 0 ? 'var(--accent3)' : 'var(--amber)';
    dot.style.boxShadow  = available > 0 ? '0 0 5px var(--accent3)' : '0 0 5px var(--amber)';
    text.textContent = available > 0 ? 'OVERPASS ОНЛАЙН' : 'OVERPASS ЗАНЯТ';
    slots.textContent = available;
  } catch {
    dot.style.background = 'var(--accent2)';
    dot.style.boxShadow  = '0 0 5px var(--accent2)';
    text.textContent = 'ОФЛАЙН';
    slots.textContent = '—';
  }
}

// ═══════════════════════════════════════
//  MAP INIT
// ═══════════════════════════════════════
function initMap() {
  S.map = L.map('map', { center:[56.1366, 40.3966], zoom:13, zoomControl:true, attributionControl:false });
  L.control.attribution({ prefix: false }).addTo(S.map);
  S.layerGroup = L.layerGroup().addTo(S.map);
  setTile('osm', true);

  S.map.on('mousemove', e => {
    const { lat, lng } = e.latlng;
    document.getElementById('headerCoords').innerHTML =
      `<b>LAT</b>&nbsp;${lat.toFixed(5)}&nbsp;&nbsp;<b>LON</b>&nbsp;${lng.toFixed(5)}`;
  });

  S.map.on('click', onMapClick);
}

// ═══════════════════════════════════════
//  TILE SWITCHER
// ═══════════════════════════════════════
function setTile(key, init = false) {
  if (!init && S.tileKey === key) return;
  S.tileKey = key;

  if (S.tileLayer) S.map.removeLayer(S.tileLayer);
  const cfg = TILES[key];
  S.tileLayer = L.tileLayer(cfg.url, { attribution: cfg.attr, maxZoom: 19 }).addTo(S.map);
  S.tileLayer.bringToBack();

  // update map class for CSS filter control
  const mapEl = document.getElementById('map');
  mapEl.className = cfg.cls;

  document.querySelectorAll('.tile-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.tile-btn[onclick="setTile('${key}')"]`).classList.add('active');
}

// ═══════════════════════════════════════
//  MAP CLICK HANDLER
// ═══════════════════════════════════════
function onMapClick(e) {
  const { lat, lng } = e.latlng;
  if (S.pinMode) {
    setSearchCenter(lat, lng);
    setPinMode(false);
    return;
  }
  if (S.bearingMode) {
    setBearingCenter(lat, lng);
    return;
  }
}

// ═══════════════════════════════════════
//  PHOTO + EXIF
// ═══════════════════════════════════════
function handlePhotoClick() {
  document.getElementById('fileInput').click();
}

function initPhotoDrop() {
  const drop = document.getElementById('photoDrop');
  const input = document.getElementById('fileInput');

  input.addEventListener('change', e => {
    if (e.target.files[0]) loadPhoto(e.target.files[0]);
  });

  drop.addEventListener('dragover', e => {
    e.preventDefault();
    drop.style.borderColor = 'var(--accent)';
  });
  drop.addEventListener('dragleave', () => {
    drop.style.borderColor = '';
  });
  drop.addEventListener('drop', e => {
    e.preventDefault();
    drop.style.borderColor = '';
    const file = e.dataTransfer.files[0];
    if (file && file.type.startsWith('image/')) loadPhoto(file);
  });
}

function loadPhoto(file) {
  const reader = new FileReader();
  reader.onload = ev => {
    S.photoUrl = ev.target.result;
    const drop = document.getElementById('photoDrop');

    // remove old img if any
    const old = drop.querySelector('img');
    if (old) old.remove();

    const img = document.createElement('img');
    img.src = S.photoUrl;
    drop.appendChild(img);
    drop.classList.add('has-img');
    document.getElementById('photoHint').style.display = 'none';
    document.getElementById('photoActions').classList.add('visible');

    parseExif(file);
  };
  reader.readAsDataURL(file);
}

async function parseExif(file) {
  // Read raw binary to find GPS EXIF
  const buf = await file.arrayBuffer();
  const view = new DataView(buf);
  const coords = extractGpsFromExif(view);

  const badge = document.getElementById('exifBadge');
  if (coords) {
    S.exifCoords = coords;
    document.getElementById('exifCoords').textContent =
      coords.lat.toFixed(5) + ', ' + coords.lon.toFixed(5);
    badge.classList.add('visible');
    toast('EXIF: GPS-координаты найдены → ' + coords.lat.toFixed(4) + ', ' + coords.lon.toFixed(4));
  } else {
    badge.classList.remove('visible');
    S.exifCoords = null;
    toast('EXIF: GPS-координаты не найдены', true);
  }
  // Prefill sun date if EXIF datetime available
  prefillSunDate();
}

function extractGpsFromExif(view) {
  // JPEG starts with FFD8
  if (view.getUint16(0) !== 0xFFD8) return null;

  let offset = 2;
  while (offset < view.byteLength) {
    const marker = view.getUint16(offset);
    offset += 2;
    if (marker === 0xFFE1) {
      // APP1 - may contain EXIF
      const len = view.getUint16(offset);
      const exifStart = offset + 2;

      // Check "Exif\0\0"
      const magic = String.fromCharCode(
        view.getUint8(exifStart), view.getUint8(exifStart+1),
        view.getUint8(exifStart+2), view.getUint8(exifStart+3)
      );
      if (magic !== 'Exif') { offset += len; continue; }

      const tiffStart = exifStart + 6;
      const little = view.getUint16(tiffStart) === 0x4949;
      const getU16 = o => view.getUint16(tiffStart + o, little);
      const getU32 = o => view.getUint32(tiffStart + o, little);

      // IFD0
      const ifd0 = getU32(4);
      const n0 = getU16(ifd0);
      let gpsIFDOffset = null;

      for (let i = 0; i < n0; i++) {
        const e = ifd0 + 2 + i * 12;
        const tag = getU16(e);
        if (tag === 0x8825) { // GPSInfo IFD pointer
          gpsIFDOffset = getU32(e + 8);
          break;
        }
      }
      if (!gpsIFDOffset) return null;

      // GPS IFD
      const gps = {};
      const ng = getU16(gpsIFDOffset);
      for (let i = 0; i < ng; i++) {
        const e = gpsIFDOffset + 2 + i * 12;
        const tag = getU16(e);
        const type = getU16(e + 2);
        const count = getU32(e + 4);
        const valOff = e + 8;

        if (tag === 1) { // GPSLatitudeRef
          gps.latRef = String.fromCharCode(view.getUint8(tiffStart + getU32(valOff)));
        } else if (tag === 2 && type === 5) { // GPSLatitude (rational)
          const off = tiffStart + getU32(valOff);
          gps.lat = toDecimalDeg(
            view.getUint32(off, little) / view.getUint32(off+4, little),
            view.getUint32(off+8, little) / view.getUint32(off+12, little),
            view.getUint32(off+16, little) / view.getUint32(off+20, little)
          );
        } else if (tag === 3) { // GPSLongitudeRef
          gps.lonRef = String.fromCharCode(view.getUint8(tiffStart + getU32(valOff)));
        } else if (tag === 4 && type === 5) { // GPSLongitude
          const off = tiffStart + getU32(valOff);
          gps.lon = toDecimalDeg(
            view.getUint32(off, little) / view.getUint32(off+4, little),
            view.getUint32(off+8, little) / view.getUint32(off+12, little),
            view.getUint32(off+16, little) / view.getUint32(off+20, little)
          );
        }
      }

      if (gps.lat != null && gps.lon != null) {
        const lat = (gps.latRef === 'S' ? -1 : 1) * gps.lat;
        const lon = (gps.lonRef === 'W' ? -1 : 1) * gps.lon;

        // Парсим DateTimeOriginal (0x9003) из Exif IFD — ПЕРЕД return
        try {
          for (let i = 0; i < n0; i++) {
            const e = ifd0 + 2 + i * 12;
            if (getU16(e) === 0x8769) { // ExifIFD pointer
              const exifIFDOff = getU32(e + 8);
              const ne = getU16(exifIFDOff);
              for (let j = 0; j < ne; j++) {
                const ee = exifIFDOff + 2 + j * 12;
                if (getU16(ee) === 0x9003) {
                  const strOff = tiffStart + getU32(ee + 8);
                  let dtStr = '';
                  for (let k = 0; k < 19; k++) dtStr += String.fromCharCode(view.getUint8(strOff + k));
                  const parts = dtStr.match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
                  if (parts) {
                    S.exifDatetime = new Date(+parts[1], +parts[2]-1, +parts[3], +parts[4], +parts[5], +parts[6]);
                  }
                }
              }
              break;
            }
          }
        } catch { /* ignore */ }

        if (isFinite(lat) && isFinite(lon)) return { lat, lon };
      }

      // Нет GPS — всё равно пробуем вытащить дату
      try {
        for (let i = 0; i < n0; i++) {
          const e = ifd0 + 2 + i * 12;
          if (getU16(e) === 0x8769) {
            const exifIFDOff = getU32(e + 8);
            const ne = getU16(exifIFDOff);
            for (let j = 0; j < ne; j++) {
              const ee = exifIFDOff + 2 + j * 12;
              if (getU16(ee) === 0x9003) {
                const strOff = tiffStart + getU32(ee + 8);
                let dtStr = '';
                for (let k = 0; k < 19; k++) dtStr += String.fromCharCode(view.getUint8(strOff + k));
                const parts = dtStr.match(/(\d{4}):(\d{2}):(\d{2}) (\d{2}):(\d{2}):(\d{2})/);
                if (parts) {
                  S.exifDatetime = new Date(+parts[1], +parts[2]-1, +parts[3], +parts[4], +parts[5], +parts[6]);
                }
              }
            }
            break;
          }
        }
      } catch { /* ignore */ }

      return null;
    } else {
      const len = view.getUint16(offset);
      offset += len;
    }
  }
  return null;
}

function toDecimalDeg(d, m, s) { return d + m/60 + s/3600; }

function flyToExif() {
  if (!S.exifCoords) return;
  const { lat, lon } = S.exifCoords;
  S.map.flyTo([lat, lon], 14, { duration: 1 });
  // auto-set search center
  setSearchCenter(lat, lon);
  toast('Центр поиска → EXIF-координаты');
}

function deletePhoto() {
  S.photoUrl = null;
  S.exifCoords = null;
  const drop = document.getElementById('photoDrop');
  const img = drop.querySelector('img');
  if (img) img.remove();
  drop.classList.remove('has-img');
  document.getElementById('photoHint').style.display = '';
  document.getElementById('photoActions').classList.remove('visible');
  document.getElementById('exifBadge').classList.remove('visible');
  document.getElementById('fileInput').value = '';
}

// ═══════════════════════════════════════
//  SEARCH CENTER (PIN)
// ═══════════════════════════════════════
function initSearchCenter() {
  document.getElementById('btnPin').addEventListener('click', () => {
    setPinMode(!S.pinMode);
  });

  document.getElementById('radiusSlider').addEventListener('input', function() {
    S.searchRadius = parseInt(this.value);
    document.getElementById('radiusVal').textContent = this.value + ' км';
    if (S.searchCenter) drawSearchPin();
  });
}

function setPinMode(on) {
  S.pinMode = on;
  const btn = document.getElementById('btnPin');
  if (on) {
    btn.classList.add('active');
    document.getElementById('pinLabel').textContent = 'КЛИКНИ НА КАРТУ...';
    document.body.classList.add('pin-mode');
    toast('Кликни на карту для установки центра поиска');
  } else {
    btn.classList.remove('active');
    document.getElementById('pinLabel').textContent = S.searchCenter ? 'ИЗМЕНИТЬ ЦЕНТР' : 'КЛИКНИ НА КАРТУ — ЦЕНТР ПОИСКА';
    document.body.classList.remove('pin-mode');
  }
}

function setSearchCenter(lat, lon) {
  S.searchCenter = { lat, lon };
  document.getElementById('centerDisplay').textContent =
    lat.toFixed(5) + ', ' + lon.toFixed(5);
  document.getElementById('centerDisplay').classList.add('visible');
  document.getElementById('pinIcon').textContent = '🎯';
  document.getElementById('pinLabel').textContent = 'ИЗМЕНИТЬ ЦЕНТР';
  drawSearchPin();
}

function drawSearchPin() {
  if (S.searchPinLayer) S.map.removeLayer(S.searchPinLayer);
  const { lat, lon } = S.searchCenter;
  const r = S.searchRadius * 1000; // metres

  S.searchPinLayer = L.layerGroup();

  L.circle([lat, lon], {
    radius: r,
    color: '#ff5f2e',
    fillColor: '#ff5f2e',
    fillOpacity: 0.04,
    weight: 1,
    dashArray: '4 4',
  }).addTo(S.searchPinLayer);

  L.circleMarker([lat, lon], {
    radius: 5,
    color: '#ff5f2e',
    fillColor: '#fff',
    fillOpacity: 1,
    weight: 2,
  }).addTo(S.searchPinLayer);

  S.searchPinLayer.addTo(S.map);
}

// ═══════════════════════════════════════
//  BEARING / AZIMUTH
// ═══════════════════════════════════════
function toggleBearing() {
  if (!S.searchCenter) {
    toast('Сначала установи центр поиска', true);
    return;
  }
  S.bearingMode = !S.bearingMode;
  const btn = document.getElementById('btnBearing');
  const wrap = document.getElementById('bearingAngleWrap');
  const hud  = document.getElementById('hudBearing');

  if (S.bearingMode) {
    btn.classList.add('active');
    btn.textContent = '🧭 АЗИМУТ АКТИВЕН';
    wrap.classList.add('visible');
    hud.style.display = 'block';
    document.body.classList.add('bearing-mode');
    S.bearingCenter = { ...S.searchCenter };
    drawBearing();
    toast('Кликни по карте, чтобы уточнить точку съёмки, или вращай слайдер');
  } else {
    btn.classList.remove('active');
    btn.textContent = '🧭 ЗАДАТЬ НАПРАВЛЕНИЕ КАМЕРЫ';
    wrap.classList.remove('visible');
    hud.style.display = 'none';
    document.body.classList.remove('bearing-mode');
    if (S.bearingLayer) { S.map.removeLayer(S.bearingLayer); S.bearingLayer = null; }
  }
}

function setBearingCenter(lat, lng) {
  S.bearingCenter = { lat, lon: lng };
  drawBearing();
}

function drawBearing() {
  if (!S.bearingCenter) return;
  if (S.bearingLayer) S.map.removeLayer(S.bearingLayer);

  const { lat, lon } = S.bearingCenter;
  const az = S.bearingAngle;
  const dist = 50; // km ray length

  // Compute end point
  const rad = Math.PI / 180;
  const R = 6371;
  const lat2 = Math.asin(
    Math.sin(lat * rad) * Math.cos(dist / R) +
    Math.cos(lat * rad) * Math.sin(dist / R) * Math.cos(az * rad)
  ) / rad;
  const lon2 = lon + Math.atan2(
    Math.sin(az * rad) * Math.sin(dist / R) * Math.cos(lat * rad),
    Math.cos(dist / R) - Math.sin(lat * rad) * Math.sin(lat2 * rad)
  ) / rad;

  // FOV sector (±30° either side of bearing)
  const fov = 30;
  const sectorPoints = [[lat, lon]];
  for (let a = az - fov; a <= az + fov; a += 3) {
    const r2 = Math.asin(
      Math.sin(lat * rad) * Math.cos(dist / R) +
      Math.cos(lat * rad) * Math.sin(dist / R) * Math.cos(a * rad)
    ) / rad;
    const r3 = lon + Math.atan2(
      Math.sin(a * rad) * Math.sin(dist / R) * Math.cos(lat * rad),
      Math.cos(dist / R) - Math.sin(lat * rad) * Math.sin(r2 * rad)
    ) / rad;
    sectorPoints.push([r2, r3]);
  }
  sectorPoints.push([lat, lon]);

  S.bearingLayer = L.layerGroup();

  // Sector polygon
  L.polygon(sectorPoints, {
    color: '#ffc107',
    fillColor: '#ffc107',
    fillOpacity: 0.07,
    weight: 1,
    dashArray: '5 4',
  }).addTo(S.bearingLayer);

  // Main bearing ray
  L.polyline([[lat, lon], [lat2, lon2]], {
    color: '#ffc107',
    weight: 2,
    opacity: 0.8,
  }).addTo(S.bearingLayer);

  // Origin marker
  L.circleMarker([lat, lon], {
    radius: 6,
    color: '#ffc107',
    fillColor: '#ffc107',
    fillOpacity: 0.9,
    weight: 2,
  }).bindTooltip(`AZ: ${az}°`, { permanent: false }).addTo(S.bearingLayer);

  S.bearingLayer.addTo(S.map);
}

function initBearingSlider() {
  const sl  = document.getElementById('bearingSlider');
  const inp = document.getElementById('bearingInput');
  const hud = document.getElementById('hudBearingVal');

  const cardinal = document.getElementById('bearingCardinal');
  const CARDINALS = ['С','ССВ','СВ','ВСВ','В','ВЮВ','ЮВ','ЮЮВ','Ю','ЮЮЗ','ЮЗ','ЗЮЗ','З','ЗСЗ','СЗ','ССЗ'];

  function setBearing(val) {
    // Wrap 0–359
    val = ((val % 360) + 360) % 360;
    S.bearingAngle = val;
    sl.value  = val;
    inp.value = val;
    hud.textContent = val + '°';
    if (cardinal) cardinal.textContent = CARDINALS[Math.round(val / 22.5) % 16];
    if (S.bearingMode) drawBearing();
  }

  sl.addEventListener('input', function() {
    setBearing(parseInt(this.value));
  });

  inp.addEventListener('input', function() {
    const v = parseInt(this.value);
    if (!isNaN(v)) setBearing(v);
  });

  // Allow keyboard nudge: ↑/↓ on number field wraps correctly
  inp.addEventListener('keydown', function(e) {
    if (e.key === 'ArrowUp')   { e.preventDefault(); setBearing(S.bearingAngle + 1); }
    if (e.key === 'ArrowDown') { e.preventDefault(); setBearing(S.bearingAngle - 1); }
  });
}

// ═══════════════════════════════════════
//  SEARCH FILTER (Overpass bbox/around)
// ═══════════════════════════════════════
function getSearchFilter() {
  if (!S.searchCenter) return '';
  const { lat, lon } = S.searchCenter;
  const r = S.searchRadius * 1000;
  const around = `(around:${r},${lat},${lon})`;

  // Если задан регион — добавляем пересечение с bbox
  if (S.region) {
    const [s, w, n, e] = S.region.bbox;
    // Overpass: around + bbox — возвращаем оба фильтра через пробел (AND-семантика)
    return `(around:${r},${lat},${lon})(if: lat() >= ${s} && lat() <= ${n} && lon() >= ${w} && lon() <= ${e})`;
  }

  return around;
}

// ═══════════════════════════════════════
//  CLUE MANAGEMENT
// ═══════════════════════════════════════
function initClues() {
  const input = document.getElementById('clueInput');
  const brand = document.getElementById('brandInput');
  const btn   = document.getElementById('btnAdd');

  const doAdd = () => addClue(input.value, brand.value);
  btn.addEventListener('click', doAdd);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
  brand.addEventListener('keydown', e => { if (e.key === 'Enter') doAdd(); });
  input.addEventListener('input', () => {
    const r = resolveTag(input.value);
    document.getElementById('hintText').textContent = r ? '→ ' + r.label : '';
  });
}

function addClue(raw, brand) {
  raw   = (raw   || '').trim();
  brand = (brand || '').trim();
  if (!raw) return;

  const color    = COLORS[S.clues.length % COLORS.length];
  const resolved = resolveTag(raw);

  // Нумерация: считаем сколько зацепок с тем же resolved.label уже есть
  const sameLabel = resolved
    ? S.clues.filter(c => c.resolved?.label === resolved.label)
    : S.clues.filter(c => c.text.toLowerCase() === raw.toLowerCase());
  const copyNum = sameLabel.length + 1; // 1 = первая, 2 = вторая копия и т.д.

  // Отображаемый текст: «магазин» → «магазин», «магазин» (второй) → «магазин #2»
  const displayText = copyNum > 1
    ? raw + ' #' + copyNum
    : raw;

  const clue = {
    id:     S.nextId++,
    text:   displayText,
    rawText: raw,       // оригинал без номера — для resolveTag при восстановлении
    brand,              // бренд/уточнение
    resolved,
    copyNum,
    color,
    status: 'pending',
    layer:  null,
    count:  0,
  };
  S.clues.push(clue);
  renderClues();
  updateHUD();
  document.getElementById('clueInput').value  = '';
  document.getElementById('brandInput').value = '';
  document.getElementById('hintText').textContent = '';
  document.getElementById('btnAnalyze').disabled  = false;
}

function removeClue(id) {
  const c = S.clues.find(x => x.id === id);
  if (c && c.layer) S.layerGroup.removeLayer(c.layer);
  S.clues = S.clues.filter(x => x.id !== id);
  renderClues();
  updateHUD();
  updateLegend();
  if (!S.clues.length) {
    document.getElementById('btnAnalyze').disabled = true;
    document.getElementById('candidateList').innerHTML = '';
    document.getElementById('btnExport').style.display = 'none';
  }
}

function renderClues() {
  const list  = document.getElementById('cluesList');
  const empty = document.getElementById('emptyMsg');
  if (!S.clues.length) { empty.style.display = 'block'; list.querySelectorAll('.clue-item').forEach(e => e.remove()); return; }
  empty.style.display = 'none';
  list.querySelectorAll('.clue-item').forEach(e => e.remove());

  S.clues.forEach(c => {
    const d = document.createElement('div');
    d.className = 'clue-item';
    const statusLabel = { pending:'ОЖИДАНИЕ', loading:'ЗАПРОС...', done:`НАЙДЕНО ${c.count}`, error:'ОШИБКА' }[c.status] || 'ОЖИДАНИЕ';

    // Строка с брендом/уточнением
    const brandStr = c.brand
      ? `<span style="color:var(--muted);font-size:9px;margin-left:3px">[${c.brand}]</span>`
      : '';
    // Номер копии
    const copyStr = c.copyNum > 1
      ? `<span style="color:var(--accent2);font-size:9px;margin-left:2px">#${c.copyNum}</span>`
      : '';

    d.innerHTML = `
      <div class="clue-dot" style="background:${c.color};box-shadow:0 0 4px ${c.color}"></div>
      <div class="clue-text">${c.rawText || c.text}${copyStr}${brandStr}</div>
      ${c.resolved ? (() => {
        const tc = TIER_COLORS[c.resolved.label];
        const tierStr = tc ? ` T${tc.tier}` : '';
        return `<div class="clue-tag" style="${tc ? 'border-color:' + tc.color + '33;color:' + tc.color : ''}">${c.resolved.label}${tierStr}</div>`;
      })() : ''}
      <div class="clue-status ${c.status}">${statusLabel}</div>
      <button class="clue-remove" data-id="${c.id}">✕</button>
    `;
    list.appendChild(d);
  });

  list.querySelectorAll('.clue-remove').forEach(b => {
    b.addEventListener('click', () => removeClue(+b.dataset.id));
  });

  refreshDistSelects();
}

function updateHUD() {
  document.getElementById('hudClues').textContent = S.clues.length;
  const active = S.clues.filter(c => c.layer).length;
  document.getElementById('hudLayers').textContent = active;
  document.getElementById('hudLayersWrap').style.display = active ? 'block' : 'none';
}

// ═══════════════════════════════════════
//  OVERPASS QUERY
// ═══════════════════════════════════════
async function queryOverpass(clue) {
  clue.status = 'loading';
  renderClues();

  const sf = getSearchFilter();
  let body = '';

  // Если указан бренд — добавляем фильтр по name/brand/operator
  const brandFilter = clue.brand
    ? `["name"~"${clue.brand}",i]["brand"!~"x"]; ` // пробуем по name
      + `node["brand"~"${clue.brand}",i]${sf}; way["brand"~"${clue.brand}",i]${sf}; `
      + `node["operator"~"${clue.brand}",i]${sf}; way["operator"~"${clue.brand}",i]${sf};`
    : null;

  if (brandFilter && !clue.resolved) {
    // Бренд задан без типа объекта — ищем только по бренду
    body = `node["name"~"${clue.brand}",i]${sf}; way["name"~"${clue.brand}",i]${sf};`
         + `node["brand"~"${clue.brand}",i]${sf}; way["brand"~"${clue.brand}",i]${sf};`;
  } else if (clue.resolved) {
    const r = clue.resolved;

    // Вспомогательная функция — добавляет фильтр бренда к готовому набору OSM-тегов
    const withBrand = (osmFilters, nodeOnly) => {
      if (!clue.brand) {
        if (nodeOnly) return `node${osmFilters}${sf};`;
        return `node${osmFilters}${sf}; way${osmFilters}${sf};`;
      }
      // С брендом — пересечение: тип объекта AND (name/brand/operator содержит бренд)
      const bf = `["name"~"${clue.brand}",i]`;
      const bo = `["brand"~"${clue.brand}",i]`;
      const op = `["operator"~"${clue.brand}",i]`;
      if (nodeOnly) {
        return `node${osmFilters}${bf}${sf}; node${osmFilters}${bo}${sf}; node${osmFilters}${op}${sf};`;
      }
      return `node${osmFilters}${bf}${sf}; way${osmFilters}${bf}${sf};`
           + `node${osmFilters}${bo}${sf}; way${osmFilters}${bo}${sf};`
           + `node${osmFilters}${op}${sf}; way${osmFilters}${op}${sf};`;
    };

    if (r.tagsRaw) {
      const f = `["${r.tagsRaw}"]`;
      body = withBrand(f, false);

    } else if (r.tagsRegex) {
      // tagsRegex — фильтры с регулярными выражениями OSM (~"pattern")
      const f = Object.entries(r.tagsRegex).map(([k,v]) => `["${k}"~"${v}"]`).join('');
      body = withBrand(f, r.nodeOnly);

    } else if (r.tagsAlt) {
      const allSets = [r.tags, ...r.tagsAlt];
      allSets.forEach(tagSet => {
        const f = Object.entries(tagSet).map(([k,v]) => `["${k}"="${v}"]`).join('');
        body += withBrand(f, r.nodeOnly);
      });

    } else {
      const filters = Object.entries(r.tags).map(([k,v]) => `["${k}"="${v}"]`).join('');
      body = withBrand(filters, r.nodeOnly);
    }
  } else {
    // Нет resolved и нет бренда — ищем по тексту
    body = `node["name"~"${clue.rawText || clue.text}",i]${sf}; way["name"~"${clue.rawText || clue.text}",i]${sf};`;
  }

  const query = `[out:json][timeout:60];(${body});out center 300;`;

  for (let attempt = 1; attempt <= 4; attempt++) {
    try {
      const res = await fetch('https://overpass-api.de/api/interpreter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
      });
      if (res.status === 429) {
        const wait = attempt * 8;
        toast(`⏳ Rate limit — пауза ${wait}с (попытка ${attempt}/4)`, true);
        await sleep(wait * 1000);
        continue;
      }
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const data = await res.json();
      return data.elements || [];
    } catch(e) {
      if (attempt === 4) {
        clue.status = 'error';
        toast(`Ошибка: ${clue.text} — ${e.message}`, true);
        renderClues();
        return null;
      }
      await sleep(3000);
    }
  }
  return null;
}

// ═══════════════════════════════════════
//  ANALYZE — INTERSECTION + HEATMAP
// ═══════════════════════════════════════
const MAX_RESULTS_PER_CLUE = 150; // лимит объектов на одну зацепку
let isAnalyzing = false;

async function analyze() {
  if (isAnalyzing) return;
  if (!S.clues.length) return;
  if (!S.searchCenter) {
    toast('Установи центр поиска на карте', true);
    return;
  }

  isAnalyzing = true;
  const btn = document.getElementById('btnAnalyze');
  btn.disabled = true;
  btn.textContent = '⌛ ЗАПРОС 0/' + S.clues.length;

  // Clear previous layers
  S.layerGroup.clearLayers();
  S.allPoints = [];
  if (S.intersectionLayer) { S.map.removeLayer(S.intersectionLayer); S.intersectionLayer = null; }
  document.getElementById('candidateList').innerHTML = '';
  document.getElementById('btnExport').style.display = 'none';

  const buf = parseInt(document.getElementById('bufferSlider').value);
  const bufKm = buf / 1000;

  try {

  const layerPolygons = [];

  for (let i = 0; i < S.clues.length; i++) {
    const clue = S.clues[i];
    btn.textContent = '⌛ ЗАПРОС ' + (i + 1) + '/' + S.clues.length;

    const elements = await queryOverpass(clue);
    if (!elements) continue;

    // Лимит: предупреждаем если результатов слишком много
    const truncated = elements.length > MAX_RESULTS_PER_CLUE;
    const limited = truncated ? elements.slice(0, MAX_RESULTS_PER_CLUE) : elements;
    if (truncated) {
      toast(`«${clue.text}» — показаны первые ${MAX_RESULTS_PER_CLUE} из ${elements.length}. Сузи радиус или буфер.`, true);
    }

    clue.layer = L.layerGroup();
    const turfPolys = [];

    limited.forEach(el => {
      const lat = el.lat ?? el.center?.lat;
      const lon = el.lon ?? el.center?.lon;
      if (!lat) return;

      clue.count++;
      S.allPoints.push([lat, lon, 1]);

      const name = el.tags?.name || el.tags?.brand || clue.text;

      // Размер и стиль маркера зависит от тира объекта
      const tc = TIER_COLORS[clue.resolved?.label];
      const tier = tc?.tier ?? 6;
      const markerRadius = tier <= 1 ? 7 : tier <= 2 ? 6 : tier <= 3 ? 6 : 5;
      const markerWeight = tier <= 2 ? 2 : 1.5;

      const marker = L.circleMarker([lat, lon], {
        radius: markerRadius,
        color: clue.color,
        fillColor: clue.color,
        fillOpacity: tier <= 2 ? 0.85 : 0.65,
        weight: markerWeight,
      }).bindPopup(buildPopupHtml(name, clue.resolved?.label, lat, lon));
      marker.addTo(clue.layer);

      const pt = turf.point([lon, lat]);
      const circle = turf.circle(pt, bufKm, { steps: 32, units: 'kilometers' });
      turfPolys.push(circle);
    });

    clue.layer.addTo(S.layerGroup);
    clue.status = 'done';

    if (turfPolys.length) layerPolygons.push({ clue, polys: turfPolys });
    renderClues();
  }

  // Compute intersections
  const candidates = findIntersections(layerPolygons, bufKm);
  renderCandidates(candidates);
  updateHUD();
  updateLegend();

  isAnalyzing = false;
  btn.disabled = false;
  btn.textContent = '⌖ АНАЛИЗ ПЕРЕСЕЧЕНИЙ';
  toast(`Анализ завершён. Кандидатов: ${candidates.length}`);
  } catch(err) {
    toast('Ошибка анализа: ' + err.message, true);
  } finally {
    isAnalyzing = false;
    btn.disabled = S.clues.length === 0;
    btn.textContent = '⌖ АНАЛИЗ ПЕРЕСЕЧЕНИЙ';
  }
}

function findIntersections(layerPolygons, bufKm) {
  // For each clue, union all its buffers. Then intersect across all clues.
  if (!layerPolygons.length) return [];

  let combined = null; // running intersection

  for (const { polys } of layerPolygons) {
    let clueUnion = null;
    for (const p of polys) {
      try {
        clueUnion = clueUnion ? turf.union(clueUnion, p) : p;
      } catch { continue; }
    }
    if (!clueUnion) continue;

    if (!combined) {
      combined = clueUnion;
    } else {
      try {
        const inter = turf.intersect(combined, clueUnion);
        if (inter) combined = inter;
      } catch { continue; }
    }
  }

  if (!combined) return [];

  // Draw intersection polygon
  S.intersectionLayer = L.layerGroup();
  L.geoJSON(combined, {
    style: {
      color: '#ffc107',
      fillColor: '#ffc107',
      fillOpacity: 0.12,
      weight: 2,
      dashArray: '6 3',
    },
    interactive: false,
  }).addTo(S.intersectionLayer);
  S.intersectionLayer.addTo(S.map);

  // Extract centroid candidates from intersection bbox
  const bbox = turf.bbox(combined);
  const candidates = [];

  // Sample candidate points: use cluster of all result points within intersection
  S.allPoints.forEach(([lat, lon]) => {
    const pt = turf.point([lon, lat]);
    try {
      if (turf.booleanPointInPolygon(pt, combined)) {
        candidates.push({ lat, lon, weight: 1 });
      }
    } catch { }
  });

  // If no points inside intersection, use centroid
  if (!candidates.length) {
    const c = turf.centroid(combined);
    candidates.push({ lat: c.geometry.coordinates[1], lon: c.geometry.coordinates[0], weight: 0 });
  }

  // Cluster into top-N by proximity
  return clusterCandidates(candidates).slice(0, 8);
}

function clusterCandidates(pts) {
  if (!pts.length) return [];
  // Simple grid clustering: 0.005 deg grid
  const grid = {};
  for (const p of pts) {
    const key = Math.round(p.lat * 200) + ',' + Math.round(p.lon * 200);
    if (!grid[key]) grid[key] = { lat: 0, lon: 0, count: 0 };
    grid[key].lat += p.lat;
    grid[key].lon += p.lon;
    grid[key].count++;
  }
  return Object.values(grid)
    .sort((a, b) => b.count - a.count)
    .map(g => ({ lat: g.lat / g.count, lon: g.lon / g.count, count: g.count }));
}

function renderCandidates(candidates) {
  const list = document.getElementById('candidateList');
  list.innerHTML = '';
  if (!candidates.length) return;

  document.getElementById('btnExport').style.display = 'block';

  candidates.forEach((c, i) => {
    const div = document.createElement('div');
    div.className = 'candidate-item';
    div.style.flexDirection = 'column';
    div.style.alignItems    = 'stretch';
    div.style.cursor        = 'default';

    // Основная строка кандидата
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:5px;cursor:pointer;';
    row.innerHTML = `
      <span class="candidate-rank">#${i + 1}</span>
      <span class="candidate-name">${c.count ? c.count + ' объектов' : 'центроид'}</span>
      <span class="candidate-coords">${c.lat.toFixed(4)}, ${c.lon.toFixed(4)}</span>
      <button class="reverse-btn" style="margin-left:auto;flex-shrink:0;background:rgba(0,153,204,.1);
        border:1px solid rgba(0,153,204,.25);border-radius:2px;color:var(--accent);
        font-family:'IBM Plex Mono',monospace;font-size:8px;padding:2px 6px;cursor:pointer;
        white-space:nowrap;">🔍 что рядом</button>
    `;

    // Панель результатов reverse search
    const panel = document.createElement('div');
    panel.className = 'reverse-panel';
    panel.style.cssText = 'display:none;padding:5px 8px;margin-top:4px;'
      + 'background:rgba(0,153,204,.04);border:1px solid rgba(0,153,204,.15);'
      + 'border-radius:3px;font-family:"IBM Plex Mono",monospace;font-size:9px;'
      + 'color:var(--text);line-height:1.8;';

    div.appendChild(row);
    div.appendChild(panel);

    // Клик по строке — перелёт на карту
    row.addEventListener('click', e => {
      if (e.target.classList.contains('reverse-btn')) return;
      S.map.flyTo([c.lat, c.lon], 15, { duration: 0.8 });
      if (S.intersectionLayer) {
        L.circleMarker([c.lat, c.lon], {
          radius: 8, color: '#ffc107', fillColor: '#fff', fillOpacity: 1, weight: 2,
        }).bindPopup(`<b>#${i+1} Кандидат</b><br>${c.lat.toFixed(5)}, ${c.lon.toFixed(5)}`)
          .addTo(S.intersectionLayer).openPopup();
      }
    });

    // Кнопка reverse search
    row.querySelector('.reverse-btn').addEventListener('click', e => {
      e.stopPropagation();
      reverseSearch(c.lat, c.lon, div);
    });

    list.appendChild(div);
  });
}


// ═══════════════════════════════════════
//  SUNCALC — солнечный анализ
// ═══════════════════════════════════════
// Читает дату и время из двух отдельных полей, возвращает Date или null
function getSunDatetime() {
  const datePart = document.getElementById('sunDatePart').value; // "YYYY-MM-DD"
  const timePart = document.getElementById('sunTimePart').value; // "HH:MM"
  if (datePart && timePart) return new Date(datePart + 'T' + timePart);
  if (datePart)             return new Date(datePart + 'T12:00');
  return null;
}

function setSunDatetime(dt) {
  const pad = n => String(n).padStart(2, '0');
  document.getElementById('sunDatePart').value =
    dt.getFullYear() + '-' + pad(dt.getMonth()+1) + '-' + pad(dt.getDate());
  document.getElementById('sunTimePart').value =
    pad(dt.getHours()) + ':' + pad(dt.getMinutes());
}

function runSunCalc() {
  const center = S.searchCenter || (() => {
    const c = S.map.getCenter();
    return { lat: c.lat, lon: c.lng };
  })();

  const result = document.getElementById('sunResult');
  let dt = getSunDatetime();

  if (!dt && S.exifDatetime) {
    dt = S.exifDatetime;
    setSunDatetime(dt);
  }

  if (!dt) {
    toast('Укажи дату и время съёмки', true);
    return;
  }

  const { lat, lon } = center;
  const pos = SunCalc.getPosition(dt, lat, lon);
  const times = SunCalc.getTimes(dt, lat, lon);

  const azDeg = ((pos.azimuth * 180 / Math.PI) + 180 + 360) % 360;
  const altDeg = pos.altitude * 180 / Math.PI;
  const isDay  = altDeg > 0;

  const fmt = d => d.toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' });

  result.innerHTML =
    (!S.searchCenter ? '<span style="color:var(--muted);font-size:9px">⚠ центр поиска не задан — использован центр карты</span><br>' : '') +
    '☀ Азимут солнца: <b>' + azDeg.toFixed(1) + '°</b><br>' +
    '⬆ Высота над горизонтом: <b>' + altDeg.toFixed(1) + '°</b><br>' +
    (isDay ? '🌤 День' : '🌙 Ночь / сумерки') + '<br>' +
    '🌅 Восход: <b>' + fmt(times.sunrise) + '</b><br>' +
    '🌇 Закат: <b>' + fmt(times.sunset) + '</b>';
  result.classList.add('visible');

  // Рисуем луч солнца на карте (откуда свет падает = азимут + 180°)
  if (S.sunLayer) { S.map.removeLayer(S.sunLayer); S.sunLayer = null; }
  if (!isDay) { toast('Ночное время — тени неопределимы', true); return; }

  S.sunLayer = L.layerGroup();
  const shadowAz = (azDeg + 180) % 360; // тень противоположна солнцу
  const rayLen = 40; // км
  const rad = Math.PI / 180;
  const R = 6371;

  // Луч солнца (откуда светит)
  const sunLat2 = Math.asin(Math.sin(lat*rad)*Math.cos(rayLen/R) + Math.cos(lat*rad)*Math.sin(rayLen/R)*Math.cos(azDeg*rad)) / rad;
  const sunLon2 = lon + Math.atan2(Math.sin(azDeg*rad)*Math.sin(rayLen/R)*Math.cos(lat*rad), Math.cos(rayLen/R)-Math.sin(lat*rad)*Math.sin(sunLat2*rad)) / rad;

  // Луч тени
  const shadLat2 = Math.asin(Math.sin(lat*rad)*Math.cos(rayLen/R) + Math.cos(lat*rad)*Math.sin(rayLen/R)*Math.cos(shadowAz*rad)) / rad;
  const shadLon2 = lon + Math.atan2(Math.sin(shadowAz*rad)*Math.sin(rayLen/R)*Math.cos(lat*rad), Math.cos(rayLen/R)-Math.sin(lat*rad)*Math.sin(shadLat2*rad)) / rad;

  // Пунктир — откуда светит солнце
  L.polyline([[lat, lon], [sunLat2, sunLon2]], {
    color: '#ffc107', weight: 2, opacity: 0.7, dashArray: '8 5'
  }).bindTooltip('☀ Солнце ' + azDeg.toFixed(0) + '°').addTo(S.sunLayer);

  // Сплошная — направление тени
  L.polyline([[lat, lon], [shadLat2, shadLon2]], {
    color: '#4a6272', weight: 2, opacity: 0.8, dashArray: '4 3'
  }).bindTooltip('🌑 Тень ' + shadowAz.toFixed(0) + '°').addTo(S.sunLayer);

  // Маркер солнца
  L.circleMarker([lat, lon], {
    radius: 7, color: '#ffc107', fillColor: '#ffc107', fillOpacity: 1, weight: 2
  }).bindPopup('☀ ' + azDeg.toFixed(1) + '° · ' + altDeg.toFixed(1) + '° над горизонтом').addTo(S.sunLayer);

  S.sunLayer.addTo(S.map);
  S.sunActive = true;
  toast('☀ Азимут ' + azDeg.toFixed(1) + '° · высота ' + altDeg.toFixed(1) + '°');
}

// Заполняем дату из EXIF если есть
function prefillSunDate() {
  const hint = document.getElementById('sunDateHint');
  if (!S.exifDatetime) {
    if (hint) hint.textContent = 'дата из EXIF не найдена — введи вручную';
    return;
  }
  const d = S.exifDatetime;
  setSunDatetime(d);
  const pad = n => String(n).padStart(2, '0');
  if (hint) hint.textContent = '✓ EXIF: ' + pad(d.getDate()) + '.' + pad(d.getMonth()+1)
    + '.' + d.getFullYear() + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
}

// ═══════════════════════════════════════
//  EXTERNAL MAP LINKS
// ═══════════════════════════════════════
function getMapCenter() {
  const c = S.map.getCenter();
  return { lat: c.lat, lon: c.lng, zoom: S.map.getZoom() };
}

function openF4Map() {
  const { lat, lon, zoom } = getMapCenter();
  window.open('https://demo.f4map.com/#lat=' + lat.toFixed(5) + '&lon=' + lon.toFixed(5) + '&zoom=' + zoom + '&camera.theta=55', '_blank');
}

function openSatlex() {
  const { lat, lon } = getMapCenter();
  // Satlex принимает координаты в URL
  window.open('https://www.satlex.net/en/azel_calc.html?llat=' + lat.toFixed(4) + '&llon=' + lon.toFixed(4), '_blank');
}

function openYandexPanorama() {
  const { lat, lon } = getMapCenter();
  window.open('https://yandex.ru/maps/?panorama[point]=' + lon.toFixed(6) + ',' + lat.toFixed(6)
    + '&panorama[direction]=0,0&panorama[span]=100,60', '_blank');
}

// ═══════════════════════════════════════
//  RIGHT PANEL TOGGLE
// ═══════════════════════════════════════
function toggleRightPanel() {
  const panel  = document.getElementById('sidebarRight');
  const btn    = document.getElementById('rightPanelToggle');
  const isOpen = panel.classList.toggle('open');
  btn.classList.toggle('open', isOpen);
  btn.textContent = isOpen ? '⟩' : '⟨';
  // Перерисовываем карту после анимации
  setTimeout(() => S.map && S.map.invalidateSize(), 260);
}

// ═══════════════════════════════════════
//  COLLAPSIBLE SECTIONS
// ═══════════════════════════════════════
function toggleSection(labelEl) {
  const body = labelEl.nextElementSibling;
  if (!body || !body.classList.contains('sb-section-body')) return;
  const collapsed = body.classList.toggle('collapsed');
  labelEl.classList.toggle('collapsed', collapsed);
}

// ═══════════════════════════════════════
//  RULER — измерение расстояний
// ═══════════════════════════════════════
const RULER = {
  active:  false,
  points:  [],   // [{lat, lon}]
  markers: [],
  lines:   [],
  layer:   null,
};

function toggleRuler() {
  RULER.active = !RULER.active;
  const btn  = document.getElementById('btnRuler');
  const hint = document.getElementById('rulerHint');

  if (RULER.active) {
    btn.textContent = '⏹ ОСТАНОВИТЬ ЛИНЕЙКУ';
    btn.style.borderColor = 'var(--accent2)';
    btn.style.color       = 'var(--accent2)';
    hint.style.color      = 'var(--accent)';
    S.map.getContainer().style.cursor = 'crosshair';
    S.map.on('click',    rulerClick);
    S.map.on('dblclick', rulerFinish);
    document.getElementById('hudRuler').style.display = 'block';
  } else {
    rulerStop();
  }
}

function rulerClick(e) {
  if (!RULER.active) return;

  const pt = { lat: e.latlng.lat, lon: e.latlng.lng };
  RULER.points.push(pt);

  // Маркер точки
  if (!RULER.layer) {
    RULER.layer = L.layerGroup().addTo(S.map);
  }
  const m = L.circleMarker([pt.lat, pt.lon], {
    radius: 5, color: '#ff6b35', fillColor: '#ff6b35',
    fillOpacity: 1, weight: 2,
  }).addTo(RULER.layer);
  RULER.markers.push(m);

  // Линия от предыдущей точки
  if (RULER.points.length > 1) {
    const prev = RULER.points[RULER.points.length - 2];
    const line = L.polyline(
      [[prev.lat, prev.lon], [pt.lat, pt.lon]],
      { color: '#ff6b35', weight: 2, dashArray: '5,5', opacity: .85 }
    ).addTo(RULER.layer);
    RULER.lines.push(line);
  }

  rulerUpdateResult();
}

function rulerFinish(e) {
  // dblclick генерирует два click + один dblclick — убираем последний дубль
  if (RULER.points.length > 1) {
    const last = RULER.points[RULER.points.length - 1];
    const prev = RULER.points[RULER.points.length - 2];
    const d = turf.distance(
      turf.point([last.lon, last.lat]),
      turf.point([prev.lon, prev.lat]),
      { units: 'meters' }
    );
    if (d < 5) { // дубль от dblclick — убираем
      RULER.points.pop();
      const m = RULER.markers.pop();
      if (m) RULER.layer.removeLayer(m);
      const l = RULER.lines.pop();
      if (l) RULER.layer.removeLayer(l);
    }
  }
  rulerStop();
  rulerUpdateResult();
}

function rulerStop() {
  RULER.active = false;
  S.map.off('click',    rulerClick);
  S.map.off('dblclick', rulerFinish);
  S.map.getContainer().style.cursor = '';
  const btn = document.getElementById('btnRuler');
  if (btn) {
    btn.textContent = '📏 ВКЛЮЧИТЬ ЛИНЕЙКУ';
    btn.style.borderColor = '';
    btn.style.color       = '';
  }
  const hint = document.getElementById('rulerHint');
  if (hint) hint.style.color = '';
}

function rulerUpdateResult() {
  if (RULER.points.length < 2) return;

  // Считаем сегменты и полную длину
  let totalM = 0;
  const segments = [];
  for (let i = 1; i < RULER.points.length; i++) {
    const a = RULER.points[i - 1];
    const b = RULER.points[i];
    const d = turf.distance(
      turf.point([a.lon, a.lat]),
      turf.point([b.lon, b.lat]),
      { units: 'meters' }
    );
    segments.push(d);
    totalM += d;
  }

  const fmt = m => m >= 1000
    ? (m / 1000).toFixed(2) + ' км'
    : Math.round(m) + ' м';

  const resEl  = document.getElementById('rulerResult');
  const hudVal = document.getElementById('hudRulerVal');
  resEl.style.display = 'block';

  let html = '<b>' + fmt(totalM) + '</b>';
  if (segments.length > 1) {
    html += '<div style="margin-top:4px;font-size:9px;color:var(--muted);line-height:1.8;">';
    segments.forEach((d, i) => {
      html += 'Отрезок ' + (i + 1) + ': ' + fmt(d) + '<br>';
    });
    html += '</div>';
  }
  resEl.innerHTML = html;
  if (hudVal) hudVal.textContent = fmt(totalM);

  document.getElementById('btnRulerClear').style.display = 'block';
}

function clearRuler() {
  rulerStop();
  RULER.points = [];
  RULER.markers = [];
  RULER.lines   = [];
  if (RULER.layer) { S.map.removeLayer(RULER.layer); RULER.layer = null; }
  const resEl = document.getElementById('rulerResult');
  if (resEl) resEl.style.display = 'none';
  const clrBtn = document.getElementById('btnRulerClear');
  if (clrBtn) clrBtn.style.display = 'none';
  document.getElementById('hudRuler').style.display = 'none';
}

// ═══════════════════════════════════════
//  SESSION SAVE / LOAD / PERMALINK
// ═══════════════════════════════════════
function buildSessionData() {
  return {
    v: 2,
    ts: new Date().toISOString(),
    center: S.searchCenter,
    radius: S.searchRadius,
    tileKey: S.tileKey,
    bearingAngle: S.bearingAngle,
    bearingActive: S.bearingMode,
    bearingCenter: S.bearingCenter,
    sunDate: (() => { const d = getSunDatetime(); return d ? d.toISOString() : ''; })(),
    bufferM: parseInt(document.getElementById('bufferSlider').value),
    clues: S.clues.map(c => ({
      id:      c.id,
      text:    c.text,
      rawText: c.rawText || c.text,
      brand:   c.brand   || '',
      copyNum: c.copyNum || 1,
      color:   c.color,
    })),
    nextId: S.nextId,
  };
}

function saveSession() {
  const data = buildSessionData();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a = Object.assign(document.createElement('a'), {
    href: url,
    download: 'geoint_session_' + new Date().toISOString().slice(0,10) + '.json'
  });
  a.click();
  URL.revokeObjectURL(url);
  toast('Сессия сохранена');
}

function loadSessionFile() {
  document.getElementById('sessionFileInput').click();
}

function initSessionLoad() {
  document.getElementById('sessionFileInput').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      try {
        const data = JSON.parse(ev.target.result);
        restoreSession(data);
      } catch {
        toast('Ошибка чтения файла сессии', true);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });
}

function restoreSession(data) {
  if (!data || data.v !== 2) { toast('Формат сессии не поддерживается', true); return; }

  // Clear
  clearAll(true);

  // Tile
  if (data.tileKey) setTile(data.tileKey);

  // Center + radius
  if (data.center) {
    document.getElementById('radiusSlider').value = data.radius || 5;
    document.getElementById('radiusVal').textContent = (data.radius || 5) + ' км';
    S.searchRadius = data.radius || 5;
    setSearchCenter(data.center.lat, data.center.lon);
    S.map.setView([data.center.lat, data.center.lon], 13);
  }

  // Buffer
  if (data.bufferM) {
    document.getElementById('bufferSlider').value = data.bufferM;
    const v = data.bufferM;
    document.getElementById('bufferVal').textContent = v >= 1000 ? (v/1000).toFixed(1) + ' км' : v + ' м';
  }

  // Sun date
  if (data.sunDate) { try { setSunDatetime(new Date(data.sunDate)); } catch {} }

  // Bearing
  if (data.bearingAngle != null) {
    S.bearingAngle = data.bearingAngle;
    document.getElementById('bearingSlider').value = data.bearingAngle;
    document.getElementById('bearingInput').value  = data.bearingAngle;
    document.getElementById('hudBearingVal').textContent = data.bearingAngle + '°';
  }

  // Clues
  if (data.clues) {
    S.nextId = data.nextId || (data.clues.length + 1);
    data.clues.forEach(c => {
      S.clues.push({
        id:      c.id,
        text:    c.text,
        rawText: c.rawText || c.text,
        brand:   c.brand   || '',
        copyNum: c.copyNum || 1,
        color:   c.color,
        resolved: resolveTag(c.rawText || c.text),
        status: 'pending',
        layer:  null,
        count:  0,
      });
    });
    renderClues();
    updateHUD();
    if (S.clues.length) document.getElementById('btnAnalyze').disabled = false;
  }

  toast('Сессия загружена · ' + (data.ts || '').slice(0,10));
}

const PERMALINK_LS_KEY = 'geoint_session_permalink';
const URL_MAX_LEN = 1900; // безопасный лимит с запасом

function copyPermalink() {
  const data = buildSessionData();
  const encoded = btoa(unescape(encodeURIComponent(JSON.stringify(data))));
  const baseUrl = location.href.split('?')[0];
  const url = baseUrl + '?s=' + encoded;

  if (url.length > URL_MAX_LEN) {
    // URL слишком длинный — сохраняем в localStorage, копируем короткую ссылку с флагом
    try {
      localStorage.setItem(PERMALINK_LS_KEY, JSON.stringify(data));
      const shortUrl = baseUrl + '?s=local';
      _copyToClipboard(shortUrl);
      toast('Сессия → localStorage · ссылка скопирована (' + url.length + ' симв, лимит ' + URL_MAX_LEN + ')');
    } catch(e) {
      // localStorage недоступен (private mode и т.д.) — копируем как есть с предупреждением
      _copyToClipboard(url);
      toast('⚠ URL длинный (' + url.length + ' симв) — может не открыться в некоторых браузерах', true);
    }
  } else {
    _copyToClipboard(url);
    toast('Ссылка скопирована (' + url.length + ' симв)');
  }
}

function _copyToClipboard(text) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).catch(() => _copyFallback(text));
  } else {
    _copyFallback(text);
  }
}

function _copyFallback(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  document.execCommand('copy');
  document.body.removeChild(ta);
}

function loadFromUrl() {
  const params = new URLSearchParams(location.search);
  const s = params.get('s');
  if (!s) return;

  // Флаг 'local' — восстанавливаем из localStorage
  if (s === 'local') {
    try {
      const raw = localStorage.getItem(PERMALINK_LS_KEY);
      if (!raw) { toast('Локальная сессия не найдена', true); return; }
      restoreSession(JSON.parse(raw));
      toast('Сессия восстановлена из localStorage');
    } catch {
      toast('Ошибка восстановления локальной сессии', true);
    }
    return;
  }

  // Обычный base64 permalink
  try {
    const data = JSON.parse(decodeURIComponent(escape(atob(s))));
    restoreSession(data);
    toast('Сессия восстановлена из ссылки');
  } catch {
    toast('Ошибка в ссылке', true);
  }
}

function clearAll(silent = false) {
  // Remove all layers
  if (S.layerGroup) S.layerGroup.clearLayers();
  if (S.searchPinLayer) { S.map.removeLayer(S.searchPinLayer); S.searchPinLayer = null; }
  if (S.bearingLayer) { S.map.removeLayer(S.bearingLayer); S.bearingLayer = null; }
  if (S.intersectionLayer) { S.map.removeLayer(S.intersectionLayer); S.intersectionLayer = null; }
  if (S.sunLayer) { S.map.removeLayer(S.sunLayer); S.sunLayer = null; }

  S.searchCenter = null;
  S.clues = [];
  S.allPoints = [];
  S.bearingMode = false;
  S.sunActive = false;

  document.getElementById('centerDisplay').classList.remove('visible');
  document.getElementById('pinIcon').textContent = '📍';
  document.getElementById('pinLabel').textContent = 'КЛИКНИ НА КАРТУ — ЦЕНТР ПОИСКА';
  document.getElementById('btnBearing').classList.remove('active');
  document.getElementById('btnBearing').textContent = '🧭 ЗАДАТЬ НАПРАВЛЕНИЕ КАМЕРЫ';
  document.getElementById('bearingAngleWrap').classList.remove('visible');
  document.getElementById('hudBearing').style.display = 'none';
  document.getElementById('sunResult').classList.remove('visible');
  document.getElementById('legendBox').classList.remove('visible');
  document.getElementById('legendItems').innerHTML = '';
  document.getElementById('candidateList').innerHTML = '';
  document.getElementById('btnExport').style.display = 'none';
  document.getElementById('btnAnalyze').disabled = true;
  document.body.classList.remove('pin-mode','bearing-mode');

  renderClues();
  updateHUD();
  if (!silent) toast('Сессия сброшена');
}

// ═══════════════════════════════════════
//  REGION FILTER (Nominatim bbox)
// ═══════════════════════════════════════
//  BUFFER SLIDER
// ═══════════════════════════════════════
function initBufferSlider() {
  const sl  = document.getElementById('bufferSlider');
  const val = document.getElementById('bufferVal');
  function update() {
    const v = parseInt(sl.value);
    val.textContent = v >= 1000 ? (v / 1000).toFixed(1) + ' км' : v + ' м';
  }
  sl.addEventListener('input', update);
  update();
}

// ═══════════════════════════════════════
//  ANALYZE BUTTON INIT
// ═══════════════════════════════════════
function initAnalyzeBtn() {
  const btn = document.getElementById('btnAnalyze');
  btn.addEventListener('click', analyze);
}

// ═══════════════════════════════════════
// Состояние региона: null | { name, bbox, confirmed }
// bbox формат Overpass: (south,west,north,east)

function initRegionFilter() {
  // Восстанавливаем из сессии при loadFromUrl — ничего особого
}

function onRegionInput() {
  // Сбрасываем bbox при изменении ввода
  if (S.region) {
    S.region = null;
    renderRegionStatus();
  }
}

async function applyRegion() {
  const val = document.getElementById('regionInput').value.trim();
  if (!val) {
    S.region = null;
    renderRegionStatus();
    toast('Фильтр региона сброшен');
    return;
  }

  const statusEl = document.getElementById('regionStatus');
  statusEl.style.display = 'block';
  statusEl.style.background = 'rgba(0,153,204,.06)';
  statusEl.style.border = '1px solid rgba(0,153,204,.2)';
  statusEl.style.color = 'var(--accent)';
  statusEl.textContent = '⌛ geocoding…';

  try {
    const url = 'https://nominatim.openstreetmap.org/search'
      + '?q=' + encodeURIComponent(val)
      + '&format=json&limit=1&featuretype=country,state,city,region';
    const res  = await fetch(url, { headers: { 'Accept-Language': 'ru,en' } });
    const data = await res.json();

    if (!data.length) {
      statusEl.style.background = 'rgba(204,51,0,.06)';
      statusEl.style.border     = '1px solid rgba(204,51,0,.2)';
      statusEl.style.color      = 'var(--accent2)';
      statusEl.textContent = '⚠ Регион не найден — проверь написание';
      return;
    }

    const r = data[0];
    // bbox от Nominatim: [south, north, west, east] → нам нужно (s,w,n,e)
    const [s, n, w, e] = [
      parseFloat(r.boundingbox[0]),
      parseFloat(r.boundingbox[1]),
      parseFloat(r.boundingbox[2]),
      parseFloat(r.boundingbox[3]),
    ];

    S.region = {
      name:      r.display_name.split(',')[0].trim(),
      fullName:  r.display_name,
      bbox:      [s, w, n, e],   // Overpass порядок
      confirmed: false,
    };

    renderRegionStatus();

    // Показываем bbox на карте
    const bounds = L.latLngBounds([[s, w], [n, e]]);
    S.map.fitBounds(bounds, { padding: [20, 20] });
    toast('Регион: ' + S.region.name + ' (предполагаемый)');

  } catch (err) {
    statusEl.style.color = 'var(--accent2)';
    statusEl.textContent = '⚠ Ошибка: ' + err.message;
  }
}

function confirmRegion() {
  if (!S.region) return;
  S.region.confirmed = true;
  renderRegionStatus();
  toast('✓ Регион подтверждён: ' + S.region.name);
}

function clearRegion() {
  S.region = null;
  document.getElementById('regionInput').value = '';
  renderRegionStatus();
  toast('Фильтр региона сброшен');
}

function renderRegionStatus() {
  const el = document.getElementById('regionStatus');
  if (!S.region) {
    el.style.display = 'none';
    return;
  }
  el.style.display = 'block';

  if (S.region.confirmed) {
    el.style.background = 'rgba(0,177,64,.07)';
    el.style.border     = '1px solid rgba(0,177,64,.25)';
    el.style.color      = '#00b140';
    el.innerHTML = '✓ <b>' + S.region.name + '</b> — подтверждён'
      + ' &nbsp;<button onclick="clearRegion()" style="font-size:8px;background:none;border:none;'
      + 'color:var(--muted);cursor:pointer;padding:0 2px;">✕</button>';
  } else {
    el.style.background = 'rgba(255,165,0,.06)';
    el.style.border     = '1px solid rgba(255,165,0,.2)';
    el.style.color      = '#cc8800';
    el.innerHTML = '? <b>' + S.region.name + '</b> — предполагаемый'
      + ' &nbsp;<button onclick="confirmRegion()" style="font-size:8px;background:rgba(0,177,64,.12);'
      + 'border:1px solid rgba(0,177,64,.3);color:#00b140;cursor:pointer;border-radius:2px;padding:1px 5px;">'
      + '✓ подтвердить</button>'
      + ' <button onclick="clearRegion()" style="font-size:8px;background:none;border:none;'
      + 'color:var(--muted);cursor:pointer;padding:0 2px;">✕</button>';
  }
}

// Возвращает bbox-строку для Overpass или '' если регион не задан
function getRegionBbox() {
  if (!S.region) return '';
  const [s, w, n, e] = S.region.bbox;
  return '(' + s + ',' + w + ',' + n + ',' + e + ')';
}

// ═══════════════════════════════════════
//  DISTANCE CONSTRAINTS
// ═══════════════════════════════════════

function refreshDistSelects() {
  const selA = document.getElementById('distClueA');
  const selB = document.getElementById('distClueB');
  if (!selA || !selB) return;

  const prevA = selA.value, prevB = selB.value;
  selA.innerHTML = '';
  selB.innerHTML = '';

  S.clues.forEach(c => {
    const label = c.text + (c.resolved ? ' (' + c.resolved.label + ')' : '');
    [selA, selB].forEach(sel => {
      const opt = document.createElement('option');
      opt.value = c.id;
      opt.textContent = label;
      sel.appendChild(opt);
    });
  });

  if (prevA) selA.value = prevA;
  if (prevB) selB.value = prevB;

  // Показываем секцию только если зацепок ≥ 2
  const sec = document.getElementById('distSection');
  if (sec) sec.style.display = S.clues.length >= 2 ? '' : 'none';
}

function addDistConstraint() {
  const selA = document.getElementById('distClueA');
  const selB = document.getElementById('distClueB');
  const mEl  = document.getElementById('distMeters');

  const idA = parseInt(selA.value);
  const idB = parseInt(selB.value);
  const m   = parseInt(mEl.value);

  if (idA === idB) { toast('Выбери разные зацепки', true); return; }
  if (!m || m < 10) { toast('Укажи расстояние ≥ 10 м', true); return; }

  // Проверяем дубли
  if (S.distConstraints.some(c => c.idA === idA && c.idB === idB)) {
    toast('Такое ограничение уже есть', true); return;
  }

  const nameA = S.clues.find(c => c.id === idA)?.text || idA;
  const nameB = S.clues.find(c => c.id === idB)?.text || idB;
  S.distConstraints.push({ idA, idB, m, nameA, nameB });
  renderDistConstraints();
}

function removeDistConstraint(idx) {
  S.distConstraints.splice(idx, 1);
  renderDistConstraints();
}

function renderDistConstraints() {
  const el = document.getElementById('distList');
  if (!el) return;
  el.innerHTML = '';
  S.distConstraints.forEach((c, i) => {
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;align-items:center;gap:5px;padding:3px 0;'
      + 'font-family:"IBM Plex Mono",monospace;font-size:9px;color:var(--text);border-bottom:1px solid var(--border2);';
    row.innerHTML = '<span style="color:var(--accent);flex:1">'
      + c.nameA + '</span>'
      + '<span style="color:var(--muted)"> &lt; ' + c.m + 'м от </span>'
      + '<span style="color:var(--accent);flex:1">' + c.nameB + '</span>'
      + '<button onclick="removeDistConstraint(' + i + ')" style="background:none;border:none;'
      + 'color:var(--muted2);cursor:pointer;font-size:10px;padding:0 3px;">✕</button>';
    el.appendChild(row);
  });
}

// Применяем ограничения к списку кандидатов
// candidates: [{lat, lon, clueId, ...}, ...]
// results: Map<clueId, [{lat,lon}]>
function applyDistConstraints(candidates, resultsMap) {
  if (!S.distConstraints.length) return candidates;

  return candidates.filter(cand => {
    return S.distConstraints.every(constraint => {
      const ptsA = resultsMap.get(constraint.idA) || [];
      const ptsB = resultsMap.get(constraint.idB) || [];
      if (!ptsA.length || !ptsB.length) return true; // не можем проверить — пропускаем

      // Для кандидата проверяем: есть ли хоть одна пара A,B на расстоянии < m
      return ptsA.some(a =>
        ptsB.some(b => {
          const from = turf.point([a.lon, a.lat]);
          const to   = turf.point([b.lon, b.lat]);
          return turf.distance(from, to, { units: 'meters' }) < constraint.m;
        })
      );
    });
  });
}

// ═══════════════════════════════════════
//  REVERSE SEARCH
// ═══════════════════════════════════════

async function reverseSearch(lat, lon, candidateEl) {
  const radius = 400; // метров
  const btn = candidateEl.querySelector('.reverse-btn');
  const panel = candidateEl.querySelector('.reverse-panel');

  if (panel.style.display !== 'none') {
    panel.style.display = 'none';
    if (btn) btn.textContent = '🔍 что рядом';
    return;
  }

  if (btn) { btn.textContent = '⌛'; btn.disabled = true; }
  panel.style.display = 'block';
  panel.innerHTML = '<span style="color:var(--muted)">запрос Overpass…</span>';

  // Запрашиваем топ-15 категорий в радиусе
  const sf = '(around:' + radius + ',' + lat + ',' + lon + ')';
  const query = `[out:json][timeout:30];(
    node[amenity]${sf};
    node[shop]${sf};
    node[tourism]${sf};
    node[historic]${sf};
    node[leisure]${sf};
    node[man_made]${sf};
    node[natural]${sf};
    node[waterway]${sf};
    way[waterway]${sf};
    node[highway=bus_stop]${sf};
    way[railway]${sf};
    way[highway~"motorway|trunk|primary"]${sf};
    node[military]${sf};
    way[military]${sf};
    node[landuse]${sf};
  );out tags 80;`;

  try {
    const res  = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: 'data=' + encodeURIComponent(query),
    });
    const data = await res.json();
    const els  = data.elements || [];

    if (!els.length) {
      panel.innerHTML = '<span style="color:var(--muted)">объектов в ' + radius + ' м не найдено</span>';
      if (btn) { btn.textContent = '🔍 что рядом'; btn.disabled = false; }
      return;
    }

    // Группируем по типу
    const groups = {};
    const ICONS = {
      amenity: '🏛', shop: '🛒', tourism: '🏨', historic: '🏰', leisure: '🌳',
      man_made: '🏗', natural: '🌿', waterway: '💧', highway: '🚏',
      railway: '🚂', military: '⚔', landuse: '🗺',
    };
    els.forEach(el => {
      const tags = el.tags || {};
      // Берём первый значимый тег
      const key = ['amenity','shop','tourism','historic','leisure','man_made',
                   'natural','waterway','highway','railway','military','landuse']
                   .find(k => tags[k]);
      if (!key) return;
      const val  = tags[key];
      const name = tags.name || '';
      const icon = ICONS[key] || '📍';
      const label = icon + ' ' + val + (name ? ' · ' + name : '');
      groups[label] = (groups[label] || 0) + 1;
    });

    const items = Object.entries(groups)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12);

    panel.innerHTML = '<div style="font-size:8px;color:var(--muted);margin-bottom:3px;">'
      + 'в радиусе ' + radius + ' м:</div>'
      + items.map(([label, cnt]) =>
          '<div style="padding:1px 0;">' + label
          + (cnt > 1 ? ' <span style="color:var(--muted)">×' + cnt + '</span>' : '')
          + '</div>'
        ).join('');

  } catch(e) {
    panel.innerHTML = '<span style="color:var(--accent2)">⚠ ' + e.message + '</span>';
  }

  if (btn) { btn.textContent = '🔍 что рядом'; btn.disabled = false; }
}

// ═══════════════════════════════════════
//  BOOT
// ═══════════════════════════════════════
async function init() {
  await loadTags();
  initMap();
  initPhotoDrop();
  initSearchCenter();
  initBearingSlider();
  initClues();
  initBufferSlider();
  initAnalyzeBtn();
  initSessionLoad();
  initRegionFilter();
  fetchOverpassStatus();
  setInterval(fetchOverpassStatus, 30000);
  loadFromUrl();
}

init();

