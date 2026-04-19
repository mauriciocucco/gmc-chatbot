<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

# GMC Driving Academy Chatbot

> Asistente virtual para Autoescuela GMC (Villa Gesell) con WhatsApp, RAG hibrido y base de conocimiento propia.

Este proyecto responde consultas teoricas y administrativas de la autoescuela usando un pipeline RAG sobre PostgreSQL + pgvector. La generacion de respuesta corre con modelos via OpenRouter; la recuperacion combina embeddings, full-text search y un reranker opcional.

---

## Caracteristicas principales

- IA generativa via OpenRouter para respuestas cortas y conversacionales.
- RAG hibrido: embeddings + full-text search sobre la misma base.
- Reranker opcional con `BAAI/bge-reranker-v2-m3` via HuggingFace Inference API.
- Ingesta de PDFs con chunking contextual por documento y seccion.
- Normalizacion dirigida de tablas para `manual_pba.pdf`.
  El cuadro `LIMITES MAXIMOS Y MINIMOS DE VELOCIDAD` se transforma en filas semanticas explicitas para evitar que el PDF linealizado mezcle maximas, minimas y tipos de vehiculo.
- Normalizacion liviana de queries para retrieval.
  Ejemplos actuales: `autoposta` -> `autopista`, `semi autopista` -> `semiautopista`.
- Integracion con WhatsApp para atencion al alumno.

## Stack tecnico

- Framework: [NestJS](https://nestjs.com/)
- Base de datos: PostgreSQL + TypeORM + `pgvector`
- Embeddings: OpenAI `text-embedding-3-small` (1536 dimensiones)
- Chat: OpenRouter
- Text splitters / orchestration: LangChain
- PDF parsing: `pdf-parse`

## Configuracion

### 1. Instalar dependencias

```bash
npm install
```

### 2. Variables de entorno

Crea `.env` en la raiz. Variables importantes:

**Base de datos**

- `DB_HOST`
- `DB_PORT`
- `DB_USERNAME`
- `DB_PASSWORD`
- `DB_NAME`
- `DB_SSL`

**IA**

- `OPENAI_API_KEY`
- `OPENROUTER_API_KEY`
- `CHAT_MODEL`
- `EMBEDDING_DIMENSION`

**RAG**

- `RAG_SEMANTIC_WEIGHT`

**Reranker**

- `RERANKER_ENABLED`
- `HF_API_KEY`
- `RERANKER_MODEL`

**Ingesta de PDFs**

- `CHUNK_SIZE`
- `CHUNK_OVERLAP`
- `INGEST_SOURCES`

**WhatsApp**

- `WHATSAPP_API_TOKEN`
- `WHATSAPP_VERIFY_TOKEN`
- `WHATSAPP_APP_SECRET`
- `WHATSAPP_PHONE_ID`

### 3. Migraciones

```bash
npm run migration:run
```

## Carga de conocimiento

### Reglas / FAQs desde `knowledge-base.json`

Con el servidor Nest corriendo:

```bash
npx ts-node ingest-data.ts
```

### PDFs oficiales

Con el servidor Nest corriendo:

```bash
npx ts-node scripts/ingest-pdfs.ts
```

Para reingestar solo una fuente:

```bash
INGEST_SOURCES=manual_pba npx ts-node scripts/ingest-pdfs.ts
INGEST_SOURCES=cnev_nacional npx ts-node scripts/ingest-pdfs.ts
INGEST_SOURCES=bateria_preguntas npx ts-node scripts/ingest-pdfs.ts
```

Si cambia el parser de PDFs o la normalizacion de tablas:

```bash
# 1. limpiar el source afectado
DELETE /knowledge/clear?source=manual_pba

# 2. reingestar solo ese PDF
INGEST_SOURCES=manual_pba npx ts-node scripts/ingest-pdfs.ts
```

## Como funciona el RAG

### Retrieval hibrido

El sistema combina:

- Busqueda semantica con embeddings
- Busqueda lexica con `tsvector` / `plainto_tsquery`
- Score combinado via `RAG_SEMANTIC_WEIGHT`

Casos tipicos:

- Consultas parafraseadas: mejoran con semantica
- Leyes, siglas y velocidades: mejoran con lexico
- Preguntas ambiguas: mejoran con el score hibrido

### Reranker

Si `RERANKER_ENABLED=true`:

1. Se recuperan 15 candidatos.
2. El cross-encoder de HuggingFace reranquea esos candidatos.
3. Solo los top 5 pasan al prompt final.

### Chunking contextual

Cada chunk de PDF se guarda con este prefijo:

```text
Documento: Manual Oficial Provincia BSAS
Seccion: ARTICULO 51

<texto del chunk>
```

Esto mejora embeddings y retrieval sobre documentos legales largos.

### Normalizacion dirigida de tablas

`manual_pba.pdf` contiene cuadros que `pdf-parse` linealiza como una secuencia de etiquetas y numeros. Eso puede romper la relacion entre:

- lugar
- tipo de vehiculo
- velocidad maxima
- velocidad minima

Para corregirlo, la ingesta detecta la seccion `LIMITES MAXIMOS Y MINIMOS DE VELOCIDAD` y genera filas atomicas como:

```text
En autopistas, la velocidad minima para motos y automoviles es 65 km/h y la maxima es 130 km/h.
En autopistas, la velocidad minima para omnibus y autocasas es 65 km/h y la maxima es 100 km/h.
En semiautopistas o autovias, la velocidad maxima para camionetas es 110 km/h y la minima general es 40 km/h, salvo maquinaria especial.
```

Cada fila se almacena con metadata adicional:

- `contentType: table-row`
- `tableId: manual_pba_speed_limits`
- `rowKey: <identificador_semantico>`

Eso evita que varias filas del cuadro queden mezcladas en un mismo chunk.

### Normalizacion de queries

Antes de generar embeddings o hacer full-text search, el sistema normaliza variantes frecuentes del dominio vial. La pregunta original del usuario se conserva para la respuesta final del LLM; solo se corrige la fase de recuperacion.

Ejemplos actuales:

- `autoposta` -> `autopista`
- `autopostas` -> `autopistas`
- `semi autopista` -> `semiautopista`

## Ejecucion

```bash
# desarrollo
npm run start:dev

# produccion
npm run start:prod
```

## Evaluacion

Scripts disponibles:

```bash
# generar preguntas sinteticas desde chunks de la DB
npm run eval:generate

# medir retrieval
npm run eval:run

# medir retrieval con reranker
npm run eval:run:rerank

# evaluar respuestas con LLM-as-judge
npm run eval:answers
```

Workflow tipico:

```bash
# 1. limpiar y reingestar la fuente que cambiaste
DELETE /knowledge/clear?source=manual_pba
INGEST_SOURCES=manual_pba npx ts-node scripts/ingest-pdfs.ts

# 2. regenerar evals si cambiaron los chunks
npm run eval:generate

# 3. medir impacto
npm run eval:run
npm run eval:run:rerank
```

## Testing

```bash
npm test
npx tsc -p tsconfig.json --noEmit
npm run build
```

Los tests cubren:

- normalizacion de tablas del `manual_pba`
- validacion de chunks tabulares
- normalizacion de queries RAG
- uso de la query normalizada en `KnowledgeService`

---

<p align="center">
  <i>Desarrollado para facilitar la atencion y el aprendizaje en Autoescuela GMC.</i>
</p>
