/* ============================================================================
   Интерактивный конфигуратор автомобиля — логика интерфейса.
   Один IIFE, без модулей и внешних зависимостей (работает по file://).
   Порядок секций: METRICS → PartsDB → AppState → buildUI → render → bindEvents → init.
   ========================================================================== */

(function () {

  /* --------------------------------------------------------------------------
     METRICS — оси характеристик. Порядок фиксирован и совпадает с порядком
     ключей mods в PartsDB. Ключи обязаны совпадать с data-metric разметки.
     -------------------------------------------------------------------------- */
  var METRICS = [
    { id: 'speed',       label: 'Скорость' },
    { id: 'handling',    label: 'Управляемость' },
    { id: 'braking',     label: 'Торможение' },
    { id: 'reliability', label: 'Надёжность' }
  ];

  /* Порядок кнопок вариантов внутри карточки модуля. */
  var OPTION_ORDER = ['stock', 'sport', 'track'];

  /* --------------------------------------------------------------------------
     PartsDB — единственный источник правды по деталям.
     Формат: { label, options: { stock|sport|track: { label, price, mods } } }
     mods содержит те же 4 ключа, что и METRICS.

     Ограничения на дельты (проверено арифметически):
       * BASE = 50, MIN = 0, MAX = 100 → сумма ПОЛОЖИТЕльных дельт по любой оси
         не должна превышать +50, иначе бар упирается в потолок и теряет различимость.
       * sport/track обязаны снижать reliability (быстрее = менее надёжно)
         и повышать braking/handling.

       Сумма положительных дельт, набор «всё в Трек» (максимум по оси):
         speed       +45   → 50 + 45 = 95   (до потолка 100 не доходит)
         handling    +46   → 50 + 46 = 96
         braking     +46   → 50 + 46 = 96
         reliability +0    (только отрицательные дельты)
       Сумма положительных дельт, набор «всё в Спорт»:
         speed       +27   → 77
         handling    +26   → 76
         braking     +28   → 78
         reliability +0

       Сумма ОТРИЦАТЕЛЬНЫХ дельт, «всё в Трек»: reliability = -50 → 50 - 50 = 0.
       Это единственное намеренное касание нижней границы clamp(0, 100);
       верхняя граница 100 недостижима ни одной комбинацией (максимум 96).

       Цены (₽): «всё в Спорт» = 422 000, «всё в Трек» = 930 000, «Сток» = 0.
     -------------------------------------------------------------------------- */
  var PartsDB = {
    engine: {
      label: 'Двигатель',
      options: {
        stock: { label: 'Сток',  price: 0,      mods: { speed:  0, handling:  0, braking:  0, reliability:   0 } },
        sport: { label: 'Спорт', price: 185000, mods: { speed: 18, handling:  4, braking:  3, reliability: -10 } },
        track: { label: 'Трек',  price: 420000, mods: { speed: 28, handling:  8, braking:  5, reliability: -20 } }
      }
    },
    suspension: {
      label: 'Подвеска',
      options: {
        stock: { label: 'Сток',  price: 0,      mods: { speed:  0, handling:  0, braking:  0, reliability:   0 } },
        sport: { label: 'Спорт', price: 95000,  mods: { speed:  2, handling: 11, braking:  7, reliability:  -6 } },
        track: { label: 'Трек',  price: 210000, mods: { speed:  4, handling: 19, braking: 12, reliability: -13 } }
      }
    },
    brakes: {
      label: 'Тормоза',
      options: {
        stock: { label: 'Сток',  price: 0,      mods: { speed:  0, handling:  0, braking:  0, reliability:   0 } },
        sport: { label: 'Спорт', price: 78000,  mods: { speed:  1, handling:  5, braking: 14, reliability:  -5 } },
        track: { label: 'Трек',  price: 165000, mods: { speed:  2, handling:  9, braking: 22, reliability: -10 } }
      }
    },
    wheels: {
      label: 'Колёса',
      options: {
        stock: { label: 'Сток',  price: 0,      mods: { speed:  0, handling:  0, braking:  0, reliability:   0 } },
        sport: { label: 'Спорт', price: 64000,  mods: { speed:  6, handling:  6, braking:  4, reliability:  -4 } },
        track: { label: 'Трек',  price: 135000, mods: { speed: 11, handling: 10, braking:  7, reliability:  -7 } }
      }
    }
  };

  /* --------------------------------------------------------------------------
     AppState — единственное состояние. render() читает только его.
     -------------------------------------------------------------------------- */
  var AppState = {
    config: {
      engine: 'stock',
      suspension: 'stock',
      brakes: 'stock',
      wheels: 'stock'
    },
    activeModule: null,
    BASE: 50,
    MIN: 0,
    MAX: 100,

    /* Сумма дельт выбранных опций + BASE, затем clamp(MIN, MAX) и округление.
       Отсутствующие модули/опции/undefined-дельты пропускаются без ошибки. */
    computeStats: function () {
      var stats = {};
      var self = this;
      METRICS.forEach(function (metric) {
        var sum = self.BASE;
        Object.keys(self.config).forEach(function (moduleKey) {
          var part = PartsDB[moduleKey];
          if (!part || !part.options) return;
          var option = part.options[self.config[moduleKey]];
          if (!option || !option.mods) return;
          var delta = option.mods[metric.id];
          if (typeof delta === 'number' && isFinite(delta)) sum += delta;
        });
        sum = Math.max(this.MIN, Math.min(this.MAX, sum));
        stats[metric.id] = Math.round(sum);
      }, this);
      return stats;
    },

    /* Сумма цен выбранных опций, guard на undefined. */
    computePrice: function () {
      var price = 0;
      var self = this;
      Object.keys(self.config).forEach(function (moduleKey) {
        var part = PartsDB[moduleKey];
        if (!part || !part.options) return;
        var option = part.options[self.config[moduleKey]];
        if (!option || typeof option.price !== 'number' || !isFinite(option.price)) return;
        price += option.price;
      });
      return price;
    },

    /* Смена варианта. Неизвестные ключи игнорируются (без изменений состояния). */
    set: function (module, option) {
      var part = PartsDB[module];
      if (!part || !part.options || !part.options[option]) return;
      this.config[module] = option;
      this.activeModule = module;
      render();
    },

    /* Только подсветка: активный модуль или null (гасит все подсветки). */
    select: function (module) {
      if (module !== null && !PartsDB[module]) return;
      this.activeModule = module;
      render();
    },

    reset: function () {
      var self = this;
      Object.keys(self.config).forEach(function (moduleKey) {
        self.config[moduleKey] = 'stock';
      });
      self.activeModule = null;
      render();
    }
  };

  /* --------------------------------------------------------------------------
     Кэш узлов: созданные один раз в buildUI и обновляемый точечно в render(),
     чтобы не сбрасывать CSS-переходы и клавиатурный фокус.
     -------------------------------------------------------------------------- */
  var moduleEls = {};   // { moduleKey: { card: HTMLElement, options: { optKey: HTMLElement } } }
  var statEls = {};     // { metricId: { track: HTMLElement, bar: HTMLElement, value: HTMLElement } }
  var svgModuleEls = []; // NodeList-подобный массив g[data-module]
  var stageEl = null;
  var modulesHostEl = null;
  var statsHostEl = null;
  var totalPriceEl = null;
  var resetBtnEl = null;
  var accordionToggleEl = null;
  var panelBodyEl = null;

  var priceFormatter = null;
  try {
    priceFormatter = new Intl.NumberFormat('ru-RU');
  } catch (e) {
    priceFormatter = null;
  }

  /* Intl.NumberFormat('ru-RU') уже разделяет разряды неразрывным пробелом,
     знак валюты отделяем ещё одним неразрывным пробелом, чтобы число и «₽»
     не разрывались переносом строки. */
  function formatPrice(value) {
    var text = priceFormatter ? priceFormatter.format(value) : String(value);
    return text + ' ₽';
  }

  /* --------------------------------------------------------------------------
     buildUI — создаёт разметку .module и .stat из PartsDB / METRICS.
     Только createElement/createTextNode, никакого innerHTML с данными.
     -------------------------------------------------------------------------- */
  function buildUI() {
    modulesHostEl = document.getElementById('modules');
    statsHostEl = document.getElementById('stats');
    totalPriceEl = document.getElementById('totalPrice');
    resetBtnEl = document.getElementById('resetBtn');
    accordionToggleEl = document.getElementById('accordionToggle');
    panelBodyEl = document.getElementById('panelBody');
    /* Стартовое намерение пользователя берём из разметки. */
    userWantsExpanded = !accordionToggleEl ||
      accordionToggleEl.getAttribute('aria-expanded') !== 'false';
    stageEl = document.querySelector('.stage');

    moduleEls = {};
    statEls = {};

    /* --- карточки модулей --- */
    Object.keys(PartsDB).forEach(function (moduleKey) {
      var part = PartsDB[moduleKey];

      var card = document.createElement('article');
      card.className = 'module';
      card.setAttribute('data-module', moduleKey);

      var title = document.createElement('div');
      title.className = 'module__title';
      title.appendChild(document.createTextNode(part.label));

      var optionsBox = document.createElement('div');
      optionsBox.className = 'module__options';

      var optionMap = {};
      OPTION_ORDER.forEach(function (optionKey) {
        var def = part.options[optionKey];
        if (!def) return;

        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'option';
        button.setAttribute('data-module', moduleKey);
        button.setAttribute('data-option', optionKey);
        button.setAttribute('aria-pressed', 'false');
        button.appendChild(document.createTextNode(def.label));

        optionsBox.appendChild(button);
        optionMap[optionKey] = button;
      });

      card.appendChild(title);
      card.appendChild(optionsBox);
      modulesHostEl.appendChild(card);
      moduleEls[moduleKey] = { card: card, options: optionMap };
    });

    /* --- характеристики --- */
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

    /* SVG-модули статичны в index.html — кэшируем узлы для точечного класса. */
    svgModuleEls = Array.prototype.slice.call(document.querySelectorAll('g[data-module]'));
  }

  /* --------------------------------------------------------------------------
     render — единственная точка перерисовки. Идемпотентна: читает только
     AppState, не мутирует DOM-структуру, не трогает фокус.
     Переключаемые селекторы:
       .stat__bar (inline width), .stat__value (textContent),
       .stat__track[aria-valuenow], #totalPrice (textContent),
       g[data-module].active, .module.active, .option.is-active, .option[aria-pressed].
     Анимацию полосы делает CSS-transition, не JS.
     -------------------------------------------------------------------------- */
  function render() {
    var stats = AppState.computeStats();
    var price = AppState.computePrice();
    var active = AppState.activeModule;

    /* 1. Полосы и подписи метрик */
    METRICS.forEach(function (metric) {
      var els = statEls[metric.id];
      if (!els) return;
      var value = stats[metric.id];
      els.bar.style.width = value + '%';
      els.value.textContent = String(value);
      els.track.setAttribute('aria-valuenow', String(value));
    });

    /* 2. Итоговая цена */
    if (totalPriceEl) totalPriceEl.textContent = formatPrice(price);

    /* 3. Подсветка SVG-модулей по AppState.activeModule */
    svgModuleEls.forEach(function (group) {
      var isActive = active !== null && group.getAttribute('data-module') === active;
      if (isActive) {
        group.classList.add('active');
      } else {
        group.classList.remove('active');
      }
    });

    /* 4. Подсветка карточек и кнопок вариантов */
    Object.keys(moduleEls).forEach(function (moduleKey) {
      var els = moduleEls[moduleKey];
      if (active !== null && moduleKey === active) {
        els.card.classList.add('active');
      } else {
        els.card.classList.remove('active');
      }

      var selected = AppState.config[moduleKey];
      Object.keys(els.options).forEach(function (optionKey) {
        var button = els.options[optionKey];
        var isSelected = optionKey === selected;
        if (isSelected) {
          button.classList.add('is-active');
        } else {
          button.classList.remove('is-active');
        }
        button.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
      });
    });
  }

  /* --------------------------------------------------------------------------
     Аккордеон (мобильный <= 900px). Сворачивание панели делает CSS по
     aria-expanded; атрибут hidden дублирует его для надёжности.
     На десктопе панель не может быть скрыта — там expanded всегда true.
     -------------------------------------------------------------------------- */
  function isNarrowViewport() {
    return !!(window.matchMedia && window.matchMedia('(max-width: 900px)').matches);
  }

  /* Намерение пользователя по панели: последнее выбранное им состояние
     (клик по кнопке аккордеона или по узлу схемы). На десктопе не меняется —
     там панель всё равно всегда раскрыта. Инициализируется из разметки
     (в HTML у #accordionToggle стоит aria-expanded="true") в buildUI. */
  var userWantsExpanded = true;

  function setAccordion(expanded) {
    if (!accordionToggleEl || !panelBodyEl) return;
    /* Запоминаем именно намерение, а не итоговое значение: на десктопе
       value принудительно станет true, иначе после возврата на мобильный
       панель «вспомнила» бы состояние, которого пользователь не выбирал. */
    userWantsExpanded = !!expanded;
    var value = isNarrowViewport() ? userWantsExpanded : true;
    accordionToggleEl.setAttribute('aria-expanded', value ? 'true' : 'false');
    panelBodyEl.hidden = !value;
  }

  /* Единая точка выбора модуля: подсветка в SVG + карточка, и раскрытие
     аккордеона на мобильном при клике/Enter по схеме. */
  function selectModule(module) {
    AppState.select(module);
    if (module !== null) setAccordion(true);
  }

  /* --------------------------------------------------------------------------
     bindEvents — делегирование: ни одного обработчика на конкретный узел.
     -------------------------------------------------------------------------- */
  function bindEvents() {
    /* Схема: клик по модулю / по пустому месту */
    if (stageEl) {
      stageEl.addEventListener('click', function (e) {
        var hit = e.target && e.target.closest ? e.target.closest('[data-module]') : null;
        if (hit) {
          selectModule(hit.getAttribute('data-module'));
        } else {
          AppState.select(null);
        }
      });

      /* Клавиатура: SVG <g> сам Enter/Space не активирует */
      stageEl.addEventListener('keydown', function (e) {
        if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar' && e.code !== 'Space') return;
        var hit = e.target && e.target.closest ? e.target.closest('[data-module]') : null;
        if (!hit) return;
        e.preventDefault();
        selectModule(hit.getAttribute('data-module'));
      });
    }

    /* Панель: клик по варианту меняет конфиг, клик по карточке — подсветку */
    if (modulesHostEl) {
      modulesHostEl.addEventListener('click', function (e) {
        var optionBtn = e.target && e.target.closest ? e.target.closest('.option') : null;
        if (optionBtn) {
          AppState.set(optionBtn.getAttribute('data-module'), optionBtn.getAttribute('data-option'));
          return;
        }
        var card = e.target && e.target.closest ? e.target.closest('.module') : null;
        if (card) {
          AppState.select(card.getAttribute('data-module'));
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

    /* Ресинхронизация аккордеона при смене вьюпорта.
       setAccordion читает matchMedia только в момент вызова, поэтому без
       этого слушателя сценарий «свернул панель на мобильном → повернул
       телефон / изменил размер окна на десктоп» оставлял hidden=true,
       тогда как CSS по :has() на десктопе панель уже не скрывает. Состояние
       разъезжается с aria-expanded, а кнопка-переключатель на десктопе
       display:none — восстановить его некому. Повторный вызов с текущим
       пользовательским намерением приводит DOM в порядок: на десктопе
       setAccordion сам принудительно раскрывает панель, на мобильном
       возвращает последнее выбранное пользователем состояние.
       Поддерживаются оба API media-query (новый и устаревший);
       при отсутствии matchMedia слушатель просто не ставится. */
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
    bindEvents();
    AppState.reset();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

}());
