const firebaseConfig = {
    apiKey: "AIzaSyAOY2OVSlwGY3OmJk0nKxegqgSosOFkNCY",
    authDomain: "treechess-6b8fd.firebaseapp.com",
    projectId: "treechess-6b8fd",
    storageBucket: "treechess-6b8fd.firebasestorage.app",
    messagingSenderId: "884410017970",
    appId: "1:884410017970:web:ead71b37e856ac676b01ab",
    measurementId: "G-WPXXLMJ2B8"
};
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();

// --- CONFIGURATION INITIALE ---
const game = new Chess();
let board = null;
let nextNodeId = 1;
const pieceCache = {};
let currentBoardTheme = localStorage.getItem('boardTheme') || 'classic';
let currentPieceTheme = localStorage.getItem('pieceTheme') || 'wikipedia';
let shortcuts = {
    center: localStorage.getItem('shortcutCenter') || 'r',
    root: localStorage.getItem('shortcutRoot') || 'h',
    end: localStorage.getItem('shortcutEnd') || 'e',
    delete: localStorage.getItem('shortcutDelete') || 'd'
};

function normalizeShortcutValue(value) {
    if (!value) return '';
    return value.trim().toLowerCase();
}

function saveShortcut(key, value) {
    const normalized = normalizeShortcutValue(value).slice(0, 1);
    shortcuts[key] = normalized || shortcuts[key];
    localStorage.setItem(`shortcut${key.charAt(0).toUpperCase() + key.slice(1)}`, shortcuts[key]);
    updateShortcutInputs();
    updateShortcutHints();
}

function updateShortcutInputs() {
    const center = document.getElementById('shortcut-center');
    const root = document.getElementById('shortcut-root');
    const end = document.getElementById('shortcut-end');
    const del = document.getElementById('shortcut-delete');
    if (center) center.value = shortcuts.center.toUpperCase();
    if (root) root.value = shortcuts.root.toUpperCase();
    if (end) end.value = shortcuts.end.toUpperCase();
    if (del) del.value = shortcuts.delete.toUpperCase();
}

function updateShortcutHints() {
    const hintCenter = document.getElementById('hint-center');
    const hintRoot = document.getElementById('hint-root');
    const hintEnd = document.getElementById('hint-end');
    const hintDelete = document.getElementById('hint-delete');
    if (hintCenter) hintCenter.textContent = shortcuts.center.toUpperCase();
    if (hintRoot) hintRoot.textContent = shortcuts.root.toUpperCase();
    if (hintEnd) hintEnd.textContent = shortcuts.end.toUpperCase();
    if (hintDelete) hintDelete.textContent = shortcuts.delete.toUpperCase();
}

function loadShortcuts() {
    shortcuts.center = localStorage.getItem('shortcutCenter') || 'r';
    shortcuts.root = localStorage.getItem('shortcutRoot') || 'h';
    shortcuts.end = localStorage.getItem('shortcutEnd') || 'e';
    shortcuts.delete = localStorage.getItem('shortcutDelete') || 'd';
    updateShortcutInputs();
    updateShortcutHints();
}

// Structure de données de l'arbre
let treeData = {
    id: 0,
    name: "START",
    fen: game.fen(),
    children: [],
    parent: null
};
let currentNode = treeData;
let pendingPromotion = null;
let zoom = null;
let currentUser = null; // Pour suivre l'utilisateur connecté
let isSignUpMode = false; // Pour basculer entre Connexion et Inscription

// Paramètres D3
const margin = { top: 50, right: 150, bottom: 50, left: 150 };
let svg, g, treeLayout;

// --- MOTEUR DE RENDU ---

// Global error handler to show runtime errors in the UI and console
window.onerror = function(message, source, lineno, colno, error) {
    console.error('Unhandled error:', message, 'at', source + ':' + lineno + ':' + colno, error);
    try {
        const info = document.getElementById('user-info');
        if (info) {
            info.style.display = 'block';
            info.textContent = 'Erreur JS: ' + message + ' (voir console)';
        }
    } catch (e) {
        // ignore
    }
};

const validPieceThemes = ['wikipedia', 'alpha', 'uscf'];
const validBoardThemes = ['classic', 'blue', 'dark', 'forest', 'wood', 'cyber'];

async function preloadPieces(theme = currentPieceTheme) {
    if (!validPieceThemes.includes(theme)) theme = 'wikipedia';
    const pieces = [];
    ['w', 'b'].forEach(c => ['P', 'N', 'B', 'R', 'Q', 'K'].forEach(t => pieces.push(c + t)));
    await Promise.all(pieces.map(p => new Promise(resolve => {
        const img = new Image();
        img.src = getPieceThemeUrl(theme).replace('{piece}', p);
        img.crossOrigin = 'anonymous';
        img.onload = () => { pieceCache[p] = img; resolve(); };
        img.onerror = () => { pieceCache[p] = null; resolve(); };
    })));
}

function getBoardThemeColors(theme = currentBoardTheme) {
    switch (theme) {
        case 'blue': return { light: '#dbefff', dark: '#3c6aac' };
        case 'dark': return { light: '#6f6f6f', dark: '#2f2f2f' };
        case 'forest': return { light: '#d8e8d8', dark: '#527d53' };
        case 'wood': return { light: '#d2b48c', dark: '#8b5a2b' };
        case 'cyber': return { light: '#a3f7ff', dark: '#0e4d6d' };
        default: return { light: '#f0d9b5', dark: '#b58863' };
    }
}

function renderMiniBoard(canvasId, fen) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = 200;
    const ratio = window.devicePixelRatio || 1;

    canvas.style.width = size + 'px';
    canvas.style.height = size + 'px';
    canvas.width = Math.round(size * ratio);
    canvas.height = Math.round(size * ratio);

    if (typeof ctx.setTransform === 'function') {
        try { ctx.setTransform(1, 0, 0, 1, 0, 0); } catch (e) {}
    }
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const sq = canvas.width / 8;
    const { light, dark } = getBoardThemeColors(currentBoardTheme);

    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            ctx.fillStyle = (r + c) % 2 === 0 ? light : dark;
            ctx.fillRect(c * sq, r * sq, sq, sq);
        }
    }

    const rows = fen.split(' ')[0].split('/');
    rows.forEach((row, r) => {
        let c = 0;
        for (let char of row) {
            if (!isNaN(char)) {
                c += parseInt(char, 10);
            } else {
                const key = (char === char.toUpperCase() ? 'w' : 'b') + char.toUpperCase();
                const img = pieceCache[key];
                if (img) {
                    try {
                        ctx.drawImage(img, c * sq, r * sq, sq, sq);
                    } catch (e) {
                        // ignore drawing errors
                    }
                }
                c++;
            }
        }
    });
}

function updateVisualTree() {
    console.log('updateVisualTree called - treeData id:', treeData && treeData.id);
    const root = d3.hierarchy(treeData);
    treeLayout(root);

    // Lignes de connexion (Liens)
    const links = g.selectAll(".link").data(root.links(), d => d.target.data.id);
    
    links.enter().insert("path", "g") // Insérer avant les groupes de nœuds pour être "derrière"
        .attr("class", "link")
        .merge(links).transition().duration(400)
        .attr("d", d => {
            const s = { x: d.source.y + 80, y: d.source.x };
            const t = { x: d.target.y - 80, y: d.target.x };
            return `M${s.x},${s.y}C${(s.x + t.x) / 2},${s.y} ${(s.x + t.x) / 2},${t.y} ${t.x},${t.y}`;
        });
    links.exit().remove();

    // Nœuds (Plateaux)
    const nodes = g.selectAll(".node").data(root.descendants(), d => d.data.id);
    
    const nodeEnter = nodes.enter().append("g")
        .attr("class", "node")
        .attr("transform", d => `translate(${d.y},${d.x})`)
        .on("click", (e, d) => jumpToPosition(d.data));

    nodeEnter.append("foreignObject")
        .attr("width", 210).attr("height", 250).attr("x", -105).attr("y", -105)
        .append("xhtml:div").html(d => `
            <div style="text-align:center; cursor:pointer;">
                <canvas id="canvas-${d.data.id}" 
                        style="width:200px; height:200px; border-radius:6px; display:inline-block;"></canvas>
                <div style="color:white; font-weight:bold; margin-top:8px; font-size:16px; font-family: sans-serif;">${d.data.name}</div>
            </div>
        `);
    const nodeUpdate = nodeEnter.merge(nodes);
    nodeUpdate.transition().duration(400).attr("transform", d => `translate(${d.y},${d.x})`);

    // Mise en évidence et bordures
    nodeUpdate.select("canvas")
        .style("border", d => d.data.id === currentNode.id ? "5px solid #3498db" : "5px solid transparent")
        .style("box-shadow", d => d.data.id === currentNode.id ? "0 0 25px rgba(52, 152, 219, 0.7)" : "0 4px 10px rgba(0,0,0,0.5)");

    setTimeout(() => {
        root.descendants().forEach(d => renderMiniBoard(`canvas-${d.data.id}`, d.data.fen));
    }, 50);

    nodes.exit().remove();
    updateOpeningName(currentNode.fen);
}

function setParents(node, parent = null) {
    node.parent = parent;
    node.children.forEach(child => setParents(child, node));
}

function findNodeById(node, id) {
    if (node.id === id) return node;
    for (const child of node.children) {
        const result = findNodeById(child, id);
        if (result) return result;
    }
    return null;
}

function serializeTree(node) {
    return {
        id: node.id,
        name: node.name,
        fen: node.fen,
        children: node.children.map(child => serializeTree(child))
    };
}

function deserializeTree(node, parentNode = null) {
    let restoredNode = {
        id: node.id,
        name: node.name,
        fen: node.fen,
        children: [],
        parent: parentNode
    };
    if (node.children) {
        restoredNode.children = node.children.map(child => deserializeTree(child, restoredNode));
    }
    return restoredNode;
}

function triggerAutoSave() {
    if (!currentUser) return;
    const cleanedTree = serializeTree(treeData);
    db.collection('users').doc(currentUser.uid).set({
        chessTree: cleanedTree,
        currentId: currentNode.id,
        nextNodeId: nextNodeId
    }, { merge: true });
}

// --- FONCTION DE RÉCUPÉRATION DE L'OUVERTURE (ROBUSTE ET MISE EN CACHE) ---
const openingCache = {};
let openingFetchTimeout = null;

function updateOpeningName(fen) {
    const target = document.getElementById('opening-name');
    if (!target) return;

    if (!fen || fen.startsWith("rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR")) {
        target.textContent = "Position de départ";
        return;
    }

    // 1. On coupe le FEN pour ne garder que les 4 premières informations (Position, Trait, Roque, En passant).
    // Les compteurs de coups à la fin (parties 5 et 6) causent souvent des erreurs avec l'API.
    const parts = fen.split(' ');
    const cleanFen = parts.slice(0, 4).join(' ');

    // 2. Si on a déjà cherché cette position, on affiche le résultat instantanément
    if (openingCache[cleanFen]) {
        target.textContent = openingCache[cleanFen];
        return;
    }

    // 3. Anti-spam (Debounce) : on attend 300ms. Si la fonction est rappelée entre-temps, 
    // le timer repart à zéro. Cela évite l'Erreur HTTP 429 de Lichess.
    clearTimeout(openingFetchTimeout);
    openingFetchTimeout = setTimeout(() => {
        const encodedFen = encodeURIComponent(cleanFen);
        
        fetch(`https://explorer.lichess.ovh/lichess?variant=standard&fen=${encodedFen}`)
            .then(response => {
                if (!response.ok) throw new Error(`HTTP ${response.status}`);
                return response.json();
            })
            .then(data => {
                if (data.opening && data.opening.name) {
                    openingCache[cleanFen] = data.opening.name;
                    target.textContent = data.opening.name;
                } else {
                    openingCache[cleanFen] = "Position personnalisée / Variante inconnue";
                    target.textContent = openingCache[cleanFen];
                }
            })
            .catch(err => {
                console.error("Erreur Explorer Lichess :", err);
                // Affiche le code d'erreur exact sur l'interface (ex: Erreur API (HTTP 429))
                target.textContent = `Erreur API (${err.message})`;
            });
    }, 300);
}

// --- SUITE DU RENDU ET THEMES ---
function getPieceThemeUrl(theme) {
    if (!validPieceThemes.includes(theme)) theme = 'wikipedia';
    return `https://unpkg.com/chessboardjs@0.0.1/www/img/chesspieces/${theme}/{piece}.png`;
}

function applyBoardTheme(theme) {
    const boardEl = document.getElementById('board');
    if (!boardEl) return;
    boardEl.classList.remove(...validBoardThemes);
    boardEl.classList.add(theme);
}

async function initializeBoard(theme, pieceTheme) {
    theme = theme || localStorage.getItem('boardTheme') || 'classic';
    pieceTheme = pieceTheme || localStorage.getItem('pieceTheme') || 'wikipedia';
    if (!validBoardThemes.includes(theme)) theme = 'classic';
    if (!validPieceThemes.includes(pieceTheme)) pieceTheme = 'wikipedia';

    currentBoardTheme = theme;
    currentPieceTheme = pieceTheme;
    localStorage.setItem('boardTheme', theme);
    localStorage.setItem('pieceTheme', pieceTheme);

    applyBoardTheme(theme);
    await preloadPieces(pieceTheme);

    if (board && typeof board.destroy === 'function') {
        board.destroy();
    }
    board = ChessBoard('board', {
        draggable: true,
        position: currentNode.fen,
        onDrop: onDrop,
        onSnapEnd: () => board.position(game.fen()),
        pieceTheme: getPieceThemeUrl(pieceTheme)
    });
    const boardSelect = document.getElementById('board-theme-select');
    const pieceSelect = document.getElementById('piece-theme-select');
    if (boardSelect) boardSelect.value = theme;
    if (pieceSelect) pieceSelect.value = pieceTheme;

    updateVisualTree();
}

function setBoardTheme(theme) {
    localStorage.setItem('boardTheme', theme);
    initializeBoard(theme, currentPieceTheme);
}

function setPieceTheme(theme) {
    localStorage.setItem('pieceTheme', theme);
    initializeBoard(currentBoardTheme, theme);
}

function getSavedTreesLocal() {
    return JSON.parse(localStorage.getItem('savedTrees') || '{}');
}

function setSavedTreesLocal(saves) {
    localStorage.setItem('savedTrees', JSON.stringify(saves));
}

function setSaveStatus(message, isError = false) {
    const status = document.getElementById('save-status');
    if (!status) return;
    status.textContent = message;
    status.style.color = isError ? '#e74c3c' : '#a0a0a0';
}

function renderSaveList() {
    const container = document.getElementById('save-list');
    if (!container) return;
    const localSaved = getSavedTreesLocal();
    const saves = [];
    for (const [id, payload] of Object.entries(localSaved)) {
        saves.push({ id, storage: 'local', name: payload.name, timestamp: payload.timestamp });
    }
    if (currentUser) {
        db.collection('users').doc(currentUser.uid).get().then(doc => {
            const payload = doc.exists ? doc.data() : null;
            const firebaseSaved = (payload && payload.savedTrees) || {};
            for (const [id, entry] of Object.entries(firebaseSaved)) {
                saves.push({ id, storage: 'firebase', name: entry.name, timestamp: entry.timestamp });
            }
            renderSaveRows(container, saves);
        }).catch(err => {
            console.error('Erreur lecture sauvegardes cloud', err);
            renderSaveRows(container, saves);
        });
    } else {
        renderSaveRows(container, saves);
    }
}

function renderSaveRows(container, saves) {
    container.innerHTML = '';
    if (saves.length === 0) {
        const emptyRow = document.createElement('div');
        emptyRow.className = 'save-status';
        emptyRow.textContent = 'Aucune sauvegarde disponible.';
        container.appendChild(emptyRow);
        return;
    }
    saves.sort((a, b) => b.timestamp - a.timestamp);
    for (const save of saves) {
        const row = document.createElement('div');
        row.className = 'save-row';
        row.innerHTML = `
            <div class="save-meta">
                <strong>${save.name}</strong>
                <span>${save.storage === 'firebase' ? 'Cloud' : 'Local'} · ${new Date(save.timestamp).toLocaleString()}</span>
            </div>
            <div style="display:flex;gap:8px;">
                <button class="btn btn-sm btn-primary load-save-btn">Charger</button>
                <button class="btn btn-sm btn-danger delete-save-btn">Suppr</button>
            </div>
        `;
        const loadButton = row.querySelector('.load-save-btn');
        const deleteButton = row.querySelector('.delete-save-btn');
        loadButton.dataset.id = save.id;
        loadButton.dataset.storage = save.storage;
        deleteButton.dataset.id = save.id;
        deleteButton.dataset.storage = save.storage;
        loadButton.addEventListener('click', () => loadSaved(save.id, save.storage));
        deleteButton.addEventListener('click', () => deleteSaved(save.id, save.storage));
        container.appendChild(row);
    }
}

function updateSaveButtons() {
    const firebaseBtn = document.getElementById('save-firebase-btn');
    if (!firebaseBtn) return;
    if (currentUser) {
        firebaseBtn.disabled = false;
        firebaseBtn.textContent = 'Sauvegarder cloud';
    } else {
        firebaseBtn.disabled = true;
        firebaseBtn.textContent = 'Cloud (connexion requise)';
    }
}

function saveSnapshot(storageType = 'local') {
    const input = document.getElementById('save-name');
    if (!input) return;
    const name = input.value.trim();
    if (!name) {
        setSaveStatus('Veuillez saisir un nom de sauvegarde.', true);
        return;
    }
    const payload = {
        name,
        timestamp: Date.now(),
        tree: serializeTree(treeData),
        currentId: currentNode.id,
        nextNodeId: nextNodeId
    };
    const id = 'save-' + Date.now();
    if (storageType === 'firebase') {
        if (!currentUser) {
            setSaveStatus('Connectez-vous pour sauvegarder dans le cloud.', true);
            return;
        }
        db.collection('users').doc(currentUser.uid).get().then(doc => {
            const userData = doc.exists ? doc.data() : {};
            const savedTrees = Object.assign({}, userData.savedTrees || {}, { [id]: payload });
            return db.collection('users').doc(currentUser.uid).set({ savedTrees }, { merge: true });
        }).then(() => {
            setSaveStatus('Sauvegarde cloud créée.');
            renderSaveList();
        }).catch(err => {
            console.error('Erreur sauvegarde cloud', err);
            setSaveStatus(`Erreur cloud: ${err.code || err.message || err}`, true);
        });
    } else {
        const saved = getSavedTreesLocal();
        saved[id] = payload;
        setSavedTreesLocal(saved);
        setSaveStatus('Sauvegarde locale créée.');
        renderSaveList();
    }
}

function loadSaved(id, storageType = 'local') {
    if (!id) return;
    if (storageType === 'firebase') {
        if (!currentUser) {
            setSaveStatus('Connexion requise pour charger depuis le cloud.', true);
            return;
        }
        db.collection('users').doc(currentUser.uid).get().then(doc => {
            const payload = doc.exists ? doc.data() : null;
            const saves = (payload && payload.savedTrees) || {};
            const savePayload = saves[id];
            if (!savePayload) {
                setSaveStatus('Sauvegarde introuvable dans le cloud.', true);
                return;
            }
            applyLoadedSnapshot(savePayload);
            setSaveStatus('Sauvegarde cloud chargée.');
        }).catch(err => {
            console.error('Erreur chargement cloud', err);
            setSaveStatus(`Erreur cloud: ${err.code || err.message || err}`, true);
        });
    } else {
        const saved = getSavedTreesLocal();
        const payload = saved[id];
        if (!payload) {
            setSaveStatus('Sauvegarde locale introuvable.', true);
            return;
        }
        applyLoadedSnapshot(payload);
        setSaveStatus('Sauvegarde locale chargée.');
    }
}

function deleteSaved(id, storageType = 'local') {
    if (!id) return;
    if (storageType === 'firebase') {
        if (!currentUser) {
            setSaveStatus('Connexion requise pour supprimer dans le cloud.', true);
            return;
        }
        db.collection('users').doc(currentUser.uid).get().then(doc => {
            const payload = doc.exists ? doc.data() : null;
            const savedTrees = Object.assign({}, (payload && payload.savedTrees) || {});
            delete savedTrees[id];
            return db.collection('users').doc(currentUser.uid).set({ savedTrees }, { merge: true });
        }).then(() => {
            setSaveStatus('Sauvegarde cloud supprimée.');
            renderSaveList();
        }).catch(err => {
            console.error('Erreur suppression cloud', err);
            setSaveStatus(`Erreur cloud: ${err.code || err.message || err}`, true);
        });
    } else {
        const saved = getSavedTreesLocal();
        delete saved[id];
        setSavedTreesLocal(saved);
        setSaveStatus('Sauvegarde locale supprimée.');
        renderSaveList();
    }
}

function applyLoadedSnapshot(payload) {
    treeData = deserializeTree(payload.tree);
    nextNodeId = payload.nextNodeId || 1;
    currentNode = findNodeById(treeData, payload.currentId) || treeData;
    game.load(currentNode.fen);
    if (board) board.position(currentNode.fen);
    updateVisualTree();
    centerOnCurrentNode();
}

function resetTreeToDefault() {
    game.reset();
    const startingFen = game.fen();
    treeData = { id: 0, name: "START", fen: startingFen, children: [], parent: null };
    currentNode = treeData;
    nextNodeId = 1;
    if (board) board.position(startingFen);
    updateVisualTree();
    const openingLabel = document.getElementById('opening-name');
    if (openingLabel) openingLabel.textContent = 'Position de départ';
    triggerAutoSave();
}

function getDeepestLeaf(node) {
    let current = node;
    while (current.children.length > 0) {
        current = current.children[0];
    }
    return current;
}

function centerOnCurrentNode() {
    if (!svg || !zoom || !currentNode) return;

    const root = d3.hierarchy(treeData);
    treeLayout(root);
    const nodeDatum = root.descendants().find(d => d.data.id === currentNode.id);
    if (!nodeDatum) return;

    const container = document.getElementById('tree-container');
    if (!container) return;

    const width = container.clientWidth;
    const height = container.clientHeight;
    const targetScale = 1.2;
    const x = width / 2 - nodeDatum.y * targetScale;
    const y = height / 2 - nodeDatum.x * targetScale;

    svg.transition().duration(400).call(zoom.transform, d3.zoomIdentity.translate(x, y).scale(targetScale));
}

function addMoveNode(move) {
    const existing = currentNode.children.find(c => c.name === move.san);
    if (!existing) {
        const newNode = {
            id: nextNodeId++,
            name: move.san,
            fen: game.fen(),
            children: [],
            parent: currentNode
        };
        currentNode.children.push(newNode);
        currentNode = newNode;
    } else {
        currentNode = existing;
    }
    updateVisualTree();
    triggerAutoSave();
}

function showPromotionModal(source, target) {
    pendingPromotion = { source, target };
    $('#promotion-modal').show();
}

function hidePromotionModal() {
    $('#promotion-modal').hide();
    pendingPromotion = null;
}

function choosePromotion(piece) {
    if (!pendingPromotion) return;
    const { source, target } = pendingPromotion;
    const move = game.move({ from: source, to: target, promotion: piece });
    if (move) {
        addMoveNode(move);
        board.position(game.fen());
        updateVisualTree();
    }
    hidePromotionModal();
}

// --- LOGIQUE DE JEU & NAVIGATION ---

function jumpToPosition(node) {
    currentNode = node;
    game.load(node.fen);
    board.position(node.fen);
    updateVisualTree();
    triggerAutoSave();
}

function onDrop(source, target) {
    const piece = game.get(source);
    if (piece && piece.type === 'p' && (target[1] === '8' || target[1] === '1')) {
        showPromotionModal(source, target);
        return 'snapback';
    }

    const move = game.move({ from: source, to: target, promotion: 'q' });
    if (!move) return 'snapback';
    addMoveNode(move);
}

function deleteCurrentBranch() {
    if (currentNode === treeData) return;
    const parent = currentNode.parent;
    if (!parent) return;
    parent.children = parent.children.filter(child => child.id !== currentNode.id);
    currentNode = parent;
    game.load(currentNode.fen);
    board.position(currentNode.fen);
    updateVisualTree();
    triggerAutoSave();
}

function goToRoot() {
    jumpToPosition(treeData);
    centerOnCurrentNode();
}

function goToEnd() {
    const endNode = getDeepestLeaf(currentNode);
    jumpToPosition(endNode);
    centerOnCurrentNode();
}

// --- INITIALISATION ---

$(document).ready(async function() {
    console.log('document.ready start');
    await preloadPieces();
    console.log('pieces preloaded');

    // 1. Initialiser Chessboard.js
    initializeBoard();
    console.log('chessboard initialized');
    loadShortcuts();

    // 1b. Theme selectors
    $('#board-theme-select').change(function() {
        setBoardTheme($(this).val());
    });
    $('#piece-theme-select').change(function() {
        setPieceTheme($(this).val());
    });
    $('#shortcut-center').on('input', function() {
        saveShortcut('center', $(this).val());
    });
    $('#shortcut-root').on('input', function() {
        saveShortcut('root', $(this).val());
    });
    $('#shortcut-end').on('input', function() {
        saveShortcut('end', $(this).val());
    });
    $('#shortcut-delete').on('input', function() {
        saveShortcut('delete', $(this).val());
    });
    $('#settings-btn').click(function() {
        $('#settings-panel').toggleClass('hidden');
    });

    // 2. Initialiser D3.js
    zoom = d3.zoom().scaleExtent([0.1, 2]).on("zoom", (e) => g.attr("transform", e.transform));
    svg = d3.select("#tree-container").append("svg")
        .attr("width", "100%")
        .attr("height", "100%")
        .call(zoom);

    g = svg.append("g").attr("transform", `translate(${margin.left}, ${window.innerHeight / 2})`);
    treeLayout = d3.tree().nodeSize([280, 450]);
    console.log('d3 initialized, svg/g/treeLayout ready');

    // 3. Évènements
    $('#reset-btn').click(resetTreeToDefault);
    $('#center-btn').click(centerOnCurrentNode);
    $('#root-btn').click(goToRoot);
    $('#end-btn').click(goToEnd);
    $('#delete-btn').click(deleteCurrentBranch);
    $('#promotion-modal .promo-buttons button').click(function() {
        choosePromotion($(this).data('piece'));
    });
    $('#promo-cancel').click(hidePromotionModal);

    $('#save-local-btn').click(() => saveSnapshot('local'));
    $('#save-firebase-btn').click(() => saveSnapshot('firebase'));

    // Ouverture / Fermeture modale
    const authModal = $('#auth-modal');
    $(document).on('click', '#auth-btn', function(e) {
        e.preventDefault();
        if (currentUser) { auth.signOut(); } else { authModal.css('display', 'flex'); }
    });
    $(document).on('click', '.close-modal', function() { authModal.hide(); });

    $('#toggle-auth-mode').click(function() {
        isSignUpMode = !isSignUpMode;
        $('#modal-title').text(isSignUpMode ? 'Inscription' : 'Connexion');
        $('#submit-auth-btn').text(isSignUpMode ? 'S\'inscrire' : 'Se connecter');
        $('#toggle-auth-mode span').text(isSignUpMode ? 'Connectez-vous ici' : 'Créez-en un ici');
    });

    $('#auth-form').submit(function(e) {
        e.preventDefault();
        const email = $('#auth-email').val();
        const password = $('#auth-password').val();
        if (isSignUpMode) {
            auth.createUserWithEmailAndPassword(email, password).then(() => authModal.hide()).catch(err => alert(err.message));
        } else {
            auth.signInWithEmailAndPassword(email, password).then(() => authModal.hide()).catch(err => alert(err.message));
        }
    });

    loadShortcuts();
    auth.onAuthStateChanged(user => {
        if (user) {
            currentUser = user;
            $('#user-info').text(user.email).show();
            $('#auth-btn').text("Déconnexion").removeClass("btn-primary").addClass("btn-danger");
            db.collection('users').doc(user.uid).get().then(doc => {
                const data = doc.exists ? doc.data() : null;
                if (data && data.chessTree) {
                    treeData = deserializeTree(data.chessTree);
                    nextNodeId = data.nextNodeId || 1;
                    currentNode = findNodeById(treeData, data.currentId) || treeData;
                    game.load(currentNode.fen);
                    board.position(currentNode.fen);
                }
                updateVisualTree();
                updateSaveButtons();
                renderSaveList();
            }).catch(err => {
                console.error('Erreur lecture tableau cloud', err);
                setSaveStatus(`Erreur cloud: ${err.code || err.message || err}`, true);
                updateVisualTree();
                updateSaveButtons();
                renderSaveList();
            });
        } else {
            currentUser = null;
            $('#user-info').hide();
            $('#auth-btn').text("Connexion / Inscription").removeClass("btn-danger").addClass("btn-primary");
            resetTreeToDefault();
            updateSaveButtons();
            renderSaveList();
        }
    });

    $(document).keydown(e => {
        if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
        const key = e.key.toLowerCase();
        if (key === 'arrowleft' && currentNode.parent) {
            jumpToPosition(currentNode.parent);
            return;
        }
        if (key === 'arrowright' && currentNode.children.length > 0) {
            jumpToPosition(currentNode.children[0]);
            return;
        }
        if (key === shortcuts.center) {
            centerOnCurrentNode();
            return;
        }
        if (key === shortcuts.root) {
            goToRoot();
            return;
        }
        if (key === shortcuts.end) {
            goToEnd();
            return;
        }
        if (key === shortcuts.delete) {
            deleteCurrentBranch();
            return;
        }
    });

    updateSaveButtons();
    renderSaveList();
    updateVisualTree();
});