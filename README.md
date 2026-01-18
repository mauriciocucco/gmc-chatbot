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
  - **Vector Database**: PostgreSQL con `pgvector` para embeddings.
  - **Full-Text Search**: Índices GIN con tsvector para búsqueda textual.
  - **Embeddings**: OpenAI `text-embedding-3-small` (1536 dimensiones).
- **📱 Integración con WhatsApp**: Comunicación directa con los alumnos a través de la plataforma de mensajería más usada.
- **📅 Gestión de Turnos**: Módulo para consulta y reserva de clases de manejo (Appointments).
- **🎓 Seguimiento de Alumnos**: Gestión de perfiles de estudiantes y progreso.

## 🛠️ Tech Stack

- **Framework**: [NestJS](https://nestjs.com/) (Node.js) - Arquitectura modular y escalable.
- **Base de Datos**: PostgreSQL + TypeORM.
- **IA & LangChain**:
  - `@langchain/openai`: Para embeddings.
  - `@langchain/core`: Orquestación de cadenas y prompts.
  - **OpenRouter**: Acceso unificado a múltiples modelos de chat.
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

Crea un archivo `.env` en la raíz basado en `.env.example` (si existe) o configura las siguientes variables clave:

- `DB_HOST`, `DB_PORT`, `DB_USERNAME`, `DB_PASSWORD`, `DB_NAME`: Configuración de Postgres.
- `OPENAI_API_KEY`: Para generar embeddings.
- `OPENROUTER_API_KEY`: Para el modelo de chat.
- `CHAT_MODEL`: Modelo a usar (ej: `google/gemini-flash-1.5`).
- `WHATSAPP_TOKEN`, `WHATSAPP_VERIFY_TOKEN`: Credenciales de WhatsApp Business API.

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

# Cargar manuales PDF (configura INGEST_SOURCES en .env si querés selectivos)
npm run build && node dist/scripts/ingest-pdfs.js
```

## ▶️ Ejecución

```bash
# Desarrollo (con watch mode)
npm run start:dev

# Producción
npm run start:prod
```

## 🔍 Configuración del RAG Híbrido

El sistema combina dos tipos de búsqueda para obtener los mejores resultados:

### Pesos de búsqueda (ajustables en código):

- **60% Semántica**: Captura parafraseo y contexto ("papeles del auto" → "documentación vehicular")
- **40% Léxica**: Matchea términos exactos ("Ley 27.714", "velocidad máxima", "cédula verde")

### Casos de uso óptimos:

| Tipo de consulta             | Mejor resultado con          |
| ---------------------------- | ---------------------------- |
| "¿Qué documentos necesito?"  | Semántica (parafraseo)       |
| "¿Qué dice la ley 27714?"    | Léxica (término exacto)      |
| "velocidad máxima en calles" | Léxica + Semántica (híbrido) |
| "¿Cómo saco la licencia?"    | Semántica (contexto)         |

Para ajustar los pesos, modificá el parámetro `semanticWeight` en `knowledge.service.ts` (línea ~209).

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
