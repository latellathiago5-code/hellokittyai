# 🎀 Hello Kitty AI

Chat kawaii con Hello Kitty para charlar, estudiar y jugar. Ahora también podés **mandarle fotos y archivos** (como en ChatGPT) para que te ayude con las tareas del colegio.

> Proyecto fan hecho con cariño. Hello Kitty y sus amigos son marcas de Sanrio.

---

## ✨ Qué incluye

- 💬 **Chat con personalidad**: Hello Kitty responde en español rioplatense, con dulzura y emojis.
- 📚 **Modo Tarea**: explica paso a paso, con ejemplos, y no hace la tarea por vos.
- 📎 **Adjuntos**: fotos, PDF, TXT, DOCX, MD, CSV y JSON (hasta 3 archivos por mensaje).
- 🖼️ **Visión**: puede mirar fotos de ejercicios, apuntes o pizarrones.
- ✍️ **Markdown**: respuestas ordenadas con títulos, listas, negritas y código.
- 🎮 **5 mini-juegos**: Memoria, Colorear, Ahorcado, Ta-Te-Ti y Vestir a Kitty.
- 🛍️ **Tienda kawaii**: monedas, fondos, efectos y álbum de outfits guardados.
- 📖 **Álbum de recuerdos**: guardá mensajes importantes del chat.
- 🌙 **Modo oscuro**, sonidos, logros, racha diaria e historial de conversaciones.

---

## 🚀 Cómo arrancarlo

### 1. Requisitos

- [Node.js](https://nodejs.org/) 18 o superior (recomendado 20+).
- Una API key **gratis** de Google Gemini: <https://aistudio.google.com/apikey>
  - También funciona con Groq: <https://console.groq.com/keys>

### 2. Instalar dependencias

Abrí una terminal en esta carpeta y ejecutá:

```bash
npm install
```

### 3. Configurar la API key

1. Copiá el archivo `.env.example` y renombralo a `.env`.
2. Abrí `.env` con el Bloc de notas.
3. Configurá **una** de las dos opciones:

**Opción A — Google Gemini (recomendada):**

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=AQ.tu_clave_aca
AI_MODEL=gemini-3-flash-preview
AI_VISION_MODEL=gemini-3-flash-preview
```

**Opción B — Groq:**

```env
AI_PROVIDER=groq
GROQ_API_KEY=gsk_tu_clave_aca
AI_MODEL=llama-3.3-70b-versatile
AI_VISION_MODEL=meta-llama/llama-4-scout-17b-16e-instruct
```

4. Guardá el archivo.

> 🔒 La clave queda **solo en el servidor**. El navegador nunca la ve: el frontend habla con `/api/chat` y el servidor agrega la clave al llamar al proveedor.

### 4. Iniciar

```bash
npm start
```

Abrí <http://localhost:3000> en el navegador. ¡Listo! 🎀

Para desarrollo con recarga automática:

```bash
npm run dev
```

---

## 🧪 Probar sin API key (modo demo)

Si querés ver la app funcionando antes de configurar la clave:

```bash
# Windows PowerShell
$env:AI_MOCK=1; npm start

# Windows CMD
set AI_MOCK=1 && npm start

# macOS / Linux
AI_MOCK=1 npm start
```

En modo demo las respuestas son simuladas, pero podés probar adjuntos, modo tarea, juegos, tienda y álbum.

Para volver al modo real, cerrá el servidor y ejecutá `npm start` sin `AI_MOCK`.

---

## 📎 Archivos compatibles

| Tipo | Formatos | Qué hace |
|------|----------|----------|
| Imágenes | JPG, PNG, WEBP, GIF | La IA las mira (visión) |
| Documentos | PDF, DOCX | Extrae el texto en el servidor |
| Texto | TXT, MD, CSV, JSON | Lee el contenido tal cual |

**Límites:** 3 archivos por mensaje, 12 MB por archivo y 30 MB en total. También podés arrastrar archivos al cuadro de texto o pegarlos con `Ctrl+V`.

> Los PDF escaneados (fotos dentro de un PDF) no tienen texto seleccionable. En ese caso mandá una foto de la página.

---

## ⚙️ Configuración opcional

Todas las variables van en `.env`:

```env
# Proveedor: gemini | groq | openai
AI_PROVIDER=gemini

# Modelo de texto y de visión (Gemini)
AI_MODEL=gemini-3-flash-preview
AI_VISION_MODEL=gemini-3-flash-preview

# Puerto
PORT=3000

# OpenRouter (acceso a muchos modelos)
# AI_PROVIDER=openai
# OPENAI_API_KEY=sk-or-v1-...
# AI_BASE_URL=https://openrouter.ai/api/v1
# AI_MODEL=google/gemini-2.5-flash
# AI_VISION_MODEL=google/gemini-2.5-flash

# Otro proveedor compatible con OpenAI (opcional)
# AI_PROVIDER=openai
# OPENAI_API_KEY=sk-...
# AI_BASE_URL=https://api.openai.com/v1
# AI_MODEL=gpt-4o-mini
# AI_VISION_MODEL=gpt-4o-mini
```

Si usás OpenRouter, el servidor envía automáticamente los headers `HTTP-Referer` y `X-Title` recomendados.

Si Gemini te responde **503 (modelo saturado)**, esperá un minuto o probá otro modelo de la lista, por ejemplo `gemini-3.1-flash-lite` o `gemini-3.5-flash`.

Después de cambiar `.env`, **reiniciá el servidor** (`Ctrl+C` y de nuevo `npm start`).

---

## 🛠️ Si algo no funciona

### Aparece un aviso amarillo arriba del chat

- **"Falta tu API key"** → abrí `.env`, pegá `GEMINI_API_KEY=...` (o `GROQ_API_KEY=...`) y reiniciá.
- **"La API key no es válida"** → generá una nueva en <https://aistudio.google.com/apikey> o <https://console.groq.com/keys>. Las claves se pueden revocar o vencer.
- **"No pude contactar al servidor"** → verificá que la terminal siga abierta con `npm start`.

### El puerto 3000 está ocupado

Cambiá el puerto en `.env`:

```env
PORT=3001
```

Y abrí <http://localhost:3001>.

### El PDF no se lee

Puede estar dañado, protegido con contraseña o ser un escaneo sin texto. Probá abrirlo y volver a guardarlo como PDF, o mandá una foto.

### La IA tarda, responde 429 o 503

- **429**: es el límite del proveedor. Esperá unos segundos y volvé a intentar. El servidor ya incluye un límite propio de 40 mensajes cada 10 minutos por IP.
- **503 / "modelo saturado"**: el modelo elegido está con mucha demanda. Esperá un minuto o cambiá `AI_MODEL` por otro modelo disponible en `.env` y reiniciá.

---

## 🗂️ Estructura del proyecto

```
hellokittyai/
├── index.html        # Toda la interfaz, estilos y juegos
├── server.js         # Servidor Express + proxy seguro de IA
├── package.json      # Dependencias y scripts
├── .env              # Tu API key (NO se sube a internet)
├── .env.example      # Plantilla de configuración
├── assets/
│   ├── kitty.svg             # Avatar principal
│   ├── kitty-base.svg        # Base del juego de vestir
│   └── coloring-lineart.svg  # Dibujo local para colorear
└── README.md
```

### Endpoints del servidor

| Método | Ruta | Para qué |
|--------|------|----------|
| `GET` | `/api/health` | Estado del servidor y de la API key |
| `POST` | `/api/chat` | Enviar mensajes y archivos (`multipart/form-data`) |
| `GET` | `/api/image?url=...` | Proxy de imágenes del juego de colorear |

---

## 🔐 Privacidad

- Las conversaciones y los recuerdos se guardan **en tu navegador** (`localStorage`).
- Los archivos se procesan **en memoria** en el servidor y se envían al proveedor de IA para responder. No se guardan en disco.
- La API key nunca se envía al frontend.
- No compartas tu `.env` ni lo subas a GitHub (ya está incluido en `.gitignore`).

---

## 🚀 Deploy (para que funcione online sin que el usuario configure nada)

### Opción A: Render (gratis, con UptimeRobot para que no se duerma)

1. Entrá a https://render.com y creá una cuenta con GitHub.
2. **New +** → **Web Service** → conectá el repo `hellokittyai`.
3. Render detecta el `render.yaml` automáticamente.
4. En **Environment Variables**, agregá `OPENAI_API_KEY` con tu clave de OpenRouter.
5. Clic en **Create Web Service**. Te da una URL tipo `https://hellokittyai.onrender.com`.
6. **Para que no se duerma**: creá una cuenta gratis en https://uptimerobot.com, agregá un monitor HTTP que haga ping a `https://tu-app.onrender.com/api/health` cada 5 minutos. Así el servidor nunca se duerma.

### Opción B: Railway (gratis con créditos)

1. Entrá a https://railway.app y creá una cuenta con GitHub.
2. **New Project** → **Deploy from GitHub repo** → seleccioná `hellokittyai`.
3. Agregá las variables de entorno (`OPENAI_API_KEY`, etc.).
4. Railway te da una URL. No se duerme mientras tengas créditos (US$5/mes gratis, suficiente).

### Opción C: Fly.io (gratis, siempre activo)

1. Instalá flyctl: https://fly.io/docs/hands-on/install-flyctl/
2. `fly launch` en la carpeta del proyecto.
3. `fly secrets set OPENAI_API_KEY=sk-or-v1-...`
4. `fly deploy`. La app queda siempre activa en el plan gratuito.

---

## 💕 Créditos

Hecho para aprender, crear y jugar. Si te gusta, ¡compartilo con alguien que también quiera una amiga kawaii para estudiar! 🎀✨
