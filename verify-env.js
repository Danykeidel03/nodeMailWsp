// verify-env.js
// Script para verificar que todas las variables de entorno requeridas estén presentes

const requiredVars = [
  'OPENAI_API_KEY',
  'SHOPIFY_API_KEY',
  'SHOPIFY_API_SECRET',
  'SHOPIFY_SHOP',
  'SHOPIFY_ACCESS_TOKEN',
  'EMAIL_USER',
  'EMAIL_PASS',
  'CORREOS_CLIENTE',
  'CORREOS_AUTH',
  'WHATSAPP_PHONE_ID',
  'WHATSAPP_TOKEN',
  'NGROK_URL'
];

const missingVars = [];
const presentVars = [];

console.log('🔍 Verificando variables de entorno...\n');

requiredVars.forEach(varName => {
  if (process.env[varName]) {
    // Mostrar solo primeros y últimos caracteres por seguridad
    const value = process.env[varName];
    const masked = value.length > 20 
      ? `${value.substring(0, 10)}...${value.substring(value.length - 5)}`
      : '***hidden***';
    console.log(`✅ ${varName}: ${masked}`);
    presentVars.push(varName);
  } else {
    console.log(`❌ ${varName}: FALTA`);
    missingVars.push(varName);
  }
});

console.log(`\n📊 Resumen: ${presentVars.length}/${requiredVars.length} variables presentes`);

if (missingVars.length > 0) {
  console.error('\n❌ VARIABLES FALTANTES:');
  missingVars.forEach(v => console.error(`   - ${v}`));
  console.error('\n⚠️  Por favor, configura estas variables en Railway antes de continuar.\n');
  process.exit(1);
} else {
  console.log('\n✅ Todas las variables de entorno están configuradas correctamente!\n');
  process.exit(0);
}
