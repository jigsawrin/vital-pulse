// 物理定数
export const GROUND_Y = 520;
const GRAVITY   = 1800;
const JUMP_VEL  = -760;
const MAX_FALL  = 1200;

const ROLE_STATS = {
    TANK:     { hp: 500, speed: 160, dmg: 20, range: 70,  cd: 0.45, color: '#4488ff' },
    ATTACKER: { hp: 150, speed: 190, dmg: 15, range: 110, cd: 0.18, color: '#ffaa00' },
    FLANKER:  { hp:  90, speed: 220, dmg: 28, range: 65,  cd: 0.20, color: '#00ffaa' },
};

const ROLE_FRAMES = {
    TANK:     { WALK: 6, ATTACK: 6, ULT: 7 },
    ATTACKER: { WALK: 6, ATTACK: 6, ULT: 6 },
    FLANKER:  { WALK: 6, ATTACK: 7, ULT: 8 },
};

const ROLE_ULT_SPEECH = {
    TANK:     '一歩も引かん！',
    ATTACKER: '全弾発射！',
    FLANKER:  '後ろがお留守だぜ。',
};

// ────────────────────────────────────────────
// スプライトシート管理
// ────────────────────────────────────────────
class SpriteSheet {
    constructor(src, frames) {
        this.img = new Image();
        this.img.src = src;
        this.frameCount = frames;
        this.loaded = false;
        this.img.onload = () => { this.loaded = true; };
        this.curFrame = 0;
        this.timer    = 0;
        this.speed    = 0.12; // 秒/フレーム
    }

    update(dt) {
        this.timer += dt;
        if (this.timer >= this.speed) {
            this.curFrame = (this.curFrame + 1) % this.frameCount;
            this.timer = 0;
        }
    }

    draw(ctx, x, y, w, h, flipX = false) {
        if (!this.loaded || !this.img.naturalWidth) return;
        const fw = this.img.naturalWidth / this.frameCount;
        ctx.save();
        if (flipX) {
            ctx.translate(x + w, y);
            ctx.scale(-1, 1);
            ctx.drawImage(this.img, fw * this.curFrame, 0, fw, this.img.naturalHeight, 0, 0, w, h);
        } else {
            ctx.drawImage(this.img, fw * this.curFrame, 0, fw, this.img.naturalHeight, x, y, w, h);
        }
        ctx.restore();
    }
}

// ────────────────────────────────────────────
// 物理サブシステム（共通）
// ────────────────────────────────────────────
export function applyPhysics(e, dt, platforms) {
    if (e.role === 'FLANKER' && e.isUlting) return; // FLANKER ULT中は物理無視

    e.vy = Math.min(e.vy + GRAVITY * dt, MAX_FALL);
    e.x += e.vx * dt;
    e.x  = Math.max(0, e.x);

    const prevBottom = e.y + e.h;
    e.y += e.vy * dt;
    e.onGround = false;

    // 地面
    if (e.y + e.h >= GROUND_Y) {
        e.y = GROUND_Y - e.h;
        e.vy = 0;
        e.onGround = true;
        return;
    }

    // プラットフォーム（上面のみ）
    if (e.vy >= 0) {
        for (const p of platforms) {
            if (e.x + e.w > p.x + 2 && e.x < p.x + p.w - 2) {
                const newBottom = e.y + e.h;
                if (prevBottom <= p.y + 4 && newBottom >= p.y) {
                    e.y  = p.y - e.h;
                    e.vy = 0;
                    e.onGround = true;
                    break;
                }
            }
        }
    }
}

// ────────────────────────────────────────────
// Platform
// ────────────────────────────────────────────
export class Platform {
    constructor(x, y, w, h = 18) {
        this.x = x; this.y = y; this.w = w; this.h = h;
    }

    draw(ctx, camX) {
        const sx = this.x - camX;
        // 押し出されて見えない場合はスキップ
        if (sx + this.w < 0 || sx > 1280) return;
        const g = ctx.createLinearGradient(0, this.y, 0, this.y + this.h);
        g.addColorStop(0, '#00ccff');
        g.addColorStop(1, '#003355');
        ctx.fillStyle = g;
        ctx.fillRect(sx, this.y, this.w, this.h);
        // 上面グロー
        ctx.fillStyle = 'rgba(0,255,255,0.55)';
        ctx.fillRect(sx, this.y, this.w, 3);
    }
}

// Player クラスは廃止（アナは画面外のヒーラー）

// ────────────────────────────────────────────
// Ally（味方NPC）
// ────────────────────────────────────────────
export class Ally {
    constructor(id, role, x, y) {
        this.id   = id;
        this.role = role;
        const s   = ROLE_STATS[role];
        this.maxHp = s.hp;  this.hp = s.hp;
        this.speed = s.speed;
        this.attackRange = s.range;
        this.attackCd    = s.cd;
        this.attackTimer = 0;

        this.x = x; this.y = y;
        this.w = 52; this.h = 80;
        this.vx = 0; this.vy = 0;
        this.onGround   = false;
        this.facingRight = true;

        this.state     = 'WALK';
        this.ultCharge = 0;
        this.isUlting  = false;
        this.ultTimer  = 0;
        this.ultReadySignaled = false; // SE再生済みフラグ
        this.jumpCd    = 0;
        this._wantsJump = false;

        this.alive = true;
        this.isDying = false;
        this.deathTimer = 0;
        this.deathLine = '';

        // 役割固有フィールド
        // TANK
        this.guardCd     = 0;
        this.guardActive = false;
        this.guardTimer  = 0;
        // FLANKER
        this.flankPhase  = 'seek'; // 'seek' | 'burst' | 'retreat'
        this.flankTimer  = 0;
        this.flankDir    = -1;

        const base = `./assets/characters/${role.toLowerCase()}`;
        const fr   = ROLE_FRAMES[role];
        this.sprites = {
            WALK:   new SpriteSheet(`${base}_walk.png`,   fr.WALK),
            ATTACK: new SpriteSheet(`${base}_attack.png`, fr.ATTACK),
            ULT:    new SpriteSheet(`${base}_ult.png`,    fr.ULT),
        };

        // セリフ
        this.speechText  = '';
        this.speechTimer = 0;
        this.speechCooldown = 0;
    }

    update(dt, enemies, bosses, platforms, groupCenterX) {
        if (this.attackTimer > 0) this.attackTimer -= dt;
        if (this.jumpCd      > 0) this.jumpCd      -= dt;
        if (this.isUlting) {
            this.ultTimer -= dt;
            if (this.ultTimer <= 0) {
                this.isUlting = false;
                this.state = 'WALK';
                window._lastUltEndTime = Date.now() / 1000; // インターバル用の終了時刻を記録
            }
        }
        if (this.speechTimer > 0) this.speechTimer -= dt;
        if (this.speechCooldown > 0) this.speechCooldown -= dt;

        // --- 死亡処理 ---
        if (this.hp <= 0 && this.alive && !this.isDying) {
            const TOXIC_LINES = [
                "GG no heal", "healer gap", "diff", "garbage heals", 
                "where are the heals??", "report healer plz", "stuck in ELO hell",
                "支えきれんわ...", "ヒール薄すぎ", "DPS diff", "Tank diff",
                "go next", "uninstall plz", "my back hurts", "healer throw",
                "switch plz", "trash sup", "can't hit shots", "no peel",
                "useless healer", "HEAL??", "report support", "i'm done", "Kthxbye",
                "you throw", "support gap", "no follow up", "ez game"
            ];
            this.deathLine = TOXIC_LINES[Math.floor(Math.random() * TOXIC_LINES.length)];
            this.isDying = true;
            this.deathTimer = 3.5; // 3.5 seconds to be revived
            this.vx = 0;
            this.isUlting = false;
        }

        if (this.isDying) {
            // 回復されたら復活
            if (this.hp > 0) {
                this.isDying = false;
                this.deathLine = '';
                return;
            }
            this.deathTimer -= dt;
            if (this.deathTimer <= 0) {
                this.alive = false;
                window.dispatchEvent(new CustomEvent('ally-dead'));
            }
            return; // 死亡中は移動や攻撃をしない
        }

        // --- ターゲット統合 (雑魚 + ボス) ---
        const combined = [...enemies, ...bosses];
        const live = combined.filter(e => e.alive);

        // 低HPセリフ
        if (this.hp < this.maxHp * 0.3 && this.speechCooldown <= 0) {
            const lowQuotes = {
                TANK:     ['ヒールはまだか！？', '応援たのむ！', '限界だ...！'],
                ATTACKER: ['I Need Healing!', '援護を！', '下がらせてもらう！'],
                FLANKER:  ['回復が必要だ！', '一旦ひくぜ！', '誰かヒールを！']
            };
            const quotes = lowQuotes[this.role];
            this.speechText = quotes[Math.floor(Math.random() * quotes.length)];
            this.speechTimer = 2.0;
            this.speechCooldown = 5.0 + Math.random() * 5;
        }

        // HP自然回復
        this.hp = Math.min(this.maxHp, this.hp + dt * 1.0);

        // 役割別AI
        switch (this.role) {
            case 'TANK':     this._tankAI(dt, live, groupCenterX); break;
            case 'ATTACKER': this._attackerAI(dt, live, groupCenterX); break;
            case 'FLANKER':  this._flankerAI(dt, live, groupCenterX); break;
        }

        // ULT発動判定
        if (this.ultCharge >= 100 && !this.isUlting) {
            // 溜まってすぐに打つのを防ぐため、ランダムな待機時間を設ける
            if (this.ultWaitTimer === undefined) {
                this.ultWaitTimer = 1.0 + Math.random() * 3.0; // 1～4秒の思考時間
            }
            
            if (this.ultWaitTimer > 0) {
                this.ultWaitTimer -= dt;
            } else {
                let shouldUlt = false;
                const allies = window._game ? window._game.allies : [];
                const anyAllyUlting = allies.some(a => a.isUlting);
                const nowSec = Date.now() / 1000;
                const cooldownPassed = !window._lastUltEndTime || (nowSec - window._lastUltEndTime > 3.0);

                const bosses = window._game ? window._game.bosses : [];
                const anyBossPresent = bosses.length > 0;

                // 誰かが発動中、または発動直後（3秒間）は待機（無駄打ち防止）
                if (!anyAllyUlting && cooldownPassed) {
                    if (anyBossPresent) {
                        // ボス戦なら即座に発動
                        shouldUlt = true;
                    } else if (this.role === 'TANK') {
                        const closeEnemies = live.filter(e => Math.abs(e.x - this.x) < 400).length;
                        const allyPinch = allies.some(a => a.hp < a.maxHp * 0.4);
                        // さらに閾値を引き上げ (5 -> 7)
                        if (closeEnemies >= 7 || allyPinch) shouldUlt = true;
                    } else if (this.role === 'ATTACKER') {
                        // さらに閾値を引き上げ (6 -> 8)
                        const midEnemies = live.filter(e => Math.abs(e.x - this.x) < 800).length;
                        if (midEnemies >= 8) shouldUlt = true;
                    } else if (this.role === 'FLANKER') {
                        // さらに閾値を引き上げ (5 -> 7)
                        const farEnemies = live.filter(e => Math.abs(e.x - this.x) < 1000).length;
                        if (farEnemies >= 7) shouldUlt = true;
                    } else {
                        shouldUlt = true;
                    }
                }

                if (shouldUlt) {
                    this.triggerUlt();
                }
            }
        } else {
            this.ultWaitTimer = undefined; // ゲージが減ったり使用中の場合はリセット
        }

        // ジャンプ実行
        if (this._wantsJump && this.onGround && this.jumpCd <= 0) {
            this.vy = JUMP_VEL;
            this.jumpCd = 0.9;
            this._wantsJump = false;
        }

        applyPhysics(this, dt, platforms);
        (this.sprites[this.state] || this.sprites.WALK).update(dt);

        // ─── ULTチャージ・SE通知 ───
        if (!this.isUlting) {
            if (this.ultCharge < 100) {
                this.ultCharge += dt * 3.5; // 自然充填
            }
            if (this.ultCharge >= 100) {
                this.ultCharge = 100;
                if (!this.ultReadySignaled) {
                    window.dispatchEvent(new CustomEvent('ultimate-ready', { detail: { role: this.role } }));
                    this.ultReadySignaled = true;
                }
            }
        }
    }

    triggerUlt() {
        if (this.isUlting || this.isDying || this.ultCharge < 100) return;
        this.isUlting = true;
        this.ultCharge = 0;
        
        // ロール別持続時間
        if (this.role === 'TANK')     this.ultTimer = 5.0;
        else if (this.role === 'ATTACKER') this.ultTimer = 5.0;
        else if (this.role === 'FLANKER')  this.ultTimer = 3.5;
        else this.ultTimer = 4.0;

        this.state = 'ULT';
        this.ultReadySignaled = false; // リセット
        
        window.dispatchEvent(new CustomEvent('ultimate-start', {
                    detail: { role: this.role, speech: ROLE_ULT_SPEECH[this.role] }
                }));
        if (window._game) {
            window._game._ultCount = (window._game._ultCount || 0) + 1;
            const allies = window._game ? window._game.allies : [];
             if (allies.filter(a => a.isUlting).length >= 2) {
                 return;
             }
            // 強制的にゲームオーバーか停止させたいが、とりあえずフリーズ回避のためisUltingを維持
        }

        // ロール別 SE
        if (this.role === 'TANK') {
            window.dispatchEvent(new CustomEvent('tank-ult-impact'));
            window.dispatchEvent(new CustomEvent('tank-ult-hum', { detail: { duration: 5.0 } }));
        }
    }

    // ─────── TANK AI ──────────────────────────────
    // 役割：前衛壁。3体以上に囲まれたらガードチャージ → AOEノックバック＋スタン
    _tankAI(dt, live, groupCenterX) {
        if (this.guardCd > 0) this.guardCd -= dt;

        const close = live.filter(e => Math.abs(e.x - this.x) < 200);

        // ガード発動条件: 3体以上 or HP40%以下
        if (!this.guardActive && this.guardCd <= 0 &&
            (close.length >= 3 || (this.hp < this.maxHp * 0.4 && live.length > 0))) {
            this.guardActive = true;
            this.guardTimer  = 1.0; // 1秒チャージ
        }

        if (this.guardActive) {
            this.guardTimer -= dt;
            this.vx  *= 0.6; // ガード中は減速
            this.state = this.isUlting ? 'ULT' : 'ATTACK';

            if (this.guardTimer <= 0) {
                // ── ガード爆発！──
                live.forEach(e => {
                    const dx   = (e.x + e.w / 2) - (this.x + this.w / 2);
                    const dist = Math.abs(dx);
                    if (dist < 300) { // 半径拡大
                        const force = (300 - dist) / 300 * 1050; // ノックバック強化
                        e.knockback(Math.sign(dx || 1) * force);
                        e.stun(2.2); // スタン時間延長
                        e.applyDamage(ROLE_STATS.TANK.dmg * 3); // ダメージ強化
                        if (!this.isUlting) this.ultCharge = Math.min(100, this.ultCharge + 5);
                    }
                });
                this.guardActive = false;
                this.guardCd     = 3.5; // クールダウン短縮
                window.dispatchEvent(new CustomEvent('vp-explosion',
                    { detail: { x: this.x + this.w / 2, y: this.y + this.h / 2, heal: false } }));
            }
            return;
        }

        // 通常：最寄りの敵へ向かい近接攻撃
        if (live.length > 0) {
            const t  = live.reduce((a, b) => Math.abs(b.x - this.x) < Math.abs(a.x - this.x) ? b : a);
            const dx = (t.x + t.w / 2) - (this.x + this.w / 2);
            
            // 低HP時は消極的：敵が近くにいてもグループ中心へ戻ろうとする
            if (this.hp < this.maxHp * 0.3) {
                const backDx = groupCenterX - this.x;
                this.vx = Math.abs(backDx) > 40 ? Math.sign(backDx) * this.speed * 0.8 : 0;
                this.state = 'WALK';
                this.facingRight = backDx > 0;
                return;
            }

            this.facingRight = dx > 0;
            if (Math.abs(dx) > this.attackRange) {
                this.vx    = Math.sign(dx) * this.speed;
                this.state = this.isUlting ? 'ULT' : 'WALK';
                // 実際に定プラットに呪えるときのみジャンプ（閾値150px≈最大ジャンプ高度）
                if (t.y < this.y - 150 && this.onGround && this.jumpCd <= 0) this._wantsJump = true;
            } else {
                this.vx    = 0;
                this.state = this.isUlting ? 'ULT' : 'ATTACK';
                if (this.attackTimer <= 0) {
                    t.applyDamage(ROLE_STATS.TANK.dmg);
                    if (!this.isUlting) this.ultCharge = Math.min(100, this.ultCharge + 6);
                    this.attackTimer = this.attackCd;
                }
            }
        } else {
            const dx = groupCenterX - this.x;
            this.vx  = Math.abs(dx) > 50 ? Math.sign(dx) * this.speed * 0.5 : 0;
            this.state = 'WALK'; this.facingRight = dx > 0;
            this._wantsJump = false; // 敵なし→ジャンプ抑制
        }
    }

    // ─────── ATTACKER AI ─────────────────────────
    // 役割：中距離フィニッシャー。HP最低の敵を優先し最適距離を維持して連射。
    // ULT時：5秒間、移動しながら前方に無数の弾丸（レーザー）を連射し続ける。
    _attackerAI(dt, live, groupCenterX) {
        let target = null, lowestHp = Infinity;
        for (const e of live) {
            if (Math.abs(e.x - this.x) < 600 && e.hp < lowestHp) {
                lowestHp = e.hp; target = e;
            }
        }
        if (!target && live.length > 0) {
            target = live.reduce((a, b) => Math.abs(b.x - this.x) < Math.abs(a.x - this.x) ? b : a);
        }

        if (target) {
            const dx    = (target.x + target.w / 2) - (this.x + this.w / 2);
            const absDx = Math.abs(dx);
            
            // 首振り：通常時は対象を向くが、接敵状況によって維持
            this.facingRight = dx > 0;

            // 低HP時はもっと離れる
            const retreatDist = this.hp < this.maxHp * 0.3 ? 200 : 130;
            const keepDist    = this.hp < this.maxHp * 0.3 ? 120 : 60;

            if (absDx > retreatDist) {           // 遠い → 近づく
                this.vx    = Math.sign(dx) * this.speed;
                this.state = this.isUlting ? 'ULT' : 'WALK';
                if (target.y < this.y - 150 && this.onGround && this.jumpCd <= 0) this._wantsJump = true;
            } else if (absDx < keepDist) {     // 近すぎ → 後退
                this.vx    = -Math.sign(dx) * this.speed * 0.7; // ちょっと速めに後退
                this.state = this.isUlting ? 'ULT' : 'WALK';
            } else {                     // 最適距離: 停止して連射（またはULT）
                this.vx    = 0;
                this.state = this.isUlting ? 'ULT' : 'ATTACK';
                if (!this.isUlting && this.attackTimer <= 0) {
                    target.applyDamage(ROLE_STATS.ATTACKER.dmg);
                    this.ultCharge = Math.min(100, this.ultCharge + 8);
                    this.attackTimer = this.attackCd;
                }
            }
        } else {
            const dx = groupCenterX - this.x;
            this.vx  = Math.abs(dx) > 50 ? Math.sign(dx) * this.speed * 0.6 : 0;
            this.state = this.isUlting ? 'ULT' : 'WALK';
            this.facingRight = dx > 0;
            this._wantsJump = false; // 敵なし→ジャンプ抑制
        }

        // --- ULT 状態の連射処理 ---
        if (this.isUlting) {
            this.state = 'ULT'; // 移動中でもアニメーションはULT固定
            if (this.ultShootTimer === undefined) this.ultShootTimer = 0;
            this.ultShootTimer -= dt;
            if (this.ultShootTimer <= 0) {
                // 発射のディスパッチ
                const bulletDmg = ROLE_STATS.ATTACKER.dmg * 0.7; // 威力アップ (0.4 -> 0.7)
                const bulletVx = (this.facingRight ? 1 : -1) * 1400; // 超高速弾丸
                const bx = this.facingRight ? this.x + this.w : this.x - 30;
                const by = this.y + 62 + (Math.random() * 10 - 5); // 弾道をさらに低く調整 (48 -> 62)
                window.dispatchEvent(new CustomEvent('vp-bullet', {
                    detail: { x: bx, y: by, vx: bulletVx, dmg: bulletDmg }
                }));
                window.dispatchEvent(new CustomEvent('attacker-ult-fire'));
                this.ultShootTimer = 0.06; // 連射速度アップ (0.08 -> 0.06)
            }
        }
    }

    // ─────── FLANKER AI ──────────────────────────
    // 役割：三段突撃。seek→burst（連続攻撃）→retreat を繰り返す。
    _flankerAI(dt, live, groupCenterX) {
        // --- ULT状態（重力無視の超高速連続ダッシュ） ---
        if (this.isUlting) {
            this.state = 'ULT';
            if (!this.ultDashTimer) this.ultDashTimer = 0;
            this.ultDashTimer -= dt;

            // ターゲット再選定＆ダッシュ開始
            if (!this.ultTarget || !this.ultTarget.alive || this.ultDashTimer <= 0) {
                if (live.length > 0) {
                    // 画面外に飛ばないよう近接した敵（距離1000以内）を優先
                    const onScreen = live.filter(e => Math.abs(e.x - this.x) < 1000);
                    const targets = onScreen.length > 0 ? onScreen : live;
                    this.ultTarget = targets[Math.floor(Math.random() * targets.length)];
                    this.ultDashTimer = 0.25;
                    const dx = (this.ultTarget.x + this.ultTarget.w/2) - (this.x + this.w/2);
                    const dy = (this.ultTarget.y + this.ultTarget.h/2) - (this.y + this.h/2);
                    this.facingRight = dx > 0;
                    
                    // 0.15秒で貫通する凄まじい速度
                    this.vx = (dx / 0.15) * 1.5;
                    this.vy = (dy / 0.15) * 1.5;
                    
                    this.ultTarget.applyDamage(ROLE_STATS.FLANKER.dmg * 1.5); // 一撃必殺から控えめに変更
                    
                    const angle = Math.atan2(dy, dx);
                    window.dispatchEvent(new CustomEvent('vp-slash', {
                        detail: { x: this.ultTarget.x + this.ultTarget.w/2, y: this.ultTarget.y + this.ultTarget.h/2, angle: angle + (Math.random()-0.5) }
                    }));
                    window.dispatchEvent(new CustomEvent('vp-dashline', {
                        detail: { sx: this.x + this.w/2, sy: this.y + this.h/2, ex: this.ultTarget.x + this.ultTarget.w/2, ey: this.ultTarget.y + this.ultTarget.h/2 }
                    }));
                    window.dispatchEvent(new CustomEvent('flanker-ult-slice'));
                } else {
                    // 敵がいない場合は斜め上空へ飛び回る
                    this.ultDashTimer = 0.25;
                    this.facingRight = Math.random() > 0.5;
                    const dashDist = 400;
                    const dx = (this.facingRight ? 1 : -1) * dashDist;
                    const dy = -dashDist * (0.3 + Math.random() * 0.7); // 斜め上
                    this.vx = dx / 0.15;
                    this.vy = dy / 0.15;

                    window.dispatchEvent(new CustomEvent('vp-dashline', {
                        detail: { sx: this.x + this.w/2, sy: this.y + this.h/2, ex: this.x + this.w/2 + dx, ey: this.y + this.h/2 + dy }
                    }));
                }
            }
            
            // 自前で座標更新（物理無視のため）
            this.x += this.vx * dt;
            this.y += this.vy * dt;
            if (this.y + this.h > GROUND_Y) {
                this.y = GROUND_Y - this.h;
                this.vy = 0;
                this.vx *= 0.9;
            }
            if (this.y < 0) { this.y = 0; this.vy = 0; }
            return;
        }

        if (this.flankTimer > 0) this.flankTimer -= dt;

        switch (this.flankPhase) {
            case 'seek': {
                if (live.length === 0) {
                    // 敵なし → グループ中心に归る、ジャンプしない
                    const dx = groupCenterX - this.x;
                    this.vx = Math.abs(dx) > 50 ? Math.sign(dx) * this.speed * 0.7 : 0;
                    this.state = 'WALK';
                    this.facingRight = dx > 0;
                    this._wantsJump = false;
                    break;
                }

                // 低HP時は突撃を中止
                if (this.hp < this.maxHp * 0.3) {
                    const backDx = groupCenterX - this.x;
                    this.vx = Math.abs(backDx) > 40 ? Math.sign(backDx) * this.speed * 0.8 : 0;
                    this.state = 'WALK';
                    this.facingRight = backDx > 0;
                    break;
                }

                // グループ中心に最も近い敵を標的に（前進しすぎ防止・協力戦闢）
                const ft  = live.reduce((a, b) =>
                    Math.abs(b.x - groupCenterX) < Math.abs(a.x - groupCenterX) ? b : a);
                const dx  = (ft.x + ft.w / 2) - (this.x + this.w / 2);
                this.facingRight = dx > 0;
                this.vx    = Math.sign(dx) * this.speed;
                this.state = 'WALK';
                // seekフェーズではジャンプしない（地上戦を基本に）
                if (Math.abs(dx) < this.attackRange) {
                    this.flankPhase = 'burst';
                    this.flankTimer = 1.8;
                }
                break;
            }
            case 'burst': {
                // 低HP時は即中断
                if (this.flankTimer <= 0 || this.hp < this.maxHp * 0.3) {
                    this.flankPhase = 'retreat';
                    this.flankTimer = 0.7;
                    // グループ中心方向へ退く
                    this.flankDir = (this.x > groupCenterX) ? -1 : 1;
                    break;
                }
                // 最寄りの敵を素早く連続攻撃
                if (live.length > 0) {
                    const ce = live.reduce((a, b) =>
                        Math.abs(b.x - this.x) < Math.abs(a.x - this.x) ? b : a);
                    this.facingRight = (ce.x > this.x);
                    this.vx    = 0;
                    this.state = 'ATTACK';
                    if (this.attackTimer <= 0) {
                        ce.applyDamage(ROLE_STATS.FLANKER.dmg);
                        // 巻き込みダメージ（周囲50px）
                        live.filter(e => e !== ce && Math.abs(e.x - this.x) < 50)
                            .forEach(e => e.applyDamage(ROLE_STATS.FLANKER.dmg * 0.4));
                        if (!this.isUlting) this.ultCharge = Math.min(100, this.ultCharge + 10);
                        this.attackTimer = this.attackCd;
                    }
                }
                break;
            }
            case 'retreat': {
                if (this.flankTimer <= 0) { this.flankPhase = 'seek'; break; }
                this.vx = this.flankDir * this.speed * 0.9; // 退却（速すぎない）
                this.facingRight = this.vx > 0;
                this.state = 'WALK';
                // 退却中はジャンプしない
                break;
            }
        }
    }


    damage(amount) {
        if (this.isUlting) return; // ウルト中は無敵
        this.hp = Math.max(0, this.hp - amount);
        this.ultCharge = Math.min(100, this.ultCharge + 3);
    }
    heal(amount) { this.hp = Math.min(this.maxHp, this.hp + amount); }

    draw(ctx, camX) {
        const sx = this.x - camX;
        if (sx + this.w < -20 || sx > 1300) return;

        const sp = this.sprites[this.state] || this.sprites.WALK;
        
        ctx.save();
        if (this.isDying) {
            // 瀕死状態の点滅エフェクト (150ms間隔)
            ctx.globalAlpha = (Math.floor(Date.now() / 150) % 2 === 0) ? 1.0 : 0.2;
            const spr = this.sprites.WALK;
            const curH = this.h * 0.45;      // しゃがみこみ演出
            const curY = this.y + (this.h - curH);
            spr.draw(ctx, sx, curY, this.w, curH, !this.facingRight);

            // ── 大きな煽り吹き出し ──
            if (this.deathLine) {
                ctx.save();
                ctx.globalAlpha = 1.0;
                ctx.font = 'bold 24px "Outfit", sans-serif';
                const metrics = ctx.measureText(this.deathLine);
                const paddingW = 32; // さらに余裕を持たせる
                const bw = metrics.width + paddingW * 2;
                const bh = 56;
                
                // 画面端で見切れないようにX位置を調整
                const VW = 1024; // ワールド可視幅 (1280 / ZOOM)
                let bx = sx + this.w / 2 - bw / 2;
                if (bx < 20) bx = 20;
                if (bx + bw > VW - 20) bx = VW - 20 - bw;
                const by = curY - bh - 30;

                // 吹き出しの箱 (影付き)
                ctx.shadowColor = 'rgba(0,0,0,0.6)';
                ctx.shadowBlur = 15;
                ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.roundRect(bx, by, bw, bh, 12);
                ctx.fill();
                ctx.shadowBlur = 0;

                // 下の三角 (キャラを指す)
                ctx.beginPath();
                ctx.moveTo(sx + this.w/2 - 14, by + bh);
                ctx.lineTo(sx + this.w/2 + 14, by + bh);
                ctx.lineTo(sx + this.w/2, by + bh + 16);
                ctx.fill();

                // テキスト
                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';
                ctx.fillStyle = '#ff0000'; // 怒りの赤
                ctx.fillText(this.deathLine, bx + bw/2, by + bh/2 + 2);
                ctx.restore();
            }
        } else {
            sp.draw(ctx, sx, this.y, this.w, this.h, !this.facingRight);
        }
        ctx.restore();

        // ULT中グロー
        if (this.isUlting) {
            ctx.save();
            ctx.globalAlpha = 0.28 + Math.sin(Date.now() * 0.012) * 0.15;
            ctx.fillStyle = ROLE_STATS[this.role].color;
            ctx.fillRect(sx, this.y, this.w, this.h);
            ctx.restore();
        }

        // タンクのガードチャージビジュアル
        if (this.guardActive) {
            const cx = sx + this.w / 2, cy = this.y + this.h / 2;
            const prog = 1 - this.guardTimer / 1.0; // 0→1
            ctx.save();
            // 青白いシールドグロー
            ctx.globalAlpha = 0.25 + Math.sin(Date.now() * 0.02) * 0.15;
            ctx.fillStyle = '#88ccff';
            ctx.beginPath(); ctx.arc(cx, cy, 55, 0, Math.PI * 2); ctx.fill();
            // チャージアーク
            ctx.globalAlpha = 0.9;
            ctx.strokeStyle = '#ffffff';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(cx, cy, 60, -Math.PI / 2, -Math.PI / 2 + prog * Math.PI * 2);
            ctx.stroke();
            // GOの文字
            if (prog > 0.8) {
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 14px monospace';
                ctx.textAlign = 'center';
                ctx.fillText('GUARD!', cx, this.y - 22);
            }
            ctx.restore();
        }

        if (!this.isDying) {
            // オーバーヘッドUI（名前・HPバー）
            this._drawOverheadUI(ctx, sx + this.w / 2, this.y - 12);

            // 吹き出し
            if (this.speechTimer > 0) {
                this._drawSpeechBubble(ctx, sx + this.w / 2, this.y - 35); // UIが重ならないよう少し上に
            }
        }
    }

    _drawOverheadUI(ctx, x, y) {
        ctx.save();
        const bw = 64, bh = 6;
        const bx = x - bw / 2, by = y - bh;

        // 1段目: ロール名
        ctx.font = 'bold 12px Outfit, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = ROLE_STATS[this.role].color;
        ctx.shadowColor = 'rgba(0,0,0,0.8)';
        ctx.shadowBlur = 4;
        ctx.fillText(this.role, x, by - 8);

        // 2段目: HPバー
        // 背景
        ctx.shadowBlur = 0;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(bx, by, bw, bh);
        
        // メインバー
        const hpPct = Math.max(0, this.hp / this.maxHp);
        let hpCol = '#00ff88';
        if (hpPct < 0.3) hpCol = '#ff4422';
        else if (hpPct < 0.6) hpCol = '#ffcc00';
        
        ctx.fillStyle = hpCol;
        ctx.fillRect(bx, by, bw * hpPct, bh);
        
        // 枠線
        ctx.strokeStyle = 'rgba(255,255,255,0.3)';
        ctx.lineWidth = 1;
        ctx.strokeRect(bx, by, bw, bh);

        ctx.restore();
    }

    _drawSpeechBubble(ctx, x, y) {
        ctx.save();
        ctx.font = 'bold 12px sans-serif';
        const metrics = ctx.measureText(this.speechText);
        const bw = metrics.width + 16, bh = 22;
        const bx = x - bw / 2, by = y - bh;

        // 吹き出し本体（白）
        ctx.fillStyle = '#fff';
        ctx.shadowColor = 'rgba(0,0,0,0.5)';
        ctx.shadowBlur = 6;
        ctx.beginPath();
        ctx.roundRect(bx, by, bw, bh, 4);
        ctx.fill();

        // 吹き出しの尻尾
        ctx.beginPath();
        ctx.moveTo(x - 5, y - bh + 22);
        ctx.lineTo(x, y - bh + 28);
        ctx.lineTo(x + 5, y - bh + 22);
        ctx.fill();

        // テキスト
        ctx.shadowBlur = 0;
        ctx.fillStyle = '#d33'; // 赤文字で緊急感を出す
        ctx.textAlign = 'center';
        ctx.fillText(this.speechText, x, by + 15);
        ctx.restore();
    }

}

// ────────────────────────────────────────────
// Enemy
// ────────────────────────────────────────────
export class Enemy {
    constructor(x, y, type = 'NORMAL') {
        this.type  = type;
        this.alive = true;
        this.x = x; this.y = y;
        this.w = type === 'HEAVY' ? 58 : 40;
        this.h = type === 'HEAVY' ? 72 : 52;
        // 無双スタイル：HP半減で倒しやすく
        this.maxHp = type === 'HEAVY' ? 100 : (type === 'SCOUT' ? 20 : 40);
        this.hp    = this.maxHp;
        this.speed = type === 'SCOUT' ? 170 : (type === 'HEAVY' ? 55 : 95);
        this.dmg   = type === 'HEAVY' ? 18 : 8;
        this.vx = -this.speed;
        this.vy = 0;
        this.onGround  = false;
        this.flashTimer  = 0;
        this.jumpTimer   = 1 + Math.random() * 2;
        this.attackTimer = 0;
        // スタン・ノックバック用
        this.stunTimer = 0;
        this.stunVx    = 0;
    }

    applyDamage(amount) {
        this.hp -= amount;
        this.flashTimer = 0.08;
        if (this.hp <= 0 && this.alive) this.alive = false;
    }

    // ガード爆発などによるノックバック
    knockback(impulse) { this.stunVx = impulse; }

    // スタン（移動停止）
    stun(duration) { this.stunTimer = Math.max(this.stunTimer, duration); }

    update(dt, platforms, allies) {
        if (!this.alive) return;
        if (this.flashTimer > 0) this.flashTimer -= dt;

        if (this.stunTimer > 0) {
            // スタン中：ノックバック摩擦だけ適用、攻撃不可
            this.stunTimer -= dt;
            this.vx = this.stunVx;
            this.stunVx *= Math.max(0, 1 - dt * 5); // 摩擦で減衰
        } else {
            // 通常移動
            this.vx = -this.speed;
            this.jumpTimer -= dt;
            if (this.onGround && this.jumpTimer <= 0) {
                this.vy = JUMP_VEL * (0.5 + Math.random() * 0.4);
                this.jumpTimer = 1.5 + Math.random() * 2.5;
            }
            // タンクULTバリア判定
            const tank = allies.find(a => a.role === 'TANK' && a.isUlting);
            let blocked = false;
            if (tank) {
                const frontX = Math.max(...allies.map(a => a.x + a.w));
                const barrierX = frontX + 30;
                if (this.x < barrierX && this.x + this.w > barrierX - 200) {
                    this.x = barrierX;
                    this.vx = Math.max(0, this.vx);
                    blocked = true;
                }
            }

            // 味方にダメージ
            if (this.attackTimer > 0) { this.attackTimer -= dt; }
            if (!blocked) {
                for (const a of allies) {
                    const dx = Math.abs((a.x + a.w / 2) - (this.x + this.w / 2));
                    const dy = Math.abs((a.y + a.h / 2) - (this.y + this.h / 2));
                    if (dx < 40 && dy < 40 && this.attackTimer <= 0) {
                        a.damage(this.dmg);
                        this.attackTimer = 0.8;
                    }
                }
            }
        }

        applyPhysics(this, dt, platforms);
    }

    draw(ctx, camX) {
        if (!this.alive) return;
        const sx = this.x - camX;
        if (sx + this.w < 0 || sx > 1300) return;

        const flash   = this.flashTimer > 0;
        const stunned = this.stunTimer > 0;
        ctx.fillStyle = stunned ? '#aaddff' : (flash ? '#ffffff' :
            (this.type === 'HEAVY' ? '#ff2200' : this.type === 'SCOUT' ? '#ff9900' : '#ff4400'));

        if (this.type === 'HEAVY') {
            ctx.fillRect(sx, this.y, this.w, this.h);
            ctx.fillStyle = (flash || stunned) ? '#fff' : '#ff6600';
            ctx.beginPath();
            ctx.moveTo(sx + this.w / 2, this.y - 12);
            ctx.lineTo(sx + this.w / 2 - 10, this.y);
            ctx.lineTo(sx + this.w / 2 + 10, this.y);
            ctx.closePath();
            ctx.fill();
        } else {
            ctx.beginPath();
            ctx.roundRect(sx, this.y, this.w, this.h, 6);
            ctx.fill();
            if (!stunned) {
                ctx.fillStyle = '#fff';
                ctx.beginPath(); ctx.arc(sx + this.w * 0.35, this.y + this.h * 0.32, 5, 0, Math.PI * 2); ctx.fill();
                ctx.fillStyle = '#000';
                ctx.beginPath(); ctx.arc(sx + this.w * 0.35 - 2, this.y + this.h * 0.32, 2.5, 0, Math.PI * 2); ctx.fill();
            }
        }

        // HPバー
        ctx.fillStyle = '#400'; ctx.fillRect(sx, this.y - 8, this.w, 4);
        ctx.fillStyle = '#f22'; ctx.fillRect(sx, this.y - 8, this.w * (this.hp / this.maxHp), 4);

        // スタン中：頭上に星マーク
        if (stunned) {
            ctx.fillStyle = '#ffee44';
            for (let i = 0; i < 3; i++) {
                const a = Date.now() * 0.006 + i * Math.PI * 2 / 3;
                ctx.beginPath();
                ctx.arc(sx + this.w / 2 + Math.cos(a) * 14, this.y - 16, 4, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }
}


// ────────────────────────────────────────────
// Projectile（FPS精密ヒール弾）
// 1秒後に着弾。ヘッド判定でクリティカルヒール。
// ────────────────────────────────────────────
export class Projectile {
    // onHit: (worldX, worldY, type) => void   type: 'critical'|'body'|'miss'
    constructor(x, y, onHit) {
        this.x = x; this.y = y;
        this.maxLife = 0.3;   // 0.3秒後着弾（偏差うち緩和版）
        this.life    = 0.3;
        this.alive   = true;
        this.onHit   = onHit; // コールバック
    }

    update(dt, enemies, allies) {
        if (!this.alive) return false;
        this.life -= dt;
        if (this.life <= 0) {
            this._detonate(allies);
            return false;
        }
        return true;
    }

    _detonate(allies) {
        let hitAny = false;
        for (const a of allies) {
            // 頭部ゾーン: スプライト上30%・中央50%幅
            const hCX = a.x + a.w / 2;
            const hCY = a.y + a.h * 0.15;
            const hR  = a.w * 0.25; // ヘッド判定半径

            // ボディゾーン: 上30%以下の矩形全体
            const bX1 = a.x,          bX2 = a.x + a.w;
            const bY1 = a.y + a.h * 0.30, bY2 = a.y + a.h;

            const dH = Math.sqrt((this.x - hCX) ** 2 + (this.y - hCY) ** 2);
            const inBody = this.x >= bX1 && this.x <= bX2 && this.y >= bY1 && this.y <= bY2;

            if (dH < hR) {
                // ヘッドショット！クリティカルヒール
                a.heal(120);
                this.onHit && this.onHit(hCX, a.y - 10, 'critical');
                hitAny = true;
            } else if (inBody) {
                // ボディヒット：通常ヒール
                a.heal(45);
                this.onHit && this.onHit(a.x + a.w / 2, a.y + a.h * 0.5, 'body');
                hitAny = true;
            }
        }
        if (!hitAny) {
            this.onHit && this.onHit(this.x, this.y, 'miss');
        }
        window.dispatchEvent(new CustomEvent('vp-explosion', {
            detail: { x: this.x, y: this.y, heal: true }
        }));
        this.alive = false;
    }

    draw(ctx, camX) {
        const sx = this.x - camX;
        const progress = 1 - this.life / this.maxLife; // 0→1（着弾に近づく）
        const alpha = 0.5 + progress * 0.5;

        ctx.save();

        // カウントダウンアーク（残り時間を白い弧で表示）
        const remainAngle = (this.life / this.maxLife) * Math.PI * 2;
        ctx.globalAlpha = 0.85;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(sx, this.y, 14, -Math.PI / 2, -Math.PI / 2 + remainAngle);
        ctx.stroke();

        // 着弾マーカー（シアン）
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = '#00ffcc';
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.arc(sx, this.y, 10, 0, Math.PI * 2);
        ctx.stroke();

        // 十字線
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx - 16, this.y); ctx.lineTo(sx + 16, this.y);
        ctx.moveTo(sx, this.y - 16); ctx.lineTo(sx, this.y + 16);
        ctx.stroke();

        // 中心点
        ctx.fillStyle = '#00ffcc';
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.arc(sx, this.y, 2.5, 0, Math.PI * 2);
        ctx.fill();

        ctx.restore();
    }
}

// ────────────────────────────────────────────
// Explosion（視覚エフェクト）
// ────────────────────────────────────────────
export class Explosion {
    constructor(x, y, type = 'damage') {
        // type can be 'damage', 'body', or 'critical' (where body/critical refer to heals)
        // Backwards compatibility with boolean
        if (typeof type === 'boolean') type = type ? 'body' : 'damage';
        
        this.x = x; this.y = y; this.type = type;
        this.isHeal = type === 'body' || type === 'critical';
        this.life = type === 'critical' ? 0.7 : 0.5;
        
        const count = type === 'critical' ? 24 : 14;
        this.particles = Array.from({ length: count }, () => ({
            x: x, y: y,
            vx: (Math.random() - 0.5) * (type === 'critical' ? 450 : 320),
            vy: (Math.random() - 0.8) * (type === 'critical' ? 400 : 280),
            life: 1.0 + (type === 'critical' ? Math.random() * 0.5 : 0),
        }));
    }

    update(dt) {
        this.life -= dt;
        this.particles.forEach(p => {
            p.x  += p.vx * dt;
            p.y  += p.vy * dt;
            // 回復エフェクトは少し浮き上がるように重力を弱く
            p.vy += (this.isHeal ? 200 : 500) * dt; 
            p.life -= dt * 2.5;
        });
        return this.life > 0;
    }

    draw(ctx, camX) {
        const col = this.isHeal ? '#00ffcc' : '#ff6600';
        this.particles.forEach(p => {
            if (p.life <= 0) return;
            ctx.save();
            ctx.globalAlpha = Math.max(0, p.life);
            ctx.fillStyle = col;
            ctx.beginPath();
            
            if (this.isHeal) {
                // 回復時は十字(クロス)を描画
                const r = (this.type === 'critical' ? 6 : 4) * p.life;
                ctx.fillRect(p.x - camX - r, p.y - r/3, r*2, r*0.6);
                ctx.fillRect(p.x - camX - r/3, p.y - r, r*0.6, r*2);
            } else {
                ctx.arc(p.x - camX, p.y, 4 * p.life, 0, Math.PI * 2);
                ctx.fill();
            }
            
            if (this.type === 'critical') {
                 ctx.shadowColor = '#00ffcc';
                 ctx.shadowBlur = 10;
            }
            ctx.restore();
        });
    }
}

// ────────────────────────────────────────────
// SlamWave (ボス衝撃波)
// ────────────────────────────────────────────
export class SlamWave {
    constructor(x, y) {
        this.x = x; this.y = y;
        this.life = 0.8;
        this.maxLife = 0.8;
    }

    update(dt) {
        this.life -= dt;
        return this.life > 0;
    }
    draw(ctx, camX) {
        const sx = this.x - camX;
        const t = 1 - this.life / this.maxLife;
        const alpha = 1 - t;
        ctx.save();
        ctx.strokeStyle = `rgba(255, 80, 0, ${alpha})`;
        ctx.lineWidth = 12 * alpha;
        ctx.beginPath();
        ctx.ellipse(sx, this.y, t * 650, t * 120, 0, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
    }
}

// ────────────────────────────────────────────
export class FloatingText {
    constructor(x, y, text, color = '#fff') {
        this.x = x; this.y = y;
        this.text  = text;
        this.color = color;
        this.vy    = -85;
        this.life  = 1.3;
        this.maxLife = 1.3;
        this.isCrit = text.includes('CRITICAL');
    }

    update(dt) {
        this.y  += this.vy * dt;
        this.vy *= 0.93;
        this.life -= dt;
        return this.life > 0;
    }

    draw(ctx, camX) {
        if (this.life <= 0) return;
        const isMobile = window._game && window._game.isMobile;
        const alpha = Math.min(1, this.life / this.maxLife * 2);
        const size  = (this.isCrit ? 26 : 18) * (isMobile ? 1.5 : 1.0);
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.font = `bold ${size}px monospace`;
        ctx.textAlign = 'center';
        ctx.lineWidth = 4;
        ctx.strokeStyle = '#000';
        ctx.strokeText(this.text, this.x - camX, this.y);
        ctx.fillStyle = this.color;
        ctx.fillText(this.text, this.x - camX, this.y);
        ctx.restore();
    }
}

// ==========================================
// AttackerBullet クラス
// ==========================================
export class AttackerBullet {
    constructor(x, y, vx, dmg) {
        this.x = x;
        this.y = y;
        this.w = 30; // 横に長いレーザー状
        this.h = 4;
        this.vx = vx;
        this.dmg = dmg;
        this.alive = true;
        this.life = 0.8; // 寿命
    }

    update(dt, enemies, bosses) {
        this.x += this.vx * dt;
        this.life -= dt;
        if (this.life <= 0) this.alive = false;

        // 敵との衝突判定
        for (const e of enemies) {
            if (e.alive && !e.invincible && 
                this.x < e.x + e.w && this.x + this.w > e.x &&
                this.y < e.y + e.h && this.y + this.h > e.y) {
                
                e.applyDamage(this.dmg);
                this.alive = false;
                window.dispatchEvent(new CustomEvent('vp-explosion',
                    { detail: { x: this.x + (this.vx > 0 ? this.w : 0), y: this.y + this.h/2, heal: false, small: true } }));
                return;
            }
        }

        // ボスとの衝突判定
        for (const b of bosses) {
            if (b.alive && 
                this.x < b.x + b.w && this.x + this.w > b.x &&
                this.y < b.y + b.h && this.y + this.h > b.y) {
                
                b.applyDamage(this.dmg);
                this.alive = false;
                window.dispatchEvent(new CustomEvent('vp-explosion',
                    { detail: { x: this.x + (this.vx > 0 ? this.w : 0), y: this.y + this.h/2, heal: false, small: true } }));
                return;
            }
        }
    }

    draw(ctx, camX) {
        ctx.fillStyle = '#ffaa00';
        ctx.fillRect(this.x - camX, this.y, this.w, this.h);
        
        // グロー効果
        ctx.shadowColor = '#ffff00';
        ctx.shadowBlur = 10;
        ctx.fillRect(this.x - camX, this.y, this.w, this.h);
        ctx.shadowBlur = 0;
    }
}

// ────────────────────────────────────────────
// SlashEffect（フランカーの斬撃エフェクト）
// ────────────────────────────────────────────
export class SlashEffect {
    constructor(x, y, angle) {
        this.x = x;
        this.y = y;
        this.life = 0.2; // 0.2秒の瞬間発光
        this.angle = angle;
    }
    update(dt) {
        this.life -= dt;
        return this.life > 0;
    }
    draw(ctx, camX) {
        if (this.life <= 0) return;
        const progress = 1 - (this.life / 0.2);
        const length = 50 + progress * 80;
        const width  = 8 - progress * 8;
        ctx.save();
        ctx.translate(this.x - camX, this.y);
        ctx.rotate(this.angle);
        ctx.globalAlpha = this.life / 0.2;
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#00ffaa';
        ctx.shadowBlur = 15;
        // 剣戟のようなひし形
        ctx.beginPath();
        ctx.moveTo(-length/2, 0);
        ctx.lineTo(0, -width/2);
        ctx.lineTo(length/2, 0);
        ctx.lineTo(0, width/2);
        ctx.fill();
        ctx.restore();
    }
}

// ────────────────────────────────────────────
// DashLineEffect（フランカーの軌跡エフェクト）
// ────────────────────────────────────────────
export class DashLineEffect {
    constructor(sx, sy, ex, ey) {
        this.sx = sx;
        this.sy = sy;
        this.ex = ex;
        this.ey = ey;
        this.life = 0.35; 
    }
    update(dt) {
        this.life -= dt;
        return this.life > 0;
    }
    draw(ctx, camX) {
        if (this.life <= 0) return;
        const alpha = this.life / 0.35;
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = '#00ffaa';
        ctx.lineWidth = 2 + alpha * 6;
        ctx.lineCap = 'round';
        ctx.shadowColor = '#00ffaa';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.moveTo(this.sx - camX, this.sy);
        ctx.lineTo(this.ex - camX, this.ey);
        ctx.stroke();
        
        // 白いコアライン
        ctx.globalAlpha = alpha * 0.8;
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1 + alpha * 2;
        ctx.shadowBlur = 0;
        ctx.stroke();
        ctx.restore();
    }
}

// ────────────────────────────────────────────
// HitscanImpact（即着弾エフェクト）
// ────────────────────────────────────────────
export class HitscanImpact {
    constructor(x, y, type) {
        this.x = x; this.y = y;
        this.type    = type; // 'critical' | 'body' | 'miss'
        this.life    = 0.28;
        this.maxLife = 0.28;
    }
    update(dt) { this.life -= dt; return this.life > 0; }
    draw(ctx, camX) {
        if (this.life <= 0) return;
        const sx    = this.x - camX;
        const t     = 1 - this.life / this.maxLife;
        const alpha = this.life / this.maxLife;
        const r     = 8 + t * 32;
        const color = this.type === 'critical' ? '#ffff00'
                    : this.type === 'body'     ? '#00ffcc' : '#888888';
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = color;
        ctx.lineWidth   = 2.5 - t * 2;
        ctx.shadowColor = color;
        ctx.shadowBlur  = 20 * alpha;
        ctx.beginPath(); ctx.arc(sx, this.y, r, 0, Math.PI * 2); ctx.stroke();
        const cl = 14 + t * 10;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(sx - cl, this.y); ctx.lineTo(sx + cl, this.y);
        ctx.moveTo(sx, this.y - cl); ctx.lineTo(sx, this.y + cl);
        ctx.stroke();
        if (this.type === 'critical') {
            ctx.fillStyle = '#ffffff'; ctx.shadowBlur = 15;
            ctx.beginPath(); ctx.arc(sx, this.y, 3 * alpha, 0, Math.PI * 2); ctx.fill();
        }
        ctx.restore();
    }
}

// ────────────────────────────────────────────
// BossBullet（ボスの放つ弾丸）
// ────────────────────────────────────────────
export class BossBullet {
    constructor(x, y, vx, vy) {
        this.x = x; this.y = y;
        this.vx = vx; this.vy = vy;
        this.w = 12; this.h = 12;
        this.alive = true;
    }
    update(dt, allies) {
        this.x += this.vx * dt;
        this.y += this.vy * dt;
        for (const a of allies) {
            const dx = Math.abs((a.x + a.w/2) - (this.x + this.w/2));
            const dy = Math.abs((a.y + a.h/2) - (this.y + this.h/2));
            if (dx < 30 && dy < 40) {
                a.damage(15);
                this.alive = false; break;
            }
        }
        if (this.x < -100 || this.x > 3000) this.alive = false;
        return this.alive;
    }
    draw(ctx, camX) {
        const sx = this.x - camX;
        ctx.fillStyle = '#ff3300';
        ctx.shadowColor = '#ff3300'; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(sx, this.y, 6, 0, Math.PI * 2); ctx.fill();
        ctx.shadowBlur = 0;
    }
}

// ────────────────────────────────────────────
// Boss (巨大ボス敵)
// ────────────────────────────────────────────
export class Boss {
    constructor(wave, x, y) {
        this.wave = wave;
        this.x = x; this.y = y;
        this.w = 180; this.h = 240;
        this.maxHp = wave * 450;
        this.hp = this.maxHp;
        this.vx = -40; // ゆっくり進む
        this.vy = 0;
        this.onGround = false;
        this.alive = true;
        this.flashTimer = 0;
        
        this.attackTimer = 0;
        this.slamTimer = 8.0; // 強力な衝撃波
        this.shootTimer = 3.0; // 次のバーストまでの待機
        this.burstCount = 0;   // バースト内の残り弾数
        this.burstTimer = 0;   // 弾丸間の間隔
    }

    applyDamage(amount) {
        this.hp -= amount;
        this.flashTimer = 0.1;
        if (this.hp <= 0 && this.alive) {
            this.alive = false;
            // 撃破時に大量の経験値（スコア）
            if (window._game) window._game.score += this.wave * 1000;
        }
    }

    knockback(vx) {
        // ボスは巨大なのでノックバックを受けない（または極小）
    }

    stun(duration) {
        // ボスはスタンを無効化する
    }

    update(dt, platforms, allies, bossBullets) {
        if (!this.alive) return;
        if (this.flashTimer > 0) this.flashTimer -= dt;

        // --- ダイナミック移動 AI (画面内を左右に動き回る) ---
        const alliesX = allies.length > 0 
            ? allies.map(a => a.x + a.w/2).filter(x => !isNaN(x)) 
            : [this.x - 500];
        const avgAllyX = alliesX.length > 0 
            ? alliesX.reduce((s, x) => s + x, 0) / alliesX.length 
            : (window._game ? window._game.camX + 200 : this.x - 500);
        
        const camX = window._game ? window._game.camX : (this.camX || 0);
        const screenW = window._game ? window._game.VW : (window.innerWidth / (window.devicePixelRatio || 1));
        const leftLimit = camX + 50;
        const rightLimit = camX + screenW - this.w - 50;

        // 目標: 画面内のランダムな位置 or 味方の対角線上に動く意識
        if (this.bossTargetX === undefined || Math.abs(this.x - this.bossTargetX) < 20) {
            // 新しい目標座標を設定 (画面内のどこか)
            this.bossTargetX = leftLimit + Math.random() * (rightLimit - leftLimit);
        }

        let moveDir = Math.sign(this.bossTargetX - this.x);
        const moveSpeed = 160; // 少し速く
        this.vx = moveDir * moveSpeed;
        
        // 画面外へ出ないように強制制限
        if (this.x < leftLimit && this.vx < 0) this.vx = 0;
        if (this.x > rightLimit && this.vx > 0) this.vx = 0;

        this.x += this.vx * dt;
        // 異常値 (NaN) ガード
        if (isNaN(this.x)) {
            this.x = avgAllyX + 400; 
        }
        this.facingRight = (avgAllyX > this.x);

        // --- 行動パターン ---
        
        // 1. 弾丸バースト射撃 (setTimeoutの代わりにフレームベースで実装)
        if (this.burstCount > 0) {
            this.burstTimer -= dt;
            if (this.burstTimer <= 0) {
                const bulletVx = this.facingRight ? 450 : -450;
                const startX = this.facingRight ? this.x + this.w : this.x;
                bossBullets.push(new BossBullet(startX, this.y + 60 + (3 - this.burstCount) * 40, bulletVx, 0));
                
                this.burstCount--;
                this.burstTimer = 0.18; // 次の弾までの間隔
            }
        } else {
            this.shootTimer -= dt;
            if (this.shootTimer <= 0) {
                this.shootTimer = 3.0; // バースト間隔
                this.burstCount = 3;   // 3連射
                this.burstTimer = 0;   // 即座に1発目
            }
        }

        this.slamTimer -= dt;
        if (this.slamTimer <= 0) {
            this.slamTimer = 7.5;
            allies.forEach(a => {
                const d = Math.abs((a.x + a.w/2) - (this.x + this.w/2));
                if (d < 650) {
                    a.damage(45);
                    a.vx = Math.sign(a.x - this.x) * 450; 
                }
            });
            if (window._game) {
                window._game.explosions.push(new SlamWave(this.x + this.w/2, GROUND_Y));
            }
        }

        applyPhysics(this, dt, platforms);
    }

    draw(ctx, camX) {
        if (!this.alive) return;
        const sx = this.x - camX;
        const flash = this.flashTimer > 0;
        
        ctx.save();
        // 巨大なボディ
        ctx.fillStyle = flash ? '#fff' : '#222';
        ctx.strokeStyle = '#ff0000';
        ctx.lineWidth = 4;
        ctx.fillRect(sx, this.y, this.w, this.h);
        ctx.strokeRect(sx, this.y, this.w, this.h);
        
        // モノアイ
        const eyeY = this.y + 50;
        ctx.fillStyle = '#300';
        ctx.fillRect(sx + 20, eyeY, this.w - 40, 30);
        ctx.fillStyle = '#f00';
        const eyeX = sx + this.w/2 + Math.sin(Date.now()*0.005) * 40;
        ctx.beginPath(); ctx.arc(eyeX, eyeY + 15, 12, 0, Math.PI*2); ctx.fill();
        ctx.shadowColor = '#f00'; ctx.shadowBlur = 20;
        ctx.beginPath(); ctx.arc(eyeX, eyeY + 15, 6, 0, Math.PI*2); ctx.fill();
        
        // 装甲の隙間（発光）
        ctx.shadowBlur = 10;
        ctx.fillStyle = 'rgba(255, 50, 0, 0.6)';
        for(let i=1; i<4; i++) {
            ctx.fillRect(sx + 10, this.y + i*60, this.w - 20, 4);
        }
        
        ctx.restore();
    }
}
