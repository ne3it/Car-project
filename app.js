/* ============================================================================
   Интерактивный конфигуратор автомобиля — логика интерфейса.
   Один IIFE, без модулей и внешних зависимостей (работает по file://).

   Порядок секций:
     MODELS      → заводские платформы и их ТТХ (единый источник правды)
     TABS        → 6 инженерных вкладок правой панели
     ZONE_TABS   → мост «зона SVG → вкладки панели»
     PartsDB     → 20 категорий запчастей с брендами, SKU и совместимостью
     CONFLICTS   → матрица инженерных ошибок (штрафы к надёжности и разгону)
     Market      → эмуляция живого API цен и наличия
     AppState    → единственное состояние + физический движок пересчёта
     buildUI → render → bindEvents → init

     Каждая котировка хранит не саму цену, а отклонение `drift` от базовой
     цены. Отклонение живёт в диапазоне [-DRIFT, +DRIFT] и на каждом тике
     случайно шагает, но с отражением от границ. Наивное умножение цены на
     случайный коэффициент давало случайное блуждание: за 200 тиков цена
     уходила на +43%, что противоречит «колебаниям в пределах ±2%».
     -------------------------------------------------------------------------- */

(function () {

  /* --------------------------------------------------------------------------
     MODELS — три платформы с заводскими ТТХ.
     basePrice в долларах (курс в ₽ приходит из Market.fxRate).
     ev — электрическая платформа: у неё нет ДВС, поэтому часть правил
        матрицы конфликтов (сцепление, поршни, турбина) к ней не применяется.
     tractionManaged — штатное удержание колёса на пробуксовке
        (у Tri-Motor EV оно есть, поэтому штраф за пробуксовку не применяется).
     -------------------------------------------------------------------------- */
  var MODELS = {
    vag: {
      id: 'vag',
      label: 'Volkswagen Golf R',
      platform: 'VAG MQB',
      hp: 320,
      nm: 420,
      kg: 1550,
      accel: 4.7,
      vmax: 250,
      basePrice: 45000,
      ev: false,
      tractionManaged: false
    },
    nissan: {
      id: 'nissan',
      label: 'Nissan GT-R R35',
      platform: 'VR38DETT',
      hp: 570,
      nm: 637,
      kg: 1750,
      accel: 3.5,
      vmax: 315,
      basePrice: 115000,
      ev: false,
      tractionManaged: false
    },
    tesla: {
      id: 'tesla',
      label: 'Tesla Model S Plaid',
      platform: 'Tri-Motor EV',
      hp: 1020,
      nm: 1420,
      kg: 2160,
      accel: 2.1,
      vmax: 322,
      basePrice: 90000,
      ev: true,
      tractionManaged: true
    }
  };

  var DEFAULT_MODEL = 'vag';

  /* --------------------------------------------------------------------------
     TABS — 6 чистых инженерных вкладок. Порядок фиксирован и совпадает
     с порядком, в котором категории объявлены в PartsDB.
     Вкладка без совместимых категорий для текущей модели не рендерится
     (у Tesla так скрываются ENGINE и FUEL & FIRE — там нет ДВС).
     -------------------------------------------------------------------------- */
  var TABS = [
    { id: 'engine', label: 'ENGINE' },
    { id: 'boost',  label: 'BOOST & COOLING' },
    { id: 'fuel',   label: 'FUEL & FIRE' },
    { id: 'drive',  label: 'DRIVE' },
    { id: 'chassis', label: 'CHASSIS' },
    { id: 'aero',   label: 'AERO & TIRES' }
  ];

  /* Мост «зона SVG → вкладки». Читается из data-tabs в index.html,
     этот объект — резервный источник для проверки целостности разметки. */
  var ZONE_TABS = {
    engine:     ['engine'],
    boost:      ['boost'],
    fuel:       ['fuel'],
    drive:      ['drive'],
    suspension: ['chassis'],
    brakes:     ['chassis'],
    wheels:     ['aero'],
    aero:       ['aero']
  };

  /* Порядок кнопок вариантов внутри карточки модуля. */
  var OPTION_ORDER = ['stock', 'sport', 'track'];

  /* --------------------------------------------------------------------------
     PartsDB — единственный источник правды по деталям.

     Формат категории:
       { label, tab, zone, compatibility: [modelId, ...],
         options: { stock|sport|track: option } }

     Формат опции:
       label   — подпись кнопки
       brand   — бренд (может быть объектом {modelId: 'бренд'} для разных платформ)
       sku     — заводской артикул (аналогично brand)
       price   — цена в USD на старте сессии (дальше её двигает Market)
       mods    — дельты 4 полосок METRICS
       dyno    — физика: hp/nm/mass — прирост к мощности, моменту и массе
       aero    — аэродинамика: drag (ΔCd), downforce (кг), vmax (Δкм/ч)
       stage   — ступень прошивки ECU (0 = сток)
       boostBar — прирост давления наддува, бар
       rare    — редкая гоночная позиция: её наличие живёт рынком
     -------------------------------------------------------------------------- */
  var PartsDB = {
    pistons: {
      label: 'Поршни и шатуны',
      tab: 'engine', zone: 'engine',
      compatibility: ['vag', 'nissan'],
      options: {
        stock: { label: 'Сток', brand: 'Заводской', sku: '06K 103 803 CD', price: 0,
                 mods: { speed: 0, handling: 0, braking: 0, reliability: 0 } },
        sport: { label: 'Спорт', brand: 'HKS', sku: 'HKS 06K-1041', price: 2400,
                 mods: { speed: 4, handling: 2, braking: 1, reliability: -3 },
                 dyno: { hp: 25, nm: 45, mass: 2 } },
        track: { label: 'Трек', brand: 'HKS', sku: 'HKS 06K-1041-FORGED', price: 5600, rare: true,
                 mods: { speed: 7, handling: 3, braking: 2, reliability: -8 },
                 dyno: { hp: 55, nm: 95, mass: 5 } }
      }
    },
    head: {
      label: 'ГБЦ и распредвалы',
      tab: 'engine', zone: 'engine',
      compatibility: ['vag', 'nissan'],
      options: {
        stock: { label: 'Сток', brand: 'Заводской', sku: '06K 129 071 AB', price: 0,
                 mods: { speed: 0, handling: 0, braking: 0, reliability: 0 } },
        sport: { label: 'Спорт', brand: 'HKS', sku: 'HKS 272-S300', price: 3900,
                 mods: { speed: 6, handling: 2, braking: 1, reliability: -4 },
                 dyno: { hp: 35, nm: 55, mass: 3 } },
        track: { label: 'Трек', brand: 'HKS', sku: 'HKS 274-S600', price: 8200, rare: true,
                 mods: { speed: 11, handling: 4, braking: 2, reliability: -10 },
                 dyno: { hp: 70, nm: 120, mass: 6 } }
      }
    },
    ecu: {
      label: 'Прошивка ECU',
      tab: 'engine', zone: 'engine',
      compatibility: ['vag', 'nissan'],
      options: {
        stock: { label: 'Сток', brand: 'Заводской', sku: '5Q0 907 309 B', price: 0,
                 mods: { speed: 0, handling: 0, braking: 0, reliability: 0 }, stage: 0 },
        sport: { label: 'Stage 2', brand: { vag: 'Unitronic', nissan: 'HP Bumblebee' },
                 sku: { vag: 'UDS-VAG S2', nissan: 'HB-R35 S2' }, price: 1400,
                 mods: { speed: 7, handling: 1, braking: 1, reliability: -5 },
                 dyno: { hp: 40, nm: 60, mass: 0 }, stage: 2 },
        track: { label: 'Stage 3', brand: { vag: 'Unitronic', nissan: 'HP Bumblebee' },
                 sku: { vag: 'UDS-VAG S3', nissan: 'HB-R35 S3' }, price: 2900,
                 mods: { speed: 14, handling: 1, braking: 1, reliability: -12 },
                 dyno: { hp: 85, nm: 140, mass: 0 }, stage: 3 }
      }
    },
    oil: {
      label: 'Масляная система',
      tab: 'engine', zone: 'engine',
      compatibility: ['vag', 'nissan'],
      options: {
        stock: { label: 'Сток', brand: 'Заводское', sku: '0B0 115 562', price: 0,
                 mods: { speed: 0, handling: 0, braking: 0, reliability: 0 } },
        sport: { label: 'Спорт', brand: 'HKS', sku: 'HKS 200-AR1', price: 480,
                 mods: { speed: 2, handling: 0, braking: 0, reliability: 2 },
                 dyno: { hp: 10, nm: 12, mass: 1 } },
        track: { label: 'Трек', brand: 'HKS', sku: 'HKS 200-AR2', price: 1150,
                 mods: { speed: 3, handling: 0, braking: 0, reliability: -1 },
                 dyno: { hp: 18, nm: 22, mass: 2 } }
      }
    },

    turbo: {
      label: 'Турбина',
      tab: 'boost', zone: 'boost',
      compatibility: ['vag', 'nissan'],
      options: {
        stock: { label: 'Сток', brand: 'Заводская', sku: '06K 145 722 C', price: 0,
                 mods: { speed: 0, handling: 0, braking: 0, reliability: 0 } },
        sport: { label: 'Спорт', brand: 'Garrett', sku: 'GTX2871R', price: 3200,
                 mods: { speed: 9, handling: 1, braking: 0, reliability: -6 },
                 dyno: { hp: 55, nm: 130, mass: -4 }, boostBar: 0.6 },
        track: { label: 'Big Garrett', brand: 'Garrett', sku: 'GTS4271R', price: 7400, rare: true,
                 mods: { speed: 16, handling: 1, braking: 0, reliability: -14 },
                 dyno: { hp: 120, nm: 240, mass: -6 }, boostBar: 1.1, bigTurbo: true }
      }
    },
    intercooler: {
      label: 'Интеркулер',
      tab: 'boost', zone: 'boost',
      compatibility: ['vag', 'nissan'],
      options: {
        stock: { label: 'Сток', brand: 'Заводской', sku: '5Q0 959 430', price: 0,
                 mods: { speed: 0, handling: 0, braking: 0, reliability: 0 } },
        sport: { label: 'Спорт', brand: 'Eventuri', sku: 'EVT-IC-TSI', price: 1350,
                 mods: { speed: 3, handling: 0, braking: 0, reliability: 3 },
                 dyno: { hp: 12, nm: 5, mass: 2 } },
        track: { label: 'Трек', brand: 'Eventuri', sku: 'EVT-IC-TTE', price: 2750,
                 mods: { speed: 5, handling: 0, braking: 1, reliability: 5 },
                 dyno: { hp: 28, nm: 10, mass: 4 } }
      }
    },
    cooling: {
      label: 'Радиаторы и охлаждение',
      tab: 'boost', zone: 'boost',
      compatibility: ['vag', 'nissan'],
      options: {
        stock: { label: 'Сток', brand: 'Заводские', sku: '1K0 121 111', price: 0,
                 mods: { speed: 0, handling: 0, braking: 0, reliability: 0 } },
        sport: { label: 'Спорт', brand: 'Eventuri', sku: 'EVT-RAD-V2', price: 1650,
                 mods: { speed: 2, handling: 0, braking: 0, reliability: 4 },
                 dyno: { hp: 8, nm: 10, mass: 3 } },
        track: { label: 'Трек', brand: 'Eventuri', sku: 'EVT-RAD-CF', price: 3400, rare: true,
                 mods: { speed: 3, handling: 0, braking: 0, reliability: 6 },
                 dyno: { hp: 15, nm: 18, mass: 5 } }
      }
    },
    ev_cooling: {
      label: 'Термоменеджмент инверторов и крио-чиллер батарейного блока',
      tab: 'boost', zone: 'boost',
      compatibility: ['tesla'],
      options: {
        stock: { label: 'Сток', brand: 'Заводской', sku: 'TE-THERM-BASE', price: 0,
                 mods: { speed: 0, handling: 0, braking: 0, reliability: 0 } },
        sport: { label: 'Спорт', brand: 'Unplugged Performance', sku: 'UP-CHILLER-V1', price: 3900,
                 mods: { speed: 4, handling: 0, braking: 1, reliability: -3 },
                 dyno: { hp: 35, nm: 30, mass: 8 } },
        track: { label: 'Трек', brand: 'Unplugged Performance', sku: 'UP-CHILLER-RX', price: 8900, rare: true,
                 mods: { speed: 8, handling: 0, braking: 2, reliability: -7 },
                 dyno: { hp: 70, nm: 65, mass: 14 } }
      }
    },

    injectors: {
      label: 'Топливные форсунки и насос',
      tab: 'fuel', zone: 'fuel',
      compatibility: ['vag', 'nissan'],
      options: {
        stock: { label: 'Сток', brand: 'Заводские', sku: '06K 201 400', price: 0,
                 mods: { speed: 0, handling: 0, braking: 0, reliability: 0 } },
        sport: { label: 'Спорт', brand: 'Bosch Motorsport', sku: 'BSM 0 135 5 916', price: 1900,
                 mods: { speed: 4, handling: 0, braking: 0, reliability: -4 },
                 dyno: { hp: 25, nm: 35, mass: 2 } },
        track: { label: 'Трек', brand: 'Bosch Motorsport', sku: 'BSM 0 135 5 918', price: 4200, rare: true,
                 mods: { speed: 8, handling: 0, braking: 0, reliability: -9 },
                 dyno: { hp: 55, nm: 80, mass: 3 } }
      }
    },
    spark: {
      label: 'Свечи зажигания',
      tab: 'fuel', zone: 'fuel',
      compatibility: ['vag', 'nissan'],
      options: {
        stock: { label: 'Сток', brand: 'Заводские', sku: '06H 905 611', price: 0,
                 mods: { speed: 0, handling: 0, braking: 0, reliability: 0 } },
        sport: { label: 'Иридий', brand: 'NGK', sku: 'NGK ILZKR7B11', price: 240,
                 mods: { speed: 2, handling: 0, braking: 0, reliability: 2 },
                 dyno: { hp: 8, nm: 10, mass: 0 } },
        track: { label: 'Тонкий зазор', brand: 'NGK', sku: 'NGK LKILZKR7B11', price: 390,
                 mods: { speed: 3, handling: 0, braking: 0, reliability: 1 },
                 dyno: { hp: 15, nm: 20, mass: 0 } }
      }
    },
    exhaust: {
      label: 'Выхлопная система',
      tab: 'fuel', zone: 'fuel',
      compatibility: ['vag', 'nissan'],
      options: {
        stock: { label: 'Сток', brand: 'Заводская', sku: '06K 025 201', price: 0,
                 mods: { speed: 0, handling: 0, braking: 0, reliability: 0 } },
        sport: { label: 'Спорт', brand: 'Eventuri', sku: 'EVT-TSI-4', price: 2100,
                 mods: { speed: 3, handling: 0, braking: 0, reliability: -2 },
                 dyno: { hp: 18, nm: 35, mass: -6 } },
        track: { label: 'Трек', brand: 'Akrapovič', sku: 'AK-TSI-TIT-80', price: 5200, rare: true,
                 mods: { speed: 5, handling: 0, braking: 0, reliability: -5 },
                 dyno: { hp: 35, nm: 65, mass: -10 } }
      }
    },

    clutch: {
      label: 'Сцепление',
      tab: 'drive', zone: 'drive',
      compatibility: ['vag', 'nissan'],
      options: {
        stock: { label: 'Сток', brand: 'Заводское', sku: '06K 141 015', price: 0,
                 mods: { speed: 0, handling: 0, braking: 0, reliability: 0 } },
        sport: { label: 'Спорт', brand: 'Sachs', sku: 'Sachs 315 100 2 001', price: 1550,
                 mods: { speed: 2, handling: 2, braking: 1, reliability: -2 },
                 dyno: { hp: 5, nm: 0, mass: 2 } },
        track: { label: 'Трек', brand: 'Sachs', sku: 'Sachs 315 100 4 001', price: 3400,
                 mods: { speed: 3, handling: 3, braking: 2, reliability: -4 },
                 dyno: { hp: 10, nm: 0, mass: 4 } }
      }
    },
    driveshaft: {
      label: 'Приводные валы и оси',
      tab: 'drive', zone: 'drive',
      compatibility: ['vag', 'nissan'],
      options: {
        stock: { label: 'Сток', brand: 'Заводские', sku: '06K 311 141', price: 0,
                 mods: { speed: 0, handling: 0, braking: 0, reliability: 0 } },
        sport: { label: 'Спорт', brand: 'Driveshaft Plus', sku: 'DSP-118-G35', price: 1850,
                 mods: { speed: 2, handling: 1, braking: 0, reliability: -2 },
                 dyno: { hp: 5, nm: 0, mass: 2 } },
        track: { label: 'Трек', brand: 'Driveshaft Plus', sku: 'DSP-214-CFR', price: 4100, rare: true,
                 mods: { speed: 4, handling: 2, braking: 0, reliability: -5 },
                 dyno: { hp: 12, nm: 0, mass: 5 } }
      }
    },
    diff: {
      label: 'Дифференциал',
      tab: 'drive', zone: 'drive',
      compatibility: ['vag', 'nissan'],
      options: {
        stock: { label: 'Открытый', brand: 'Заводской', sku: '06K 199 555', price: 0,
                 mods: { speed: 0, handling: 0, braking: 0, reliability: 0 } },
        sport: { label: 'LSD', brand: 'Quaife', sku: 'Quaife QTH-GB', price: 1700,
                 mods: { speed: 2, handling: 6, braking: 1, reliability: -2 },
                 dyno: { hp: 3, nm: 0, mass: -1 } },
        track: { label: 'Сварной', brand: 'Quaife', sku: 'Quaife ATB-GB', price: 3600, rare: true,
                 mods: { speed: 3, handling: 9, braking: 2, reliability: -5 },
                 dyno: { hp: 8, nm: 0, mass: 2 } }
      }
    },
    transmission: {
      label: 'КПП и ряд передач',
      tab: 'drive', zone: 'drive',
      compatibility: ['vag', 'nissan'],
      options: {
        stock: { label: 'Сток', brand: 'Заводская', sku: '0AM 927 100', price: 0,
                 mods: { speed: 0, handling: 0, braking: 0, reliability: 0 } },
        sport: { label: 'Короткий ряд', brand: 'Xtrac', sku: 'XTR-TSX-6L', price: 2600,
                 mods: { speed: 4, handling: 1, braking: 0, reliability: -3 },
                 dyno: { hp: 6, nm: 0, mass: -2 } },
        track: { label: 'Трек', brand: 'Tremec', sku: 'TRM-TR6060-R', price: 5800, rare: true,
                 mods: { speed: 7, handling: 1, braking: 0, reliability: -7 },
                 dyno: { hp: 15, nm: 0, mass: 5 } }
      }
    },

    suspension: {
      label: 'Стойки и подвеска',
      tab: 'chassis', zone: 'suspension',
      compatibility: ['vag', 'nissan', 'tesla'],
      options: {
        stock: { label: 'Сток', brand: 'Заводская', sku: '06K 413 313', price: 0,
                 mods: { speed: 0, handling: 0, braking: 0, reliability: 0 } },
        sport: { label: 'KW V2', brand: 'KW Automotive', sku: 'KW 35220075', price: 3400,
                 mods: { speed: 2, handling: 13, braking: 8, reliability: -3 },
                 dyno: { hp: 0, nm: 0, mass: -8 } },
        track: { label: 'KW V3', brand: 'KW Automotive', sku: 'KW 35220076', price: 7200, rare: true,
                 mods: { speed: 4, handling: 22, braking: 14, reliability: -6 },
                 dyno: { hp: 0, nm: 0, mass: -12 } }
      }
    },
    bushings: {
      label: 'Сайлентблоки и втулки',
      tab: 'chassis', zone: 'suspension',
      compatibility: ['vag', 'nissan', 'tesla'],
      options: {
        stock: { label: 'Сток', brand: 'Заводские', sku: '8K0 505 541', price: 0,
                 mods: { speed: 0, handling: 0, braking: 0, reliability: 0 } },
        sport: { label: 'Полиуретан', brand: 'Powerflex', sku: 'PF08-1002', price: 540,
                 mods: { speed: 1, handling: 7, braking: 2, reliability: -2 },
                 dyno: { hp: 0, nm: 0, mass: 1 } },
        track: { label: 'Трек', brand: 'Powerflex', sku: 'PF08-1201', price: 1180,
                 mods: { speed: 1, handling: 11, braking: 3, reliability: -4 },
                 dyno: { hp: 0, nm: 0, mass: 2 } }
      }
    },
    brakes: {
      label: 'Тормоза',
      tab: 'chassis', zone: 'brakes',
      compatibility: ['vag', 'nissan', 'tesla'],
      options: {
        stock: { label: 'Сток', brand: 'Заводские', sku: '5Q0 615 301', price: 0,
                 mods: { speed: 0, handling: 0, braking: 0, reliability: 0 } },
        sport: { label: 'Спорт', brand: 'Brembo', sku: 'BR-1N3-41015', price: 2600,
                 mods: { speed: 1, handling: 5, braking: 16, reliability: -2 },
                 dyno: { hp: 0, nm: 0, mass: -1 } },
        track: { label: 'Трек', brand: 'Brembo', sku: 'BR-1N3-41221', price: 5400, rare: true,
                 mods: { speed: 2, handling: 9, braking: 24, reliability: -5 },
                 dyno: { hp: 0, nm: 0, mass: -3 } }
      }
    },

    aero: {
      label: 'Аэродинамика и антикрыло',
      tab: 'aero', zone: 'aero',
      compatibility: ['vag', 'nissan', 'tesla'],
      options: {
        stock: { label: 'Сток', brand: 'Штатный', sku: '5Q0 807 435', price: 0,
                 mods: { speed: 0, handling: 0, braking: 0, reliability: 0 } },
        sport: { label: 'Спорт', brand: 'Eventuri', sku: 'EVT-SPLIT-2', price: 2200,
                 mods: { speed: 4, handling: 5, braking: 6, reliability: -1 },
                 dyno: { hp: 0, nm: 0, mass: 4 },
                 aero: { drag: 0.01, downforce: 40, vmax: -4 } },
        track: { label: 'Карбон', brand: 'Eventuri', sku: 'EVT-CARBON-3', price: 6400, rare: true,
                 mods: { speed: 6, handling: 9, braking: 10, reliability: -3 },
                 dyno: { hp: 0, nm: 0, mass: 6 },
                 aero: { drag: 0.03, downforce: 120, vmax: -10 } }
      }
    },
    tires: {
      label: 'Шины',
      tab: 'aero', zone: 'wheels',
      compatibility: ['vag', 'nissan', 'tesla'],
      options: {
        stock: { label: 'Дорожные', brand: 'Заводские', sku: '225/40 R18', price: 0,
                 mods: { speed: 0, handling: 0, braking: 0, reliability: 0 } },
        sport: { label: 'Полуспорт', brand: 'Toyo', sku: 'TY-Proxes-CF2', price: 1600,
                 mods: { speed: 5, handling: 7, braking: 5, reliability: -1 },
                 dyno: { hp: 0, nm: 0, mass: 4 } },
        track: { label: 'Слик', brand: 'Toyo', sku: 'TY-Proxes-R888', price: 3400, rare: true,
                 mods: { speed: 9, handling: 12, braking: 9, reliability: -3 },
                 dyno: { hp: 0, nm: 0, mass: 2 } }
      }
    }
  };

  /* --------------------------------------------------------------------------
     CONFLICTS — матрица инженерных ошибок.
     Каждое правило получает сводку состояния сборки (buildProfile) и возвращает
     предупреждение со штрафом к надёжности и, где нужно, к разгону.
     Уровни: error — риск разрушения, warn — потеря характеристик.

     Правила с `!p.isEv` относятся только к ДВС: у Tri-Motor EV нет поршней,
     турбины, форсунок и сцепления, поэтому они к нему не применяются.
     Правило по тормозам общее для всех платформ, но срабатывает именно на
     РОСТ мощности относительно заводской (hp > 400 и hp > заводской),
     иначе стоковый Plaid на 1020 л.с. ругался бы на пустой конфиг.

     Штраф к надёжности дублируется в полоске reliability, штраф accel
     добавляется к динамически посчитанному 0–100.
     -------------------------------------------------------------------------- */
  var CONFLICTS = [
    {
      id: 'chip-on-stock-pistons',
      level: 'error',
      reliability: -8,
      test: function (p) {
        return !p.isEv && (p.stage >= 2 || p.boostBar > 0) && p.pistonsStock;
      },
      text: 'Чип-тюнинг или рост надува на стоковых поршнях — пиковые давления упираются в предел прочности детали.'
    },
    {
      id: 'big-turbo-no-intercooler',
      level: 'error',
      reliability: -10,
      accel: 0.4,
      test: function (p) {
        return !p.isEv && p.bigTurbo && !p.intercoolerUpgraded;
      },
      text: 'Большая турбина без интеркулера: перегрев заряда, детонация и падение мощности на верхах.'
    },
    {
      id: 'stage3-stock-fuel',
      level: 'error',
      reliability: -12,
      accel: 0.3,
      test: function (p) {
        return !p.isEv && p.stage >= 3 && !p.fuelUpgraded;
      },
      text: 'Stage 3 на стоковых форсунках и насосе: бедная смесь, прогар поршня под нагрузкой.'
    },
    {
      id: 'torque-stock-clutch',
      level: 'warn',
      reliability: -7,
      test: function (p) {
        return !p.isEv && p.nm > 500 && p.clutchStock;
      },
      text: 'Момент выше 500 Нм на стоковом сцеплении — срыв диска и неравномерный износ.'
    },
    {
      id: 'torque-stock-axles',
      level: 'warn',
      reliability: -6,
      test: function (p) {
        return !p.isEv && p.nm > 500 && p.axlesStock;
      },
      text: 'Момент выше 500 Нм на стоковых приводах: риск разрушения осей под нагрузкой.'
    },
    {
      id: 'coilover-rubber-bushings',
      level: 'error',
      reliability: -6,
      test: function (p) {
        return p.stiffCoilover && p.rubberBushings;
      },
      text: 'Жёсткие койловеры на заводских резиновых сайлентблоках — работают на разрыв, разрушение ходовой.'
    },
    {
      id: 'power-over-stock-brakes',
      level: 'error',
      reliability: -9,
      test: function (p) {
        /* Порог 400 л.с. и факт роста над заводом: стоковые 1020 л.с.
           Plaid не должны считаться «превышением». */
        return p.hp > 400 && p.hp > p.baseHp && p.brakesStock;
      },
      text: 'Мощность выше 400 л.с. на стоковых тормозах: перегрев и терморазрушение дисков.'
    },
    {
      id: 'ev-stock-thermal',
      level: 'warn',
      reliability: -5,
      test: function (p) {
        return p.isEv && p.evThermalStock && p.hp > p.baseHp;
      },
      text: 'Стоковый термоменеджмент не вывозит повторные полные разгоны: деградация батарейного блока.'
    }
  ];

  /* --------------------------------------------------------------------------
     METRICS — оси характеристик. Порядок фиксирован и совпадает с порядком
     ключей mods в PartsDB.
     -------------------------------------------------------------------------- */
  var METRICS = [
    { id: 'speed',       label: 'Скорость' },
    { id: 'handling',    label: 'Управляемость' },
    { id: 'braking',     label: 'Торможение' },
    { id: 'reliability', label: 'Надёжность' }
  ];

  /* Параметры пересчёта разгона. Экспонента 0.62 — компромисс между
     линейной зависимостью от удельной мощности и реальными потерями
     на сцеплении и в шинах при большом запасе крутящего момента. */
  var ACCEL_EXPONENT = 0.62;
  var ACCEL_MIN = 1.6;
  var ACCEL_MAX = 30;
  var TRACTION_PENALTY = 0.5;   /* +с за пробуксовку колёс */
  var TRACTION_NM_LIMIT = 500;  /* порог момента, выше которого ловим пробуксовку */

  /* --------------------------------------------------------------------------
     Market — эмуляция живого API цен и наличия.
     Каждая нестоковая позиция получает котировку, которая колеблется в пределах
     ±2% вокруг базовой цены (колебание курса), изредка попадает под акцию −15%
     на целую категорию, а редкие гоночные позиции могут уйти в «нет в наличии».

     Котировка хранится как ОТКЛОНЕНИЕ от базы (drift), а не как сама цена.
     Каждый тик делает случайный шаг и отражает его от границ ±DRIFT —
     так цена действительно «дрожит» в пределах ±2%, а не уплывает
     случайным блужданием (за 200 тиков наивный вариант уходил на +43%).
     -------------------------------------------------------------------------- */
  var Market = {
    INTERVAL_MS: 4500,        /* 4–5 с между парсингами рынка */
    DRIFT: 0.02,              /* ±2% от базовой цены */
    STEP: 0.006,              /* величина одного шага внутри диапазона */
    SALE_RATE: 0.15,          /* размер акции */
    SALE_CATEGORY_RATE: 0.22, /* вероятность запуска акции за тик */
    SALE_TICKS: 2,            /* сколько тиков держится акция */
    RARE_STOCK_RATE: 0.3,     /* вероятность смены наличия у rare-позиции */
    FX_BASE: 92.4,            /* базовый курс USD → ₽ */
    FX_DRIFT: 0.015,
    tick: 0,
    fxDrift: 0,
    fxRate: 92.4,
    quotes: {},               /* catKey → optKey → { base, drift, inStock, rare } */
    sale: null,               /* { cat, ticksLeft } */
    timer: null
  };

  /* Базис котировок: сток всегда $0 и всегда в наличии, остальное получает
     стартовую цену из PartsDB и флаг редкости. */
  function buildMarket() {
    Market.quotes = {};
    Object.keys(PartsDB).forEach(function (catKey) {
      var options = PartsDB[catKey].options;
      Market.quotes[catKey] = {};
      OPTION_ORDER.forEach(function (optKey) {
        var option = options[optKey];
        if (!option) return;
        Market.quotes[catKey][optKey] = {
          base: option.price,
          drift: 0,
          inStock: true,
          rare: !!option.rare
        };
      });
    });
  }

  /* Случайный шаг с отражением от границ диапазона. */
  function stepDrift(current) {
    var next = current + randomBetween(-Market.STEP, Market.STEP);
    if (next > Market.DRIFT) next = Market.DRIFT - (next - Market.DRIFT);
    if (next < -Market.DRIFT) next = -Market.DRIFT - (next + Market.DRIFT);
    /* Двойное отражение на случай выхода за обе границы сразу. */
    if (next > Market.DRIFT || next < -Market.DRIFT) {
      next = clampDrift(next);
    }
    return round4(next);
  }

  function clampDrift(value) {
    if (value > Market.DRIFT) return Market.DRIFT;
    if (value < -Market.DRIFT) return -Market.DRIFT;
    return value;
  }

  /* Котировка с учётом акции. Сток не участвует в акциях — его цена всегда 0. */
  function quoteOf(catKey, optKey) {
    var byCategory = Market.quotes[catKey];
    if (!byCategory) return null;
    var quote = byCategory[optKey];
    if (!quote) return null;
    var price = quote.base * (1 + quote.drift);
    var onSale = optKey !== 'stock' && Market.sale && Market.sale.cat === catKey;
    if (onSale) price = price * (1 - Market.SALE_RATE);
    return {
      price: price,
      base: quote.base,
      inStock: quote.inStock,
      rare: quote.rare,
      onSale: onSale
    };
  }

  function randomBetween(min, max) {
    return min + Math.random() * (max - min);
  }

  function pickRandomKey(keys) {
    return keys[Math.floor(Math.random() * keys.length)];
  }

  /* Один «парсинг рынка»: шаг колебания цен, протухание акции, новые акции,
     смена наличия у редких позиций и колебание курса. */
  function tickMarket() {
    Market.tick += 1;
    var catKeys = Object.keys(Market.quotes);
    var flashDrops = [];

    catKeys.forEach(function (catKey) {
      var byOption = Market.quotes[catKey];
      Object.keys(byOption).forEach(function (optKey) {
        var quote = byOption[optKey];
        /* Сток — неизменная точка отсчёта цены. */
        if (optKey === 'stock') return;

        var before = quote.base * (1 + quote.drift);
        quote.drift = stepDrift(quote.drift);
        if (quote.base * (1 + quote.drift) < before) flashDrops.push(catKey + ':' + optKey);

        if (quote.rare && Math.random() < Market.RARE_STOCK_RATE) {
          quote.inStock = !quote.inStock;
        }
      });
    });

    /* Акция живёт SALE_TICKS тиков, потом снимается. */
    if (Market.sale) {
      Market.sale.ticksLeft -= 1;
      if (Market.sale.ticksLeft <= 0) Market.sale = null;
    }
    if (!Market.sale && Math.random() < Market.SALE_CATEGORY_RATE) {
      /* Акция только на нестоковые категории — иначе она бессмысленна. */
      var candidates = catKeys.filter(function (catKey) {
        return Object.keys(Market.quotes[catKey]).some(function (optKey) {
          return optKey !== 'stock';
        });
      });
      if (candidates.length) {
        Market.sale = { cat: pickRandomKey(candidates), ticksLeft: Market.SALE_TICKS };
      }
    }

    /* Курс тоже колеблется вокруг базового, а не уплывает. */
    Market.fxDrift = stepDrift(Market.fxDrift);
    Market.fxRate = round2(Market.FX_BASE * (1 + Market.fxDrift));

    return flashDrops;
  }

  function round2(value) {
    return Math.round(value * 100) / 100;
  }

  function round4(value) {
    return Math.round(value * 10000) / 10000;
  }

  function startMarket() {
    if (Market.timer) return;
    Market.timer = setInterval(function () {
      var drops = tickMarket();
      render({ flashDrops: drops });
    }, Market.INTERVAL_MS);
  }

  /* --------------------------------------------------------------------------
     AppState — единственное состояние. render() читает только его.
     -------------------------------------------------------------------------- */
  var AppState = {
    currentModelId: DEFAULT_MODEL,
    config: {},
    activeTab: TABS[0].id,
    activeZone: null,
    BASE: 50,
    MIN: 0,
    MAX: 100,

    model: function () {
      return MODELS[this.currentModelId] || MODELS[DEFAULT_MODEL];
    },

    /* Категория доступна текущей модели? */
    isAvailable: function (catKey) {
      var part = PartsDB[catKey];
      if (!part) return false;
      return part.compatibility.indexOf(this.currentModelId) !== -1;
    },

    /* Вкладка непуста для текущей модели? (для Tesla это скрывает ДВС) */
    isTabAvailable: function (tabId) {
      var keys = Object.keys(PartsDB);
      for (var i = 0; i < keys.length; i += 1) {
        if (PartsDB[keys[i]].tab === tabId && this.isAvailable(keys[i])) return true;
      }
      return false;
    },

    /* Доступные вкладки в фиксированном порядке TABS. */
    availableTabs: function () {
      var self = this;
      return TABS.filter(function (tab) { return self.isTabAvailable(tab.id); });
    },

    /* Сборка с нуля: все категории — в 'stock'. Категории, несовместимые
       с моделью, не хранятся вовсе, чтобы они не всплыли в расчётах. */
    defaults: function () {
      var config = {};
      var self = this;
      Object.keys(PartsDB).forEach(function (catKey) {
        if (self.isAvailable(catKey)) config[catKey] = 'stock';
      });
      return config;
    },

    /* Сводка сборки: сырые дельты запчастей + производные признаки,
       на которые ссылается матрица CONFLICTS. */
    buildProfile: function () {
      var model = this.model();
      var p = {
        hp: model.hp,
        nm: model.nm,
        mass: model.kg,
        vmax: model.vmax,
        baseHp: model.hp,
        downforce: 0,
        stage: 0,
        boostBar: 0,
        bigTurbo: false,
        isEv: !!model.ev,
        pistonsStock: true,
        intercoolerUpgraded: false,
        fuelUpgraded: false,
        clutchStock: true,
        axlesStock: true,
        stiffCoilover: false,
        rubberBushings: true,
        brakesStock: true,
        evThermalStock: true
      };

      var self = this;
      Object.keys(this.config).forEach(function (catKey) {
        var part = PartsDB[catKey];
        if (!part) return;
        var optKey = self.config[catKey];
        var option = part.options[optKey];
        if (!option) return;

        var dyno = option.dyno;
        if (dyno) {
          p.hp += dyno.hp || 0;
          p.nm += dyno.nm || 0;
          p.mass += dyno.mass || 0;
        }
        var aero = option.aero;
        if (aero) {
          p.downforce += aero.downforce || 0;
          p.vmax += aero.vmax || 0;
        }
        if (typeof option.stage === 'number' && option.stage > p.stage) p.stage = option.stage;
        if (option.boostBar) {
          p.boostBar = Math.max(p.boostBar, option.boostBar);
        }
        if (option.bigTurbo) p.bigTurbo = true;
      });

      /* Признаки «остался стоковый узел» выводятся из выбранных ключей. */
      p.pistonsStock = this.config.pistons === 'stock';
      p.intercoolerUpgraded = this.config.intercooler !== undefined && this.config.intercooler !== 'stock';
      p.fuelUpgraded = this.config.injectors !== undefined && this.config.injectors !== 'stock';
      p.clutchStock = this.config.clutch === undefined || this.config.clutch === 'stock';
      p.axlesStock = this.config.driveshaft === undefined || this.config.driveshaft === 'stock';
      p.stiffCoilover = this.config.suspension !== undefined && this.config.suspension !== 'stock';
      p.rubberBushings = this.config.bushings === undefined || this.config.bushings === 'stock';
      p.brakesStock = this.config.brakes === undefined || this.config.brakes === 'stock';
      p.evThermalStock = this.config.ev_cooling === undefined || this.config.ev_cooling === 'stock';

      return p;
    },

    /* Физический движок: динамический 0–100 от удельной мощности,
       штраф за пробуксовку, поправки конфликтов и аэродинамика.
       Абсолютные дельты pow/accel конфликтов конвертируются в изменения
       удельной мощности, поэтому попадают в ту же формулу, а не в «+с». */
    computePhysics: function () {
      var model = this.model();
      var p = this.buildProfile();
      var issues = evaluateConflicts(p);

      var accelPenalty = 0;
      var reliabilityPenalty = 0;
      var powerDelta = 0;
      var handlingPenalty = 0;
      var brakingPenalty = 0;

      issues.forEach(function (issue) {
        reliabilityPenalty += issue.reliability || 0;
        accelPenalty += issue.accel || 0;
        powerDelta += issue.hp || 0;
        handlingPenalty += issue.handling || 0;
        brakingPenalty += issue.braking || 0;
      });

      var hp = Math.max(50, p.hp + powerDelta);
      var mass = Math.max(800, p.mass);
      var baseSp = model.hp / model.kg;
      var sp = hp / mass;

      /* Заводской разгон соответствует стоковой удельной мощности. */
      var accel = model.accel * Math.pow(baseSp / sp, ACCEL_EXPONENT);

      /* Пробуксовка: момент выше 500 Нм на дорожных шинах или с открытым
         дифференциалом. Автомобили с штатным удержанием traction
         (Tri-Motor) от этого штрафа свободны. */
      var roadTires = this.config.tires === undefined || this.config.tires === 'stock';
      var openDiff = this.config.diff === undefined || this.config.diff === 'stock';
      var wheelSpin = !model.tractionManaged && p.nm > TRACTION_NM_LIMIT && (roadTires || openDiff);
      if (wheelSpin) accelPenalty += TRACTION_PENALTY;

      /* Прижимная сила помогает разгону, но карбон добавляет лобовое
         сопротивление — это уже учтено в vmax через aero.vmax. */
      accel -= Math.min(0.25, p.downforce * 0.0022);

      accel = Math.max(ACCEL_MIN, Math.min(ACCEL_MAX, accel + accelPenalty));
      var vmax = Math.max(120, Math.min(400, p.vmax));

      return {
        hp: Math.round(hp),
        nm: Math.round(p.nm),
        mass: Math.round(mass),
        sp: Math.round(sp * 1000) / 1000,
        accel: Math.round(accel * 10) / 10,
        vmax: Math.round(vmax),
        downforce: Math.round(p.downforce),
        wheelSpin: wheelSpin,
        issues: issues,
        penalties: {
          reliability: reliabilityPenalty,
          handling: handlingPenalty,
          braking: brakingPenalty
        }
      };
    },

    /* Полосы METRICS: BASE + дельты выбранных опций + штрафы конфликтов,
       затем clamp(MIN, MAX) и округление. */
    computeStats: function (physics) {
      var stats = {};
      var self = this;
      METRICS.forEach(function (metric) {
        var sum = self.BASE;
        Object.keys(self.config).forEach(function (catKey) {
          var part = PartsDB[catKey];
          if (!part || !part.options) return;
          var option = part.options[self.config[catKey]];
          if (!option || !option.mods) return;
          var delta = option.mods[metric.id];
          if (typeof delta === 'number' && isFinite(delta)) sum += delta;
        });
        if (metric.id === 'reliability') sum += physics.penalties.reliability;
        if (metric.id === 'handling') sum += physics.penalties.handling;
        if (metric.id === 'braking') sum += physics.penalties.braking;
        sum = Math.max(self.MIN, Math.min(self.MAX, sum));
        stats[metric.id] = Math.round(sum);
      });
      return stats;
    },

    /* Заводская цена модели + рыночные котировки выбранных позиций. */
    computePrice: function () {
      var total = this.model().basePrice;
      var self = this;
      Object.keys(this.config).forEach(function (catKey) {
        var quote = quoteOf(catKey, self.config[catKey]);
        if (quote && isFinite(quote.price)) total += quote.price;
      });
      return Math.round(total);
    },

    /* Смена варианта. Отказ, если позиции нет на складе или она закрыта
       по совместимости с текущей моделью. */
    set: function (catKey, optKey) {
      var part = PartsDB[catKey];
      if (!part || !part.options || !part.options[optKey]) return;
      if (!this.isAvailable(catKey)) return;
      var quote = quoteOf(catKey, optKey);
      if (quote && !quote.inStock) return;
      this.config[catKey] = optKey;
      this.activeZone = part.zone;
      this.activeTab = part.tab;
      render();
    },

    /* Смена платформы: несовместимые запчасти сбрасываются в 'stock',
       активная вкладка остаётся валидной для новой модели.
       Порядок важен: currentModelId переключается ПЕРВЫМ, иначе prune
       проверял бы совместимость ещё со старой платформой и оставил
       ледяные детали ICE в конфиге EV. */
    setModel: function (modelId) {
      if (!MODELS[modelId] || modelId === this.currentModelId) return;
      var self = this;
      this.currentModelId = modelId;
      Object.keys(this.config).forEach(function (catKey) {
        if (!self.isAvailable(catKey)) delete self.config[catKey];
      });
      var defaults = this.defaults();
      Object.keys(defaults).forEach(function (catKey) {
        if (self.config[catKey] === undefined) self.config[catKey] = defaults[catKey];
      });
      if (!this.isTabAvailable(this.activeTab)) {
        this.activeTab = this.availableTabs()[0].id;
      }
      this.activeZone = null;
      render();
    },

    /* Клик по зоне схемы: открывает только связанные с ней вкладки.
       Зона, чьи вкладки недоступны текущей модели, просто игнорируется. */
    selectZone: function (zoneId) {
      if (!ZONE_TABS[zoneId]) return;
      var self = this;
      var target = ZONE_TABS[zoneId].filter(function (tabId) {
        return self.isTabAvailable(tabId);
      })[0];
      if (!target) return;
      this.activeZone = zoneId;
      this.activeTab = target;
      render();
    },

    /* Только подсветка зоны или null (гасит все подсветки). */
    select: function (zoneId) {
      if (zoneId !== null && !ZONE_TABS[zoneId]) return;
      this.activeZone = zoneId;
      render();
    },

    reset: function () {
      this.config = this.defaults();
      this.activeZone = null;
      if (!this.isTabAvailable(this.activeTab)) {
        this.activeTab = this.availableTabs()[0].id;
      }
      render();
    }
  };

  /* --------------------------------------------------------------------------
     evaluateConflicts — прогон матрицы CONFLICTS по профилю сборки.
     -------------------------------------------------------------------------- */
  function evaluateConflicts(profile) {
    var issues = [];
    CONFLICTS.forEach(function (rule) {
      var triggered = false;
      try {
        triggered = !!rule.test(profile);
      } catch (e) {
        triggered = false;
      }
      if (!triggered) return;
      issues.push({
        id: rule.id,
        level: rule.level,
        text: rule.text,
        reliability: rule.reliability || 0,
        accel: rule.accel || 0,
        hp: rule.hp || 0,
        handling: rule.handling || 0,
        braking: rule.braking || 0
      });
    });
    return issues;
  }

  /* --------------------------------------------------------------------------
     Кэш узлов: созданные один раз в buildUI и обновляемый точечно в render(),
     чтобы не сбрасывать CSS-переходы и клавиатурный фокус.
     -------------------------------------------------------------------------- */
  var modelEls = {};   // { modelId: HTMLElement }
  var tabEls = {};     // { tabId: HTMLElement }
  var moduleEls = {};  // { catKey: { card, title, options: { optKey: {btn, brand, price} } } }
  var statEls = {};    // { metricId: { track, bar, value } }
  var dynoEls = {};    // { dynoId: HTMLElement }
  var noticeEls = [];  // [{ text, level }]
  var svgZoneEls = []; // массив g[data-zone]
  var stageEl = null;
  var modulesHostEl = null;
  var statsHostEl = null;
  var noticesHostEl = null;
  var dynoHostEl = null;
  var totalPriceEl = null;
  var totalRubEl = null;
  var marketRateEl = null;
  var stageHintEl = null;
  var resetBtnEl = null;
  var accordionToggleEl = null;
  var panelBodyEl = null;

  var numberFormatter = null;
  try {
    numberFormatter = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
  } catch (e) {
    numberFormatter = null;
  }

  function formatMoney(value) {
    var text = numberFormatter ? numberFormatter.format(Math.round(value)) : String(Math.round(value));
    return '$' + text;
  }

  /* Бренд и SKU могут быть строкой или объектом по моделям. */
  function localize(field, option, modelId) {
    if (field && typeof field === 'object') return field[modelId] || field[Object.keys(field)[0]] || '—';
    return field || '—';
  }

  /* --------------------------------------------------------------------------
     buildUI — создаёт разметку моделей, вкладок, модулей, метрик и дисплея.
     Только createElement/createTextNode, никакого innerHTML с данными.
     -------------------------------------------------------------------------- */
  function buildUI() {
    modulesHostEl = document.getElementById('modules');
    statsHostEl = document.getElementById('stats');
    noticesHostEl = document.getElementById('notices');
    dynoHostEl = document.getElementById('dyno');
    totalPriceEl = document.getElementById('totalPrice');
    totalRubEl = document.getElementById('totalRub');
    marketRateEl = document.getElementById('marketRate');
    stageHintEl = document.getElementById('stageHint');
    resetBtnEl = document.getElementById('resetBtn');
    accordionToggleEl = document.getElementById('accordionToggle');
    panelBodyEl = document.getElementById('panelBody');
    userWantsExpanded = !accordionToggleEl ||
      accordionToggleEl.getAttribute('aria-expanded') !== 'false';
    stageEl = document.querySelector('.stage');

    buildModelSelector();
    buildTabs();
    buildModules();
    buildDyno();
    buildStats();
    buildNotices();

    svgZoneEls = Array.prototype.slice.call(document.querySelectorAll('g[data-zone]'));
  }

  function buildModelSelector() {
    var host = document.getElementById('models');
    if (!host) return;
    modelEls = {};
    Object.keys(MODELS).forEach(function (modelId) {
      var model = MODELS[modelId];
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'model';
      button.setAttribute('data-model', modelId);
      button.setAttribute('aria-pressed', 'false');

      var platform = document.createElement('span');
      platform.className = 'model__platform';
      platform.appendChild(document.createTextNode(model.platform));

      var name = document.createElement('span');
      name.className = 'model__name';
      name.appendChild(document.createTextNode(model.label));

      var specs = document.createElement('span');
      specs.className = 'model__specs';
      specs.appendChild(document.createTextNode(
        model.hp + ' л.с. · ' + model.nm + ' Нм · ' + model.accel.toFixed(1) + ' с'
      ));

      button.appendChild(platform);
      button.appendChild(name);
      button.appendChild(specs);
      host.appendChild(button);
      modelEls[modelId] = button;
    });
  }

  function buildTabs() {
    var host = document.getElementById('tabs');
    if (!host) return;
    tabEls = {};
    TABS.forEach(function (tab) {
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'tab';
      button.setAttribute('data-tab', tab.id);
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', 'false');
      button.appendChild(document.createTextNode(tab.label));
      host.appendChild(button);
      tabEls[tab.id] = button;
    });
  }

  function buildModules() {
    modulesHostEl.innerHTML = '';
    moduleEls = {};
    Object.keys(PartsDB).forEach(function (catKey) {
      var part = PartsDB[catKey];

      var card = document.createElement('article');
      card.className = 'module';
      card.setAttribute('data-cat', catKey);
      card.setAttribute('data-tab', part.tab);
      card.setAttribute('data-zone', part.zone);

      var title = document.createElement('div');
      title.className = 'module__title';
      var titleText = document.createElement('span');
      titleText.className = 'module__label';
      titleText.appendChild(document.createTextNode(part.label));
      var titleMeta = document.createElement('span');
      titleMeta.className = 'module__meta';
      title.appendChild(titleText);
      title.appendChild(titleMeta);

      var optionsBox = document.createElement('div');
      optionsBox.className = 'module__options';

      var optionMap = {};
      OPTION_ORDER.forEach(function (optKey) {
        var option = part.options[optKey];
        if (!option) return;

        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'option';
        button.setAttribute('data-cat', catKey);
        button.setAttribute('data-option', optKey);
        button.setAttribute('aria-pressed', 'false');

        var name = document.createElement('span');
        name.className = 'option__label';
        name.appendChild(document.createTextNode(option.label));

        var brand = document.createElement('span');
        brand.className = 'option__brand';
        brand.appendChild(document.createTextNode(localize(option.brand, option, AppState.currentModelId)));

        var price = document.createElement('span');
        price.className = 'option__price';
        price.appendChild(document.createTextNode(formatMoney(option.price)));

        button.appendChild(name);
        button.appendChild(brand);
        button.appendChild(price);

        optionsBox.appendChild(button);
        optionMap[optKey] = { btn: button, brand: brand, price: price };
      });

      card.appendChild(title);
      card.appendChild(optionsBox);
      modulesHostEl.appendChild(card);
      moduleEls[catKey] = { card: card, title: title, meta: titleMeta, options: optionMap };
    });
  }

  var DYNO_CELLS = [
    { id: 'accel', label: '0–100' },
    { id: 'vmax',  label: 'Vmax' },
    { id: 'hp',    label: 'Мощность' },
    { id: 'nm',    label: 'Момент' },
    { id: 'mass',  label: 'Масса' }
  ];

  function buildDyno() {
    if (!dynoHostEl) return;
    dynoEls = {};
    DYNO_CELLS.forEach(function (cell) {
      var wrap = document.createElement('div');
      wrap.className = 'dyno__cell';

      var label = document.createElement('span');
      label.className = 'dyno__label';
      label.appendChild(document.createTextNode(cell.label));

      var value = document.createElement('span');
      value.className = 'dyno__value';
      value.appendChild(document.createTextNode('—'));

      wrap.appendChild(label);
      wrap.appendChild(value);
      dynoHostEl.appendChild(wrap);
      dynoEls[cell.id] = value;
    });
  }

  function buildStats() {
    if (!statsHostEl) return;
    statEls = {};
    METRICS.forEach(function (metric) {
      var stat = document.createElement('div');
      stat.className = 'stat';
      stat.setAttribute('data-metric', metric.id);

      var head = document.createElement('div');
      head.className = 'stat__head';

      var label = document.createElement('span');
      label.className = 'stat__label';
      label.appendChild(document.createTextNode(metric.label));

      var value = document.createElement('span');
      value.className = 'stat__value';
      value.appendChild(document.createTextNode('0'));

      head.appendChild(label);
      head.appendChild(value);

      var track = document.createElement('div');
      track.className = 'stat__track';
      track.setAttribute('role', 'progressbar');
      track.setAttribute('aria-valuemin', '0');
      track.setAttribute('aria-valuemax', '100');
      track.setAttribute('aria-valuenow', '0');
      track.setAttribute('aria-label', metric.label);

      var bar = document.createElement('div');
      bar.className = 'stat__bar';
      track.appendChild(bar);

      stat.appendChild(head);
      stat.appendChild(track);
      statsHostEl.appendChild(stat);

      statEls[metric.id] = { track: track, bar: bar, value: value };
    });
  }

  /* Лёгкие уведомления внизу панели метрик. Показываем до NOTICE_LIMIT
     конфликтов, остальные сворачиваем в счётчик «ещё N»: молча терять
     предупреждения нельзя, а 8 строк в панели не поместятся. */
  var NOTICE_LIMIT = 4;

  /* Каркас под NOTICE_LIMIT+1 слот: переиспользуем узлы, меняем только
     текст и класс уровня, чтобы не сбрасывать анимацию появления. */
  function buildNotices() {
    if (!noticesHostEl) return;
    noticesHostEl.innerHTML = '';
    noticeEls = [];
    for (var i = 0; i <= NOTICE_LIMIT; i += 1) {
      var item = document.createElement('div');
      item.className = 'notice';
      item.hidden = true;
      noticesHostEl.appendChild(item);
      noticeEls.push(item);
    }
  }

  /* --------------------------------------------------------------------------
     render — единственная точка перерисовки. Идемпотентна: читает только
     AppState и Market, не мутирует DOM-структуру (кроме одногоразовой
     сборки карточек), не трогает фокус.
     -------------------------------------------------------------------------- */
  function render(options) {
    options = options || {};
    var flashDrops = options.flashDrops || [];

    var physics = AppState.computePhysics();
    var stats = AppState.computeStats(physics);
    var price = AppState.computePrice();
    var model = AppState.model();
    var activeZone = AppState.activeZone;
    var availableTabs = AppState.availableTabs();

    /* 1. Селектор моделей */
    Object.keys(modelEls).forEach(function (modelId) {
      var isActive = modelId === AppState.currentModelId;
      if (isActive) {
        modelEls[modelId].classList.add('is-active');
      } else {
        modelEls[modelId].classList.remove('is-active');
      }
      modelEls[modelId].setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });

    /* 2. Вкладки: скрываем те, для которых у модели нет категорий */
    TABS.forEach(function (tab) {
      var button = tabEls[tab.id];
      if (!button) return;
      var available = availableTabs.some(function (item) { return item.id === tab.id; });
      if (available) {
        button.hidden = false;
      } else {
        button.hidden = true;
      }
      var isActive = available && tab.id === AppState.activeTab;
      if (isActive) {
        button.classList.add('is-active');
      } else {
        button.classList.remove('is-active');
      }
      button.setAttribute('aria-selected', isActive ? 'true' : 'false');
    });

    /* 3. Карточки: показываем только категории активной вкладки */
    Object.keys(moduleEls).forEach(function (catKey) {
      var els = moduleEls[catKey];
      var part = PartsDB[catKey];
      var available = AppState.isAvailable(catKey);
      if (available && part.tab === AppState.activeTab) {
        els.card.hidden = false;
      } else {
        els.card.hidden = true;
      }
      var isActive = available && part.zone === activeZone;
      if (isActive) {
        els.card.classList.add('active');
      } else {
        els.card.classList.remove('active');
      }

      var selectedKey = AppState.config[catKey];
      var selectedOption = available ? part.options[selectedKey] : null;

      Object.keys(els.options).forEach(function (optKey) {
        var entry = els.options[optKey];
        var option = part.options[optKey];
        var quote = available ? quoteOf(catKey, optKey) : null;
        var inStock = quote ? quote.inStock : true;
        var isSelected = available && optKey === selectedKey;

        if (isSelected) {
          entry.btn.classList.add('is-active');
        } else {
          entry.btn.classList.remove('is-active');
        }
        entry.btn.setAttribute('aria-pressed', isSelected ? 'true' : 'false');

        /* Позиция снята с продажи: выбор заблокирован, кнопка помечена. */
        if (!inStock) {
          entry.btn.classList.add('is-oos');
          entry.btn.disabled = true;
          entry.btn.setAttribute('aria-disabled', 'true');
          entry.price.textContent = '[API Out of Stock]';
        } else {
          entry.btn.classList.remove('is-oos');
          entry.btn.disabled = false;
          entry.btn.removeAttribute('aria-disabled');
          if (quote) {
            entry.price.textContent = formatMoney(quote.price);
          } else {
            entry.price.textContent = formatMoney(option.price);
          }
        }

        /* Акция подсвечивает ценник, обычный дрейф — нет. */
        if (quote && quote.onSale) {
          entry.price.classList.add('is-sale');
        } else {
          entry.price.classList.remove('is-sale');
        }

        /* Одноразовая зелёная подсветка падения цены. */
        var dropped = flashDrops.indexOf(catKey + ':' + optKey) !== -1;
        if (dropped) {
          entry.price.classList.remove('is-drop');
          /* Принудительный reflow гарантирует перезапуск CSS-анимации. */
          /* eslint-disable-next-line no-unused-expressions */
          entry.price.offsetWidth;
          entry.price.classList.add('is-drop');
        }

        if (available) {
          entry.brand.textContent = localize(option.brand, option, AppState.currentModelId);
        }
      });

      /* Заголовок карточки показывает бренд и артикул выбранной позиции. */
      if (selectedOption) {
        els.meta.textContent = localize(selectedOption.brand, selectedOption, AppState.currentModelId) +
          ' · ' + localize(selectedOption.sku, selectedOption, AppState.currentModelId);
      } else {
        els.meta.textContent = '';
      }
    });

    /* 4. Дисплей физики */
    if (dynoEls.accel) dynoEls.accel.textContent = physics.accel.toFixed(1) + ' с';
    if (dynoEls.vmax) dynoEls.vmax.textContent = physics.vmax + ' км/ч';
    if (dynoEls.hp) dynoEls.hp.textContent = physics.hp + ' л.с.';
    if (dynoEls.nm) dynoEls.nm.textContent = physics.nm + ' Нм';
    if (dynoEls.mass) dynoEls.mass.textContent = physics.mass + ' кг';
    if (dynoHostEl) {
      if (physics.wheelSpin) {
        dynoHostEl.classList.add('is-spin');
      } else {
        dynoHostEl.classList.remove('is-spin');
      }
    }

    /* 5. Полосы и подписи метрик */
    METRICS.forEach(function (metric) {
      var els = statEls[metric.id];
      if (!els) return;
      var value = stats[metric.id];
      els.bar.style.width = value + '%';
      els.value.textContent = String(value);
      els.track.setAttribute('aria-valuenow', String(value));
    });

    /* 6. Уведомления о конфликтах — первыми идут ошибки разрушения */
    renderNotices(physics.issues);

    /* 7. Итог: цена в USD и эквивалент по живому курсу */
    if (totalPriceEl) totalPriceEl.textContent = formatMoney(price);
    if (totalRubEl) {
      totalRubEl.textContent = numberFormatter
        ? '≈ ' + numberFormatter.format(Math.round(price * Market.fxRate)) + ' ₽'
        : '';
    }
    if (marketRateEl) marketRateEl.textContent = Market.fxRate.toFixed(2) + ' ₽/$';

    /* 8. Подсветка SVG-зон по AppState.activeZone */
    svgZoneEls.forEach(function (group) {
      var isActive = activeZone !== null && group.getAttribute('data-zone') === activeZone;
      if (isActive) {
        group.classList.add('active');
      } else {
        group.classList.remove('active');
      }
    });

    /* 9. Подсказка под схемой печатает, какая вкладка открыта */
    if (stageHintEl) {
      var activeTabLabel = '';
      TABS.forEach(function (tab) {
        if (tab.id === AppState.activeTab) activeTabLabel = tab.label;
      });
      stageHintEl.textContent = activeZone
        ? 'Зона открыта: вкладка ' + activeTabLabel
        : 'Нажмите на узел схемы — откроются связанные вкладки';
    }

    /* Модель в подсказке не дублируется — селектор её уже показывает. */
    return model;
  }

  /* Лёгкие уведомления внизу панели метрик: максимум 3,
     ошибки разрушения важнее предупреждений. */
  function renderNotices(issues) {
    var sorted = issues.slice().sort(function (a, b) {
      if (a.level === b.level) return 0;
      return a.level === 'error' ? -1 : 1;
    });
    var shown = sorted.slice(0, NOTICE_LIMIT);
    var overflow = sorted.length - shown.length;

    noticeEls.forEach(function (element, index) {
      if (index < shown.length) {
        element.hidden = false;
        element.className = 'notice notice--' + shown[index].level;
        element.textContent = shown[index].text;
        return;
      }
      /* Последний слот: если остались ещё конфликты — это счётчик,
         иначе слот просто гасится. */
      if (index === NOTICE_LIMIT && overflow > 0) {
        element.hidden = false;
        element.className = 'notice notice--more';
        element.textContent = 'Ещё ' + overflow + ' ' + plural(overflow, 'конфликт', 'конфликта', 'конфликтов') + ' в других узлах';
        return;
      }
      element.hidden = true;
      element.className = 'notice';
      element.textContent = '';
    });

    if (noticesHostEl) {
      if (sorted.length > 0) {
        noticesHostEl.classList.remove('is-empty');
      } else {
        noticesHostEl.classList.add('is-empty');
      }
    }
  }

  /* Русская плюрализация для счётчика уведомлений. */
  function plural(count, one, few, many) {
    var mod100 = count % 100;
    if (mod100 >= 11 && mod100 <= 14) return many;
    var mod10 = count % 10;
    if (mod10 === 1) return one;
    if (mod10 >= 2 && mod10 <= 4) return few;
    return many;
  }

  /* --------------------------------------------------------------------------
     Аккордеон (мобильный <= 900px). Сворачивание панели делает CSS по
     aria-expanded; атрибут hidden дублирует его для надёжности.
     На десктопе панель не может быть скрыта — там expanded всегда true.
     -------------------------------------------------------------------------- */
  function isNarrowViewport() {
    return !!(window.matchMedia && window.matchMedia('(max-width: 900px)').matches);
  }

  var userWantsExpanded = true;

  function setAccordion(expanded) {
    if (!accordionToggleEl || !panelBodyEl) return;
    userWantsExpanded = !!expanded;
    var value = isNarrowViewport() ? userWantsExpanded : true;
    accordionToggleEl.setAttribute('aria-expanded', value ? 'true' : 'false');
    panelBodyEl.hidden = !value;
  }

  function scrollModulesToTop() {
    if (modulesHostEl && typeof modulesHostEl.scrollTop === 'number') {
      modulesHostEl.scrollTop = 0;
    }
  }

  /* Единая точка выбора зоны: подсветка в SVG + вкладка и прокрутка списка. */
  function selectZone(zoneId) {
    AppState.selectZone(zoneId);
    scrollModulesToTop();
    if (zoneId !== null) setAccordion(true);
  }

  /* --------------------------------------------------------------------------
     bindEvents — делегирование: ни одного обработчика на конкретный узел.
     -------------------------------------------------------------------------- */
  function bindEvents() {
    /* Схема: клик по зоне / по пустому месту */
    if (stageEl) {
      stageEl.addEventListener('click', function (e) {
        var hit = e.target && e.target.closest ? e.target.closest('[data-zone]') : null;
        if (hit) {
          selectZone(hit.getAttribute('data-zone'));
        } else {
          AppState.select(null);
        }
      });

      /* Клавиатура: SVG <g> сам Enter/Space не активирует */
      stageEl.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar' && e.code !== 'Space') return;
        var hit = e.target && e.target.closest ? e.target.closest('[data-zone]') : null;
        if (!hit) return;
        e.preventDefault();
        selectZone(hit.getAttribute('data-zone'));
      });
    }

    /* Селектор моделей */
    var modelsHostEl = document.getElementById('models');
    if (modelsHostEl) {
      modelsHostEl.addEventListener('click', function (e) {
        var button = e.target && e.target.closest ? e.target.closest('.model') : null;
        if (!button) return;
        AppState.setModel(button.getAttribute('data-model'));
        scrollModulesToTop();
      });
    }

    /* Вкладки */
    var tabsHostEl = document.getElementById('tabs');
    if (tabsHostEl) {
      tabsHostEl.addEventListener('click', function (e) {
        var button = e.target && e.target.closest ? e.target.closest('.tab') : null;
        if (!button || button.hidden) return;
        AppState.activeTab = button.getAttribute('data-tab');
        AppState.select(null);
        scrollModulesToTop();
      });
    }

    /* Панель: клик по варианту меняет конфиг, клик по карточке — подсветку зоны */
    if (modulesHostEl) {
      modulesHostEl.addEventListener('click', function (e) {
        var optionBtn = e.target && e.target.closest ? e.target.closest('.option') : null;
        if (optionBtn) {
          if (optionBtn.disabled) return;
          AppState.set(optionBtn.getAttribute('data-cat'), optionBtn.getAttribute('data-option'));
          return;
        }
        var card = e.target && e.target.closest ? e.target.closest('.module') : null;
        if (card && !card.hidden) {
          selectZone(card.getAttribute('data-zone'));
          return;
        }
        AppState.select(null);
      });
    }

    if (resetBtnEl) {
      resetBtnEl.addEventListener('click', function () {
        AppState.reset();
      });
    }

    if (accordionToggleEl) {
      accordionToggleEl.addEventListener('click', function () {
        var expanded = accordionToggleEl.getAttribute('aria-expanded') === 'true';
        setAccordion(!expanded);
      });
    }

    /* Ресинхронизация аккордеона при смене вьюпорта. */
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

  /* --------------------------------------------------------------------------
     init — script подключён с defer, но подстрахуемся на случай
     readyState === 'loading' (страховка для подключения без defer).
     -------------------------------------------------------------------------- */
  function init() {
    buildUI();
    buildMarket();
    AppState.config = AppState.defaults();
    AppState.activeTab = AppState.availableTabs()[0].id;
    bindEvents();
    render();
    startMarket();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
