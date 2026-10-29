# Sudoku papel y lápiz

Sudoku para competir por tiempo: alguien crea una sala, pasa el link o el código, y todos reciben el mismo tablero al mismo tiempo. Estilo papel y lápiz: no marca errores, no borra notas solo y no resalta filas ni columnas. Cinco dificultades, de Muy fácil a Experto.

Nadie necesita cuenta: cada jugador pone su nombre y entra con el código. La página está marcada para que los buscadores no la indexen.

## Archivos

| Archivo | Qué hace |
| --- | --- |
| `index.html` | La página (estructura y estilos) |
| `app.js` | Salas, tablero, cronómetro y tabla de posiciones |
| `core.js` | Generador de sudokus y calificador de dificultad |
| `db.js` | Conexión con Firebase (base de datos en tiempo real y acceso anónimo) |
| `firebase-config.js` | Datos del proyecto de Firebase |
| `database.rules.json` | Reglas de seguridad para pegar en Firebase |

## Puesta en marcha

1. **GitHub Pages:** Settings → Pages → Source: *Deploy from a branch* → `main` / `(root)`.
2. **Firebase** (gratis, plan Spark):
   - Crear un proyecto en [console.firebase.google.com](https://console.firebase.google.com).
   - Authentication → Método de acceso → activar **Anónimo**.
   - Authentication → Configuración → Dominios autorizados → agregar `alegonzalez999.github.io`.
   - Realtime Database → Crear base de datos → pestaña **Reglas** → pegar `database.rules.json` → Publicar.
   - Configuración del proyecto → Tus apps → Web (`</>`) → copiar el objeto `firebaseConfig` en `firebase-config.js`.

Sin configuración de Firebase la página igual funciona: se juega con códigos del tipo `ABCDE-3`, que generan el mismo sudoku en todos los dispositivos, y cada uno comparte su tiempo.

## Seguridad

- Las salas solo se pueden leer conociendo el código exacto; no se puede listar ni buscar salas.
- Cada jugador solo puede escribir su propio registro. Solo el anfitrión arranca rondas (si se va de la sala, cualquiera puede tomar el control).
- Los datos de `firebase-config.js` no son secretos; la protección la dan las reglas.
