# Universalidad de Captura: ¿Cómo reconoce Ctrl+Alt+ImprPant?

Este documento explica por qué **EasySS** es capaz de recordar capturas hechas con cualquier comando de Windows, incluso los menos comunes como `Ctrl + Alt + Impr Pant`.

## 1. El Concepto de "Contenedor Único"

A diferencia de otras herramientas que intentan "escuchar" tus teclas (lo cual es invasivo y a menudo bloqueado por el navegador), EasySS se enfoca en el resultado final.

Windows tiene múltiples atajos para capturar pantalla:
- `Win + Shift + S` (Recorte)
- `Impr Pant` (Pantalla completa)
- `Alt + Impr Pant` (Ventana activa)
- `Ctrl + Alt + Impr Pant` (Captura de ventana específica en algunas configuraciones)

**Todos estos comandos tienen algo en común:** Al terminar la acción, Windows coloca una copia de la imagen binaria en el **Portapapeles del Sistema**.

## 2. Detección por Contenido, no por Teclas

EasySS funciona de la siguiente manera:
1. **No escucha el teclado**: No sabe si presionaste `Ctrl`, `Alt` o `Shift`.
2. **Monitorea el Portapapeles**: Cuando el selector de EasySS se abre, pregunta al navegador: *"¿Hay una imagen en el portapapeles ahora mismo?"*.
3. **Identificación Binaria**: Si hay una imagen, lee sus datos binarios. Como Windows deja la imagen en el portapapeles sin importar qué atajo usaste, la extensión siempre la encuentra.

## 3. ¿Cómo "recuerda" si es la misma?

Si haces `Ctrl + Alt + Impr Pant` varias veces de la misma ventana:
- La extensión genera un **Hash SHA-1** (una huella digital única) de la imagen.
- Si la imagen es idéntica a una que ya detectó antes, sabe que es la misma y no la duplica, simplemente la mueve al principio de la lista.
- Si la imagen cambió aunque sea por un píxel, la detecta como **"NUEVA"**.

## 4. Bypass de Capas y Menú Contextual (Facebook/Instagram)

A partir de la versión 1.0.1, EasySS incluye un sistema avanzado para sitios que protegen sus imágenes:

1. **Detección de Overlays**: Al hacer clic derecho, la extensión utiliza `elementsFromPoint` para atravesar capas transparentes y encontrar el `<img>` real o el `background-image` de CSS.
2. **Captura Preventiva**: En el momento del clic derecho, se inicia una descarga silenciosa en el *background script*. Esto asegura que la imagen se capture incluso si el comando "Copiar imagen" nativo del navegador falla o es bloqueado por el sitio web.
3. **Menú "Capturar imagen con EasySS"**: Un acceso directo en el menú contextual de Chrome que garantiza la obtención de la imagen en máxima resolución, saltándose cualquier restricción de la interfaz de usuario.

## 5. Conclusión
La "magia" de EasySS no está en interceptar tus comandos de Windows, sino en ser un observador experto del portapapeles y un navegador inteligente del DOM. Esto garantiza compatibilidad total con redes sociales y herramientas de captura externas.
