// FIREBASE CONFIGURATION - REEMPLAZAR CON TUS PROPIAS KEYS
const firebaseConfig = {
    apiKey: "AIzaSyBwGkbORpxrUBveWXsVvY_dQ4fTWh_Vmj0",
    authDomain: "playwright-701bb.firebaseapp.com",
    projectId: "playwright-701bb",
    storageBucket: "playwright-701bb.firebasestorage.app",
    messagingSenderId: "820164969966",
    appId: "1:820164969966:web:fae3ff0274f9648e9cfaff",
    measurementId: "G-CDMENSPKVK"
};

// Initialize Firebase
try {
    firebase.initializeApp(firebaseConfig);
} catch (e) {
    console.error("Firebase Auth Error: Keys not configured.");
}

const db = firebase.firestore();
const auth = firebase.auth();

const app = {
    state: {
        myGames: [],
        currentGame: null,
        isPlaying: false,
        user: null, // Current Firebase User
        isRegistering: false,
        settings: {
            autoSaveMinutes: 2,
            pendingAvatar: null // Temporary during upload
        },
        saveInterval: null,
        playtimeStart: null,
        isRegistering: false,
        saveInterval: null,
        playtimeStart: null,
        friends: [],
        friendListeners: {}, // Map uid -> unsub
        mainFriendUnsub: null, // Single listener for the list
        isAutoSaving: false,
        currentSlot: 1, // Default slot
        currentSaveData: null // Cache for save slots
    },

    showToast: (msg, duration = 3000) => {
        let container = document.getElementById('toast-container');
        if (!container) {
            container = document.createElement('div');
            container.id = 'toast-container';
            document.body.appendChild(container);
        }

        const toast = document.createElement('div');
        toast.className = 'toast-msg';
        toast.innerHTML = msg;

        container.appendChild(toast);

        // Animate In
        setTimeout(() => {
            toast.classList.add('toast-visible');
        }, 50);

        // Animate Out
        setTimeout(() => {
            toast.classList.remove('toast-visible');
            setTimeout(() => toast.remove(), 300);
        }, duration);
    },

    toggleAutoSaveIndicator: (show) => {
        const el = document.getElementById('auto-save-indicator');
        if (!el) return;
        if (show) el.classList.add('active');
        else el.classList.remove('active');
    },

    // GAMES_DB REMOVED - Loaded from games.json


    init: () => {
        app.checkAuth();
        app.bindNav();
        app.setupGlobalKeys();
        app.loadCatalog(); // Uses inline constant now
        app.initGlobalUsers();

        // Set offline on close
        window.addEventListener('beforeunload', () => {
            app.updateUserStatus('offline');
        });
    },

    // AUTH SYSTEM
    checkAuth: () => {
        // Force Guest Mode if offline/local file
        if (window.location.protocol === 'file:') {
            console.warn("Running in FILE mode. Firebase Auth disabled. Using Guest Mode.");
            app.enableGuestMode();
            return;
        }

        // Initialize default UI even if checking
        // app.renderSaveSlotsUI(1); 

        auth.onAuthStateChanged(user => {
            if (user) {
                // Fetch full profile from Firestore
                db.collection('users').doc(user.uid).get().then(doc => {
                    if (doc.exists) {
                        const data = doc.data();
                        // FIX: Ensure uid is preserved (spread on Firebase User often misses non-enumerable props)
                        app.state.user = { uid: user.uid, email: user.email, ...data };

                        // Restore Avatar
                        if (data.avatar) {
                            app.updateHeaderAvatar(data.avatar);
                        }

                        // Restore Settings if present
                        if (data.settings) {
                            app.state.settings = { ...app.state.settings, ...data.settings };
                        }

                        app.listenToGlobalUsers(); // Start Social
                    } else {
                        // First time or missing doc
                        app.state.user = user;
                    }

                    document.getElementById('auth-overlay').classList.remove('active');
                    app.loadLibraryFromCloud();
                }).catch(e => {
                    console.error("Profile Fetch Error:", e);
                    app.state.user = user;
                    document.getElementById('auth-overlay').classList.remove('active');
                    app.loadLibraryFromCloud();
                });

            } else {
                app.state.user = null;
                document.getElementById('auth-overlay').classList.add('active');
                app.loadLibraryFromCloud(); // Load local games even if logged out
            }
        });
    },

    enableGuestMode: () => {
        app.state.user = { uid: 'guest_123', email: 'guest@local.bit', displayName: 'Invitado' };
        document.getElementById('auth-overlay').classList.remove('active');
        app.loadLibraryFromCloud(); // Will load local storage
        app.showToast("Modo Invitado (Solo Local)", 5000);

        // Update User Icon
        const userIcon = document.querySelector('.fa-user-circle');
        if (userIcon) userIcon.style.color = '#ffc107'; // Yellow for guest
    },

    toggleAuthMode: () => {
        app.state.isRegistering = !app.state.isRegistering;
        const title = document.getElementById('auth-title');
        const btn = document.getElementById('btn-auth-action');
        const toggle = document.getElementById('auth-toggle-msg');

        if (app.state.isRegistering) {
            title.innerText = "Crear Cuenta";
            btn.innerText = "Registrarse";
            toggle.innerText = "¿Ya tienes cuenta? Inicia Sesión";
        } else {
            title.innerText = "Iniciar Sesión";
            btn.innerText = "Entrar";
            toggle.innerText = "¿No tienes cuenta? Regístrate";
        }
    },

    login: () => {
        const user = document.getElementById('auth-username').value;
        const pass = document.getElementById('auth-password').value;
        const errorMsg = document.getElementById('auth-error');

        if (!user || !pass) {
            errorMsg.style.display = 'block';
            errorMsg.innerText = 'Rellena todos los campos';
            return;
        }

        // Fake Email construction
        const email = `${user}@email.org`;

        const action = app.state.isRegistering
            ? auth.createUserWithEmailAndPassword(email, pass)
            : auth.signInWithEmailAndPassword(email, pass);

        action
            .then((userCredential) => {
                // Signed in 
                console.log("Welcome " + user);
                // Create/Update User Profile in Firestore
                const userData = {
                    username: user,
                    email: email,
                    status: 'online',
                    lastSeen: firebase.firestore.FieldValue.serverTimestamp(),
                    avatar: `https://ui-avatars.com/api/?name=${user}&background=random`
                };

                db.collection('users').doc(userCredential.user.uid).get().then(doc => {
                    const existing = doc.data();
                    let userData = existing || {};
                    // Merge basic info
                    userData = {
                        ...userData,
                        username: user,
                        email: email,
                        status: 'online',
                        lastSeen: firebase.firestore.FieldValue.serverTimestamp()
                    };
                    if (!userData.avatar) {
                        userData.avatar = `https://ui-avatars.com/api/?name=${user}&background=random`;
                    }

                    // Save settings if present
                    if (existing && existing.settings) {
                        app.state.settings = existing.settings;
                    } else {
                        // Load from local or default
                        app.loadLocalSettings();
                    }

                    db.collection('users').doc(userCredential.user.uid).set(userData, { merge: true })
                        .then(() => {
                            app.listenToGlobalUsers();
                            app.updateHeaderAvatar(userData.avatar);
                        });
                });

            })
            .catch((error) => {
                errorMsg.style.display = 'block';
                errorMsg.innerText = error.message;
            });
    },

    logout: () => {
        document.getElementById('user-dropdown').classList.remove('active');
        if (app.state.user) {
            app.updateUserStatus('offline', null);
            auth.signOut();
        }
    },

    toggleUserMenu: () => {
        const menu = document.getElementById('user-dropdown');
        menu.classList.toggle('active');
    },

    updateUserStatus: (status, gameName = null) => {
        if (!app.state.user) return;

        let finalStatus = status;
        // PRIVATE MODE: If enabled, always appear offline
        if (app.state.settings && app.state.settings.privateMode) {
            finalStatus = 'offline';
        }

        const data = {
            status: finalStatus,
            game: finalStatus === 'playing' ? gameName : null,
            lastSeen: firebase.firestore.FieldValue.serverTimestamp()
        };
        // Record start time if playing
        if (finalStatus === 'playing') {
            data.startedPlayingAt = Date.now();
        }
        db.collection('users').doc(app.state.user.uid).set(data, { merge: true });
    },

    // CLOUD PERSISTENCE
    // CLOUD PERSISTENCE with Local Storage Fallback
    loadLibraryFromCloud: () => {
        // 1. Load LocalStorage First (Instant)
        const localLib = localStorage.getItem('myGames');
        if (localLib) {
            try {
                app.state.myGames = JSON.parse(localLib);
                app.renderLibrarySidebar();
                if (document.getElementById('library-view').classList.contains('active')) {
                    app.renderLibraryGrid();
                }
            } catch (e) { console.error("Local Library Parse Error", e); }
        }

        if (!app.state.user) return;
        const uid = app.state.user.uid;

        // 2. Sync with Cloud
        db.collection('users').doc(uid).collection('library').get().then((querySnapshot) => {
            const cloudGames = [];
            querySnapshot.forEach((doc) => {
                cloudGames.push(doc.data());
            });

            // Merge Local and Cloud Games (Prioritize Cloud, but keep unsynced local games)
            // Strategy: Create Map from Cloud. Then iterate Local. If Local has a game not in Cloud, keep it (assume unsynced).
            // Actually, safest is: Union by ID. If collision, use Cloud (it has the "truth" likely, or we can use the one with higher playtime).

            const gameMap = new Map();

            // 1. Add Cloud Games (Source of Truth)
            cloudGames.forEach(g => gameMap.set(g.id, g));

            // 2. updates from local that might be newer or missing in cloud
            // Note: If cloud deleted it, this re-adds it. But we don't have delete functionality yet.
            if (app.state.myGames && Array.isArray(app.state.myGames)) {
                app.state.myGames.forEach(localG => {
                    if (!gameMap.has(localG.id)) {
                        gameMap.set(localG.id, localG);
                    } else {
                        // Conflict: Check playtime. Keep max.
                        const cloudG = gameMap.get(localG.id);
                        if ((localG.playtime || 0) > (cloudG.playtime || 0)) {
                            gameMap.set(localG.id, { ...cloudG, ...localG }); // Keep local playtime
                        }
                    }
                });
            }

            const mergedGames = Array.from(gameMap.values());
            app.state.myGames = mergedGames;
            localStorage.setItem('myGames', JSON.stringify(mergedGames));

            app.renderLibrarySidebar();
            if (document.getElementById('library-view').classList.contains('active')) {
                app.renderLibraryGrid();
            }
        }).catch(e => console.warn("Cloud Library Sync Failed (Offline?)", e));
    },

    addGameToCloud: (game) => {
        // Update Local State & Storage immediately
        // Note: myGames push happened in downloadGame usually
        localStorage.setItem('myGames', JSON.stringify(app.state.myGames));

        if (!app.state.user) return;
        const uid = app.state.user.uid;
        db.collection('users').doc(uid).collection('library').doc(game.id).set(game)
            .catch(e => console.warn("Cloud Add Failed", e));
    },

    saveStateToCloud: async (payload, game = null, isAuto = false) => {
        const targetGame = game || app.state.currentGame;
        console.log("LOG: saveStateToCloud called");
        if (!app.state.user || !targetGame) {
            console.warn("LOG: User or Game not context available.");
            if (app.state.isExiting) app.exitGame();
            return;
        }
        const uid = app.state.user.uid;
        const gameId = targetGame.id;

        try {
            // 1. Convert to Blob (Sync, Optimized)
            const blob = app.base64ToBlob(payload);
            const filename = `${uid}_${gameId}_${Date.now()}.state`;

            // Upload to GreenHost
            if (!isAuto) app.showToast('<i class="fa-solid fa-cloud-arrow-up"></i> Subiendo...', 2000);
            const uploadRes = await app.uploadToGreenHost(blob, filename);

            if (!uploadRes || !uploadRes.id) throw new Error("Invalid GreenHost Response");

            // Save Metadata to Firestore (SLOT SPECIFIC)
            // Save Metadata to Firestore (SLOT SPECIFIC)
            const slotKey = `slot${app.state.currentSlot || 1}`;

            // MERGE: Use dot notation to safely update specific fields without overwriting the rest of the slot
            const firestoreUpdate = {};
            firestoreUpdate[`${slotKey}.timestamp`] = firebase.firestore.FieldValue.serverTimestamp();
            firestoreUpdate[`${slotKey}.state_file_id`] = uploadRes.id;

            await db.collection('users').doc(uid).collection('saves').doc(gameId).update(firestoreUpdate) // Use update for existing docs
                .catch(async (e) => {
                    // Fallback to set with merge if doc doesn't exist (rare but possible first save)
                    if (e.code === 'not-found') {
                        await db.collection('users').doc(uid).collection('saves').doc(gameId).set(firestoreUpdate, { merge: true });
                    } else {
                        throw e;
                    }
                });

            // OPTIMISTIC UPDATE REMOVED: Strict Cloud Truth requested.
            // validación visual via onSnapshot

            console.log(`LOG: GreenHost Save SUCCESS to ${slotKey}`, uploadRes.id);

            if (isAuto) {
                app.toggleAutoSaveIndicator(false);
                if (app.state.isAutoSaving) app.state.isAutoSaving = false;
            } else {
                app.showToast('<i class="fa-solid fa-check" style="color:#28a745;"></i> Guardado OK');
            }

            // Visual feedback for Overlay
            const overlayBtn = document.querySelector('#manual-save-overlay button');
            if (overlayBtn) {
                overlayBtn.innerHTML = '<i class="fa-solid fa-check"></i> ¡Guardado!';
            }

            // Visual feedback for ESC menu (if visible/applicable)
            const btn = document.querySelector('.btn-option[onclick="app.saveAndExit()"]');
            if (btn && btn.offsetParent !== null) {
                const original = btn.innerHTML;
                btn.innerHTML = '<i class="fa-solid fa-check"></i> Listo';
                setTimeout(() => btn.innerHTML = original, 2000);
            }

            if (app.state.isExiting) {
                setTimeout(() => app.exitGame(), 1000); // 1s delay to see "Saved" message
            }

            return uploadRes;

        } catch (err) {
            console.error("LOG: Cloud Save Error", err);

            const overlayBtn = document.querySelector('#manual-save-overlay button');
            if (overlayBtn) {
                overlayBtn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Error';
                overlayBtn.disabled = false;
            }

            app.showToast("Error al guardar: " + err.message, 2000);
            // Don't exit on error so user can retry
        }
    },

    saveSramToCloud: async (payload, game = null, isAuto = false) => {
        const targetGame = game || app.state.currentGame;
        console.log("LOG: saveSramToCloud called");
        if (!app.state.user || !targetGame) {
            console.warn("LOG: User or Game not set during SRAM save.");
            if (app.state.isExiting) app.exitGame();
            return;
        }
        const uid = app.state.user.uid;
        const gameId = targetGame.id;

        try {
            // Convert to Blob
            const blob = app.base64ToBlob(payload);
            const filename = `${uid}_${gameId}_${Date.now()}.sram`;

            // Upload to GreenHost
            const uploadRes = await app.uploadToGreenHost(blob, filename);

            if (!uploadRes || !uploadRes.id) throw new Error("Invalid GreenHost Response");

            console.log("LOG: Attempting Firestore Write (SRAM Metadata)...");

            // SAVE SRAM TO SPECIFIC SLOT
            // SAVE SRAM TO SPECIFIC SLOT
            const slotKey = `slot${app.state.currentSlot || 1}`;

            // MERGE: Use dot notation for SRAM
            const firestoreUpdate = {};
            firestoreUpdate[`${slotKey}.sram_timestamp`] = firebase.firestore.FieldValue.serverTimestamp();
            firestoreUpdate[`${slotKey}.sram_file_id`] = uploadRes.id;

            await db.collection('users').doc(uid).collection('saves').doc(gameId).update(firestoreUpdate)
                .catch(async (e) => {
                    if (e.code === 'not-found') {
                        await db.collection('users').doc(uid).collection('saves').doc(gameId).set(firestoreUpdate, { merge: true });
                    } else {
                        throw e;
                    }
                });

            // OPTIMISTIC UPDATE REMOVED: Strict Cloud Truth requested.
            // validación visual via onSnapshot


            console.log(`LOG: Cloud SRAM Save SUCCESS to ${slotKey}`);

            if (isAuto) {
                app.toggleAutoSaveIndicator(false);
                if (app.state.isAutoSaving) app.state.isAutoSaving = false;
            } else {
                app.showToast('<i class="fa-solid fa-floppy-disk" style="color:#007bff;"></i> SRAM OK');
            }

            // Visual feedback for Overlay
            const overlayBtn = document.querySelector('#manual-save-overlay button');
            if (overlayBtn) {
                overlayBtn.innerHTML = '<i class="fa-solid fa-check"></i> SRAM Guardada';
            }

            // If we are exiting, wait a bit then exit
            if (app.state.isExiting) {
                setTimeout(() => app.exitGame(), 1000);
            }
            return uploadRes;

        } catch (err) {
            console.error("LOG: Cloud SRAM Error", err);

            const overlayBtn = document.querySelector('#manual-save-overlay button');
            if (overlayBtn) {
                overlayBtn.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> Error';
                overlayBtn.disabled = false;
            }

            app.showToast("Error al guardar SRAM", 2000);
        }
    },

    // CATALOG & UI
    // CATALOG & UI
    loadCatalog: () => {
        fetch('games.json')
            .then(res => res.json())
            .then(data => {
                app.gamesDB = data;
                app.renderStore();
                app.renderLibrarySidebar();
            })
            .catch(e => {
                console.error("Error loading games.json", e);
                // Fallback or empty
                app.gamesDB = [];
                app.renderStore();
            });
    },

    renderStore: () => {
        const grid = document.getElementById('store-grid');
        grid.innerHTML = '';
        app.gamesDB.forEach(game => {
            const card = document.createElement('div');
            card.className = 'game-card';
            card.onclick = () => app.showGameDetails(game.id);
            const tagsHtml = game.tags ? game.tags.map(t => `<span class="tag-badge">${t}</span>`).join('') : '';
            card.innerHTML = `
                <div class="card-image"><img src="${game.image}"></div>
                <div class="card-info"><h4>${game.title}</h4><div class="tags-row" style="display:flex; gap:5px; flex-wrap:wrap; margin-top:5px;">${tagsHtml}</div></div>`;
            grid.appendChild(card);
        });
    },

    // NEW: Details View
    showGameDetails: (id) => {
        let game = app.gamesDB.find(g => g.id === id);
        if (!game) return;

        // Merge with owned data (playtime)
        const owned = app.state.myGames.find(g => g.id === id);
        if (owned) game = { ...game, ...owned };

        app.navigateTo('details');
        const hero = document.getElementById('game-hero');
        const isOwned = app.state.myGames.some(g => g.id === id);
        const actionBtn = isOwned
            ? `<button class="btn-play-action" onclick="app.prepareGame('${game.id}')"><i class="fa-solid fa-play"></i> JUGAR AHORA</button>`
            : `<button class="btn-play-action" style="background:#007bff;" onclick="app.downloadGame('${game.id}')"><i class="fa-solid fa-download"></i> INSTALAR</button>`;
        hero.innerHTML = `
            <div class="details-header" style="background-image: url('${game.heroImage || game.image}');"></div>
            <div class="details-content">
                <div class="details-title-row"><h1>${game.title}</h1></div>
                <p style="font-size:16px; color:#555; margin-bottom:30px;">${game.description || 'Sin descripción.'}</p>
                <div class="play-bar">${actionBtn}<div style="font-size:13px; color:#777;"><span><i class="fa-solid fa-microchip"></i> Core: ${game.core}</span></div></div>
                <div style="margin-top:15px; font-size:14px; color:#555;"><i class="fa-solid fa-clock"></i> Tiempo jugado: <strong>${app.formatPlaytime(game.playtime || 0)}</strong></div>
            </div>`;
    },

    formatPlaytime: (ms) => {
        if (!ms) return "0 min";
        const totalMinutes = Math.floor(ms / 60000);
        const hours = Math.floor(totalMinutes / 60);
        const minutes = totalMinutes % 60;
        if (hours > 0) return `${hours} h ${minutes} min`;
        return `${minutes} min`;
    },

    bindNav: () => {
        document.querySelectorAll('.main-nav li').forEach(tab => {
            tab.addEventListener('click', () => {
                const target = tab.dataset.tab;
                app.navigateTo(target);
            });
        });
    },

    downloadGame: (id) => {
        const game = app.gamesDB.find(g => g.id === id);
        if (!game) return;
        const hero = document.getElementById('game-hero');
        const btn = hero.querySelector('button');
        if (btn) { btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Instalando...'; btn.disabled = true; }

        setTimeout(() => {
            if (!app.state.myGames.find(g => g.id === id)) {
                game.playtime = 0; // Init playtime
                app.state.myGames.push(game);
                app.addGameToCloud(game); // Firebase
                app.renderLibrarySidebar();
                app.showGameDetails(id);
            }
        }, 1000);
    },

    // GAME LAUNCHER
    // 1. CLICK PLAY -> SHOW LOADER
    prepareGame: (id) => {
        app.state.currentGame = app.gamesDB.find(g => g.id === id);

        // Show Full Loader
        const loader = document.getElementById('full-loader');
        loader.classList.add('active');

        // Fake loading time 2s
        setTimeout(() => {
            loader.classList.remove('active');
            app.showSaveSlots();
        }, 1500);
    },

    // 2. SHOW SAVE SLOTS - NEW MULTI-SLOT SYSTEM
    showSaveSlots: async () => {
        const game = app.state.currentGame;
        if (!game) return;

        const overlay = document.getElementById('save-selector');
        overlay.classList.add('active');
        // Initial Loading View
        overlay.innerHTML = `
            <div style="background:white; padding:40px; border-radius:12px; text-align:center; max-width:600px; width:90%; box-shadow:0 10px 40px rgba(0,0,0,0.1);">
                <h2 style="margin-bottom:20px; color:#333;">Buscando partidas...</h2>
                <i class="fa-solid fa-spinner fa-spin fa-2x" style="color:#007bff;"></i>
            </div>`;

        // Clear previous listener if exists
        if (app.state.saveSlotsUnsub) {
            app.state.saveSlotsUnsub();
            app.state.saveSlotsUnsub = null;
        }

        if (app.state.user) {
            // Guest Protection
            if (app.state.user.uid === 'guest_123') {
                overlay.innerHTML = `
                <div style="background:white; padding:30px; border-radius:12px; text-align:center; max-width:500px;">
                    <h2 style="margin-bottom:15px; color:#d9534f;"><i class="fa-solid fa-user-slash"></i> Modo Invitado</h2>
                    <p style="margin-bottom:20px;">Los guardados en la nube requieren iniciar sesión. <br>El modo invitado no admite persistencia.</p>
                    <button class="btn-primary" onclick="app.cancelGameStart()">Entendido</button>
                    <button class="btn-text" onclick="app.launchEmulator(false)" style="margin-top:10px;">Jugar sin Guardar</button>
                </div>`;
                return;
            }

            try {
                // Use onSnapshot for real-time updates
                console.log(`LOG: Listening for saves at users/${app.state.user.uid}/saves/${game.id}`);

                app.state.saveSlotsUnsub = db.collection('users').doc(app.state.user.uid).collection('saves').doc(game.id)
                    .onSnapshot(doc => {
                        let saveData = {};
                        if (doc.exists) {
                            saveData = doc.data();
                            console.log("LOG: Save Data Received:", saveData);
                        }

                        // REPAIR: Check for broken "dot-notation" keys from previous bug
                        ['slot1', 'slot2', 'slot3'].forEach(s => {
                            if (saveData[`${s}.timestamp`]) {
                                if (!saveData[s]) saveData[s] = {};
                                saveData[s].timestamp = saveData[`${s}.timestamp`];
                            }
                            if (saveData[`${s}.state_file_id`]) {
                                if (!saveData[s]) saveData[s] = {};
                                saveData[s].state_file_id = saveData[`${s}.state_file_id`];
                            }
                            if (saveData[`${s}.sram_file_id`]) {
                                if (!saveData[s]) saveData[s] = {};
                                saveData[s].sram_file_id = saveData[`${s}.sram_file_id`];
                            }
                        });


                        // Handle migration/legacy
                        if (!saveData.slot1 && (saveData.state_file_id || saveData.sram_file_id || saveData.data)) {
                            console.log("LOG: Migrating Legacy Save to Slot 1");
                            saveData.slot1 = {
                                timestamp: saveData.timestamp,
                                state_file_id: saveData.state_file_id,
                                sram_file_id: saveData.sram_file_id,
                                data: saveData.data,
                                sram: saveData.sram
                            };
                        }

                        app.state.currentSaveData = saveData;
                        app.renderSaveSlotsUI(app.state.currentSlot || 1);
                    }, error => {
                        console.error("Save Fetch Error", error);
                        // Show Error in UI (fallback)
                        app.state.currentSaveData = {};
                        app.renderSaveSlotsUI(1);
                    });
            } catch (e) {
                console.error("Save Fetch Setup Error", e);
                app.state.currentSaveData = {};
                app.renderSaveSlotsUI(1);
            }
        } else {
            // Not logged in (Shouldn't happen here usually if UI flow is correct)
            app.showToast("Inicia sesión para ver tus guardados");
            app.cancelGameStart();
        }
    },

    renderSaveSlotsUI: (selectedSlot = 1) => {
        app.state.currentSlot = selectedSlot;
        const overlay = document.getElementById('save-selector');
        const data = app.state.currentSaveData || {};

        let slotsHtml = '';
        const today = new Date().toLocaleDateString();

        // Check for Slot Data
        console.log("LOG: Rendering Slots with Data:", data);

        for (let i = 1; i <= 3; i++) {
            const slot = data['slot' + i];
            const isEmpty = !slot;
            const isSelected = i === selectedSlot;

            let timeStr = 'Vacío - Nueva Partida';
            // Robust timestamp check
            if (slot) {
                const ts = slot.timestamp || slot.sram_timestamp;
                if (ts) {
                    let date = null;
                    if (ts.toDate && typeof ts.toDate === 'function') date = ts.toDate();
                    else if (ts instanceof Date) date = ts;
                    else if (typeof ts === 'string' || typeof ts === 'number') date = new Date(ts);
                    else if (ts.seconds) date = new Date(ts.seconds * 1000); // Firestore timestamp fallback

                    if (date && !isNaN(date.getTime())) {
                        const dateStr = date.toLocaleDateString() === today ? 'Hoy' : date.toLocaleDateString();
                        timeStr = dateStr + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    } else {
                        timeStr = 'Guardado (Fecha Desconocida)';
                    }
                } else {
                    timeStr = 'Guardado Antiguo';
                }
            } else if (slot) { // Should be covered above but fail-safe
                timeStr = 'Guardado Antiguo';
            }

            slotsHtml += `
                <div class="save-slot-card ${isSelected ? 'selected' : ''}" onclick="app.renderSaveSlotsUI(${i})">
                    <div class="slot-icon">
                        <i class="fa-solid ${isEmpty ? 'fa-plus' : 'fa-floppy-disk'}"></i>
                    </div>
                    <div class="slot-info">
                        <h4>Ranura ${i}</h4>
                        <span>${timeStr}</span>
                    </div>
                    ${isSelected ? '<div class="check-icon"><i class="fa-solid fa-circle-check"></i></div>' : ''}
                </div>
            `;
        }

        // Actions Logic
        const selectedData = data['slot' + selectedSlot];
        const isEmpty = !selectedData;

        let actionsHtml = '';
        if (isEmpty) {
            actionsHtml = `
                <button class="btn-primary" onclick="app.launchEmulator(false)">
                    <i class="fa-solid fa-play"></i> Nueva Partida
                </button>
             `;
        } else {
            actionsHtml = `
                <button class="btn-primary" onclick="app.launchEmulator(true)">
                    <i class="fa-solid fa-play"></i> Continuar
                </button>
                <button class="btn-danger-outline" onclick="if(confirm('¿Seguro que quieres borrar este guardado e iniciar de cero?')) app.launchEmulator(false)">
                    <i class="fa-solid fa-rotate-right"></i> Empezar de 0
                </button>
            `;
        }

        overlay.innerHTML = `
             <div class="save-slots-container">
                <h2 style="margin-bottom:10px; color:#333;">Selecciona una Ranura</h2>
                <div class="slots-grid-3">
                    ${slotsHtml}
                </div>
                <div class="slots-actions">
                    ${actionsHtml}
                    <button class="btn-text" onclick="app.cancelGameStart()" style="margin-left:10px;">Cancelar</button>
                </div>
            </div>
        `;
    },

    cancelGameStart: () => {
        if (app.state.saveSlotsUnsub) {
            app.state.saveSlotsUnsub();
            app.state.saveSlotsUnsub = null;
        }
        document.getElementById('save-selector').classList.remove('active');
        app.state.currentGame = null;
    },

    // 3. LAUNCH EMULATOR (NOSTALGIST.JS VERSION)
    launchEmulator: async (shouldLoad = false) => {
        if (app.state.saveSlotsUnsub) {
            app.state.saveSlotsUnsub();
            app.state.saveSlotsUnsub = null;
        }
        document.getElementById('save-selector').classList.remove('active');
        const game = app.state.currentGame;
        if (!game) return;

        // Core Mapping
        const CORE_MAP = {
            'gba': 'gba',
            'gbc': 'gbc',
            'gb': 'gb',
            'n64': 'n64',
            'nes': 'nes',
            'snes': 'snes',
            'sega': 'segaMD',
            'psx': 'psx'
        };
        const core = CORE_MAP[game.core] || 'gba';

        // Hide UI
        document.getElementById('app-header').classList.add('app-ui-hidden');
        document.querySelector('.content-wrapper').classList.add('app-ui-hidden');

        app.state.isPlaying = true;
        app.state.playtimeStart = Date.now(); // Start Playtime Tracking

        // Update Status Real
        app.updateUserStatus('playing', game.title);

        const wrapper = document.getElementById('emulator-wrapper');
        wrapper.innerHTML = `
            <div style="height: 50px; background: #000; display: flex; align-items: center; justify-content: space-between; padding: 0 20px; border-bottom: 1px solid #333;">
                <span style="color: #ccc; font-weight: 800; font-size: 18px; letter-spacing: 1px;">PLAYBITZ</span>
                <button onclick="app.saveAndExit()" style="background: #ffffff; color: #000; border: none; padding: 8px 16px; border-radius: 4px; font-weight: 700; cursor: pointer; display: flex; align-items: center; gap: 5px;">
                    <i class="fa-solid fa-floppy-disk"></i> GUARDAR
                </button>
            </div>
        `;
        wrapper.classList.add('active');

        // Check cloud data (GreenHost Support)
        let initialSaveState = null;
        let initialSram = null;

        if (shouldLoad && app.state.user) {
            try {
                // Using Cached Data from showSaveSlots or Refetching if missing (safety)
                let d = app.state.currentSaveData;

                // If checking logic again (rare case), but usually it's set.
                if (!d) {
                    const doc = await db.collection('users').doc(app.state.user.uid).collection('saves').doc(game.id).get();
                    if (doc.exists) d = doc.data();
                }

                if (d) {
                    // Extract slot specific data
                    // If legacy structure is present and slot1 missing, we use root keys (handled in showSaveSlots too, but rigorous here)
                    let slotData = d['slot' + app.state.currentSlot];
                    if (!slotData && app.state.currentSlot === 1 && (d.state_file_id || d.sram_file_id)) {
                        slotData = d; // Legacy fallback
                    }

                    if (slotData) {
                        // 1. STATE RESTORE
                        if (slotData.state_file_id) {
                            try {
                                app.showToast("Descargando save state...");
                                const blob = await app.downloadFromGreenHost(slotData.state_file_id);
                                const b64 = await app.blobToBase64(blob);
                                app.state.pendingState = b64;
                                console.log("LOG: State loaded.");
                            } catch (e) { console.error("GH State Download Error", e); }
                        } else if (slotData.data) {
                            app.state.pendingState = slotData.data; // Legacy Firestore Data
                            console.log("LOG: State loaded from Cloud (Legacy).");
                        }

                        // 2. SRAM RESTORE
                        if (slotData.sram_file_id) {
                            try {
                                // app.showToast("Descargando SRAM...");
                                const blob = await app.downloadFromGreenHost(slotData.sram_file_id);
                                const b64 = await app.blobToBase64(blob);
                                app.state.pendingSram = b64;
                                console.log("LOG: SRAM loaded");
                            } catch (e) { console.error("GH SRAM Download Error", e); }
                        } else if (slotData.sram) {
                            app.state.pendingSram = slotData.sram; // Legacy
                            console.log("LOG: SRAM loaded from Cloud (Legacy).");
                        }
                    }
                }
            } catch (e) { console.error("Cloud Fetch Error", e); }
        }

        // AUTO-SAVE INTERVAL
        if (app.state.autoSaveInterval) clearInterval(app.state.autoSaveInterval);
        const autoMinutes = (app.state.settings && app.state.settings.autoSaveMinutes) ? app.state.settings.autoSaveMinutes : 2;
        const autoMs = autoMinutes * 60000;

        console.log("LOG: Starting AutoSave Interval: " + autoMinutes + " min (" + autoMs + "ms)");

        app.state.autoSaveInterval = setInterval(() => {
            if (app.state.isPlaying) {
                app.state.isAutoSaving = true;
                app.toggleAutoSaveIndicator(true);
                const fr = document.getElementById('emu-frame');
                if (fr) fr.contentWindow.postMessage('SAVE_CAPTURE', '*');
            }
        }, autoMs);



        // Fetch ROM as Blob to avoid FS errors in iframe
        let romBlobUrl = '';
        try {
            console.log("LOG: Fetching ROM payload...", game.rom);
            const res = await fetch(game.rom);
            if (!res.ok) throw new Error("ROM Fetch Failed: " + res.status);
            const blob = await res.blob();
            romBlobUrl = URL.createObjectURL(blob);
            console.log("LOG: ROM Blob created:", romBlobUrl);
        } catch (e) {
            console.error("ROM Load Error:", e);
            alert("Error cargando la ROM: " + e.message);
            return;
        }

        // Create Iframe for isolation
        const iframe = document.createElement('iframe');
        iframe.id = 'emu-frame';
        iframe.style.width = '100%';
        iframe.style.height = 'calc(100% - 50px)'; // Adjust for header
        iframe.style.border = 'none';
        iframe.allow = "autoplay; gamepad; fullscreen";

        const html = `
        <!DOCTYPE html>
        <html>
        <head>
            <style>
                body { margin: 0; background: #000; overflow: hidden; }
                #game-container { width: 100vw; height: 100vh; }
            </style>
        </head>
        <body>
            <div id="game-container"></div>
            
            <script>
                // EmulatorJS Config
                window.EJS_player = '#game-container';
                window.EJS_core = '${core}';
                window.EJS_gameUrl = '${romBlobUrl}';
                window.EJS_pathtodata = 'https://cdn.emulatorjs.org/stable/data/';
                window.EJS_startOnLoaded = true;
                window.EJS_DEBUG_XX = true;

                // Callbacks
                window.EJS_onGameStart = function() {
                    console.log("Iframe: Game Started, requesting SRAM...");
                    window.parent.postMessage('EJS_LOADED', '*');
                };
                
                // Propagate ESC key to parent
                window.addEventListener('keydown', function(e) {
                    if (e.key === 'Escape') {
                        window.parent.postMessage('ESCAPE_KEY', '*');
                    }
                });

                // Handle Save Injection & Extraction
                window.addEventListener('message', function(e) {
                    if (e.data && e.data.type === 'RESTORE_SRAM') {
                        console.log("Iframe: Restoring SRAM...");
                        try {
                            var payload = e.data.payload;
                            var bin = window.atob(payload);
                            var u8 = new Uint8Array(bin.length);
                            for (var i = 0; i < bin.length; i++) {
                                u8[i] = bin.charCodeAt(i);
                            }
                            
                            if (window.EJS_emulator && window.EJS_emulator.gameManager) {
                                window.EJS_emulator.gameManager.loadSave(u8);
                                console.log("Iframe: SRAM restored successfully!");
                            }
                        } catch(err) { console.error("Iframe SRAM Error:", err); }
                    }

                    if (e.data && e.data.type === 'RESTORE_STATE') {
                        console.log("Iframe: Restoring STATE...");
                        try {
                            var payload = e.data.payload;
                            var bin = window.atob(payload);
                            var u8 = new Uint8Array(bin.length);
                            for (var i = 0; i < bin.length; i++) {
                                u8[i] = bin.charCodeAt(i);
                            }
                            
                            if (window.EJS_emulator && window.EJS_emulator.gameManager) {
                                window.EJS_emulator.gameManager.loadState(u8);
                                console.log("Iframe: STATE restored successfully!");
                            }
                        } catch(err) { console.error("Iframe STATE Error:", err); }
                    }

                    if (e.data === 'SAVE_CAPTURE') {
                        console.log("Iframe: Capture Save Requested");
                        // force save
                         if (window.EJS_emulator && window.EJS_emulator.gameManager) {
                                // Attempt standard save
                                try { window.EJS_emulator.gameManager.save(); } catch(e){}
                        }
                        
                        // Wait a moment for FS sync then notify parent to check IDB
                        // Also, try to read FS directly if possible
                        // Wait a moment for FS sync then notify parent to check IDB
                        // Also, try to read FS directly if possible
                        setTimeout(function() {
                            try {
                                var found = false;
                                var paths = ['/data/saves', '/home/web_user/retroarch/userdata/saves'];
                                
                                if (window.FS) {
                                    for (var pIdx = 0; pIdx < paths.length; pIdx++) {
                                        var path = paths[pIdx];
                                        try {
                                            var files = FS.readdir(path);
                                            console.log("Iframe FS Scan " + path + ":", files);
                                            for (var i=0; i<files.length; i++) {
                                                var f = files[i];
                                                if (f.endsWith('.srm') || f.endsWith('.sav') || f.endsWith('.state') || f.endsWith('.k')) {
                                                    var content = FS.readFile(path + '/' + f);
                                                    // Send to parent
                                                    var binary = '';
                                                    var len = content.byteLength;
                                                    for (var b = 0; b < len; b++) binary += String.fromCharCode(content[b]);
                                                    var b64 = window.btoa(binary);
                                                    
                                                    var type = f.endsWith('.state') ? 'CLOUD_SAVE_DATA' : 'CLOUD_SAVE_SRAM';
                                                    window.parent.postMessage({ type: type, payload: b64, filename: f }, '*');
                                                    found = true;
                                                }
                                            }
                                        } catch(e) { console.log("Path not found: " + path); }
                                    }
                                }
                                
                                // FORCE FALLBACK: If we didn't find a file, or even if we did, let's try to get the STATE from memory directly
                                // giving priority to the file if checking purely for 'found' passed, but maybe we want latest memory state?
                                // Let's do it if !found for now to be safe, or just do it ALWAYS for state if possible.
                                if (!found && window.EJS_emulator && window.EJS_emulator.gameManager) {
                                     console.log("Iframe FS failed, attempting direct Manager State...");
                                     try {
                                        var state = window.EJS_emulator.gameManager.getState();
                                        if (state) {
                                            var u8 = new Uint8Array(state);
                                            var binary = '';
                                            for (var b = 0; b < u8.length; b++) binary += String.fromCharCode(u8[b]);
                                            var b64 = window.btoa(binary);
                                            window.parent.postMessage({ type: 'CLOUD_SAVE_DATA', payload: b64, filename: 'save.state' }, '*');
                                            found = true;
                                        }
                                     } catch(e) { console.error("Manager getState error", e); }
                                }

                                if (!found) {
                                    console.error("Iframe: COULD NOT FIND ANY SAVE DATA");
                                    // Optionally notify parent of failure?
                                }
                                
                            } catch(err) { console.warn("Iframe FS Read Error:", err); }
                        }, 2000); // Wait 2s for save flush
                    }
                });
            </script>
            <script src="https://cdn.emulatorjs.org/stable/data/loader.js"></script>
        </body>
        </html>
        `;

        iframe.srcdoc = html;
        wrapper.appendChild(iframe);
        iframe.focus();

        // EmulatorJS handles its own loop, we just track time
    },

    saveAndExit: () => {
        const game = app.state.currentGame;
        if (!game) { app.exitGame(); return; }

        // Show Overlay
        const overlay = document.getElementById('manual-save-overlay');
        if (overlay) overlay.classList.add('active');
        document.getElementById('esc-menu').style.display = 'none';

        // Reset flags
        app.state.isExiting = false;
        app.state.isManualSave = false;
    },

    triggerCloudSaveSequence: () => {
        app.state.isManualSave = true;
        app.state.isExiting = true; // Mark as exiting so save completion triggers exitGame

        const iframe = document.getElementById('emu-frame');
        if (iframe) {
            iframe.contentWindow.postMessage('SAVE_CAPTURE', '*');
        } else {
            console.warn("No emulator frame found");
        }

        const btn = document.querySelector('#manual-save-overlay button');
        if (btn) {
            btn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Procesando...';
            btn.disabled = true;
        }
    },

    handleManualUpload: (input) => {
        if (input.files.length === 0) return;
        const file = input.files[0];
        const reader = new FileReader();

        // reset flag just in case
        app.state.isManualSave = false;

        const btn = input.parentElement;
        if (btn) btn.style.border = '2px solid #007bff';

        reader.onload = function (e) {
            const buffer = e.target.result;
            const b64 = app.arrayBufferToBase64(buffer);

            let promise;
            // Determine save type based on extension
            if (file.name.endsWith('.state')) {
                promise = app.saveStateToCloud(b64, app.state.currentGame);
            } else {
                promise = app.saveSramToCloud(b64, app.state.currentGame);
            }

            if (promise && promise.then) {
                promise.then(() => {
                    app.showToast("Subida Sincronizada. Cerrando...");
                    setTimeout(() => {
                        const overlay = document.getElementById('manual-save-overlay');
                        if (overlay) overlay.classList.remove('active');
                        app.exitGame();
                    }, 1500);
                });
            } else {
                setTimeout(() => {
                    const overlay = document.getElementById('manual-save-overlay');
                    if (overlay) overlay.classList.remove('active');
                    app.exitGame();
                }, 1500);
            }
        };
        reader.readAsArrayBuffer(file);
    },

    exitWithoutSync: () => {
        document.getElementById('manual-save-overlay').classList.remove('active');
        app.resumeGame();
    },

    downloadFileToUser: (base64, filename) => {
        console.log("Triggering download for:", filename);
        const link = document.createElement('a');
        link.href = 'data:application/octet-stream;base64,' + base64;
        link.download = filename;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        // Reset flag after a short delay
        setTimeout(() => app.state.isManualSave = false, 1000);
    },

    resetGame: () => { app.resumeGame(); app.launchEmulator(); },

    exitGame: () => {
        if (app.state.autoSaveInterval) clearInterval(app.state.autoSaveInterval);
        app.state.isManualSave = false;
        // Stop Playtime Tracking
        if (app.state.currentGame && app.state.playtimeStart) {
            const elapsed = Date.now() - app.state.playtimeStart;
            app.state.currentGame.playtime = (app.state.currentGame.playtime || 0) + elapsed;
            app.state.playtimeStart = null;

            // Sync Playtime to Cloud if owned
            const ownedGame = app.state.myGames.find(g => g.id === app.state.currentGame.id);
            if (ownedGame) {
                ownedGame.playtime = app.state.currentGame.playtime;
                app.addGameToCloud(ownedGame);
            }
            console.log(`Playtime saved: ${elapsed}ms. Total: ${app.state.currentGame.playtime}ms`);
        }

        // Update Status Real
        app.updateUserStatus('online', null);

        document.getElementById('esc-menu').style.display = 'none';
        document.getElementById('emulator-wrapper').classList.remove('active');
        document.getElementById('emulator-wrapper').innerHTML = '';
        document.getElementById('app-header').classList.remove('app-ui-hidden');
        document.querySelector('.content-wrapper').classList.remove('app-ui-hidden');
        app.state.isPlaying = false;
        app.state.currentGame = null;
        if (app.state.saveInterval) clearInterval(app.state.saveInterval);
        document.getElementById('manual-save-overlay').classList.remove('active'); // Ensure Overlay Closed
    },

    setupGlobalKeys: () => {
        window.addEventListener('message', (e) => {
            if (e.data === 'ESCAPE_KEY') app.toggleEscMenu();

            if (e.data === 'EJS_LOADED') {
                console.log("LOG: Parent received EJS_LOADED");
                if (app.state.pendingSram) {
                    const fr = document.getElementById('emu-frame');
                    if (fr) fr.contentWindow.postMessage({ type: 'RESTORE_SRAM', payload: app.state.pendingSram }, '*');
                    app.state.pendingSram = null;
                }
                if (app.state.pendingState) {
                    const fr = document.getElementById('emu-frame');
                    if (fr) fr.contentWindow.postMessage({ type: 'RESTORE_STATE', payload: app.state.pendingState }, '*');
                    app.state.pendingState = null;
                }
            }

            if (e.data && e.data.type === 'CLOUD_SAVE_DATA') {
                app.saveStateToCloud(e.data.payload, app.state.currentGame, app.state.isAutoSaving);
                // Also update playtime on auto-save
                app.updatePlaytime();
            }
            if (e.data && e.data.type === 'CLOUD_SAVE_SRAM') {
                app.saveSramToCloud(e.data.payload, app.state.currentGame, app.state.isAutoSaving);
            }
        });
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && app.state.isPlaying) app.toggleEscMenu();
        });
    },

    toggleEscMenu: () => {
        const menu = document.getElementById('esc-menu');
        menu.style.display = (menu.style.display === 'flex') ? 'none' : 'flex';
        if (menu.style.display === 'none') {
            const fr = document.getElementById('emu-frame'); if (fr) fr.focus();
        }
    },

    resumeGame: () => {
        document.getElementById('esc-menu').style.display = 'none';
        const iframe = document.getElementById('emu-frame'); if (iframe) iframe.focus();
    },

    // --- LEADERBOARD & PLAYTIME SYSTEM ---

    updatePlaytime: () => {
        if (!app.state.currentGame || !app.state.playtimeStart || !app.state.user) return;

        const now = Date.now();
        const elapsed = now - app.state.playtimeStart;
        app.state.playtimeStart = now; // Reset start to now for next interval

        // Update Local Game
        const gameId = app.state.currentGame.id;
        let localGame = app.state.myGames.find(g => g.id === gameId);
        if (!localGame) {
            // Should exist, but if not add it
            localGame = { ...app.state.currentGame, playtime: 0 };
            app.state.myGames.push(localGame);
        }
        localGame.playtime = (localGame.playtime || 0) + elapsed;

        // Persist Local
        localStorage.setItem('myGames', JSON.stringify(app.state.myGames));

        // 1. Update User Library Doc
        const uid = app.state.user.uid;
        db.collection('users').doc(uid).collection('library').doc(gameId).set({
            playtime: localGame.playtime
        }, { merge: true });

        // 2. Update Global User Stats (Total Playtime)
        // We need to fetch current total first or increment safely. 
        // For simplicity 'users' doc will allow us to query global leaderboard
        db.collection('users').doc(uid).set({
            totalPlaytime: firebase.firestore.FieldValue.increment(elapsed),
            lastSeen: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        // 3. Update Game Specific Leaderboard
        db.collection('leaderboards').doc(gameId).collection('scores').doc(uid).set({
            username: app.state.user.username || 'User',
            avatar: app.state.user.avatar || '',
            playtime: localGame.playtime,
            lastUpdate: firebase.firestore.FieldValue.serverTimestamp()
        }, { merge: true });

        console.log(`Playtime synced: +${elapsed}ms`);
    },

    formatPlaytime: (ms) => {
        if (!ms) return "0s";
        let seconds = Math.floor(ms / 1000);
        let minutes = Math.floor(seconds / 60);
        let hours = Math.floor(minutes / 60);

        seconds = seconds % 60;
        minutes = minutes % 60;

        const p = (n) => n.toString().padStart(2, '0');

        if (hours > 0) return `${hours}h ${minutes}m ${p(seconds)}s`;
        if (minutes > 0) return `${minutes}m ${p(seconds)}s`;
        return `${seconds}s`;
    },

    // --- VIEW NAVIGATION ---

    navigateTo: (viewId) => {
        if (app.state.friendsInterval) clearInterval(app.state.friendsInterval);
        if (app.state.leaderboardInterval) clearInterval(app.state.leaderboardInterval);
        if (app.state.globalUsersInterval) clearInterval(app.state.globalUsersInterval);

        document.querySelectorAll('.view-section').forEach(v => v.classList.remove('active'));
        document.querySelectorAll('.main-nav li').forEach(t => t.classList.remove('active'));

        // Handle Sidebar Selection Visuals
        document.querySelectorAll('.sidebar li').forEach(l => l.classList.remove('active-item'));

        if (viewId === 'details') {
            document.getElementById('details-view').classList.add('active');
            // Refresh Active Players
            const game = app.state.currentGame || app.state.myGames[0]; // Fallback?
            if (game) app.refreshGameDetailsData(game.id);
        } else if (viewId === 'store') {
            document.getElementById('store-view').classList.add('active');
            const t = document.querySelector('[data-tab="store"]'); if (t) t.classList.add('active');
        } else if (viewId === 'library') {
            document.getElementById('library-view').classList.add('active');
            const t = document.querySelector('[data-tab="library"]'); if (t) t.classList.add('active');
            app.renderLibraryGrid();
        } else if (viewId === 'community') {
            document.getElementById('community-view').classList.add('active');
            const t = document.querySelector('[data-tab="community"]'); if (t) t.classList.add('active');
            app.renderGlobalUsersGrid();
            app.state.globalUsersInterval = setInterval(() => app.listenToGlobalUsers(), 60000);
        } else if (viewId === 'leaderboard') {
            document.getElementById('leaderboard-view').classList.add('active');
            const t = document.querySelector('[data-tab="leaderboard"]'); if (t) t.classList.add('active');
            app.fetchGlobalLeaderboard();
            app.state.leaderboardInterval = setInterval(() => app.fetchGlobalLeaderboard(), 120000); // 2 min
        }
    },

    // --- LEADERBOARD FETCHING ---

    fetchGlobalLeaderboard: () => {
        const list = document.getElementById('global-leaderboard-list');
        // list.innerHTML = '<li style="padding:20px; text-align:center;">Actualizando...</li>';

        db.collection('users').orderBy('totalPlaytime', 'desc').limit(20).get()
            .then(snapshot => {
                list.innerHTML = '';
                let rank = 1;
                snapshot.forEach(doc => {
                    const d = doc.data();
                    const li = document.createElement('li');
                    li.className = 'leaderboard-row';
                    li.innerHTML = `
                        <div class="rank-num rank-${rank}">${rank}</div>
                        <div class="player-info">
                            <img src="${d.avatar || 'https://ui-avatars.com/api/?name=User'}" alt="av">
                            <div>
                                <div class="player-name">${d.username || 'Usuario'}</div>
                                <div class="player-status">${d.status === 'playing' ? 'Jugando ahora' : 'Offline'}</div>
                            </div>
                        </div>
                        <div class="time-stat">${app.formatPlaytime(d.totalPlaytime || 0)}</div>
                    `;
                    list.appendChild(li);
                    rank++;
                });
                if (snapshot.empty) list.innerHTML = '<li style="padding:20px;">Sin datos aún.</li>';
            })
            .catch(e => console.error("Leaderboard Error:", e));
    },

    refreshGameDetailsData: (gameId) => {
        // Active Players
        const activeContainer = document.getElementById('active-players-container');
        const activeGrid = document.getElementById('active-players-grid');
        const game = app.gamesDB.find(g => g.id === gameId) || {};

        // Find users playing this game
        db.collection('users').where('status', '==', 'playing').where('game', '==', game.title).get()
            .then(snap => {
                if (!snap.empty) {
                    activeContainer.style.display = 'block';
                    activeGrid.innerHTML = '';
                    snap.forEach(doc => {
                        const d = doc.data();
                        const name = d.username || d.displayName || 'Usuario';
                        const avatar = d.avatar || `https://ui-avatars.com/api/?name=${name}&background=random`;

                        const chip = document.createElement('div');
                        chip.className = 'active-user-chip';
                        chip.innerHTML = `<img src="${avatar}"><span>${name}</span>`;
                        activeGrid.appendChild(chip);
                    });
                } else {
                    activeContainer.style.display = 'none';
                }
            });

        // Game Leaderboard
        const lbList = document.getElementById('game-leaderboard-list');
        lbList.innerHTML = '<li>Cargando...</li>';

        db.collection('leaderboards').doc(gameId).collection('scores').orderBy('playtime', 'desc').limit(10).get()
            .then(snap => {
                lbList.innerHTML = '';
                let rank = 1;
                snap.forEach(doc => {
                    const d = doc.data();
                    const name = d.username || d.displayName || 'Usuario';
                    const avatar = d.avatar || `https://ui-avatars.com/api/?name=${name}&background=random`;

                    const li = document.createElement('li');
                    li.className = 'leaderboard-row';
                    li.innerHTML = `
                        <div class="rank-num rank-${rank}" style="font-size:14px; width:30px;">${rank}</div>
                        <div class="player-info">
                            <img src="${avatar}" style="width:30px; height:30px;">
                            <div class="player-name" style="font-size:14px;">${name}</div>
                        </div>
                        <div class="time-stat" style="font-size:13px;">${app.formatPlaytime(d.playtime)}</div>
                    `;
                    lbList.appendChild(li);
                    rank++;
                });
                if (snap.empty) lbList.innerHTML = '<li style="padding:15px; color:#777;">Sé el primero en jugar.</li>';
            });
    },

    // --- LIBRARY ---

    renderLibrarySidebar: () => {
        const list = document.getElementById('mini-library-list');
        if (!list) return;
        list.innerHTML = '';
        if (!app.state.myGames || app.state.myGames.length === 0) {
            list.innerHTML = '<li class="empty-msg" style="padding:10px; color:#999; font-size:12px;">Biblioteca vacía</li>';
            return;
        }
        app.state.myGames.forEach(game => {
            // HYDRATION: Ensure we have static data from catalog
            let displayGame = game;
            if (app.gamesDB) {
                const catalogGame = app.gamesDB.find(g => g.id === game.id);
                if (catalogGame) {
                    displayGame = { ...catalogGame, ...game };
                }
            }

            // Skip if still missing title (invalid/ghost game)
            if (!displayGame.title) return;

            const li = document.createElement('li');
            li.innerHTML = `<img src="${displayGame.image || 'img/no-icon.png'}" style="width:20px; height:20px; object-fit:cover; border-radius:2px;"> ${displayGame.title}`;
            li.onclick = () => app.showGameDetails(displayGame.id);
            list.appendChild(li);
        });
    },

    renderLibraryGrid: () => {
        const grid = document.getElementById('library-grid-target');
        if (!grid) return;
        grid.innerHTML = '';

        if (!app.state.myGames || app.state.myGames.length === 0) {
            grid.innerHTML = '<p style="color:#777; width:100%; text-align:center;">No tienes juegos en tu biblioteca. ¡Ve a la tienda y descarga alguno!</p>';
            return;
        }

        app.state.myGames.forEach(game => {
            // HYDRATION: Ensure we have static data from catalog
            let displayGame = game;
            if (app.gamesDB) {
                const catalogGame = app.gamesDB.find(g => g.id === game.id);
                if (catalogGame) {
                    displayGame = { ...catalogGame, ...game };
                }
            }

            // Skip if still missing title
            if (!displayGame.title) return;

            const card = document.createElement('div');
            card.className = 'game-card'; // Reuse game-card style
            card.onclick = () => app.showGameDetails(displayGame.id);
            card.innerHTML = `
                <div class="card-image"><img src="${displayGame.image || 'img/no-img.png'}"></div>
                <div class="card-info">
                    <h4>${displayGame.title}</h4>
                    <div style="font-size:12px; color:#777; margin-top:5px;"><i class="fa-solid fa-clock"></i> ${app.formatPlaytime(displayGame.playtime)}</div>
                </div>`;
            grid.appendChild(card);
        });
    },

    // --- REST ---

    saveState: () => {
        const iframe = document.getElementById('emu-frame');
        if (iframe) iframe.contentWindow.postMessage('SAVE_STATE', '*');
        app.resumeGame();
    },
    loadState: () => {
        const iframe = document.getElementById('emu-frame');
        if (iframe) iframe.contentWindow.postMessage('LOAD_STATE', '*');
        app.resumeGame();
    },

    listenToGlobalUsers: () => {
        if (!app.state.user) return;
        // Fetch users active in last 15 minutes (or just lastSeen desc limit 50)
        // Since we can't do complex querying easily, we just grab recent modified or lastSeen
        app.state.globalUsers = [];

        db.collection('users').orderBy('lastSeen', 'desc').limit(50).get()
            .then(snapshot => {
                const users = [];
                const now = Date.now();
                snapshot.forEach(doc => {
                    const d = doc.data();
                    if (app.state.user && doc.id === app.state.user.uid) return; // Skip self

                    // Filter offline/old if desired, but user asked for "All players playing"
                    // We check if lastSeen is within ~10 mins to consider them "Active"
                    let status = 'offline';
                    if (d.lastSeen) {
                        const diff = now - d.lastSeen.toDate().getTime();
                        if (diff < 1000 * 60 * 10) status = 'online'; // 10 mins
                        if (d.status === 'playing' && diff < 1000 * 60 * 10) status = 'playing';
                    }

                    if (status !== 'offline') {
                        users.push({
                            uid: doc.id,
                            username: d.username || 'Usuario',
                            avatar: d.avatar,
                            status: status
                        });
                    }
                });
                app.state.globalUsers = users;
                app.renderGlobalUsersGrid();
            })
            .catch(e => console.error("Global Users Fetch Error:", e));
    },

    renderGlobalUsersGrid: () => {
        const grid = document.getElementById('community-grid');
        if (!grid) return;
        grid.innerHTML = '';
        if (!app.state.globalUsers || app.state.globalUsers.length === 0) {
            grid.innerHTML = '<p style="color:#777; width:100%;">No hay jugadores activos en este momento.</p>';
            return;
        }

        app.state.globalUsers.forEach(user => {
            let statusColor = '#28a745'; // Green for all active
            let statusText = 'Online';

            // Simplified status as requested: "sacalo de lo de estado de amigos" (assuming removing "Playing X")
            // Just show they are online/active.

            const card = document.createElement('div');
            card.className = 'friend-card';
            card.innerHTML = `
                <div style="position:relative;">
                    <img src="${user.avatar || 'https://ui-avatars.com/api/?name=?'}" style="width:50px; height:50px; border-radius:50%; object-fit:cover;">
                    <div style="width:12px; height:12px; background:${statusColor}; border-radius:50%; position:absolute; bottom:0; right:0; border:2px solid white;"></div>
                </div>
                <div>
                    <h4 style="margin:0; font-size:14px;">${user.username}</h4>
                    <span style="font-size:12px; color:#777;">${statusText}</span>
                </div>
            `;
            grid.appendChild(card);
        });
    },

    initGlobalUsers: () => {
        app.listenToGlobalUsers();
    },

    backupLocalSaves: (game) => { /* simplified for brevity as logic exists above implicitly usually or separate */ },

    arrayBufferToBase64: (buffer) => {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        const CHUNK_SIZE = 8192;
        for (let i = 0; i < len; i += CHUNK_SIZE) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK_SIZE, len)));
        }
        return window.btoa(binary);
    },

    base64ToBlob: (base64, mimeType = 'application/octet-stream') => {
        try {
            const cleanBase64 = base64.replace(/\s/g, '');
            const byteCharacters = atob(cleanBase64);
            const len = byteCharacters.length;
            const byteArray = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                byteArray[i] = byteCharacters.charCodeAt(i);
            }
            return new Blob([byteArray], { type: mimeType });
        } catch (e) { console.error("base64ToBlob failed", e); return null; }
    },

    blobToBase64: (blob) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const buffer = reader.result;
                let binary = '';
                const bytes = new Uint8Array(buffer);
                const len = bytes.byteLength;
                const CHUNK_SIZE = 8192;
                for (let i = 0; i < len; i += CHUNK_SIZE) {
                    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + CHUNK_SIZE, len)));
                }
                resolve(window.btoa(binary));
            };
            reader.onerror = reject;
            reader.readAsArrayBuffer(blob);
        });
    },

    uploadToGreenHost: async (blob, filename) => {
        const formData = new FormData();
        formData.append('file', blob, filename);
        const API_URL = "https://greenbase.arielcapdevila.com";
        try {
            const res = await fetch(`${API_URL}/upload`, { method: 'POST', body: formData });
            if (!res.ok) throw new Error(`GreenHost Upload status ${res.status}`);
            return await res.json();
        } catch (e) { console.error("GreenHost Upload Error:", e); throw e; }
    },

    downloadFromGreenHost: async (fileId) => {
        const API_URL = "https://greenbase.arielcapdevila.com";
        try {
            const res = await fetch(`${API_URL}/file/${fileId}`);
            if (!res.ok) throw new Error(`GreenHost Download status ${res.status}`);
            return await res.blob();
        } catch (e) { console.error("GreenHost Download Error:", e); throw e; }
    },
};

// SETTINGS SYSTEM
app.loadLocalSettings = () => {
    const stored = localStorage.getItem('appSettings');
    if (stored) {
        try { app.state.settings = { ...app.state.settings, ...JSON.parse(stored) }; } catch (e) { console.error("Settings parse error", e); }
    }
};

app.openSettings = () => {
    document.getElementById('user-dropdown').classList.remove('active');
    document.getElementById('settings-overlay').style.display = 'flex';
    const mins = (app.state.settings && app.state.settings.autoSaveMinutes) ? app.state.settings.autoSaveMinutes : 2;
    document.getElementById('autosave-slider').value = mins;
    document.getElementById('autosave-val').innerText = mins + ' min';

    // Private Mode
    const priv = (app.state.settings && app.state.settings.privateMode) ? true : false;
    document.getElementById('private-mode-check').checked = priv;

    const currentAvatar = (app.state.user && app.state.user.avatar) ? app.state.user.avatar : 'https://ui-avatars.com/api/?name=User';
    document.getElementById('settings-avatar-preview').src = currentAvatar;
};

app.closeSettings = () => {
    document.getElementById('settings-overlay').style.display = 'none';
    if (app.state.settings) app.state.settings.pendingAvatar = null;
};

app.handleAvatarUpload = (input) => {
    if (input.files.length === 0) return;
    const file = input.files[0];
    const reader = new FileReader();
    reader.onload = (e) => {
        const img = new Image();
        img.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = 100;
            canvas.height = 100;
            const ctx = canvas.getContext('2d');
            const minDim = Math.min(img.width, img.height);
            const sx = (img.width - minDim) / 2;
            const sy = (img.height - minDim) / 2;
            ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, 100, 100);
            const dataUrl = canvas.toDataURL('image/png');
            document.getElementById('settings-avatar-preview').src = dataUrl;
            app.state.settings.pendingAvatar = dataUrl;
        };
        img.src = e.target.result;
    };
    reader.readAsDataURL(file);
};

app.saveSettings = () => {
    const mins = parseInt(document.getElementById('autosave-slider').value);
    const priv = document.getElementById('private-mode-check').checked;

    if (!app.state.settings) app.state.settings = {};
    app.state.settings.autoSaveMinutes = mins;
    app.state.settings.privateMode = priv;

    if (app.state.settings.pendingAvatar) {
        const newAvatar = app.state.settings.pendingAvatar;
        if (app.state.user) {
            app.state.user.avatar = newAvatar;
            db.collection('users').doc(app.state.user.uid).update({ avatar: newAvatar })
                .then(() => app.showToast("Avatar actualizado"));
            app.updateHeaderAvatar(newAvatar);
        }
        app.state.settings.pendingAvatar = null;
    }

    localStorage.setItem('appSettings', JSON.stringify(app.state.settings));
    if (app.state.user) {
        db.collection('users').doc(app.state.user.uid).set({ settings: app.state.settings }, { merge: true });
    }

    // Reforce status update to reflect privacy change immediately
    app.updateUserStatus(app.state.isPlaying ? 'playing' : 'online', app.state.currentGame ? app.state.currentGame.title : null);

    app.showToast('<i class="fa-solid fa-check"></i> Ajustes Guardados');
    app.closeSettings();
};

app.updateHeaderAvatar = (url) => {
    const el = document.getElementById('header-user-avatar');
    if (el) el.src = url;
};

const originalInit = app.init;
app.init = () => {
    app.loadLocalSettings();
    originalInit();
};

window.onload = app.init;
