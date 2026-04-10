const COLORS = [null, '#00FFFF', '#FFD700', '#800080', '#FF0000', '#00FF00', '#0000FF', '#FFA500', '#777777'];
const SHAPES = {
    'I': [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]],
    'O': [[2,2],[2,2]],
    'T': [[0,3,0],[3,3,3],[0,0,0]],
    'Z': [[4,4,0],[0,4,4],[0,0,0]],
    'S': [[0,5,5],[5,5,0],[0,0,0]],
    'J': [[6,0,0],[6,6,6],[0,0,0]],
    'L': [[0,0,7],[7,7,7],[0,0,0]]
};

const pCanvas = document.getElementById('tetris'), pCtx = pCanvas.getContext('2d');
const aCanvas = document.getElementById('ai-tetris'), aCtx = aCanvas.getContext('2d');
const hCanvas = document.getElementById('hold-canvas'), hCtx = hCanvas.getContext('2d');
const nCanvas = document.getElementById('next-canvas'), nCtx = nCanvas.getContext('2d');

[pCtx, aCtx, hCtx, nCtx].forEach(ctx => ctx.scale(30, 30));

let DAS = 150, ARR = 30, AI_LEVEL = 5;

function createGame(isAI = false) {
    return {
        arena: Array.from({length: 20}, () => Array(10).fill(0)),
        player: { pos: {x: 0, y: 0}, matrix: null, type: null },
        bag: [], next: [], hold: null, canHold: true,
        garbageQueue: 0, sent: 0, isAI: isAI,
        lockTimer: null, moveResetCount: 0
    };
}

let user = createGame(), bot = createGame(true);

function fillBag(game) {
    let pieces = Object.keys(SHAPES);
    while(pieces.length) {
        let i = Math.floor(Math.random() * pieces.length);
        game.bag.push(pieces.splice(i, 1)[0]);
    }
}

function resetPiece(game) {
    if (game.garbageQueue > 0) {
        for(let i=0; i<game.garbageQueue; i++) {
            game.arena.shift();
            let row = new Array(10).fill(8);
            row[Math.floor(Math.random()*10)] = 0;
            game.arena.push(row);
        }
        game.garbageQueue = 0;
    }
    if (game.bag.length < 7) fillBag(game);
    while (game.next.length < 4) game.next.push(game.bag.shift());
    
    game.player.type = game.next.shift();
    game.player.matrix = SHAPES[game.player.type];
    game.player.pos = {x: 3, y: 0};
    game.canHold = true;
    game.moveResetCount = 0;

    if (collide(game)) {
        alert(game.isAI ? "PLAYER WINS!" : "AI WINS!");
        user = createGame(); bot = createGame(true);
        resetPiece(user); resetPiece(bot);
    }
}

function collide(game, pos, matrix) {
    const m = matrix || game.player.matrix, o = pos || game.player.pos;
    for (let y = 0; y < m.length; ++y) {
        for (let x = 0; x < m[y].length; ++x) {
            if (m[y][x] !== 0 && (game.arena[y + o.y] && game.arena[y + o.y][x + o.x]) !== 0) return true;
        }
    }
    return false;
}

function rotate(matrix, dir) {
    for (let y = 0; y < matrix.length; ++y) {
        for (let x = 0; x < y; ++x) [matrix[x][y], matrix[y][x]] = [matrix[y][x], matrix[x][y]];
    }
    dir > 0 ? matrix.forEach(row => row.reverse()) : matrix.reverse();
}

function playerRotate(game, dir) {
    const pos = game.player.pos.x;
    rotate(game.player.matrix, dir);
    const kicks = [0, 1, -1, 2, -2]; // Basic Wall Kick
    let success = false;
    for (let k of kicks) {
        game.player.pos.x += k;
        if (!collide(game)) { success = true; break; }
        game.player.pos.x -= k;
    }
    if (!success) rotate(game.player.matrix, -dir);
    else handleLockDelay(game);
}

function handleLockDelay(game) {
    if (collide(game, {x: game.player.pos.x, y: game.player.pos.y + 1})) {
        if (game.moveResetCount < 15) {
            game.moveResetCount++;
            clearTimeout(game.lockTimer);
            game.lockTimer = setTimeout(() => lock(game), 500);
        }
    }
}

function lock(game) {
    if (!collide(game, {x: game.player.pos.x, y: game.player.pos.y + 1})) return;
    game.player.matrix.forEach((row, y) => {
        row.forEach((v, x) => { if(v) game.arena[y + game.player.pos.y][x + game.player.pos.x] = v; });
    });
    let lines = 0;
    outer: for (let y = game.arena.length - 1; y >= 0; --y) {
        if (game.arena[y].every(v => v !== 0)) {
            game.arena.splice(y, 1);
            game.arena.unshift(new Array(10).fill(0));
            lines++; y++;
        }
    }
    if (lines > 1) {
        let attack = [0, 0, 1, 2, 4][lines];
        let target = game.isAI ? user : bot;
        if (game.garbageQueue > 0) {
            let cancel = Math.min(game.garbageQueue, attack);
            game.garbageQueue -= cancel; attack -= cancel;
        }
        target.garbageQueue += attack;
        game.sent += attack;
    }
    resetPiece(game);
}

function drawMatrix(matrix, offset, ctx, ghost = false) {
    matrix.forEach((row, y) => { row.forEach((v, x) => {
        if(v) { 
            ctx.fillStyle = ghost ? 'rgba(255,255,255,0.15)' : COLORS[v];
            ctx.fillRect(x + offset.x, y + offset.y, 1, 1);
        }
    }); });
}

function render() {
    [pCtx, aCtx, hCtx, nCtx].forEach(c => { c.fillStyle = '#000'; c.fillRect(0,0,10,20); });
    
    // Player
    drawMatrix(user.arena, {x:0,y:0}, pCtx);
    let gp = {x: user.player.pos.x, y: user.player.pos.y};
    while(!collide(user, {x: gp.x, y: gp.y + 1})) gp.y++;
    drawMatrix(user.player.matrix, gp, pCtx, true);
    drawMatrix(user.player.matrix, user.player.pos, pCtx);
    
    // AI
    drawMatrix(bot.arena, {x:0,y:0}, aCtx);
    drawMatrix(bot.player.matrix, bot.player.pos, aCtx);
    
    // UI
    if(user.hold) drawMatrix(SHAPES[user.hold], {x:0,y:0}, hCtx);
    user.next.slice(0,3).forEach((t, i) => drawMatrix(SHAPES[t], {x:0, y:i*3}, nCtx));
    
    document.getElementById('p-sent').innerText = user.sent;
    document.getElementById('a-sent').innerText = bot.sent;
    document.getElementById('player-garbage-bar').innerHTML = `<div class="garbage-fill" style="height:${user.garbageQueue*30}px"></div>`;
    document.getElementById('ai-garbage-bar').innerHTML = `<div class="garbage-fill" style="height:${bot.garbageQueue*30}px"></div>`;
    requestAnimationFrame(render);
}

// Input Handling
let keyStates = {}, keyTimers = {};
document.onkeydown = e => { if(!keyStates[e.keyCode]) { keyStates[e.keyCode] = true; handleInstant(e.keyCode); } };
document.onkeyup = e => { delete keyStates[e.keyCode]; delete keyTimers[e.keyCode]; delete keyTimers[e.keyCode+'a']; };

function handleInstant(code) {
    if ([38, 87, 88].includes(code)) playerRotate(user, 1);
    if ([67, 16].includes(code) && user.canHold) {
        let current = user.player.type;
        if (!user.hold) { user.hold = current; resetPiece(user); }
        else { let tmp = user.hold; user.hold = current; user.player.type = tmp; user.player.matrix = SHAPES[tmp]; user.player.pos = {x:3, y:0}; }
        user.canHold = false;
    }
    if (code === 32) { while(!collide(user, {x:user.player.pos.x, y:user.player.pos.y+1})) user.player.pos.y++; lock(user); }
}

function updateInput() {
    Object.keys(keyStates).forEach(k => {
        let code = parseInt(k);
        if ([37, 65, 39, 68, 40, 83].includes(code)) {
            if (!keyTimers[code]) { keyTimers[code] = Date.now(); move(code); }
            else if (Date.now() - keyTimers[code] > DAS) {
                if (!keyTimers[code+'a'] || Date.now() - keyTimers[code+'a'] > ARR) {
                    move(code); keyTimers[code+'a'] = Date.now();
                }
            }
        }
    });
}

function move(code) {
    let dx = 0, dy = 0;
    if ([37, 65].includes(code)) dx = -1;
    if ([39, 68].includes(code)) dx = 1;
    if ([40, 83].includes(code)) dy = 1;
    if (dx !== 0) { user.player.pos.x += dx; if(collide(user)) user.player.pos.x -= dx; else handleLockDelay(user); }
    if (dy !== 0) { user.player.pos.y += dy; if(collide(user)) { user.player.pos.y--; lock(user); } else dropCounter = 0; }
}

let dropCounter = 0, lastTime = 0;
function loop(time = 0) {
    const dt = time - lastTime; lastTime = time;
    updateInput();
    dropCounter += dt;
    if (dropCounter > 1000) { user.player.pos.y++; if(collide(user)) { user.player.pos.y--; lock(user); } dropCounter = 0; }
    render();
    requestAnimationFrame(loop);
}

// AI logic
setInterval(() => {
    if (Math.random() > (10 - AI_LEVEL) / 10) {
        bot.player.pos.x = Math.floor(Math.random() * 7);
        if (Math.random() > 0.5) rotate(bot.player.matrix, 1);
        while(!collide(bot, {x:bot.player.pos.x, y:bot.player.pos.y+1})) bot.player.pos.y++;
        lock(bot);
    }
}, 600);

document.getElementById('das-range').oninput = e => { DAS = e.target.value; document.getElementById('das-val').innerText = DAS; };
document.getElementById('arr-range').oninput = e => { ARR = e.target.value; document.getElementById('arr-val').innerText = ARR; };
document.getElementById('ai-level').oninput = e => { AI_LEVEL = e.target.value; document.getElementById('ai-lv-val').innerText = AI_LEVEL; };

resetPiece(user); resetPiece(bot);
loop();