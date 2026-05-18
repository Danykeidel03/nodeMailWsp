// tests/promptLoader.test.js
import { describe, it, expect, beforeEach } from 'vitest';
import {
  cargarPromptSistema,
  construirPrompt,
  listarSecciones,
  invalidarCache,
  extraerDatosFormulario
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

    it('debe indicar que mensajes personalizados en pedidos requieren confirmación humana', () => {
      const prompt = cargarPromptSistema();
      expect(prompt).toContain('NECESITA_PERSONA');
      expect(prompt.toLowerCase()).toContain('mensaje personalizado');
    });

    it('debe incluir regla de política concreta → NECESITA_PERSONA', () => {
      const prompt = cargarPromptSistema();
      expect(prompt).toContain('Si tenés duda sobre una política concreta de Frezzyks → NECESITA_PERSONA. No inventes la política.');
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

    it('historial con campos de formulario → prompt contiene bloque DATOS YA CONOCIDOS', () => {
      const historial = [
        {
          rol: 'cliente',
          texto: 'Nombre: Juan García\nTeléfono: 612345678\nCiudad: Madrid\nTipo de negocio: Tienda de regalos'
        }
      ];

      const prompt = construirPrompt({ historialConversacion: historial });
      expect(prompt).toContain('--- DATOS YA CONOCIDOS DEL FORMULARIO ---');
      expect(prompt).toContain('Juan García');
    });

    it('historial con email e intención → bloque DATOS los incluye', () => {
      const historial = [
        {
          rol: 'cliente',
          texto: 'Nombre: María José\nEmail: mariajose@gmail.com\nIntención: comprar vuestros productos\nTipo: Tienda'
        }
      ];

      const prompt = construirPrompt({ historialConversacion: historial });
      expect(prompt).toContain('mariajose@gmail.com');
      expect(prompt).toContain('comprar vuestros productos');
    });

    it('historial sin campos de formulario → prompt NO contiene el bloque DATOS', () => {
      const historial = [
        { rol: 'cliente', texto: 'Hola, ¿dónde está mi pedido #1234?' }
      ];

      const prompt = construirPrompt({ historialConversacion: historial });
      expect(prompt).not.toContain('--- DATOS YA CONOCIDOS DEL FORMULARIO ---');
    });

    it('historial vacío → prompt NO contiene el bloque DATOS', () => {
      const prompt = construirPrompt({ historialConversacion: [] });
      expect(prompt).not.toContain('--- DATOS YA CONOCIDOS DEL FORMULARIO ---');
    });
  });
});

describe('extraerDatosFormulario — campo tipoCliente', () => {
  it('(a) campo presente → tipoCliente === "Tienda"', () => {
    const campos = extraerDatosFormulario('Tipo De Cliente: Tienda\nNombre: Juan');
    expect(campos.tipoCliente).toBe('Tienda');
  });

  it('(b) texto sin campo → tipoCliente es null/undefined', () => {
    const campos = extraerDatosFormulario('Nombre: Juan\nCiudad: Madrid');
    expect(campos == null || campos.tipoCliente == null).toBe(true);
  });

  it('(c) tipo de negocio existente no interfiere con tipoCliente', () => {
    const campos = extraerDatosFormulario('Tipo de negocio: Retail\nTipo De Cliente: Mayorista');
    expect(campos.tipo).toBe('Retail');
    expect(campos.tipoCliente).toBe('Mayorista');
  });
});
