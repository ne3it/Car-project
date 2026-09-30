# План: «Интерактивный конфигуратор автомобиля» (SPA, vanilla JS)

## Контекст и цели

Рабочая папка пуста — проект создаётся с нуля, миграции нет. Нужно веб-приложение-конфигуратор
автомобиля: тёмный минималистичный UI (глубокий чёрный / белый / коралловый `#ff4d4d`),
строго в 100vh без вертикального скролла, адаптивное, без внешних библиотек и фреймворков.
Слева — минималистичная 2D-схема авто инлайновым SVG (вид сбоку, тонкие линии) с 4 интерактивными
модулями (`engine`, `suspension`, `brakes`, `wheels`). Справа — панель: 4 модуля × 3 варианта,
4 характеристики, итоговая цена, сброс.

## Зафиксированные решения (ответы пользователя)

| Вопрос | Решение |
| --- | --- |
| Тема | Тёмная: фон `#0b0b0c`, панели `#141416`, белый текст, акцент `#ff4d4d` |
| Язык UI | Русский (Двигатель, Подвеска, Тормоза, Колёса; Скорость/Управляемость/Торможение/Надёжность) |
| Состав правой панели | 4 карточки модулей + 4 тонких прогресс-бара + итоговая цена (без скролла) |
| Мобильный (<900px) | Аккордеон: схема сверху, ниже сворачиваемый блок управления; `100dvh` |
| Доп. фичи | Сброс к дефолту + итоговая цена. Без «случайной сборки»/оптимизатора |
| Структура файлов | 4 файла: `index.html`, `styles.css`, `app.js` (+ `README.md` не нужен) |
| Модель метрик | База 50 на характеристику + дельты от деталей, `clamp(0, 100)` |

## Файлы

```
index.html
styles.css
app.js
```

Никаких зависимостей, сборки, npm. Открывается двойным кликом по `index.html`
(никаких `import`/ES-модулей — только один `<script src="app.js" defer>`).

## 1. `index.html`

Скелет без динамической генерации разметки (весь UI статичен, JS только меняет классы/текст):

```html
<!DOCTYPE html>
<html lang="ru" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Конфигуратор автомобиля</title>
  <link rel="stylesheet" href="styles.css">
  <script src="app.js" defer></script>
</head>
<body>
  <div class="app">
    <header class="app__header">
      <div class="brand"><span class="brand__mark"></span> CONFIGURATOR / XDRIVE</div>
      <button class="btn-reset" id="resetBtn" type="button">Сбросить</button>
    </header>

    <main class="app__body">
      <!-- ЛЕВАЯ ЗОНА: схема -->
      <section class="stage" aria-label="Схема автомобиля">
        <svg class="car" viewBox="0 0 800 380" ...>
          <g id="body">   <!-- неинтерактивный кузов, тонкие линии -->
          <g id="engine"       class="car__module" data-module="engine"       tabindex="0" role="button" aria-label="Двигатель">
          <g id="suspension"   class="car__module" data-module="suspension"   tabindex="0" role="button" aria-label="Подвеска">
          <g id="brakes"       class="car__module" data-module="brakes"       tabindex="0" role="button" aria-label="Тормоза">
          <g id="wheels"       class="car__module" data-module="wheels"       tabindex="0" role="button" aria-label="Колёса">
        </svg>
        <div class="stage__hint">Нажмите на узел схемы, чтобы перейти к его настройке</div>
      </section>

      <!-- ПРАВАЯ ЗОНА: панель -->
      <section class="panel" id="panel" aria-label="Панель тюнинга">
        <div class="panel__head">   <!-- мобильный аккордеон-кноп -->
          <button class="accordion-toggle" id="accordionToggle" aria-expanded="true" aria-controls="panelBody">Настройка</button>
        </div>
        <div class="panel__body" id="panelBody">
          <div class="modules" id="modules"><!-- 4 .module, генерируются из PartsDB в JS --></div>
          <div class="stats"   id="stats">  <!-- 4 .stat, генерируются --></div>
          <footer class="summary">
            <div class="summary__label">Итого</div>
            <div class="summary__value" id="totalPrice">0 ₽</div>
          </footer>
        </div>
      </section>
    </main>
  </div>
</body>
</html>
```

Требования к SVG:
- `viewBox="0 0 800 380"`, `preserveAspectRatio="xMidYMid meet"`, без внешних `<image>`/шрифтов.
- Только тонкие линии: `stroke`, `fill:none` (кроме активной подсветки), `stroke-width 1.5–2`.
- Каждый модуль — `<g>` с уникальным `id` **и** `data-module` (единый ключ для синхронизации).
- Модули должны визуально читаться: `engine` — в моторном отсеке (левый передний низ),
  `suspension` — под башкой/рычаги у колёс, `brakes` — диски/суппорты у колёс,
  `wheels` — оба колеса (окружности со спицами).
- Аккуратный hit-area: для тонких линий дублировать геометрию не нужно — задать
  `stroke-width` для hit через `pointer-events: stroke` на группах малого размера, либо
  добавить невидимый `<rect class="car__hit">` внутри каждой группы.
- `role="button"`, `tabindex="0"`, `aria-label` на каждом модуле — работа с клавиатуры.

Блоки `.modules` и `.stats` — единственные места, где JS создаёт разметку (циклом по данным),
чтобы не дублировать 4×3 кнопки в HTML руками.

## 2. `styles.css`

Токены (`:root`, тёмная тема фиксированная — переключатель темы вне scope):

```css
--bg: #0b0b0c;  --surface: #141416;  --surface-2: #1c1c1f;
--line: #26262a;  --text: #ffffff;   --muted: #8a8a92;
--accent: #ff4d4d;  --accent-soft: rgba(255,77,77,.16);
--hover-fill: rgba(255,255,255,.05);
```

- `*, *::before, *::after { box-sizing: border-box }`; `body { margin:0; height:100dvh; overflow:hidden; }`
- Шрифт: стек `Inter, Roboto, "Segoe UI", system-ui, -apple-system, sans-serif` — без внешних
  загрузок (требование «без внешних библиотек»), fallback на системные.
- Раскладка: `.app { height:100dvh; display:flex; flex-direction:column; padding: clamp(12px,2vw,28px) }`,
  `.app__body { flex:1; min-height:0; display:grid; grid-template-columns: minmax(0,1.25fr) minmax(360px,420px); gap: clamp(16px,2vw,32px) }`.
  `min-height:0` обязателен, иначе флекс-грид раздует контейнер и появится скролл.
- `.stage { display:flex; align-items:center; justify-content:center; }`, `.car { width:100%; height:auto; max-height:100% }`.
- `.panel { display:flex; flex-direction:column; min-height:0; }`,
  `.panel__body { flex:1; min-height:0; display:grid; grid-template-rows: auto auto auto; gap:…; overflow:hidden }`.
- Стили модулей SVG:
  - `g.car__module { cursor:pointer; fill:var(--hover-fill); stroke:var(--line); transition: fill .22s ease, stroke .22s ease, transform .22s ease; transform-box: fill-box; transform-origin: center }`
  - `g.car__module:hover { fill:var(--hover-fill) }` (мягкий полупрозрачный серый)
  - `g.car__module.active { fill:var(--accent-soft); stroke:var(--accent) }`
  - `g.car__module:focus-visible { outline:none; stroke:var(--accent); stroke-dasharray:4 3 }`
- Прогресс-бары — тонкие линии: трек `height:2px; background:var(--line); border-radius:2px`,
  заполнение `height:100%; background:var(--accent); width:0; transition: width .45s cubic-bezier(.4,0,.2,1)`.
  Без «толстых» 8–12px баров.
- Кнопки вариантов: `border:1px solid var(--line); background:transparent; color:var(--muted)`,
  `:hover{border-color:var(--muted); color:var(--text)}`, `.is-active{border-color:var(--accent); color:var(--accent); background:var(--accent-soft)}`,
  `transition: all .2s ease`, padding ~`10px 12px`.
- Аккордеон (<900px): `.panel__head` показывается, `.panel__body` скрывается при
  `aria-expanded="false"` (`display:none` или `max-height:0` + `overflow:hidden`).
- Мобильная раскладка: `.app__body { grid-template-columns:1fr; grid-template-rows: minmax(180px, 34%) 1fr }`,
  схема сверху, панель снизу; внутри `.panel__body` разрешён вертикальный скролл
  `overflow-y:auto` только если содержимое не влезает (это исключение из «без скролла» нужно
  зафиксировать в коде комментарием, т.к. на 360×640 4 модуля + 4 метрики физически не влезают).
- `@media (prefers-reduced-motion: reduce)` — отключить переходы.

## 3. `app.js`

Единый IIFE (без модулей), порядок секций:

### 3.1 `PartsDB`

```js
const PartsDB = {
  engine: {
    label: 'Двигатель',
    options: {
      stock: { label: 'Сток',  price: 0,     mods: { speed:  0, handling: 0, braking: 0,  reliability: 0  } },
      sport: { label: 'Спорт', price: 185000, mods: { speed: 22, handling: 6,  braking: 4,  reliability: -12 } },
      track: { label: 'Трек', price: 420000, mods: { speed: 34, handling: 10, braking: 8,  reliability: -24 } }
    }
  },
  suspension: { /* Сток 0 / Спорт 95000 / Трек 210000 */ },
  brakes:     { /* Сток 0 / Спорт 78000  / Трек 165000 */ },
  wheels:     { /* Сток 0 / Спорт 64000  / Трек 135000 */ }
};
```

Требования к данным:
- Ровно 3 варианта на модуль: `stock`, `sport`, `track` (единые ключи во всех модулях).
- Ключи `speed`, `handling`, `braking`, `reliability` совпадают с `id` SVG-модулей-наоборот:
  ключи модулей `engine|suspension|brakes|wheels`, метрики — отдельный массив `METRICS`.
- Дельты подобраны так, чтобы агрегат по всем трекам не упирался в clamp на 100 по всем
  осям сразу (проверить сумму дельт по оси: max ≤ +50 от базы 50).
- `stock` имеет `price: 0` и нулевые дельты — базовая машина.

`METRICS = [{ id:'speed', label:'Скорость' }, { id:'handling', label:'Управляемость' }, { id:'braking', label:'Торможение' }, { id:'reliability', label:'Надёжность' }]`

### 3.2 `AppState`

```js
const AppState = {
  config: { engine:'stock', suspension:'stock', brakes:'stock', wheels:'stock' },
  activeModule: null,   // подсветка синхронизации SVG ↔ панель
  BASE: 50,
  MAX: 100,
  computeStats() { /* сумма дельт по 4 модулям → clamp */ },
  computePrice() { /* сумма цен 4 модулей */ },
  set(module, option) { /* валидация ключей, this.activeModule = module, render() */ },
  reset() { /* все модули → stock, activeModule = null, render() */ }
};
```

### 3.3 `render()`

Единственная точка перерисовки, вызывается из любого изменения:
1. `const stats = AppState.computeStats(), price = AppState.computePrice()`.
2. Для каждой метрики: `bar.style.width = value + '%'`, `bar.setAttribute('aria-valuenow', value)`,
   числовая подпись `textContent`. Ширина меняется через CSS-transition (не через анимацию в JS).
3. `#totalPrice.textContent = formatPrice(price)` (`Intl.NumberFormat('ru-RU')` + `₽`).
4. Классы: для каждого `g[data-module]` и каждой карточки/кнопки варианта синхронно
   снять/навесить `.active` / `.is-active` по `AppState.config` и `AppState.activeModule`.
5. Никаких полных перерисовок innerHTML в `.panel__body` — только точечное обновление
   классов/текста, чтобы не сбрасывать CSS-переходы и фокус.

### 3.4 Синхронизация (двусторонняя)

Один общий обработчик на оба направления, чтобы не дублировать логику:
- `stage` → делегирование `click`/`keydown(Enter|Space)` на `closest('[data-module]')` →
  `AppState.activeModule = id; render();` + на мобильном раскрыть аккордеон.
- `panel` → делегирование `click` на `closest('[data-option]')` →
  `AppState.set(dataModule, dataOption)`.
- Клик по варианту в панели **тоже** выставляет `activeModule` (светятся оба связанных узла).
- Клик по пустой области схемы/панели — `activeModule = null` (гасятся все подсветки),
  но конфиг не меняется.
- Фокус с клавиатуры дублирует hover-подсветку через `:focus-visible`.

### 3.5 Инициализация

`buildUI()` — создаёт 4 `.module` (заголовок + 3 кнопки) и 4 `.stat` из `PartsDB`/`METRICS`,
навешивает слушатели, затем `AppState.reset()`.

## Порядок реализации

1. `index.html`: каркас `app__header` / `stage` / `panel`, статические контейнеры,
   inline-SVG с 4 группами-модулями (id + data-module + tabindex + aria-label), невидимые hit-area.
2. `styles.css`: токены, reset, 100dvh-раскладка, компоненты панели, стили SVG-модулей,
   тонкие прогресс-бары, брейкпоинт `<900px` с аккордеоном, `prefers-reduced-motion`.
3. `app.js`: `METRICS` + `PartsDB` → `AppState` (`computeStats`/`computePrice`/`set`/`reset`)
   → `buildUI()` → `render()` → делегированные слушатели (SVG, панель, reset, аккордеон).
4. Проверки и доводка по чек-листу ниже.

## Риски / граничные случаи

- **Вертикальный скролл на 1366×768 и 360×640.** Главный риск ТЗ. Митигация: `min-height:0`
  на всех флекс-контейнерах в колонке, `clamp()`-отступы, `overflow:hidden` на `.panel__body`,
  мобильный аккордеон как осознанное исключение с внутренним скроллом.
- **Clamp метрик.** Если сумма дельт по оси > 50, бар упирается в 100 и теряет различимость —
  дельты в БД проверяются суммированием на этапе написания.
- **Клавиатурная доступность SVG.** `<g>` без фокуса не работает → обязательны `tabindex`,
  `role="button"`, обработка Enter/Space, видимый `:focus-visible`.
- **Двойные источники правды.** Ключ модуля дублируется в `id` SVG, `data-module` в SVG и
  `data-module` в кнопке. Единый источник — `data-module`; `id` в SVG нужен только как
  уникальный якорь и должен совпадать с ключом. `render()` читает только `AppState`.
- **Клик по `<g>` между элементами** может не срабатывать на стыках → невидимые hit-area
  `<rect>` внутри групп (pointer-events по fill).
- **Дрейф данных.** Если ключ в `PartsDB` не совпадает с ключом в `AppState.config` — молчаливый
  `undefined` в расчёте. Защита: `set()` валидирует по `PartsDB[module].options` и игнорирует
  неизвестные значения; `computeStats()` пропускает отсутствующие опции.

## Валидация

Статически:
- Открыть `index.html` двойным кликом (без сервера) — консоль без ошибок, `file://` работает.
- `node --check app.js` — синтаксис валиден.
- Grep-проверка: в `index.html` ровно 4 `data-module` со значениями `engine|suspension|brakes|wheels`,
  в `app.js` нет обращений к внешним CDN/шрифтам.

Визуально (ручная проверка в браузере):
1. `document.body.scrollHeight <= window.innerHeight` при 1440×900, 1366×768, 1280×720, 1024×768 —
   скролла нет.
2. Клик по каждому из 4 модулей SVG → подсвечивается соответствующая карточка панели, и наоборот.
3. Смена всех 12 кнопок → бары плавно (≈0.45s) доезжают до новых значений, итоговая цена обновляется.
4. Настройка «всё в Трек» → значения близки к 100, но не зажаты; «всё в Сток» → ровно 50 / 0 ₽.
5. Сброс → все `stock`, цена 0 ₽, подсветки погашены.
6. Tab/Enter/Space: фокус на `<g>` виден, Enter выбирает модуль.
7. 390×844: раскладка в одну колонку, аккордеон сворачивается/раскрывается, схема не обрезана.
8. `prefers-reduced-motion: reduce` — переходы отключены, значения всё равно обновляются.

## Out of scope

- Внешние шрифты/CDN, сборщик, тест-фреймворк, персистентность (localStorage), экспорт/шаринг
  конфигурации, светлая тема и переключатель тем, «случайная сборка»/оптимизатор, звук/анимации 3D.
