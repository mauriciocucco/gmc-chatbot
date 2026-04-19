<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

# 🚗 GMC Driving Academy Chatbot

> **Asistente Virtual Inteligente para la Academia de Conducción GMC (Villa Gesell)**

Este proyecto es un chatbot avanzado diseñado para automatizar la atención al alumno, gestionar turnos y responder consultas teóricas y administrativas utilizando Inteligencia Artificial.

---

## 🌟 Características Principales

- **🧠 Inteligencia Artificial Generativa**: Utiliza Modelos de Lenguaje (LLMs) a través de **OpenRouter** (Gemini Flash, Claude Haiku, etc.) para conversaciones naturales y fluidas.
- **📚 RAG Híbrido (Retrieval-Augmented Generation)**: Sistema de búsqueda avanzado que combina:
  - **Búsqueda Semántica** (embeddings): Captura el significado y contexto de las consultas.
  - **Búsqueda Léxica** (full-text): Matchea términos exactos (leyes, siglas, velocidades).
  - **Vector Database**: PostgreSQL con `pgvector` y HNSW index para embeddings.
  - **Full-Text Search**: Índices GIN con tsvector para búsqueda textual.
  - **Embeddings**: OpenAI `text-embedding-3-small` (1536 dimensiones).
- **🔀 Reranker Cross-Encoder** _(opcional)_: Post-procesamiento de resultados con `BAAI/bge-reranker-v2-m3` vía HuggingFace Inference API. Recupera 15 candidatos y reordena al top 5 más relevante.
- **📄 Chunking Contextual**: Los PDFs se ingresan con encabezados de sección prepended (`Documento: X\nSección: Y`) para que cada chunk sea autosuficiente semánticamente, mejorando la recuperación en documentos legales.
- **📱 Integración con WhatsApp**: Comunicación directa con los alumnos a través de la plataforma de mensajería más usada.
- **📅 Gestión de Turnos**: Módulo para consulta y reserva de clases de manejo (Appointments).
- **🎓 Seguimiento de Alumnos**: Gestión de perfiles de estudiantes y progreso.

## 📊 Resultados de Evaluación

Mejoras medidas con el sistema de evaluación Recall@k incluido en este repositorio:

| Técnica aplicada         | Recall@5 | Recall@10 | Δ R@5      |
| ------------------------ | -------- | --------- | ---------- |
| Baseline (chunks planos) | 72.1%    | 79.1%     | —          |
| + Chunking contextual    | 80.0%    | 86.7%     | **+7.9pp** |

El mayor impacto fue en documentos legales: `cnev_nacional` pasó de **57.7% → 76.7%** (+19pp) gracias al contexto de sección prepended.

## 🛠️ Tech Stack

- **Framework**: [NestJS](https://nestjs.com/) (Node.js) - Arquitectura modular y escalable.
- **Base de Datos**: PostgreSQL + TypeORM.
- **IA & LangChain**:
  - `@langchain/openai`: Para embeddings.
  - `@langchain/core`: Orquestación de cadenas y prompts.
  - **OpenRouter**: Acceso unificado a múltiples modelos de chat.
- **Reranker**: `BAAI/bge-reranker-v2-m3` vía HuggingFace Inference API (cross-encoder multilingüe).
- **Infraestructura**: Docker (opcional para DB), Ngrok (para tunneling de webhooks en desarrollo).

## 🚀 Instalación y Configuración

### 1. Clonar el repositorio

```bash
git clone <url-del-repo>
cd gmc-chatbot
```

### 2. Instalar dependencias

```bash
npm install
```

### 3. Configurar Variables de Entorno

Crea un archivo `.env` en la raíz basado en `.env.example`. Variables clave:

**Base de datos**

- `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`

**IA**

- `OPENAI_API_KEY`: Para generar embeddings.
- `OPENROUTER_API_KEY`: Para el modelo de chat.
- `CHAT_MODEL`: Modelo a usar (ej: `google/gemini-flash-1.5`).

**RAG híbrido**

- `RAG_SEMANTIC_WEIGHT`: Peso semántico (default `0.6`). Léxico = `1 - semántico`.

**Reranker** _(opcional)_

- `RERANKER_ENABLED`: `true` para habilitar (default `false`).
- `HF_API_KEY`: Token de HuggingFace (tier gratuito funciona).
- `RERANKER_MODEL`: Modelo a usar (default `BAAI/bge-reranker-v2-m3`).

**Ingesta de PDFs**

- `CHUNK_SIZE`: Tamaño de chunks en tokens (default `512`). Modificar para experimentos.
- `CHUNK_OVERLAP`: Solapamiento entre chunks (default `50`).

**WhatsApp**

- `WHATSAPP_API_TOKEN`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `WHATSAPP_PHONE_ID`.

### 4. Ejecutar Migraciones

Asegúrate de que la base de datos esté corriendo.

```bash
npm run typeorm -- migration:run -d ./typeorm.config.ts
```

**Nota**: Si ya tenés datos en la DB y estás actualizando a RAG híbrido, la migración `AddFullTextSearch` automáticamente:

- Agrega la columna `search_vector` (tsvector)
- Crea índice GIN para búsquedas rápidas
- Configura trigger para actualización automática
- Pobla los registros existentes sin tocar los embeddings

### 5. Ingestar Base de Conocimiento

Carga los datos desde `knowledge-base.json` y PDFs:

```bash
# Cargar FAQs del JSON
npm run build && node dist/ingest-data.js

# Cargar manuales PDF (chunking contextual por sección)
npx ts-node scripts/ingest-pdfs.ts

# Para experimentos de tamaño de chunk (re-ingestar con otro tamaño):
CHUNK_SIZE=256 npx ts-node scripts/ingest-pdfs.ts
CHUNK_SIZE=1024 CHUNK_OVERLAP=100 npx ts-node scripts/ingest-pdfs.ts
```

> **Tip**: Para reingestar solo un documento específico usá `INGEST_SOURCES=manual_pba` (o `cnev_nacional`, `bateria_preguntas`).

## ▶️ Ejecución

```bash
# Desarrollo (con watch mode)
npm run start:dev

# Producción
npm run start:prod
```

## 🔍 Configuración del RAG Híbrido

El sistema combina dos tipos de búsqueda para obtener los mejores resultados:

### Pesos de búsqueda (variables de entorno):

- **60% Semántica** (`RAG_SEMANTIC_WEIGHT=0.6`): Captura parafraseo y contexto ("papeles del auto" → "documentación vehicular")
- **40% Léxica**: Matchea términos exactos ("Ley 27.714", "velocidad máxima", "cédula verde")

### Casos de uso óptimos:

| Tipo de consulta             | Mejor resultado con          |
| ---------------------------- | ---------------------------- |
| "¿Qué documentos necesito?"  | Semántica (parafraseo)       |
| "¿Qué dice la ley 27714?"    | Léxica (término exacto)      |
| "velocidad máxima en calles" | Léxica + Semántica (híbrido) |
| "¿Cómo saco la licencia?"    | Semántica (contexto)         |

### Reranker (opcional):

Cuando `RERANKER_ENABLED=true`, el pipeline se expande:

1. Hybrid search recupera **15 candidatos** (en lugar de 5).
2. El cross-encoder `BAAI/bge-reranker-v2-m3` re-puntúa cada par `(query, chunk)`.
3. Solo los **top 5** por score del reranker pasan al prompt del LLM.

El reranker mantiene un warmup automático cada 5 minutos para evitar cold starts del tier gratuito de HuggingFace.

### Chunking contextual:

Cada chunk de PDF se almacena con un prefijo de contexto:

```
Documento: Manual Oficial Provincia BSAS
Sección: ARTÍCULO 51

<texto del chunk>
```

Esto asegura que el embedding captura el contexto del documento incluso en chunks pequeños, mejorando especialmente la recuperación en textos legales numerados.

## 🧪 Evaluación (RAG Evals)

El repositorio incluye un sistema completo de evaluación para medir y comparar mejoras:

### Scripts disponibles:

```bash
# 1. Generar preguntas sintéticas desde los chunks de la DB
npm run eval:generate
# → Guarda eval-data/eval-questions.json (~120 preguntas, 15 chunks x 4 sources)

# 2. Medir Recall@5 y Recall@10 contra el servidor en vivo
npm run eval:run
# → Imprime tabla por source y guarda eval-data/results/eval-{timestamp}.json

# 3. Evaluar calidad de respuestas con LLM-as-judge (requiere servidor activo)
npm run eval:answers
# → Mide correct / grounded / complete y guarda eval-data/results/answer-eval-{timestamp}.json
```

### Métricas:

| Métrica      | Descripción                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------- |
| **Recall@k** | ¿Aparece el chunk fuente en los top-k resultados de búsqueda? Mide la recuperación del sistema. |
| **Correct**  | La respuesta es factualmente precisa.                                                           |
| **Grounded** | La respuesta se basa en el contexto recuperado (no alucina).                                    |
| **Complete** | La respuesta aborda todos los aspectos de la pregunta.                                          |

### Workflow de experimentación:

```bash
# 1. Re-ingestar con nuevo chunk size
DELETE /knowledge/clear?source=manual_pba   # limpiar source
CHUNK_SIZE=256 npx ts-node scripts/ingest-pdfs.ts

# 2. Regenerar preguntas (si cambiaron los chunks)
npm run eval:generate

# 3. Medir impacto
npm run eval:run

# 4. Comparar JSONs en eval-data/results/
```

## 🧪 Testing

```bash
# Unit tests
npm run test

# e2e tests
npm run test:e2e
```

---

<p align="center">
  <i>Desarrollado para facilitar el aprendizaje y la gestión en Autoescuela GMC.</i>
</p>
