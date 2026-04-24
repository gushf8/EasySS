# Permisos Técnicos y Compatibilidad

Para asegurar que **EasySS** funcione correctamente en plataformas con alta seguridad como **WhatsApp Web**, **Facebook**, **GitHub** o **Discord**, se han implementado configuraciones técnicas específicas que evitan bloqueos de seguridad (CSP) o problemas de permisos.

## 1. Permisos del Manifiesto (`manifest.json`)

- **`clipboardRead`**: Permite a la extensión acceder al contenido del portapapeles. Sin esto, no podríamos recuperar tus capturas de pantalla.
- **`host_permissions: ["<all_urls>"]`**: Permite que el script de la extensión se ejecute en cualquier sitio web donde necesites subir un archivo.
- **`world: "MAIN"`**: El script `main_world.js` se inyecta en el contexto principal de la página. Esto es vital para interceptar llamadas de frameworks como React (usado por FB/WhatsApp) que de otro modo estarían aisladas de la extensión.

## 2. Configuración del IFrame (Evitar Bloqueos)

En plataformas como WhatsApp, los IFrames suelen estar muy restringidos. EasySS utiliza las siguientes técnicas para integrarse:

- **Atributo `allow`**: 
  ```javascript
  modalIframe.setAttribute('allow', 'clipboard-read; clipboard-write');
  ```
  Esto delega el permiso de acceso al portapapeles desde la página principal hacia el IFrame de la extensión, permitiendo que `navigator.clipboard` funcione.
- **Inyección en `document.documentElement`**: Inyectamos el modal fuera del `body` si es necesario para evitar que estilos CSS del sitio web (como `overflow: hidden`) oculten nuestro selector.

## 3. Manejo de CSP (Content Security Policy)

Sitios como **GitHub** o **WhatsApp** bloquean el uso de `fetch()` hacia URLs de tipo `data:` o `blob:`. Para evitar esto, EasySS no utiliza `fetch()` para procesar la imagen final:

- **Conversión Manual**: Transformamos el `DataURL` de la imagen a un `Blob` usando `atob()` y `Uint8Array` manualmente en memoria. 
- **Resultado**: Esto evita disparar las alarmas de "connect-src" del CSP de los sitios web, haciendo que la subida sea invisible para sus políticas de seguridad de red.

## 4. Emulación de Eventos Nativos

Para que sitios como Facebook reconozcan que se ha seleccionado un archivo:
- Utilizamos la API **`DataTransfer`** para crear una lista de archivos real.
- Asignamos esta lista directamente a `input.files`.
- Disparamos un evento `change` con burbujeo (`bubbles: true`):
  ```javascript
  const event = new Event('change', { bubbles: true });
  input.dispatchEvent(event);
  ```
  Esto asegura que los "listeners" de React/Angular/Vue en la página detecten el cambio y procesen la imagen como si hubiera venido del explorador de Windows.

## 5. Aislamiento de Estilos
Usamos un IFrame para que el CSS de Facebook o WhatsApp no rompa el diseño del selector, y viceversa. Los estilos de la extensión están encapsulados y no afectan al sitio web original.

---
**Resumen para soporte técnico:** La extensión no realiza peticiones de red externas (`XHR/Fetch`) para procesar las imágenes, todo el procesamiento es local y utiliza APIs estándar del DOM para la compatibilidad máxima.
