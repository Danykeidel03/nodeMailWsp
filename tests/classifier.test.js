// tests/classifier.test.js
import { describe, it, expect } from 'vitest';
import {
  detectarFrustracion,
  detectarBucle,
  extraerNumeroPedido,
  extraerNumeroSeguimiento,
  ESTADOS_INTERNOS
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
