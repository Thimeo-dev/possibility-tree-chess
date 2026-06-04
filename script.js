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
let currentUser = null; //  Pour suivre l'utilisateur connecté
let isSignUpMode = false; //  Pour basculer entre Connexion et Inscription = {};
let hideTreeBorder = localStorage.getItem('hideTreeBorder') === 'true';
let hideTreeGlow = localStorage.getItem('hideTreeGlow') === 'true';
let selectedEdgeTargetId = null;
let autoCenterAfterMove = true;

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
        const toggleBorderBtn = document.getElementById('toggle-border-btn');
        if (toggleBorderBtn) {
            toggleBorderBtn.textContent = hideTreeBorder ? 'Afficher contour' : 'Masquer contour';
            toggleBorderBtn.addEventListener('click', () => {
                hideTreeBorder = !hideTreeBorder;
                localStorage.setItem('hideTreeBorder', hideTreeBorder);
                toggleBorderBtn.textContent = hideTreeBorder ? 'Afficher contour' : 'Masquer contour';
                updateVisualTree();
            });
        }
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

function renderMiniBoardImage(imageId, fen) {
    const image = document.getElementById(imageId);
    if (!image) return;

    const size = 200;
    const ratio = window.devicePixelRatio || 1;
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');

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
        for (const char of row) {
            if (!isNaN(char)) {
                c += parseInt(char, 10);
            } else {
                const key = (char === char.toUpperCase() ? 'w' : 'b') + char.toUpperCase();
                const piece = pieceCache[key];
                if (piece && piece.complete) {
                    try {
                        ctx.drawImage(piece, c * sq, r * sq, sq, sq);
                    } catch (e) {
                        // ignore drawing errors
                    }
                }
                c++;
            }
        }
    });

    image.width = size;
    image.height = size;
    image.src = canvas.toDataURL('image/png');
}

function updateVisualTree() {
    console.log('updateVisualTree called - treeData id:', treeData && treeData.id);
    const root = d3.hierarchy(treeData);
    treeLayout(root);

    // Lignes de connexion (Liens)
    const links = g.selectAll(".link").data(root.links(), d => d.target.data.id);
    const hitLinks = g.selectAll(".link-hit").data(root.links(), d => d.target.data.id);

    const computeLinkPath = d => {
        const s = { x: d.source.y + 80, y: d.source.x };
        const t = { x: d.target.y - 80, y: d.target.x };
        return `M${s.x},${s.y}C${(s.x + t.x) / 2},${s.y} ${(s.x + t.x) / 2},${t.y} ${t.x},${t.y}`;
    };

    hitLinks.enter().insert("path", "g")
        .attr("class", "link-hit")
        .merge(hitLinks)
        .attr("id", d => `link-hit-${d.target.data.id}`)
        .attr("d", computeLinkPath)
        .on('click', (e, d) => {
            e.stopPropagation();
            selectedEdgeTargetId = d.target.data.id;
            openEdgeNoteForNode(d.target.data.id);
            updateVisualTree();
        });
    hitLinks.exit().remove();

    links.enter().insert("path", "g") // Insérer avant les groupes de nœuds pour être "derrière"
        .attr("class", "link")
        .attr("id", d => `link-${d.target.data.id}`)
        .merge(links).transition().duration(400)
        .attr("d", computeLinkPath)
        .style('stroke', d => selectedEdgeTargetId === d.target.data.id ? '#3498db' : '#444')
        .style('stroke-width', d => selectedEdgeTargetId === d.target.data.id ? 5 : 3)
        .style('opacity', 0.9)
        .style('pointer-events', 'none');
    links.exit().remove();

    // Link labels (text on branches)
    const labels = g.selectAll('.link-label').data(root.links(), d => d.target.data.id);
    labels.enter().append('text').attr('class', 'link-label')
        .merge(labels)
        .attr('text-anchor', 'middle')
        .style('fill', '#d0d0d0')
        .style('font-size', '12px')
        .style('pointer-events', 'none')
        .text(d => d.target.data.edgeNote || '')
        .attr('x', d => {
            const s = { x: d.source.y + 80, y: d.source.x };
            const t = { x: d.target.y - 80, y: d.target.x };
            return (s.x + t.x) / 2;
        })
        .attr('y', d => {
            const s = { x: d.source.y + 80, y: d.source.x };
            const t = { x: d.target.y - 80, y: d.target.x };
            const dx = t.x - s.x;
            const dy = t.y - s.y;
            const L = Math.sqrt(dx * dx + dy * dy) || 1;
            const nx = -dy / L;
            const ny = dx / L;
            const offset = 12;
            return (s.y + t.y) / 2 + ny * offset;
        });
    labels.exit().remove();

    // Nœuds (Plateaux)
    const nodes = g.selectAll(".node").data(root.descendants(), d => d.data.id);
    
    const nodeEnter = nodes.enter().append("g")
        .attr("class", "node")
        .attr("transform", d => `translate(${d.y},${d.x})`)
        .on("click", (e, d) => jumpToPosition(d.data));

    nodeEnter.append("foreignObject")
        .attr("width", 210).attr("height", 320).attr("x", -105).attr("y", -120)
        .append("xhtml:div").html(d => `
            <div style="text-align:center; cursor:pointer;">
                <img id="image-${d.data.id}"
                     class="tree-board-image"
                     src=""
                     alt="Plateau ${d.data.name}"
                     style="width:200px; height:200px; border-radius:6px; display:inline-block; object-fit:cover;" />
                <div style="color:white; font-weight:bold; margin-top:8px; font-size:16px; font-family: sans-serif;">${d.data.name}</div>
                <div class="node-note" style="color:#d0d0d0; font-size:12px; margin-top:6px; max-width:200px;">${d.data.note ? d.data.note : ''}</div>
                ${d.data.id !== 0 ? `<div class="node-edge-note-text" onclick="event.stopPropagation(); openEdgeNoteForNode(${d.data.id})"></div>` : ''}
            </div>
        `);
    const nodeUpdate = nodeEnter.merge(nodes);
    nodeUpdate.transition().duration(400).attr("transform", d => `translate(${d.y},${d.x})`);

    // Mise en évidence, bordures et lueur
    nodeUpdate.select("img")
        .style("border", d => {
            if (hideTreeBorder) return "5px solid transparent";
            return d.data.id === currentNode.id ? "5px solid #3498db" : "5px solid transparent";
        })
        .style("box-shadow", d => {
            if (hideTreeGlow) return "none";
            return d.data.id === currentNode.id ? "0 0 25px rgba(52, 152, 219, 0.7)" : "0 4px 10px rgba(0,0,0,0.5)";
        });

    // Update note text for existing nodes
    nodeUpdate.select('.node-note').text(d => d.data.note || '');

    setTimeout(() => {
        root.descendants().forEach(d => renderMiniBoardImage(`image-${d.data.id}`, d.data.fen));
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
        note: node.note || '',
        edgeNote: node.edgeNote || '',
        fen: node.fen,
        children: node.children.map(child => serializeTree(child))
    };
}

function deserializeTree(node, parentNode = null) {
    let restoredNode = {
        id: node.id,
        name: node.name,
        note: node.note || '',
        edgeNote: node.edgeNote || '',
        fen: node.fen,
        children: [],
        parent: parentNode
    };
    if (node.children) {
        restoredNode.children = node.children.map(child => deserializeTree(child, restoredNode));
    }
    return restoredNode;
}

let ecoOpenings = null;
let ecoOpeningsByPosition = null;

function triggerAutoSave() {
    if (!currentUser) return;
    const cleanedTree = serializeTree(treeData);
    db.collection('users').doc(currentUser.uid).set({
        chessTree: cleanedTree,
        currentId: currentNode.id,
        nextNodeId: nextNodeId
    }, { merge: true });
}

function openEdgeNoteForNode(nodeId) {
    selectedEdgeTargetId = nodeId;
    const targetNode = findNodeById(treeData, nodeId);
    if (!targetNode) return;
    const modal = document.getElementById('edge-note-modal');
    const ta = document.getElementById('edge-note-text');
    if (!modal || !ta) return;
    ta.value = targetNode.edgeNote || '';
    modal.style.display = 'flex';
    ta.focus();
}

function normalizeEcoFen(fen) {
    const parts = fen.split(' ');
    if (parts.length < 4) return fen;
    const [pieces, turn, castling] = parts;
    return `${pieces} ${turn} ${castling} -`;
}

async function loadEcoOpenings() {
    const files = ['ecoA.json', 'ecoB.json', 'ecoC.json', 'ecoD.json', 'ecoE.json', 'eco_interpolated.json'];
    const allOpenings = {};
    await Promise.all(files.map(async file => {
        const response = await fetch(file);
        if (!response.ok) throw new Error(`Impossible de charger ${file}`);
        const data = await response.json();
        Object.assign(allOpenings, data);
    }));
    ecoOpenings = allOpenings;
    ecoOpeningsByPosition = {};
    for (const [key, value] of Object.entries(allOpenings)) {
        const normalized = normalizeEcoFen(key);
        if (!(normalized in ecoOpeningsByPosition)) {
            ecoOpeningsByPosition[normalized] = value;
        }
    }
}

function getEcoEntryLabel(entry) {
    if (!entry) return null;
    if (entry.name) return entry.name;
    if (entry.aliases && entry.aliases.scid) return entry.aliases.scid;
    if (entry.moves) return entry.moves;
    return 'Ouverture inconnue';
}

function getOpeningNameFromFen(fen) {
    if (!ecoOpenings) return null;
    const entry = ecoOpenings[fen] || ecoOpenings[`${fen.split(' ').slice(0, 3).join(' ')} -`];
    if (entry) {
        return getEcoEntryLabel(entry);
    }
    const normalized = normalizeEcoFen(fen);
    const fallback = ecoOpeningsByPosition ? ecoOpeningsByPosition[normalized] : null;
    if (fallback) {
        return getEcoEntryLabel(fallback);
    }
    return null;
}

async function updateOpeningName(fen) {
    const target = document.getElementById('opening-name');
    if (!target) return;
    
    // Essayer d'abord l'API Lichess (public, sans token requis)
    try {
        target.textContent = 'Recherche ouverture...';
        const fenToQuery = fen || game.fen();
        const response = await fetch(`https://explorer.lichess.org/masters?fen=${encodeURIComponent(fenToQuery)}`);
        if (response.ok) {
            const data = await response.json();
            if (data.opening && data.opening.name) {
                const eco = data.opening.eco || '';
                target.textContent = eco ? `${eco} - ${data.opening.name}` : data.opening.name;
                return;
            }
        }
    } catch (err) {
        // Silencieux, on utilise le fallback JSON
        console.debug('Lichess API unavailable, using local data');
    }
    
    // Fallback : utiliser les données JSON locales
    if (ecoOpenings) {
        const opening = getOpeningNameFromFen(fen || game.fen());
        target.textContent = opening || 'Ouverture inconnue';
    } else {
        target.textContent = 'Chargement des ouvertures...';
    }
}

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
    if (openingLabel) openingLabel.textContent = 'Nouvelle analyse';
    triggerAutoSave();
}

function toggleAutoCenterAfterMove() {
    autoCenterAfterMove = !autoCenterAfterMove;
    const btn = document.getElementById('auto-center-btn');
    if (btn) {
        btn.textContent = autoCenterAfterMove ? 'Auto-recentrage : ON' : 'Auto-recentrage : OFF';
        btn.style.backgroundColor = autoCenterAfterMove ? '' : '#555';
    }
}

function updateAutoCenterButton() {
    const btn = document.getElementById('auto-center-btn');
    if (!btn) return;
    btn.textContent = autoCenterAfterMove ? 'Auto-recentrage : ON' : 'Auto-recentrage : OFF';
    btn.style.backgroundColor = autoCenterAfterMove ? '' : '#555';
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
            parent: currentNode,
            note: '',
            edgeNote: ''
        };
        currentNode.children.push(newNode);
        currentNode = newNode;
    } else {
        currentNode = existing;
    }
    updateVisualTree();
    if (autoCenterAfterMove) {
        centerOnCurrentNode();
    }
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
    triggerAutoSave();
    // Populate note editor
    try {
        const ta = document.getElementById('node-note');
        if (ta) ta.value = currentNode.note || '';
    } catch (e) {}
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
    await loadEcoOpenings().catch(err => {
        console.error('Erreur chargement ECO JSON', err);
        const target = document.getElementById('opening-name');
        if (target) target.textContent = 'Erreur chargement ouvertures';
    });

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
    $('#auto-center-btn').click(toggleAutoCenterAfterMove);
    $('#center-btn').click(centerOnCurrentNode);
    $('#root-btn').click(goToRoot);
    $('#end-btn').click(goToEnd);
    $('#delete-btn').click(deleteCurrentBranch);
    $('#toggle-border-btn').click(() => {
        hideTreeBorder = !hideTreeBorder;
        localStorage.setItem('hideTreeBorder', hideTreeBorder);
        document.getElementById('toggle-border-btn').textContent = hideTreeBorder ? 'Afficher contour' : 'Masquer contour';
        updateVisualTree();
    });
    $('#toggle-glow-btn').click(() => {
        hideTreeGlow = !hideTreeGlow;
        localStorage.setItem('hideTreeGlow', hideTreeGlow);
        document.getElementById('toggle-glow-btn').textContent = hideTreeGlow ? 'Afficher lueur' : 'Masquer lueur';
        updateVisualTree();
    });
    // set initial labels
    if (document.getElementById('toggle-glow-btn')) document.getElementById('toggle-glow-btn').textContent = hideTreeGlow ? 'Afficher lueur' : 'Masquer lueur';
    $('#promotion-modal .promo-buttons button').click(function() {
        choosePromotion($(this).data('piece'));
    });
    $('#promo-cancel').click(hidePromotionModal);

    $('#save-local-btn').click(() => saveSnapshot('local'));
    updateAutoCenterButton();
    $('#save-firebase-btn').click(() => saveSnapshot('firebase'));

    // Modal save/cancel handlers
    $('#edge-note-save').click(() => {
        if (!selectedEdgeTargetId) return;
        const targetNode = findNodeById(treeData, selectedEdgeTargetId);
        if (!targetNode) return;
        const ta = document.getElementById('edge-note-text');
        targetNode.edgeNote = ta ? ta.value : '';
        document.getElementById('edge-note-modal').style.display = 'none';
        updateVisualTree();
        triggerAutoSave();
    });
    $('#edge-note-cancel').click(() => {
        document.getElementById('edge-note-modal').style.display = 'none';
    });

    // Notes UI
    $('#save-note-btn').click(() => {
        const ta = document.getElementById('node-note');
        if (!ta) return;
        if (!currentNode) return alert('Aucun nœud sélectionné');
        currentNode.note = ta.value;
        updateVisualTree();
        triggerAutoSave();
    });
    $('#clear-note-btn').click(() => {
        const ta = document.getElementById('node-note');
        if (!ta) return;
        if (!currentNode) return;
        ta.value = '';
        currentNode.note = '';
        updateVisualTree();
        triggerAutoSave();
    });

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