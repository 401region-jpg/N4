---
name: mapview-patch
description: Как заменить setStyle() на применение базовых слоёв через layout.visibility и синхронизировать оверлейную видимость.
source: auto-skill
extracted_at: '2026-05-30T18:34:00.000Z'
---

## Цель
Обеспечить совместимость `frontend/src/components/MapView.jsx` с новой стратегией переключения базовых карт и оверлеев без использования `map.setStyle()`.

## Шаги реализации
1. **Импортировать функции** из `hooks/basemaps.js`:
   - `buildInitialStyle`
   - `applyBasemap`
   - `applyOverlay`
   - `DEFAULT_BASEMAP`
2. **Инициализация карты** – вместо передачи готового стиля из `BASEMAPS[basemap].style` использовать:
   ```js
   const map = new maplibregl.Map({
     container: containerRef.current,
     style: buildInitialStyle(DEFAULT_BASEMAP),
     center: DEFAULT_CENTER,
     zoom: DEFAULT_ZOOM,
     attributionControl: false,
   })
   ```
3. **Базовое отображение** – сразу после `map.once('load')` вызвать `applyBasemap(map, DEFAULT_BASEMAP)`.
4. **Переключение базовой карты** – создать `useEffect([basemap])` который проверяет `map.isStyleLoaded()` и вызывает `applyBasemap(map, basemap)`. При отсутствии стиля использовать `map.once('load', ...)`.
5. **Оверлейная видимость** – в другом `useEffect([overlayVisibility])` пройтись по объекту и вызвать `applyOverlay(map, key, visible)` для всех ключей, кроме `grid` (рисуется canvas‑слой).
6. **Маркер‑видимость** – хранить флаг `markers` в `overlayVisibility`. В функции `drawMarkers` делать ранний `return` когда `!overlayRef.current?.markers`.
7. **Синхронизация refs** – добавить `overlayRef` и `coordFmtRef` как `useRef` и обновлять их каждый рендер, чтобы функции‑обработчики получали актуальные значения.
8. **Очистка** – в `return`‑функции `useEffect` удалить все динамически созданные слои/источники, маркеры и отменить подписки.
9. **Тестирование** – проверить в браузере:
   - мгновенное переключение базовых карт без артефактов;
   - корректное отображение/скрытие стран, регионов, городов и маркеров;
   - работа измерения расстояний и поиска.

## Почему подход работает
- `buildInitialStyle` формирует стартовый стиль один раз, а последующие переключения управляются только свойством `visibility`. Это устраняет задержки и «призрачные» тайлы, характерные для `setStyle()`.
- Использование `applyOverlay` гарантирует, что любые новые оверлеи (countries, regions, cities) могут быть включены/выключены без перезапуска карты.
- Хранение флага `markers` в `overlayVisibility` упрощает UI‑синхронизацию с `Sidebar` и позволяет скрывать все маркеры одним действием.

## Применимость
Данный процесс можно использовать в любых проектах, где нужен быстрый безартефактный переход между raster‑базовыми картами в MapLibre, а также гибкое управление векторными оверлеями без полной перезагрузки стиля.
