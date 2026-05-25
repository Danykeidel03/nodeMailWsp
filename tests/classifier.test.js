// tests/classifier.test.js
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  detectarFrustracion,
  detectarBucle,
  extraerNumeroPedido,
  extraerNumeroSeguimiento,
  ESTADOS_INTERNOS,
  detectarIntencionSeguimiento,
  detectarEstadoInterno,
} from '../classifier.js';


describe('Classifier - Detección de Frustración', () => {
  
  test.each([
    ['Eso ya me dijiste antes', true],
    ['Esa respuesta no me sirve', true],
    ['Estoy harto de esperar', true],
    ['Quiero hablar con una persona real', true],
    ['Pasadme con un humano por favor', true],
    ['Hola, ¿dónde está mi pedido?', false],
    ['Muchas gracias por la ayuda', false],
    ['ESTOY HARTA de esto', true],
    ['Ya Me Dijiste eso', true],
  ])('detectarFrustracion("%s") -> %s', (mensaje, expected) => {
    expect(detectarFrustracion(mensaje)).toBe(expected);
  });
});


describe('Classifier - Detección de Bucle', () => {
  
  const historialConBucle = [
    { rol: 'cliente', texto: 'Pregunta 1' },
    { rol: 'bot', texto: 'Respuesta 1' },
    { rol: 'cliente', texto: 'Pregunta 2' },
    { rol: 'bot', texto: 'Respuesta 2' }
  ];

  const historialSinBucle1 = [
    { rol: 'cliente', texto: 'Pregunta 1' },
    { rol: 'bot', texto: 'Respuesta 1' }
  ];

  const historialSinBucle2 = [
    { rol: 'cliente', texto: 'Pregunta 1' },
    { rol: 'bot', texto: 'Respuesta 1' },
    { rol: 'cliente', texto: 'Pregunta 2' }
  ];

  test.each([
    [historialConBucle, true],
    [historialSinBucle1, false],
    [[], false],
    [historialSinBucle2, false],
  ])('detectarBucle con %d mensajes -> %s', (historial, expected) => {
    expect(detectarBucle(historial)).toBe(expected);
  });
});


describe('Classifier - Extracción de Número de Pedido', () => {
  
  test.each([
    ['Mi pedido es #5070', '5070'],
    ['El pedido 12345 no ha llegado', '12345'],
    ['Mi número de pedido: 9999', '9999'],
    ['Consulto por el pedido #7777', '7777'],
    ['Pedido 123', null],
    ['Hola, tengo una consulta', null],
    ['PEDIDO #5555', '5555'],
    ['Número de Pedido: 6666', '6666'],
  ])('extraerNumeroPedido("%s") -> %s', (texto, expected) => {
    expect(extraerNumeroPedido(texto)).toBe(expected);
  });
});


describe('Classifier - Extracción de Número de Seguimiento', () => {
  
  test.each([
    ['Mi tracking es 9930002528317467', '9930002528317467'],
    ['Número de seguimiento: 1234567890123', '1234567890123'],
    ['tracking 9999888877776666', '9999888877776666'],
    ['El número es 123456789012', null],
    ['¿Dónde está mi paquete?', null],
  ])('extraerNumeroSeguimiento("%s") -> %s', (texto, expected) => {
    expect(extraerNumeroSeguimiento(texto)).toBe(expected);
  });
});


describe('Classifier - Estados Internos', () => {
  
  it('ESTADOS_INTERNOS debe contener los 4 estados', () => {
    expect(ESTADOS_INTERNOS).toContain('SOPORTE');
    expect(ESTADOS_INTERNOS).toContain('SAMU');
    expect(ESTADOS_INTERNOS).toContain('NECESITA_PERSONA');
    expect(ESTADOS_INTERNOS).toContain('SIN_RESPUESTA');
  });

  it('ESTADOS_INTERNOS no debe contener estados normales', () => {
    expect(ESTADOS_INTERNOS).not.toContain('OK');
    expect(ESTADOS_INTERNOS).not.toContain('RESPUESTA');
  });
});

// ============================================================
// T1.1 — detectarIntencionSeguimiento helper
// ============================================================
describe('Classifier - detectarIntencionSeguimiento (T1.1)', () => {
  test.each([
    ['dónde está mi pedido', true],
    ['donde está mi pedido', true],
    ['¿Dónde está mi paquete?', true],
    ['quiero el tracking de mi envío', true],
    ['tracking PKCZG09800025120147014R', true],
    ['estado del pedido', true],
    ['estado de mi pedido', true],
    ['en tránsito desde ayer', true],
    ['cuándo llega mi pedido', true],
    ['cuando llega el paquete', true],
    ['no me ha llegado aún', true],
    ['no ha llegado todavía', true],
    ['seguimiento de mi envío', true],
    ['rastrear mi paquete', true],
    ['me falta una bolsita en el pedido', false],
    ['quiero hacer una devolución', false],
    ['el producto llegó roto', false],
    ['tengo una consulta sobre facturación', false],
    ['', false],
    [null, false],
  ])('detectarIntencionSeguimiento("%s") -> %s', (texto, expected) => {
    expect(detectarIntencionSeguimiento(texto)).toBe(expected);
  });
});

// ============================================================
// T1.2 — Intent gate integration: gating extraerNumeroSeguimiento on body intent
// ============================================================
describe('Classifier - intent gate: subject tracking not extracted without body intent (T1.2)', () => {
  it('body sin intención → extraerNumeroSeguimiento sobre body devuelve null', () => {
    // Body de "falta una bolsita" — sin keywords de tracking
    const body = 'me falta una bolsita en mi pedido, pueden revisar?';
    const result = extraerNumeroSeguimiento(body);
    expect(result).toBeNull();
  });

  it('body sin intención → detectarIntencionSeguimiento devuelve false, sin lookup de asunto', () => {
    const body = 'me falta una bolsita en mi pedido';
    const asunto = 'Pedido #1234 - PKCZG09800025120147014R';
    // Sin intent en body, el asunto no debe ser fuente de tracking
    const intent = detectarIntencionSeguimiento(body);
    expect(intent).toBe(false);
    // Si intent es false, NO se debe buscar en asunto
    const trackingDeAsunto = intent ? extraerNumeroSeguimiento(asunto) : null;
    expect(trackingDeAsunto).toBeNull();
  });

  it('body con intención de tracking → detectarIntencionSeguimiento true, permite lookup', () => {
    const body = '¿dónde está mi pedido? aquí el tracking: PKCZG09800025120147014R';
    const intent = detectarIntencionSeguimiento(body);
    expect(intent).toBe(true);
  });

  it('body con intención → extraerNumeroSeguimiento sobre body encuentra el tracking', () => {
    const body = 'dónde está mi pedido 9930002528317467';
    const result = extraerNumeroSeguimiento(body);
    expect(result).toBe('9930002528317467');
  });
});

// ============================================================
// T4.1 — detectarEstadoInterno helper (token-anchored match)
// ============================================================
describe('Classifier - detectarEstadoInterno token-anchored (T4.1)', () => {
  test.each([
    // Leading token on first line
    ['SAMU\nexplicación larga aquí', 'SAMU'],
    ['SOPORTE\nes necesario aquí', 'SOPORTE'],
    ['SIN_RESPUESTA\nno corresponde responder', 'SIN_RESPUESTA'],
    ['NECESITA_PERSONA\nderiving to human', 'NECESITA_PERSONA'],
    ['samu\nminusculas', 'SAMU'],
    // State token at start of a subsequent line (multi-line LLM response)
    ['Esta propuesta menciona SAMU pero no aplica.\nSIN_RESPUESTA', 'SIN_RESPUESTA'],
    // Mid-sentence on same line — should NOT match
    ['El usuario necesita SOPORTE técnico detallado', null],
    ['Hola, menciona SAMU en contexto pero empieza distinto', null],
    ['   SAMU   ', 'SAMU'],  // trimmed leading whitespace
    // No match
    ['El pedido llegará pronto', null],
    [null, null],
    ['', null],
  ])('detectarEstadoInterno("%s") -> %s', (respuesta, expected) => {
    expect(detectarEstadoInterno(respuesta)).toBe(expected);
  });

  it('SAMU mid-sentence: "SOPORTE es necesario aquí" → SOPORTE (first token of first line)', () => {
    const result = detectarEstadoInterno('SOPORTE es necesario aquí');
    expect(result).toBe('SOPORTE');
  });

  it('SAMU mid-sentence: "El usuario necesita SOPORTE técnico" → null (SOPORTE not leading)', () => {
    const result = detectarEstadoInterno('El usuario necesita SOPORTE técnico');
    expect(result).toBeNull();
  });
});
