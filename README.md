<p align="center">
  <a href="http://nestjs.com/" target="blank"><img src="https://nestjs.com/img/logo-small.svg" width="120" alt="Nest Logo" /></a>
</p>

# 🚗 GMC Driving Academy Chatbot

> **Asistente Virtual Inteligente para la Academia de Conducción GMC (Villa Gesell)**

Este proyecto es un chatbot avanzado diseñado para automatizar la atención al alumno, gestionar turnos y responder consultas teóricas y administrativas utilizando Inteligencia Artificial.

---

## 🌟 Características Principales

- **🧠 Inteligencia Artificial Generativa**: Utiliza Modelos de Lenguaje (LLMs) a través de **OpenRouter** (Gemini Flash, Claude Haiku, etc.) para conversaciones naturales y fluidas.
- **📚 RAG (Retrieval-Augmented Generation)**: Implementa un sistema de búsqueda semántica sobre una base de conocimiento propia (reglas de tránsito, manuales de la academia, precios).
  - **Vector Database**: Postgres con `pgvector`.
  - **Embeddings**: OpenAI `text-embedding-3-small`.
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
npm run migration:run
```

## ▶️ Ejecución

```bash
# Desarrollo (con watch mode)
npm run start:dev

# Producción
npm run start:prod
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
