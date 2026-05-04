# Documentación de Correcciones: Portapapeles (Word/Windows) y Superposición de Capas (Top Layer)

Este documento detalla dos de los problemas más complejos que se han resuelto en la extensión relacionados con la interoperabilidad con Microsoft Windows y el manejo avanzado de capas (Z-Index) en navegadores modernos.

---

## 1. Corrección del Portapapeles para Imágenes de MS Word y Archivos de Windows

### El Problema
Los usuarios reportaron que al copiar un logotipo o una forma ("Word Art") directamente desde Microsoft Word, o al copiar un archivo físico de imagen desde el Explorador de Windows, la extensión **no detectaba la imagen**. 

**Causa Técnica:**
1. **Formatos Ricos:** Microsoft Word no siempre coloca un simple archivo `image/png` en el portapapeles. Frecuentemente inyecta contenido enriquecido (RTF o HTML). Cuando Chrome intentaba leer esto vía `navigator.clipboard.read()`, fallaba silenciosamente o devolvía un objeto vacío.
2. **Archivos vs Elementos:** Al copiar un archivo desde el Explorador de Windows, Chrome lo deposita en `e.clipboardData.files` y no siempre en `e.clipboardData.items` de la forma tradicional. El script original solo iteraba sobre los `items`, ignorando por completo los `files`.
3. **Pérdida en Textarea:** En el plan de respaldo (fallback) del `offscreen.js`, se utilizaba un elemento `<textarea>` y `document.execCommand('paste')`. Sin embargo, los `textarea` nativamente descartan cualquier contenido que no sea texto plano, destruyendo la imagen en el proceso.

### La Solución Implementada
Se realizaron profundas optimizaciones en `offscreen.js`, `modal.js` y `content.js`:

*   **Priorización de Archivos (`files`):** Se modificó la lógica para que los eventos `paste` inspeccionen primero el array `e.clipboardData.files`. Esto garantiza la detección inmediata de copias directas de Windows y extracciones exitosas de Chrome.
*   **Contenedor Rich-Text (Texto Enriquecido):** En `offscreen.js`, el fallback fue migrado de un `<textarea>` a un `<div>` con la propiedad `contentEditable="true"`. Esto obliga al motor de Chrome a procesar el formato rico de Microsoft Office e incrustar la imagen de manera legible.
*   **Extractor de Base64 (Último Recurso):** Se añadió un escáner que lee el código HTML bruto depositado por Word (`text/html`) y usa expresiones regulares (`RegEx`) para extraer atributos `src` con imágenes codificadas en Base64, descargándolas y transformándolas en formato `Blob`.

---

## 2. Solución de Superposición del Modal (Z-Index vs Top Layer)

### El Problema
En páginas web modernas (como *Google NotebookLM*), los botones para subir archivos se encuentran dentro de modales propios de la página. Al hacer clic para subir un archivo, la ventana de EasySS (que es un iframe) se abría, **pero quedaba por debajo del modal de la página**, inutilizando la extensión.

**Causa Técnica:**
Históricamente, para poner un elemento al frente se usaba `z-index: 2147483647` (el valor máximo en 32 bits). Sin embargo, los navegadores modernos han introducido el **"Top Layer"** (Capa Superior). Elementos nativos como `<dialog>` se renderizan en este *Top Layer*, el cual ignora por completo las reglas CSS tradicionales y **siempre** se dibuja por encima de cualquier otro elemento que no pertenezca a dicha capa. Como el iframe de EasySS no estaba en el *Top Layer*, perdía la prioridad de visualización.

### La Solución Implementada
Se aprovechó la **API Popover** moderna para forzar al iframe de la extensión hacia el *Top Layer*:

*   **Asignación de Atributo Popover:** En `content.js`, justo al crear el `modalIframe`, se inyecta dinámicamente el atributo `popover="manual"`.
*   **Ejecución Nativa:** Una vez insertado en el DOM, se llama al método nativo `modalIframe.showPopover()`.
*   **Jerarquía Definitiva:** Al hacer esto, el navegador saca el iframe de la jerarquía de apilamiento habitual y lo inserta en el *Top Layer*. Ya que EasySS es invocado *después* de que el modal de NotebookLM se abriera, EasySS es el último elemento añadido al *Top Layer* y, por consiguiente, se dibuja como **superposición absoluta** por encima de toda la interfaz nativa.

Esta lógica no requiere modificar los estilos base y asegura una compatibilidad futura e infalible con todas las aplicaciones web tipo SPA (Single Page Application).
