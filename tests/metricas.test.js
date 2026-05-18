// tests/metricas.test.js
import { describe, test, expect, beforeEach } from 'vitest';
import {
  registrarEmailEscalado,
  obtenerMetricas
} from '../metricas.js';

describe('metricas — registrarEmailEscalado', () => {
  test("registrarEmailEscalado('ventas') incrementa emailsEscaladosVentas", () => {
    const antes = obtenerMetricas();
    const ventasAntes = antes.escaladosVentas ?? 0;
    registrarEmailEscalado('ventas');
    const despues = obtenerMetricas();
    expect(despues.escaladosVentas).toBe(ventasAntes + 1);
  });

  test("registrarEmailEscalado('VENTAS') también incrementa el contador", () => {
    const antes = obtenerMetricas();
    const ventasAntes = antes.escaladosVentas ?? 0;
    registrarEmailEscalado('VENTAS');
    const despues = obtenerMetricas();
    expect(despues.escaladosVentas).toBe(ventasAntes + 1);
  });
});
