# Registro de Reparaciones Realizadas en EasySS Extension

### [Actualización 1.0.1] - 2026-04-28: Universalidad y Persistencia
- **FIX Facebook/Instagram**: Corregido el problema donde las imágenes "Copiadas" normalmente no cargaban. Ahora se detectan mediante un sistema pre-emptivo al hacer clic derecho.
- **FIX WhatsApp**: Corregido el error donde el "Doble Shift" no abría el selector. Ahora se usa la fase de captura de eventos para saltar el bloqueo de WhatsApp.
- **FEATURE Menú Contextual**: Añadida la opción "Capturar imagen con EasySS" para forzar la captura de cualquier imagen protegida.
- **FEATURE Persistencia Eterna**: Implementado sistema de Exportar/Importar historial (.easyss) para sobrevivir a desinstalaciones.
- **FEATURE Descarga Directa**: Añadido botón de descarga a cada captura para guardar archivos físicamente.
- **MEJORA UX**: Badge de "Nueva" mejorado y soporte para imágenes bajo capas transparentes (overlays).

### [Actualización 1.0.0] - Reparaciones Base
- **FIX Contexto Perdido**: Implementada verificación de `chrome.runtime` en todos los scripts para evitar el error "Extension context invalidated".

## 1. Problema de Carga de Archivos (Inyección)
**Síntoma:** Los archivos seleccionados (desde la galería o desde Windows) no se cargaban en la página.
**Causa:** Una limpieza accidental de las variables de estado (`currentDomInput` y `currentProgrammaticInputId`) al abrir el modal borraba la referencia al campo de texto de destino.
**Solución:** Se reestructuró la función `openModal` para que reciba y mantenga el contexto del elemento de destino sin borrarlo.

## 2. Bucle de Intercepción (Re-intercepción)
**Síntoma:** Al elegir "Abrir Windows", la extensión volvía a interceptar su propio intento de apertura, abriendo el modal de nuevo en lugar del explorador de archivos.
**Causa:** El clic programático de "fallback" era detectado por los interceptores de la extensión.
**Solución:** Se implementó un "Periodo de Enfriamiento" (Cooldown) de 2 segundos. Durante este tiempo, la extensión ignora cualquier evento de clic en campos de archivos, permitiendo que el navegador y el sitio web procesen la subida sin interferencias.

## 3. Compatibilidad con Sitios Modernos (Triple Evento)
**Síntoma:** Algunos sitios ignoraban el archivo inyectado por la extensión.
**Causa:** Sitios como Gemini o WhatsApp esperan una secuencia completa de eventos de usuario para validar la subida.
**Solución:** Ahora la extensión dispara una secuencia triple de eventos: `input`, `change` y `blur`. Esto garantiza que los scripts de la página detecten el cambio de archivos de forma natural.

## 4. Error de "Contexto Invalidado"
**Síntoma:** Mensajes de error técnico en la consola al actualizar la extensión.
**Causa:** Scripts antiguos ("zombis") intentando comunicarse con una extensión que ya no existe en esa versión.
**Solución:** Se añadió una detección de contexto muerto (`isContextInvalid`). La extensión ahora se desactiva silenciosamente si detecta que la página necesita ser recargada, evitando errores visuales al usuario.

## 5. Solución al "Doble Clic" en Abrir Windows
**Síntoma:** El usuario debía pulsar dos veces el botón para que Windows abriera el explorador.
**Causa:** La pérdida de "fuerza de gesto de usuario" al pasar mensajes entre el IFrame y la página principal.
**Solución:**
- Se implementó una detección de destino. Si no hay un campo previo (modo manual), el modal abre el explorador **localmente y de forma directa**, preservando el gesto del usuario al 100%.
- Se eliminaron los retardos (`setTimeout`) al disparar el clic de respaldo, haciendo que la respuesta sea instantánea.

## 6. Pegado Inteligente (Auto-Paste)
**Mejora:** En el modo manual (Double Shift), si no hay un campo de texto interceptado, la extensión intenta "pegar" el archivo seleccionado directamente en el elemento que tenga el foco en la página, mejorando la usabilidad en aplicaciones de chat.
