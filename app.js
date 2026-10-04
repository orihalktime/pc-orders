/* ==========================================================================
   ЛОГИКА TELEGRAM WEB APP (EXPLORER STATION)
   Универсальная отправка команд через Deep Link (работает и в ЛС, и в группах)
   ========================================================================== */

const tg = window.Telegram?.WebApp;
const BOT_USERNAME = "npe90_test_bot";

if (tg) {
  tg.ready();
  tg.expand();
}

// 1. Универсальное считывание параметров игрока
const urlParams = new URLSearchParams(window.location.search);
const startParam = tg?.initDataUnsafe?.start_param || "";

let player = {
  uid: urlParams.get('uid') || '0',
  rub: parseInt(urlParams.get('rub')) || 0,
  sat: parseInt(urlParams.get('sat')) || 0,
  lvl: parseInt(urlParams.get('tier')) || 1,
  cases: parseInt(urlParams.get('case')) || 1,
  mobo: parseInt(urlParams.get('mobo')) || 1,
  cpu: parseInt(urlParams.get('cpu')) || 1,
  cooler: parseInt(urlParams.get('cooler')) || 1,
  ram: parseInt(urlParams.get('ram')) || 1,
  ssd: parseInt(urlParams.get('storage')) || 1,
  gpu: parseInt(urlParams.get('gpu')) || 1,
  psu: parseInt(urlParams.get('psu')) || 1,
  moboStab: parseInt(urlParams.get('moboStab')) || 50
};

// Если открыто из группы через t.me/bot/orders?startapp=...
if (startParam && startParam.includes('_')) {
  const parts = startParam.split('_').map(x => parseInt(x) || 0);
  if (parts.length >= 12) {
    player.rub = parts[0];
    player.sat = parts[1];
    player.lvl = parts[2];
    player.cases = parts[3];
    player.mobo = parts[4];
    player.cpu = parts[5];
    player.cooler = parts[6];
    player.ram = parts[7];
    player.ssd = parts[8];
    player.gpu = parts[9];
    player.psu = parts[10];
    player.moboStab = parts[11];
  }
}

// 2. Инициализация индикаторов
document.getElementById('h-rub').innerText = player.rub.toLocaleString();
document.getElementById('val-cpu').innerText = 'T' + player.cpu;
document.getElementById('val-gpu').innerText = 'T' + player.gpu;
document.getElementById('val-ram').innerText = 'T' + player.ram;
document.getElementById('val-ssd').innerText = 'T' + player.ssd;

// 3. Переключение вкладок
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b, idx) => {
    b.classList.toggle('active', (name === 'orders' && idx === 0) || (name === 'shop' && idx === 1));
  });
  document.getElementById('tab-orders').classList.toggle('active', name === 'orders');
  document.getElementById('tab-shop').classList.toggle('active', name === 'shop');
}

// 4. Каталог магазина (8 категорий)
const shopCatalog = [
  { key: "gpu", icon: "🎮", name: "Видеокарта", curTier: player.gpu },
  { key: "cpu", icon: "🧠", name: "Процессор", curTier: player.cpu },
  { key: "mobo", icon: "🔌", name: "Материнская плата", curTier: player.mobo },
  { key: "cooler", icon: "❄️", name: "Охлаждение", curTier: player.cooler },
  { key: "ram", icon: "🧮", name: "Оперативная память", curTier: player.ram },
  { key: "storage", icon: "💾", name: "Накопитель (SSD/HDD)", curTier: player.ssd },
  { key: "psu", icon: "🔋", name: "Блок питания", curTier: player.psu },
  { key: "case", icon: "📦", name: "Корпус станции", curTier: player.cases }
];

function renderShop() {
  const container = document.getElementById('shop-container');
  container.innerHTML = '';

  shopCatalog.forEach(item => {
    const nextTier = item.curTier + 1;
    const price = Math.round(100 * Math.pow(1.5, Math.min(nextTier, 100)));
    const canBuy = player.rub >= price && nextTier <= 100;

    const card = document.createElement('div');
    card.className = 'shop-card';
    card.innerHTML = `
      <div class="card-header">
        <span class="badge">${item.icon} ${item.name}</span>
        <span class="payout">${nextTier <= 100 ? price.toLocaleString() + ' ₽' : 'MAX'}</span>
      </div>
      <div class="card-title">Текущий: Тир ${item.curTier} / 100</div>
      <div class="card-sub">${nextTier <= 100 ? `Апгрейд до Тира ${nextTier}` : 'Топовая деталь установлена'}</div>
      <button class="action-btn buy-btn" ${canBuy ? '' : 'disabled'} onclick="sendBuy('${item.key}')">
        ${nextTier > 100 ? 'Пройдено полностью' : canBuy ? `Купить тир ${nextTier}` : 'Не хватает рублей'}
      </button>
    `;
    container.appendChild(card);
  });
}

// Покупка детали через Deep Link
function sendBuy(category) {
  const deepLink = `https://t.me/${BOT_USERNAME}?start=buy_${category}`;
  if (tg && tg.openTelegramLink) {
    tg.openTelegramLink(deepLink);
    tg.close();
  } else {
    window.location.href = deepLink;
  }
}

// 5. Динамические контракты биржи
const contractsPool = [
  {
    id: "vfx",
    cat: "3D Рендер",
    title: "Рендер взрыва реактора (4K, Blender)",
    client: "Студия «Cinematic FX»",
    desc: "Срочно дорендерить 120 кадров эффектов взрыва к финальному монтажу. Сцена забита частицами и дымом.",
    req: { gpu: Math.max(1, player.lvl), ram: Math.max(1, Math.floor(player.lvl * 0.7)) },
    reward: { rub: player.lvl * 650 + 400, sat: 0 },
    logs: [
      "Инициализация сцены Blender Cycles...",
      "Загрузка текстур VRAM 8K OpenEXR...",
      "Расчёт трассировки лучей (bounces: 12)...",
      "Рендеринг тайлов 256x256...",
      "Шумоподавление OptiX AI Denoiser...",
      "Финальная сборка кадров в видеопоток..."
    ]
  },
  {
    id: "lora",
    cat: "Нейросети",
    title: "Дообучение LoRA модели на 50 000 строк",
    client: "Стартап «NeuralMind»",
    desc: "Требуется тонкая настройка весов модели на датасете юридических документов. Высокие требования к памяти и чтению диска.",
    req: { gpu: Math.max(1, Math.floor(player.lvl * 0.8)), ssd: Math.max(2, Math.floor(player.lvl * 0.75)) },
    reward: { rub: 0, sat: Math.max(50, Math.floor(player.lvl * 120)) },
    logs: [
      "Чтение датасета с SSD накопителя (IOPS проверка)...",
      "Токенизация текстового корпуса...",
      "Эпоха 1/3: Loss = 2.451...",
      "Эпоха 2/3: Loss = 1.120...",
      "Эпоха 3/3: Loss = 0.412...",
      "Квантование адаптеров LoRA (FP16)..."
    ]
  },
  {
    id: "rtos",
    cat: "DevOps",
    title: "Сборка Real-Time ядра Linux с ЧПУ-модулями",
    client: "АО «ПромАвтоматика»",
    desc: "Компиляция кастомного RT-Kernel из исходников. Нужна абсолютная стабильность материнской платы, иначе Kernel Panic.",
    req: { cpu: Math.max(1, player.lvl), mobo: 45 },
    reward: { rub: player.lvl * 800 + 500, sat: Math.floor(player.lvl * 30) },
    logs: [
      "Конфигурация Makefile (.config RT_PREEMPT)...",
      "Компиляция модулей архитектуры (make -j)...",
      "Сборка драйверов шины CAN и SPI...",
      "Линковка бинарного образа vmlinuz...",
      "Генерация initramfs...",
      "Тест стабильности шины питания платы: OK!"
    ]
  }
];

let currentOrder = null;

function renderOrders() {
  const container = document.getElementById('orders-container');
  container.innerHTML = '';

  contractsPool.forEach(c => {
    let canTake = true;
    let reqsHtml = '';

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
    if (c.reward.rub > 0) payText += `${c.reward.rub.toLocaleString()} ₽ `;
    if (c.reward.sat > 0) payText += `${c.reward.sat.toLocaleString()} SAT`;

    const card = document.createElement('div');
    card.className = `order-card ${canTake ? '' : 'locked'}`;
    card.innerHTML = `
      <div class="card-header">
        <span class="badge">${c.cat}</span>
        <span class="payout">${payText}</span>
      </div>
      <div class="card-title">${c.title}</div>
      <div class="card-sub">Заказчик: ${c.client}</div>
      <div class="card-desc">${c.desc}</div>
      <div class="req-list">${reqsHtml}</div>
      <button class="action-btn" ${canTake ? '' : 'disabled'} onclick='startExecution(${JSON.stringify(c)})'>
        ${canTake ? 'Взять контракт в работу' : 'Железо не подходит'}
      </button>
    `;
    container.appendChild(card);
  });
}

function startExecution(order) {
  currentOrder = order;
  document.getElementById('execution-modal').style.display = 'flex';
  document.getElementById('m-title').innerText = order.title;

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
    }
  }, 700);
}

// Сдача контракта через Deep Link
function finishAndSend() {
  if (!currentOrder) return;
  
  // Формат deep-link команды: ord_ID_RUB_SAT
  const deepLink = `https://t.me/${BOT_USERNAME}?start=ord_${currentOrder.id}_${currentOrder.reward.rub}_${currentOrder.reward.sat}`;
  
  if (tg && tg.openTelegramLink) {
    tg.openTelegramLink(deepLink);
    tg.close();
  } else {
    window.location.href = deepLink;
  }
}

// Запуск
renderOrders();
renderShop();