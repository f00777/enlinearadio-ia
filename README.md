# EnLínea Radio IA — Monitoreo y Certificación Automatizada de Pauta Radial

Aplicación web (MVP) construida con **Next.js (App Router)** para grabar o cargar bloques de transmisión radial (hasta 30 minutos continuos), transcribirlos con marcas de tiempo mediante IA, corregir fonéticamente marcas comerciales usando la pauta del jefe de locutores, certificar las menciones publicitarias con su cita textual exacta y enviar el reporte consolidado por WhatsApp.

> **Arquitectura sin estado (Stateless):** Todo el flujo vive en memoria en el cliente (React state) durante la sesión y se reinicia al finalizar. No utiliza base de datos, almacenamiento en disco en servidor ni binarios nativos (FFmpeg/Puppeteer), por lo que es 100% compatible con **Vercel Serverless (Plan Hobby)**.

---

## Tabla de Contenidos

1. [¿Para qué sirve este proyecto?](#1-para-qué-sirve-este-proyecto)
2. [Stack Tecnológico y Restricciones de Infraestructura](#2-stack-tecnológico-y-restricciones-de-infraestructura)
3. [Estructura de Archivos del Proyecto](#3-estructura-de-archivos-del-proyecto)
4. [Variables de Entorno (`.env.local`)](#4-variables-de-entorno-envlocal)
5. [Instalación y Ejecución Local](#5-instalación-y-ejecución-local)
6. [Documentación del Frontend (Wizard de 4 Módulos)](#6-documentación-del-frontend-wizard-de-4-módulos)
7. [Documentación de Endpoints API (Backend)](#7-documentación-de-endpoints-api-backend)
8. [Guía Rápida para Modificar Contenidos o Reglas](#8-guía-rápida-para-modificar-contenidos-o-reglas)
9. [Particularidad del Sandbox de Meta WhatsApp (Ventana de 24h)](#9-particularidad-del-sandbox-de-meta-whatsapp-ventana-de-24h)

---

## 1. ¿Para qué sirve este proyecto?

En una emisora de radio, los locutores deben realizar menciones comerciales en vivo o leer frases de auspiciadores durante sus bloques. Este sistema automatiza la auditoría y certificación de esas menciones en 4 pasos secuenciales:

1. **Captura:** Graba el bloque al aire desde el navegador (o recibe un archivo de audio `< 4.5 MB`) junto con el mensaje de pauta enviado por el jefe de locutores.
2. **Transcripción horaria y corrección fonética:** Convierte el audio a texto con timestamps `[MM:SS]` y corrige nombres de marcas mal pronunciadas o escritas fonéticamente (ej. `"Banco de sile"` → `"Banco de Chile"`, `"llanqui candol"` → `"Yankee Candle"`).
3. **Certificación publicitaria:** Extrae en JSON cada auspiciador mencionado, su marca de tiempo exacta, el tipo de mención (`Mención en vivo` o `Frase comercial`) y la cita textual probatoria.
4. **Despacho por WhatsApp:** Envía el acta consolidada directamente a WhatsApp mediante Meta Cloud API (`v25.0`) y permite reiniciar la sesión limpia.

---

## 2. Stack Tecnológico y Restricciones de Infraestructura

| Componente | Tecnología / Proveedor | Detalle |
| :--- | :--- | :--- |
| Framework | Next.js `16.4.6` (App Router, Turbopack) | React `19.3.0`, TypeScript `^5` |
| Estilos e Íconos | Tailwind CSS `4.3.3` + `lucide-react` | Estética minimalista de consola de control radial |
| Speech-to-Text | Groq API (`whisper-large-v3`) | Transcripción en español con `verbose_json` y marcas de tiempo |
| Corrección y Auditoría LLM | Groq API (`openai/gpt-oss-120b`) | Temperatura `0` y salida estricta `json_object` |
| Mensajería | Meta WhatsApp Cloud API (`v25.0`) | Envío de texto libre (`type: text`) y plantilla de apertura (`hello_world`) |

### Límites críticos respetados en el código
- **Límite de Payload en Vercel (`4.5 MB`):** `MediaRecorder` en el navegador graba en mono (`channelCount: 1`), `16000 Hz`, códec `audio/webm;codecs=opus` y bitrate `18000 bps` (~3.8 MB para 30 minutos). Tanto frontend (`MAX_BYTES`) como backend (`MAX_FILE_SIZE_BYTES`) bloquean archivos mayores a `4.5 MB`.
- **Prevención de Timeouts Serverless:** Los procesos no están encadenados en un solo endpoint; existen **3 API Routes independientes** invocadas paso a paso desde el navegador.
- **Límite de Tokens por Minuto (Groq Free Tier `8.000 TPM`):** `/api/detect-sponsors` divide automáticamente transcripciones de más de `22.000` caracteres (`MAX_CHUNK_CHARS`) en fragmentos por salto de línea antes de consultar al LLM.

---

## 3. Estructura de Archivos del Proyecto

```text
enlinearadio-ia/
├── .env.local                      # Credenciales privadas (Groq y Meta WhatsApp)
├── next.config.ts                  # Configuración Next.js (cacheComponents, turbopack)
├── package.json                    # Dependencias y scripts (dev, build, start, lint)
├── public/
│   └── demo-pauta.webm             # Audio de demostración (25s, 18 kbps Opus, ~59 KB)
└── app/
    ├── globals.css                 # Variables CSS globales y fuente sans/mono
    ├── layout.tsx                  # RootLayout (<html lang="es">) y metadatos SEO
    ├── page.tsx                    # UI completa del Wizard en 4 pasos ("use client")
    └── api/
        ├── transcribe/
        │   └── route.ts            # POST /api/transcribe (Whisper + corrección con pauta)
        ├── detect-sponsors/
        │   └── route.ts            # POST /api/detect-sponsors (Extracción JSON de marcas)
        └── send-whatsapp/
            └── route.ts            # POST /api/send-whatsapp (Envío texto / plantilla Meta)
```

---

## 4. Variables de Entorno (`.env.local`)

El proyecto requiere **4 variables** definidas en `enlinearadio-ia/.env.local` (y en Environment Variables si se despliega en Vercel):

```env
GROQ_API_KEY=gsk_...
WHATSAPP_TOKEN=EAA...
WHATSAPP_PHONE_ID=1447599878441347
WHATSAPP_TEST_RECIPIENT=56958076004
```

| Variable | Uso | Dónde se lee |
| :--- | :--- | :--- |
| `GROQ_API_KEY` | Autentica peticiones a Groq (`whisper-large-v3` y `openai/gpt-oss-120b`). | `app/api/transcribe/route.ts`, `app/api/detect-sponsors/route.ts` |
| `WHATSAPP_TOKEN` | Bearer token de Meta Graph API (`v25.0`) con permiso `whatsapp_business_messaging`. | `app/api/send-whatsapp/route.ts` |
| `WHATSAPP_PHONE_ID` | ID del número remitente en Meta Cloud API (ej. número Sandbox `+1 555-163-0956`). | `app/api/send-whatsapp/route.ts` |
| `WHATSAPP_TEST_RECIPIENT` | Número destinatario por defecto en formato internacional sin `+` (ej. `56958076004`). | `app/api/send-whatsapp/route.ts` |

---

## 5. Instalación y Ejecución Local

```bash
cd enlinearadio-ia
npm install
npm run dev
```

Abrir [http://localhost:3000](http://localhost:3000).

### Comandos útiles de verificación
```bash
npx tsc --noEmit   # Verifica tipos TypeScript
npm run lint       # Ejecuta ESLint
npm run build      # Compilación de producción (simula build de Vercel)
```

---

## 6. Documentación del Frontend (Wizard de 4 Módulos)

Toda la interfaz del wizard reside en el componente cliente `RadioMonitorWizard` en `app/page.tsx`. El flujo se controla mediante el estado `step: 1 | 2 | 3 | 4`.

### Estados principales (`app/page.tsx`)
- **Paso 1 (Grabación y Pauta):** `isRecording`, `recordingSeconds`, `audioBlob`, `audioUrl`, `audioSourceLabel`, `pautaMessage`, `recorderError`.
- **Paso 2 (Transcripción):** `isTranscribing`, `segments`, `formattedText`, `transcribeError`.
- **Paso 3 (Certificación):** `isDetecting`, `auspiciadores`, `detectError`.
- **Paso 4 (WhatsApp):** `isSendingWhatsApp`, `whatsAppResult`, `whatsAppError`, `isSendingTemplate`, `templateStatus`.

### Detalle de cada módulo en pantalla

#### Módulo 01 · Captura de Señal (`step === 1`)
- **Cronómetro en tiempo real (`MM:SS`)** y botón de micrófono (`handleStartRecording` / `handleStopRecording`).
- **Configuración de `MediaRecorder`:** `channelCount: 1`, `sampleRate: 16000`, `audioBitsPerSecond: 18000`, `audio/webm;codecs=opus`.
- **Reproductor `<audio controls>`:** Aparece al detener la grabación o cargar un audio para validar la captura antes de transcribir.
- **Campo `Mensaje de Pauta / Auspiciadores (Jefe de Locutores)` (`#pauta-message`):** `<textarea>` donde se pega la lista de marcas o texto de guía que el jefe envió al locutor. Se envía junto con el audio en el paso siguiente para corregir errores fonéticos.
- **Opciones alternativas:**
  - Input discreto `<input type="file" accept="audio/*" />` (`handleFileUpload`) validando `< 4.5 MB`.
  - Botón **"Cargar muestra radial de prueba (25s)"** (`handleLoadDemoSample`) que carga `/demo-pauta.webm`.
- **Transición (`Siguiente`):** Ejecuta `handleProceedToTranscription()`, arma un `FormData` con `file` y `pautaMessage`, y llama a `POST /api/transcribe`.

#### Módulo 02 · Transcripción con Marcas de Tiempo (`step === 2`)
- Muestra un contenedor con scroll y tipografía monoespaciada con líneas en formato `[MM:SS] Texto...`.
- Si se ingresó `pautaMessage` en el Paso 1, muestra el badge `✓ Pauta de auspiciadores aplicada`.
- **Botón `Descargar Transcripción (.txt)` (`handleDownloadTxt`):** Genera un `Blob` UTF-8 y descarga `transcripcion-radial-YYYY-MM-DD-HH-mm-ss.txt` en el navegador.
- **Transición (`Siguiente`):** Ejecuta `handleProceedToSponsorDetection()`, enviando `{ transcript: formattedText, pautaMessage }` a `POST /api/detect-sponsors`.

#### Módulo 03 · Dashboard de Menciones Publicitarias y Certificación (`step === 3`)
- **Botón `Descargar PDF` (`handleDownloadPdf`):** Genera y descarga en el navegador (`jspdf`) un certificado en formato `.pdf` (`certificado-pauta-YYYY-MM-DD-HH-mm-ss.pdf`) sin logos externos, con exactamente los mismos datos mostrados en pantalla (encabezado, fecha/hora, las 3 tarjetas KPI y el acta detallada de menciones certificadas con sus citas textuales).
- **3 Tarjetas KPI:**
  1. *Total Menciones Detectadas* (`auspiciadores.length`)
  2. *Marcas / Auspiciadores Únicos* (`uniqueBrandsCount`)
  3. *Estado General* (`Certificado por IA`)
- **Acta de Menciones Certificadas:** Lista cada mención detectada con:
  - Timestamp `[MM:SS]`
  - Nombre de la `marca`
  - Tipo (`Mención en vivo` / `Frase comercial`)
  - Badge visual `Certificado`
  - Cita textual exacta (`<blockquote>`) extraída como respaldo probatorio.
- **Transición (`Enviar Reporte por WhatsApp (Siguiente)`):** Ejecuta `handleProceedToWhatsApp()`, enviando `{ auspiciadores }` a `POST /api/send-whatsapp`.

#### Módulo 04 · Despacho Meta WhatsApp Cloud API (`step === 4`)
- Muestra el banner de confirmación con el número destinatario, el `messageId` (`wamid...`) devuelto por Meta y la **vista previa exacta** del mensaje enviado.
- Incluye un panel de ayuda para la **ventana de 24h de Meta Sandbox** con 2 botones:
  1. `1. Enviar plantilla hello_world (Abre chat)` (`handleSendHelloTemplate` → `{ mode: "template_hello" }`)
  2. `2. Reenviar Reporte de Texto Ahora` (`handleProceedToWhatsApp`)
- **Botón `Nueva Grabación / Reiniciar` (`handleReset`):** Limpia todos los estados en memoria (audio, pauta, transcripción, menciones y estado de WhatsApp) y regresa al Paso 1.

---

## 7. Documentación de Endpoints API (Backend)

### 1. `POST /api/transcribe`
Archivo: `app/api/transcribe/route.ts`

- **Entrada (`multipart/form-data`):**
  - `file` (`Blob` / `File`, obligatorio): Audio `<= 4.5 MB`.
  - `pautaMessage` (`string`, opcional): Mensaje del jefe de locutores con marcas/auspiciadores esperados.
- **Proceso interno:**
  1. Valida `GROQ_API_KEY`, existencia del archivo, tamaño `> 0` y `<= 4.5 MB` (retorna `413` si excede).
  2. Construye el `prompt` de Whisper incluyendo hasta 650 caracteres de `pautaMessage`.
  3. Llama a `https://api.groq.com/openai/v1/audio/transcriptions` con:
     - `model: "whisper-large-v3"`
     - `language: "es"`
     - `response_format: "verbose_json"`
  4. Si `pautaMessage` no está vacío, ejecuta `refineSegmentsWithPauta(segments, pautaMessage, apiKey)` llamando a `openai/gpt-oss-120b` (`temperature: 0`, `json_object`) para corregir errores fonéticos u omisiones de letras (ej. `"sile"` → `"Chile"`, `"llanqui candol"` → `"Yankee Candle"`) manteniendo intactos los timestamps `start` y sin inventar menciones no pronunciadas.
  5. Formatea `formattedText` usando `formatTimestamp(seg.start)`.
- **Salida (`200 OK` JSON):**
  ```json
  {
    "segments": [
      { "start": 0, "text": "Texto transcrito..." }
    ],
    "formattedText": "[00:00] Texto transcrito...",
    "pautaApplied": true
  }
  ```

---

### 2. `POST /api/detect-sponsors`
Archivo: `app/api/detect-sponsors/route.ts`

- **Entrada (`application/json`):**
  - `transcript` (`string`, obligatorio): Transcripción formateada con `[MM:SS]`.
  - `pautaMessage` (`string`, opcional): Pauta de referencia del jefe de locutores.
- **Proceso interno:**
  1. Si `transcript` supera `MAX_CHUNK_CHARS = 22000`, `splitTranscriptIntoChunks()` lo divide por líneas.
  2. Para cada fragmento consulta `https://api.groq.com/openai/v1/chat/completions` con:
     - `model: "openai/gpt-oss-120b"`
     - `temperature: 0`
     - `response_format: { type: "json_object" }`
     - `SYSTEM_PROMPT`: Auditor de pauta radial chilena que exige únicamente `"Mención en vivo"` o `"Frase comercial"`, el `timestamp` `MM:SS`, la `cita` textual exacta y excluye el nombre de la propia emisora salvo patrocinio comercial externo.
  3. Normaliza timestamps (`normalizeTimestamp`) y tipos (`normalizeTipo`).
- **Salida (`200 OK` JSON):**
  ```json
  {
    "auspiciadores": [
      {
        "marca": "Banco de Chile",
        "timestamp": "00:06",
        "tipo": "Frase comercial",
        "cita": "Este bloque informativo llega gracias al auspicio de Banco de Chile..."
      }
    ]
  }
  ```
  *(Si no hay marcas detectadas, retorna `{ "auspiciadores": [] }`.)*

---

### 3. `POST /api/send-whatsapp`
Archivo: `app/api/send-whatsapp/route.ts`

- **Entrada (`application/json`):**
  - **Modo Reporte (por defecto):**
    ```json
    {
      "auspiciadores": [
        { "marca": "...", "timestamp": "00:18", "tipo": "Mención en vivo", "cita": "..." }
      ],
      "to": "569XXXXXXXX"
    }
    ```
    *(El campo `to` es opcional; si no se envía, usa `process.env.WHATSAPP_TEST_RECIPIENT`.)*
  - **Modo Plantilla de Apertura (Sandbox 24h):**
    ```json
    {
      "mode": "template_hello",
      "to": "569XXXXXXXX"
    }
    ```
- **Proceso interno:**
  1. `buildWhatsAppReport(auspiciadores)` genera el texto formateado con fecha en zona horaria `America/Santiago`, total de menciones, marcas únicas y el detalle numerado de cada mención y cita.
  2. Realiza `POST` a `https://graph.facebook.com/v25.0/${WHATSAPP_PHONE_ID}/messages` con `Authorization: Bearer ${WHATSAPP_TOKEN}`.
- **Salida (`200 OK` JSON):**
  ```json
  {
    "success": true,
    "mode": "text",
    "recipient": "56958076004",
    "messageId": "wamid.HBgL...",
    "messagePreview": "*REPORTE DE CERTIFICACIÓN PUBLICITARIA*...",
    "whatsappResponse": { ... }
  }
  ```

---

## 8. Guía Rápida para Modificar Contenidos o Reglas

Si deseas personalizar la aplicación o darle instrucciones a un agente de IA, estas son las ubicaciones exactas:

| Qué quieres cambiar | Archivo | Qué editar |
| :--- | :--- | :--- |
| Textos de la UI, títulos, placeholders, colores o tarjetas KPI | `app/page.tsx` | JSX de `RadioMonitorWizard` (secciones `step === 1` a `step === 4`) |
| Calidad / bitrate de grabación | `app/page.tsx` | `handleStartRecording` (`sampleRate`, `audioBitsPerSecond`, `mimeType`) |
| Idioma o prompt base de Whisper | `app/api/transcribe/route.ts` | `basePrompt` y `groqForm.append("language", "es")` |
| Reglas de corrección fonética con pauta | `app/api/transcribe/route.ts` | Prompt dentro de `refineSegmentsWithPauta` |
| Criterios para clasificar marcas / citas | `app/api/detect-sponsors/route.ts` | Constante `SYSTEM_PROMPT` |
| Tamaño máximo de texto por llamada al LLM | `app/api/detect-sponsors/route.ts` | Constante `MAX_CHUNK_CHARS` (actualmente `22000`) |
| Formato del mensaje enviado por WhatsApp | `app/api/send-whatsapp/route.ts` | Función `buildWhatsAppReport()` |
| Número destinatario o claves API | `.env.local` | `WHATSAPP_TEST_RECIPIENT`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_ID`, `GROQ_API_KEY` |
| Audio de prueba del botón demo | `public/demo-pauta.webm` | Reemplazar archivo manteniendo el nombre y tamaño `< 4.5 MB` |

---

## 9. Particularidad del Sandbox de Meta WhatsApp (Ventana de 24h)

Al operar con un número de prueba de Meta Cloud API (ej. `+1 555-163-0956`), Meta aplica la regla de **Customer Service Window (24 horas)**:

- **Síntoma:** `POST /api/send-whatsapp` responde `200 OK` con un `messageId` (`wamid...`), pero el mensaje de texto libre (`type: "text"`) no aparece en el teléfono del destinatario.
- **Causa:** Meta bloquea la entrega de mensajes de texto libre si el número destinatario (`WHATSAPP_TEST_RECIPIENT`) no ha enviado o respondido un mensaje al número de prueba en las últimas 24 horas.
- **Solución en 2 pasos (integrada en el Paso 4):**
  1. Presionar **`1. Enviar plantilla hello_world (Abre chat)`** (usa `"type": "template"`, que Meta siempre entrega fuera de ventana).
  2. Responder cualquier texto (ej. `"Hola"`) en WhatsApp a ese chat.
  3. Presionar **`2. Reenviar Reporte de Texto Ahora`**. A partir de ese momento todos los reportes de texto libre llegarán al instante durante las siguientes 24 horas.
