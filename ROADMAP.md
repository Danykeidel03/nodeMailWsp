# ROADMAP: nodeMailWsp → 10/10

> **Contexto**: Bot de atención al cliente para Frezzyks (tienda de golosinas liofilizadas)
> **Objetivo**: Llevar el proyecto de un MVP funcional a un sistema robusto y mantenible
> **Fecha inicio**: Marzo 2026

---

## Estado Actual del Proyecto

| Aspecto | Antes | Objetivo |
|---------|-------|----------|
| Mantenibilidad | 6/10 | 9/10 |
| Escalabilidad | 5/10 | 8/10 |
| Testing | 2/10 | 7/10 |
| Robustez | 7/10 | 9/10 |
| Observabilidad | 6/10 | 9/10 |

---

## Fases de Mejora

### ✅ FASE 1: Arquitectura y Prompts Modulares
**Rama**: `fase-1/arquitectura-y-prompts`
**Estado**: COMPLETADA

**Cambios realizados**:
- [x] Crear estructura `/prompts/sections/` con 12 archivos .md
- [x] Crear `src/services/promptLoader.js` para cargar y combinar secciones
- [x] Refactorizar `classifier.js` para usar el nuevo sistema
- [x] Eliminar código duplicado (obtenerEstadoSeguimiento)
- [x] Extraer funciones helper (detectarFrustracion, detectarBucle, etc)
- [x] Agregar 60 tests con Vitest

**Archivos de prompts creados**:
```
/prompts/sections/
  01-personalidad.md
  02-reglas-antirepeticion.md
  03-envios.md
  04-devoluciones.md
  05-pagos.md
  06-newsletter.md
  07-pedido-cuenta.md
  08-localizar-pedido.md
  09-productos.md
  10-b2b.md
  11-colaboraciones.md
  12-escalado.md
```

---

### ⏳ FASE 2: Persistencia con Redis
**Rama**: `fase-2/redis-persistencia`
**Estado**: PENDIENTE

**Objetivo**: Que el estado (hilos, duplicados, escalados) sobreviva reinicios de Railway

**Tareas**:
- [ ] Instalar `ioredis`
- [ ] Crear `src/services/storage.js` como capa de abstracción
- [ ] Migrar `hilosConversacion` a Redis con TTL 24h
- [ ] Migrar `respuestasRecientes` a Redis con TTL 2h
- [ ] Migrar `hilosEscalados` a Redis con TTL 24h
- [ ] Fallback a memoria si Redis no está disponible (para dev local)
- [ ] Tests para el módulo de storage
- [ ] Documentar configuración de Redis en Railway

**Variables de entorno nuevas**:
```
REDIS_URL=redis://localhost:6379
```

---

### ⏳ FASE 3: Robustez y Alertas
**Rama**: `fase-3/robustez-alertas`
**Estado**: PENDIENTE

**Objetivo**: Mejorar manejo de errores y recibir alertas en tiempo real

**Tareas**:
- [ ] Implementar backoff exponencial en reconexión IMAP (5s → 10s → 20s → 40s → max 5min)
- [ ] Crear `src/services/alertas.js`
- [ ] Integrar con Telegram Bot para alertas
- [ ] Alertar cuando:
  - IMAP se desconecta y no reconecta en 5 minutos
  - Error rate > 3 errores en 10 minutos
  - Guard-rail se activa (estado interno casi enviado)
- [ ] Mejorar endpoint `/health` para verificar IMAP y Redis
- [ ] Tests para alertas y reconexión

**Variables de entorno nuevas**:
```
TELEGRAM_BOT_TOKEN=xxx
TELEGRAM_CHAT_ID=xxx
```

---

### ⏳ FASE 4: Limpieza y Documentación
**Rama**: `fase-4/limpieza`
**Estado**: PENDIENTE

**Objetivo**: Eliminar código muerto y mejorar documentación

**Tareas**:
- [ ] Eliminar dependencias no usadas:
  - `@sendgrid/mail` (usa Resend)
  - `@woocommerce/woocommerce-rest-api` (no se usa)
  - `node-imap` (duplicado con `imap`)
  - `nodemailer` (usa Resend)
- [ ] Evaluar si eliminar `woo.js` (código Shopify mal nombrado, no se importa)
- [ ] Crear `src/config/index.js` para centralizar configuración
- [ ] Actualizar README con:
  - Setup completo
  - Variables de entorno necesarias
  - Cómo editar prompts
  - Cómo ejecutar tests
- [ ] Agregar diagrama de flujo del bot

---

## Decisiones Tomadas

1. **NO usar patrón Skills/Router**: El proyecto tiene un solo dominio (atención al cliente), no justifica la complejidad extra.

2. **Prompts en archivos .md**: Permite editar sin tocar código, mejor diff en Git.

3. **Redis para estado**: Railway lo ofrece gratis, mejor que SQLite para este caso.

4. **Telegram para alertas**: Gratis, simple, funciona 24/7.

5. **Vitest para tests**: Rápido, moderno, buena DX.

---

## Comandos Útiles

```bash
# Ejecutar tests
npm test

# Tests en modo watch
npm run test:watch

# Ver ramas de fases
git branch | grep fase

# Cambiar a una fase
git checkout fase-1/arquitectura-y-prompts
```

---

## Notas para Continuar

- **Volumen actual**: ~50 emails/día
- **Deploy**: Railway (puede reiniciarse, por eso Redis)
- **Solo email**: Se eliminó WhatsApp, no hay planes de otros canales
- **Métricas**: Dashboard HTML actual es suficiente, no hace falta sistema externo
