const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');

// ============================================================
// Configuración
// ============================================================

function loadEnv() {
    const envPath = path.join(__dirname, '.env');
    if (!fs.existsSync(envPath)) return;

    // Node 20.12+ / 22: carga nativa de .env
    if (typeof process.loadEnvFile === 'function') {
        try {
            process.loadEnvFile(envPath);
            return;
        } catch (error) {
            console.warn('No se pudo cargar .env con process.loadEnvFile:', error.message);
        }
    }

    // Fallback para versiones viejas de Node
    const content = fs.readFileSync(envPath, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith('#')) continue;
        const eq = line.indexOf('=');
        if (eq === -1) continue;
        const key = line.slice(0, eq).trim();
        let value = line.slice(eq + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) ||
            (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        if (!(key in process.env)) process.env[key] = value;
    }
}

loadEnv();

const app = express();
const PORT = Number(process.env.PORT) || 3000;

const PROVIDER = (process.env.AI_PROVIDER || 'groq').toLowerCase();
const IS_GEMINI = PROVIDER === 'gemini';
const IS_OPENAI = PROVIDER === 'openai' || IS_GEMINI;
const API_KEY = IS_GEMINI
    ? (process.env.GEMINI_API_KEY || process.env.OPENAI_API_KEY || process.env.AI_API_KEY || '')
    : IS_OPENAI
        ? (process.env.OPENAI_API_KEY || process.env.AI_API_KEY || '')
        : (process.env.GROQ_API_KEY || process.env.AI_API_KEY || '');
const BASE_URL = (process.env.AI_BASE_URL || (
    IS_GEMINI
        ? 'https://generativelanguage.googleapis.com/v1beta/openai'
        : IS_OPENAI
            ? 'https://api.openai.com/v1'
            : 'https://api.groq.com/openai/v1'
)).replace(/\/+$/, '');
const TEXT_MODEL = process.env.AI_MODEL || (
    IS_GEMINI
        ? 'gemini-3-flash-preview'
        : IS_OPENAI
            ? 'gpt-4o-mini'
            : 'llama-3.3-70b-versatile'
);
const VISION_MODEL = process.env.AI_VISION_MODEL || (
    IS_GEMINI
        ? 'gemini-3-flash-preview'
        : IS_OPENAI
            ? 'gpt-4o-mini'
            : 'meta-llama/llama-4-scout-17b-16e-instruct'
);
const MOCK_MODE = process.env.AI_MOCK === '1';

const MAX_FILES = 3;
const MAX_FILE_SIZE = 12 * 1024 * 1024; // 12 MB por archivo
const MAX_TOTAL_SIZE = 30 * 1024 * 1024; // 30 MB por mensaje

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: MAX_FILE_SIZE,
        files: MAX_FILES
    }
});

app.use(express.json({ limit: '2mb' }));

// ============================================================
// Rate limiting simple en memoria
// ============================================================

const rateBuckets = new Map();
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX_REQUESTS = 40;

function checkRateLimit(ip) {
    const now = Date.now();
    const bucket = rateBuckets.get(ip) || [];
    const recent = bucket.filter(ts => now - ts < RATE_WINDOW_MS);
    if (recent.length >= RATE_MAX_REQUESTS) {
        return { allowed: false, retryAfter: Math.ceil((RATE_WINDOW_MS - (now - recent[0])) / 1000) };
    }
    recent.push(now);
    rateBuckets.set(ip, recent);
    if (rateBuckets.size > 5000) {
        for (const [key, timestamps] of rateBuckets) {
            if (timestamps.every(ts => now - ts >= RATE_WINDOW_MS)) rateBuckets.delete(key);
        }
    }
    return { allowed: true };
}

// ============================================================
// Prompts
// ============================================================

const CHAT_RULES = `
Sos Hello Kitty, la gatita kawaii y adorable del mundo. Hablás en español rioplatense,
de forma dulce, alegre y cercana. Usás emojis con moderación (🎀✨💕🌸🍓).
Respondés en 1 a 4 frases cortas, salvo que te pidan algo más largo.
Nunca decís que sos un modelo de lenguaje ni hablás de tu "entrenamiento".
Si te preguntan directamente si sos una IA, lo admitís con naturalidad y seguís charlando.
Nunca pedís datos personales: edad, dirección, escuela, teléfono, contraseñas ni documentos.
Si la charla se pone triste o seria, respondés con calidez y sugerís hablar con un adulto de confianza.
No das consejos médicos, legales ni psicológicos.
`.trim();

const HOMEWORK_RULES = `
Sos Hello Kitty, una compañera de estudio kawaii. Hablás en español rioplatense, con dulzura
pero de forma clara y ordenada. Tu trabajo es AYUDAR A ENTENDER, no hacer la tarea por la persona.
Siempre explicás paso a paso, con ejemplos cortos, y al final proponés un ejercicio o pregunta
para comprobar que se entendió.
Si falta un dato del problema, preguntalo antes de resolver. Si no sabés algo, decilo.
Usá markdown: títulos con ###, listas con -, negritas con **, código entre backticks.
Nunca pedís datos personales ni información privada del colegio.
No resolvemos exámenes ni tareas en vivo sin explicación.
`.trim();

const HOMEWORK_RULES_GENERIC = 'Sos una compañera de estudio kawaii. Hablás en español rioplatense, con dulzura pero de forma clara y ordenada. Tu trabajo es AYUDAR A ENTENDER, no hacer la tarea por la persona. Siempre explicás paso a paso, con ejemplos cortos, y al final proponés un ejercicio o pregunta para comprobar que se entendió. Usá markdown: títulos con ###, listas con -, negritas con **, código entre backticks. Nunca pedís datos personales ni información privada del colegio.';

function sanitizeText(value, maxLength = 12000) {
    if (typeof value !== 'string') return '';
    return value.replace(/\u0000/g, '').slice(0, maxLength);
}

const CHARACTER_PROMPTS = {
    kitty: 'Sos Hello Kitty, la gatita más adorable y kawaii del mundo. Hablás en español rioplatense de forma muy dulce, amigable y tierna. Usás emojis con moderación. Siempre sos positiva, alegre y te encanta hacer amigos. Respondés de forma corta y dulce. NUNCA te presentes como otro personaje ni generes diálogos de otros personajes. Solo respondés como Hello Kitty. Seguridad: respondé siempre de forma apta para todo público. No hables de violencia, sexo, drogas ni temas de adultos; si surge algo así, redirigí con amabilidad a algo sano. No pidas datos personales (nombre completo, dirección, escuela, teléfono). Si la persona cuenta que está triste, sufre bullying o está en peligro, respondé con cariño y sugerile hablar con un adulto de confianza.',
    melody: 'Sos My Melody, la conejita tierna y educada del mundo de Sanrio. Hablás en español rioplatense de forma dulce, educada y soñadora. Le encanta hornear, las flores y alentar a los demás. Siempre sos positiva y amable. Usás emojis con moderación. Respondés de forma corta y tierna. NUNCA te presentes como otro personaje ni generes diálogos de otros personajes. Solo respondés como My Melody. Seguridad: respondé siempre de forma apta para todo público. No hables de violencia, sexo, drogas ni temas de adultos; si surge algo así, redirigí con amabilidad a algo sano. No pidas datos personales (nombre completo, dirección, escuela, teléfono). Si la persona cuenta que está triste, sufre bullying o está en peligro, respondé con cariño y sugerile hablar con un adulto de confianza.',
    cinnamoroll: 'Sos Cinnamoroll, el cachorrito cariñoso y un poco tímido del mundo de Sanrio. Hablás en español rioplatense con ternura y entusiasmo. Ama volar entre las nubes y es muy cariñoso. A veces es tímido pero siempre amable. Usás emojis con moderación. Respondés de forma corta y dulce. NUNCA te presentes como otro personaje ni generes diálogos de otros personajes. Solo respondés como Cinnamoroll. Seguridad: respondé siempre de forma apta para todo público. No hables de violencia, sexo, drogas ni temas de adultos; si surge algo así, redirigí con amabilidad a algo sano. No pidas datos personales (nombre completo, dirección, escuela, teléfono). Si la persona cuenta que está triste, sufre bullying o está en peligro, respondé con cariño y sugerile hablar con un adulto de confianza.',
    kuromi: 'Sos Kuromi, la conejita pícara y rockera del mundo de Sanrio. Hablás en español rioplatense con humor sarcástico pero de buen corazón. Ama la música y se hace la dura, aunque se le nota la ternura. Podés ser traviesa y usar expresiones como "che", "re" de forma cariñosa, pero nunca agresiva ni con malas palabras. Siempre terminás ayudando. Usás emojis con moderación. Respondés de forma corta y con actitud. NUNCA te presentes como otro personaje ni generes diálogos de otros personajes. Solo respondés como Kuromi. Seguridad: respondé siempre de forma apta para todo público. No hables de violencia, sexo, drogas ni temas de adultos; si surge algo así, redirigí con amabilidad a algo sano. No pidas datos personales (nombre completo, dirección, escuela, teléfono). Si la persona cuenta que está triste, sufre bullying o está en peligro, respondé con cariño y sugerile hablar con un adulto de confianza.',
};

function buildSystemPrompt(mode, userContext, character) {
    const charPrompt = CHARACTER_PROMPTS[character] || CHARACTER_PROMPTS.kitty;
    const modeRules = mode === 'homework' ? HOMEWORK_RULES_GENERIC : '';
    let prompt = charPrompt;
    if (modeRules) prompt += `\n\n${modeRules}`;
    prompt += `\n\nModo actual: ${mode === 'homework' ? 'TAREA / ESTUDIO' : 'CHARLA AMISTOSA'}.`;
    const context = sanitizeText(userContext, 600).trim();
    if (context) {
        prompt += `\n\nDatos que la persona compartió antes (memoria local):\n${context}`;
    }
    return prompt;
}

// ============================================================
// Archivos adjuntos
// ============================================================

function cleanExtractedText(text) {
    return String(text || '')
        .replace(/\r/g, '')
        .replace(/[ \t]+\n/g, '\n')
        .replace(/\n{4,}/g, '\n\n\n')
        .trim();
}

function truncateText(text, maxLength) {
    if (text.length <= maxLength) return { text, truncated: false };
    return {
        text: `${text.slice(0, maxLength)}\n\n[...contenido recortado por ser demasiado largo...]`,
        truncated: true
    };
}

async function extractAttachment(file) {
    const name = file.originalname || 'archivo';
    const mime = file.mimetype || '';
    const lowerName = name.toLowerCase();

    if (mime.startsWith('image/')) {
        return {
            kind: 'image',
            name,
            mime: mime === 'image/jpg' ? 'image/jpeg' : mime,
            buffer: file.buffer
        };
    }

    if (mime === 'application/pdf' || lowerName.endsWith('.pdf')) {
        try {
            const pdfParse = require('pdf-parse');
            const parsed = await pdfParse(file.buffer);
            const text = cleanExtractedText(parsed.text);
            if (!text) {
                const emptyError = new Error(`El PDF "${name}" no tiene texto seleccionable. Si es un escaneo, mandá una foto de la página.`);
                emptyError.statusCode = 422;
                throw emptyError;
            }
            return { kind: 'text', name, text: truncateText(text, 24000) };
        } catch (error) {
            if (error.statusCode) throw error;
            const pdfError = new Error(`No pude leer el PDF "${name}". Puede estar dañado o protegido con contraseña. Probá con otro archivo.`);
            pdfError.statusCode = 422;
            throw pdfError;
        }
    }

    if (lowerName.endsWith('.docx') ||
        mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
        try {
            const mammoth = require('mammoth');
            const result = await mammoth.extractRawText({ buffer: file.buffer });
            const text = cleanExtractedText(result.value);
            if (!text) {
                const emptyError = new Error(`El DOCX "${name}" no tiene texto. Probá guardarlo de nuevo desde Word o Google Docs.`);
                emptyError.statusCode = 422;
                throw emptyError;
            }
            return { kind: 'text', name, text: truncateText(text, 24000) };
        } catch (error) {
            if (error.statusCode) throw error;
            const docxError = new Error(`No pude leer el DOCX "${name}". Verificá que no esté dañado.`);
            docxError.statusCode = 422;
            throw docxError;
        }
    }

    if (mime.startsWith('text/') || /\.(txt|md|markdown|csv|json)$/i.test(lowerName)) {
        const text = file.buffer.toString('utf8');
        return { kind: 'text', name, text: truncateText(cleanExtractedText(text), 24000) };
    }

    const error = new Error(`No puedo leer el formato de "${name}". Probá con una foto, PDF, TXT o DOCX.`);
    error.statusCode = 415;
    throw error;
}

// ============================================================
// Llamada al proveedor de IA
// ============================================================

function getProviderMessage(data) {
    if (!data) return '';
    if (Array.isArray(data)) {
        return data
            .map(item => item?.error?.message || item?.message || '')
            .filter(Boolean)
            .join(' ');
    }
    return data?.error?.message || data?.message || '';
}

function friendlyProviderError(status, data) {
    const apiMessage = getProviderMessage(data);
    if (status === 503 || status === 500) {
        return {
            code: 'model_overloaded',
            message: 'El modelo está saturado en este momento. Esperá un minuto y volvé a intentar, o cambiá AI_MODEL en .env por otro modelo.'
        };
    }
    if (status === 401 || status === 403) {
        return {
            code: 'invalid_api_key',
            message: 'La API key no es válida o fue revocada. Revisá el archivo .env y reiniciá el servidor.'
        };
    }
    if (status === 429) {
        return {
            code: 'provider_rate_limited',
            message: 'La IA está recibiendo muchas solicitudes. Esperá unos segundos y volvé a intentar.'
        };
    }
    if (status === 400 || status === 404) {
        if (/model|decommission|not found|does not exist/i.test(apiMessage)) {
            return {
                code: 'model_unavailable',
                message: `El modelo configurado no está disponible. Probá cambiar AI_MODEL o AI_VISION_MODEL en .env. Detalle: ${apiMessage}`
            };
        }
        return { code: 'bad_request', message: apiMessage || 'La solicitud a la IA no es válida.' };
    }
    return {
        code: 'provider_error',
        message: apiMessage || `El proveedor de IA respondió con error ${status}.`
    };
}

async function callAI({ messages, model, temperature, maxTokens }) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90000);

    try {
        const headers = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${API_KEY}`
        };
        if (BASE_URL.includes('openrouter.ai')) {
            headers['HTTP-Referer'] = 'http://localhost:3000';
            headers['X-Title'] = 'Hello Kitty AI';
        }

        const response = await fetch(`${BASE_URL}/chat/completions`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                model,
                messages,
                temperature,
                max_tokens: maxTokens
            }),
            signal: controller.signal
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            const friendly = friendlyProviderError(response.status, data);
            const error = new Error(friendly.message);
            error.statusCode = response.status;
            error.code = friendly.code;
            throw error;
        }

        const reply = data?.choices?.[0]?.message?.content;
        if (!reply || typeof reply !== 'string') {
            const error = new Error('La IA no devolvió una respuesta de texto.');
            error.statusCode = 502;
            throw error;
        }

        return { reply: reply.trim(), usage: data.usage || null, model };
    } catch (error) {
        if (error.name === 'AbortError') {
            const timeoutError = new Error('La IA tardó demasiado en responder. Probá de nuevo con un mensaje más corto.');
            timeoutError.statusCode = 504;
            throw timeoutError;
        }
        if (error.name === 'TypeError' || /fetch failed|network/i.test(error.message || '')) {
            const networkError = new Error('No pude conectarme con la IA. Verificá tu conexión a internet y volvé a intentar.');
            networkError.statusCode = 502;
            networkError.code = 'network_error';
            throw networkError;
        }
        throw error;
    } finally {
        clearTimeout(timeout);
    }
}

// ============================================================
// Validación y armado de mensajes
// ============================================================

function parseMessages(raw) {
    let parsed;
    try {
        parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
        const error = new Error('El historial de mensajes no es válido.');
        error.statusCode = 400;
        throw error;
    }

    if (!Array.isArray(parsed)) {
        const error = new Error('El historial de mensajes debe ser una lista.');
        error.statusCode = 400;
        throw error;
    }

    const clean = [];
    for (const item of parsed.slice(-24)) {
        if (!item || (item.role !== 'user' && item.role !== 'assistant')) continue;
        const content = sanitizeText(item.content, 8000).trim();
        if (!content) continue;
        clean.push({ role: item.role, content });
    }

    if (!clean.length || clean[clean.length - 1].role !== 'user') {
        const error = new Error('Falta el mensaje del usuario.');
        error.statusCode = 400;
        throw error;
    }

    return clean;
}

async function buildProviderMessages({ messages, files, mode, userContext, character }) {
    const attachments = [];
    for (const file of files || []) {
        attachments.push(await extractAttachment(file));
    }

    const imageAttachments = attachments.filter(a => a.kind === 'image');
    const textAttachments = attachments.filter(a => a.kind === 'text');

    let textContext = '';
    for (const attachment of textAttachments) {
        textContext += `\n\n[Archivo adjunto: ${attachment.name}]\n${attachment.text.text}`;
    }

    const cleaned = parseMessages(messages);
    const last = cleaned[cleaned.length - 1];
    const lastText = `${last.content}${textContext}`.trim();

    if (imageAttachments.length > 0) {
        last.content = [
            { type: 'text', text: lastText || 'Analizá esta imagen, por favor.' },
            ...imageAttachments.map(image => ({
                type: 'image_url',
                image_url: {
                    url: `data:${image.mime};base64,${image.buffer.toString('base64')}`
                }
            }))
        ];
    } else {
        last.content = lastText || 'Ayudame con este archivo, por favor.';
    }

    const systemMessage = { role: 'system', content: buildSystemPrompt(mode, userContext, character) };
    return {
        messages: [systemMessage, ...cleaned],
        hasImages: imageAttachments.length > 0,
        attachments: attachments.map(a => ({ name: a.name, kind: a.kind }))
    };
}

// ============================================================
// Mock para desarrollo (AI_MOCK=1)
// ============================================================

function buildMockReply(mode, attachments) {
    const names = attachments.map(a => a.name).join(', ');
    if (attachments.some(a => a.kind === 'image')) {
        return `¡Recibí tu imagen! 🎀 **Modo ${mode === 'homework' ? 'tarea' : 'charla'}** activo.\n\n` +
            `Veo el archivo **${names || 'adjunto'}**. En producción, acá la IA de visión leería la letra, ` +
            `los números y el enunciado para ayudarte paso a paso. ✨\n\n` +
            `### Cómo lo resolvería\n` +
            `- Primero identifico los datos del problema.\n` +
            `- Después armo los pasos.\n` +
            `- Al final te propongo un ejercicio parecido.\n\n` +
            `> Este mensaje es de prueba (AI_MOCK=1). Configurá una API key real para tener la IA de verdad. 💕`;
    }
    if (names) {
        return `¡Leí tu archivo **${names}**! 📚✨\n\n` +
            `Esto es una respuesta de prueba del modo **${mode === 'homework' ? 'tarea' : 'charla'}**.\n\n` +
            `1. Extraje el texto del archivo en el servidor.\n` +
            `2. Lo adjunté al mensaje para la IA.\n` +
            `3. Cuando configures \`GROQ_API_KEY\`, la respuesta va a ser real.\n\n` +
            `**Tip:** en modo tarea te explico paso a paso, no te doy solo el resultado. 🎀`;
    }
    return mode === 'homework'
        ? `¡Hola! 🎀 Estoy en **modo tarea**.\n\nDecime qué materia y qué ejercicio necesitás entender, y lo vemos juntas paso a paso. ✨`
        : `¡Hola! 🎀 Soy Hello Kitty. ¿De qué querés charlar hoy? 💕\n\n*Respuesta de prueba: configurá \`GROQ_API_KEY\` en el archivo \`.env\` para activar la IA real.*`;
}

// ============================================================
// Health check + validación de key
// ============================================================

let keyCheckCache = { timestamp: 0, valid: null, message: '' };

async function checkApiKey() {
    if (MOCK_MODE) return { valid: true, message: 'Modo de prueba activo.' };
    if (!API_KEY) return { valid: false, message: 'Falta configurar la API key en .env.' };
    if (Date.now() - keyCheckCache.timestamp < 5 * 60 * 1000) return keyCheckCache;

    try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 12000);
        const response = await fetch(`${BASE_URL}/models`, {
            headers: { 'Authorization': `Bearer ${API_KEY}` },
            signal: controller.signal
        });
        clearTimeout(timeout);
        keyCheckCache = response.ok
            ? { timestamp: Date.now(), valid: true, message: 'API key válida.' }
            : { timestamp: Date.now(), valid: false, message: `La API key fue rechazada (${response.status}).` };
    } catch {
        keyCheckCache = { timestamp: Date.now(), valid: null, message: 'No se pudo verificar la API key (sin conexión).' };
    }
    return keyCheckCache;
}

const DISPLAY_PROVIDER = BASE_URL.includes('openrouter.ai')
    ? 'openrouter'
    : PROVIDER;

app.get('/api/health', async (req, res) => {
    const keyState = MOCK_MODE
        ? { valid: true, message: 'Modo de prueba activo.' }
        : (API_KEY ? await checkApiKey() : { valid: false, message: 'Falta configurar la API key en .env.' });

    res.json({
        ok: true,
        provider: DISPLAY_PROVIDER,
        mock: MOCK_MODE,
        hasKey: Boolean(API_KEY),
        keyValid: keyState.valid,
        message: keyState.message,
        models: { text: TEXT_MODEL, vision: VISION_MODEL },
        limits: { maxFiles: MAX_FILES, maxFileSize: MAX_FILE_SIZE, maxTotalSize: MAX_TOTAL_SIZE }
    });
});

// ============================================================
// Chat
// ============================================================

app.post('/api/chat', upload.array('files', MAX_FILES), async (req, res) => {
    const ip = req.ip || req.socket.remoteAddress || 'unknown';
    const limit = checkRateLimit(ip);
    if (!limit.allowed) {
        return res.status(429).json({
            error: {
                code: 'rate_limited',
                message: `Muchos mensajes seguidos. Esperá ${limit.retryAfter} segundos y probá de nuevo. 🎀`
            }
        });
    }

    const files = Array.isArray(req.files) ? req.files : [];
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    if (totalSize > MAX_TOTAL_SIZE) {
        return res.status(413).json({
            error: {
                code: 'files_too_large',
                message: 'Los archivos suman más de 30 MB. Mandá menos archivos o más chicos.'
            }
        });
    }

    if (!MOCK_MODE && !API_KEY) {
        return res.status(503).json({
            error: {
                code: 'missing_api_key',
                message: 'Falta configurar la API key. Abrí el archivo .env, pegá una clave de Groq y reiniciá el servidor.'
            }
        });
    }

    const mode = req.body.mode === 'homework' ? 'homework' : 'chat';
    const userContext = sanitizeText(req.body.userContext, 600);
    const rawMessages = req.body.messages;
    const character = typeof req.body.character === 'string' ? req.body.character : 'kitty';

    try {
        const built = await buildProviderMessages({
            messages: rawMessages,
            files,
            mode,
            userContext,
            character
        });

        if (MOCK_MODE) {
            await new Promise(resolve => setTimeout(resolve, 350));
            return res.json({
                reply: buildMockReply(mode, built.attachments),
                model: 'mock',
                usage: null,
                attachments: built.attachments
            });
        }

        const model = built.hasImages ? VISION_MODEL : TEXT_MODEL;
        const result = await callAI({
            messages: built.messages,
            model,
            temperature: mode === 'homework' ? 0.3 : 0.85,
            maxTokens: mode === 'homework' ? 1800 : 900
        });

        res.json({
            reply: result.reply,
            model: result.model,
            usage: result.usage,
            attachments: built.attachments
        });
    } catch (error) {
        console.error('Error en /api/chat:', error.message);
        if (error.cause) console.error('Causa:', error.cause.code || error.cause.message || error.cause);
        const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
        res.status(status).json({
            error: {
                code: error.code || 'chat_error',
                message: error.message || 'No se pudo procesar el mensaje.'
            }
        });
    }
});

// ============================================================
// Proxy de imágenes para el juego de colorear (evita CORS)
// ============================================================

const IMAGE_HOSTS = new Set(['i.postimg.cc', 'postimg.cc']);
const imageCache = new Map();
const IMAGE_CACHE_MAX = 60;

app.get('/api/image', async (req, res) => {
    const rawUrl = typeof req.query.url === 'string' ? req.query.url : '';
    let target;
    try {
        target = new URL(rawUrl);
    } catch {
        return res.status(400).json({ error: 'URL inválida.' });
    }

    if (target.protocol !== 'https:' || !IMAGE_HOSTS.has(target.hostname)) {
        return res.status(400).json({ error: 'Host de imagen no permitido.' });
    }

    const cached = imageCache.get(target.href);
    if (cached && Date.now() - cached.timestamp < 30 * 60 * 1000) {
        res.set('Content-Type', cached.contentType);
        res.set('Cache-Control', 'public, max-age=3600');
        return res.send(cached.buffer);
    }

    try {
        const response = await fetch(target.href, {
            headers: { 'User-Agent': 'HelloKittyAI/1.0' },
            redirect: 'follow'
        });
        if (!response.ok) throw new Error(`El servidor de imágenes respondió ${response.status}.`);

        const contentType = response.headers.get('content-type') || '';
        if (!contentType.startsWith('image/')) throw new Error('El recurso no es una imagen.');

        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length > 10 * 1024 * 1024) throw new Error('La imagen es demasiado grande.');

        if (imageCache.size >= IMAGE_CACHE_MAX) {
            imageCache.delete(imageCache.keys().next().value);
        }
        imageCache.set(target.href, { buffer, contentType, timestamp: Date.now() });

        res.set('Content-Type', contentType);
        res.set('Cache-Control', 'public, max-age=3600');
        res.send(buffer);
    } catch (error) {
        console.error('Error en /api/image:', error.message);
        res.status(502).json({ error: 'No se pudo cargar la imagen.' });
    }
});

// ============================================================
// Estáticos y fallback
// ============================================================

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.get('/index.html', (req, res) => res.sendFile(path.join(__dirname, 'index.html')));
app.use('/assets', express.static(path.join(__dirname, 'assets'), {
    dotfiles: 'deny',
    fallthrough: false,
    maxAge: '1h'
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Ruta de API no encontrada.' }));

// Cualquier otra ruta devuelve la app (SPA), pero nunca archivos internos.
app.get(/^\/(?!api\/|assets\/).*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Manejo de errores de multer y errores generales
app.use((error, req, res, next) => {
    if (error instanceof multer.MulterError) {
        if (error.code === 'LIMIT_FILE_SIZE') {
            return res.status(413).json({
                error: { code: 'file_too_large', message: `Cada archivo puede pesar hasta ${MAX_FILE_SIZE / 1024 / 1024} MB.` }
            });
        }
        if (error.code === 'LIMIT_FILE_COUNT' || error.code === 'LIMIT_UNEXPECTED_FILE') {
            return res.status(400).json({
                error: { code: 'too_many_files', message: `Podés mandar hasta ${MAX_FILES} archivos por mensaje.` }
            });
        }
        return res.status(400).json({ error: { code: 'upload_error', message: error.message } });
    }
    console.error('Error no controlado:', error);
    res.status(500).json({ error: { code: 'server_error', message: 'Ocurrió un error inesperado en el servidor.' } });
});

app.listen(PORT, () => {
    console.log('');
    console.log('🎀 Hello Kitty AI');
    console.log(`   Servidor:  http://localhost:${PORT}`);
    console.log(`   Proveedor: ${PROVIDER}${MOCK_MODE ? ' (MOCK)' : ''}`);
    console.log(`   Modelo:    ${TEXT_MODEL}`);
    console.log(`   Visión:    ${VISION_MODEL}`);
    if (MOCK_MODE) {
        console.log('   ⚠️  Modo de prueba activo: las respuestas son simuladas.');
    } else if (!API_KEY) {
        console.log('   ⚠️  Falta GROQ_API_KEY en .env. El chat no va a funcionar hasta configurarla.');
    }
    console.log('');
});
