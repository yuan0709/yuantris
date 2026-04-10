document.addEventListener('DOMContentLoaded', () => {
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

    let user, bot, gameRunning = false;
    let DAS = 150, ARR = 30, AI_LEVEL = 8;
    let dropCounter = 0, lastTime = 0, aiActionTimer = 0;
    
    let keyStates = {}, keyTimers = {}, currentDir = null;

    function createGame(isAI = false) {
        return {
            arena: Array.from({length: 20}, () => Array(10).fill(0)),
            player: { pos: {x: 3, y: 0}, matrix: null, type: null },
            bag: [], next: [], hold: null, canHold: true,
            garbageQueue: 0, sent: 0, isAI: isAI,
            lockTimer: null, moveResetCount: 0, combo: -1
        };
    }

    // --- 遊戲工具函式 ---
    function rotate(matrix, dir) {
        for (let y = 0; y < matrix.length; ++y) {
            for (let x = 0; x < y; ++x) [matrix[x][y], matrix[y][x]] = [matrix[y][x], matrix[x][y]];
        }
        if (dir > 0) matrix.forEach(row => row.reverse()); else matrix.reverse();
    }

    function collide(game, pos, matrix) {
        const m = matrix || game.player.matrix, o = pos || game.player.pos;
        for (let y = 0; y < m.length; ++y) {
            for (let x = 0; x < m[y].length; ++x) {
                if (m[y][x] !== 0) {
                    const ay = y + o.y, ax = x + o.x;
                    if (ay < 0 || ay >= 20 || ax < 0 || ax >= 10 || game.arena[ay][ax] !== 0) return true;
                }
            }
        }
        return false;
    }

    function resetPiece(game) {
        if (game.garbageQueue > 0) {
            const amount = Math.min(game.garbageQueue, 8);
            for(let i=0; i<amount; i++) {
                game.arena.shift();
                let row = new Array(10).fill(8);
                row[Math.floor(Math.random()*10)] = 0;
                game.arena.push(row);
            }
            game.garbageQueue -= amount;
        }
        if (game.bag.length < 7) {
            let p = Object.keys(SHAPES);
            while(p.length) game.bag.push(p.splice(Math.floor(Math.random()*p.length),1)[0]);
        }
        while (game.next.length < 4) game.next.push(game.bag.shift());
        game.player.type = game.next.shift();
        game.player.matrix = JSON.parse(JSON.stringify(SHAPES[game.player.type]));
        game.player.pos = {x: 3, y: 0};
        game.canHold = true; game.moveResetCount = 0;
        if (collide(game)) { gameRunning = false; alert(game.isAI ? "YOU WIN!" : "AI WINS!"); }
    }

    function lock(game) {
        clearTimeout(game.lockTimer); game.lockTimer = null;
        game.player.matrix.forEach((row, y) => {
            row.forEach((v, x) => {
                if(v) {
                    const ay = y + game.player.pos.y, ax = x + game.player.pos.x;
                    if (ay >= 0 && ay < 20) game.arena[ay][ax] = v;
                }
            });
        });
        let lines = 0;
        for (let y = game.arena.length - 1; y >= 0; --y) {
            if (game.arena[y].every(v => v !== 0)) {
                game.arena.splice(y, 1); game.arena.unshift(new Array(10).fill(0));
                lines++; y++;
            }
        }
        if (lines > 0) {
            game.combo++;
            let attack = [0, 0, 1, 2, 4][lines] || 0;
            if (game.combo > 0) attack += Math.floor(game.combo / 2);
            let target = game.isAI ? user : bot;
            if (game.garbageQueue > 0) {
                let cancel = Math.min(game.garbageQueue, attack);
                game.garbageQueue -= cancel; attack -= cancel;
            }
            if (attack > 0) target.garbageQueue += attack;
            game.sent += attack;
        } else { game.combo = -1; }
        resetPiece(game);
    }

    // --- AI 邏輯 ---
    function evaluateBoard(arena) {
        let holes = 0, aggregateHeight = 0, bumpiness = 0, columnHeights = new Array(10).fill(0);
        for (let x = 0; x < 10; x++) {
            let columnTop = false;
            for (let y = 0; y < 20; y++) {
                if (arena[y][x] !== 0) {
                    if (!columnTop) { columnHeights[x] = 20 - y; columnTop = true; }
                } else if (columnTop) holes++;
            }
        }
        for (let x = 0; x < 10; x++) {
            aggregateHeight += columnHeights[x];
            if (x < 9) bumpiness += Math.abs(columnHeights[x] - columnHeights[x+1]);
        }
        return (aggregateHeight * -0.51) + (holes * -7.5) + (bumpiness * -0.18);
    }

    function aiThink(game) {
        let bestScore = -Infinity, bestX = 3, bestRot = 0;
        const baseMatrix = JSON.parse(JSON.stringify(SHAPES[game.player.type]));
        for (let r = 0; r < 4; r++) {
            let currentM = JSON.parse(JSON.stringify(baseMatrix));
            for (let i = 0; i < r; i++) rotate(currentM, 1);
            for (let x = -2; x < 10; x++) {
                if (collide(game, {x, y: 0}, currentM)) continue;
                let y = 0; while (!collide(game, {x, y: y + 1}, currentM)) y++;
                const tempArena = game.arena.map(row => [...row]);
                currentM.forEach((row, py) => {
                    row.forEach((v, px) => { if (v && tempArena[y + py]) tempArena[y + py][x + px] = v; });
                });
                let linesCleared = 0;
                tempArena.forEach(row => { if(row.every(cell => cell !== 0)) linesCleared++; });
                let score = evaluateBoard(tempArena) + (linesCleared * 20);
                if (score > bestScore) { bestScore = score; bestX = x; bestRot = r; }
            }
        }
        game.player.matrix = baseMatrix;
        for (let i = 0; i < bestRot; i++) rotate(game.player.matrix, 1);
        game.player.pos.x = bestX;
        while (!collide(game, {x: game.player.pos.x, y: game.player.pos.y + 1})) game.player.pos.y++;
        lock(game);
    }

    // --- 繪製函式 ---
    function drawMatrix(matrix, offset, ctx, ghost = false) {
        matrix.forEach((row, y) => {
            row.forEach((v, x) => {
                if(v) { 
                    ctx.fillStyle = ghost ? 'rgba(255,255,255,0.1)' : COLORS[v];
                    ctx.fillRect(x + offset.x, y + offset.y, 1, 1);
                    if (!ghost) { ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 0.05; ctx.strokeRect(x + offset.x, y + offset.y, 1, 1); }
                }
            });
        });
    }

    function draw() {
        pCtx.clearRect(0,0,10,20); aCtx.clearRect(0,0,10,20);
        hCtx.clearRect(0,0,3,3); nCtx.clearRect(0,0,3,9);
        drawMatrix(user.arena, {x:0,y:0}, pCtx);
        let gp = {x: user.player.pos.x, y: user.player.pos.y};
        while(!collide(user, {x: gp.x, y: gp.y + 1})) gp.y++;
        drawMatrix(user.player.matrix, gp, pCtx, true);
        drawMatrix(user.player.matrix, user.player.pos, pCtx);
        drawMatrix(bot.arena, {x:0,y:0}, aCtx);
        drawMatrix(bot.player.matrix, bot.player.pos, aCtx);
        if(user.hold) drawMatrix(SHAPES[user.hold], user.hold==='I'?{x:-0.5, y:0.5}:{x:0, y:0.5}, hCtx);
        user.next.slice(0,3).forEach((type, i) => drawMatrix(SHAPES[type], type==='I'?{x:-0.5, y:i*3}:{x:0, y:i*3+0.5}, nCtx));
        document.getElementById('p-sent').innerText = user.sent;
        document.getElementById('a-sent').innerText = bot.sent;
        const pG = document.getElementById('player-garbage-bar'), aG = document.getElementById('ai-garbage-bar');
        pG.innerHTML = `<div class="garbage-fill ${user.garbageQueue>=4?'danger':''}" style="height:${user.garbageQueue*30}px"></div>`;
        aG.innerHTML = `<div class="garbage-fill ${bot.garbageQueue>=4?'danger':''}" style="height:${bot.garbageQueue*30}px"></div>`;
    }

    // --- 操作函式 ---
    function move(code) {
        if (!gameRunning) return;
        let dx = 0, dy = 0;
        if ([37, 65].includes(code)) dx = -1;
        if ([39, 68].includes(code)) dx = 1;
        if ([40, 83].includes(code)) dy = 1;
        if (dx !== 0) { user.player.pos.x += dx; if (collide(user)) user.player.pos.x -= dx; else resetLockTimer(user); }
        if (dy !== 0) { user.player.pos.y += dy; if (collide(user)) { user.player.pos.y--; requestLock(user); } else { dropCounter = 0; resetLockTimer(user); } }
    }

    function handleInstant(code) {
        if (!gameRunning) return;
        if ([38, 87, 88].includes(code)) {
            const old = JSON.parse(JSON.stringify(user.player.matrix)); rotate(user.player.matrix, 1);
            const kicks = [0, 1, -1, 2, -2]; let ok = false;
            for(let k of kicks) { user.player.pos.x += k; if(!collide(user)){ ok=true; break; } user.player.pos.x -= k; }
            if(!ok) user.player.matrix = old; else resetLockTimer(user);
        }
        if ([67, 16].includes(code) && user.canHold) {
            let cur = user.player.type;
            if (!user.hold) { user.hold = cur; resetPiece(user); }
            else { [user.hold, user.player.type] = [cur, user.hold]; user.player.matrix = JSON.parse(JSON.stringify(SHAPES[user.player.type])); user.player.pos = {x: 3, y: 0}; }
            user.canHold = false;
        }
        if (code === 32) { while(!collide(user, {x: user.player.pos.x, y: user.player.pos.y + 1})) user.player.pos.y++; lock(user); }
    }

    function resetLockTimer(game) { if (game.lockTimer && game.moveResetCount < 15) { game.moveResetCount++; clearTimeout(game.lockTimer); game.lockTimer = null; requestLock(game); } }
    function requestLock(game) { if (!game.lockTimer) game.lockTimer = setTimeout(() => { if (collide(game, {x: game.player.pos.x, y: game.player.pos.y + 1})) lock(game); else game.lockTimer = null; }, 500); }

    // --- 輸入處理核心 ---
    document.onkeydown = e => {
        const code = e.keyCode;
        if (keyStates[code]) return;
        keyStates[code] = true;
        
        if ([37, 65, 39, 68].includes(code)) {
            currentDir = code;
            const opposites = [37, 65].includes(code) ? [39, 68] : [37, 65];
            opposites.forEach(c => { delete keyTimers[c]; delete keyTimers[c + 'a']; });
            move(code); 
            keyTimers[code] = Date.now();
        } else if ([40, 83].includes(code)) {
            move(code); 
            keyTimers[code + 's'] = Date.now();
        } else handleInstant(code);
    };

    document.onkeyup = e => {
        const code = e.keyCode;
        delete keyStates[code]; delete keyTimers[code]; delete keyTimers[code + 'a']; delete keyTimers[code + 's'];
        if (code === currentDir) currentDir = null;
    };

    // --- 主循環 ---
    function loop(time = 0) {
        if (!gameRunning) return;
        const dt = time - lastTime; lastTime = time;

        [37, 65, 39, 68, 40, 83].forEach(code => {
            if (keyStates[code]) {
                // 處理左右移動 (DAS/ARR)
                if ([37, 65, 39, 68].includes(code)) {
                    if (code !== currentDir) return;
                    if (keyTimers[code]) {
                        const elapsed = Date.now() - keyTimers[code];
                        if (elapsed > DAS) {
                            if (!keyTimers[code + 'a'] || Date.now() - keyTimers[code + 'a'] > ARR) {
                                move(code);
                                keyTimers[code + 'a'] = Date.now();
                            }
                        }
                    }
                } 
                // 處理緩降 (Soft Drop) - 跳過 DAS 直接 ARR
                else if ([40, 83].includes(code)) {
                    if (keyTimers[code + 's'] && Date.now() - keyTimers[code + 's'] > ARR) {
                        move(code);
                        keyTimers[code + 's'] = Date.now();
                    }
                }
            }
        });

        dropCounter += dt; 
        if (dropCounter > 1000) { 
            user.player.pos.y++; 
            if (collide(user)) { user.player.pos.y--; requestLock(user); } 
            dropCounter = 0; 
        }

        aiActionTimer += dt; 
        if (aiActionTimer > (1100 - AI_LEVEL * 100)) { aiThink(bot); aiActionTimer = 0; }
        
        draw(); 
        requestAnimationFrame(loop);
    }

    document.getElementById('start-btn').onclick = () => {
        DAS = parseInt(document.getElementById('das-input').value) || 150;
        ARR = parseInt(document.getElementById('arr-input').value) || 30;
        AI_LEVEL = parseInt(document.getElementById('ai-level').value) || 8;
        user = createGame(); bot = createGame(true); resetPiece(user); resetPiece(bot);
        gameRunning = true; lastTime = performance.now(); requestAnimationFrame(loop);
    };
});
