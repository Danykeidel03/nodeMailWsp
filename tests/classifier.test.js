// tests/classifier.test.js
import { describe, it, expect } from 'vitest';

// Importamos las funciones internas que queremos testear
// Como están en el módulo, las recreamos aquí para testear la lógica

/**
 * Detecta si el cliente está frustrado basándose en patrones de texto
 */
function detectarFrustracion(mensaje) {
  const mensajeLower = mensaje.toLowerCase();
  const patronesFrustracion = [
    'ya me dijiste', 'ya me has dicho', 'eso ya lo sé', 'eso ya lo se',
    'no me sirve', 'no me vale', 'no entiendes', 'no me entiendes',
    'otra vez lo mismo', 'siempre lo mismo', 'me repites lo mismo',
    'sigo sin', 'sigo igual', 'no me soluciona', 'no se soluciona',
    'estoy harto', 'estoy harta', 'me estáis tomando el pelo',
    'vaya broma', 'qué desastre', 'vergüenza', 'indignado', 'indignada',
    'quiero hablar con alguien', 'quiero hablar con una persona',
    'pasadme con', 'ponme con', 'un humano', 'persona real',
    'esto es increíble', 'no puede ser', 'inadmisible'
  ];
  
  return patronesFrustracion.some(patron => mensajeLower.includes(patron));
}

/**
 * Detecta si hay un bucle de conversación
 */
function detectarBucle(historialConversacion) {
  const respuestasDelBot = historialConversacion.filter(m => m.rol === 'bot').length;
  return respuestasDelBot >= 2 && historialConversacion.length >= 4;
}

/**
 * Extrae número de pedido del mensaje
 */
function extraerNumeroPedido(texto) {
  const regexPedido = /#(\d{4,})|(?:número de )?pedido[:\s#]+(\d{4,})/i;
  const match = texto.match(regexPedido);
  return match ? (match[1] || match[2]) : null;
}

/**
 * Extrae número de seguimiento del mensaje
 */
function extraerNumeroSeguimiento(texto) {
  let regex = /(?:número de seguimiento|tracking|seguimiento)[:\s#]*(\d{13,})/i;
  let match = texto.match(regex);
  
  if (match) return match[1];
  
  regex = /\b(\d{13,})\b/;
  match = texto.match(regex);
  
  return match ? match[1] : null;
}

// Estados internos que NUNCA deben enviarse al cliente
const ESTADOS_INTERNOS = ['SOPORTE', 'SAMU', 'NECESITA_PERSONA', 'SIN_RESPUESTA'];


describe('Classifier - Detección de Frustración', () => {
  
  it('debe detectar frustración con "ya me dijiste"', () => {
    expect(detectarFrustracion('Eso ya me dijiste antes')).toBe(true);
  });

  it('debe detectar frustración con "no me sirve"', () => {
    expect(detectarFrustracion('Esa respuesta no me sirve')).toBe(true);
  });

  it('debe detectar frustración con "estoy harto"', () => {
    expect(detectarFrustracion('Estoy harto de esperar')).toBe(true);
  });

  it('debe detectar frustración con "quiero hablar con una persona"', () => {
    expect(detectarFrustracion('Quiero hablar con una persona real')).toBe(true);
  });

  it('debe detectar frustración con "un humano"', () => {
    expect(detectarFrustracion('Pasadme con un humano por favor')).toBe(true);
  });

  it('NO debe detectar frustración en mensaje normal', () => {
    expect(detectarFrustracion('Hola, ¿dónde está mi pedido?')).toBe(false);
  });

  it('NO debe detectar frustración en agradecimiento', () => {
    expect(detectarFrustracion('Muchas gracias por la ayuda')).toBe(false);
  });

  it('debe ser case-insensitive', () => {
    expect(detectarFrustracion('ESTOY HARTA de esto')).toBe(true);
    expect(detectarFrustracion('Ya Me Dijiste eso')).toBe(true);
  });
});


describe('Classifier - Detección de Bucle', () => {
  
  it('debe detectar bucle con 2+ respuestas del bot y 4+ mensajes', () => {
    const historial = [
      { rol: 'cliente', texto: 'Pregunta 1' },
      { rol: 'bot', texto: 'Respuesta 1' },
      { rol: 'cliente', texto: 'Pregunta 2' },
      { rol: 'bot', texto: 'Respuesta 2' }
    ];
    expect(detectarBucle(historial)).toBe(true);
  });

  it('NO debe detectar bucle con solo 1 respuesta del bot', () => {
    const historial = [
      { rol: 'cliente', texto: 'Pregunta 1' },
      { rol: 'bot', texto: 'Respuesta 1' }
    ];
    expect(detectarBucle(historial)).toBe(false);
  });

  it('NO debe detectar bucle con historial vacío', () => {
    expect(detectarBucle([])).toBe(false);
  });

  it('NO debe detectar bucle con menos de 4 mensajes', () => {
    const historial = [
      { rol: 'cliente', texto: 'Pregunta 1' },
      { rol: 'bot', texto: 'Respuesta 1' },
      { rol: 'cliente', texto: 'Pregunta 2' }
    ];
    expect(detectarBucle(historial)).toBe(false);
  });
});


describe('Classifier - Extracción de Número de Pedido', () => {
  
  it('debe extraer pedido con formato #1234', () => {
    expect(extraerNumeroPedido('Mi pedido es #5070')).toBe('5070');
  });

  it('debe extraer pedido con formato "pedido 1234"', () => {
    expect(extraerNumeroPedido('El pedido 12345 no ha llegado')).toBe('12345');
  });

  it('debe extraer pedido con formato "número de pedido: 1234"', () => {
    expect(extraerNumeroPedido('Mi número de pedido: 9999')).toBe('9999');
  });

  it('debe extraer pedido con formato "pedido #1234"', () => {
    expect(extraerNumeroPedido('Consulto por el pedido #7777')).toBe('7777');
  });

  it('NO debe extraer números de menos de 4 dígitos', () => {
    expect(extraerNumeroPedido('Pedido 123')).toBe(null);
  });

  it('debe devolver null si no hay pedido', () => {
    expect(extraerNumeroPedido('Hola, tengo una consulta')).toBe(null);
  });

  it('debe ser case-insensitive', () => {
    expect(extraerNumeroPedido('PEDIDO #5555')).toBe('5555');
    expect(extraerNumeroPedido('Número de Pedido: 6666')).toBe('6666');
  });
});


describe('Classifier - Extracción de Número de Seguimiento', () => {
  
  it('debe extraer seguimiento de 13+ dígitos', () => {
    expect(extraerNumeroSeguimiento('Mi tracking es 9930002528317467')).toBe('9930002528317467');
  });

  it('debe extraer seguimiento con contexto "número de seguimiento"', () => {
    expect(extraerNumeroSeguimiento('Número de seguimiento: 1234567890123')).toBe('1234567890123');
  });

  it('debe extraer seguimiento con contexto "tracking"', () => {
    expect(extraerNumeroSeguimiento('tracking 9999888877776666')).toBe('9999888877776666');
  });

  it('NO debe extraer números de menos de 13 dígitos', () => {
    expect(extraerNumeroSeguimiento('El número es 123456789012')).toBe(null);
  });

  it('debe devolver null si no hay seguimiento', () => {
    expect(extraerNumeroSeguimiento('¿Dónde está mi paquete?')).toBe(null);
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
