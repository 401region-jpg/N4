# OSINT Map Console

Локальная веб-консоль с 2D картой для OSINT-задач. Dark operational UI, маркеры в SQLite через FastAPI, MapLibre GL JS на фронте.

```
osint-map-console/
├── backend/
│   ├── main.py              # FastAPI + SQLite API
│   ├── requirements.txt
│   └── markers.db           # создаётся автоматически
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── TopBar.jsx       # поиск + basemap switcher + статус API
│   │   │   ├── MapView.jsx      # MapLibre GL карта
│   │   │   ├── Sidebar.jsx      # слои + список маркеров
│   │   │   ├── MarkerPanel.jsx  # правая панель выбранного объекта
│   │   │   └── AddMarkerModal.jsx # модалка добавления маркера
│   │   ├── hooks/
│   │   │   ├── useApi.js        # fetch-обёртки для backend API
│   │   │   └── basemaps.js      # конфигурация tile-источников
│   │   ├── styles/              # CSS Modules для каждого компонента
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── index.html
│   ├── package.json
│   └── vite.config.js
├── start_backend.bat
├── start_frontend.bat
└── README.md
```

## Требования

| Компонент | Версия      |
|-----------|-------------|
| Python    | 3.10+       |
| Node.js   | 18+         |
| npm       | 8+          |

## Запуск

### Вариант A — через .bat файлы (Windows)

Открыть **два** окна терминала:

**Окно 1 — Backend:**
```
start_backend.bat
```

**Окно 2 — Frontend:**
```
start_frontend.bat
```

### Вариант B — вручную

**Backend:**
```cmd
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000 --host 127.0.0.1
```

**Frontend:**
```cmd
cd frontend
npm install
npm run dev
```

Затем открыть: **http://localhost:5173**

---

## API эндпоинты

| Метод  | URL                  | Описание               |
|--------|----------------------|------------------------|
| GET    | /health              | Health check           |
| GET    | /api/markers         | Список всех маркеров   |
| POST   | /api/markers         | Создать маркер         |
| DELETE | /api/markers/{id}    | Удалить маркер         |

**POST /api/markers — тело запроса:**
```json
{
  "lat": 55.7558,
  "lng": 37.6173,
  "title": "Moscow",
  "note": "Optional intelligence note",
  "color": "#00ff88"
}
```

---

## Basemaps

| Режим     | Источник                         | Токен |
|-----------|----------------------------------|-------|
| STREET    | OpenStreetMap (tile.osm.org)     | Нет   |
| SATELLITE | ESRI World Imagery (arcgisonline) | Нет   |
| HYBRID    | ESRI Satellite + Stadia Toner    | Нет   |

> Все tile-источники бесплатные для личного/некоммерческого использования.
> ESRI World Imagery — публичный сервис без ключа.
> OpenStreetMap — ODbL лицензия, open data.

---

## Использование

1. **Поиск**: Начни печатать в поле вверху — автокомплит через Nominatim (OSM geocoder)
2. **Маркер**: Кликни по карте → заполни title (обязательно), note, цвет → Place Marker
3. **Просмотр**: Кликни по маркеру на карте или в списке слева
4. **Locate**: Кнопка LOCATE в правой панели центрирует карту на объекте
5. **Удаление**: Кнопка DELETE в правой панели или иконка ✕ в списке слева
6. **Basemap**: Переключатель STREET / SATELLITE / HYBRID вверху

---

## Цвета маркеров

| Цвет     | Hex       | Назначение (пример)    |
|----------|-----------|------------------------|
| GREEN    | #00ff88   | Нейтральный / POI      |
| CYAN     | #00e5ff   | Информационный         |
| YELLOW   | #ffcc00   | Внимание / Мониторинг  |
| RED      | #ff3b5c   | Угроза / Приоритет     |
| ORANGE   | #ff8c00   | Предупреждение         |
| PURPLE   | #bf5fff   | Особый / Разведка      |

---

## Известные ограничения MVP

- Нет аутентификации (локальное использование)
- Нет редактирования маркеров после создания (будет в v2)
- Гибридный basemap использует Stadia Toner для линий — при высокой нагрузке можно заменить на другой raster overlay
- CORS настроен только для localhost:5173
