# Plan de Monetización y Seguridad Avanzada (Propuesta)

Este documento detalla la arquitectura propuesta para automatizar las ventas de EasySS mediante Yape/Plin y las medidas para proteger el software contra copias no autorizadas.

## 1. Sistema de Activación "Intervención Cero"

Para escalar el negocio sin revisar manualmente cada pago, se propone el siguiente flujo:

### Requisitos
- **Google Sheets**: Como panel de control de licencias.
- **Google Apps Script**: Como servidor de validación (API).
- **Gmail**: Notificaciones de Yape/Plin habilitadas.

### Flujo de Validación por N° de Operación
1. **Pago**: El cliente realiza el pago por Yape o Plin.
2. **Entrada**: El usuario introduce su **Correo** y el **N° de Operación** (visible en su comprobante) en la extensión.
3. **Consulta**: La extensión llama al script de Google.
4. **Escaneo de Gmail**: El script busca en los correos de `notificaciones@yape.com.pe` o similares el número de operación proporcionado.
5. **Activación**: 
   - Si existe y no ha sido usado: Se registra el correo y se activa por 30 días.
   - Si no existe: Se muestra error de "Pago no encontrado".
   - Si ya fue usado: Se muestra error de "Licencia ya vinculada".

## 2. Medidas Anti-Piratería (Hardening)

Dada la naturaleza de las extensiones (JavaScript), se proponen las siguientes capas de seguridad:

### Capa 1: Ofuscación de Código
Antes de distribuir el archivo `.zip` o `.crx`, el código debe pasar por un ofuscador (ej. `javascript-obfuscator`). Esto hace que el código sea ilegible para humanos, dificultando que alguien encuentre y elimine la línea que valida la contraseña.

### Capa 2: Validación Remota Recurrente
La extensión no debe activarse "para siempre" de forma local. Cada vez que se inicia, debe realizar un "heartbeat" (pulso) al servidor de Google para confirmar que la licencia sigue vigente. Si el servidor no responde con un token firmado, la extensión se bloquea.

### Capa 3: Bloqueo de Huella Digital (Device ID)
Al activar la cuenta, se genera un ID único basado en el navegador. El servidor de Google vincula el N° de Operación a ese ID. Si se detecta que el mismo pago se intenta usar en un segundo dispositivo, el acceso se revoca automáticamente.

## 3. Estado Actual (v1.0.1)

Por el momento, y a petición del usuario, se mantiene un sistema de **Seguridad Simple**:
- **Método**: Contraseña estática local.
- **Clave**: `meloso824`.
- **Persistencia**: Almacenado en `chrome.storage.local`.

---
*Este plan está listo para ser implementado cuando el volumen de ventas justifique la automatización.*
