/* ============================================================================
   Интерактивный конфигуратор автомобиля — логика интерфейса.
   Один IIFE, без модулей и внешних зависимостей (работает по file://).
   Подключается с defer. Синтаксис ES5: var + function expression.

   Порядок секций:
     ZONES → METRICS → PARTS → PENALTIES → state → format → computeStats →
     buildUI → paint/render → delta/ghost → accordion → bindEvents → init.
   ========================================================================== */

(function () {

  /* --------------------------------------------------------------------------
     ZONES — 5 интерактивных зон схемы. id совпадает с id/data-zone групп <g>
     в index.html, порядок фиксирован (он же порядок вкладок).
     -------------------------------------------------------------------------- */
  var ZONES = [
    { id: 'engine-bay',        label: 'Двигатель',       index: '01', hint: 'Моторный отсек · свечи, поршни, впуск' },
    { id: 'transmission-bay',  label: 'Трансмиссия',     index: '02', hint: 'Коробка, сцепление, маховик' },
    { id: 'front-chassis',     label: 'Передняя ходовая',index: '03', hint: 'Тормоза и передняя подвеска' },
    { id: 'rear-chassis',      label: 'Задняя ходовая',  index: '04', hint: 'Задняя подвеска и выхлоп' },
    { id: 'ecu-cabin',         label: 'Электроника',     index: '05', hint: 'Блоки управления и салон' }
  ];

  /* --------------------------------------------------------------------------
     METRICS — 8 осей характеристик, порядок фиксирован.

     min/max/base задают нормировку полосы: pct = (v - min) / (max - min).
     better === 'down' (отклик, вес, бюджет) означает, что МЕНЬШЕЕ значение
     — это лучше, поэтому полоса инвертируется: pct = (max - v) / (max - min).
     Иначе «хорошая» часть шкалы всегда справа и растёт вместе с улучшением.

     short — короткая подпись для дельт вида «+38 л.с.», decimals — сколько
     знаков после запятой печатать (у отклика их два: 0.32 с).
     -------------------------------------------------------------------------- */
  var METRICS = [
    { id: 'power',       label: 'Мощность',            short: 'мощность',    unit: 'л.с.', base: 205,  min: 0,    max: 620,   better: 'up',   decimals: 0, note: '' },
    { id: 'spark',       label: 'Стабильность искры',  short: 'искра',       unit: 'об/мин',base: 6500, min: 3800, max: 9600,  better: 'up',   decimals: 0, note: '' },
    /* Полоса ресурса подогнана под достижимый конверт: сумма 16 модификаций
       даёт 51…125 %, а штрафы (детонация −12, дефицит топлива −6, удар в
       трансмиссии −5, тепловой дисбаланс −3, жёсткая настройка −4, стоковые
       подшипники −10) стакаются — на худшей сборке 54 % превращаются в 23 %
       (детонация, удар в трансмиссии, жёсткая настройка, подшипники). При
       прежних 25…100 полоса упиралась в потолок на 5280 сборках из 65 536.
       Теперь ход 110 п.п.: сток 92 % → 65.5%, полный тюнинг 81 % → 55.5%,
       а вся сборка живёт в окне 2.7%…95.5% — 3 п.п. запаса снизу и 5 п.п.
       сверху, без единого упора. */
    { id: 'reliability', label: 'Ресурс / Надёжность', short: 'надёжность',  unit: '%',     base: 92,   min: 20,   max: 130,   better: 'up',   decimals: 0, note: '' },
    /* max = 1400, а не 980: полностью тюнингованная сборка даёт 1335 °C до
       штрафа P4 и 1310 °C после — при 980 полоса упиралась в потолок. */
    { id: 'thermal',     label: 'Темп. стойкость',     short: 'термостойкость', unit: '°C', base: 420, min: 180,  max: 1400,  better: 'up',   decimals: 0, note: '' },
    /* Полоса отклика подогнана под достижимый конверт: сумма 16 модификаций
       даёт 0.08…0.41 с, а штраф P6 «избыточная масса» срезает ещё −0.02 —
       настоящий минимум 0.06 с (не считая P3 «удар в трансмиссии», который
       наоборот добавляет +0.04 уже после сложения, но на максимум не
       выводит: сцепление −0.07 перевешивает). При прежних 0.09…0.90 полоса
       имела ход 0.81 с, из которых верхние 0.49 с были недостижимы, а 21
       сборка упиралась в пол. Теперь ход 0.44 с: сток 0.32 с → 34.1%,
       полный тюнинг 0.15 с → 72.7% (на 38.6 п.п. выше, отклик — меньше
       лучше), а вся сборка живёт в окне 13.6%…93.2%: 0.03 с запаса снизу и
       0.06 с сверху. */
    { id: 'response',    label: 'Отклик на педаль',    short: 'отклик',      unit: 'с',     base: 0.32, min: 0.03, max: 0.47, better: 'down', decimals: 2, note: '' },
    { id: 'comfort',     label: 'Плавность хода',      short: 'комфорт',     unit: '%',     base: 88,   min: 20,   max: 100,   better: 'up',   decimals: 0, note: '' },
    /* min/max сжаты к достижимому диапазону 1304…1398.2 кг (сток 1340; все
       тюнинг-моды веса дают +58.2 и −36.0, то есть максимум 1398.2 и
       минимум 1304). При прежних 1320…1360 полоса имела ход 40 кг, из них
       использовалось 27.8, а сток с «всё в тюнинг» (1340 против 1340.2)
       стояли в одной точке. Теперь ход 122 кг: сток 52.5%, полный тюнинг
       34.4% (на 18 п.п. ниже, тяжелее — хуже), а вся сборка живёт в окне
       4.9%…82% без упора в потолок: 5.8 кг запаса сверху и 22 кг снизу. */
    { id: 'weight',      label: 'Общий вес',           short: 'масса',       unit: 'кг',    base: 1340, min: 1282, max: 1404, better: 'down', decimals: 0, note: '' },
    /* Полоса бюджета подогнана под достижимую сумму: максимум по всем
       тюнинг-ценам — $11 810, поэтому потолок 14 000 (запас 18.5%). При
       прежних 900 000 полоса была мёртвой: сток 0 $ давал 100% заливки, а
       полный тюнинг 98.7% — разница 1.3 п.п. не читалась вообще. Сток
       остаётся ровно на полу (0 $ — это минимум оси, лучше некуда), но
       полный тюнинг теперь даёт 15.6%, разница 84 п.п. */
    { id: 'budget',      label: 'Бюджет',              short: 'бюджет',      unit: '$',     base: 0,    min: 0,    max: 14000, better: 'down', decimals: 0, note: 'растёт с выбором' }
  ];

  /* 7 модельных осей — по ним считаются части. budget — производная от цен. */
  var MODEL_METRICS = [
    METRICS[0], METRICS[1], METRICS[2], METRICS[3], METRICS[4], METRICS[5], METRICS[6]
  ];

  /* Порядок вариантов внутри детали. */
  var OPTION_ORDER = ['stock', 'tuning'];

  /* --------------------------------------------------------------------------
     PARTS — 16 деталей, сгруппированных по зонам (16 = 4 + 3 + 3 + 3 + 3).
     Формат: { id, zone, label, spec, options: { stock: OPT, tuning: OPT } }.
     OPT = { label, price, mods } где mods содержит РОВНО 7 модельных осей
     (без budget — бюджет суммируется из price).

     Арифметика дельт (проверено в комментариях к computeStats):
       · «всё в тюнинг» даёт максимум по мощности 205 + 187 = 392 л.с.,
         и при turbo-пороге P1/P2 это осмысленное сочетание.
        · «всё в сток» = ровно base по всем осям, бюджет $0.
        · Стоковые опции — всегда нули; опция с одними нулями считается багом.

     ОСЬ ВЕСА откалибрована под достижимый конверт, а не «для галочки».
     Значения weight — это физически честные массы деталей (турбина вместе
     с коллектором, обраткой и интеркулером — не 6.5, а 24 кг; облегчённый
     маховик — не 4.8, а 9 кг), и они разведены по знаку:
       · плюс — тяжёлое и жёсткое: турбина +24, усиленный подрамник +13,
         LSD +8, сцепление +3.5, панель +3, проводка +2.5, ECU +2,
         керамика +1.2, полиуретан +0.8, иридий +0.2 → сумма +58.2 кг;
       · минус — лёгкое и облегчённое: выхлоп −11, маховик −9, поршни −6.5,
         впуск −4, койловеры −4, подшипники −1.5 → сумма −36.0 кг.
     Итог: сток 1340, «всё в тюнинг» 1362.2 (+22.2), самый тяжёлый 1398.2,
     самый лёгкий 1304 — размах 94.2 кг вместо прежних 27.8.
     -------------------------------------------------------------------------- */
  var PARTS = [
    /* --- 01 Двигатель --- */
    { id: 'spark-plugs', zone: 'engine-bay', label: 'Свечи зажигания',
      spec: 'Зазор и ресурс: иридий держит искру при высоком бусте',
      options: {
        stock:  { label: 'Стоковые',   price: 0,    mods: { power: 0,   spark: 0,    reliability: 0,  thermal: 0,   response: 0,     comfort: 0,  weight: 0 } },
        tuning: { label: 'Иридиевые',  price: 180,  mods: { power: 12,  spark: 820,  reliability: 4,  thermal: 60,  response: 0,     comfort: 0,  weight: 0.2 } }
      } },
    { id: 'pistons', zone: 'engine-bay', label: 'Поршни',
      spec: 'Кованые: выше отсечка, выше термонагрузка',
      options: {
        stock:  { label: 'Стоковые',   price: 0,    mods: { power: 0,   spark: 0,    reliability: 0,  thermal: 0,   response: 0,     comfort: 0,  weight: 0 } },
        tuning: { label: 'Кованные',   price: 640,  mods: { power: 38,  spark: 260,  reliability: -7, thermal: 90,  response: 0.01, comfort: 0,  weight: -6.5 } }
      } },
    { id: 'intake', zone: 'engine-bay', label: 'Воздушный фильтр',
      spec: 'Спортивный фильтр: выше расход, громче',
      options: {
        stock:  { label: 'Стоковый',   price: 0,    mods: { power: 0,   spark: 0,    reliability: 0,  thermal: 0,   response: 0,     comfort: 0,  weight: 0 } },
        tuning: { label: 'Спортивный', price: 240,  mods: { power: 16,  spark: 120,  reliability: -3, thermal: 20,  response: 0.01, comfort: 0,  weight: -4.0 } }
      } },
    { id: 'turbo', zone: 'engine-bay', label: 'Турбина',
      spec: 'Наддув: требует топлива и стабильной искры',
      options: {
        stock:  { label: 'Атмосферный',price: 0,    mods: { power: 0,   spark: 0,    reliability: 0,  thermal: 0,   response: 0,     comfort: 0,  weight: 0 } },
        tuning: { label: 'Турбина',    price: 1850, mods: { power: 96,  spark: -180, reliability: -9, thermal: 130, response: 0.02, comfort: 0,  weight: 24.0 } }
      } },

    /* --- 02 Трансмиссия --- */
    { id: 'flywheel', zone: 'transmission-bay', label: 'Маховик',
      spec: 'Облегчённый: быстрее сцепление, меньше инерции',
      options: {
        stock:  { label: 'Стоковый',   price: 0,    mods: { power: 0,   spark: 0,   reliability: 0,  thermal: 0,   response: 0,     comfort: 0,  weight: 0 } },
        tuning: { label: 'Облегчённый',price: 520,  mods: { power: 0,   spark: 0,   reliability: 2,  thermal: 25,  response: -0.09, comfort: 0,  weight: -9.0 } }
      } },
    { id: 'clutch', zone: 'transmission-bay', label: 'Сцепление',
      spec: 'Металлокерамика: держит момент, требует навыка',
      options: {
        stock:  { label: 'Стоковое',        price: 0,   mods: { power: 0, spark: 0, reliability: 0,  thermal: 0,  response: 0,     comfort: 0,  weight: 0 } },
        tuning: { label: 'Металлокерамика', price: 980, mods: { power: 0, spark: 0, reliability: -2, thermal: 95, response: -0.07, comfort: -3, weight: 3.5 } }
      } },
    { id: 'hub-bearings', zone: 'transmission-bay', label: 'Ступичные подшипники',
      spec: 'Усиленные: выше ресурс, меньше люфт',
      options: {
        stock:  { label: 'Стоковые',   price: 0,    mods: { power: 0, spark: 0, reliability: 0,  thermal: 0,   response: 0,    comfort: 0,  weight: 0 } },
        tuning: { label: 'Усиленные',  price: 310,  mods: { power: 0, spark: 0, reliability: 7,  thermal: 20,  response: 0.01, comfort: 2,  weight: -1.5 } }
      } },

    /* --- 03 Передняя ходовая --- */
    { id: 'brake-pads', zone: 'front-chassis', label: 'Тормозные колодки',
      spec: 'Керамика: не фейдит, но требует прогрева',
      options: {
        stock:  { label: 'Стоковые',     price: 0,   mods: { power: 0, spark: 0, reliability: 0,  thermal: 0,   response: 0,    comfort: 0,  weight: 0 } },
        tuning: { label: 'Керамические', price: 760, mods: { power: 0, spark: 0, reliability: 4,  thermal: 190, response: 0.02, comfort: -2, weight: 1.2 } }
      } },
    { id: 'coilovers', zone: 'front-chassis', label: 'Амортизаторы / стойки',
      spec: 'Жёсткие койловеры: точнее, менее комфортно',
      options: {
        stock:  { label: 'Стоковые',           price: 0,    mods: { power: 0, spark: 0, reliability: 0,  thermal: 0,  response: 0,     comfort: 0,  weight: 0 } },
        tuning: { label: 'Жёсткие койловеры',  price: 1420, mods: { power: 0, spark: 0, reliability: -8, thermal: 40,  response: -0.02, comfort: -26, weight: -4.0 } }
      } },
    { id: 'subframe', zone: 'front-chassis', label: 'Подрамник / усилители',
      spec: 'Жёсткость крепления стоек, геометрия развал-схождение',
      options: {
        stock:  { label: 'Стоковый',  price: 0,   mods: { power: 0, spark: 0, reliability: 0,  thermal: 0,  response: 0,    comfort: 0,  weight: 0 } },
        tuning: { label: 'Усиленный', price: 860, mods: { power: 0, spark: 0, reliability: 5,  thermal: 15,  response: -0.01, comfort: -4, weight: 13.0 } }
      } },

    /* --- 04 Задняя ходовая --- */
    { id: 'bushings', zone: 'rear-chassis', label: 'Сайлентблоки',
      spec: 'Полиуретан: чётче реакция, жёстче на мелких неровностях',
      options: {
        stock:  { label: 'Стоковые',         price: 0,   mods: { power: 0, spark: 0, reliability: 0,  thermal: 0,  response: 0,     comfort: 0,  weight: 0 } },
        tuning: { label: 'Полиуретановые',   price: 430, mods: { power: 0, spark: 0, reliability: -3, thermal: 30, response: -0.02, comfort: -16, weight: 0.8 } }
      } },
    { id: 'exhaust', zone: 'rear-chassis', label: 'Выхлопная система',
      spec: 'Спортивный выхлоп: ниже противодавление, выше нагрев',
      options: {
        stock:  { label: 'Стоковая',   price: 0,   mods: { power: 0,  spark: 0,  reliability: 0,  thermal: 0,  response: 0,    comfort: 0,  weight: 0 } },
        tuning: { label: 'Спортивная', price: 890, mods: { power: 11, spark: 40, reliability: -4, thermal: 85,  response: 0.01, comfort: -5, weight: -11.0 } }
      } },
    { id: 'diff', zone: 'rear-chassis', label: 'Задний редуктор',
      spec: 'Усиленный: блокировка под нагрузкой',
      options: {
        stock:  { label: 'Стоковый',    price: 0,    mods: { power: 0, spark: 0, reliability: 0,  thermal: 0,  response: 0,    comfort: 0,  weight: 0 } },
        tuning: { label: 'Усиленный LSD',price: 1180, mods: { power: 0, spark: 0, reliability: 4,  thermal: 35,  response: -0.01, comfort: 2,  weight: 8.0 } }
      } },

    /* --- 05 Электроника --- */
    { id: 'ecu', zone: 'ecu-cabin', label: 'Блок управления (ECU)',
      spec: 'Прошивка: отсечка и топливная карта',
      options: {
        stock:  { label: 'Стоковая',     price: 0,   mods: { power: 0,  spark: 0,   reliability: 0, thermal: 0,  response: 0,    comfort: 0,  weight: 0 } },
        tuning: { label: 'Тюнинг-карта', price: 640, mods: { power: 14, spark: 150,  reliability: -5, thermal: 25,  response: -0.02, comfort: 0,  weight: 2.0 } }
      } },
    { id: 'wiring', zone: 'ecu-cabin', label: 'Проводка и ЭБУ-логика',
      spec: 'Армированные цепи: стабильнее при бусте',
      options: {
        stock:  { label: 'Стоковая',     price: 0,   mods: { power: 0, spark: 0,  reliability: 0, thermal: 0,  response: 0,  comfort: 0,  weight: 0 } },
        tuning: { label: 'Армированная', price: 390, mods: { power: 0, spark: 230, reliability: 6,  thermal: 45,  response: 0,  comfort: 0,  weight: 2.5 } }
      } },
    { id: 'gauges', zone: 'ecu-cabin', label: 'Приборная панель',
      spec: 'Гоночная панель: обороты, температура, давление',
      options: {
        stock:  { label: 'Стандартная', price: 0,   mods: { power: 0, spark: 0,   reliability: 0, thermal: 0,  response: 0,    comfort: 0,  weight: 0 } },
        tuning: { label: 'Гоночная',    price: 520,  mods: { power: 0, spark: 110,  reliability: 1, thermal: 10,  response: 0.01, comfort: 3,  weight: 3.0 } }
      } }
  ];

  /* --------------------------------------------------------------------------
     PENALTIES — «матрица зависимостей». Условия выводятся из config и из
     предварительной (без штрафов) суммы по осям; применяются ПОСЛЕ сложения
     дельт, поэтому вторая штрафная ступень уже видит результат первой
     (например, детонация P1 срезает мощность до значения, которое уже не
     проходит порог P7).
     -------------------------------------------------------------------------- */
  var PENALTIES = [
    { id: 'detonation', message: 'Низкая стабильность искры',
      detail: 'Высокая мощность на стоковых свечах — риск детонации и пропусков.',
      test: function (c, s) { return s.power >= 300 && c['spark-plugs'] === 'stock'; },
      effects: { thermal: -70, reliability: -12 } },
    { id: 'fuel-cap', message: 'Дефицит топлива',
      detail: 'Турбина без спортивного впуса — насос не покрывает расход.',
      /* Порог 340 л.с. подобран так, чтобы быть достижимым: при стоковом
         впуске и тюнинг-турбине потолок мощности равен 376 л.с., а сток
         выдаёт 205 л.с. — срабатывает на любой «разгонённой» связке
         (турбина + поршни + что-то ещё), но не на стоковой сборке. */
      test: function (c, s) { return s.power >= 340 && c['intake'] === 'stock' && c['turbo'] === 'tuning'; },
      effects: { power: -30, reliability: -6 } },
    { id: 'driveline', message: 'Удар в трансмиссии',
      detail: 'Металлокерамика со стоковым маховиком — рывки и износ сцепления.',
      test: function (c) { return c['clutch'] === 'tuning' && c['flywheel'] === 'stock'; },
      effects: { response: 0.04, reliability: -5 } },
    { id: 'thermal-brake', message: 'Тепловой дисбаланс',
      detail: 'Керамика и горячий выхлоп в одной зоне — перегрев.',
      test: function (c) { return c['brake-pads'] === 'tuning' && c['exhaust'] === 'tuning'; },
      effects: { thermal: -25, reliability: -3 } },
    { id: 'stiffness', message: 'Жёсткая настройка без демпферов',
      detail: 'Койловеры с стоковыми сайлентблоками — ударные нагрузки на кузов.',
      test: function (c) { return c['coilovers'] === 'tuning' && c['bushings'] === 'stock'; },
      effects: { comfort: -14, reliability: -4 } },
    { id: 'unsprung', message: 'Избыточная масса',
      detail: 'Тяжёлый автомобиль хуже гасит неровности.',
      /* Порог 1356 кг: полный сток — ровно 1340 кг, а сумма всех положительных
         массовых модификаций даёт максимум 1398.2 кг. 1356 — это +16 кг, то
         есть осознанно набрать минимум две тяжёлые детали: турбина (+24),
         либо подрамник с LSD (+21), либо подрамник с сцеплением (+16.5).
         Мелкий набор (сцепление, керамика, панель, проводка, ECU, сайлентблоки,
         иридий) даёт всего +13.2 и порога не достигает, как и одиночный
         подрамник (+13). Ловится на полном тюнинге (1362.2) и на самом
         тяжёлом build (1398.2), но не на стоке и ни на одной облегчённой
         сборке. */
      test: function (c, s) { return s.weight > 1356; },
      effects: { comfort: -12, response: -0.02 } },
    { id: 'endurance', message: 'Стоковые подшипники на пике',
      detail: 'Высокие обороты и масса на стоковых ступицах — риск разрушения.',
      test: function (c, s) { return s.power >= 360 && c['hub-bearings'] === 'stock'; },
      effects: { reliability: -10, thermal: -30 } }
  ];

  /* --------------------------------------------------------------------------
     Состояние. config — единственный источник правды; всё остальное выводится
     в paint(). Каждая деталь изначально на стоке.
     -------------------------------------------------------------------------- */
  var config = {};
  var activeZoneId = ZONES[0].id;
  PARTS.forEach(function (part) { config[part.id] = 'stock'; });

  /* Намерение пользователя по панели (мобильный аккордеон). Объявлено до
     buildUI(), который читает его из разметки. */
  var userWantsExpanded = true;

  /* Планировщик перерисовки: N быстрых переключений сливаются в один кадр. */
  var queued = false;
  var raf = (typeof window.requestAnimationFrame === 'function')
    ? function (fn) { window.requestAnimationFrame(fn); }
    : function (fn) { window.setTimeout(fn, 16); };

  /* --------------------------------------------------------------------------
     Кэш узлов. Всё, что нужно paint(), создаётся один раз в buildUI() и
     обновляется точечно — без querySelector внутри перерисовки.
     -------------------------------------------------------------------------- */
  var refs = {
    stage: null, tabs: null, panes: null, partsHost: null, metrics: null,
    warnings: null, summary: null, totalPrice: null, resetBtn: null,
    accordionToggle: null, panelBody: null, svgZones: [],
    headerByMetric: {},
    tabsByZone: {}, panesByZone: {}, partsById: {},
    metricById: {}, ghosts: []
  };

  /* --------------------------------------------------------------------------
     Форматирование. Intl может отсутствовать/бросить — тогда голый String.
     -------------------------------------------------------------------------- */
  var intFmt = null;
  var decFmt = { 0: null, 1: null, 2: null };
  function buildFormatters() {
    try {
      intFmt = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
    } catch (e) {
      intFmt = null;
    }
    [0, 1, 2].forEach(function (d) {
      try {
        decFmt[d] = new Intl.NumberFormat('ru-RU', {
          minimumFractionDigits: d, maximumFractionDigits: d
        });
      } catch (e) {
        decFmt[d] = null;
      }
    });
  }

  function formatFixed(value, decimals) {
    var d = decFmt[decimals] || decFmt[0];
    if (!d) return String(value);
    return d.format(value);
  }

  function formatInt(value) {
    return intFmt ? intFmt.format(value) : String(value);
  }

  /* Бюджет печатается как $1 850: неразрывный пробел из ru-RU + префикс $. */
  function formatMoney(value) {
    return '$' + formatInt(value);
  }

  /* Знаковое число для дельт: +38 / −7 / 0.00 → «+0.00». */
  var MINUS = '−';
  function formatSigned(value, decimals) {
    var text = formatFixed(Math.abs(value), decimals);
    if (value > 0) return '+' + text;
    if (value < 0) return MINUS + text;
    return text;
  }

  /* --------------------------------------------------------------------------
     computeStats — единственный источник характеристик.

     Порядок: 1) сумма base + Σ mods по выбранным опциям; 2) штрафные связи;
     3) clamp в [min, max]; 4) округление по decimals. Всё в number, без NaN.

     overridePartId / overrideOptionKey — «призрачный» прогон: одна деталь
     считается с другой опцией, состояние не трогаем. Штрафы считаются по
     временной копии config с той же подменой, поэтому предпросмотр честно
     показывает и появление конфликта.
     -------------------------------------------------------------------------- */
  function computeStats(overridePartId, overrideOptionKey) {
    var i, j;

    /* Рабочая копия config: подмена только для what-if. */
    var c = {};
    for (i = 0; i < PARTS.length; i++) c[PARTS[i].id] = config[PARTS[i].id];
    if (overridePartId && PARTS.length) {
      c[overridePartId] = overrideOptionKey;
    }

    /* 1. Прямая сумма дельт + бюджет из цен. */
    var sums = {};
    for (i = 0; i < MODEL_METRICS.length; i++) sums[MODEL_METRICS[i].id] = MODEL_METRICS[i].base;
    var budget = 0;

    for (i = 0; i < PARTS.length; i++) {
      var part = PARTS[i];
      var key = c[part.id];
      var opt = part.options[key];
      if (!opt) continue;
      var mods = opt.mods;
      if (mods) {
        for (j = 0; j < MODEL_METRICS.length; j++) {
          var m = MODEL_METRICS[j];
          var d = mods[m.id];
          /* Отсутствующая/битая дельта = 0, а не NaN. */
          if (typeof d === 'number' && isFinite(d)) sums[m.id] += d;
        }
      }
      var price = opt.price;
      if (typeof price === 'number' && isFinite(price)) budget += price;
    }

    /* 2. Перекрёстные штрафы — по предварительной сумме, поверх неё. */
    var active = [];
    for (i = 0; i < PENALTIES.length; i++) {
      var pen = PENALTIES[i];
      var fired = false;
      try {
        fired = !!pen.test(c, sums);
      } catch (e) {
        fired = false;
      }
      if (!fired) continue;
      var keys = Object.keys(pen.effects);
      for (j = 0; j < keys.length; j++) {
        var id = keys[j];
        if (typeof sums[id] === 'number' && isFinite(pen.effects[id])) sums[id] += pen.effects[id];
      }
      active.push(pen);
    }

    /* 3–4. Clamp, округление, нормировка в проценты. */
    var values = {};
    var pcts = {};
    for (i = 0; i < METRICS.length; i++) {
      var metric = METRICS[i];
      var v;
      if (metric.id === 'budget') {
        v = budget;
      } else {
        v = sums[metric.id];
        if (typeof v !== 'number' || !isFinite(v)) v = metric.base;
      }
      if (v < metric.min) v = metric.min;
      if (v > metric.max) v = metric.max;
      var rounded = roundTo(v, metric.decimals);
      values[metric.id] = rounded;
      pcts[metric.id] = toPct(rounded, metric);
    }

    return { values: values, pcts: pcts, penalties: active, budget: budget };
  }

  function roundTo(value, decimals) {
    var f = Math.pow(10, decimals);
    var r = Math.round(value * f) / f;
    /* -0 убираем, иначе в тексте появляется «−0». */
    if (r === 0) r = 0;
    return r;
  }

  /* better === 'down' → заполнение инвертировано: меньше raw = больше полоса. */
  function toPct(value, metric) {
    var span = metric.max - metric.min;
    if (span <= 0) return 0;
    var pct = metric.better === 'down'
      ? (metric.max - value) / span
      : (value - metric.min) / span;
    if (pct < 0) pct = 0;
    if (pct > 100) pct = 100;
    return pct * 100;
  }

  /* Улучшение ли значение относительно base/текущего: сравниваем в направлении
     better, чтобы is-good/is-bad и призрак совпадали по смыслу. */
  function isBetterThan(metric, value, reference) {
    if (metric.better === 'down') return value < reference;
    return value > reference;
  }

  /* --------------------------------------------------------------------------
     buildUI — создаёт вкладки, панели зон, 16 строк деталей, 8 полос,
     панель предупреждений и футер-итог. Только createElement/createTextNode.
     Хосты ищутся по id; если их нет (минимальная разметка) — создаются и
     добавляются в #panelBody, чтобы не падать.
     -------------------------------------------------------------------------- */
  function buildUI() {
    if (!document || !document.body) return;

    refs.stage = document.getElementById('stage') || document.querySelector('.stage');
    refs.resetBtn = document.getElementById('resetBtn');
    refs.accordionToggle = document.getElementById('accordionToggle');
    refs.panelBody = document.getElementById('panelBody');

    /* Стартовое намерение пользователя берём из разметки. */
    userWantsExpanded = !refs.accordionToggle ||
      refs.accordionToggle.getAttribute('aria-expanded') !== 'false';

    var body = refs.panelBody || document.querySelector('.panel__body') || document.body;
    refs.tabs = ensureHost('tabs', 'tabs', body, 'tablist');
    refs.panes = ensureHost('panes', 'panes', body);
    refs.partsHost = refs.panes;
    refs.warnings = ensureHost('warnings', 'warnings', body);
    refs.metrics = ensureHost('metrics', 'metrics', body);
    /* Футер-итог в разметке без id — ищем по классу, иначе создаём. */
    refs.summary = document.getElementById('summary') ||
      (document.querySelector ? document.querySelector('.summary') : null) ||
      ensureHost('summary', 'summary', body);

    buildTabs();
    buildPanes();
    buildMetrics();
    buildWarnings();
    buildSummary();
    buildHeaderReadout();

    /* SVG-зоны статичны в index.html — кэшируем для точечного класса. */
    if (typeof document.querySelectorAll === 'function') {
      refs.svgZones = Array.prototype.slice.call(document.querySelectorAll('g[data-zone]'));
    }
  }

  /* Найти хост по id, иначе создать внутри parent. */
  function ensureHost(id, className, parent, role) {
    var el = document.getElementById(id);
    if (el) return el;
    if (!parent) return null;
    el = document.createElement('div');
    el.id = id;
    el.className = className;
    if (role) el.setAttribute('role', role);
    parent.appendChild(el);
    return el;
  }

  function buildTabs() {
    if (!refs.tabs) return;
    ZONES.forEach(function (zone, i) {
      var tab = document.createElement('button');
      tab.type = 'button';
      tab.className = 'tab';
      tab.id = 'tab-' + zone.id;
      tab.setAttribute('data-zone', zone.id);
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
      tab.setAttribute('aria-controls', 'pane-' + zone.id);
      tab.setAttribute('tabindex', i === 0 ? '0' : '-1');

      var index = document.createElement('span');
      index.className = 'tab__index';
      index.appendChild(document.createTextNode(zone.index));

      var label = document.createElement('span');
      label.className = 'tab__label';
      label.appendChild(document.createTextNode(zone.label));

      tab.appendChild(index);
      tab.appendChild(label);
      refs.tabs.appendChild(tab);
      refs.tabsByZone[zone.id] = tab;
    });
  }

  function buildPanes() {
    if (!refs.panes) return;
    ZONES.forEach(function (zone, i) {
      var pane = document.createElement('section');
      pane.className = 'pane';
      pane.id = 'pane-' + zone.id;
      pane.setAttribute('data-zone', zone.id);
      pane.setAttribute('role', 'tabpanel');
      pane.setAttribute('aria-labelledby', 'tab-' + zone.id);
      pane.hidden = i !== 0;

      var head = document.createElement('header');
      head.className = 'pane__head';

      var index = document.createElement('span');
      index.className = 'pane__index';
      index.appendChild(document.createTextNode(zone.index));

      var titles = document.createElement('div');
      titles.className = 'pane__titles';

      var title = document.createElement('h3');
      title.className = 'pane__title';
      title.appendChild(document.createTextNode(zone.label));

      var hint = document.createElement('p');
      hint.className = 'pane__hint';
      hint.appendChild(document.createTextNode(zone.hint));

      titles.appendChild(title);
      titles.appendChild(hint);
      head.appendChild(index);
      head.appendChild(titles);
      pane.appendChild(head);

      var list = document.createElement('div');
      list.className = 'pane__parts';
      pane.appendChild(list);

      PARTS.forEach(function (part) {
        if (part.zone !== zone.id) return;
        list.appendChild(buildPart(part));
      });

      refs.panes.appendChild(pane);
      refs.panesByZone[zone.id] = pane;
    });
  }

  /* Строка детали: заголовок, техстрока, подсказка дельты, две кнопки опций. */
  function buildPart(part) {
    var row = document.createElement('article');
    row.className = 'part';
    row.setAttribute('data-part', part.id);

    var main = document.createElement('div');
    main.className = 'part__main';

    var head = document.createElement('div');
    head.className = 'part__head';

    var label = document.createElement('span');
    label.className = 'part__label';
    label.appendChild(document.createTextNode(part.label));
    head.appendChild(label);

    var delta = document.createElement('span');
    delta.className = 'part__delta';
    delta.setAttribute('aria-live', 'polite');
    head.appendChild(delta);

    var spec = document.createElement('p');
    spec.className = 'part__spec';
    spec.appendChild(document.createTextNode(part.spec));

    main.appendChild(head);
    main.appendChild(spec);

    var options = document.createElement('div');
    options.className = 'part__options';
    options.setAttribute('role', 'group');
    options.setAttribute('aria-label', part.label);

    var optEls = {};
    OPTION_ORDER.forEach(function (optionKey) {
      var opt = part.options[optionKey];
      if (!opt) return;
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'opt';
      btn.setAttribute('data-part', part.id);
      btn.setAttribute('data-option', optionKey);
      btn.setAttribute('aria-pressed', optionKey === 'stock' ? 'true' : 'false');

      var name = document.createElement('span');
      name.className = 'opt__label';
      name.appendChild(document.createTextNode(opt.label));

      var price = document.createElement('span');
      price.className = 'opt__price';
      price.appendChild(document.createTextNode(formatMoney(opt.price)));

      btn.appendChild(name);
      btn.appendChild(price);
      btn.setAttribute('aria-label', part.label + ': ' + opt.label + ', ' + formatMoney(opt.price));

      options.appendChild(btn);
      optEls[optionKey] = btn;
    });

    row.appendChild(main);
    row.appendChild(options);
    refs.partsById[part.id] = { row: row, delta: delta, options: optEls };
    return row;
  }

  function buildMetrics() {
    if (!refs.metrics) return;
    METRICS.forEach(function (metric) {
      var row = document.createElement('div');
      row.className = 'metric';
      row.setAttribute('data-metric', metric.id);

      var head = document.createElement('div');
      head.className = 'metric__head';

      var label = document.createElement('span');
      label.className = 'metric__label';
      /* Текст подписи — отдельный элемент: text-overflow:ellipsis работает
         только у блочного бокса, а .metric__label остаётся flex-строкой. */
      var labelText = document.createElement('span');
      labelText.className = 'metric__label-text';
      labelText.appendChild(document.createTextNode(metric.label));
      label.appendChild(labelText);
      if (metric.note) {
        var note = document.createElement('span');
        note.className = 'metric__note';
        note.appendChild(document.createTextNode(metric.note));
        label.appendChild(note);
      }

      var value = document.createElement('span');
      value.className = 'metric__value';
      value.appendChild(document.createTextNode(
        metric.id === 'budget' ? formatMoney(metric.base) : formatFixed(metric.base, metric.decimals)
      ));

      var unit = document.createElement('span');
      unit.className = 'metric__unit';
      unit.appendChild(document.createTextNode(metric.unit));

      head.appendChild(label);
      head.appendChild(value);
      head.appendChild(unit);

      var track = document.createElement('div');
      track.className = 'metric__track';
      track.setAttribute('role', 'progressbar');
      track.setAttribute('aria-valuemin', String(metric.min));
      track.setAttribute('aria-valuemax', String(metric.max));
      track.setAttribute('aria-valuenow', String(metric.base));
      track.setAttribute('aria-label', metric.label);

      var fill = document.createElement('div');
      fill.className = 'metric__fill';
      fill.style.width = toPct(metric.base, metric) + '%';
      track.appendChild(fill);

      row.appendChild(head);
      row.appendChild(track);
      refs.metrics.appendChild(row);
      refs.metricById[metric.id] = { row: row, fill: fill, track: track, value: value, unit: unit };
    });
  }

  function buildWarnings() {
    if (!refs.warnings) return;
    refs.warnings.setAttribute('aria-live', 'polite');
  }

  /* Футер-итог. Разметка в index.html уже содержит <footer class="summary">
     с готовой .summary__grid и четырьмя значениями (#totalPrice, #totalWeight,
     #totalPower, #totalReliability) — их мы переиспользуем, чтобы не плодить
     дубли id. Недостающие ячейки достраиваем сами. */
  function buildSummary() {
    if (!refs.summary) return;
    var i;

    var grid = null;
    var kids = refs.summary.children || [];
    for (i = 0; i < kids.length; i++) {
      if (kids[i] && kids[i].classList && kids[i].classList.contains('summary__grid')) grid = kids[i];
    }
    if (!grid) {
      grid = document.createElement('div');
      grid.className = 'summary__grid';
      refs.summary.appendChild(grid);
    }

    var cells = [
      { id: 'totalPrice',        label: 'Бюджет',     metric: 'budget',      ref: 'totalPrice' },
      { id: 'totalWeight',       label: 'Вес',        metric: 'weight',      ref: 'summary_weight' },
      { id: 'totalPower',        label: 'Мощность',   metric: 'power',       ref: 'summary_power' },
      { id: 'totalReliability',  label: 'Надёжность', metric: 'reliability', ref: 'summary_reliability' }
    ];

    cells.forEach(function (cell) {
      var value = document.getElementById(cell.id);
      if (value) {
        /* Готовая ячейка разметки: лишь дописываем класс-синоним,
           чтобы стилизовать можно было и по .summary__value, и по нему. */
        if (!value.classList.contains('summary__cell-value')) {
          value.className = (value.className ? value.className + ' ' : '') + 'summary__cell-value';
        }
        refs[cell.ref] = value;
        return;
      }
      var box = document.createElement('div');
      box.className = 'summary__cell';

      var label = document.createElement('span');
      label.className = 'summary__cell-label summary__label';
      label.appendChild(document.createTextNode(cell.label));

      var created = document.createElement('span');
      created.className = 'summary__cell-value summary__value';
      created.id = cell.id;
      created.setAttribute('data-summary', cell.metric);
      refs[cell.ref] = created;

      box.appendChild(label);
      box.appendChild(created);
      grid.appendChild(box);
    });
  }

  /* Шапка: три статичных показателя [data-header-metric] — power, reliability,
     weight. Кэшируются по атрибуту, чтобы не искать селектором в paint(). */
  function buildHeaderReadout() {
    refs.headerByMetric = {};
    if (typeof document.querySelectorAll !== 'function') return;
    var nodes = document.querySelectorAll('[data-header-metric]');
    Array.prototype.slice.call(nodes).forEach(function (node) {
      var key = node.getAttribute('data-header-metric');
      if (key) refs.headerByMetric[key] = node;
    });
  }

  /* --------------------------------------------------------------------------
     paint — единственная перерисовка. Читает только state + refs, структуру DOM
     не меняет (все 5 панелей созданы заранее, переключается hidden), фокус не
     трогает. Ширины полос и классы переключаются точечно, анимация — в CSS.
     -------------------------------------------------------------------------- */
  function paint() {
    var stats = computeStats();
    var i;

    /* 1. Полосы характеристик: ширина, значение, подсветка лучше/хуже base. */
    for (i = 0; i < METRICS.length; i++) {
      var metric = METRICS[i];
      var els = refs.metricById[metric.id];
      if (!els) continue;
      var v = stats.values[metric.id];
      els.fill.style.width = stats.pcts[metric.id] + '%';
      els.value.textContent = metric.id === 'budget'
        ? formatMoney(v)
        : formatFixed(v, metric.decimals);
      els.track.setAttribute('aria-valuenow', String(v));
      els.track.setAttribute('aria-valuetext',
        (metric.id === 'budget' ? formatMoney(v) : formatFixed(v, metric.decimals)) + ' ' + metric.unit);

      if (v === metric.base) {
        els.fill.classList.remove('is-good');
        els.fill.classList.remove('is-bad');
      } else if (isBetterThan(metric, v, metric.base)) {
        els.fill.classList.add('is-good');
        els.fill.classList.remove('is-bad');
      } else {
        els.fill.classList.add('is-bad');
        els.fill.classList.remove('is-good');
      }
    }

    /* 2. Кнопки опций: класс и aria-pressed строго синхронны. */
    for (i = 0; i < PARTS.length; i++) {
      var part = PARTS[i];
      var cache = refs.partsById[part.id];
      if (!cache) continue;
      var selected = config[part.id];
      for (var j = 0; j < OPTION_ORDER.length; j++) {
        var key = OPTION_ORDER[j];
        var btn = cache.options[key];
        if (!btn) continue;
        var on = key === selected;
        if (on) {
          btn.classList.add('is-active');
        } else {
          btn.classList.remove('is-active');
        }
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
      }
      cache.delta.textContent = buildDeltaText(part, stats);
      cache.row.classList.toggle('is-stock', selected === 'stock');
    }

    /* 3. Активная зона: вкладки, панели, группы <g> на схеме. */
    for (i = 0; i < ZONES.length; i++) {
      var zone = ZONES[i];
      var on = zone.id === activeZoneId;
      var tab = refs.tabsByZone[zone.id];
      if (tab) {
        if (on) {
          tab.classList.add('is-active');
        } else {
          tab.classList.remove('is-active');
        }
        tab.setAttribute('aria-selected', on ? 'true' : 'false');
        tab.setAttribute('tabindex', on ? '0' : '-1');
      }
      var pane = refs.panesByZone[zone.id];
      if (pane) {
        if (on) {
          pane.classList.add('is-active');
        } else {
          pane.classList.remove('is-active');
        }
        pane.hidden = !on;
      }
    }
    for (i = 0; i < refs.svgZones.length; i++) {
      var g = refs.svgZones[i];
      var gid = g.getAttribute('data-zone');
      var gOn = gid === activeZoneId;
      /* Разметка схемы подсвечивается классом .active, панели — .is-active;
         ставим оба, чтобы не зависеть от одного имени. */
      if (gOn) {
        g.classList.add('is-active');
        g.classList.add('active');
      } else {
        g.classList.remove('is-active');
        g.classList.remove('active');
      }
      g.setAttribute('aria-pressed', gOn ? 'true' : 'false');
    }

    /* 4. Предупреждения: активные штрафы либо «в допуске». */
    renderWarnings(stats.penalties);

    /* 5. Итог: футер-сводка и «приборный» блок шапки. */
    if (refs.totalPrice) refs.totalPrice.textContent = formatMoney(stats.values.budget);
    if (refs.summary_power) {
      refs.summary_power.textContent = formatFixed(stats.values.power, 0) + ' ' + METRICS[0].unit;
    }
    if (refs.summary_weight) {
      refs.summary_weight.textContent = formatFixed(stats.values.weight, 0) + ' ' + METRICS[6].unit;
    }
    if (refs.summary_reliability) {
      refs.summary_reliability.textContent = formatFixed(stats.values.reliability, 0) + ' %';
    }
    if (refs.headerByMetric) {
      if (refs.headerByMetric.power) {
        refs.headerByMetric.power.textContent = formatFixed(stats.values.power, 0);
      }
      if (refs.headerByMetric.reliability) {
        refs.headerByMetric.reliability.textContent = formatFixed(stats.values.reliability, 0) + '%';
      }
      if (refs.headerByMetric.weight) {
        refs.headerByMetric.weight.textContent = formatFixed(stats.values.weight, 0);
      }
    }
  }

  /* render — планировщик: N вызовов в одном кадре = одна перерисовка. */
  function render() {
    if (queued) return;
    queued = true;
    raf(function () {
      queued = false;
      paint();
    });
  }

  function renderWarnings(penalties) {
    var host = refs.warnings;
    if (!host) return;
    /* Полная перерисовка списка конфликтов: он короткий (максимум 7 штук). */
    while (host.firstChild) host.removeChild(host.firstChild);

    if (!penalties || !penalties.length) {
      host.classList.remove('is-alert');
      var ok = document.createElement('div');
      ok.className = 'warnings__ok';
      ok.appendChild(document.createTextNode('Система в допуске · конфликтов не обнаружено'));
      host.appendChild(ok);
      return;
    }

    host.classList.add('is-alert');
    penalties.forEach(function (pen) {
      var item = document.createElement('div');
      item.className = 'warning';
      item.setAttribute('data-penalty', pen.id);

      var chip = document.createElement('span');
      chip.className = 'warning__chip';
      chip.appendChild(document.createTextNode(pen.message));

      var detail = document.createElement('p');
      detail.className = 'warning__detail';
      detail.appendChild(document.createTextNode(pen.detail));

      item.appendChild(chip);
      item.appendChild(detail);
      host.appendChild(item);
    });
  }

  /* --------------------------------------------------------------------------
     Дельты деталей. Считаются из того же what-if прогона, что и призраки:
     строка показывает «что будет, если нажать», а полосы — где окажется
     значение. Формат: «+38 л.с. · −7% надёжность», максимум 3 записи.
     -------------------------------------------------------------------------- */
  function otherOptionKey(part) {
    var current = config[part.id];
    for (var i = 0; i < OPTION_ORDER.length; i++) {
      if (OPTION_ORDER[i] !== current && part.options[OPTION_ORDER[i]]) return OPTION_ORDER[i];
    }
    return null;
  }

  function buildDeltaText(part, current) {
    var key = otherOptionKey(part);
    if (!key) return '';
    var next = computeStats(part.id, key);
    var entries = [];
    for (var i = 0; i < METRICS.length; i++) {
      var m = METRICS[i];
      var diff = next.values[m.id] - current.values[m.id];
      if (m.id === 'budget') {
        /* Бюджет в строке детали не дублируем — он есть в полосе и в итоге. */
        continue;
      }
      if (Math.abs(diff) < Math.pow(10, -(m.decimals + 1)) / 2) continue;
      entries.push({ metric: m, diff: diff });
    }
    if (!entries.length) {
      var opt = part.options[key];
      return opt ? formatMoney(opt.price) : '';
    }
    entries.sort(function (a, b) { return Math.abs(b.diff) - Math.abs(a.diff); });
    var parts = [];
    var limit = entries.length > 3 ? 3 : entries.length;
    for (var j = 0; j < limit; j++) {
      parts.push(formatDeltaEntry(entries[j].metric, entries[j].diff));
    }
    if (entries.length > limit) parts.push('+ ещё ' + (entries.length - limit));
    return parts.join(' · ');
  }

  function formatDeltaEntry(metric, diff) {
    var num = formatSigned(diff, metric.decimals);
    /* Проценты приклеиваем без пробела, остальные единицы — через пробел. */
    return metric.unit === '%' ? num + '% ' + metric.short : num + ' ' + metric.unit + ' ' + metric.short;
  }

  /* --------------------------------------------------------------------------
     Призрачный предпросмотр. Наведение/фокус на строку детали (или на кнопку
     опции внутри неё) считает what-if и ставит тонкий маркер в каждой
     изменившейся полосе. Уход мыши/фокуса — полная очистка.
     -------------------------------------------------------------------------- */
  var ghostPartId = null;
  var ghostOptionKey = null;

  function clearGhosts() {
    var i;
    for (i = 0; i < refs.ghosts.length; i++) {
      var node = refs.ghosts[i];
      if (node && node.parentNode) node.parentNode.removeChild(node);
    }
    refs.ghosts = [];
    for (i = 0; i < METRICS.length; i++) {
      var els = refs.metricById[METRICS[i].id];
      if (!els) continue;
      els.row.classList.remove('has-ghost');
    }
    ghostPartId = null;
    ghostOptionKey = null;
  }

  function showGhosts(partId, optionKey) {
    var part = null;
    var i;
    for (i = 0; i < PARTS.length; i++) {
      if (PARTS[i].id === partId) { part = PARTS[i]; break; }
    }
    if (!part || !part.options[optionKey]) return;
    if (ghostPartId === partId && ghostOptionKey === optionKey) return;

    clearGhosts();
    ghostPartId = partId;
    ghostOptionKey = optionKey;

    var current = computeStats();
    var next = computeStats(partId, optionKey);

    for (i = 0; i < METRICS.length; i++) {
      var m = METRICS[i];
      var els = refs.metricById[m.id];
      if (!els) continue;
      var diff = next.values[m.id] - current.values[m.id];
      /* Порог: меньше половины последнего знака — «без изменений», призрак
         не рисуем, иначе полоса дрожит из-за округления. */
      if (Math.abs(diff) < Math.pow(10, -(m.decimals + 1)) / 2) continue;

      var good = isBetterThan(m, next.values[m.id], current.values[m.id]);
      var marker = document.createElement('div');
      marker.className = good ? 'metric__ghost metric__ghost--good' : 'metric__ghost metric__ghost--bad';
      marker.style.left = next.pcts[m.id] + '%';
      marker.style.width = '2px';
      marker.setAttribute('aria-hidden', 'true');
      els.track.appendChild(marker);
      els.row.classList.add('has-ghost');
      refs.ghosts.push(marker);
    }
  }

  /* Извлечь деталь и «предпросматриваемую» опцию из цели события. */
  function ghostTargetFrom(node) {
    var optBtn = closest(node, '.opt');
    if (optBtn) {
      var optPart = optBtn.getAttribute('data-part');
      var optKey = optBtn.getAttribute('data-option');
      if (optPart && optKey) return { partId: optPart, optionKey: optKey };
    }
    var row = closest(node, '.part');
    if (row) {
      var partId = row.getAttribute('data-part');
      if (!partId) return null;
      for (var i = 0; i < PARTS.length; i++) {
        if (PARTS[i].id !== partId) continue;
        /* Без наведения на конкретную кнопку показываем «следующий» вариант. */
        var key = otherOptionKey(PARTS[i]);
        return key ? { partId: partId, optionKey: key } : null;
      }
    }
    return null;
  }

  /* closest с проверкой поддержки и с границей контейнера. */
  function closest(node, selector) {
    if (!node || typeof node.closest !== 'function') return null;
    var found = null;
    try {
      found = node.closest(selector);
    } catch (e) {
      found = null;
    }
    if (found && refs.partsHost && found === refs.partsHost) return null;
    return found;
  }

  /* --------------------------------------------------------------------------
     Аккордеон (мобильный <= 900px). Сворачивание панели делает CSS по
     aria-expanded; атрибут hidden дублирует его для надёжности. На десктопе
     панель не может быть скрыта — там expanded всегда true.
     -------------------------------------------------------------------------- */
  function isNarrowViewport() {
    return !!(window.matchMedia && window.matchMedia('(max-width: 900px)').matches);
  }

  function setAccordion(expanded) {
    if (!refs.accordionToggle || !refs.panelBody) return;
    /* Запоминаем именно намерение, а не итоговое значение: на десктопе
       value принудительно станет true, иначе после возврата на мобильный
       панель «вспомнила» бы состояние, которого пользователь не выбирал. */
    userWantsExpanded = !!expanded;
    var value = isNarrowViewport() ? userWantsExpanded : true;
    refs.accordionToggle.setAttribute('aria-expanded', value ? 'true' : 'false');
    refs.panelBody.hidden = !value;
  }

  /* --------------------------------------------------------------------------
     Мутаторы состояния. Каждый меняет state и просит перерисовку (одну).
     -------------------------------------------------------------------------- */
  function setOption(partId, optionKey) {
    var part = null;
    var i;
    for (i = 0; i < PARTS.length; i++) {
      if (PARTS[i].id === partId) { part = PARTS[i]; break; }
    }
    if (!part || !part.options[optionKey]) return;
    if (config[partId] === optionKey) return;
    config[partId] = optionKey;
    /* Клик по детали сразу открывает её зону — иначе нажатая кнопка
       оказывается в скрытой панели. */
    if (part.zone !== activeZoneId) activeZoneId = part.zone;
    clearGhosts();
    render();
  }

  function selectZone(zoneId) {
    var known = false;
    for (var i = 0; i < ZONES.length; i++) {
      if (ZONES[i].id === zoneId) { known = true; break; }
    }
    if (!known) return;
    if (activeZoneId === zoneId) return;
    activeZoneId = zoneId;
    clearGhosts();
    render();
  }

  function resetAll() {
    for (var i = 0; i < PARTS.length; i++) config[PARTS[i].id] = 'stock';
    activeZoneId = ZONES[0].id;
    clearGhosts();
    render();
  }

  /* --------------------------------------------------------------------------
     bindEvents — делегирование: ни одного обработчика на конкретный узел.
     -------------------------------------------------------------------------- */
  function bindEvents() {
    /* --- Схема: клик по зоне + Enter/Space (SVG <g> сам не активируется) --- */
    if (refs.stage) {
      refs.stage.addEventListener('click', function (e) {
        var hit = closest(e.target, 'g[data-zone]');
        if (!hit) return;
        var zone = hit.getAttribute('data-zone');
        selectZone(zone);
        setAccordion(true);
      });

      refs.stage.addEventListener('keydown', function (e) {
        if (!e) return;
        var key = e.key;
        if (key !== 'Enter' && key !== ' ' && key !== 'Spacebar' && e.code !== 'Space') return;
        var hit = closest(e.target, 'g[data-zone]');
        if (!hit) return;
        e.preventDefault();
        selectZone(hit.getAttribute('data-zone'));
        setAccordion(true);
      });
    }

    /* --- Вкладки: клик --- */
    if (refs.tabs) {
      refs.tabs.addEventListener('click', function (e) {
        var tab = closest(e.target, '.tab');
        if (!tab) return;
        selectZone(tab.getAttribute('data-zone'));
      });

      /* Стрелки по roving tabindex: фокус и выбор идут вместе. */
      refs.tabs.addEventListener('keydown', function (e) {
        if (!e) return;
        var tab = closest(e.target, '.tab');
        if (!tab) return;
        var currentId = tab.getAttribute('data-zone');
        var index = zoneIndex(currentId);
        if (index < 0) return;
        var next = -1;
        if (e.key === 'ArrowRight' || e.key === 'Right') next = index + 1;
        else if (e.key === 'ArrowLeft' || e.key === 'Left') next = index - 1;
        else if (e.key === 'Home') next = 0;
        else if (e.key === 'End') next = ZONES.length - 1;
        if (next < 0) return;
        if (next >= ZONES.length) next = ZONES.length - 1;
        e.preventDefault();
        selectZone(ZONES[next].id);
        var target = refs.tabsByZone[ZONES[next].id];
        if (target && typeof target.focus === 'function') target.focus();
      });
    }

    /* --- Панели зон: выбор опции + призрачный предпросмотр --- */
    if (refs.partsHost) {
      refs.partsHost.addEventListener('click', function (e) {
        var opt = closest(e.target, '.opt');
        if (!opt) return;
        setOption(opt.getAttribute('data-part'), opt.getAttribute('data-option'));
      });

      /* mouseover/out вместо enter/leave: события всплывают, поэтому один
         делегированный слушатель покрывает все 16 строк. Выход считаем
         только если указатель действительно покинул ту же строку. */
      refs.partsHost.addEventListener('mouseover', function (e) {
        var target = ghostTargetFrom(e.target);
        if (!target) return;
        showGhosts(target.partId, target.optionKey);
      });

      refs.partsHost.addEventListener('mouseout', function (e) {
        if (!ghostPartId) return;
        /* Указатель остался внутри той же детали — призрак остаётся. */
        var to = e.relatedTarget;
        if (to) {
          var stillRow = closest(to, '.part');
          if (stillRow && stillRow.getAttribute('data-part') === ghostPartId) return;
        }
        clearGhosts();
      });

      /* Клавиатура: фокус на строке/кнопке — тот же предпросмотр. */
      refs.partsHost.addEventListener('focusin', function (e) {
        var target = ghostTargetFrom(e.target);
        if (!target) return;
        showGhosts(target.partId, target.optionKey);
      });

      refs.partsHost.addEventListener('focusout', function (e) {
        var to = e.relatedTarget;
        if (to && refs.partsHost.contains && refs.partsHost.contains(to)) return;
        clearGhosts();
      });
    }

    if (refs.resetBtn) {
      refs.resetBtn.addEventListener('click', function () {
        resetAll();
      });
    }

    if (refs.accordionToggle) {
      refs.accordionToggle.addEventListener('click', function () {
        var expanded = refs.accordionToggle.getAttribute('aria-expanded') === 'true';
        setAccordion(!expanded);
      });
    }

    /* Ресинхронизация аккордеона при смене вьюпорта: setAccordion читает
       matchMedia только в момент вызова, поэтому без этого слушателя
       сценарий «свернул панель на мобильном → повернул телефон» оставил бы
       hidden=true, тогда как CSS на десктопе панель уже показывает, а кнопка
       переключатель там display:none — восстановить состояние некому.
       Поддерживаются оба API media-query; при отсутствии matchMedia
       слушатель просто не ставится. */
    if (window.matchMedia) {
      var viewportMedia = window.matchMedia('(max-width: 900px)');
      if (viewportMedia) {
        var onViewportChange = function () { setAccordion(userWantsExpanded); };
        if (typeof viewportMedia.addEventListener === 'function') {
          viewportMedia.addEventListener('change', onViewportChange);
        } else if (typeof viewportMedia.addListener === 'function') {
          viewportMedia.addListener(onViewportChange);
        }
      }
    }
  }

  function zoneIndex(zoneId) {
    for (var i = 0; i < ZONES.length; i++) {
      if (ZONES[i].id === zoneId) return i;
    }
    return -1;
  }

  /* --------------------------------------------------------------------------
     init — script подключён с defer, но подстрахуемся на случай
     readyState === 'loading' (страховка для подключения без defer).
     -------------------------------------------------------------------------- */
  function init() {
    buildFormatters();
    buildUI();
    if (!document.body) return;
    bindEvents();
    setAccordion(userWantsExpanded);
    resetAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
