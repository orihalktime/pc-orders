/* ==========================================================================
   TELEGRAM WEB APP — EXPLORER STATION
   Награды и цены приходят С СЕРВЕРА: бот подставляет точные суммы слотов (o1r/o1s…)
   и тиры в адрес приложения. Клиент ничего не придумывает и не решает — он только
   показывает цифры, а кнопки отправляют бота deep-link'ом по номеру слота.
   Окно закрывает сам пользователь крестиком ✕ либо бот после открытия чата.
   ========================================================================== */

const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
  if (typeof tg.disableVerticalSwipes === 'function') tg.disableVerticalSwipes();
}

// Юзернейм бота для deep-link'ов. Бот подставляет его в адрес (?bot=…),
// значение ниже — запасной вариант на случай открытия ссылки без параметра.
const DEFAULT_BOT_USERNAME = 'npe90_test_bot';

const SLOT_COUNT = 3;
const SLOT_NAMES = ['🎬 Рендер', '🧠 Нейросеть', '⚙️ Ядро ОС'];
const LS_KEY = 'pc-orders:state';
const CS_KEY = 'pc_orders_v2'; // ключ в CloudStorage Telegram (лимит значения — 1 КБ)

// Лестница цен из HardwareCatalog.cs (NextTierPrices): индекс i — цена перехода
// с тира i+1 на тир i+2. Все 8 категорий используют её общую, поэтому витрина
// Web App показывает ровно ту же сумму, что списывает бот в BuyNext.
const TIER_PRICES = [
  100, 160, 250, 380, 600, 930, 1450, 2250, 3500, 4000, 4650, 5350, 6200, 7150, 8250,
  9500, 11000, 13000, 15000, 17000, 19500, 22500, 26000, 30000, 35000, 38500, 42500,
  46500, 51000, 55500, 61000, 67000, 73000, 80000, 88000, 96500, 110000, 120000, 130000,
  140000, 155000, 170000, 185000, 200000, 225000, 245000, 270000, 300000, 330000, 365000,
  405000, 450000, 495000, 550000, 605000, 670000, 740000, 820000, 910000, 1050000, 1150000,
  1250000, 1400000, 1500000, 1800000, 2100000, 2450000, 2850000, 3300000, 3850000, 4500000,
  5200000, 6050000, 7050000, 8200000, 9550000, 11500000, 13000000, 15000000, 20000000,
  25000000, 30500000, 37500000, 46500000, 57000000, 70500000, 87000000, 110000000,
  135000000, 165000000, 200000000, 250000000, 415000000, 680000000, 1150000000, 1850000000,
  3050000000, 5000000000, 10000000000
];

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

let botUsername = urlParams.get('bot') || DEFAULT_BOT_USERNAME;

// Точные награды слотов с серверной доски: [{rub, sat}, …]. null — сервер их не прислал
// (старый чат без параметра), тогда показываем оценочную формулу.
let serverRewards = null;

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

  // Хвост разбирается по числу полей: 16 → минуты кулдаунов, 19 → награды слотов.
  const t = nowSec();
  if (p.length === 16) {
    for (let i = 0; i < SLOT_COUNT; i++) cdUntil[i] = t + num(p[13 + i]) * 60;
  } else if (p.length >= 19) {
    serverRewards = [];
    for (let i = 0; i < SLOT_COUNT; i++) {
      serverRewards.push({ rub: num(p[13 + i * 2]), sat: num(p[14 + i * 2]) });
    }
  }
}

// Полный URL (кнопка web_app в личке): маска слотов, кулдауны в секундах, награды слотов.
function applyQueryState() {
  if (urlParams.has('slots')) {
    slotsMask = num(urlParams.get('slots'), 7) & 7;
    maskFromServer = true;
  }

  const t = nowSec();
  for (let i = 0; i < SLOT_COUNT; i++) {
    const sec = num(urlParams.get('cd' + i));
    if (sec > 0) cdUntil[i] = t + sec;
  }

  if (urlParams.has('o1r')) {
    serverRewards = [];
    for (let i = 1; i <= SLOT_COUNT; i++) {
      serverRewards.push({ rub: num(urlParams.get('o' + i + 'r')), sat: num(urlParams.get('o' + i + 's')) });
    }
  }
}

// 2. Локальный снимок (localStorage + CloudStorage Telegram).
// Источник истины — бот: баланс, тиры и награды всегда приезжают в адресе.
// Локально хранится только то, чего сервер не передаёт, — остатки кулдаунов слотов.
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
  renderSlots();
}

function persist() {
  const snapshot = { uid: player.uid, slotsMask, cdUntil, savedAt: nowSec() };
  let json = '';
  try {
    json = JSON.stringify(snapshot);
    localStorage.setItem(LS_KEY, json);
  } catch { /* приватный режим — просто живём без локального кэша */ }
  // CloudStorage — фоновый пинг синхронизации: клиент сам откладывает снимок в облаке
  // Telegram, чтобы кулдауны пережили перезапуск приложения. Значение короче 1 КБ.
  if (tg?.CloudStorage && json.length <= 1024) {
    try { tg.CloudStorage.setItem(CS_KEY, json, () => {}); } catch { /* квота исчерпана */ }
  }
}

// 3. Слоты: три параллельных рабочих места с независимым кулдауном
const slotLeft = (i) => Math.max(0, cdUntil[i] - nowSec());
const slotReady = (i) => slotLeft(i) <= 0 && ((slotsMask >> i) & 1) === 1;

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
    pill.innerHTML = `<span class="slot-name">${SLOT_NAMES[i]}</span>` +
      `<span class="slot-state">${ready ? 'слот свободен' : `⏳ ${fmtLeft(left)}`}</span>`;
    bar.appendChild(pill);
  }
}

// 5. Переключение вкладок
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b, idx) => {
    b.classList.toggle('active', (name === 'orders' && idx === 0) || (name === 'shop' && idx === 1));
  });
  document.getElementById('tab-orders').classList.toggle('active', name === 'orders');
  document.getElementById('tab-shop').classList.toggle('active', name === 'shop');
}

// Открыть бота с командой и закрыть приложение: деньги, тир и кулдаун считает сервер,
// локальные цифры после этого всё равно устаревают.
function sendToBot(command) {
  const deepLink = `https://t.me/${botUsername}?start=${command}`;
  if (tg && tg.openTelegramLink) {
    tg.openTelegramLink(deepLink);
    tg.close();
  } else {
    window.location.href = deepLink;
  }
}

// 6. Каталог магазина: цена берётся из общей лестницы TIER_PRICES — ровно то, что списывает BuyNext.
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

function nextPrice(category) {
  const tier = tierOf(category);
  return tier >= TIER_PRICES.length ? -1 : TIER_PRICES[tier - 1];
}

function renderShop() {
  const container = document.getElementById('shop-container');
  container.innerHTML = '';

  getCatalog().forEach(item => {
    const nextTier = item.curTier + 1;
    const price = nextPrice(item.key);
    const maxed = price < 0;
    const canBuy = !maxed && player.rub >= price;

    const card = document.createElement('div');
    card.className = 'shop-card';
    card.innerHTML = `
      <div class="card-header">
        <span class="badge">${item.icon} ${item.name}</span>
        <span class="payout">${maxed ? 'MAX' : price.toLocaleString('ru-RU') + ' ₽'}</span>
      </div>
      <div class="card-title">Текущий: Тир ${item.curTier} / ${TIER_PRICES.length + 1}</div>
      <div class="card-sub">${maxed ? 'Топовая деталь установлена' : `Апгрейд до Тира ${nextTier}`}</div>
      <button class="action-btn buy-btn" ${canBuy ? '' : 'disabled'} onclick="buyPart('${item.key}')">
        ${maxed ? 'Пройдено полностью' : canBuy ? `Купить тир ${nextTier}` : 'Не хватает рублей'}
      </button>
    `;
    container.appendChild(card);
  });
}

function tierOf(category) {
  return ({
    gpu: player.gpu, cpu: player.cpu, mobo: player.mobo, cooler: player.cooler,
    ram: player.ram, storage: player.ssd, psu: player.psu, case: player.cases
  })[category] || 1;
}

// Покупка детали: только команда боту, тир и баланс меняет сервер (GameEngine.BuyNext).
function buyPart(category) {
  sendToBot(`buy_${category}`);
}

// 7. Контракты биржи. Номер в массиве + 1 === слот доски, поэтому заведённый контракт
// занимает ровно один слот и не блокирует два остальных.
const contractTemplates = [
  {
    id: 'vfx',
    cat: '3D Рендер',
    title: 'Рендер взрыва реактора (4K, Blender)',
    client: 'Студия «Cinematic FX»',
    desc: 'Срочно дорендерить 120 кадров эффектов взрыва к финальному монтажу. Сцена забита частицами и дымом.',
    req: () => ({ gpu: Math.max(1, player.lvl), ram: Math.max(1, Math.floor(player.lvl * 0.7)) }),
    fallback: () => ({ rub: player.lvl * 650 + 400, sat: 0 }),
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
    req: () => ({ gpu: Math.max(1, Math.floor(player.lvl * 0.8)), ssd: Math.max(2, Math.floor(player.lvl * 0.75)) }),
    fallback: () => ({ rub: 0, sat: Math.max(50, Math.floor(player.lvl * 120)) }),
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
    req: () => ({ cpu: Math.max(1, player.lvl), mobo: 45 }),
    fallback: () => ({ rub: player.lvl * 800 + 500, sat: Math.floor(player.lvl * 30) }),
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

let currentOrder = null;
let currentSlot = -1;

// Награда слота: сперва точная серверная, иначе оценочная формула (витрина без бэкенда).
function rewardOf(i) {
  if (serverRewards && serverRewards[i]) {
    const r = serverRewards[i];
    return (r.rub > 0 || r.sat > 0) ? { rub: r.rub, sat: r.sat } : contractTemplates[i].fallback();
  }
  return contractTemplates[i].fallback();
}

function renderOrders() {
  const container = document.getElementById('orders-container');
  container.innerHTML = '';

  contractTemplates.forEach((c, i) => {
    let canTake = true;
    let reqsHtml = '';
    const left = slotLeft(i);
    const free = slotReady(i);
    const req = c.req();

    if (req.gpu) {
      const ok = player.gpu >= req.gpu; if (!ok) canTake = false;
      reqsHtml += `<div class="req-item ${ok ? 'ok' : 'fail'}">GPU: T${req.gpu} ${ok ? '✓' : '✗'}</div>`;
    }
    if (req.cpu) {
      const ok = player.cpu >= req.cpu; if (!ok) canTake = false;
      reqsHtml += `<div class="req-item ${ok ? 'ok' : 'fail'}">CPU: T${req.cpu} ${ok ? '✓' : '✗'}</div>`;
    }
    if (req.ram) {
      const ok = player.ram >= req.ram; if (!ok) canTake = false;
      reqsHtml += `<div class="req-item ${ok ? 'ok' : 'fail'}">RAM: T${req.ram} ${ok ? '✓' : '✗'}</div>`;
    }
    if (req.ssd) {
      const ok = player.ssd >= req.ssd; if (!ok) canTake = false;
      reqsHtml += `<div class="req-item ${ok ? 'ok' : 'fail'}">SSD: T${req.ssd} ${ok ? '✓' : '✗'}</div>`;
    }
    if (req.mobo) {
      const ok = player.moboStab >= req.mobo; if (!ok) canTake = false;
      reqsHtml += `<div class="req-item ${ok ? 'ok' : 'fail'}">Плата: ${req.mobo}% ${ok ? '✓' : '✗'}</div>`;
    }

    const reward = rewardOf(i);
    let payText = '';
    if (reward.rub > 0) payText += `${reward.rub.toLocaleString('ru-RU')} ₽ `;
    if (reward.sat > 0) payText += `${reward.sat.toLocaleString('ru-RU')} SAT`;
    if (!payText) payText = 'оплата уточняется';

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
  const order = contractTemplates[index];
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
      const reward = rewardOf(index);
      const unit = reward.rub > 0 ? '₽' : 'SAT';
      const amount = reward.rub > 0 ? reward.rub : reward.sat;
      finishBtn.innerText = `💸 Сдать контракт и забрать ${amount.toLocaleString('ru-RU')} ${unit}`;
    }
  }, 700);
}

// Сдача контракта: боту уходит ТОЛЬКО номер слота (ord_1 / ord_2 / ord_3), выплату
// начисляет сервер по доске. Локально слот гасим сразу, чтобы приложение не показало
// контракт повторно до перезапуска.
function finishAndSend() {
  if (currentSlot < 0) return;

  tg?.HapticFeedback?.notificationOccurred('success');
  occupySlot(currentSlot);

  const slotNumber = currentSlot + 1;
  currentOrder = null;
  currentSlot = -1;

  renderOrders();
  sendToBot(`ord_${slotNumber}`);
}

// 8. Запуск
applyStartParam(startParam);
applyQueryState();
loadLocal();
updateUI();
renderOrders();
renderShop();

// Тик кулдаунов: раз в секунду обновляем полоску слотов, а список перерисовываем
// только когда какой-то слот реально освободился.
let lastFreeStates = contractTemplates.map((_, i) => slotReady(i)).join(',');
setInterval(() => {
  renderSlots();
  const freeStates = contractTemplates.map((_, i) => slotReady(i)).join(',');
  if (freeStates !== lastFreeStates) {
    lastFreeStates = freeStates;
    renderOrders();
  }
}, 1000);