// tests/escalados.test.js
// Tests para el módulo escalados.js
// Estrategia de aislamiento: la función _setPathForTesting() permite
// redirigir PATH_ESCALADOS a un archivo temporal por cada test.

import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

const TMP_PATH = path.join(os.tmpdir(), 'escalados-test.json');

function cleanTmp() {
  try { if (fs.existsSync(TMP_PATH)) fs.unlinkSync(TMP_PATH); } catch { /* ignore */ }
}

// El módulo debe exportar _setPathForTesting para aislamiento en tests
// (similar a _setResendForTesting en email.js)
import {
  leerEscalados,
  guardarEscalados,
  PATH_ESCALADOS,
  VENTANA_MS,
  _setPathForTesting,
  _resetPath,
} from '../escalados.js';

describe('escalados — leerEscalados', () => {
  beforeEach(() => {
    cleanTmp();
    _setPathForTesting(TMP_PATH);
  });

  afterEach(() => {
    _resetPath();
    cleanTmp();
  });

  test('devuelve {} cuando el archivo no existe', () => {
    const result = leerEscalados();
    expect(result).toEqual({});
  });

  test('devuelve el objeto parseado correctamente', () => {
    const data = {
      'abc-123': { remitente: 'a@b.com', asunto: 'Test', resumen: 'r', escaladoEn: new Date().toISOString() }
    };
    fs.writeFileSync(TMP_PATH, JSON.stringify(data));
    const result = leerEscalados();
    expect(result).toEqual(data);
  });

  test('json-corrupto-fallback — devuelve {} ante JSON inválido', () => {
    fs.writeFileSync(TMP_PATH, 'ESTO NO ES JSON{{{');
    const result = leerEscalados();
    expect(result).toEqual({});
  });

  test('devuelve {} cuando el contenido es un array (formato inválido)', () => {
    fs.writeFileSync(TMP_PATH, JSON.stringify([{ remitente: 'a@b.com' }]));
    const result = leerEscalados();
    expect(result).toEqual({});
  });

  test('devuelve {} cuando el contenido es null', () => {
    fs.writeFileSync(TMP_PATH, 'null');
    const result = leerEscalados();
    expect(result).toEqual({});
  });
});

describe('escalados — guardarEscalados', () => {
  beforeEach(() => {
    cleanTmp();
    _setPathForTesting(TMP_PATH);
  });

  afterEach(() => {
    _resetPath();
    cleanTmp();
  });

  test('escribe el objeto en disco como JSON formateado', () => {
    const data = {
      'uuid-1': { remitente: 'x@y.com', asunto: 'A', resumen: 'B', escaladoEn: '2026-01-01T00:00:00.000Z' }
    };
    guardarEscalados(data);
    const leido = JSON.parse(fs.readFileSync(TMP_PATH, 'utf8'));
    expect(leido).toEqual(data);
  });

  test('startup-no-borra-json — leerEscalados en archivo existente no muta el contenido', () => {
    const data = {
      'z-1': { remitente: 'q@w.com', asunto: 'Q', resumen: 'W', escaladoEn: '2026-01-01T00:00:00.000Z' }
    };
    fs.writeFileSync(TMP_PATH, JSON.stringify(data));
    leerEscalados(); // solo lectura — no debe mutar el archivo
    const raw = JSON.parse(fs.readFileSync(TMP_PATH, 'utf8'));
    expect(raw).toEqual(data);
  });
});

// --- T2: RED tests for registrarEscalado ---
describe('escalados — registrarEscalado', () => {
  beforeEach(() => {
    cleanTmp();
    _setPathForTesting(TMP_PATH);
  });

  afterEach(() => {
    _resetPath();
    cleanTmp();
  });

  test('registra-escalado-en-json — escribe la entrada al archivo', async () => {
    const mod = await import('../escalados.js');
    expect(mod.registrarEscalado).toBeDefined();
    mod.registrarEscalado({ remitente: 'cliente@test.com', asunto: 'Asunto test', resumen: 'Resumen corto' });
    const data = leerEscalados();
    const keys = Object.keys(data);
    expect(keys).toHaveLength(1);
    const entrada = data[keys[0]];
    expect(entrada.remitente).toBe('cliente@test.com');
    expect(entrada.asunto).toBe('Asunto test');
    expect(entrada.resumen).toBe('Resumen corto');
    expect(Date.parse(entrada.escaladoEn)).not.toBeNaN();
  });

  test('no-pisa-entradas-existentes — N entradas + 1 nueva = N+1', async () => {
    const mod = await import('../escalados.js');
    const existing = {
      'uuid-prev': { remitente: 'a@a.com', asunto: 'Prev', resumen: 'p', escaladoEn: new Date().toISOString() }
    };
    guardarEscalados(existing);
    mod.registrarEscalado({ remitente: 'b@b.com', asunto: 'Nueva', resumen: 'nueva entrada' });
    const data = leerEscalados();
    expect(Object.keys(data)).toHaveLength(2);
    expect(data['uuid-prev']).toBeDefined();
  });

  test('trunca-resumen-a-300-chars — resumen > 300 chars queda en exactamente 300', async () => {
    const mod = await import('../escalados.js');
    const resumenLargo = 'A'.repeat(500);
    mod.registrarEscalado({ remitente: 'c@c.com', asunto: 'Truncar', resumen: resumenLargo });
    const data = leerEscalados();
    const keys = Object.keys(data);
    expect(data[keys[0]].resumen).toHaveLength(300);
  });

  test('retorna un UUID válido', async () => {
    const mod = await import('../escalados.js');
    const id = mod.registrarEscalado({ remitente: 'd@d.com', asunto: 'ID test', resumen: 'r' });
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
  });
});

// --- T4: RED tests for procesarRecordatorios ---
describe('escalados — procesarRecordatorios', () => {
  beforeEach(() => {
    cleanTmp();
    _setPathForTesting(TMP_PATH);
  });

  afterEach(() => {
    _resetPath();
    cleanTmp();
    vi.useRealTimers();
  });

  test('filtra-casos-72h — solo envía los que superaron 72h', async () => {
    const mod = await import('../escalados.js');
    expect(mod.procesarRecordatorios).toBeDefined();

    const ahora = Date.now();
    const data = {
      'old-73h': { remitente: 'a@a.com', asunto: 'old', resumen: 'r1', escaladoEn: new Date(ahora - 73 * 3600 * 1000).toISOString() },
      'old-96h': { remitente: 'b@b.com', asunto: 'old2', resumen: 'r2', escaladoEn: new Date(ahora - 96 * 3600 * 1000).toISOString() },
      'young-48h': { remitente: 'c@c.com', asunto: 'joven', resumen: 'r3', escaladoEn: new Date(ahora - 48 * 3600 * 1000).toISOString() },
    };
    guardarEscalados(data);

    const enviarFn = vi.fn().mockResolvedValue(undefined);
    const stats = await mod.procesarRecordatorios(enviarFn);

    expect(enviarFn).toHaveBeenCalledTimes(2);
    expect(stats.enviados).toBe(2);
    expect(stats.vivos).toBe(1);
    expect(stats.fallidos).toBe(0);
  });

  test('no-filtra-casos-menores — 48h no dispara enviarFn', async () => {
    const mod = await import('../escalados.js');
    const ahora = Date.now();
    const data = {
      'young': { remitente: 'a@a.com', asunto: 'joven', resumen: 'r', escaladoEn: new Date(ahora - 48 * 3600 * 1000).toISOString() }
    };
    guardarEscalados(data);

    const enviarFn = vi.fn().mockResolvedValue(undefined);
    const stats = await mod.procesarRecordatorios(enviarFn);

    expect(enviarFn).not.toHaveBeenCalled();
    expect(stats.vivos).toBe(1);
    expect(stats.enviados).toBe(0);
  });

  test('borra-entrada-tras-envio-exitoso — entry removida del JSON', async () => {
    const mod = await import('../escalados.js');
    const ahora = Date.now();
    const data = {
      'overdue': { remitente: 'x@x.com', asunto: 'test', resumen: 'r', escaladoEn: new Date(ahora - 80 * 3600 * 1000).toISOString() }
    };
    guardarEscalados(data);

    const enviarFn = vi.fn().mockResolvedValue(undefined);
    await mod.procesarRecordatorios(enviarFn);

    const remaining = leerEscalados();
    expect(Object.keys(remaining)).toHaveLength(0);
  });

  test('retiene-entrada-si-fallo-envio — entry sigue en JSON si enviarFn lanza', async () => {
    const mod = await import('../escalados.js');
    const ahora = Date.now();
    const data = {
      'overdue': { remitente: 'y@y.com', asunto: 'fallo', resumen: 'r', escaladoEn: new Date(ahora - 80 * 3600 * 1000).toISOString() }
    };
    guardarEscalados(data);

    const enviarFn = vi.fn().mockRejectedValue(new Error('Resend error'));
    const stats = await mod.procesarRecordatorios(enviarFn);

    const remaining = leerEscalados();
    expect(Object.keys(remaining)).toHaveLength(1);
    expect(stats.fallidos).toBe(1);
    expect(stats.enviados).toBe(0);
  });

  test('procesa-multiples-vencidos — A falla, B ok: solo A queda en JSON', async () => {
    const mod = await import('../escalados.js');
    const ahora = Date.now();
    const data = {
      'A-fallo': { remitente: 'a@a.com', asunto: 'A', resumen: 'ra', escaladoEn: new Date(ahora - 80 * 3600 * 1000).toISOString() },
      'B-ok':    { remitente: 'b@b.com', asunto: 'B', resumen: 'rb', escaladoEn: new Date(ahora - 90 * 3600 * 1000).toISOString() },
    };
    guardarEscalados(data);

    const enviarFn = vi.fn()
      .mockRejectedValueOnce(new Error('fail A'))
      .mockResolvedValueOnce(undefined);

    const stats = await mod.procesarRecordatorios(enviarFn);

    const remaining = leerEscalados();
    expect(Object.keys(remaining)).toHaveLength(1);
    expect(remaining['A-fallo']).toBeDefined();
    expect(remaining['B-ok']).toBeUndefined();
    expect(stats.enviados).toBe(1);
    expect(stats.fallidos).toBe(1);
  });

  test('devuelve stats vacíos si no hay entradas', async () => {
    const mod = await import('../escalados.js');
    guardarEscalados({});
    const enviarFn = vi.fn();
    const stats = await mod.procesarRecordatorios(enviarFn);
    expect(stats).toEqual({ enviados: 0, fallidos: 0, vivos: 0 });
    expect(enviarFn).not.toHaveBeenCalled();
  });
});

// --- T2: RED tests for msHastaMedianoche ---
describe('escalados — msHastaMedianoche', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  test('cron-calcula-ms-hasta-medianoche — devuelve valor entre 1 y 86_400_000', async () => {
    const mod = await import('../escalados.js');
    expect(mod.msHastaMedianoche).toBeDefined();
    const result = mod.msHastaMedianoche();
    expect(result).toBeGreaterThan(0);
    expect(result).toBeLessThanOrEqual(86_400_000);
  });

  test('con fake timer a las 23:59:59 UTC devuelve 1000 ms', async () => {
    const mod = await import('../escalados.js');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T23:59:59.000Z'));
    const result = mod.msHastaMedianoche();
    expect(result).toBe(1000);
    vi.useRealTimers();
  });

  test('con fake timer a las 00:00:01 UTC devuelve 86_399_000 ms', async () => {
    const mod = await import('../escalados.js');
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-25T00:00:01.000Z'));
    const result = mod.msHastaMedianoche();
    expect(result).toBe(86_399_000);
    vi.useRealTimers();
  });
});
