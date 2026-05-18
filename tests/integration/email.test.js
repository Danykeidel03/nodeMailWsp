// tests/integration/email.test.js
// Integration tests for email.js send/dedup logic.
// Uses dependency injection (_setResendForTesting) to mock Resend at the boundary.
// Uses vi.useFakeTimers() to control TTL-based dedup windows.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const {
  enviarCorreo,
  reenviarCorreo,
  yaProcessadoContenido,
  yaRespondidoRecientemente,
  detectarClienteTienda,
  _setResendForTesting,
  _resetResend
} = await import('../../email.js');

// Shared mock Resend instance — configured per-test via mockReset
const mockSend = vi.fn();
const mockResend = {
  emails: {
    send: mockSend
  }
};

describe('email.js — enviarCorreo (integration)', () => {
  beforeEach(() => {
    mockSend.mockReset();
    _setResendForTesting(mockResend);
  });

  afterEach(() => {
    _resetResend();
  });

  it('llama a resend.emails.send con los campos correctos', async () => {
    mockSend.mockResolvedValueOnce({ data: { id: 'msg-123' }, error: null });

    await enviarCorreo('dest@example.com', 'Hola mundo', '<orig-id>', 'Consulta del pedido');

    expect(mockSend).toHaveBeenCalledOnce();
    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.to).toContain('dest@example.com');
    expect(callArgs.text).toBe('Hola mundo');
  });

  it('antepone "Re:" al asunto si no lo tiene', async () => {
    mockSend.mockResolvedValueOnce({ data: { id: 'msg-124' }, error: null });

    await enviarCorreo('dest@example.com', 'cuerpo', '<mid>', 'Consulta del pedido');

    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.subject).toBe('Re: Consulta del pedido');
  });

  it('no duplica "Re:" si el asunto ya lo incluye', async () => {
    mockSend.mockResolvedValueOnce({ data: { id: 'msg-125' }, error: null });

    await enviarCorreo('dest@example.com', 'cuerpo', '<mid>', 'Re: Consulta del pedido');

    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.subject).toBe('Re: Consulta del pedido');
    expect(callArgs.subject.startsWith('Re: Re:')).toBe(false);
  });

  it('incluye In-Reply-To y References en los headers', async () => {
    mockSend.mockResolvedValueOnce({ data: { id: 'msg-126' }, error: null });

    await enviarCorreo('dest@example.com', 'cuerpo', '<thread-001>', 'Asunto');

    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.headers['In-Reply-To']).toBe('<thread-001>');
    expect(callArgs.headers['References']).toBe('<thread-001>');
  });

  it('lanza error cuando Resend devuelve un error en la respuesta', async () => {
    const resendError = { message: 'Resend API limit exceeded', statusCode: 429 };
    mockSend.mockResolvedValueOnce({ data: null, error: resendError });

    await expect(
      enviarCorreo('dest@example.com', 'cuerpo', '<mid>', 'Asunto')
    ).rejects.toBeDefined();
  });

  it('propaga excepcion cuando Resend.send() lanza un error', async () => {
    mockSend.mockRejectedValueOnce(new Error('Network error'));

    await expect(
      enviarCorreo('dest@example.com', 'cuerpo', '<mid>', 'Asunto')
    ).rejects.toThrow('Network error');
  });
});

describe('email.js — reenviarCorreo (integration)', () => {
  beforeEach(() => {
    mockSend.mockReset();
    _setResendForTesting(mockResend);
  });

  afterEach(() => {
    _resetResend();
  });

  it('formatea el asunto con [remitente] al inicio', async () => {
    mockSend.mockResolvedValueOnce({ data: { id: 'fwd-001' }, error: null });

    await reenviarCorreo(
      'soporte@frezzyks.com',
      'cliente@example.com',
      'cuerpo del mensaje',
      'Pedido dañado'
    );

    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.subject).toBe('[cliente@example.com] Pedido dañado');
  });

  it('envia al equipo interno, no al cliente', async () => {
    mockSend.mockResolvedValueOnce({ data: { id: 'fwd-002' }, error: null });

    await reenviarCorreo(
      'soporte@frezzyks.com',
      'cliente@example.com',
      'cuerpo',
      'Asunto'
    );

    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.to).toContain('soporte@frezzyks.com');
    expect(callArgs.to).not.toContain('cliente@example.com');
  });

  it('configura replyTo al remitente original para que el equipo responda directamente', async () => {
    mockSend.mockResolvedValueOnce({ data: { id: 'fwd-003' }, error: null });

    await reenviarCorreo(
      'soporte@frezzyks.com',
      'cliente@example.com',
      'cuerpo',
      'Asunto'
    );

    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.replyTo).toBe('cliente@example.com');
  });

  it('lanza error cuando Resend falla al reenviar', async () => {
    mockSend.mockRejectedValueOnce(new Error('send failed'));

    await expect(
      reenviarCorreo('soporte@frezzyks.com', 'c@x.com', 'cuerpo', 'Asunto')
    ).rejects.toThrow('send failed');
  });
});

describe('T1.3 — Integración pipeline Shopify B2B Tienda → ventas@frezzyks.com', () => {
  beforeEach(() => {
    mockSend.mockReset();
    _setResendForTesting(mockResend);
  });

  afterEach(() => {
    _resetResend();
  });

  it('detectarClienteTienda detecta el payload canónico de Shopify', () => {
    const textoShopify = 'Nombre: Juan García\nTipo De Cliente: Tienda\nCiudad: Madrid';
    expect(detectarClienteTienda(textoShopify)).toBe(true);
  });

  it('reenviarCorreo envía a ventas@frezzyks.com cuando es el destinatario del equipo', async () => {
    mockSend.mockResolvedValueOnce({ data: { id: 'ventas-001' }, error: null });
    const textoShopify = 'Nombre: Juan García\nTipo De Cliente: Tienda\nCiudad: Madrid';

    await reenviarCorreo('ventas@frezzyks.com', 'juan@tienda.com', textoShopify, 'Consulta B2B');

    expect(mockSend).toHaveBeenCalledOnce();
    const callArgs = mockSend.mock.calls[0][0];
    expect(callArgs.to).toContain('ventas@frezzyks.com');
    expect(callArgs.to).not.toContain('juan@tienda.com');
  });

  it('VALIDACIÓN 1.5 — pipeline enruta Shopify tienda a ventas@ sin responder al cliente', async () => {
    mockSend.mockResolvedValue({ data: { id: 'ventas-pipeline-001' }, error: null });
    const textoShopify = 'Nombre: Juan García\nTipo De Cliente: Tienda\nCiudad: Madrid';

    const isShopifyTienda = detectarClienteTienda(textoShopify);
    expect(isShopifyTienda).toBe(true);

    if (isShopifyTienda) {
      await reenviarCorreo('ventas@frezzyks.com', 'juan@tienda.com', textoShopify, 'Consulta B2B', []);
    }

    expect(mockSend).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ to: expect.arrayContaining(['ventas@frezzyks.com']) })
    );
    expect(mockSend).not.toHaveBeenCalledWith(
      expect.objectContaining({ to: expect.arrayContaining(['juan@tienda.com']) })
    );
  });
});

describe('email.js — yaProcessadoContenido (dedup)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('devuelve false la primera vez que se consulta un email+asunto', () => {
    // Use a unique combination per test to avoid cross-test contamination
    const result = yaProcessadoContenido('nuevo@test.com', 'asunto-unico-1');
    expect(result).toBe(false);
  });

  it('yaRespondidoRecientemente devuelve false para un threadId nuevo', () => {
    const result = yaRespondidoRecientemente('thread-nuevo-xyz');
    expect(result).toBe(false);
  });
});
