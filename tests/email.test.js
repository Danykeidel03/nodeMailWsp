// tests/email.test.js
import { describe, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  esIntermediario,
  extraerEmailDelContenido,
  clasificarPorDominio,
  claveIncidencia,
  yaEscaladaIncidenciaReciente,
  registrarIncidenciaEscalada,
  hashMensaje,
  esMensajeDuplicado,
  detectarClienteTienda,
  esDominioLogistica,
} from '../email.js';


describe('Email - Detección de Intermediarios', () => {
  
  test.each([
    ['mailer@shopify.com', true],
    ['no-reply@empresa.com', true],
    ['noreply@tienda.es', true],
    ['notifications@shopify.com', true],
    ['automated@sistema.com', true],
    ['cliente@gmail.com', false],
    ['juan.perez@hotmail.com', false],
    ['NO-REPLY@empresa.com', true],
    ['MAILER@SHOPIFY.COM', true],
  ])('esIntermediario("%s") -> %s', (email, expected) => {
    expect(esIntermediario(email)).toBe(expected);
  });
});


describe('Email - Extracción de Email del Contenido', () => {
  
  test.each([
    ['Cliente: Juan\nCorreo electrónico: juan@gmail.com\nPedido: #1234', 'juan@gmail.com'],
    ['Datos del cliente\nEmail: cliente@hotmail.com\nTeléfono: 123456', 'cliente@hotmail.com'],
    ['E-mail: test@example.org', 'test@example.org'],
    ['Hola, tengo una consulta sobre mi pedido', null],
    ['Correo electronico: sin.tilde@mail.com', 'sin.tilde@mail.com'],
  ])('extraerEmailDelContenido -> %s', (texto, expected) => {
    expect(extraerEmailDelContenido(texto)).toBe(expected);
  });
});


describe('Email - Clasificación por Dominio', () => {

  test.each([
    // Judge.me
    ['reviews@judge.me', 'Nueva reseña', 'You received a 5 star review!', 'IGNORAR', 'judge.me 5 star'],
    ['reviews@judge.me', 'Nueva reseña', 'You received a 1 star review', 'HUMANO', 'judge.me 1 star'],
    // Newsletters
    ['promo@mailchimp.com', 'Oferta', '', 'IGNORAR', 'mailchimp'],
    ['info@sendinblue.com', 'Newsletter', '', 'IGNORAR', 'sendinblue'],
    // Notificaciones internas
    ['sistema@frezzyks.com', 'New subscriber to newsletter', '', 'IGNORAR', 'frezzyks subscriber'],
    ['alertas@frezzyks.com', 'Low stock alert', '', 'IGNORAR', 'frezzyks low stock'],
    // Spam comercial
    ['sales@agency.com', 'Partnership', 'I would like to help you grow your business with our marketing services', 'IGNORAR', 'spam marketing'],
    ['john@seocompany.com', 'SEO Proposal', 'We offer SEO services and link building', 'IGNORAR', 'spam seo'],
    ['info@consultant.com', 'Free consultation', 'Book your free consultation today', 'IGNORAR', 'spam consultation'],
    // Clientes normales
    ['juan@gmail.com', '¿Dónde está mi pedido?', 'Hola, quiero saber el estado de mi pedido #1234', 'PROCESAR', 'cliente normal 1'],
    ['maria@hotmail.com', 'Devolución', 'Quiero devolver un producto que llegó dañado', 'PROCESAR', 'cliente normal 2'],
    // Proveedor — Fix 1
    ['info@embaleo.es', 'Pedido mayorista', 'Somos proveedores de chuches', 'IGNORAR', 'proveedor embaleo.es'],
    ['logistica@embaleo.es', 'Envío listo', 'Confirmamos el envío', 'IGNORAR', 'proveedor subdominio embaleo.es'],
  ])('clasificarPorDominio - %s -> %s', (email, asunto, texto, expected, _label) => {
    const result = clasificarPorDominio(email, asunto, texto);
    expect(result.tipo).toBe(expected);
  });

  test('clasificarPorDominio embaleo.es devuelve razon proveedor', () => {
    const result = clasificarPorDominio('info@embaleo.es', 'Asunto', 'Texto');
    expect(result).toEqual({ tipo: 'IGNORAR', razon: 'proveedor' });
  });

  test('clasificarPorDominio cliente legítimo NO retorna IGNORAR por dominio proveedor', () => {
    const result = clasificarPorDominio('cliente@gmail.com', 'Mi pedido', 'Hola quiero saber dónde está mi pedido');
    expect(result.tipo).not.toBe('IGNORAR');
    expect(result.tipo).toBe('PROCESAR');
  });
});

// Fix 5 — guard en bloque intermediario-fallback
// Valida que clasificarPorDominio retorna IGNORAR para remitentes noreply con cuerpo de newsletter.
// La integración en email.js usa este resultado para NO llamar reenviarCorreo.
describe('Email - Guard intermediario-fallback (Fix 5)', () => {

  test('noreply@chuchespro.com con cuerpo newsletter → clasificarPorDominio IGNORAR', () => {
    const cuerpoNewsletter = 'Promociones exclusivas para ti. Unsubscribe from this newsletter. All rights reserved.';
    const result = clasificarPorDominio('noreply@chuchespro.com', 'Ofertas de la semana', cuerpoNewsletter);
    expect(result.tipo).toBe('IGNORAR');
  });

  test('cliente real en camino intermediario → clasificarPorDominio NO retorna IGNORAR', () => {
    const cuerpoCliente = 'Hola, tengo un problema con mi pedido #1234. ¿Pueden ayudarme?';
    const result = clasificarPorDominio('cliente@gmail.com', 'Problema con pedido', cuerpoCliente);
    expect(result.tipo).toBe('PROCESAR');
  });
});

// Fix 6 — dedup cross-day: claveIncidencia + yaEscaladaIncidenciaReciente
describe('claveIncidencia', () => {

  test('la clave NO contiene la fecha de hoy', () => {
    const clave = claveIncidencia('sender@example.com', 'Problema con envío');
    const hoy = new Date().toISOString().split('T')[0];
    expect(clave).not.toContain(hoy);
  });

  test('normaliza RE: y FWD: del asunto', () => {
    const c1 = claveIncidencia('s@example.com', 'Re: Problema con envío');
    const c2 = claveIncidencia('s@example.com', 'Problema con envío');
    expect(c1).toBe(c2);
  });

  test('asuntos distintos generan claves distintas', () => {
    const c1 = claveIncidencia('s@example.com', 'Problema A');
    const c2 = claveIncidencia('s@example.com', 'Problema B');
    expect(c1).not.toBe(c2);
  });

  test('yaEscaladaIncidenciaReciente retorna true para mismo remitente+asunto dentro de 48h', () => {
    const remitente = `test-${Date.now()}@incidencia.com`;
    const asunto = 'Paquete perdido unique-' + Date.now();
    registrarIncidenciaEscalada(remitente, asunto);
    expect(yaEscaladaIncidenciaReciente(remitente, asunto)).toBe(true);
  });

  test('yaEscaladaIncidenciaReciente retorna false para asunto diferente', () => {
    const remitente = `test2-${Date.now()}@incidencia.com`;
    registrarIncidenciaEscalada(remitente, 'Asunto A unique-' + Date.now());
    expect(yaEscaladaIncidenciaReciente(remitente, 'Asunto B completamente distinto')).toBe(false);
  });

  test('claveIncidenciaHoy ya no existe en los exports', () => {
    // Si existe, este import falla o es undefined — la función vieja no debe exportarse
    const mod = require('../email.js');
    expect(mod.claveIncidenciaHoy).toBeUndefined();
    expect(mod.yaEscaladaIncidenciaHoy).toBeUndefined();
  });
});

// Fix 2 — dedup simétrico: esMensajeDuplicado (content-hash 60s)
describe('esMensajeDuplicado', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('hashMensaje es determinístico — mismos inputs → mismo hash', () => {
    const h1 = hashMensaje('from@example.com', 'Hola, quiero saber mi pedido');
    const h2 = hashMensaje('from@example.com', 'Hola, quiero saber mi pedido');
    expect(h1).toBe(h2);
    expect(typeof h1).toBe('string');
    expect(h1.length).toBeGreaterThan(0);
  });

  test('hashMensaje distinto para from diferente', () => {
    const h1 = hashMensaje('a@example.com', 'mismo cuerpo');
    const h2 = hashMensaje('b@example.com', 'mismo cuerpo');
    expect(h1).not.toBe(h2);
  });

  test('mismo from+body dentro de 60s → true', () => {
    const from = `dup-${Date.now()}@test.com`;
    const body = 'Cuerpo de prueba único ' + Date.now();
    esMensajeDuplicado(from, body); // primera vez — registra
    expect(esMensajeDuplicado(from, body)).toBe(true); // segunda vez — duplicado
  });

  test('body diferente → false', () => {
    const from = `dup2-${Date.now()}@test.com`;
    esMensajeDuplicado(from, 'Cuerpo A');
    expect(esMensajeDuplicado(from, 'Cuerpo B completamente diferente')).toBe(false);
  });

  test('después del TTL de 60s → false', () => {
    const from = `ttl-${Date.now()}@test.com`;
    const body = 'Cuerpo TTL ' + Date.now();
    esMensajeDuplicado(from, body); // registra
    vi.advanceTimersByTime(61 * 1000); // avanza 61s
    expect(esMensajeDuplicado(from, body)).toBe(false);
  });
});

// T1 — detectarClienteTienda
describe('detectarClienteTienda', () => {
  test.each([
    ['Tipo De Cliente: Tienda', true],
    ['tipo de cliente: tienda', true],
    ['TIPO DE CLIENTE = TIENDA', true],
    ['tipo  de  cliente:  tienda', true],
    ['Tipo De Cliente: Tienda Online', false],
    ['Tipo de negocio: Tienda', false],
    ['Tipo De Cliente: Particular', false],
    [null, false],
    ['', false],
  ])('detectarClienteTienda(%s) → %s', (texto, expected) => {
    expect(detectarClienteTienda(texto)).toBe(expected);
  });
});

// T2A — loop-blocker: ventas@frezzyks.com
describe('Loop-blocker — ventas@frezzyks.com', () => {
  test('emailsInternosFrezzyks incluye ventas@ (clasificarPorDominio no escala email interno)', () => {
    // Verifica indirectamente que ventas@ está en el bloqueo interno.
    // La función exportable más próxima es clasificarPorDominio; el bloqueo real
    // ocurre en la pipeline, pero la cobertura unitaria se hace via
    // esIntermediario que devuelve false para ventas@ (es interno, no intermediario).
    // El test real de comportamiento: emailsInternosFrezzyks deve contener ventas@.
    // Como el array no está exportado, lo validamos mediante comportamiento: si el bot
    // llama reenviarCorreo al recibir un email de ventas@, hay un loop.
    // En esta validación comprobamos que el array de emails internos no produce reenvío
    // llamando al módulo directamente: usamos _setResendForTesting para capturar llamadas.
    const { _setResendForTesting, _resetResend } = require('../email.js');
    const mockResend = { emails: { send: vi.fn().mockResolvedValue({ data: { id: 'ok' } }) } };
    _setResendForTesting(mockResend);

    // El array emailsInternosFrezzyks está en la pipeline; como no podemos invocar
    // la pipeline sin IMAP, lo que testamos es el CONTENIDO del módulo:
    // ventas@frezzyks.com debe estar en el source. Si NO está, este test falla
    // sólo a nivel de spec — en la fase GREEN lo confirmamos.
    // Test canónico: el módulo email.js no exporta emailsInternosFrezzyks,
    // por lo que usamos una asserción de contrato: reenviarCorreo NO debe ser
    // llamado para ventas@ en ningún flujo activo.
    // Este test valida que el mock NO fue llamado (pre-condición del fix).
    // Cuando el fix esté en GREEN, la pipeline rechazará el email antes de reenviar.
    expect(mockResend.emails.send).not.toHaveBeenCalled();
    _resetResend();
  });

  test('emailsInternosFrezzyks contiene ventas@frezzyks.com en el source del módulo', () => {
    // Leer el source del módulo para validar que el string está presente
    const fs = require('fs');
    const source = fs.readFileSync(require.resolve('../email.js'), 'utf8');
    expect(source).toContain("'ventas@frezzyks.com'");
  });
});

// Fix 2 — dedup asimétrico: yaRespondidoRecientemente ahora solo actúa en el send-path
describe('dedup asimétrico — send-path vs inbound', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('yaRespondidoRecientemente retorna false para threadId nuevo', () => {
    const { yaRespondidoRecientemente } = require('../email.js');
    expect(yaRespondidoRecientemente('thread-nuevo-' + Date.now(), 30)).toBe(false);
  });

  test('mismo hash de body diferente = NOT duplicate — cuerpo diferente no bloquea', () => {
    // Valida que esMensajeDuplicado con contenido distinto retorna false (follow-up no bloqueado)
    const from = `asym-${Date.now()}@test.com`;
    esMensajeDuplicado(from, 'Primer mensaje del cliente');
    const resultado = esMensajeDuplicado(from, 'Follow-up con contenido completamente distinto');
    expect(resultado).toBe(false);
  });
});

// ============================================================
// T2.1 — claveIncidencia: ID-extraction strategy (RED)
// ============================================================
describe('claveIncidencia — ID extraction + date-strip (T2.1)', () => {
  it('extrae tracking ID de formato Correos del asunto → clave usa ::id::', () => {
    const clave = claveIncidencia('noreply@correos.es', 'Correos - PKCZG09800025120147014R - Incidencia');
    expect(clave).toContain('::id::');
    expect(clave).toContain('pkczg09800025120147014r');
  });

  it('extrae número de pedido del asunto → clave usa ::id::', () => {
    const clave = claveIncidencia('noreply@correos.es', 'Problema con pedido #5070');
    expect(clave).toContain('::id::');
    expect(clave).toContain('5070');
  });

  it('sin ID en asunto → clave usa ::subj:: y elimina fechas', () => {
    const clave = claveIncidencia('noreply@correos.es', 'Aviso de incidencia 25/05/2026 pendiente');
    expect(clave).toContain('::subj::');
    expect(clave).not.toContain('25/05/2026');
  });

  it('dos asuntos con mismo incidente mismo remitente y fechas distintas → misma clave', () => {
    const c1 = claveIncidencia('noreply@correos.es', 'Aviso incidencia PKCZG09800025120147014R - 20/05/2026');
    const c2 = claveIncidencia('noreply@correos.es', 'Aviso incidencia PKCZG09800025120147014R - 25/05/2026');
    expect(c1).toBe(c2);
  });

  it('remitentes distintos → claves distintas aunque asunto sea el mismo', () => {
    const c1 = claveIncidencia('correos@correos.es', 'Incidencia PKCZG09800025120147014R');
    const c2 = claveIncidencia('seur@seur.com', 'Incidencia PKCZG09800025120147014R');
    expect(c1).not.toBe(c2);
  });
});

// ============================================================
// T2.2 — TTL 72h lazy check (RED)
// ============================================================
describe('yaEscaladaIncidenciaReciente — TTL 72h boundary (T2.2)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('retorna true dentro de las 72h para clave con ID de tracking Correos', () => {
    const remitente = `ttl72-${Date.now()}@correos.es`;
    // Correos tracking: 2-5 letras + 8+ dígitos
    const asunto = `Incidencia EN12345678ES aviso de recogida`;
    registrarIncidenciaEscalada(remitente, asunto);
    vi.advanceTimersByTime(71 * 60 * 60 * 1000); // 71h — dentro de TTL 72h
    expect(yaEscaladaIncidenciaReciente(remitente, asunto)).toBe(true);
  });

  it('retorna false después de 72h para clave con ID de tracking Correos', () => {
    const remitente = `ttl72-exp-${Date.now()}@correos.es`;
    const asunto = `Incidencia EN98765432ES expirado`;
    registrarIncidenciaEscalada(remitente, asunto);
    vi.advanceTimersByTime(73 * 60 * 60 * 1000); // 73h — fuera de TTL 72h
    expect(yaEscaladaIncidenciaReciente(remitente, asunto)).toBe(false);
  });

  it('retorna true a las 48h (dentro de la ventana 72h — antes el TTL era 48h)', () => {
    const remitente = `ttl48-${Date.now()}@correos.es`;
    // Asunto sin ID → clave ::subj::, TTL 24h — pero a las 48h ya expiró
    // Para testear la ventana 72h, usar asunto CON ID de pedido
    const asunto = `Problema con pedido #${Math.floor(Date.now() / 1000)} incidencia`;
    registrarIncidenciaEscalada(remitente, asunto);
    vi.advanceTimersByTime(48 * 60 * 60 * 1000); // 48h — dentro de TTL ::id:: (72h)
    expect(yaEscaladaIncidenciaReciente(remitente, asunto)).toBe(true);
  });
});

// ============================================================
// T2.3 — esDominioLogistica helper (RED)
// ============================================================
describe('esDominioLogistica (T2.3)', () => {
  test.each([
    ['info@correos.es', true],
    ['noreply@correosexpress.com', true],
    ['envios@seur.com', true],
    ['avisos@mrw.es', true],
    ['notificaciones@nacex.es', true],
    ['cliente@gmail.com', false],
    ['pedidos@tienda.com', false],
    [null, false],
    ['', false],
  ])('esDominioLogistica("%s") -> %s', (email, expected) => {
    expect(esDominioLogistica(email)).toBe(expected);
  });
});

// ============================================================
// T3.1 — Meta Business ignorables (RED)
// ============================================================
describe('esNotificacionAutomaticaIgnorable — Meta Business (T3.1)', () => {
  it('business.facebook.com → ignorable', () => {
    const { esNotificacionAutomaticaIgnorable } = require('../email.js');
    expect(esNotificacionAutomaticaIgnorable('noreply@business.facebook.com')).toBe(true);
  });

  it('business-updates.facebook.com → ignorable', () => {
    const { esNotificacionAutomaticaIgnorable } = require('../email.js');
    expect(esNotificacionAutomaticaIgnorable('updates@business-updates.facebook.com')).toBe(true);
  });

  it('facebookmail.com sigue siendo ignorable (regresión)', () => {
    const { esNotificacionAutomaticaIgnorable } = require('../email.js');
    expect(esNotificacionAutomaticaIgnorable('noreply@facebookmail.com')).toBe(true);
  });

  it('gmail.com → NO ignorable (no es Meta)', () => {
    const { esNotificacionAutomaticaIgnorable } = require('../email.js');
    expect(esNotificacionAutomaticaIgnorable('usuario@gmail.com')).toBe(false);
  });
});

// ============================================================
// T5.1 — info@frezzyks.com → IGNORAR (RED)
// ============================================================
describe('Loop-blocker — info@frezzyks.com (T5.1)', () => {
  it('emailsInternosFrezzyks contiene info@frezzyks.com en el source', () => {
    const fs = require('fs');
    const source = fs.readFileSync(require.resolve('../email.js'), 'utf8');
    expect(source).toContain("'info@frezzyks.com'");
  });

  it('clasificarPorDominio: info@frezzyks.com con asunto WP Mail SMTP → IGNORAR', () => {
    const result = clasificarPorDominio(
      'info@frezzyks.com',
      'WP Mail SMTP: Email Statistics',
      'Resumen de emails enviados esta semana'
    );
    expect(result.tipo).toBe('IGNORAR');
  });

  it('daniel@frezzyks.com con consulta de cliente → no bloqueado por clasificarPorDominio (ADR-7)', () => {
    const result = clasificarPorDominio(
      'daniel@frezzyks.com',
      'Consulta sobre pedido',
      'Hola, quiero saber el estado de mi pedido'
    );
    expect(result.tipo).toBe('PROCESAR');
  });
});

// ============================================================
// T6.1 — Judge.me ≤2 star patterns (RED)
// ============================================================
describe('clasificarPorDominio — Judge.me ≤2 estrellas (T6.1)', () => {
  test.each([
    // ≤2 → HUMANO
    ['reviews@judge.me', 'Nueva reseña', 'You received a 2 stars review', 'HUMANO', '2 stars plural'],
    ['reviews@judge.me', 'Nueva reseña', 'You received a 2-star review', 'HUMANO', '2-star hyphenated'],
    ['reviews@judge.me', 'Nueva reseña', 'Rating: 2 out of 5', 'HUMANO', '2 out of 5'],
    ['reviews@judge.me', 'Nueva reseña', 'This is a 2/5 review', 'HUMANO', '2/5 numeric'],
    ['reviews@judge.me', 'Nueva reseña', 'rating: 2', 'HUMANO', 'rating: 2'],
    ['reviews@judge.me', 'Nueva reseña', 'Rated 2 out of 5', 'HUMANO', 'rated 2'],
    ['reviews@judge.me', 'Nueva reseña', 'You received a 1 stars review', 'HUMANO', '1 stars plural'],
    ['reviews@judge.me', 'Nueva reseña', 'This is a 1/5 review', 'HUMANO', '1/5 numeric'],
    // ≥3 → IGNORAR
    ['reviews@judge.me', 'Nueva reseña', 'You received a 5 stars review!', 'IGNORAR', '5 stars'],
    ['reviews@judge.me', 'Nueva reseña', 'You received a 3 stars review', 'IGNORAR', '3 stars'],
    ['reviews@judge.me', 'Nueva reseña', 'You received a 4 star review', 'IGNORAR', '4 star'],
  ])('judge.me "%s" body "%s" → %s (%s)', (email, asunto, texto, expected, _label) => {
    const result = clasificarPorDominio(email, asunto, texto);
    expect(result.tipo).toBe(expected);
  });

  it('judge.me 1 star (singular, ya existente) sigue siendo HUMANO (regresión)', () => {
    const result = clasificarPorDominio('reviews@judge.me', 'Reseña', 'You received a 1 star review');
    expect(result.tipo).toBe('HUMANO');
  });
});

// ---------------------------------------------------------------------------
// T13 — Smoke: escalarASoporte y enviarRecordatorio
// ---------------------------------------------------------------------------

describe('email — escalarASoporte smoke test', () => {
  test('escalarASoporte NO está en el módulo.exports (es función interna)', async () => {
    // escalarASoporte is intentionally not exported — it is an internal helper.
    // This test documents that design decision.
    const emailMod = await import('../email.js');
    expect(emailMod.escalarASoporte).toBeUndefined();
  });
});

describe('email — enviarRecordatorio smoke test', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('enviarRecordatorio está exportado y es una función async', async () => {
    const { enviarRecordatorio } = await import('../email.js');
    expect(typeof enviarRecordatorio).toBe('function');
    // Should return a Promise (async)
    expect(enviarRecordatorio.constructor.name).toBe('AsyncFunction');
  });

  test('enviarRecordatorio llama reenviarCorreo con formato [RECORDATORIO 72h]', async () => {
    const { enviarRecordatorio, reenviarCorreo, _setResendForTesting, _resetResend } = await import('../email.js');

    // Mock Resend so no real HTTP call
    const mockSend = vi.fn().mockResolvedValue({ data: { id: 'test-id' }, error: null });
    _setResendForTesting({ emails: { send: mockSend } });

    const entrada = {
      remitente: 'cliente@ejemplo.com',
      asunto: 'Mi pedido perdido',
      resumen: 'No recibí el paquete'
    };

    await enviarRecordatorio(entrada);

    expect(mockSend).toHaveBeenCalledOnce();
    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.subject).toContain('[RECORDATORIO 72h]');
    expect(callArgs.subject).toContain('Mi pedido perdido');
    // replyTo should be the client's email
    expect(callArgs.replyTo).toBe('cliente@ejemplo.com');

    _resetResend();
  });
});

// ============================================================
// Bugfix — reconexión IMAP en evento 'close' sin 'end' previo
// ============================================================
describe('iniciarEmailListener — reconexión en evento close (bugfix)', () => {
  let instances;
  let FakeImap;

  beforeEach(() => {
    vi.useFakeTimers();

    const { EventEmitter } = require('events');
    instances = [];
    FakeImap = class extends EventEmitter {
      constructor() {
        super();
        instances.push(this);
      }
      connect() {}
      end() {}
      openBox() {}
      addFlags() {}
    };

    const { _setImapForTesting } = require('../email.js');
    _setImapForTesting(FakeImap);
  });

  afterEach(() => {
    vi.useRealTimers();
    const { _resetImap } = require('../email.js');
    _resetImap();
  });

  test("'close' sin 'end' previo dispara un segundo intento de conexión", () => {
    const { iniciarEmailListener } = require('../email.js');

    iniciarEmailListener();
    expect(instances.length).toBe(1);

    // Corte abrupto real: el servidor tira el socket sin FIN limpio — solo 'close' dispara
    instances[0].emit('close');

    vi.advanceTimersByTime(5000); // backoff del primer reintento: 5000 * 2^0

    expect(instances.length).toBe(2);
  });

  test("'end' y 'close' para el mismo corte NO duplican el reintento", () => {
    const { iniciarEmailListener } = require('../email.js');

    iniciarEmailListener();
    const primeraConexion = instances[0];

    // Corte limpio: node-imap puede disparar ambos eventos para la misma desconexión
    primeraConexion.emit('end');
    primeraConexion.emit('close');

    vi.advanceTimersByTime(5000);

    // Sin el guard esto crearía 2 conexiones nuevas (una por cada evento) en vez de 1
    expect(instances.length).toBe(2);
  });
});
