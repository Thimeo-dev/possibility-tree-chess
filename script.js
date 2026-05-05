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
}

// --- LOGIQUE DE JEU & NAVIGATION ---

function jumpToPosition(node) {
    currentNode = node;
    game.load(node.fen);
    board.position(node.fen);
    updateVisualTree();
}

function onDrop(source, target) {
    const move = game.move({ from: source, to: target, promotion: 'q' });
    if (!move) return 'snapback';

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

// --- INITIALISATION ---

$(document).ready(async function() {
    await preloadPieces();

    // 1. Initialiser Chessboard.js
    board = ChessBoard('board', {
        draggable: true,
        position: 'start',
        onDrop: onDrop,
        onSnapEnd: () => board.position(game.fen()),
        pieceTheme: 'https://chessboardjs.com/img/chesspieces/wikipedia/{piece}.png'
    });

    // 2. Initialiser D3.js
    svg = d3.select("#tree-container").append("svg")
        .attr("width", "100%")
        .attr("height", "100%")
        .call(d3.zoom().on("zoom", (e) => g.attr("transform", e.transform)));

    g = svg.append("g").attr("transform", `translate(${margin.left}, ${window.innerHeight / 2})`);
    treeLayout = d3.tree().nodeSize([280, 450]);

    // 3. Évènements
    $('#reset-btn').click(() => location.reload());

    $(document).keydown(e => {
        if (e.which === 37 && currentNode.parent) jumpToPosition(currentNode.parent); 
        if (e.which === 39 && currentNode.children.length > 0) jumpToPosition(currentNode.children[0]); 
    });

    updateVisualTree();
});