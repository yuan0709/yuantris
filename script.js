document.addEventListener('DOMContentLoaded', () => {
    // --- 1. 基礎數據 ---
    const COLORS = [null, '#00FFFF', '#FFD700', '#800080', '#FF0000', '#00FF00', '#0000FF', '#FFA500', '#777777'];
    const SHAPES = {
        I: [[0,0,0,0],[1,1,1,1],[0,0,0,0],[0,0,0,0]], O: [[2,2],[2,2]], T: [[0,3,0],[3,3,3],[0,0,0]],
        Z: [[4,4,0],[0,4,4],[0,0,0]], S: [[0,5,5],[5,5,0],[0,0,0]], J: [[6,0,0],[6,6,6],[0,0,0]], L: [[0,0,7],[7,7,7],[0,0,0]]
    };
    const WALL_KICK = {
        common: [[{x:0,y:0},{x:-1,y:0},{x:-1,y:1},{x:0,y:-2},{x:-1,y:-2}],[{x:0,y:0},{x:1,y:0},{x:1,y:-1},{x:0,y:2},{x:1,y:2}],[{x:0,y:0},{x:1,y:0},{x:1,y:1},{x:0,y:-2},{x:1,y:-2}],[{x:0,y:0},{x:-1,y:0},{x:-1,y:-1},{x:0,y:2},{x:-1,y:2}]],
        I: [[{x:0,y:0},{x:-2,y:0},{x:1,y:0},{x:-2,y:-1},{x:1,y:2}],[{x:0,y:0},{x:-1,y:0},{x:2,y:0},{x:-1,y:2},{x:2,y:-1}],[{x:0,y:0},{x:2,y:0},{x:-1,y:0},{x:2,y:1},{x:-1,y:-2}],[{x:0,y:0},{x:1,y:0},{x:-2,y:0},{x:1,y:-2},{x:-2,y:1}]]
    };

    const $ = id => document.getElementById(id);
    const ctxs = {
        user: $('tetris').getContext('2d'), ai: $('ai-tetris').getContext('2d'),
        hold: $('hold-canvas').getContext('2d'), next: $('next-canvas').getContext('2d')
    };
    Object.values(ctxs).forEach(c => c.scale(30, 30));

    // --- 2. 按鍵與手感參數 ---
    let keyConfig = {
        '左移': [37, null], '右移': [39, null], '軟降': [40, null], '硬降': [32, null],
        '順轉': [38, 88], '逆轉': [90, null], '180轉': [65, null], '暫存': [67, null]
    };

    let user, bot, gameRunning = false, lastTime = 0, dropCounter = 0, aiActionTimer = 0;
    let DAS = 150, ARR = 30, SOFT_DROP_MS = 30, AI_SPEED_MS = 400, EXPERT_MODE = false, TOTAL_LVL = 5;
    let keyStates = {}, keyTimers = {}, currentDir = null;

    const getKeyName = code => {
        if (!code) return '---';
        if (code === 32) return 'Space';
        const map = {37:'←', 38:'↑', 39:'→', 40:'↓'};
        return map[code] || String.fromCharCode(code).toUpperCase() || code;
    };

    const initKeyUI = () => {
        const container = $('key-config-container'); container.innerHTML = '';
        Object.keys(keyConfig).forEach(action => {
            const row = document.createElement('div'); row.className = 'key-row';
            row.innerHTML = `<span>${action}</span>
                <div class="key-btn" data-action="${action}" data-idx="0">${getKeyName(keyConfig[action][0])}</div>
                <div class="key-btn" data-action="${action}" data-idx="1">${getKeyName(keyConfig[action][1])}</div>`;
            container.appendChild(row);
        });
        document.querySelectorAll('.key-btn').forEach(btn => btn.onclick = () => {
            btn.classList.add('waiting'); btn.innerText = '?';
            const listen = (e) => {
                e.preventDefault();
                keyConfig[btn.dataset.action][+btn.dataset.idx] = e.keyCode;
                btn.innerText = getKeyName(e.keyCode);
                btn.classList.remove('waiting');
                window.removeEventListener('keydown', listen);
            };
            window.addEventListener('keydown', listen);
        });
    };
    initKeyUI();

    const checkKey = (code, action) => keyConfig[action].includes(code);

    // --- 3. 遊戲核心邏輯 ---
    const createGame = isAI => ({
        arena: Array.from({length: 20}, () => Array(10).fill(0)),
        player: { pos: {x: 3, y: 0}, matrix: null, type: null, rot: 0, lastAction: 'move' },
        bag: [], next: [], hold: null, canHold: true, garbage: 0, sent: 0, combo: -1, b2b: false, isAI,
        lockDelay: 500, lockTimer: 0, isLocking: false
    });

    const rotate = (m, d) => {
        for (let y = 0; y < m.length; ++y) for (let x = 0; x < y; ++x) [m[x][y], m[y][x]] = [m[y][x], m[x][y]];
        if (d === 2) { m.forEach(r => r.reverse()); m.reverse(); }
        else { d > 0 ? m.forEach(r => r.reverse()) : m.reverse(); }
    };

    const collide = (g, p, m) => {
        const mat = m || g.player.matrix, pos = p || g.player.pos;
        return mat.some((row, y) => row.some((v, x) => {
            if (v !== 0) {
                const ay = y + pos.y, ax = x + pos.x;
                return ay >= 20 || ax < 0 || ax >= 10 || (ay >= 0 && g.arena[ay][ax] !== 0);
            }
            return false;
        }));
    };

    const resetPiece = (g, didClear) => {
        if (!didClear && g.garbage > 0) {
            const amt = Math.min(g.garbage, 8);
            let hole = Math.floor(Math.random() * 10);
            for(let i=0; i<amt; i++) { g.arena.shift(); let r = Array(10).fill(8); r[hole] = 0; g.arena.push(r); }
            g.garbage -= amt;
        }
        const fillBag = (bag) => { let p = Object.keys(SHAPES); while(p.length) bag.push(p.splice(Math.random()*p.length|0, 1)[0]); };
        if (g.bag.length < 7) fillBag(g.bag);
        while (g.next.length < 5) { if (g.bag.length === 0) fillBag(g.bag); g.next.push(g.bag.shift()); }
        g.player.type = g.next.shift();
        g.player.matrix = JSON.parse(JSON.stringify(SHAPES[g.player.type]));
        g.player.pos = {x: 3, y: 0}; g.player.rot = 0; g.canHold = true;
        g.isLocking = false; g.lockTimer = 0;
        if (collide(g)) { gameRunning = false; alert(g.isAI ? "玩家獲勝！" : "AI 獲勝！"); }
    };

    const lock = g => {
        let isSpin = g.player.lastAction === 'rotate';
        g.player.matrix.forEach((row, y) => row.forEach((v, x) => {
            if(v) { const ay = y + g.player.pos.y; if (ay >= 0) g.arena[ay][g.player.pos.x + x] = v; }
        }));
        let lines = 0;
        for (let y = 19; y >= 0; y--) { if (g.arena[y].every(v => v !== 0)) { g.arena.splice(y, 1); g.arena.unshift(Array(10).fill(0)); lines++; y++; } }
        if (lines > 0) {
            g.combo++;
            let atk = [0, 0, 1, 2, 4][lines] || 0;
            if (isSpin) { atk += 1; if (g.b2b) atk += 1; g.b2b = true; } 
            else if (lines === 4) { if (g.b2b) atk += 1; g.b2b = true; } else { g.b2b = false; }
            if (g.combo >= 1) atk += Math.floor(g.combo / 2);
            let target = g.isAI ? user : bot;
            let cancel = Math.min(g.garbage, atk); g.garbage -= cancel; atk -= cancel;
            if (atk > 0) { target.garbage += atk; g.sent += atk; }
        } else { g.combo = -1; }
        resetPiece(g, lines > 0);
    };

    const playerRotate = (g, dir) => {
        const oldRot = g.player.rot; const newRot = (oldRot + dir + 4) % 4;
        const m = JSON.parse(JSON.stringify(g.player.matrix)); rotate(m, dir);
        const kicks = dir === 2 ? [{x:0,y:0}] : (g.player.type === 'I' ? WALL_KICK.I[oldRot] : WALL_KICK.common[oldRot]);
        for (let kick of kicks) {
            if (!collide(g, {x: g.player.pos.x + kick.x, y: g.player.pos.y - kick.y}, m)) {
                g.player.pos.x += kick.x; g.player.pos.y -= kick.y;
                g.player.matrix = m; g.player.rot = newRot; g.player.lastAction = 'rotate';
                if (g.isLocking) g.lockTimer = 0; return;
            }
        }
    };

    // --- 4. 指定 AI 強度邏輯 (不變動) ---
    const evalArena = a => {
        let holes = 0, hts = Array(10).fill(0), bump = 0;
        for (let x = 0; x < 10; x++) {
            let top = false;
            for (let y = 0; y < 20; y++) {
                if (a[y][x]) { if(!top) { hts[x] = 20-y; top = true; } }
                else if (top) holes++;
            }
        }
        for (let x = 0; x < 9; x++) bump += Math.abs(hts[x] - hts[x+1]);
        return (hts.reduce((a, b) => a + b) * -0.6) + (holes * (EXPERT_MODE?-45:-20)) + (bump * -0.5);
    };

    const aiThink = g => {
        let candidates = [];
        const types = [{t: g.player.type, h: false}, {t: g.hold || g.next[0], h: true}];
        const noise = (20 - TOTAL_LVL) / 20 * 0.3;

        types.forEach(scen => {
            for (let r = 0; r < 4; r++) {
                let m = JSON.parse(JSON.stringify(SHAPES[scen.t])); for(let i=0; i<r; i++) rotate(m, 1);
                for (let x = -2; x < 10; x++) {
                    if (collide(g, {x: x, y: 0}, m)) continue;
                    let y = 0; while (!collide(g, {x: x, y: y+1}, m)) y++;
                    const a = g.arena.map(row => [...row]);
                    m.forEach((row, py) => row.forEach((v, px) => { if(v && a[y+py]) a[y+py][x+px]=v; }));
                    let s = evalArena(a) + (Math.random()-0.5) * 10 * noise;
                    candidates.push({ score: s, x: x, r: r, h: scen.h });
                }
            }
        });

        candidates.sort((a, b) => b.score - a.score);
        const best = candidates[0];
        if (best.h) { 
            if(!g.hold) { g.hold=g.player.type; resetPiece(g, false); } 
            else { [g.hold, g.player.type]=[g.player.type, g.hold]; g.player.matrix=JSON.parse(JSON.stringify(SHAPES[g.player.type])); g.player.pos={x:3, y:0}; }
        }
        for(let i=0; i<best.r; i++) rotate(g.player.matrix, 1);
        g.player.pos.x = best.x; while (!collide(g, {x: g.player.pos.x, y: g.player.pos.y+1})) g.player.pos.y++;
        lock(g);
    };

    // --- 5. 繪製與循環 ---
    const drawMat = (ctx, m, o, ghost, isLocking) => m && m.forEach((row, y) => row.forEach((v, x) => {
        if (v) {
            let opacity = isLocking ? 0.5 + Math.sin(Date.now() / 35) * 0.4 : 1;
            if (ghost) { ctx.fillStyle = 'rgba(255,255,255,0.1)'; }
            else { 
                const hex = COLORS[v], r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
                ctx.fillStyle = `rgba(${r},${g},${b},${opacity})`;
            }
            ctx.fillRect(x + o.x, y + o.y, 1, 1);
            ctx.strokeStyle = ghost ? 'rgba(255,255,255,0.05)' : `rgba(0,0,0,${opacity})`;
            ctx.lineWidth = 0.05; ctx.strokeRect(x+o.x, y+o.y, 1, 1);
        }
    }));

    const update = () => {
        Object.values(ctxs).forEach(c => { c.clearRect(0,0,10,20); c.strokeStyle='#222'; c.lineWidth=0.02; for(let i=0;i<=10;i++)c.strokeRect(i,0,0,20); for(let i=0;i<=20;i++)c.strokeRect(0,i,10,0); });
        [user, bot].forEach((g, i) => {
            const ctx = i === 0 ? ctxs.user : ctxs.ai;
            g.arena.forEach((r,y)=>r.forEach((v,x)=>{ if(v){ ctx.fillStyle=COLORS[v]; ctx.fillRect(x,y,1,1); ctx.strokeStyle='rgba(0,0,0,0.3)'; ctx.lineWidth=0.05; ctx.strokeRect(x,y,1,1); }}));
            if(!g.isAI) {
                let gp = {...g.player.pos}; while(!collide(g, {x: gp.x, y: gp.y+1})) gp.y++;
                drawMat(ctx, g.player.matrix, gp, true, false);
                drawMat(ctx, g.player.matrix, g.player.pos, false, g.isLocking);
            } else { drawMat(ctx, g.player.matrix, g.player.pos, false, false); }
        });
        if(user.hold) drawMat(ctxs.hold, SHAPES[user.hold], {x:1, y:1});
        user.next.slice(0,5).forEach((t, i) => drawMat(ctxs.next, SHAPES[t], {x:1, y:i*3+1}));
        $('p-sent').innerText = user.sent; $('a-sent').innerText = bot.sent;
        $('player-garbage-bar').style.height = Math.min(user.garbage * 30, 600) + 'px';
        $('ai-garbage-bar').style.height = Math.min(bot.garbage * 30, 600) + 'px';
    };

    window.onkeydown = e => {
        if(!gameRunning) return; const c = e.keyCode; keyStates[c] = true;
        if(checkKey(c, '左移') || checkKey(c, '右移')) { 
            currentDir = c; user.player.pos.x += (checkKey(c, '左移') ? -1 : 1);
            if(collide(user)) user.player.pos.x -= (checkKey(c, '左移') ? -1 : 1);
            else if (user.isLocking) user.lockTimer = 0;
            keyTimers[c] = Date.now();
        }
        if(checkKey(c, '硬降')) { while(!collide(user, {x: user.player.pos.x, y: user.player.pos.y+1})) user.player.pos.y++; lock(user); }
        if(checkKey(c, '順轉')) playerRotate(user, 1);
        if(checkKey(c, '逆轉')) playerRotate(user, -1);
        if(checkKey(c, '180轉')) playerRotate(user, 2);
        if(checkKey(c, '暫存') && user.canHold) {
            let cur = user.player.type;
            if(!user.hold) { user.hold=cur; resetPiece(user, false); }
            else { [user.hold, user.player.type]=[cur, user.hold]; user.player.matrix=JSON.parse(JSON.stringify(SHAPES[user.player.type])); user.player.pos={x:3, y:0}; }
            user.canHold=false;
        }
    };
    window.onkeyup = e => { delete keyStates[e.keyCode]; if(e.keyCode === currentDir) currentDir = null; };

    const loop = (time = 0) => {
        if (!gameRunning) return; const dt = time - lastTime; lastTime = time;
        if (currentDir && Date.now() - keyTimers[currentDir] > DAS) {
            if (!keyTimers[currentDir+'a'] || Date.now() - keyTimers[currentDir+'a'] > ARR) {
                user.player.pos.x += (checkKey(currentDir, '左移') ? -1 : 1);
                if(collide(user)) user.player.pos.x -= (checkKey(currentDir, '左移') ? -1 : 1);
                else if (user.isLocking) user.lockTimer = 0;
                keyTimers[currentDir+'a'] = Date.now();
            }
        }
        let isSoftDropping = false;
        Object.keys(keyStates).forEach(code => { if(checkKey(+code, '軟降')) isSoftDropping = true; });

        if (collide(user, {x: user.player.pos.x, y: user.player.pos.y + 1})) {
            if (!user.isLocking) { user.isLocking = true; user.lockTimer = 0; }
            user.lockTimer += dt; if (user.lockTimer >= user.lockDelay) lock(user);
        } else { user.isLocking = false; user.lockTimer = 0; }

        let speed = isSoftDropping ? SOFT_DROP_MS : 1000;
        if (!user.isLocking && (dropCounter += dt) > speed) {
            user.player.pos.y++; if (collide(user)) { user.player.pos.y--; user.isLocking = true; }
            dropCounter = 0;
        }
        if ((aiActionTimer += dt) > AI_SPEED_MS) { aiThink(bot); aiActionTimer = 0; }
        update(); requestAnimationFrame(loop);
    };

    $('open-settings').onclick = () => $('settings-modal').style.display = 'block';
    $('save-settings').onclick = () => {
        DAS = +$('das-input').value; ARR = +$('arr-input').value; SOFT_DROP_MS = +$('sd-speed-input').value;
        $('settings-modal').style.display = 'none';
    };
    $('start-btn').onclick = () => {
        AI_SPEED_MS = 1000 / parseFloat($('ai-pps').value);
        TOTAL_LVL = +$('ai-level').value; EXPERT_MODE = $('expert-mode').checked;
        user = createGame(false); bot = createGame(true);
        resetPiece(user, false); resetPiece(bot, false);
        gameRunning = true; lastTime = performance.now(); loop();
    };
});
