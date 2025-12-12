#!/bin/bash
set -e

echo "🚀 Iniciando despliegue en Railway..."

# Instalar dependencias
echo "📦 Instalando dependencias..."
npm install

# Opcionalmente ejecutar migraciones o scripts de setup
echo "✅ Dependencias instaladas"

# El servidor se iniciará automáticamente con npm start
