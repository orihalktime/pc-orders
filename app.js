/* ==========================================================================
   ЛОГИКА TELEGRAM WEB APP (EXPLORER STATION) v2.0
   Фиксы: Честный кулдаун 45м, отображение SAT, интерактивный риск перегрева
   ========================================================================== */

const tg = window.Telegram?.WebApp;
if (tg) {
  tg.ready();
  tg.expand();
}

// 1. Инициализация игрока
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

if (startParam && startParam.includes('_')) {
  const parts = startParam.split('_').map(x => parseInt(x) || 0);
  if (parts.length >= 12) {
    player.rub = parts[0]; player.sat = parts[1]; player.lvl = parts[2];
    player.cases = parts[3]; player.mobo = parts[4]; player.cpu = parts[5];
    player.cooler = parts[6]; player.ram = parts[7]; player.ssd = parts[8];
    player.gpu = parts[9]; player.psu = parts[10]; player.moboStab = parts[11];
  }
}

// 2. Обновление интерфейса (Рубли + Сатоши)
function updateUI() {
  document.getElementById('h-rub').innerHTML = `${player.rub.toLocaleString()} ₽ &nbsp;·&nbsp; <span style="color:#e3b341">🪙 ${player.sat.toLocaleString()} SAT</span>`;
  document.getElementById('val-cpu').innerText = 'T' + player.cpu;
  document.getElementById('val-gpu').innerText = 'T' + player.gpu;
  document.getElementById('val-ram').innerText = 'T' + player.ram;
  document.getElementById('val-ssd').innerText = 'T' + player.ssd;
}
updateUI();

// 3. Табы
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach((b, idx) => {
    b.classList.toggle('active', (name === 'orders' && idx === 0) || (name === 'shop' && idx === 1));
  });
  document.getElementById('tab-orders').classList.toggle('active', name === 'orders');
  document.getElementById('tab-shop').classList.toggle('active', name === 'shop');
}

// 4. Логика Кулдауна (45 минут)
const COOLDOWN_MS = 45 * 60 * 1000;

function getCooldownLeft() {
  const lastTime = parseInt(localStorage.getItem('last_order_time_' + player.uid)) || 0;
  const diff = Date.now() - lastTime;
  return diff < COOLDOWN_MS ? COOLDOWN_MS - diff : 0;
}

function formatTime(ms) {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// 5. Магазин
function getCatalog() {
  return [
    { key: "gpu", icon: "🎮", name: "Видеокарта", curTier: player.gpu },
    { key: "cpu", icon: "🧠", name: "Процессор", curTier: player.cpu },
    { key: "mobo", icon: "🔌", name: "Материнская плата", curTier: player.mobo },
    { key: "cooler", icon: "❄️", name: "Охлаждение", curTier: player.cooler },
    { key: "ram", icon: "🧮", name: "Оперативная память", curTier: player.ram },
    { key: "storage", icon: "💾", name: "Накопитель (SSD/HDD)", curTier: player.ssd },
    { key: "psu", icon: "🔋", name: "Блок питания", curTier: player.psu },
    { key: "case", icon: "📦", name: "Корпус станции", curTier: player.cases }
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
        <span class="payout">${nextTier <= 100 ? price.toLocaleString() + ' ₽' : 'MAX'}</span>
      </div>
      <div class="card-title">Текущий: Тир ${item.curTier} / 100</div>
      <div class="card-sub">${nextTier <= 100 ? `Апгрейд до Тира ${nextTier}` : 'Топовая деталь'}</div>
      <button class="action-btn buy-btn" ${canBuy ? '' : 'disabled'} onclick="buyPartLive('${item.key}', ${price})">
        ${nextTier > 100 ? 'Пройдено' : canBuy ? `Купить тир ${nextTier}` : 'Не хватает рублей'}
      </button>
    `;
    container.appendChild(card);
  });
}

function buyPartLive(category, price) {
  if (player.rub < price) return;
  player.rub -= price;

  if (category === 'gpu') player.gpu++;
  else if (category === 'cpu') player.cpu++;
  else if (category === 'mobo') player.mobo++;
  else if (category === 'cooler') player.cooler++;
  else if (category === 'ram') player.ram++;
  else if (category === 'storage') player.ssd++;
  else if (category === 'psu') player.psu++;
  else if (category === 'case') player.cases++;

  player.lvl = Math.max(1, Math.floor((player.cpu + player.gpu + player.ram + player.ssd) / 4));

  updateUI();
  renderShop();
  renderOrders();
  if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
}

// 6. База заказов
const contractsPool = [
  {
    id: "vfx",
    cat: "3D Рендер",
    title: "Рендер сцены фильма (4K Cycles)",
    client: "Студия «Cinematic FX»",
    desc: "120 тяжёлых кадров симуляции дыма и огня. Опасность сильного нагрева GPU!",
    req: { gpu: Math.max(1, player.lvl), ram: Math.max(1, Math.floor(player.lvl * 0.7)) },
    reward: { rub: player.lvl * 650 + 400, sat: 0 },
    logs: [
      "Загрузка текстур VRAM 8K OpenEXR...",
      "Инициализация BVH-дерева геометрии...",
      "Рендеринг тайлов 256x256 (bounces: 12)...",
      "Денойзинг OptiX AI Denoiser...",
      "Финальный композитинг кадров..."
    ]
  },
  {
    id: "lora",
    cat: "Нейросети",
    title: "Обучение LoRA модели на датасете",
    client: "Лаборатория «NeuralMind»",
    desc: "Тонкая калибровка матрицы весов. Высокая нагрузка на SSD и подсистему памяти.",
    req: { gpu: Math.max(1, Math.floor(player.lvl * 0.8)), ssd: Math.max(2, Math.floor(player.lvl * 0.75)) },
    reward: { rub: 0, sat: Math.max(50, Math.floor(player.lvl * 120)) },
    logs: [
      "Чтение датасета с SSD накопителя (IOPS тест)...",
      "Прямой проход: Эпоха 1/3 (Loss = 2.14)...",
      "Обратное распространение градиента...",
      "Эпоха 3/3 (Loss = 0.38)...",
      "Экспорт чекпоинта адаптера LoRA..."
    ]
  },
  {
    id: "rtos",
    cat: "DevOps",
    title: "Компиляция Real-Time ядра Linux",
    client: "АО «ПромАвтоматика»",
    desc: "Сборка ядра RT_PREEMPT для станков. При низкой стабильности платы возможен Kernel Panic!",
    req: { cpu: Math.max(1, player.lvl), mobo: 45 },
    reward: { rub: player.lvl * 800 + 500, sat: Math.floor(player.lvl * 30) },
    logs: [
      "Парсинг Kconfig и .config опций...",
      "Компиляция модулей архитектуры (make -j)...",
      "Линковка бинарного образа vmlinuz...",
      "Сборка initramfs и драйверов CAN...",
      "Тест тактовой частоты шины: OK!"
    ]
  }
];

let currentOrder = null;
let execInterval = null;
let qteTimeout = null;

function renderOrders() {
  const container = document.getElementById('orders-container');
  container.innerHTML = '';

  const cdLeft = getCooldownLeft();
  if (cdLeft > 0) {
    const banner = document.createElement('div');
    banner.style.cssText = "background:var(--surface-1); border:1px solid var(--border-active); border-radius:12px; padding:16px; text-align:center; margin-bottom:12px;";
    banner.innerHTML = `
      <div style="font-size:12px; color:var(--text-muted); margin-bottom:4px;">БИРЖА НА ПЕРЕРЫВЕ</div>
      <div style="font-size:22px; font-weight:bold; font-family:var(--font-mono); color:var(--color-warning);">⏳ ${formatTime(cdLeft)}</div>
      <div style="font-size:11px; color:var(--text-secondary); margin-top:4px;">Ожидание обновления пула заказов</div>
    `;
    container.appendChild(banner);
  }

  contractsPool.forEach(c => {
    let canTake = cdLeft === 0;
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
      <div class="card-sub">${c.client}</div>
      <div class="card-desc">${c.desc}</div>
      <div class="req-list">${reqsHtml}</div>
      <button class="action-btn" ${canTake ? '' : 'disabled'} onclick='startExecution(${JSON.stringify(c)})'>
        ${cdLeft > 0 ? 'Кулдаун' : canTake ? 'Взять контракт в работу' : 'Железо не подходит'}
      </button>
    `;
    container.appendChild(card);
  });
}

// 7. Интерактивное выполнение заказа (с риском перегрева и QTE)
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
  let curTemp = 60 + Math.floor(Math.random() * 10);
  let failed = false;

  execInterval = setInterval(() => {
    if (step < totalSteps && !failed) {
      const logLine = document.createElement('div');
      logLine.innerText = `> ${order.logs[step]}`;
      consoleBox.appendChild(logLine);
      consoleBox.scrollTop = consoleBox.scrollHeight;

      // Растёт температура и нагрузка
      curTemp += Math.floor(Math.random() * 6) + 2;
      document.getElementById('m-watts').innerText = (340 + Math.floor(Math.random() * 90)) + ' W';
      document.getElementById('m-temp').innerText = `${curTemp}°C`;

      // ⚠️ ИНТЕРАКТИВНОЕ СОБЫТИЕ: Перегрев (QTE) на 3-м шаге
      if (step === 2 && curTemp > 78) {
        clearInterval(execInterval);
        triggerQteEvent();
        return;
      }

      step++;
      progressBar.style.width = Math.floor((step / totalSteps) * 100) + '%';
    } else if (!failed) {
      clearInterval(execInterval);
      const doneLine = document.createElement('div');
      doneLine.style.color = 'var(--color-success)';
      doneLine.innerText = `[SUCCESS] Контракт успешно завершён без сбоев!`;
      consoleBox.appendChild(doneLine);
      finishBtn.style.display = 'block';
      finishBtn.innerText = `💸 Забрать оплату (+${order.reward.rub || order.reward.sat} ${order.reward.rub ? '₽' : 'SAT'})`;
    }
  }, 800);
}

// Интерактивное событие: спасение рига от перегрева
function triggerQteEvent() {
  const consoleBox = document.getElementById('m-console');
  const warn = document.createElement('div');
  warn.style.cssText = "color:var(--color-danger); font-weight:bold; background:rgba(248,81,73,0.15); padding:6px; border-radius:6px;";
  warn.id = "qte-box";
  warn.innerHTML = `
    ⚠️ ОПАСНОСТЬ: Троттлинг хот-спота (92°C)!<br>
    <button onclick="resolveQte()" style="margin-top:6px; padding:6px 12px; background:var(--color-danger); color:#fff; border:none; border-radius:6px; font-weight:bold; font-size:12px; cursor:pointer;">
      ❄️ Врубить кулеры на 100% (3 сек)!
    </button>
  `;
  consoleBox.appendChild(warn);
  consoleBox.scrollTop = consoleBox.scrollHeight;
  if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('warning');

  // Таймер на реакцию 3.5 секунды
  qteTimeout = setTimeout(() => {
    failContract("💥 ПЕРЕГРЕВ: Риг ушёл в защиту (Thermal Shutdown). Заказ сорван!");
  }, 3500);
}

window.resolveQte = function() {
  clearTimeout(qteTimeout);
  const qteBox = document.getElementById('qte-box');
  if (qteBox) qteBox.remove();

  const consoleBox = document.getElementById('m-console');
  const ok = document.createElement('div');
  ok.style.color = "var(--color-primary)";
  ok.innerText = "❄️ Охлаждение на максимуме! Температура сбита до 68°C. Продолжаем...";
  consoleBox.appendChild(ok);

  document.getElementById('m-temp').innerText = "68°C";
  if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');

  // Возобновляем рендер
  let step = 3;
  const totalSteps = currentOrder.logs.length;
  execInterval = setInterval(() => {
    if (step < totalSteps) {
      const line = document.createElement('div');
      line.innerText = `> ${currentOrder.logs[step]}`;
      consoleBox.appendChild(line);
      consoleBox.scrollTop = consoleBox.scrollHeight;
      step++;
      document.getElementById('m-progress').style.width = Math.floor((step / totalSteps) * 100) + '%';
    } else {
      clearInterval(execInterval);
      const doneLine = document.createElement('div');
      doneLine.style.color = 'var(--color-success)';
      doneLine.innerText = `[SUCCESS] Контракт успешно завершён без сбоев!`;
      consoleBox.appendChild(doneLine);
      const finishBtn = document.getElementById('m-finish-btn');
      finishBtn.style.display = 'block';
      finishBtn.innerText = `💸 Забрать оплату (+${currentOrder.reward.rub || currentOrder.reward.sat} ${currentOrder.reward.rub ? '₽' : 'SAT'})`;
    }
  }, 800);
};

function failContract(reason) {
  clearInterval(execInterval);
  const consoleBox = document.getElementById('m-console');
  const qteBox = document.getElementById('qte-box');
  if (qteBox) qteBox.remove();

  const failLine = document.createElement('div');
  failLine.style.cssText = "color:var(--color-danger); font-weight:bold; margin-top:8px;";
  failLine.innerText = reason;
  consoleBox.appendChild(failLine);

  localStorage.setItem('last_order_time_' + player.uid, Date.now()); // Кулдаун сгорает
  if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('error');

  setTimeout(() => {
    document.getElementById('execution-modal').style.display = 'none';
    currentOrder = null;
    renderOrders();
  }, 2500);
}

// 8. Сдача работы
function finishAndSend() {
  if (!currentOrder) return;

  player.rub += currentOrder.reward.rub;
  player.sat += currentOrder.reward.sat;

  // Записываем время сдачи контракта (старт 45 мин КД)
  localStorage.setItem('last_order_time_' + player.uid, Date.now());

  updateUI();
  renderShop();
  renderOrders();

  if (tg?.HapticFeedback) tg.HapticFeedback.notificationOccurred('success');
  document.getElementById('execution-modal').style.display = 'none';
  currentOrder = null;
}

// Таймер обновления кулдауна на экране каждую секунду
setInterval(() => {
  if (getCooldownLeft() > 0 && !currentOrder) {
    renderOrders();
  }
}, 1000);

renderOrders();
renderShop();
