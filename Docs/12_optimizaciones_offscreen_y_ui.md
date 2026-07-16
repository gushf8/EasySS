# Optimizaciones de Detección Universal y UI (v1.0.2)

Este documento detalla las soluciones avanzadas implementadas para garantizar que EasySS funcione en cualquier sitio web, incluyendo aquellos con restricciones de seguridad extremas.

## 1. Patrón de Documento Offscreen (Bypass de Instagram/FB)

### El Problema
Sitios como **Instagram**, **Facebook** y **WhatsApp Web** implementan políticas de seguridad (CSP) y permisos de navegador que bloquean el acceso al portapapeles desde scripts inyectados en su página. Esto causaba que:
- El navegador pidiera permisos para el sitio (ej. "www.google.com quiere leer...").
- En sitios restrictivos, la lectura fallara silenciosamente.
- Las capturas solo se actualizaran al cambiar a una pestaña de Google.

### La Solución
Se implementó un **Offscreen Document** (`offscreen.html`). Este es un documento invisible que se ejecuta en el origen de la extensión (`chrome-extension://...`) en lugar de en el sitio web.

**Ventajas:**
- **Independencia de Origen**: Lee el portapapeles usando el permiso global de la extensión, ignorando las restricciones del sitio anfitrión.
- **Sin Avisos de Permisos**: Al no leer desde el contexto de la web (como Google), el navegador no muestra el aviso de seguridad al usuario.
- **Bypass de CSP**: Supera cualquier política de seguridad que el sitio web tenga activada.

---

## 2. Rediseño de UI: Filas Horizontales

Se ha migrado de un diseño de cuadrícula (grid) a un sistema de **Scroll Horizontal** para optimizar el espacio y la usabilidad.

- **Límite de Visibilidad**: Cada sección muestra un máximo de **8 imágenes**.
- **Desplazamiento Suave**: Las secciones "Capturas" y "Descargas" ahora se navegan de izquierda a derecha.
- **Etiquetado de Origen**:
  - **SS**: Capturas detectadas en el portapapeles del sistema (Win + Shift + S).
  - **Copiado**: Imágenes capturadas mediante el menú contextual o click derecho.

---

## 3. Pegado Inteligente en Modo Manual

En el modo **Ctrl + Shift**, la extensión ahora implementa una lógica de "Memoria de Foco":

1. **Captura de Foco**: Antes de abrir el panel, `content.js` guarda una referencia al elemento que tenía el cursor (`lastActiveElement`).
2. **Restauración de Enfoque**: Al seleccionar una imagen, la extensión devuelve el foco inmediatamente al campo de texto original.
3. **Inyección de Evento**: Se dispara un evento `paste` sintético que contiene el archivo. Esto permite que aplicaciones de chat (ChatGPT, WhatsApp, Discord) reciban la imagen como si el usuario hubiera presionado `Ctrl+V`.

---

## 4. Corrección del Bucle del Explorador de Archivos

Se identificó un error donde al hacer clic en "Abrir Explorador de Windows", el panel se cerraba y se volvía a abrir antes de mostrar el diálogo de archivos.

- **Causa**: El clic de respaldo disparado por la extensión era interceptado por sus propios sensores como si fuera un nuevo clic de usuario.
- **Fix**: Se sincronizaron las banderas de `ignoreNextDomClick` y `lastFallbackTime` para que funcionen tanto en clics manuales como programáticos, garantizando que el explorador se abra al primer intento sin interferencias.
