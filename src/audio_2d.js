/**
 * Vital Pulse 2D - Sound Manager
 * Programmatic sound synthesis using Web Audio API.
 */

export class SoundManager {
    constructor() {
        this.ctx = null;
        this.mainBgm = null;
        this.gameOverBgm = null;
        this.titleBgm = null;
    }

    _init() {
        if (!this.ctx) {
            this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
        
        // BGMファイルの初期化
        if (!this.mainBgm) {
            this.mainBgm = new Audio('assets/bgm/main_theme.mp3');
            this.mainBgm.loop = true;
            this.mainBgm.volume = 0.45;
        }
        if (!this.gameOverBgm) {
            this.gameOverBgm = new Audio('assets/bgm/game_over.mp3');
            this.gameOverBgm.loop = true;
            this.gameOverBgm.volume = 0.5;
        }
        if (!this.titleBgm) {
            this.titleBgm = new Audio('assets/bgm/title.mp3');
            this.titleBgm.loop = true;
            this.titleBgm.volume = 0.5;
        }
    }

    /**
     * メインBGMの再生
     */
    playMainTheme() {
        this._init();
        this.stopAllBGM();
        this.mainBgm.play().catch(e => {});
    }

    /**
     * メインBGMの停止
     */
    stopMainTheme() {
        if (this.mainBgm) {
            this.mainBgm.pause();
            this.mainBgm.currentTime = 0;
        }
    }

    /**
     * ゲームオーバーBGMの再生
     */
    playGameOverBGM() {
        this._init();
        this.stopAllBGM();
        this.gameOverBgm.play().catch(e => {});
    }

    /**
     * タイトルBGMの再生
     */
    playTitleBGM() {
        this._init();
        this.stopAllBGM();
        this.titleBgm.play().catch(e => {});
    }

    /**
     * 全BGMの停止
     */
    stopAllBGM() {
        if (this.mainBgm) {
            this.mainBgm.pause();
            this.mainBgm.currentTime = 0;
        }
        if (this.gameOverBgm) {
            this.gameOverBgm.pause();
            this.gameOverBgm.currentTime = 0;
        }
        if (this.titleBgm) {
            this.titleBgm.pause();
            this.titleBgm.currentTime = 0;
        }
    }

    /**
     * ULT Ready SE: "シャキーン"
     * Metallic, sharp high-frequency sound.
     */
    playUltReady() {
        this._init();
        const now = this.ctx.currentTime;
        
        // Metallic part (Noise + Highpass)
        const bufferSize = this.ctx.sampleRate * 0.2;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
            data[i] = Math.random() * 2 - 1;
        }

        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'highpass';
        filter.frequency.setValueAtTime(8000, now);
        filter.Q.setValueAtTime(10, now);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);

        // Sine Tone part (The "Shakin" ping)
        const osc = this.ctx.createOscillator();
        const oscGain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(2000, now);
        osc.frequency.exponentialRampToValueAtTime(1000, now + 0.1);

        oscGain.gain.setValueAtTime(0.2, now);
        oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.2);

        osc.connect(oscGain);
        oscGain.connect(this.ctx.destination);

        noise.start(now);
        noise.stop(now + 0.2);
        osc.start(now);
        osc.stop(now + 0.2);
    }

    /**
     * Death "Ding" SE: "チーン"
     * Metallic bell-like chime played when the downed state timer expires.
     */
    playDeathDing() {
        this._init();
        const now = this.ctx.currentTime;
        
        // Base tone (Triangle for slight harmonics)
        const osc1 = this.ctx.createOscillator();
        const gain1 = this.ctx.createGain();
        osc1.type = 'triangle';
        osc1.frequency.setValueAtTime(880, now); // A5
        gain1.gain.setValueAtTime(0, now);
        gain1.gain.linearRampToValueAtTime(0.4, now + 0.02);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 1.5);
        osc1.connect(gain1);
        gain1.connect(this.ctx.destination);
        
        // High overtone (Sine for clear bell ring)
        const osc2 = this.ctx.createOscillator();
        const gain2 = this.ctx.createGain();
        osc2.type = 'sine';
        osc2.frequency.setValueAtTime(1760, now); // A6
        gain2.gain.setValueAtTime(0, now);
        gain2.gain.linearRampToValueAtTime(0.3, now + 0.01);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 2.0);
        osc2.connect(gain2);
        gain2.connect(this.ctx.destination);
        
        // Attack transient (brief high-freq ping)
        const osc3 = this.ctx.createOscillator();
        const gain3 = this.ctx.createGain();
        osc3.type = 'sine';
        osc3.frequency.setValueAtTime(3520, now); // A7
        gain3.gain.setValueAtTime(0.2, now);
        gain3.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        osc3.connect(gain3);
        gain3.connect(this.ctx.destination);

        osc1.start(now); osc1.stop(now + 2.0);
        osc2.start(now); osc2.stop(now + 2.0);
        osc3.start(now); osc3.stop(now + 0.2);
    }

    /**
     * ULT Trigger SE: "きゅぴ～～～～ん"
     * Bright, ascending frequency sweep with resonance.
     */
    playUltTrigger(duration = 0.5) {
        this._init();
        const now = this.ctx.currentTime;
        
        const osc = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();

        // Sawtooth for metallic feel, but filtered
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(8000, now + duration * 0.8);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2000, now);
        filter.frequency.exponentialRampToValueAtTime(10000, now + duration * 0.5);
        filter.Q.setValueAtTime(15, now);

        gain.gain.setValueAtTime(0.3, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + duration);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + duration);

        // Add a "ping" at the start
        const ping = this.ctx.createOscillator();
        const pingGain = this.ctx.createGain();
        ping.type = 'sine';
        ping.frequency.setValueAtTime(4000, now);
        pingGain.gain.setValueAtTime(0.2, now);
        pingGain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);
        ping.connect(pingGain);
        pingGain.connect(this.ctx.destination);
        ping.start(now); ping.stop(now + 0.1);
    }

    /**
     * Tank ULT Impact: "がっ！"
     * Heavy metal impact.
     */
    playTankUltImpact() {
        this._init();
        const now = this.ctx.currentTime;

        // Bass Thump
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(150, now);
        osc.frequency.exponentialRampToValueAtTime(40, now + 0.2);
        gain.gain.setValueAtTime(0.6, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        osc.connect(gain);
        gain.connect(this.ctx.destination);

        // Metal Clang (High frequency noise burst)
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass';
        filter.frequency.setValueAtTime(3000, now);
        filter.Q.setValueAtTime(5, now);
        
        const noiseGain = this.ctx.createGain();
        noiseGain.gain.setValueAtTime(0.4, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

        const noise = this.ctx.createBufferSource();
        const bufSize = this.ctx.sampleRate * 0.2;
        const buf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
        const data = buf.getChannelData(0);
        for(let i=0; i<bufSize; i++) data[i] = Math.random()*2-1;
        noise.buffer = buf;

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.ctx.destination);

        osc.start(now); osc.stop(now + 0.3);
        noise.start(now); noise.stop(now + 0.2);
    }

    /**
     * Tank ULT Hum: "しゅい～ん" (Softer mystical drone)
     */
    playTankUltHum(duration = 4.0) {
        this._init();
        const now = this.ctx.currentTime;
        
        const osc = this.ctx.createOscillator();
        const filter = this.ctx.createBiquadFilter();
        const gain = this.ctx.createGain();

        // Softer triangle wave
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(110, now); // Octave lower for stability
        osc.frequency.linearRampToValueAtTime(220, now + duration);

        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(400, now);
        filter.Q.setValueAtTime(2, now); // Less resonance to be subtle

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.15, now + 1.0); // Slow fade in
        gain.gain.linearRampToValueAtTime(0.15, now + duration - 0.5);
        gain.gain.linearRampToValueAtTime(0, now + duration);

        osc.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + duration);
    }

    /**
     * Attacker Firestorm: "ずばばばばばっ！"
     * Rhythmic rapid-fire noise bursts.
     */
    playAttackerFirestorm() {
        this._init();
        const now = this.ctx.currentTime;
        
        const noise = this.ctx.createBufferSource();
        const bufSize = this.ctx.sampleRate * 0.05;
        const buf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
        const data = buf.getChannelData(0);
        for(let i=0; i<bufSize; i++) data[i] = Math.random()*2-1;
        noise.buffer = buf;

        const filter = this.ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(2000, now);

        const gain = this.ctx.createGain();
        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.04);

        noise.connect(filter);
        filter.connect(gain);
        gain.connect(this.ctx.destination);

        noise.start(now);
        noise.stop(now + 0.05);
    }

    /**
     * Flanker Slice: "しゅぴんっ！"
     * Sharp sword slash.
     */
    playFlankerSlice() {
        this._init();
        const now = this.ctx.currentTime;

        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(1500, now);
        osc.frequency.exponentialRampToValueAtTime(4000, now + 0.1);

        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.15);
    }

    /**
     * Normal Heal: "しゅい～ん"
     * Soft, ascending pleasant tone.
     */
    playHealNormal() {
        this._init();
        const now = this.ctx.currentTime;
        
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.type = 'sine';
        osc.frequency.setValueAtTime(600, now);
        osc.frequency.exponentialRampToValueAtTime(1200, now + 0.3);

        gain.gain.setValueAtTime(0, now);
        gain.gain.linearRampToValueAtTime(0.2, now + 0.1);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        osc.start(now);
        osc.stop(now + 0.4);
    }

    /**
     * Critical Heal: "ぴきーん"
     * High-pitched, extremely satisfying sharp ding.
     */
    playHealCritical() {
        this._init();
        const now = this.ctx.currentTime;

        // The "Ping"
        const osc1 = this.ctx.createOscillator();
        const gain1 = this.ctx.createGain();
        osc1.type = 'sine';
        osc1.frequency.setValueAtTime(2000, now);
        osc1.frequency.exponentialRampToValueAtTime(3000, now + 0.1);
        
        gain1.gain.setValueAtTime(0.4, now);
        gain1.gain.exponentialRampToValueAtTime(0.001, now + 0.5);

        // The sparkle (high frequency noise/chime)
        const osc2 = this.ctx.createOscillator();
        const gain2 = this.ctx.createGain();
        osc2.type = 'triangle';
        osc2.frequency.setValueAtTime(4000, now);
        osc2.frequency.linearRampToValueAtTime(4500, now + 0.3);

        gain2.gain.setValueAtTime(0.2, now);
        gain2.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

        osc1.connect(gain1);
        gain1.connect(this.ctx.destination);
        
        osc2.connect(gain2);
        gain2.connect(this.ctx.destination);

        osc1.start(now); osc1.stop(now + 0.5);
        osc2.start(now); osc2.stop(now + 0.4);
    }

    /**
     * Boss Explosion: "どごぉぉぉん！！"
     * Heavy, low-frequency layered explosion.
     */
    playBossExplosion() {
        this._init();
        const now = this.ctx.currentTime;

        // Sub-bass thump
        const sub = this.ctx.createOscillator();
        const subGain = this.ctx.createGain();
        sub.type = 'triangle';
        sub.frequency.setValueAtTime(100, now);
        sub.frequency.exponentialRampToValueAtTime(30, now + 0.4);
        subGain.gain.setValueAtTime(0.8, now);
        subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
        sub.connect(subGain);
        subGain.connect(this.ctx.destination);
        sub.start(now); sub.stop(now + 0.6);

        // Main explosion noise
        const noise = this.ctx.createBufferSource();
        const noiseGain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        const bufSize = this.ctx.sampleRate * 1.5;
        const buf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
        const data = buf.getChannelData(0);
        for(let i=0; i<bufSize; i++) data[i] = Math.random()*2-1;
        noise.buffer = buf;
        
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(1200, now);
        filter.frequency.exponentialRampToValueAtTime(100, now + 1.0);
        filter.Q.setValueAtTime(5, now);

        noiseGain.gain.setValueAtTime(0.6, now);
        noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 1.5);

        noise.connect(filter);
        filter.connect(noiseGain);
        noiseGain.connect(this.ctx.destination);
        noise.start(now); noise.stop(now + 1.5);
    }

    /**
     * Firework SE: "ぱん！...しゅわ～"
     * Pop followed by sizzling noise.
     */
    playFirework() {
        this._init();
        const now = this.ctx.currentTime;

        // The "Pop" - Sine sweep
        const pop = this.ctx.createOscillator();
        const popGain = this.ctx.createGain();
        pop.type = 'sine';
        pop.frequency.setValueAtTime(400 + Math.random() * 200, now);
        pop.frequency.exponentialRampToValueAtTime(100, now + 0.05);
        popGain.gain.setValueAtTime(0.3, now);
        popGain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);
        pop.connect(popGain);
        popGain.connect(this.ctx.destination);
        pop.start(now); pop.stop(now + 0.08);

        // The "Sizzle" - High freq noise
        const sizzle = this.ctx.createBufferSource();
        const sizzleGain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        const bufSize = this.ctx.sampleRate * 0.4;
        const buf = this.ctx.createBuffer(1, bufSize, this.ctx.sampleRate);
        const data = buf.getChannelData(0);
        for(let i=0; i<bufSize; i++) data[i] = Math.random()*2-1;
        sizzle.buffer = buf;

        filter.type = 'highpass';
        filter.frequency.setValueAtTime(5000 + Math.random() * 2000, now);
        
        sizzleGain.gain.setValueAtTime(0, now);
        sizzleGain.gain.linearRampToValueAtTime(0.15, now + 0.05); // Fade in
        sizzleGain.gain.exponentialRampToValueAtTime(0.001, now + 0.4);

        sizzle.connect(filter);
        filter.connect(sizzleGain);
        sizzleGain.connect(this.ctx.destination);
        sizzle.start(now); sizzle.stop(now + 0.4);
    }
}
