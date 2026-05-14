// tests/integration/shopify.test.js
// Integration tests for obtenerSeguimientoPorPedido.
// Uses dependency injection (_setFetchForTesting) instead of vi.mock because
// shopify.js is CJS and Vitest's mock registry does not intercept CJS require() calls.
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';

const {
  obtenerSeguimientoPorPedido,
  _setFetchForTesting,
  _resetFetch
} = await import('../../shopify.js');

const fetchMock = vi.fn();

describe('shopify.obtenerSeguimientoPorPedido (integration)', () => {
  const ORIG_SHOP = process.env.SHOPIFY_SHOP;
  const ORIG_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;

  beforeEach(() => {
    fetchMock.mockReset();
    _setFetchForTesting(fetchMock);
    process.env.SHOPIFY_SHOP = 'test.myshopify.com';
    process.env.SHOPIFY_ACCESS_TOKEN = 'test-token';
  });

  afterAll(() => {
    _resetFetch();
    if (ORIG_SHOP !== undefined) process.env.SHOPIFY_SHOP = ORIG_SHOP;
    else delete process.env.SHOPIFY_SHOP;
    if (ORIG_TOKEN !== undefined) process.env.SHOPIFY_ACCESS_TOKEN = ORIG_TOKEN;
    else delete process.env.SHOPIFY_ACCESS_TOKEN;
  });

  it('devuelve { error, encontrado: false } cuando faltan credenciales de Shopify', async () => {
    delete process.env.SHOPIFY_SHOP;
    delete process.env.SHOPIFY_ACCESS_TOKEN;

    const result = await obtenerSeguimientoPorPedido('5070');

    expect(result.encontrado).toBe(false);
    expect(result.error).toBeDefined();
    // Early return before fetch — no HTTP call made
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('devuelve seguimiento completo cuando Shopify responde con pedido y fulfillments', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        orders: [
          {
            fulfillments: [
              {
                tracking_numbers: ['9930002528317467'],
                status: 'success'
              }
            ],
            customer: { email: 'cliente@example.com' },
            total_price: '50.00',
            currency: 'EUR'
          }
        ]
      })
    });

    const result = await obtenerSeguimientoPorPedido('5070');

    expect(result.encontrado).toBe(true);
    expect(result.numeroPedido).toBe('5070');
    expect(result.numeroSeguimiento).toBe('9930002528317467');
    expect(result.estadoEntrega).toBe('success');
    expect(result.cliente).toBe('cliente@example.com');
    expect(result.total).toBe('50.00');
    expect(result.moneda).toBe('EUR');
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it('devuelve { encontrado: false, error } cuando Shopify no devuelve pedidos', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ orders: [] })
    });

    const result = await obtenerSeguimientoPorPedido('9999');

    expect(result.encontrado).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('devuelve { encontrado: true } sin numeroSeguimiento cuando el pedido no tiene fulfillments', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        orders: [
          {
            fulfillments: [],
            customer: { email: 'cliente@example.com' },
            total_price: '30.00',
            currency: 'EUR'
          }
        ]
      })
    });

    const result = await obtenerSeguimientoPorPedido('5071');

    expect(result.encontrado).toBe(true);
    expect(result.numeroPedido).toBe('5071');
    // No tracking number assigned yet — fulfillments array is empty
    expect(result.numeroSeguimiento).toBeUndefined();
    expect(result.error).toMatch(/seguimiento/i);
  });

  it('devuelve { encontrado: false, error } cuando Shopify API responde con error HTTP', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => 'Internal Server Error'
    });

    const result = await obtenerSeguimientoPorPedido('5070');

    expect(result.encontrado).toBe(false);
    expect(result.error).toBeDefined();
  });

  it('captura excepcion de red y devuelve { error: message }', async () => {
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    const result = await obtenerSeguimientoPorPedido('5070');

    expect(result.error).toBe('network down');
    expect(result.encontrado).toBeUndefined();
  });
});
