// tests/integration/classifier.test.js
// Integration tests for clasificarYResponder.
// Uses dependency injection (_setOpenAIForTesting) to mock OpenAI at the boundary.
// Tests pure-logic paths (frustration, loop) require no mocks at all.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  clasificarYResponder,
  _setOpenAIForTesting,
  _resetOpenAI
} = await import('../../classifier.js');

// Shared mock for OpenAI completions
const mockCreate = vi.fn();
const mockOpenAI = {
  chat: {
    completions: {
      create: mockCreate
    }
  }
};

// Helper to build a mock completion response
function makeCompletion(content) {
  return {
    choices: [
      { message: { content } }
    ]
  };
}

describe('clasificarYResponder — rutas sin llamada a OpenAI', () => {
  it('devuelve SOPORTE cuando detecta frustración en el mensaje', async () => {
    const result = await clasificarYResponder(
      'Estoy harto de esto, ya me dijiste lo mismo antes',
      'cliente@example.com',
      'Reclamación'
    );
    expect(result).toBe('SOPORTE');
  });

  it('devuelve SOPORTE cuando detecta bucle de conversacion (>= 2 respuestas del bot)', async () => {
    const historial = [
      { rol: 'cliente', texto: 'Pregunta 1' },
      { rol: 'bot', texto: 'Respuesta 1' },
      { rol: 'cliente', texto: 'Pregunta 2' },
      { rol: 'bot', texto: 'Respuesta 2' }
    ];
    const result = await clasificarYResponder(
      'Otra pregunta más',
      'cliente@example.com',
      'Seguimiento',
      historial
    );
    expect(result).toBe('SOPORTE');
  });

  it('devuelve null cuando el mensaje contiene la palabra "persona" sin frustración', async () => {
    // "persona" check is at line 204 in classifier.js, after frustration/loop detection.
    // Use a neutral phrase that contains "persona" but doesn't trigger the frustration list.
    const result = await clasificarYResponder(
      'La persona de referencia del pedido es Juan',
      'cliente@example.com',
      'Datos del pedido'
    );
    expect(result).toBeNull();
  });
});

describe('clasificarYResponder — rutas con llamada a OpenAI (mocked)', () => {
  beforeEach(() => {
    mockCreate.mockReset();
    _setOpenAIForTesting(mockOpenAI);
  });

  afterEach(() => {
    _resetOpenAI();
  });

  it('devuelve objeto { destinatario, mensaje } cuando OpenAI genera una respuesta normal', async () => {
    mockCreate.mockResolvedValueOnce(
      makeCompletion('Hola, su pedido está en camino. ¿Necesita algo más?')
    );

    const result = await clasificarYResponder(
      'Buenos días, ¿cuándo llega mi paquete?',
      'cliente@example.com',
      'Estado del envío'
    );

    expect(result).toMatchObject({
      destinatario: 'cliente@example.com',
      mensaje: 'Hola, su pedido está en camino. ¿Necesita algo más?'
    });
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it('devuelve SOPORTE cuando OpenAI responde con SOPORTE en el contenido', async () => {
    mockCreate.mockResolvedValueOnce(makeCompletion('SOPORTE'));

    const result = await clasificarYResponder(
      'Tengo un problema grave',
      'cliente@example.com',
      'Problema'
    );

    expect(result).toBe('SOPORTE');
  });

  it('devuelve SAMU cuando OpenAI responde con SAMU en el contenido', async () => {
    mockCreate.mockResolvedValueOnce(makeCompletion('SAMU'));

    const result = await clasificarYResponder(
      'Mensaje de dirección',
      'direccion@frezzyks.com',
      'Dirección'
    );

    expect(result).toBe('SAMU');
  });

  it('devuelve NECESITA_PERSONA cuando OpenAI lo indica', async () => {
    mockCreate.mockResolvedValueOnce(makeCompletion('NECESITA_PERSONA'));

    const result = await clasificarYResponder(
      'Situación compleja',
      'cliente@example.com',
      'Consulta'
    );

    expect(result).toBe('NECESITA_PERSONA');
  });

  it('propaga el error cuando OpenAI lanza una excepcion', async () => {
    mockCreate.mockRejectedValueOnce(new Error('OpenAI rate limit'));

    await expect(
      clasificarYResponder('Hola', 'cliente@example.com', 'Asunto')
    ).rejects.toThrow('OpenAI rate limit');
  });

  it('no llama a OpenAI cuando la frustracion es detectada antes', async () => {
    const result = await clasificarYResponder(
      'No me entiendes, esto es inadmisible',
      'cliente@example.com',
      'Queja'
    );

    // Frustration detected first — OpenAI is never consulted
    expect(result).toBe('SOPORTE');
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
