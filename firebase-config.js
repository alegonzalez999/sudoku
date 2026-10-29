// Configuración de Firebase (Consola de Firebase → Configuración del proyecto → Tus apps → Web).
// Estos datos no son secretos: identifican el proyecto. Lo que protege la información son las reglas
// de database.rules.json, cargadas en Realtime Database → Reglas.
// Si esto quedara en null, la página funciona sin tabla compartida (partidas por código).
export const firebaseConfig = {
  apiKey: 'AIzaSyD6dFw4MFMQSKUj9biJgJfCs_V0b6FQ7iI',
  authDomain: 'sudoku-papel.firebaseapp.com',
  databaseURL: 'https://sudoku-papel-default-rtdb.firebaseio.com',
  projectId: 'sudoku-papel',
  storageBucket: 'sudoku-papel.firebasestorage.app',
  messagingSenderId: '216980099567',
  appId: '1:216980099567:web:a6a1a554f6cba67650a61a',
};
