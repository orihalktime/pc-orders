/* ==========================================================================
   TELEGRAM WEB APP — EXPLORER STATION
   Бесшовный режим: покупки и сдача заказов БЕЗ вылета из приложения.
   Окно закрывает ТОЛЬКО пользователь крестиком ✕: ни tg.close(), ни редиректов,
   ни sendData (он закрывает окно), ни fetch к бэкенду (Mixed Content: бот живёт
   на HTTP без SSL, а приложение — на HTTPS).
   Авторитетный источник — чат: бот каждый раз генерирует свежие параметры профиля
   и битовую маску слотов в адрес приложения. Локально состояние живёт в
   localStorage и в CloudStorage Telegram (пассивный синхрон-приёмник клиента).
   ========================================================================== */

const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  // Свайп вниз и подтверждение закрытия: приложение остаётся открытым, пока
  // пользователь не нажмёт ✕ сам.
  if (typeof tg.disableVerticalSwipes === 'function') tg.disableVerticalSwipes();
  if (typeof tg.enableClosingConfirmation === 'function') tg.enableClosingConfirmation();
}

const SLOT_COUNT = 3;
const SLOT_NAMES = ['🎬 Рендер', '🧠 Нейросеть', '⚙️ Ядро ОС'];
const LS_KEY = 'pc-orders:state';
const CS_KEY = 'pc_orders_v2'; // ключ в CloudStorage Telegram (лимит значения — 1 КБ)

// 1. Параметры, которые бот подставил в адрес при открытии приложения
const urlParams = new URLSearchParams(window.location.search);
const startParam = tg?.initDataUnsafe?.start_param || '';

const num = (v, fallback = 0) => {
  const n = parseInt(v, 10);
  return Number.isFinite(n) ? n : fallback;
};

const nowSec = () => Math.floor(Date.now() / 1000);

const player = {
  uid: urlParams.get('uid') || '0',
  rub: num(urlParams.get('rub')),
  sat: num(urlParams.get('sat')),
  lvl: num(urlParams.get('tier'), 1),
  cases: num(urlParams.get('case'), 1),
  mobo: num(urlParams.get('mobo'), 1),
  cpu: num(urlParams.get('cpu'), 1),
  cooler: num(urlParams.get('cooler'), 1),
  ram: num(urlParams.get('ram'), 1),
  ssd: num(urlParams.get('storage'), 1),
  gpu: num(urlParams.get('gpu'), 1),
  psu: num(urlParams.get('psu'), 1),
  moboStab: num(urlParams.get('moboStab'), 50)
};

// Биты доступности слотов: бит 0 — слот 1, бит 1 — слот 2, бит 2 — слот 3 (7 = все свободны).
let slotsMask = 7;
let maskFromServer = false;
// Абсолютные моменты (unix, сек) освобождения слотов: считаются локально, тикают раз в секунду.
let cdUntil = [0, 0, 0];

// Открыто из группы по прямой ссылке t.me/bot?startapp=... — компактная строка через "_"
function applyStartParam(raw) {
  if (!raw || !raw.includes('_')) return;
  const p = raw.split('_');
  if (p.length < 12) return;

  player.rub = num(p[0], player.rub);
  player.sat = num(p[1], player.sat);
  player.lvl = num(p[2], player.lvl);
  player.cases = num(p[3], player.cases);
  player.mobo = num(p[4], player.mobo);
  player.cpu = num(p[5], player.cpu);
  player.cooler = num(p[6], player.cooler);
  player.ram = num(p[7], player.ram);
  player.ssd = num(p[8], player.ssd);
  player.gpu = num(p[9], player.gpu);
  player.psu = num(p[10], player.psu);
  player.moboStab = num(p[11], player.moboStab);

  if (p.length >= 13) {
    slotsMask = num(p[12], 7) & 7;
    maskFromServer = true;
  }

  const t = nowSec();
  for (let i = 0; i < SLOT_COUNT; i++) {
    if (p.length >= 16 + i) cdUntil[i] = t + num(p[13 + i]) * 60;
  }
}

// Полный URL (кнопка web_app в личке): маска слотов и остатки кулдаунов в секундах
function applyQuerySlots() {
  if (!urlParams.has('slots')) return;
  slotsMask = num(urlParams.get('slots'), 7) & 7;
  maskFromServer = true;
  const t = nowSec();
  for (let i = 0; i < SLOT_COUNT; i++) {
    const sec = num(urlParams.get('cd' + i));
    if (sec > 0) cdUntil[i] = t + sec;
  }
}

// 2. Локальный снимок (localStorage + CloudStorage Telegram).
// Он НЕ источник истины: баланс и тиры всегда приезжают от бота. Хранится только
// то, что сервер не передаёт, — остатки кулдаунов слотов и очередь действий,
// которым ещё нужно подтверждение в чате.
let pending = [];

function loadLocal() {
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { saved = null; }

  if (!saved && tg?.CloudStorage) {
    // CloudStorage отдаёт значение только в колбэке, поэтому подхватываем его позже.
    tg.CloudStorage.getItem(CS_KEY, (err, value) => {
      if (err || !value) return;
      try { hydrate(JSON.parse(value)); } catch { /* мусор в облаке игнорируем */ }
    });
  } else if (saved) {
    hydrate(saved);
  }
}

function hydrate(saved) {
  if (!saved || saved.uid !== player.uid) return;
  if (!maskFromServer && Number.isInteger(saved.slotsMask)) slotsMask = saved.slotsMask & 7;
  if (Array.isArray(saved.cdUntil)) {
    for (let i = 0; i < SLOT_COUNT; i++) {
      const value = num(saved.cdUntil[i]);
      if (value > cdUntil[i]) cdUntil[i] = value;
    }
  }
  if (Array.isArray(saved.pending)) pending = saved.pending.slice(-20);
}

function persist() {
  const snapshot = { uid: player.uid, slotsMask, cdUntil, pending, savedAt: nowSec() };
  let json = '';
  try {
    json = JSON.stringify(snapshot);
    localStorage.setItem(LS_KEY, json);
  } catch { /* приватный режим — просто живём без локального кэша */ }
  // CloudStorage — «фоновый пинг синхронизации»: клиент сам откладывает снимок в облаке
  // Telegram, чтобы состояние пережило перезапуск приложения. Значение короче 1 КБ.
  if (tg?.CloudStorage && json.length <= 1024) {
    try { tg.CloudStorage.setItem(CS_KEY, json, () => {}); } catch { /* квота исчерпана */ }
  }
}

// 3. Слоты: три параллельных рабочих места с независимым кулдауном
const slotLeft = (i) => Math.max(0, cdUntil[i] - nowSec());
const slotReady = (i) => {
  if (slotLeft(i) > 0) return false;
  return ((slotsMask >> i) & 1) === 1 || !maskFromServer;
};

function occupySlot(i) {
  cdUntil[i] = nowSec() + 45 * 60;
  slotsMask &= ~(1 << i);
  persist();
}

function fmtLeft(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m > 0 ? `${m} мин ${s} сек` : `${s} сек`;
}

// 4. Обновление интерфейса
function updateUI() {
  document.getElementById('h-rub').innerText = player.rub.toLocaleString('ru-RU');
  document.getElementById('val-cpu').innerText = 'T' + player.cpu;
  document.getElementById('val-gpu').innerText = 'T' + player.gpu;
  document.getElementById('val-ram').innerText = 'T' + player.ram;
  document.getElementById('val-ssd').innerText = 'T' + player.ssd;
  renderSlots();
  renderSync();
}

function renderSlots() {
  const bar = document.getElementById('slot-strip');
  if (!bar) return;
  bar.innerHTML = '';

  for (let i = 0; i < SLOT_COUNT; i++) {
    const left = slotLeft(i);
    const ready = slotReady(i);
    const pill = document.createElement('div');
    pill.className = 'slot-pill' + (ready ? ' ready' : ' busy');
    pill.innerHTML = `<span class="slot-name">Слот ${i + 1}</span>` +
      `<span class="slot-state">${ready ? 'свободен' : `⏳ ${fmtLeft(left)}`}</span>`;
    bar.appendChild(pill);
  }
}

// 5. Очередь синхронизации с чатом: авторитетные изменения проходят через бот,
// поэтому клиент только показывает готовую команду и копирует её по кнопке.
function renderSync() {
  const badge = document.getElementById('sync-badge');
  const panel = document.getElementById('sync-panel');
  const text = document.getElementById('sync-text');
  const copyBtn = document.getElementById('sync-copy');
  if (!badge || !panel || !text) return;

  const last = pending[pending.length - 1];
  badge.innerText = pending.length > 0 ? `🔄 Синхронизация: ${pending.length}` : '✅ Синхронизировано';
  panel.style.display = pending.length > 0 ? 'block' : 'none';
  if (!last) return;

  text.innerText = last.command;
  copyBtn.onclick = () => {
    const done = () => tg?.HapticFeedback?.notificationOccurred('success');
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(last.command).then(done, done);
    else done();
  };
}

function queueCommand(kind, payload) {
  pending.push({ kind, ...payload, command: payload.command, at: nowSec() });
  persist();
  renderSync();
}

// 6. Переключение вкладок
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b, idx) => {
    b.classList.toggle('active', (name === 'orders' && idx === 0) || (name === 'shop' && idx === 1));
  });
  document.getElementById('tab-orders').classList.toggle('active', name === 'orders');
  document.getElementById('tab-shop').classList.toggle('active', name === 'shop');
}

// 7. Каталог магазина (цены и тиры считает сервер, здесь — витрина)
function getCatalog() {
  return [
    { key: 'gpu', icon: '🎮', name: 'Видеокарта', curTier: player.gpu },
    { key: 'cpu', icon: '🧠', name: 'Процессор', curTier: player.cpu },
    { key: 'mobo', icon: '🔌', name: 'Материнская плата', curTier: player.mobo },
    { key: 'cooler', icon: '❄️', name: 'Охлаждение', curTier: player.cooler },
    { key: 'ram', icon: '🧮', name: 'Оперативная память', curTier: player.ram },
    { key: 'storage', icon: '💾', name: 'Накопитель (SSD/HDD)', curTier: player.ssd },
    { key: 'psu', icon: '🔋', name: 'Блок питания', curTier: player.psu },
    { key: 'case', icon: '📦', name: 'Корпус станции', curTier: player.cases }
  ];
}

function renderShop() {
  const container = document.getElementById('shop-container');
  container.innerHTML = '';

  getCatalog().forEach(item => {
    const nextTier = item.curTier + 1;
    const price = Math.round(100 * Math.pow(1.5, Math.min(nextTier, 100)));
    const canBuy = player.rub >= price && nextTier <= 100;

    const card = document.createElement('div');
    card.className = 'shop-card';
    card.innerHTML = `
      <div class="card-header">
        <span class="badge">${item.icon} ${item.name}</span>
        <span class="payout">${nextTier <= 100 ? price.toLocaleString('ru-RU') + ' ₽' : 'MAX'}</span>
      </div>
      <div class="card-title">Текущий: Тир ${item.curTier} / 100</div>
      <div class="card-sub">${nextTier <= 100 ? `Апгрейд до Тира ${nextTier}` : 'Топовая деталь установлена'}</div>
      <button class="action-btn buy-btn" ${canBuy ? '' : 'disabled'} onclick="buyPart('${item.key}')">
        ${nextTier > 100 ? 'Пройдено полностью' : canBuy ? `Купить тир ${nextTier}` : 'Не хватает рублей'}
      </button>
    `;
    container.appendChild(card);
  });
}

// Покупка детали: деньги и тир меняет БОТ (команда уходит в чат), приложение
// остаётся открытым и сразу показывает предвкусию апгрейда.
function buyPart(category) {
  queueCommand('buy', { category, command: `/start buy_${category}` });

  player.rub -= nextPrice(category);
  bumpTier(category);
  recomputeLevel();

  updateUI();
  renderShop();
  renderOrders();
  tg?.HapticFeedback?.notificationOccurred('success');
}

function nextPrice(category) {
  const tier = tierOf(category) + 1;
  return Math.round(100 * Math.pow(1.5, Math.min(tier, 100)));
}

function tierOf(category) {
  return ({
    gpu: player.gpu, cpu: player.cpu, mobo: player.mobo, cooler: player.cooler,
    ram: player.ram, storage: player.ssd, psu: player.psu, case: player.cases
  })[category] || 1;
}

function bumpTier(category) {
  if (category === 'gpu') player.gpu++;
  else if (category === 'cpu') player.cpu++;
  else if (category === 'mobo') player.mobo++;
  else if (category === 'cooler') player.cooler++;
  else if (category === 'ram') player.ram++;
  else if (category === 'storage') player.ssd++;
  else if (category === 'psu') player.psu++;
  else if (category === 'case') player.cases++;
}

function recomputeLevel() {
  player.lvl = Math.max(1, Math.floor((player.cpu + player.gpu + player.ram + player.ssd) / 4));
}

// 8. Контракты биржи. Номер в массиве + 1 === слот доски, поэтому заведённый
// контракт занимает ровно один слот и не блокирует два остальных.
function buildContracts() {
  return [
    {
      id: 'vfx',
      cat: '3D Рендер',
      title: 'Рендер взрыва реактора (4K, Blender)',
      client: 'Студия «Cinematic FX»',
      desc: 'Срочно дорендерить 120 кадров эффектов взрыва к финальному монтажу. Сцена забита частицами и дымом.',
      req: { gpu: Math.max(1, player.lvl), ram: Math.max(1, Math.floor(player.lvl * 0.7)) },
      reward: { rub: player.lvl * 650 + 400, sat: 0 },
      logs: [
        'Инициализация сцены Blender Cycles...',
        'Загрузка текстур VRAM 8K OpenEXR...',
        'Расчёт трассировки лучей (bounces: 12)...',
        'Рендеринг тайлов 256x256...',
        'Шумоподавление OptiX AI Denoiser...',
        'Финальная сборка кадров в видеопоток...'
      ]
    },
    {
      id: 'lora',
      cat: 'Нейросети',
      title: 'Дообучение LoRA модели на 50 000 строк',
      client: 'Стартап «NeuralMind»',
      desc: 'Требуется тонкая настройка весов модели на датасете юридических документов. Высокие требования к памяти и чтению диска.',
      req: { gpu: Math.max(1, Math.floor(player.lvl * 0.8)), ssd: Math.max(2, Math.floor(player.lvl * 0.75)) },
      reward: { rub: 0, sat: Math.max(50, Math.floor(player.lvl * 120)) },
      logs: [
        'Чтение датасета с SSD-накопителя (IOPS проверка)...',
        'Токенизация текстового корпуса...',
        'Эпоха 1/3: Loss = 2.451...',
        'Эпоха 2/3: Loss = 1.120...',
        'Эпоха 3/3: Loss = 0.412...',
        'Квантование адаптеров LoRA (FP16)...'
      ]
    },
    {
      id: 'rtos',
      cat: 'DevOps',
      title: 'Сборка Real-Time ядра Linux с ЧПУ-модулями',
      client: 'АО «ПромАвтоматика»',
      desc: 'Компиляция кастомного RT-Kernel из исходников. Нужна абсолютная стабильность материнской платы, иначе Kernel Panic.',
      req: { cpu: Math.max(1, player.lvl), mobo: 45 },
      reward: { rub: player.lvl * 800 + 500, sat: Math.floor(player.lvl * 30) },
      logs: [
        'Конфигурация Makefile (.config RT_PREEMPT)...',
        'Компиляция модулей архитектуры (make -j)...',
        'Сборка драйверов шины CAN и SPI...',
        'Линковка бинарного образа vmlinuz...',
        'Генерация initramfs...',
        'Тест стабильности шины питания платы: OK!'
      ]
    }
  ];
}

let contracts = buildContracts();
let currentOrder = null;
let currentSlot = -1;

function renderOrders() {
  const container = document.getElementById('orders-container');
  container.innerHTML = '';

  contracts.forEach((c, i) => {
    let canTake = true;
    let reqsHtml = '';
    const left = slotLeft(i);
    const free = slotReady(i);

    if (c.req.gpu) {
      const ok = player.gpu >= c.req.gpu; if (!ok) canTake = false;
      reqsHtml += `<div class="req-item ${ok ? 'ok' : 'fail'}">GPU: T${c.req.gpu} ${ok ? '✓' : '✗'}</div>`;
    }
    if (c.req.cpu) {
      const ok = player.cpu >= c.req.cpu; if (!ok) canTake = false;
      reqsHtml += `<div class="req-item ${ok ? 'ok' : 'fail'}">CPU: T${c.req.cpu} ${ok ? '✓' : '✗'}</div>`;
    }
    if (c.req.ram) {
      const ok = player.ram >= c.req.ram; if (!ok) canTake = false;
      reqsHtml += `<div class="req-item ${ok ? 'ok' : 'fail'}">RAM: T${c.req.ram} ${ok ? '✓' : '✗'}</div>`;
    }
    if (c.req.ssd) {
      const ok = player.ssd >= c.req.ssd; if (!ok) canTake = false;
      reqsHtml += `<div class="req-item ${ok ? 'ok' : 'fail'}">SSD: T${c.req.ssd} ${ok ? '✓' : '✗'}</div>`;
    }
    if (c.req.mobo) {
      const ok = player.moboStab >= c.req.mobo; if (!ok) canTake = false;
      reqsHtml += `<div class="req-item ${ok ? 'ok' : 'fail'}">Плата: ${c.req.mobo}% ${ok ? '✓' : '✗'}</div>`;
    }

    let payText = '';
    if (c.reward.rub > 0) payText += `${c.reward.rub.toLocaleString('ru-RU')} ₽ `;
    if (c.reward.sat > 0) payText += `${c.reward.sat.toLocaleString('ru-RU')} SAT`;

    const card = document.createElement('div');
    card.className = `order-card ${canTake && free ? '' : 'locked'}`;
    card.innerHTML = `
      <div class="card-header">
        <span class="badge">Слот ${i + 1} · ${c.cat}</span>
        <span class="payout">${payText}</span>
      </div>
      <div class="card-title">${c.title}</div>
      <div class="card-sub">Заказчик: ${c.client}</div>
      <div class="card-desc">${c.desc}</div>
      <div class="req-list">${reqsHtml}</div>
      <button class="action-btn" ${canTake && free ? '' : 'disabled'} onclick='startExecution(${i})'>
        ${!free ? `⏳ Слот занят ещё ${fmtLeft(left)}` : canTake ? 'Взять контракт в работу' : 'Железо не подходит'}
      </button>
    `;
    container.appendChild(card);
  });
}

function startExecution(index) {
  const order = contracts[index];
  if (!order || !slotReady(index)) return;

  currentOrder = order;
  currentSlot = index;
  document.getElementById('execution-modal').style.display = 'flex';
  document.getElementById('m-title').innerText = `Слот ${index + 1} · ${order.title}`;
  document.getElementById('m-slot').innerText = `СЛОТ ${index + 1}`;

  const consoleBox = document.getElementById('m-console');
  const progressBar = document.getElementById('m-progress');
  const finishBtn = document.getElementById('m-finish-btn');

  consoleBox.innerHTML = '';
  progressBar.style.width = '0%';
  finishBtn.style.display = 'none';
  finishBtn.disabled = false;

  let step = 0;
  const totalSteps = order.logs.length;

  const interval = setInterval(() => {
    if (step < totalSteps) {
      const logLine = document.createElement('div');
      logLine.innerText = `> ${order.logs[step]}`;
      consoleBox.appendChild(logLine);
      consoleBox.scrollTop = consoleBox.scrollHeight;

      document.getElementById('m-watts').innerText = (320 + Math.floor(Math.random() * 80)) + ' W';
      document.getElementById('m-temp').innerText = (65 + Math.floor(Math.random() * 18)) + '°C';

      step++;
      progressBar.style.width = Math.floor((step / totalSteps) * 100) + '%';
    } else {
      clearInterval(interval);
      const doneLine = document.createElement('div');
      doneLine.style.color = 'var(--color-success)';
      doneLine.innerText = `[SUCCESS] Контракт успешно завершён без сбоев.`;
      consoleBox.appendChild(doneLine);
      finishBtn.style.display = 'block';
      const unit = order.reward.rub > 0 ? '₽' : 'SAT';
      finishBtn.innerText = `💸 Забрать оплату (+${(order.reward.rub || order.reward.sat).toLocaleString('ru-RU')} ${unit})`;
    }
  }, 700);
}

// Сдача контракта: приложение НЕ закрывается. Награда начисляется локально и
// сразу же, а авторитетную запись бот делает по команде /start ord_{слот}_...
function finishAndSend() {
  if (!currentOrder || currentSlot < 0) return;

  player.rub += currentOrder.reward.rub;
  player.sat += currentOrder.reward.sat;

  const command = `/start ord_${currentSlot + 1}_${currentOrder.id}_${currentOrder.reward.rub}_${currentOrder.reward.sat}`;
  queueCommand('order', { slot: currentSlot + 1, command });
  occupySlot(currentSlot);

  tg?.HapticFeedback?.notificationOccurred('success');

  // Возврат к списку — внутри приложения. Ни редиректа, ни закрытия окна.
  document.getElementById('execution-modal').style.display = 'none';
  currentOrder = null;
  currentSlot = -1;

  updateUI();
  renderShop();
  renderOrders();
}

// 9. Запуск
applyStartParam(startParam);
applyQuerySlots();
loadLocal();
contracts = buildContracts();
updateUI();
renderOrders();
renderShop();

// Тик кулдаунов: раз в секунду обновляем полоску слотов, а список перерисовываем
// только когда какой-то слот реально освободился.
let lastFreeStates = contracts.map((_, i) => slotReady(i)).join(',');
setInterval(() => {
  renderSlots();
  const freeStates = contracts.map((_, i) => slotReady(i)).join(',');
  if (freeStates !== lastFreeStates) {
    lastFreeStates = freeStates;
    renderOrders();
  }
}, 1000);