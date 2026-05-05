// --- CONFIGURATION INITIALE ---
const game = new Chess();
let board = null;
let nextNodeId = 1;
const pieceCache = {};

// Structure de données de l'arbre
let treeData = {
    id: 0,
    name: "START",
    fen: game.fen(),
    children: [],
    parent: null
};
let currentNode = treeData;
const STORAGE_KEY = 'chessTreeExplorerData';
let pendingPromotion = null;
let zoom = null;

// Paramètres D3
const margin = { top: 50, right: 150, bottom: 50, left: 150 };
let svg, g, treeLayout;

// --- MOTEUR DE RENDU ---

async function preloadPieces() {
    const pieces = [];
    ['w', 'b'].forEach(c => ['P', 'N', 'B', 'R', 'Q', 'K'].forEach(t => pieces.push(c + t)));
    
    await Promise.all(pieces.map(p => new Promise(resolve => {
        const img = new Image();
        img.src = `https://chessboardjs.com/img/chesspieces/wikipedia/${p}.png`;
        img.onload = () => { pieceCache[p] = img; resolve(); };
        img.onerror = resolve;
    })));
}

function renderMiniBoard(canvasId, fen) {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const size = 200; 
    const ratio = window.devicePixelRatio || 2;
    
    canvas.width = size * ratio;
    canvas.height = size * ratio;
    ctx.scale(ratio, ratio);

    const sq = 25; 

    // Dessin des cases
    for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
            ctx.fillStyle = (r + c) % 2 === 0 ? '#f0d9b5' : '#b58863';
            ctx.fillRect(c * sq, r * sq, sq, sq);
        }
    }

    // Dessin des pièces
    const rows = fen.split(' ')[0].split('/');
    rows.forEach((row, r) => {
        let c = 0;
        for (let char of row) {
            if (!isNaN(char)) c += parseInt(char);
            else {
                const img = pieceCache[(char === char.toUpperCase() ? 'w' : 'b') + char.toUpperCase()];
                if (img) ctx.drawImage(img, c * sq, r * sq, sq, sq);
                c++;
            }
        }
    });
}

function updateVisualTree() {
    const root = d3.hierarchy(treeData);
    treeLayout(root);

    // Lignes de connexion (Liens)
    const links = g.selectAll(".link").data(root.links(), d => d.target.data.id);
    
    links.enter().insert("path", "g") // Insérer avant les groupes de nœuds pour être "derrière"
        .attr("class", "link")
        .merge(links).transition().duration(400)
        .attr("d", d => {
            // Ajustement des points d'ancrage pour éviter l'effet coupé
            // On réduit le décalage à 80 pour que la ligne pénètre dans le cadre du plateau
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
    saveTree();
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

function saveTree() {
    try {
        const copy = JSON.parse(JSON.stringify(treeData));
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
            treeData: copy,
            currentNodeId: currentNode.id,
            nextNodeId
        }));
    } catch (err) {
        console.warn('Impossible de sauvegarder l\'arbre :', err);
    }
}

function loadTree() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    try {
        const data = JSON.parse(raw);
        treeData = data.treeData;
        setParents(treeData, null);
        nextNodeId = data.nextNodeId || 1;
        currentNode = findNodeById(treeData, data.currentNodeId) || treeData;
        return true;
    } catch (err) {
        console.warn('Impossible de charger l\'arbre :', err);
        return false;
    }
}

function clearTreeLocalStorage() {
    localStorage.removeItem(STORAGE_KEY);
    location.reload();
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
    saveTree();
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
    await preloadPieces();

    if (!loadTree()) {
        treeData = { id: 0, name: "START", fen: game.fen(), children: [], parent: null };
        currentNode = treeData;
        nextNodeId = 1;
    }

    // 1. Initialiser Chessboard.js
    board = ChessBoard('board', {
        draggable: true,
        position: currentNode.fen,
        onDrop: onDrop,
        onSnapEnd: () => board.position(game.fen()),
        pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png'
    });

    // 2. Initialiser D3.js
    zoom = d3.zoom().scaleExtent([0.1, 2]).on("zoom", (e) => g.attr("transform", e.transform));
    svg = d3.select("#tree-container").append("svg")
        .attr("width", "100%")
        .attr("height", "100%")
        .call(zoom);

    g = svg.append("g").attr("transform", `translate(${margin.left}, ${window.innerHeight / 2})`);
    treeLayout = d3.tree().nodeSize([280, 450]);

    // 3. Évènements
    $('#reset-btn').click(() => {
        localStorage.removeItem(STORAGE_KEY);
        location.reload();
    });
    $('#center-btn').click(centerOnCurrentNode);
    $('#root-btn').click(goToRoot);
    $('#end-btn').click(goToEnd);
    $('#delete-btn').click(deleteCurrentBranch);
    $('#clear-storage-btn').click(clearTreeLocalStorage);
    $('#promotion-modal .promo-buttons button').click(function() {
        choosePromotion($(this).data('piece'));
    });
    $('#promo-cancel').click(hidePromotionModal);

    $(document).keydown(e => {
        if (['INPUT', 'TEXTAREA'].includes(e.target.tagName)) return;
        if (e.key === 'ArrowLeft' && currentNode.parent) {
            jumpToPosition(currentNode.parent);
        }
        if (e.key === 'ArrowRight' && currentNode.children.length > 0) {
            jumpToPosition(currentNode.children[0]);
        }
        if (e.key.toLowerCase() === 'r') {
            centerOnCurrentNode();
        }
        if (e.key.toLowerCase() === 'h') {
            goToRoot();
        }
        if (e.key.toLowerCase() === 'e') {
            goToEnd();
        }
        if (e.key.toLowerCase() === 'd') {
            deleteCurrentBranch();
        }
        if (e.key.toLowerCase() === 'l') {
            clearTreeLocalStorage();
        }
    });

    updateVisualTree();
    saveTree();
});