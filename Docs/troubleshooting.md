# Solución de Problemas (Troubleshooting)

Si encuentras problemas al usar EasySS, consulta esta guía para encontrar soluciones rápidas.

## 1. El selector no aparece al hacer clic en "Subir"
- **Causa**: Algunos sitios web utilizan métodos de subida muy personalizados o IFrames anidados.
- **Solución**: 
    - Asegúrate de que la extensión esté activada en `chrome://extensions`.
    - Recarga la página (F5). Algunos scripts de interceptación necesitan cargarse antes que la página.
    - Revisa si el botón es realmente un `<input type="file">`.

## 2. No veo mi última captura de pantalla
- **Causa**: El navegador requiere que la página tenga "foco" y que el usuario haya interactuado antes de permitir leer el portapapeles.
- **Solución**: 
    - Haz clic en cualquier parte de la ventana del selector una vez que se abra.
    - Asegúrate de haber tomado la captura con `Win + Shift + S` (esto la copia al portapapeles automáticamente).
    - Puedes intentar pegar directamente con `Ctrl + V` dentro del selector.

## 3. El sitio web dice que el archivo no es válido
- **Causa**: Algunos sitios son muy estrictos con los tipos de archivo (MIME types).
- **Solución**: EasySS sube las imágenes como `image/png` por defecto. Si el sitio solo acepta JPG, es posible que falle. Estamos trabajando en la detección automática de tipos en futuras versiones.

## 4. Error de "Permiso denegado" para el portapapeles
- **Causa**: Chrome bloquea el acceso al portapapeles si la página no es segura (HTTPS) o si el IFrame no tiene los permisos correctos.
- **Solución**: 
    - Verifica que el sitio web use `https://`.
    - EasySS ya incluye los atributos necesarios, pero si persiste, intenta reiniciar el navegador.

## 5. El selector se queda en "Cargando..."
- **Causa**: Problema de inicialización con la base de datos IndexedDB.
- **Solución**: 
    - Abre la consola de desarrollador (F12) para ver si hay errores de base de datos.
    - Intenta cerrar y volver a abrir el navegador.

---
Si el problema persiste, puedes usar el botón **"Explorador de archivos"** en la parte inferior para volver al comportamiento estándar de Windows.
