# Arquitectura Técnica

**EasySS** utiliza una arquitectura de múltiples capas para interceptar de forma segura y eficiente las interacciones del usuario con los formularios web.

## Componentes del Sistema

### 1. Main World Script (`main_world.js`)
Este script se inyecta directamente en el contexto de la página web ("Main World"). 
- **Función**: Sobrescribe los prototipos nativos de `HTMLInputElement.prototype.click` y `HTMLElement.prototype.click`.
- **Por qué**: Para detectar cuándo un sitio web intenta abrir el selector de archivos de forma programática (común en frameworks como React o Vue).
- **Comunicación**: Envía un `postMessage` al Content Script cuando intercepta un clic.

### 2. Content Script (`content.js`)
Actúa como el mediador entre la página web y la extensión.
- **Función**: 
    - Escucha clics reales en el DOM (fase de captura) en elementos `<input type="file">`.
    - Crea y gestiona el IFrame que contiene la interfaz del selector.
    - Recibe la imagen seleccionada y la inyecta de vuelta en el input original usando `DataTransfer`.

### 3. IFrame del Selector (`modal.html`, `modal.js`)
Una interfaz aislada para evitar conflictos de estilo con la página web.
- **Almacenamiento**: Utiliza **IndexedDB** para guardar un historial de imágenes y sus hashes (para evitar duplicados).
- **Clipboard API**: Utiliza `navigator.clipboard.read()` para extraer automáticamente la última imagen copiada.
- **Diseño**: Implementado con Vanilla CSS siguiendo principios de *Glassmorphism*.

## Flujo de Datos

1. **Intercepción**: El usuario hace clic en "Subir". Se previene el comportamiento por defecto (abrir explorador de Windows).
2. **Apertura**: Se inyecta un IFrame a pantalla completa.
3. **Escaneo**: El script del IFrame busca imágenes en el portapapeles y las añade a la base de datos local.
4. **Selección**: El usuario elige una imagen. La imagen se convierte a `Blob` y luego a `DataURL`.
5. **Inyección**: El Content Script recibe el `DataURL`, lo convierte nuevamente a un objeto `File` nativo y lo asigna a la propiedad `files` del input original.
6. **Notificación**: Se dispara manualmente un evento `change` para que el sitio web reconozca que se ha "subido" un archivo.

## Seguridad y Permisos
- `clipboardRead`: Necesario para acceder a las capturas de pantalla del portapapeles.
- `storage`: Para configuraciones persistentes (opcional en el futuro).
- `allow="clipboard-read"`: Atributo crítico en el IFrame para que Chrome permita el acceso al portapapeles desde un contexto embebido.

---
Esta arquitectura asegura que la extensión sea compatible con el 99% de los sitios web modernos sin comprometer la seguridad del navegador.
