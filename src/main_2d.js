import { Platform, Ally, Enemy, Explosion, FloatingText, GROUND_Y, AttackerBullet, SlashEffect, DashLineEffect, HitscanImpact, Boss, BossBullet, SlamWave, ShatterParticle } from './entities_2d.js?v=b7';
import { SoundManager } from './audio_2d.js?v=b3';

const CW = 1280;
const CH = 720;
const IS_MOBILE = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
const ZOOM = IS_MOBILE ? 1.75 : 1.25;      // カメラズーム倍率をモバイルで拡大
const VW   = Math.round(CW / ZOOM); // ワールド可視幅
const VH   = Math.round(CH / ZOOM); // ワールド可視高

// ────────────────────────────────────────────
// ────────────────────────────────────────────
const HEALER_STATS = {
    maxAmmo: 5,
    reloadTime: 3.0,
    shotCooldownMax: 0.8,
    healHead: 150,
    healBody: 50,
};

// ────────────────────────────────────────────
// 決定論的プラットフォーム生成（シード乱数）
// ────────────────────────────────────────────
function seededRand(seed) {
    let s = (seed * 1664525 + 1013904223) >>> 0;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 0xffffffff;
    };
}

const CHUNK_W    = 600;
const PLAT_HEIGHTS = [200, 270, 340, 430]; // GROUND_Y=520 に合わせた高さ候補

function generateChunk(idx) {
    const rng  = seededRand(idx ^ 0xdeadbeef);
    const baseX = idx * CHUNK_W;
    const plats = [];
    const count = 3 + Math.floor(rng() * 3); // 3〜5枚/チャンク
    for (let i = 0; i < count; i++) {
        const x = baseX + rng() * (CHUNK_W - 160);
        const y = PLAT_HEIGHTS[Math.floor(rng() * PLAT_HEIGHTS.length)];
        const w = 110 + Math.floor(rng() * 5) * 25; // 110〜230
        plats.push(new Platform(x, y, w));
    }
    return plats;
}

// ────────────────────────────────────────────
// メインゲームクラス
// ────────────────────────────────────────────
class Game {
    constructor() {
        this.canvas = document.getElementById('game-canvas');
        this.ctx    = this.canvas.getContext('2d');
        this.canvas.width  = CW;
        this.canvas.height = CH;
        this.isMobile = IS_MOBILE;
        this.VW = VW; // 論理ワールド幅を保持
        this.VH = VH; // 論理ワールド高を保持
        if (IS_MOBILE) document.body.classList.add('is-mobile');
        this._resize();

        // 入力
        this.keys   = {};
        this.mouseX = 0;
        this.mouseY = 0;
        window.addEventListener('keydown',   e => { this.keys[e.key.toLowerCase()] = true;  if(e.key === ' ') e.preventDefault(); });
        window.addEventListener('keyup',     e => { this.keys[e.key.toLowerCase()] = false; });
        
        // Use pointer events for comprehensive device support
        this.canvas.addEventListener('pointerdown', e => { 
            this._onPointerUpdate(e); 
            if (e.pointerType !== 'mouse') { // Touch/Pen specific
               this._onShoot(e); 
            } else if (e.button === 0) { // Mouse specific
               this._onShoot(e); 
            }
        });
        this.canvas.addEventListener('pointermove', e => this._onPointerUpdate(e));
        
        // Prevent default touch behaviors like scrolling/zooming
        this.canvas.style.touchAction = 'none';
        
        window.addEventListener('resize',    () => this._resize());

        // SEマネージャー
        this.soundManager = new SoundManager();

        // ULT発動イベント
        window.addEventListener('ultimate-start', () => {
            this.soundManager.playUltTrigger();
        });
        // ULTレディイベント
        window.addEventListener('ultimate-ready', () => {
            this.soundManager.playUltReady();
        });

        // ロール別ULT SE
        window.addEventListener('tank-ult-impact', () => this.soundManager.playTankUltImpact());
        window.addEventListener('tank-ult-hum',    e => this.soundManager.playTankUltHum(e.detail.duration));
        window.addEventListener('attacker-ult-fire', () => this.soundManager.playAttackerFirestorm());
        window.addEventListener('flanker-ult-slice', () => this.soundManager.playFlankerSlice());

        // 味方完全死亡時の「チーン」音
        window.addEventListener('ally-dead', () => {
            if (this.soundManager) this.soundManager.playDeathDing();
        });

        this.isTitleScreen = true;


        // カメラ
        this.camX = 0;
        this.mouseX = CW / 2;
        this.mouseY = CH / 2;

        // レベル
        this.generatedChunks = 0;
        this.platforms = [];
        for (let i = 0; i < 6; i++) this._generateNextChunk();

        // エンティティ（プレイヤーは画面外 — 表示なし）
        this.allies = [
            new Ally(1, 'TANK',     300, 480),
            new Ally(2, 'ATTACKER', 180, 480),
            new Ally(3, 'FLANKER',   80, 480),
        ];
        this.enemies         = [];
        this.attackerBullets = [];
        this.slashEffects    = [];
        this.dashLines       = [];
        this.explosions      = [];
        this.floatingTexts   = [];
        this.hitscanImpacts  = [];
        this.bosses          = [];
        this.bossBullets     = [];

        // プレイヤー（ヒーラー）ステータス
        this.player = {
            maxAmmo:    HEALER_STATS.maxAmmo,
            ammo:       HEALER_STATS.maxAmmo,
            reloading:  false,
            reloadTimer: 0,
            reloadTime: HEALER_STATS.reloadTime,
            shotCooldown: 0,
            shotCooldownMax: HEALER_STATS.shotCooldownMax,
            healHead:   HEALER_STATS.healHead,
            healBody:   HEALER_STATS.healBody,
        };

        // ゲーム状態
        this.score        = 0;
        this.wave          = 1;
        this.waveTimer     = 35.0; 
        this.spawnTimer    = 0;
        this.spawnInterval = 0.6;
        this.waveNotifyTimer = 4.0; // 初回WAVE表示用
        
        this.camY = 0; // 垂直カメラオフセット
        this.gameOver = false;
        this.victory  = false;

        this.highScore = parseInt(localStorage.getItem('vp-high-score')) || 0;
        this._updateTitleHighScore();

        // 5.4.0: Boss Buff & Celebration
        window._game = this;
        this.bossBuffTimer = 0;
        this.bossBuffMult = 1.0;
        this.fireworks = [];
        this.fireworkTimer = 0;

        // イベントリスナー
        this._initEvents();

        this.lastTime = performance.now();
        this._animate();
    }

    _resize() {
        const sx = window.innerWidth  / CW;
        const sy = window.innerHeight / CH;
        const s  = Math.min(sx, sy);
        this.canvas.style.width  = `${CW * s}px`;
        this.canvas.style.height = `${CH * s}px`;
    }

    _scale() {
        const rect = this.canvas.getBoundingClientRect();
        const sx = rect.width > 0 ? CW / rect.width : 1;
        const sy = rect.height > 0 ? CH / rect.height : 1;
        return { sx, sy, rect };
    }

    _onPointerUpdate(e) {
        const { sx, sy, rect } = this._scale();
        this.mouseX = (e.clientX - rect.left) * sx;
        this.mouseY = (e.clientY - rect.top)  * sy;
    }

    _onShoot(e) {
        // pointerdown で既に mouseX/Y は更新済み
        if (this.isTitleScreen) return;
        
        const pl = this.player;
        if (pl.reloading || pl.ammo <= 0 || pl.shotCooldown > 0) return;

        // ZOOM補正を考慮したワールド座標へ変換（camYオフセットも加算）
        const wx = (this.mouseX / ZOOM) + this.camX;
        const wy = (this.mouseY / ZOOM) + this.camY;

        // ── ヒットスキャン判定 ──
        // モバイルはZOOM=1.75でキャラが大きく見えるが当たり判定のワールド座標サイズは同じなので
        // モバイル時はヒットボックスを拡大して見た目に合わせる
        const hitScale = IS_MOBILE ? 1.8 : 1.0;
        let hitType = 'miss';
        for (const a of this.allies) {
            const hCX = a.x + a.w / 2;
            const hCY = a.y + a.h * 0.15;
            const hR  = a.w * 0.28 * hitScale;
            const dH  = Math.sqrt((wx - hCX) ** 2 + (wy - hCY) ** 2);
            const bodyTop = a.y + a.h * (IS_MOBILE ? 0.1 : 0.3);
            const bodyLeft  = a.x - a.w * (IS_MOBILE ? 0.3 : 0);
            const bodyRight = a.x + a.w * (IS_MOBILE ? 1.3 : 1.0);
            const inBody = wx >= bodyLeft && wx <= bodyRight &&
                           wy >= bodyTop && wy <= a.y + a.h;
            if (dH < hR) {
                a.heal(pl.healHead);
                this.floatingTexts.push(new FloatingText(hCX, a.y - 10, `CRITICAL! +${pl.healHead}`, '#ffff00'));
                hitType = 'critical';
            } else if (inBody) {
                a.heal(pl.healBody);
                this.floatingTexts.push(new FloatingText(a.x + a.w / 2, a.y + a.h * 0.5, `+${pl.healBody}`, '#00ffcc'));
                if (hitType === 'miss') hitType = 'body';
            }
        }
        if (hitType === 'miss') {
            this.floatingTexts.push(new FloatingText(wx, wy, 'MISS', '#666666'));
        }

        // 着弾エフェクト
        this.hitscanImpacts.push(new HitscanImpact(wx, wy, hitType));
        window.dispatchEvent(new CustomEvent('vp-explosion', {
            detail: { x: wx, y: wy, type: hitType }
        }));
        
        // ヒール音の再生
        if (hitType === 'critical') {
            if (this.soundManager) this.soundManager.playHealCritical();
        } else if (hitType === 'body') {
            if (this.soundManager) this.soundManager.playHealNormal();
        }

        // 弾薬消費とクールダウン適用
        pl.ammo--;
        pl.shotCooldown = pl.shotCooldownMax;
        if (pl.ammo <= 0) {
            pl.reloading  = true;
            pl.reloadTimer = pl.reloadTime;
        }
    }

    _generateNextChunk() {
        const plats = generateChunk(this.generatedChunks++);
        this.platforms.push(...plats);
    }

    _initEvents() {
        const initScreen = document.getElementById('init-screen');
        const titleScreen = document.getElementById('title-screen');
        const startBtn = document.querySelector('.start-btn');

        if (initScreen) {
            initScreen.addEventListener('click', (e) => {
                e.stopPropagation();
                initScreen.classList.add('hidden');
                if (this.soundManager) this.soundManager.playTitleBGM();
            });
        }

        if (titleScreen) {
            titleScreen.addEventListener('click', (e) => {
                e.stopPropagation();
                if (!this.isTitleScreen) return;
                this.isTitleScreen = false;
                titleScreen.classList.add('hidden');
                if (this.soundManager) this.soundManager.playMainTheme();
                this.lastTime = performance.now(); // リセットしてdtの跳ねを防止
                this._updateTitleHighScore();
            });
        }

        // モバイル操作ボタン
        const btnReload = document.getElementById('btn-reload');
        const btnUlt    = document.getElementById('btn-ult');
        if (btnReload) {
            btnReload.addEventListener('pointerdown', (e) => {
                e.stopPropagation();
                if (!this.player.reloading && this.player.ammo < this.player.maxAmmo) {
                    this.player.reloading = true;
                    this.player.reloadTimer = this.player.reloadTime;
                }
            });
        }

        window.addEventListener('ultimate-start', e => {
            this._showCutIn(e.detail.role, e.detail.speech);
        });
        window.addEventListener('vp-explosion', e => {
            const type = e.detail.type || (e.detail.heal ? 'body' : 'damage');
            this.explosions.push(new Explosion(e.detail.x, e.detail.y, type));
        });
        window.addEventListener('vp-bullet', e => {
            this.attackerBullets.push(new AttackerBullet(e.detail.x, e.detail.y, e.detail.vx, e.detail.dmg));
        });
        window.addEventListener('vp-slash', e => {
            this.slashEffects.push(new SlashEffect(e.detail.x, e.detail.y, e.detail.angle));
        });
        window.addEventListener('vp-dashline', e => {
            this.dashLines.push(new DashLineEffect(e.detail.sx, e.detail.sy, e.detail.ex, e.detail.ey));
        });
    }

    reset() {
        this.camX = 0;
        this.generatedChunks = 0;
        this.platforms = [];
        for (let i = 0; i < 6; i++) this._generateNextChunk();

        this.allies = [
            new Ally(1, 'TANK',     300, 480),
            new Ally(2, 'ATTACKER', 180, 480),
            new Ally(3, 'FLANKER',   80, 480),
        ];
        this.enemies         = [];
        this.attackerBullets = [];
        this.slashEffects    = [];
        this.dashLines       = [];
        this.explosions      = [];
        this.floatingTexts   = [];
        this.hitscanImpacts  = [];
        this.bosses          = [];
        this.bossBullets     = [];

        this.player.maxAmmo     = HEALER_STATS.maxAmmo;
        this.player.ammo        = HEALER_STATS.maxAmmo;
        this.player.reloading   = false;
        this.player.reloadTimer = 0;
        this.player.reloadTime  = HEALER_STATS.reloadTime;
        this.player.shotCooldown = 0;
        this.player.shotCooldownMax = HEALER_STATS.shotCooldownMax;
        this.player.healHead    = HEALER_STATS.healHead;
        this.player.healBody    = HEALER_STATS.healBody;

        this.score        = 0;
        this.wave         = 1;
        this.waveTimer    = 35.0; 
        this.spawnTimer   = 0;
        this.spawnInterval= 0.6;
        this.waveNotifyTimer = 4.0;
        
        this.gameOver = false;
        this.victory  = false;

        if (this.soundManager) {
            this.soundManager.stopAllBGM();
            this.soundManager.playMainTheme();
        }
        
        this.lastTime = performance.now();
    }

    _showCutIn(role, speech) {
        const el = document.createElement('div');
        el.className = 'ult-cutin';
        el.innerHTML = `
            <div class="stripe-bg"></div>
            <div class="character-portrait ${role.toLowerCase()}"></div>
            <div class="cutin-text">必殺!!</div>
            <div class="speech-text">${speech}</div>
        `;
        document.body.appendChild(el);
        setTimeout(() => {
            el.style.opacity = '0';
            setTimeout(() => el.remove(), 500);
        }, 1600);
    }

    // ─── UPDATE ───────────────────────────────
    _update(dt) {
        if (this.isTitleScreen) {
            // タイトル画面中は背景だけスクロールさせてゲームの進行を止める
            this.camX += 50 * dt;
            return;
        }

        // カメラ：味方NPCの重心を追従 (ボス戦中は固定)
        if (this.allies.length > 0 && this.bosses.length === 0) {
            let avgX = this.allies.reduce((s, a) => s + a.x + a.w / 2, 0) / this.allies.length;
            if (isNaN(avgX)) avgX = this.camX + VW * 0.42; // ガード
            const targetCamX = avgX - VW * 0.42;
            this.camX += (targetCamX - this.camX) * Math.min(dt * 4, 1);
            if (isNaN(this.camX)) this.camX = 0; // ガード
            this.camX = Math.max(0, this.camX);
        }

        // チャンク自動生成
        const rightEdge = this.camX + VW;
        let safety = 0;
        while (this.generatedChunks * CHUNK_W < rightEdge + 1200 && safety < 50) {
            this._generateNextChunk();
            safety++;
        }
        if (safety >= 50) { /* Chunk generation safety reached */ }
        // 画面外左のプラットフォームを削除
        this.platforms = this.platforms.filter(p => p.x + p.w > this.camX - 200);

        // 味方
        let centerX = this.allies.length > 0
            ? this.allies.reduce((s, a) => s + (isNaN(a.x) ? this.camX : a.x), 0) / this.allies.length
            : this.camX + 200;
        if (isNaN(centerX)) centerX = this.camX + 200;
        this.allies.forEach(a => {
            a.update(dt, this.enemies, this.bosses, this.platforms, centerX);
            if (a.x < this.camX + 10) a.x = this.camX + 10;
            if (a.x + a.w > this.camX + VW - 10) a.x = this.camX + VW - 10 - a.w;
        });
        
        // 死亡した味方をリストから除外
        this.allies = this.allies.filter(a => a.alive);
        
        // ゲームオーバー判定
        if (this.allies.length === 0 && !this.gameOver) {
            this.gameOver = true;
            this._showGameOver();
        }

        // 敵 (雑魚)
        this.enemies.forEach(e => e.update(dt, this.platforms, this.allies));
        this.enemies = this.enemies.filter(e => {
            if (!e.alive) {
                this.score += e.type === 'HEAVY' ? 30 : e.type === 'SCOUT' ? 15 : 10;
                this.explosions.push(new Explosion(e.x + e.w/2, e.y + e.h/2, false));
                return false;
            }
            return e.x > this.camX - 300;
        });

        // ボス
        this.bosses.forEach(b => b.update(dt, this.platforms, this.allies, this.bossBullets));
        this.bosses = this.bosses.filter(b => {
             if (!b.alive) {
                 this.handleBossDefeat(b);
                 // WAVE 25クリア判定
                 if (this.wave === 25 && !this.victory) {
                     this.victory = true;
                     this._updateHighScore();
                     this._showVictory();
                 }
                 return false;
             }
             return true;
        });

        // 5.4.0: Fireworks & Buff Update
        if (this.fireworkTimer > 0) {
            this.fireworkTimer -= dt;
            if (Math.random() < 0.1) this._spawnFirework();
        }
        this.fireworks = this.fireworks.filter(f => f.update(dt));

        if (this.bossBuffTimer > 0) {
            this.bossBuffTimer -= dt;
            if (this.bossBuffTimer <= 0) {
                this.bossBuffMult = 1.0;
            }
        }

        // ボスの弾
        this.bossBullets = this.bossBullets.filter(bb => bb.update(dt, this.allies));

        // アタッカー弾
        this.attackerBullets.forEach(b => b.update(dt, this.enemies, this.bosses));
        this.attackerBullets = this.attackerBullets.filter(b => b.alive);

        // ヒットスキャンエフェクト更新
        this.hitscanImpacts = this.hitscanImpacts.filter(h => h.update(dt));

        // エフェクト
        this.dashLines     = this.dashLines.filter(dl => dl.update(dt));
        this.explosions    = this.explosions.filter(ex => ex.update(dt));
        this.slashEffects  = this.slashEffects.filter(se => se.update(dt));
        this.floatingTexts = this.floatingTexts.filter(ft => ft.update(dt));

        // 敵スポーン (ボス戦中は停止)
        const isBossWave = (this.wave % 5 === 0);
        if (this.bosses.length === 0) {
            this.spawnTimer += dt;
            if (this.spawnTimer >= this.spawnInterval) {
                const count = this.wave > 5 ? 5 : 3;
                // ボスウェーブでも雑魚を少し混ぜる
                for (let i = 0; i < (isBossWave ? 1 : count); i++) this._spawnEnemy();
                this.spawnTimer = 0;
            }
        }

        // ウェーブ進行
        if (this.bosses.length === 0) {
            this.waveTimer -= dt;
            if (this.waveTimer <= 0) {
                this.wave++;
                this.waveTimer    = 35; // 少し余裕を持たせる
                this.spawnInterval = Math.max(0.3, 0.6 - this.wave * 0.02);
                this.waveNotifyTimer = 4.0;
                this._playWaveStartSound();
                
                // ボス出現判定
                if (this.wave % 5 === 0) {
                    this._spawnBoss();
                }
            }
        }

        if (this.waveNotifyTimer > 0) this.waveNotifyTimer -= dt;

        // ─── プレイヤー更新 ───────────────────────────────
        // クールダウン減少
        if (this.player.shotCooldown > 0) {
            this.player.shotCooldown -= dt;
        }
        // リロード更新
        if (this.player.reloading) {
            this.player.reloadTimer -= dt;
            if (this.player.reloadTimer <= 0) {
                this.player.ammo      = this.player.maxAmmo;
                this.player.reloading = false;
            }
        }
        // [R] 手動リロード
        if (this.keys['r'] && !this.player.reloading && this.player.ammo < this.player.maxAmmo) {
            this.player.reloading  = true;
            this.player.reloadTimer = this.player.reloadTime;
        }
    }

    _spawnEnemy() {
        const spawnX = this.camX + VW + 60;
        // 重み付き敵タイプ
        const tbl = this.wave > 5
            ? [['NORMAL',2],['SCOUT',2],['HEAVY',1]]
            : [['NORMAL',3],['SCOUT',2],['HEAVY',1]];
        const total = tbl.reduce((s,[,w]) => s+w, 0);
        let r = Math.random() * total, type = 'NORMAL';
        for (const [t,w] of tbl) { r -= w; if (r <= 0) { type = t; break; } }

        const nearPlats = this.platforms.filter(p => p.x < spawnX + 100 && p.x + p.w > spawnX - 100);
        let spawnY;
        if (nearPlats.length > 0 && Math.random() < 0.35) {
            const p = nearPlats[Math.floor(Math.random() * nearPlats.length)];
            spawnY = p.y - (type === 'HEAVY' ? 72 : 52);
        } else {
            spawnY = GROUND_Y - (type === 'HEAVY' ? 72 : 52);
        }
        this.enemies.push(new Enemy(spawnX, spawnY, type));
    }

    _spawnBoss() {
        const spawnX = this.camX + VW + 100;
        const spawnY = GROUND_Y - 240;
        this.bosses.push(new Boss(this.wave, spawnX, spawnY));
        this.floatingTexts.push(new FloatingText(spawnX - 100, spawnY - 40, "BOSS DETECTED", "#ff0000", 3.0));
    }

    // ─── DRAW ────────────────────────────────
    _draw() {
        const c = this.ctx;
        c.clearRect(0, 0, CW, CH);

        // ── ズームスケール適用（ゲームワールド描画） ──────────────────
        c.save();
        
        // モバイル等の高ズーム時にHUDで地面が隠れないよう、地上付近を垂直カメラの中央へ
        // 地面(520)を画面の下から150px(ワールド単位)くらいの位置へ
        this.camY = IS_MOBILE ? (GROUND_Y - (VH - 150)) : 0;
        
        c.scale(ZOOM, ZOOM);
        c.translate(0, -this.camY);

        this._drawBg(c);
        this._drawGround(c);

        if (this.isTitleScreen) {
            c.restore();
            return;
        }

        this.platforms.forEach(p  => p.draw(c, this.camX));
        this.enemies.forEach(e    => e.draw(c, this.camX));
        this.bosses.forEach(b     => b.draw(c, this.camX));
        this.allies.forEach(a     => a.draw(c, this.camX));
        this.bossBullets.forEach(bb => bb.draw(c, this.camX));

        // TANK ULT 前衛シールド
        const tank = this.allies.find(a => a.role === 'TANK' && a.isUlting);
        if (tank && this.allies.length > 0) {
            const allyPos = this.allies.map(a => a.x + a.w).filter(x => !isNaN(x));
            const frontX = allyPos.length > 0 ? Math.max(...allyPos) : tank.x + tank.w;
            const sx = frontX + 30 - this.camX;
            if (isNaN(sx)) return; // 描画スキップ
            const time = performance.now() / 1000;
            const shMaxH = 280;
            const shW = 40;

            c.save();
            c.beginPath();
            c.moveTo(sx, GROUND_Y);
            c.quadraticCurveTo(sx + shW, GROUND_Y - shMaxH/2, sx, GROUND_Y - shMaxH);
            c.lineTo(sx - 20, GROUND_Y - shMaxH);
            c.quadraticCurveTo(sx + shW - 20, GROUND_Y - shMaxH/2, sx - 20, GROUND_Y);
            c.closePath();

            const g = c.createLinearGradient(sx + shW, 0, sx - 20, 0);
            g.addColorStop(0, `rgba(0, 255, 255, ${0.4 + Math.sin(time*10)*0.1})`);
            g.addColorStop(0.5, 'rgba(0, 150, 255, 0.2)');
            g.addColorStop(1, 'rgba(0, 100, 255, 0.0)');
            c.fillStyle = g;
            c.shadowColor = '#00ffff';
            c.shadowBlur = 15 + Math.sin(time * 10) * 5;
            c.fill();

            c.clip();
            c.strokeStyle = 'rgba(255, 255, 255, 0.3)';
            c.lineWidth = 1.5;
            c.shadowBlur = 0;
            const offset = (time * 80) % 20;
            for (let y = GROUND_Y - shMaxH; y < GROUND_Y; y += 20) {
                c.beginPath();
                c.moveTo(sx - 30, y + offset);
                c.lineTo(sx + 50, y + offset);
                c.stroke();
            }
            c.restore();

            c.save();
            c.beginPath();
            c.moveTo(sx, GROUND_Y);
            c.quadraticCurveTo(sx + shW, GROUND_Y - shMaxH/2, sx, GROUND_Y - shMaxH);
            c.strokeStyle = 'rgba(150, 255, 255, 0.9)';
            c.lineWidth = 4 + Math.sin(time * 20) * 2;
            c.shadowColor = '#00ffff';
            c.shadowBlur = 20;
            c.stroke();
            c.restore();
        }

        // プレイヤーは画面に表示しない（ヒットスキャン式）
        this.hitscanImpacts.forEach(h => h.draw(c, this.camX));
        this.attackerBullets.forEach(b => b.draw(c, this.camX));
        this.dashLines.forEach(dl => dl.draw(c, this.camX));
        this.explosions.forEach(ex  => ex.draw(c, this.camX));
        this.slashEffects.forEach(se => se.draw(c, this.camX));
        this.floatingTexts.forEach(ft => ft.draw(c, this.camX));
        this.fireworks.forEach(f => f.draw(c, this.camX));

        c.restore(); // ── ズームスケール解除 ──────────────────────────

        this._drawHUD(c);
    }

    _drawBg(c) {
        // ズームスケール適用済みなのでVW/VH単位で描画
        const g = c.createLinearGradient(0, 0, 0, VH);
        g.addColorStop(0, '#020208');
        g.addColorStop(1, '#040420');
        c.fillStyle = g;
        c.fillRect(0, 0, VW, VH);

        // パラックスグリッド
        c.strokeStyle = 'rgba(0,80,130,0.22)';
        c.lineWidth   = 1;
        const gs  = 90;
        const offX = (this.camX * 0.28) % gs;
        for (let x = -offX; x < VW + gs; x += gs) {
            c.beginPath(); c.moveTo(x, 0); c.lineTo(x, VH); c.stroke();
        }
        for (let y = 0; y < VH; y += gs) {
            c.beginPath(); c.moveTo(0, y); c.lineTo(VW, y); c.stroke();
        }

        // 星（視差スクロール）
        c.fillStyle = 'rgba(255,255,255,0.55)';
        for (let i = 0; i < 55; i++) {
            const sx = ((i * 139 - this.camX * 0.04 + VW * 2) % VW + VW) % VW;
            const sy = (i * 103) % (VH * 0.55);
            c.fillRect(sx, sy, 1.5, 1.5);
        }
    }

    _drawGround(c) {
        const g = c.createLinearGradient(0, GROUND_Y, 0, VH + 200);
        g.addColorStop(0,    '#00ccff');
        g.addColorStop(0.04, '#003344');
        g.addColorStop(1,    '#001122');
        c.fillStyle = g;
        c.fillRect(0, GROUND_Y, VW, VH + 200 - GROUND_Y);

        // グロー
        const glow = c.createLinearGradient(0, GROUND_Y - 6, 0, GROUND_Y + 12);
        glow.addColorStop(0, 'rgba(0,255,255,0.5)');
        glow.addColorStop(1, 'rgba(0,255,255,0)');
        c.fillStyle = glow;
        c.fillRect(0, GROUND_Y - 6, VW, 18);
    }

    _drawHUD(c) {
        const uiScale = IS_MOBILE ? 1.25 : 1.0;
        const pl = this.player;
        const hudH = IS_MOBILE ? 100 : 80;
        const hudTop = CH - hudH;

        // ─── 上部バー ─────────────────────────────────────────────
        c.fillStyle = 'rgba(0,0,0,0.55)';
        c.fillRect(0, 0, CW, 38);
        c.font = 'bold 17px monospace';
        c.textAlign = 'left';  c.fillStyle = '#00ffff';
        c.fillText(`WAVE ${this.wave}`, 16, 25);
        c.textAlign = 'center'; c.fillStyle = '#ffff00';
        c.fillText(`SCORE: ${this.score}`, CW / 2, 25);
        c.textAlign = 'right';  c.fillStyle = '#aaa'; c.font = '13px monospace';
        const nextWaveIn = Math.max(0, Math.ceil(this.waveTimer));
        c.fillText(`次のWAVE: ${nextWaveIn}s`, CW - 16, 25);

        // -- ボスヘルスバー (上部中央) --
        if (this.bosses.length > 0) {
            const b = this.bosses[0];
            const bw = 600, bh = 22, bx = (CW - bw) / 2, by = 50;
            // バーの背景
            c.fillStyle = 'rgba(0,0,0,0.6)';
            c.fillRect(bx - 4, by - 4, bw + 8, bh + 8);
            c.fillStyle = '#330000';
            c.fillRect(bx, by, bw, bh);
            // ライフ
            const hpPct = Math.max(0, b.hp / b.maxHp);
            const g = c.createLinearGradient(bx, 0, bx + bw, 0);
            g.addColorStop(0, '#ff0000');
            g.addColorStop(1, '#ff6600');
            c.fillStyle = g;
            c.fillRect(bx, by, bw * hpPct, bh);
            // 枠とテキスト
            c.strokeStyle = '#ff0000';
            c.lineWidth = 2;
            c.strokeRect(bx, by, bw, bh);
            c.font = `bold ${16 * uiScale}px monospace`;
            c.textAlign = 'center';
            c.fillStyle = '#fff';
            c.shadowColor = '#f00'; c.shadowBlur = 10;
            c.fillText(`BOSS: WAVE ${this.wave} SECTOR COMMANDER`, CW/2, by - 12);
            c.shadowBlur = 0;
        }

        // ─── 画面下部：分隊ステータス ＆ プレイヤーHUD ──────────────────
        // 背景バー
        c.fillStyle = 'rgba(0, 15, 25, 0.85)';
        c.fillRect(0, hudTop, CW, hudH);
        c.strokeStyle = 'rgba(0, 255, 255, 0.3)';
        c.lineWidth = 2;
        c.beginPath(); c.moveTo(0, hudTop); c.lineTo(CW, hudTop); c.stroke();

        // -- 味方分隊ステータス (左〜中央) --
        const allyBaseX = 30;
        const allySpacing = 210 * uiScale;
        this.allies.forEach((a, i) => {
            const bx = allyBaseX + i * allySpacing;
            const by = hudTop + (IS_MOBILE ? 25 : 15);
            
            // ロール名
            c.font = 'bold 14px monospace';
            c.textAlign = 'left';
            const roleColor = i === 0 ? '#00ccff' : (i === 1 ? '#ffcc00' : '#00ffaa');
            c.fillStyle = roleColor;
            c.fillText(a.role, bx, by + 12);
            
            // HPバー
            const bW = 160 * uiScale, bH = 12 * uiScale;
            const hpPct = Math.max(0, a.hp / a.maxHp);
            c.fillStyle = '#1a1a1a';
            c.fillRect(bx, by + 18, bW, bH);
            
            const hpG = c.createLinearGradient(bx, 0, bx + bW, 0);
            if (hpPct > 0.5) { hpG.addColorStop(0, '#00ff88'); hpG.addColorStop(1, '#00cc66'); }
            else if (hpPct > 0.25) { hpG.addColorStop(0, '#ffff00'); hpG.addColorStop(1, '#ccaa00'); }
            else { hpG.addColorStop(0, '#ff3300'); hpG.addColorStop(1, '#880000'); }
            c.fillStyle = hpG;
            c.fillRect(bx, by + 18, bW * hpPct, bH);
            
            // ULTゲージ
            const uH = 4;
            const ultPct = Math.min(1, a.ultCharge / 100);
            c.fillStyle = 'rgba(255, 255, 255, 0.1)';
            c.fillRect(bx, by + 32, bW, uH);
            if (ultPct > 0) {
                let uColor = ultPct >= 1 ? '#fff700' : '#aa7700';
                if (ultPct >= 1 && Math.floor(Date.now() / 200) % 2 === 0) uColor = '#ffffff';
                c.fillStyle = uColor;
                c.fillRect(bx, by + 32, bW * ultPct, uH);
            }
            
            // HP数値
            c.font = `${10 * uiScale}px monospace`;
            c.fillStyle = '#ffffff';
            c.textAlign = 'right';
            c.fillText(`${Math.ceil(a.hp)} / ${a.maxHp}`, bx + bW, by + (IS_MOBILE ? 10 : 12));
        });

        // 攻撃バフ表示
        if (this.bossBuffTimer > 0) {
            const t = Math.ceil(this.bossBuffTimer);
            c.save();
            c.font = `bold ${IS_MOBILE ? 22 : 28}px "Outfit", sans-serif`;
            c.textAlign = 'center';
            c.fillStyle = `rgba(255, 50, 255, ${0.7 + Math.sin(Date.now()*0.01)*0.3})`;
            c.shadowColor = '#fff';
            c.shadowBlur = 10;
            c.fillText(`💥 ATTACK UP: ${t}s 💥`, CW / 2, hudTop - 30);
            c.restore();
        }

        // プレイヤー情報 (右側)
        const pBaseX = CW - (320 * uiScale);
        const pHudY = hudTop + (IS_MOBILE ? 25 : 15);
        
        // （レベル表記は削除）
        c.font = `bold ${18 * uiScale}px monospace`;
        c.textAlign = 'left';
        c.fillStyle = '#00ffff';
        c.fillText(`HEALER SYSTEM`, pBaseX, pHudY + 14);

        // 弾薬数
        const pipR = 5, pipGap = 8;
        const pipXStart = pBaseX + 80;
        for (let i = 0; i < pl.maxAmmo; i++) {
            const px = pipXStart + i * (pipR * 2 + pipGap) + pipR;
            const loaded = i < pl.ammo;
            c.save();
            if (loaded) { 
                c.shadowColor = '#00ffcc'; c.shadowBlur = 10; c.fillStyle = '#00ffcc'; 
            } else { 
                c.fillStyle = '#1a3535'; 
            }
            c.beginPath(); c.arc(px, pHudY + 28, pipR, 0, Math.PI * 2); c.fill();
            if (!loaded) { c.strokeStyle = '#00ffcc'; c.lineWidth = 1.5; c.stroke(); }
            c.restore();
        }

        // リロード / ヘルプ
        c.textAlign = 'left';
        if (pl.reloading) {
            const prog = 1 - pl.reloadTimer / pl.reloadTime;
            const blink = 0.6 + Math.sin(Date.now() * 0.01) * 0.4;
            c.font = `bold ${12 * uiScale}px monospace`;
            c.fillStyle = `rgba(255,140,0,${blink})`;
            c.fillText('RELOADING...', pBaseX + (80 * uiScale), pHudY + (54 * uiScale));
            c.fillStyle = '#333'; c.fillRect(pBaseX + (170 * uiScale), pHudY + (45 * uiScale), 90 * uiScale, 8 * uiScale);
            c.fillStyle = '#ff8800'; c.fillRect(pBaseX + (170 * uiScale), pHudY + (45 * uiScale), 90 * uiScale * prog, 8 * uiScale);
        } else {
            c.font = `${10 * uiScale}px monospace`;
            c.fillStyle = 'rgba(0, 255, 255, 0.45)';
            c.fillText(`H:+${pl.healHead} B:+${pl.healBody} [CLICK] HEAL [R] RELOAD`, pBaseX, pHudY + (54 * uiScale));
        }


        // ─── 画面中央のレティクルHUD (高視認性) ─────────────────────────
        const cmx = this.mouseX;
        const cmy = this.mouseY;
        
        // 1. リロードリング (レティクル周囲)
        if (pl.reloading) {
            const prog = 1 - pl.reloadTimer / pl.reloadTime;
            c.save();
            c.beginPath();
            c.lineWidth = 4;
            c.strokeStyle = 'rgba(255, 150, 0, 0.2)';
            c.arc(cmx, cmy, 28, 0, Math.PI * 2);
            c.stroke();
            
            c.beginPath();
            c.strokeStyle = '#ffaa00';
            c.lineCap = 'round';
            c.arc(cmx, cmy, 28, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * prog));
            c.stroke();
            
            // "RELOADING" 中央テキスト
            const blink = 0.5 + Math.sin(Date.now() * 0.015) * 0.5;
            c.font = 'bold 16px monospace';
            c.textAlign = 'center';
            c.fillStyle = `rgba(255, 120, 0, ${blink})`;
            c.fillText('RELOADING', cmx, cmy - 45);
            c.restore();
        }

        // 2. 装弾数表示 (細長いバー 5つ)
        const cPipW = 12, cPipH = 4, cPipGap = 4;
        const cTotalW = (cPipW + cPipGap) * 5 - cPipGap;
        const cStartX = cmx - cTotalW / 2;
        const cStartY = cmy + 35;
        
        for (let i = 0; i < pl.maxAmmo; i++) {
            const px = cStartX + i * (cPipW + cPipGap);
            const py = cStartY;
            const loaded = i < pl.ammo;
            
            c.save();
            if (loaded) {
                // 装填済み：明るいシアン
                c.fillStyle = '#00ffff';
                c.shadowColor = '#00ffff';
                c.shadowBlur = 8;
                c.fillRect(px, py, cPipW, cPipH);
            } else {
                // 空：暗い枠のみ
                c.strokeStyle = 'rgba(0, 255, 255, 0.25)';
                c.lineWidth = 1;
                c.strokeRect(px, py, cPipW, cPipH);
            }
            c.restore();
        }

        // ─── ウェーブ進行通知 ────────────────────────────────────────
        if (this.waveNotifyTimer > 0) {
            const alpha = Math.min(1, this.waveNotifyTimer);
            c.save();
            c.globalAlpha = alpha * 0.95;
            c.font = '900 64px monospace';
            c.textAlign = 'center';
            c.fillStyle = '#ffff00'; 
            c.shadowColor = '#ff8800';
            c.shadowBlur = 30;
            c.fillText(`WAVE ${this.wave} START!`, CW / 2, CH / 2 - 140);
            c.fillStyle = 'rgba(255, 255, 0, 0.4)';
            c.fillRect(CW / 2 - 250, CH / 2 - 125, 500, 5);
            c.restore();
        }

        // ─── マウスカーソル (スナイパーレティクル表示) ──────────────────
        // 座標が 0,0 の場合は初期位置（中央）または無効として扱う
        const mx = this.mouseX;
        const my = this.mouseY;
        
        c.save();
        // Cooldown behavior
        if (pl.shotCooldown > 0) {
            const pct = pl.shotCooldown / pl.shotCooldownMax;
            const gap = 12 + (pct * 30);
            c.strokeStyle = `rgba(255, 60, 60, ${0.5 + pct * 0.5})`;
            c.lineWidth   = 3;
            
            c.beginPath();
            c.arc(mx, my, 10 + pct * 15, 0, Math.PI * 2);
            c.stroke();
            
            c.beginPath();
            c.moveTo(mx - gap, my); c.lineTo(mx - gap - 10, my);
            c.moveTo(mx + gap, my); c.lineTo(mx + gap + 10, my);
            c.moveTo(mx, my - gap); c.lineTo(mx, my - gap - 10);
            c.moveTo(mx, my + gap); c.lineTo(mx, my + gap + 10);
            c.stroke();
            
            // Central dot
            c.fillStyle = '#ff4444';
            c.beginPath(); c.arc(mx, my, 2, 0, Math.PI * 2); c.fill();
        } else {
            c.strokeStyle = 'rgba(0, 255, 200, 0.9)'; // より不透明に
            c.lineWidth   = 2;
            c.beginPath();
            c.moveTo(mx - 15, my); c.lineTo(mx + 15, my);
            c.moveTo(mx, my - 15); c.lineTo(mx, my + 15);
            c.stroke();
            c.beginPath();
            c.arc(mx, my, 6, 0, Math.PI * 2);
            c.stroke();
            
            // Central dot
            c.fillStyle = '#00ffcc';
            c.beginPath(); c.arc(mx, my, 1.5, 0, Math.PI * 2); c.fill();
        }
        c.restore();
    }

    // ─── LOOP ────────────────────────────────
    _animate() {
        const now = performance.now();
        const dt  = Math.min((now - this.lastTime) / 1000, 0.05);
        this.lastTime = now;
        this._update(dt);
        this._draw();
        requestAnimationFrame(() => this._animate());
    }

    _playWaveStartSound() {
        if (!window.AudioContext && !window.webkitAudioContext) return;
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'square';
        osc.frequency.setValueAtTime(440, ctx.currentTime);
        osc.frequency.exponentialRampToValueAtTime(880, ctx.currentTime + 0.1);
        
        gain.gain.setValueAtTime(0.15, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start();
        osc.stop(ctx.currentTime + 0.5);
    }

    _showGameOver() {
        if (this.soundManager) {
            this.soundManager.stopAllBGM();
            this.soundManager.playGameOverBGM();
        }
        
        this._updateHighScore();

        const el = document.createElement('div');
        el.id = 'game-over';
        el.style.position = 'fixed';
        el.style.top = '0'; el.style.left = '0';
        el.style.width = '100%'; el.style.height = '100%';
        el.style.background = 'rgba(255, 0, 0, 0.3)';
        el.style.backdropFilter = 'blur(10px)';
        el.style.display = 'flex';
        el.style.flexDirection = 'column';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.style.zIndex = '1000';
        el.style.color = '#fff';
        el.style.fontFamily = 'Outfit, sans-serif';
        el.style.cursor = 'pointer';
        
        el.innerHTML = `
            <div style="text-align:center; pointer-events:none;">
                <h1 style="font-size: 80px; margin: 0; text-shadow: 0 0 20px #f00;">GAME OVER</h1>
                <p style="font-size: 24px;">分隊が全滅しました...</p>
                <p style="font-size: 32px; color: #ffcc00; margin-bottom: 40px;">SCORE: ${this.score}</p>
                <p class="blink-text" style="font-size: 24px; color: #fff;">CLICK ANYWHERE TO RESTART</p>
            </div>
        `;
        
        el.addEventListener('click', (e) => {
            e.stopPropagation();
            el.remove();
            this.reset();
        });

        document.body.appendChild(el);
    }

    _showVictory() {
        if (this.soundManager) {
            this.soundManager.stopMainTheme();
        }
        const el = document.createElement('div');
        el.style.position = 'fixed';
        el.style.top = '0'; el.style.left = '0';
        el.style.width = '100%'; el.style.height = '100%';
        el.style.background = 'rgba(0, 255, 150, 0.2)';
        el.style.backdropFilter = 'blur(10px)';
        el.style.display = 'flex';
        el.style.flexDirection = 'column';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'center';
        el.style.zIndex = '1000';
        el.style.color = '#fff';
        el.style.fontFamily = 'Outfit, sans-serif';
        el.style.cursor = 'pointer';
        
        el.innerHTML = `
            <div style="text-align:center; pointer-events:none;">
                <h1 style="font-size: 80px; margin: 0; text-shadow: 0 0 20px #0f8;">MISSION COMPLETE</h1>
                <p style="font-size: 24px;">すべての脅威を排除しました！</p>
                <p style="font-size: 48px; color: #fff700; text-shadow: 0 0 10px #aa7700;">FINAL SCORE: ${this.score}</p>
                <p class="blink-text" style="font-size: 24px; color: #fff; margin-top:30px;">CLICK ANYWHERE TO REPLAY</p>
            </div>
        `;
        
        el.onclick = () => location.reload();
        document.body.appendChild(el);
    }

    _updateHighScore() {
        if (this.score > this.highScore) {
            this.highScore = this.score;
            localStorage.setItem('vp-high-score', this.highScore);
            this._updateTitleHighScore();
        }
    }

    _updateTitleHighScore() {
        const valEl = document.getElementById('high-score-val');
        if (valEl) valEl.textContent = this.highScore;
    }

    _spawnFirework() {
        const x = this.camX + 100 + Math.random() * (VW - 200);
        const y = 50 + Math.random() * 250;
        const colors = ['#ff0055', '#00ff88', '#00ccff', '#ffff00', '#ffaa00'];
        const col = colors[Math.floor(Math.random() * colors.length)];
        
        for (let i = 0; i < 30; i++) {
            this.fireworks.push(new ShatterParticle(x, y, col));
        }
        if (this.soundManager) this.soundManager.playFirework();
    }

    handleBossDefeat(b) {
        // 1. Effects
        for (let i = 0; i < 60; i++) {
            this.fireworks.push(new ShatterParticle(b.x + b.w/2, b.y + b.h/2, '#ff4400'));
        }
        this.explosions.push(new Explosion(b.x + b.w/2, b.y + b.h/2, 'critical'));
        if (this.soundManager) this.soundManager.playBossExplosion();
        
        // 2. Rewards: Full Heal & Victory Lines
        this.allies.forEach(a => {
            const wasDying = a.isDying;
            a.hp = a.maxHp;
            a.isDying = false;
            a.deathLine = '';
            a.alive = true;

            if (!wasDying) {
                const lines = {
                    TANK: "守りきったぞ。",
                    ATTACKER: "当たればこんなもんよ！",
                    FLANKER: "遅すぎだぜ。"
                };
                a.speechText = lines[a.role];
                a.speechTimer = 2.5;
            }
        });
        
        // 3. Rewards: 10 Seconds Attack Buff (Synced with fireworks)
        this.bossBuffTimer = 10.0;
        this.bossBuffMult = 2.0;
        
        // 4. Celebration: Fireworks for 10 seconds
        this.fireworkTimer = 10.0;
        
        this.floatingTexts.push(new FloatingText(b.x + b.w/2, b.y, "BOSS DEFEATED! FULL HEAL & ATK UP!", "#00ff88"));
    }
}

// ゲーム開始
if (document.readyState === 'loading') {
    window.addEventListener('DOMContentLoaded', () => { window._game = new Game(); });
} else {
    window._game = new Game();
}
