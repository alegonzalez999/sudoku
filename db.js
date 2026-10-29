// Conexión con Firebase (Realtime Database + inicio de sesión anónimo).
// Expone una interfaz chica que usa app.js: doc(path) y collection(path), con get/set/update/delete/onSnapshot.
const SDK = 'https://www.gstatic.com/firebasejs/12.19.0';

export async function connect(config, { timeoutMs = 12000 } = {}) {
  if (!config || !config.apiKey || !config.databaseURL) return null;
  const work = (async () => {
    const [{ initializeApp }, A, D] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
      import(`${SDK}/firebase-database.js`),
    ]);
    const fb = initializeApp(config);
    const auth = A.getAuth(fb);
    const cred = await A.signInAnonymously(auth); // cada navegador recibe una identidad invisible, sin cuenta
    const db = D.getDatabase(fb);
    return wrap(D, db, cred.user.uid);
  })();
  const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeoutMs));
  return Promise.race([work, timeout]);
}

function wrap(D, db, uid) {
  let offset = 0; // diferencia entre el reloj de este dispositivo y el del servidor
  D.onValue(D.ref(db, '.info/serverTimeOffset'), s => { offset = Number(s.val()) || 0; });

  const err = e => {
    const txt = String((e && (e.code || e.message)) || e);
    return { code: /permission|denied/i.test(txt) ? 'denied' : 'unavailable', message: txt };
  };
  const snap = s => ({ id: s.key, exists: s.exists(), data: () => s.val(), metadata: { fromCache: false } });

  function doc(path) {
    const r = D.ref(db, path);
    return {
      get: () => D.get(r).then(snap, e => { throw err(e); }),
      set: v => D.set(r, v).catch(e => { throw err(e); }),
      update: v => D.update(r, v).catch(e => { throw err(e); }),
      delete: () => D.remove(r).catch(e => { throw err(e); }),
      onSnapshot: (next, onErr) => D.onValue(r, s => next(snap(s)), e => onErr && onErr(err(e))),
    };
  }
  function collection(path) {
    const r = D.ref(db, path);
    return {
      onSnapshot: (next, onErr) => D.onValue(r, s => {
        const docs = [];
        s.forEach(c => { docs.push(snap(c)); });
        next({ docs, size: docs.length, empty: docs.length === 0, metadata: { fromCache: false } });
      }, e => onErr && onErr(err(e))),
    };
  }
  return { uid, doc, collection, now: () => Date.now() + offset };
}
