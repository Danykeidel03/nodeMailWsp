// tests/promptLoader.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import { 
  cargarPromptSistema, 
  construirPrompt, 
  listarSecciones,
  invalidarCache 
} from '../src/services/promptLoader.js';

describe('promptLoader', () => {
  
  beforeEach(() => {
    invalidarCache();
  });

  describe('listarSecciones', () => {
    it('debe listar todas las secciones en orden', () => {
      const secciones = listarSecciones();
      
      expect(secciones.length).toBeGreaterThanOrEqual(12);
      expect(secciones[0].archivo).toBe('01-personalidad.md');
      expect(secciones[secciones.length - 1].archivo).toBe('12-escalado.md');
    });

    it('cada sección debe tener título y tamaño', () => {
      const secciones = listarSecciones();
      
      for (const seccion of secciones) {
        expect(seccion).toHaveProperty('archivo');
        expect(seccion).toHaveProperty('titulo');
        expect(seccion).toHaveProperty('tamaño');
        expect(seccion.tamaño).toBeGreaterThan(0);
      }
    });
  });

  describe('cargarPromptSistema', () => {
    it('debe cargar el prompt completo', () => {
      const prompt = cargarPromptSistema();
      
      expect(prompt).toBeDefined();
      expect(prompt.length).toBeGreaterThan(1000);
    });

    it('debe incluir contenido de todas las secciones', () => {
      const prompt = cargarPromptSistema();
      
      // Verificar que incluye contenido clave de cada sección
      expect(prompt).toContain('Frezzyks'); // personalidad
      expect(prompt).toContain('NUNCA repitas'); // antirepeticion
      expect(prompt).toContain('3–5 días hábiles'); // envios
      expect(prompt).toContain('packs personalizados no pueden devolverse'); // devoluciones
      expect(prompt).toContain('Bizum'); // pagos
      expect(prompt).toContain('NO CADUCA'); // newsletter
      expect(prompt).toContain('SOPORTE'); // escalado
      expect(prompt).toContain('SAMU'); // escalado
    });

    it('debe usar cache en llamadas consecutivas', () => {
      const prompt1 = cargarPromptSistema();
      const prompt2 = cargarPromptSistema();
      
      // Ambas llamadas deben devolver exactamente lo mismo (mismo objeto en cache)
      expect(prompt1).toBe(prompt2);
    });
  });

  describe('construirPrompt', () => {
    it('debe funcionar sin opciones', () => {
      const prompt = construirPrompt();
      
      expect(prompt).toBeDefined();
      expect(prompt.length).toBeGreaterThan(1000);
    });

    it('debe incluir historial de conversación cuando se proporciona', () => {
      const historial = [
        { rol: 'cliente', texto: 'Hola, ¿dónde está mi pedido?' },
        { rol: 'bot', texto: '¡Hola! Para ayudarte necesito tu número de pedido.' }
      ];
      
      const prompt = construirPrompt({ historialConversacion: historial });
      
      expect(prompt).toContain('HISTORIAL DE LA CONVERSACIÓN');
      expect(prompt).toContain('Hola, ¿dónde está mi pedido?');
      expect(prompt).toContain('Cliente:');
      expect(prompt).toContain('TÚ (Bot):');
    });

    it('debe incluir info de adjuntos cuando se proporciona', () => {
      const infoAdjuntos = {
        tieneAdjuntos: true,
        resumen: '📎 ADJUNTOS: 2 imágenes adjuntas'
      };
      
      const prompt = construirPrompt({ infoAdjuntos });
      
      expect(prompt).toContain('📎 ADJUNTOS: 2 imágenes adjuntas');
    });

    it('debe incluir info de pedido cuando se proporciona', () => {
      const infoPedido = 'INFORMACIÓN DEL PEDIDO #1234: En tránsito';
      
      const prompt = construirPrompt({ infoPedido });
      
      expect(prompt).toContain('INFO PEDIDO PARA EL CLIENTE');
      expect(prompt).toContain('#1234');
    });

    it('debe incluir info de seguimiento cuando se proporciona', () => {
      const infoSeguimiento = 'Estado: Entregado - 15/01/2025';
      
      const prompt = construirPrompt({ infoSeguimiento });
      
      expect(prompt).toContain('Estado: Entregado');
    });

    it('no debe incluir secciones dinámicas vacías', () => {
      const prompt = construirPrompt({
        historialConversacion: [],
        infoAdjuntos: null,
        infoPedido: '',
        infoSeguimiento: ''
      });
      
      expect(prompt).not.toContain('HISTORIAL DE LA CONVERSACIÓN');
      expect(prompt).not.toContain('INFO PEDIDO PARA EL CLIENTE');
    });
  });
});
