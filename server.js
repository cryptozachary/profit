// server.refactored.js
// Refactor preserves external behavior and endpoints.
// - No new dependencies or frameworks.
// - Clearer naming, structure, and comments.
// - Public API responses and shapes unchanged.

'use strict';

/************************************
 * Module Imports & Environment
 ************************************/
const fs = require('fs').promises;
const path = require('path');
const express = require('express');
const axios = require('axios');
const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
//const { createCanvas } = require('canvas');
const fsStream = require('fs');
require('dotenv').config();

// Models
const Settings = require('./models/settings');
const BullBear = require('./models/bullbearlog');

/************************************
 * Constants & Configuration
 ************************************/
const TAAPI_SECRET = process.env.TAAPI_SECRET;
const PORT = process.env.PORT || 3000;
const BIND_IP = '192.168.1.82';

// Firebase config (unused; preserved for context)
const firebaseConfig = {
    apiKey: 'AIzaSyDaKHxH1IpJdicB7Rx2vSKlGpeSBHkxs',
    authDomain: 'know-your-strats.firebaseapp.com',
    projectId: 'know-your-strats',
    storageBucket: 'know-your-strats.appspot.com',
    messagingSenderId: '211186066430',
    appId: '1:211186066430:web:90be81e5552a97928056af',
    measurementId: 'G-19M8DBG8C1'
};

/************************************
 * App Init
 ************************************/
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '/frontend/public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '/frontend/views'));

/************************************
 * Database Connection
 ************************************/
async function connectToDatabase() {
    try {
        await mongoose.connect(process.env.MONGO_DB_ATLAS, { useNewUrlParser: true });
        console.log('Connected to MongoDB!');
    } catch (err) {
        console.error('Failed to connect to MongoDB:', err);
    }
}

/************************************
 * Email Utility
 ************************************/
/**
 * Send an email notification.
 * @param {string} fromEmail - Email of the sender to CC.
 * @param {string} name - Sender display name.
 * @param {string} subject - Email subject.
 * @param {string} message - Body content.
 * @param {string|string[]} notify - Recipient(s).
 */
async function sendEmail(fromEmail, name, subject, message, notify) {
    const transporter = nodemailer.createTransport({
        host: 'smtp.hostinger.com',
        port: 465,
        secure: true,
        auth: { user: process.env.EZEMAIL, pass: process.env.EZPASSWORD },
        tls: { rejectUnauthorized: false }
    });

    await transporter.sendMail({
        from: 'zach@ezmanagers.com',
        to: notify,
        cc: fromEmail,
        subject,
        text: `From: ${name} - ${fromEmail},\n\n${message}`
    });
}

/************************************
 * Settings Persistence
 ************************************/
/**
 * Save settings to MongoDB (upsert-style for single settings doc).
 * @param {object} settings
 */
async function saveSettings(settings) {
    const existing = await Settings.findOne();
    if (existing) {
        Object.assign(existing, settings);
        await existing.save();
    } else {
        const created = new Settings(settings);
        await created.save();
    }
}

/**
 * Load settings or defaults.
 * @returns {Promise<object>}
 */
async function loadSettings() {
    const settings = await Settings.findOne();
    return (
        settings || {
            theme: 'default',
            exchange: 'defaultExchange',
            refreshRate: '30',
            notifications: false,
            customIndicator: 'defaultIndicator',
            language: 'en'
        }
    );
}

/************************************
 * Runtime State (kept in-memory)
 ************************************/
/** State container mirrored from original GLOBAL_VARIABLES */
const indicatorState = {
    assetPrice: '',
    rsiValue: '',
    volumeValue: '',
    bollValue: '',
    fibonValue: '',
    MacdValue: '',
    emaValue: '',
    name: '',
    rise: '',
    fall: '',
    neutral: ''
};

/** State container mirrored from original GLOBAL_SETTINGS */
const runtimeSettings = {
    exchange: '',
    notifications: '',
    notifyEmail: ''
};

function clearObjectValues(obj) {
    Object.keys(obj).forEach((k) => {
        obj[k] = '';
    });
}

function resetConsensusCounts() {
    indicatorState.rise = 'N/A';
    indicatorState.fall = 'N/A';
    indicatorState.neutral = 'N/A';
}

/************************************
 * Middleware
 ************************************/
/**
 * Fetch exchange symbols filtered to USDT,/USDC,/USD and attach to req.symbols.
 */
async function getSymbols(req, res, next) {
    try {
        const settings = await loadSettings();
        runtimeSettings.exchange = settings.exchange;

        const url = `https://api.taapi.io/exchange-symbols?secret=${TAAPI_SECRET}&exchange=${settings.exchange}`;
        const { data } = await axios.get(url);

        const filtered = data.filter((s) => s.endsWith('/USDT') || s.endsWith('/USDC') || s.endsWith('/USD'));
        req.symbols = filtered;
        next();
    } catch (err) {
        console.error('getSymbols error:', err);
        res.status(500).send('Failed to retrieve symbols data.');
    }
}

/************************************
 * Utility: Time Formatting & File Logging
 ************************************/
function formatTimestamp(timestamp) {
    const date = new Date(timestamp);
    return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: true
    });
}

async function logDetectedFlagPattern(pair, flagType, targetPrice, flagpoleHeight) {
    const logDir = path.join(__dirname, 'logs');
    const logFile = path.join(logDir, 'flag_patterns.log');
    const timestamp = new Date().toISOString();
    const entry = `${timestamp} - ${pair} - ${flagType} Flag detected. Target Price: ${targetPrice}, Flagpole Height: ${flagpoleHeight}\n`;

    try {
        await fs.mkdir(logDir, { recursive: true });
        await fs.appendFile(logFile, entry);
        console.log(`Flag pattern logged for ${pair}`);
    } catch (err) {
        console.error('Error logging flag pattern:', err);
    }
}

/** Persist a log entry into Mongo (was sendLogEntry). */
async function persistLogEntry(logEntry, prediction, pair) {
    try {
        const newLog = new BullBear({ logEntry });
        await newLog.save();
        console.log(`${prediction} signal logged for ${pair}`);
    } catch (err) {
        console.error('Error logging bull signal:', err);
    }
}

/************************************
 * Parsing Helpers for TAAPI `results`
 ************************************/
// Many TAAPI endpoints return an array when `results=N` is used.
// Helpers below normalize shapes so evaluators get what they expect.

function valuesFromResults(resp, field = 'value') {
    const raw = resp?.data;
    if (!raw) return [];
    if (Array.isArray(raw)) return raw.map((x) => Number(x[field] ?? x));
    if (typeof raw[field] !== 'undefined') return [Number(raw[field])];
    return [];
}
function objectsFromResults(resp) {
    const raw = resp?.data;
    if (!raw) return [];
    return Array.isArray(raw) ? raw : [raw];
}

// ---- Dynamic lookbacks from UI "period" ----
function deriveDynamicPeriods(p) {
    const base = Math.max(1, Number(p) || 14);
    const fib = Math.max(30, Math.min(500, Math.round(base * 6)));   // 6xP, guard rails
    const flag = Math.max(60, Math.min(1000, Math.round(base * 12)));  // 12xP, guard rails
    return { fib, flag };
}


/************************************
 * Pattern Rendering
 ************************************/
async function renderFlagPatternCanvas(candleData) {
    const canvasWidth = 1200;
    const canvasHeight = 600;
    const candleWidth = 20;
    const flagpoleLineWidth = 2;
    const flagpoleLineColor = 'red';
    const flagColor = 'rgba(255, 0, 0, 0.3)';
    const textFont = '14px Arial';

    const prices = candleData.map((c) => c.high).concat(candleData.map((c) => c.low));
    const maxPrice = Math.max(...prices);
    const minPrice = Math.min(...prices);

    const priceRange = maxPrice - minPrice;
    const priceScale = canvasHeight / (priceRange || 1);

    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d');

    // grid lines
    const priceStep = (maxPrice - minPrice) / 8 || 1;
    ctx.strokeStyle = '#d3d3d3';
    ctx.lineWidth = 1;
    for (let p = minPrice; p <= maxPrice + 1e-9; p += priceStep) {
        const y = canvasHeight - (p - minPrice) * priceScale;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvasWidth, y);
        ctx.stroke();
    }

    // candles & flag
    for (let i = 0; i < candleData.length; i++) {
        const c = candleData[i];
        const x = i * candleWidth;
        const yOpen = canvasHeight - (c.open - minPrice) * priceScale;
        const yHigh = canvasHeight - (c.high - minPrice) * priceScale;
        const yLow = canvasHeight - (c.low - minPrice) * priceScale;
        const yClose = canvasHeight - (c.close - minPrice) * priceScale;

        ctx.strokeStyle = c.close < c.open ? 'red' : 'green';
        ctx.fillStyle = c.close < c.open ? 'red' : 'green';
        const rectY = Math.min(yOpen, yClose);
        const rectH = Math.max(2, Math.abs(yClose - yOpen));
        ctx.fillRect(x + 2, rectY, candleWidth - 4, rectH);
        ctx.strokeRect(x + 2, rectY, candleWidth - 4, rectH);

        ctx.beginPath();
        ctx.moveTo(x + candleWidth / 2, yHigh);
        ctx.lineTo(x + candleWidth / 2, yLow);
        ctx.stroke();

        if (c.flagpole) {
            const { high, low } = c.flagpole;
            const yFlagHigh = canvasHeight - (high - minPrice) * priceScale;
            const yFlagLow = canvasHeight - (low - minPrice) * priceScale;

            ctx.strokeStyle = flagpoleLineColor;
            ctx.lineWidth = flagpoleLineWidth;
            ctx.beginPath();
            ctx.moveTo(x + candleWidth / 2, yFlagHigh);
            ctx.lineTo(x + candleWidth / 2, yFlagLow);
            ctx.stroke();

            ctx.fillStyle = flagColor;
            ctx.fillRect(x, yFlagHigh, candleWidth, yFlagLow - yFlagHigh);
        }
    }

    ctx.fillStyle = 'black';
    ctx.font = textFont;
    for (let i = 0; i < candleData.length; i++) {
        const c = candleData[i];
        const x = i * candleWidth + 2;
        const yClose = canvasHeight - (c.close - minPrice) * priceScale - 18;
        ctx.fillText(Number(c.close).toFixed(2), x, yClose);
    }

    // Save the canvas we actually drew on (fixing previous bug)
    const outPath = path.join(__dirname, 'bear_flag_pattern.png');
    await fs.mkdir(path.dirname(outPath), { recursive: true });
    await new Promise((resolve, reject) => {
        const out = fsStream.createWriteStream(outPath);
        canvas.createPNGStream().pipe(out);
        out.on('finish', resolve);
        out.on('error', reject);
    });
    console.log('Bear flag pattern saved as bear_flag_pattern.png');
}

/************************************
 * Indicator Helpers (volatility, trends)
 ************************************/
function calculateVolatility(series) {
    // Accept array of numbers
    const values = series;
    if (!values.length) return 0;
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const squared = values.map((v) => Math.pow(v - mean, 2));
    return Math.sqrt(squared.reduce((s, v) => s + v, 0) / values.length);
}

function getExtremeRSIDuration(series, threshold, isOverbought) {
    let duration = 0;
    for (let i = series.length - 1; i >= 0; i--) {
        const val = series[i];
        if ((isOverbought && val > threshold) || (!isOverbought && val < threshold)) duration++;
        else break;
    }
    return duration;
}

/************************************
 * Indicator Evaluators (improved)
 ************************************/
// Map our (direction,value) to a normalized score in [-1,1] if needed elsewhere.
function scoreFromDirection(direction, value) {
    if (direction === 'rise') return value === -1 ? 1 : value === 0 ? 0.5 : 0;
    if (direction === 'fall') return value === 2 ? -1 : value === 1 ? -0.5 : 0;
    return 0;
}

// helper: vanilla EMA for arrays
function ema(arr, len) {
    if (!Array.isArray(arr) || !arr.length || !Number.isFinite(len) || len < 1) return [];
    const k = 2 / (len + 1);
    const out = new Array(arr.length);
    let prev = arr[0];
    out[0] = prev;
    for (let i = 1; i < arr.length; i++) {
        prev = arr[i] * k + prev * (1 - k);
        out[i] = prev;
    }
    return out;
}

/**
 * RSI evaluator (adaptive thresholds, hysteresis, EMA confirmation, regime bias)
 * @param {object} currentRSI  - TAAPI current RSI object: { value }
 * @param {number[]} historicalRSI - array of past RSI values (numbers)
 * @param {number} period - RSI lookback period (default 14)
 */
function rsiFormula(currentRSI, historicalRSI, period = 14) {
    const rsiCur = Number(currentRSI?.value);
    const series = (Array.isArray(historicalRSI) ? historicalRSI : [])
        .map(Number)
        .filter(Number.isFinite);

    // keep state display
    indicatorState.rsiValue = Number.isFinite(rsiCur) ? rsiCur : '';

    if (!Number.isFinite(rsiCur) || !series.length) {
        return { direction: 'neutral', value: '00', reason: 'RSI data unavailable', RSI: rsiCur ?? 'N/A' };
    }

    // --- stats over a rolling window (3×period, min 30, max 200)
    const win = Math.max(30, Math.min(200, Math.round(period * 3)));
    const last = series.slice(-win);
    const mean = last.reduce((s, v) => s + v, 0) / last.length;
    const variance = last.reduce((s, v) => s + (v - mean) ** 2, 0) / last.length;
    const std = Math.sqrt(variance) || 1;

    // --- dynamic thresholds ---
    // period scaling (longer period → tighter moves → slightly narrower bands)
    const pScale = Math.sqrt(14 / Math.max(5, period)); // 14 as baseline
    // width from volatility around 50; clamp to [8, 24]
    const width = Math.max(8, Math.min(24, 1.4 * std * pScale));
    let upper = Math.min(80, 50 + width / 2);
    let lower = Math.max(20, 50 - width / 2);

    // regime bias (shift both bands up in bull regimes, down in bear)
    const regimeUp = mean >= 55, regimeDown = mean <= 45;
    if (regimeUp) { upper += 2; lower += 2; }
    if (regimeDown) { upper -= 2; lower -= 2; }
    upper = Math.min(90, upper);
    lower = Math.max(10, lower);

    // hysteresis around 50 to reduce whipsaw
    const midUpper = 52, midLower = 48;

    // RSI-EMA momentum confirmation (half period)
    const rsiWithCur = [...series, rsiCur];
    const rsiEmaLen = Math.max(3, Math.round(period / 2));
    const rsiEmaSeries = ema(rsiWithCur, rsiEmaLen);
    const rsiEmaCur = rsiEmaSeries.at(-1);
    const rsiEmaPrev = rsiEmaSeries.at(-2);
    const emaSlopeUp = rsiEmaCur > rsiEmaPrev;
    const emaSlopeDn = rsiEmaCur < rsiEmaPrev;

    // durations over/under bands for strength
    const getDuration = (th, isOver) => {
        let d = 0;
        for (let i = rsiWithCur.length - 1; i >= 0; i--) {
            const v = rsiWithCur[i];
            if ((isOver && v > th) || (!isOver && v < th)) d++; else break;
        }
        return d;
    };
    const overboughtDur = getDuration(upper, true);
    const oversoldDur = getDuration(lower, false);

    const prevRSI = series.at(-1) ?? rsiCur;

    let direction = 'neutral';
    let value = '00';
    let reason = `RSI=${rsiCur.toFixed(1)} dyn[${lower.toFixed(1)}, ${upper.toFixed(1)}]`;

    // 1) Extremes → mean reversion bias
    if (rsiCur > upper) {
        direction = 'fall';
        value = overboughtDur >= 3 ? 2 : 1;
        reason += `; overbought ${overboughtDur}`;
    } else if (rsiCur < lower) {
        direction = 'rise';
        value = oversoldDur >= 3 ? -1 : 0;
        reason += `; oversold ${oversoldDur}`;
    } else {
        // 2) Mid-zone momentum flips with hysteresis
        if (rsiCur > midUpper && prevRSI <= midLower) {
            direction = 'rise'; value = 0; reason += '; momentum flip up';
        } else if (rsiCur < midLower && prevRSI >= midUpper) {
            direction = 'fall'; value = 1; reason += '; momentum flip down';
        } else if (rsiCur > 50 && rsiCur < prevRSI) {
            direction = 'fall'; value = 1; reason += '; easing from bullish';
        } else if (rsiCur < 50 && rsiCur > prevRSI) {
            direction = 'rise'; value = 0; reason += '; improving from bearish';
        } else {
            reason += '; neutral';
        }
    }

    // 3) Momentum confirmation by RSI-EMA slope/cross
    const aboveEma = rsiCur >= rsiEmaCur;
    const belowEma = rsiCur <= rsiEmaCur;
    if (direction === 'rise' && aboveEma && emaSlopeUp) {
        // upgrade strength one notch
        if (value === 0) value = -1;
        reason += '; EMA↑ confirm';
    } else if (direction === 'fall' && belowEma && emaSlopeDn) {
        if (value === 1) value = 2;
        reason += '; EMA↓ confirm';
    }

    // 4) Regime de-emphasis (don’t over-bear in bull regimes, etc.)
    if (direction === 'fall' && regimeUp && value === 2) { value = 1; reason += '; bull regime dampens'; }
    if (direction === 'rise' && regimeDown && value === -1) { value = 0; reason += '; bear regime dampens'; }

    return { direction, value, reason, RSI: rsiCur, upper, lower, rsiEma: rsiEmaCur };
}


function macdFormula(current, historyObjs) {
    const M = Number(current.valueMACD);
    const S = Number(current.valueMACDSignal);
    const H = Number(current.valueMACDHist);

    const prev = (historyObjs && historyObjs.length) ? historyObjs.at(-1) : current;
    const Hprev = Number(prev.valueMACDHist ?? 0);
    const Hslope = H - Hprev;

    indicatorState.MacdValue = `MACD:${M.toFixed(4)} Signal:${S.toFixed(4)} Histogram:${H.toFixed(4)}`;

    let direction = 'neutral';
    let value = '00';
    let reason = `MACD=${M.toFixed(2)} Sig=${S.toFixed(2)} Hist=${H.toFixed(2)} dH=${Hslope.toFixed(2)}`;

    const above = M > S, below = M < S;
    const aboveZero = (M > 0 && S > 0), belowZero = (M < 0 && S < 0);

    if (above) {
        direction = 'rise';
        value = aboveZero ? -1 : 0;
        reason += aboveZero ? '; bull>0 (strong)' : '; bull<0 (weaker)';
    } else if (below) {
        direction = 'fall';
        value = belowZero ? 2 : 1;
        reason += belowZero ? '; bear<0 (strong)' : '; bear>0 (weaker)';
    } else {
        reason += '; lines equal';
    }

    if (direction === 'rise' && Hslope < 0) {
        reason += '; hist losing momentum';
        value = Math.max(value, 0);
    }
    if (direction === 'fall' && Hslope > 0) {
        reason += '; hist losing momentum';
        value = Math.min(value, 2);
    }

    // Simple price trend divergence check if closes exist on history objects
    if (historyObjs && historyObjs.length >= 2) {
        const firstClose = Number(historyObjs[0]?.close ?? NaN);
        const lastClose = Number(historyObjs.at(-1)?.close ?? NaN);
        if (!Number.isNaN(firstClose) && !Number.isNaN(lastClose)) {
            const priceTrend = lastClose > firstClose ? 'rising' : lastClose < firstClose ? 'falling' : 'flat';
            const macdTrend = Hslope > 0 ? 'rising' : Hslope < 0 ? 'falling' : 'flat';
            if ((priceTrend === 'rising' && macdTrend === 'falling') || (priceTrend === 'falling' && macdTrend === 'rising')) {
                reason += ' ; potential divergence';
            }
        }
    }

    return { direction, value, reason };
}

function bollingerBandsFormula(bbCurrent, bbHistoryObjs, price = Number(indicatorState.assetPrice), period = 20) {
    const U = Number(bbCurrent.valueUpperBand);
    const M = Number(bbCurrent.valueMiddleBand);
    const L = Number(bbCurrent.valueLowerBand);

    indicatorState.bollValue = `Upper:${U.toFixed(4)} Middle:${M.toFixed(4)} Lower:${L.toFixed(4)}`;

    const prevM = Number((bbHistoryObjs?.at(-1) ?? bbCurrent).valueMiddleBand ?? M);
    const band = U - L;
    const percentB = (price - L) / (band || 1);
    const bandwidth = band / (M || 1);
    const smaSlope = M - prevM;

    // --- dynamic thresholds ---
    // overshoot epsilon shrinks for longer periods and expands when bands are tight
    const epsBase = 0.02 * (20 / Math.max(5, period));             // e.g., ~0.02 at P=20, ~0.01 at P=40
    const epsVol = Math.max(0.005, Math.min(0.02, bandwidth / 10)); // tighter bands ⇒ slightly larger eps
    const eps = Math.max(0.005, Math.min(0.03, (epsBase + epsVol) / 2));

    // squeeze threshold from history (20th percentile of recent bandwidths), fallback 0.06
    const widths = (bbHistoryObjs || [])
        .map(r => (Number(r.valueUpperBand) - Number(r.valueLowerBand)) / (Number(r.valueMiddleBand) || 1))
        .filter(Number.isFinite);
    const recent = widths.slice(-100).sort((a, b) => a - b);
    const squeezeThresh = recent.length ? recent[Math.floor(0.2 * (recent.length - 1))] : 0.06;

    // normalize slope by band to avoid “NaN”
    const slopeNorm = (smaSlope) / ((band === 0 ? 1 : band));
    const slopeStrong = Math.abs(slopeNorm) > 0.1; // tunable

    let direction = 'neutral';
    let value = '00';
    let reason = `%B=${percentB.toFixed(2)} BW=${bandwidth.toFixed(3)} eps=${eps.toFixed(3)}`;

    if (percentB > 1 + eps) {
        direction = 'fall';
        value = 1;
        reason += '; pierce upper → mean revert';
    } else if (percentB < 0 - eps) {
        direction = 'rise';
        value = 0;
        reason += '; pierce lower → mean revert';
    } else {
        const squeeze = bandwidth <= squeezeThresh;
        if (squeeze && slopeStrong) {
            direction = smaSlope > 0 ? 'rise' : 'fall';
            value = smaSlope > 0 ? 0 : 1;
            reason += `; squeeze→${direction}`;
        } else {
            reason += '; inside bands';
        }
    }

    return { direction, value, reason, percentB, bandwidth, lowerBand: L, upperBand: U };
}


function fibonacciRetracementFormula(frCur) {
    // TAAPI returns a price in `value` and a `trend` with startPrice/endPrice.
    const price = Number(indicatorState.assetPrice);
    const trend = (frCur?.trend || 'AUTO').toUpperCase();
    const start = Number(frCur?.startPrice);
    const end = Number(frCur?.endPrice);

    // Normalize hi/lo for easier math
    const uptrend = trend === 'UPTREND';
    const hi = uptrend ? end : start;
    const lo = uptrend ? start : end;
    const span = (hi - lo) || 1;

    const levelsPct = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
    const levelAt = (p) => uptrend ? (lo + span * p) : (hi - span * p);
    const levels = levelsPct.map(levelAt);

    // nearest level to current price
    let idx = 0, best = Infinity;
    for (let i = 0; i < levels.length; i++) {
        const d = Math.abs(price - levels[i]);
        if (d < best) { best = d; idx = i; }
    }

    let direction = 'neutral';
    let value = '00';
    let reason = `Fib trend=${uptrend ? 'UP' : 'DOWN'}, nearest ${(levelsPct[idx] * 100).toFixed(1)}%`;

    const inGolden = idx >= 2 && idx <= 4; // 38.2% to 61.8%

    if (uptrend) {
        if (inGolden && price >= levels[2] && price <= levels[4]) {
            direction = 'rise'; value = 0; reason += '; buy-the-dip zone';
        } else if (price < levels[5]) {
            direction = 'fall'; value = 1; reason += '; deep retrace risk (≤78.6)';
        }
    } else {
        if (inGolden && price <= levels[4] && price >= levels[2]) {
            direction = 'fall'; value = 1; reason += '; sell-the-rip zone';
        } else if (price > levels[5]) {
            direction = 'rise'; value = 0; reason += '; deep retrace risk (≥78.6)';
        }
    }

    indicatorState.fibonValue = `RetracePx:${Number(frCur?.value ?? price).toFixed(2)} Trend:${uptrend ? 'UP' : 'DOWN'}`;
    return { direction, value, reason, retracementLevel: (levelsPct[idx] * 100) };
}

function calculateVOSCTrend(series) {
    const last = series.slice(-6);
    if (last.length < 6) return 'neutral';
    const a = last.slice(0, 3).reduce((s, v) => s + v, 0) / 3;
    const b = last.slice(3).reduce((s, v) => s + v, 0) / 3;
    return b > a ? 'rising' : b < a ? 'falling' : 'neutral';
}

function voscFormula(cur, histArr = []) {
    const v = Number(cur.value);
    const series = histArr.map((x) => Number(x.value ?? x));
    const mean = series.length ? series.reduce((s, n) => s + n, 0) / series.length : 0;
    const std = Math.sqrt(series.reduce((s, n) => s + Math.pow(n - mean, 2), 0) / (series.length || 1)) || 1;
    const z = (v - mean) / std;

    indicatorState.volumeValue = v.toFixed(2);

    let direction = 'neutral';
    let value = '00';
    let reason = `VOSC=${v.toFixed(2)} z=${z.toFixed(2)}`;

    if (v > 0) { direction = 'rise'; value = z > 1 ? -1 : 0; reason += z > 1 ? '; strong +vol' : ' ; +vol'; }
    else if (v < 0) { direction = 'fall'; value = z < -1 ? 2 : 1; reason += z < -1 ? '; strong -vol' : ' ; -vol'; }

    const trend = calculateVOSCTrend(series);
    if ((direction === 'rise' && trend === 'rising') || (direction === 'fall' && trend === 'falling')) {
        reason += '; trend confirm';
    } else if (trend !== 'neutral') {
        reason += '; vol trend caution';
    }

    return { direction, value, reason, voscValue: v, voscTrend: trend };
}

async function emaCrossoverFormula(cryptoAsset, pair, interval, period) {
    const ex = runtimeSettings.exchange;
    const shortP = Math.max(3, Number(period));
    const longP = Math.max(shortP + 2, 26);
    const base = `secret=${TAAPI_SECRET}&exchange=${ex}&symbol=${cryptoAsset}/${pair}&interval=${interval}`;

    const fmt = (x, d = 4) => (Number.isFinite(x) ? x.toFixed(d) : 'N/A');

    try {
        // try results=2 first (cheaper)
        const [sRes, lRes] = await Promise.all([
            axios.get(`https://api.taapi.io/ema?${base}&period=${shortP}&results=2`),
            axios.get(`https://api.taapi.io/ema?${base}&period=${longP}&results=2`)
        ]);

        const arr = x => Array.isArray(x?.data) ? x.data : (x?.data ? [x.data] : []);
        let sArr = arr(sRes), lArr = arr(lRes);

        // fallback if we didn't get 2 points
        if (sArr.length < 2 || lArr.length < 2) {
            const [sNow, sPrev, lNow, lPrev] = await Promise.all([
                axios.get(`https://api.taapi.io/ema?${base}&period=${shortP}`),
                axios.get(`https://api.taapi.io/ema?${base}&period=${shortP}&backtrack=1`),
                axios.get(`https://api.taapi.io/ema?${base}&period=${longP}`),
                axios.get(`https://api.taapi.io/ema?${base}&period=${longP}&backtrack=1`)
            ]);
            sArr = [sPrev.data, sNow.data];
            lArr = [lPrev.data, lNow.data];
        }

        const prevShort = Number(sArr.at(-2)?.value);
        const currShort = Number(sArr.at(-1)?.value);
        const prevLong = Number(lArr.at(-2)?.value);
        const currLong = Number(lArr.at(-1)?.value);

        indicatorState.emaValue =
            `S:${fmt(currShort)} L:${fmt(currLong)} prevS:${fmt(prevShort)} prevL:${fmt(prevLong)}`;

        // guard: if any is not finite, bail neutral with reason
        if ([prevShort, currShort, prevLong, currLong].some(v => !Number.isFinite(v))) {
            return { direction: 'neutral', value: '00', reason: 'EMA data unavailable' };
        }

        // proper cross
        const crossUp = prevShort <= prevLong && currShort > currLong;
        const crossDn = prevShort >= prevLong && currShort < currLong;
        const longUp = currLong > prevLong;
        const longDn = currLong < prevLong;

        if (crossUp || (currShort > currLong && longUp)) {
            return { direction: 'rise', value: 0, reason: crossUp ? 'Golden cross' : 'Short>Long & Long EMA rising' };
        }
        if (crossDn || (currShort < currLong && longDn)) {
            return { direction: 'fall', value: 1, reason: crossDn ? 'Death cross' : 'Short<Long & Long EMA falling' };
        }
        return { direction: 'neutral', value: '00', reason: 'No clear cross' };
    } catch (err) {
        console.error('EMA error:', err?.response?.data ?? err.message);
        indicatorState.emaValue = 'S:N/A L:N/A prevS:N/A prevL:N/A';
        return { direction: 'neutral', value: '00', reason: 'EMA request failed' };
    }
}

/************************************
 * Pattern Detectors (Bear/Bull Flag)
 ************************************/
async function getBearFlagSignal(api_secret, exchange, symbol, interval, period = 14, options = {}) {
    const {
        minFlagDuration = 5,
        flagpoleThreshold = 0.02,
        flagThreshold = 0.01,
        volumeDecreaseThreshold = 0.8,
        breakoutVolumeIncrease = 1.5,
        significantDowntrendPercentage = 0.05,
        maxPatternDuration = 30
    } = options;

    const url = `https://api.taapi.io/candles?secret=${api_secret}&exchange=${exchange}&symbol=${symbol}&interval=${interval}&period=${period}`;

    try {
        const { data } = await axios.get(url);
        if (!data || data.length < period) return { patternFound: false, candleData: null, error: 'Insufficient data' };

        let flagpoleStart = -1;
        let flagpoleHigh = 0;
        let flagpoleLow = Infinity;
        let flagStart = -1;
        let volumeDuringFlagpole = 0;
        let volumeDuringFlag = 0;
        let flagDuration = 0;
        let patternScore = 0;

        // find significant down leg
        for (let i = 1; i < data.length; i++) {
            if (data[i] && data[i - 1] && (data[i - 1].high - data[i].low) / data[i - 1].high > significantDowntrendPercentage) {
                flagpoleStart = i - 1;
                break;
            }
        }

        if (flagpoleStart === -1) return { patternFound: false, candleData: data, error: 'No significant downtrend found' };

        for (let i = flagpoleStart; i < data.length; i++) {
            if (!data[i]) continue;

            if (flagStart === -1) {
                flagpoleHigh = Math.max(flagpoleHigh, data[i].high);
                flagpoleLow = Math.min(flagpoleLow, data[i].low);
                volumeDuringFlagpole += data[i].volume;
                if (i > 0 && data[i - 1] && data[i].close > data[i - 1].close) flagStart = i;
            } else {
                flagDuration++;
                volumeDuringFlag += data[i].volume;

                const flagHighBoundary = flagpoleHigh * (1 - flagThreshold);
                const flagLowBoundary = flagpoleLow * (1 + flagThreshold);

                // Break if channel invalid
                if (data[i].high > flagHighBoundary || data[i].low < flagLowBoundary) break;

                // Bearish breakout
                if (data[i].close < flagLowBoundary) {
                    const avgVolumeFlagpole = volumeDuringFlagpole / (flagStart - flagpoleStart);
                    const avgVolumeFlag = volumeDuringFlag / flagDuration;

                    if (
                        avgVolumeFlag < avgVolumeFlagpole * volumeDecreaseThreshold &&
                        data[i].volume > avgVolumeFlag * breakoutVolumeIncrease &&
                        flagDuration >= minFlagDuration &&
                        i - flagpoleStart <= maxPatternDuration
                    ) {
                        const flagpoleHeight = flagpoleHigh - flagpoleLow;
                        const targetPrice = data[i].low - flagpoleHeight;
                        patternScore = calculatePatternScore(data, flagpoleStart, flagStart, i, avgVolumeFlagpole, avgVolumeFlag);

                        return {
                            patternFound: true,
                            targetPrice,
                            flagpoleHeight,
                            patternScore,
                            candleData: data,
                            flagpoleStartIndex: flagpoleStart,
                            flagStartIndex: flagStart,
                            breakoutIndex: i
                        };
                    }
                }
            }
        }

        return { patternFound: false, candleData: data, error: 'No valid bear flag pattern found' };
    } catch (err) {
        console.error(err);
        if (err.response) throw new Error(`API error: ${err.response.status} - ${err.response.data}`);
        if (err.request) throw new Error('Network error: No response received from the server');
        throw new Error(`Error in processing request: ${err.message}`);
    }
}

function calculatePatternScore(data, flagpoleStart, flagStart, breakoutIndex, avgVolumeFlagpole, avgVolumeFlag) {
    let score = 0;
    if (!data[flagpoleStart] || !data[flagStart - 1] || !data[breakoutIndex] || !data[breakoutIndex - 1]) return 0;

    const flagpoleStrength = (data[flagpoleStart].high - data[flagStart - 1].low) / data[flagpoleStart].high;
    score += flagpoleStrength * 40;

    const idealFlagDuration = 7;
    const flagDuration = breakoutIndex - flagStart;
    score += (1 - Math.abs(flagDuration - idealFlagDuration) / idealFlagDuration) * 20;

    const volumeDecrease = 1 - avgVolumeFlag / avgVolumeFlagpole;
    score += volumeDecrease * 20;

    const breakoutStrength = (data[breakoutIndex - 1].close - data[breakoutIndex].close) / data[breakoutIndex - 1].close;
    score += breakoutStrength * 20;

    return Math.min(Math.round(score), 100);
}

async function getBullFlagSignal(api_secret, exchange, symbol, interval, period = 14, options = {}) {
    const {
        minFlagDuration = 5,
        flagpoleThreshold = 0.02,
        flagThreshold = 0.01,
        volumeDecreaseThreshold = 0.8,
        breakoutVolumeIncrease = 1.5,
        significantUptrendPercentage = 0.05,
        maxPatternDuration = 30
    } = options;

    const url = `https://api.taapi.io/candles?secret=${api_secret}&exchange=${exchange}&symbol=${symbol}&interval=${interval}&period=${period}`;

    try {
        const { data } = await axios.get(url);
        if (!data || data.length < period) return { patternFound: false, candleData: null, error: 'Insufficient data' };

        let flagpoleStart = -1;
        let flagpoleHigh = -Infinity;
        let flagpoleLow = Infinity;
        let flagStart = -1;
        let volumeDuringFlagpole = 0;
        let volumeDuringFlag = 0;
        let flagDuration = 0;
        let patternScore = 0;

        for (let i = 1; i < data.length; i++) {
            if (data[i] && data[i - 1] && (data[i].high - data[i - 1].low) / data[i - 1].low > significantUptrendPercentage) {
                flagpoleStart = i - 1;
                break;
            }
        }

        if (flagpoleStart === -1) return { patternFound: false, candleData: data, error: 'No significant uptrend found' };

        for (let i = flagpoleStart; i < data.length; i++) {
            if (!data[i]) continue;

            if (flagStart === -1) {
                flagpoleHigh = Math.max(flagpoleHigh, data[i].high);
                flagpoleLow = Math.min(flagpoleLow, data[i].low);
                volumeDuringFlagpole += data[i].volume;
                if (i > 0 && data[i - 1] && data[i].close < data[i - 1].close) flagStart = i;
            } else {
                flagDuration++;
                volumeDuringFlag += data[i].volume;

                const flagHighBoundary = flagpoleHigh * (1 + flagThreshold);
                const flagLowBoundary = flagpoleLow * (1 - flagThreshold);

                if (data[i].high > flagHighBoundary || data[i].low < flagLowBoundary) break;

                if (data[i].close > flagHighBoundary) {
                    const avgVolumeFlagpole = volumeDuringFlagpole / (flagStart - flagpoleStart);
                    const avgVolumeFlag = volumeDuringFlag / flagDuration;

                    if (
                        avgVolumeFlag < avgVolumeFlagpole * volumeDecreaseThreshold &&
                        data[i].volume > avgVolumeFlag * breakoutVolumeIncrease &&
                        flagDuration >= minFlagDuration &&
                        i - flagpoleStart <= maxPatternDuration
                    ) {
                        patternScore = calculateBullFlagPatternScore(data, flagpoleStart, flagStart, i, avgVolumeFlagpole, avgVolumeFlag);
                        const flagpoleHeight = flagpoleHigh - flagpoleLow;
                        const targetPrice = data[i].high + flagpoleHeight;

                        return {
                            patternFound: true,
                            targetPrice,
                            flagpoleHeight,
                            patternScore,
                            candleData: data,
                            flagpoleStartIndex: flagpoleStart,
                            flagStartIndex: flagStart,
                            breakoutIndex: i
                        };
                    }
                }
            }
        }

        return { patternFound: false, candleData: data, error: 'No valid bull flag pattern found' };
    } catch (err) {
        console.error(err);
        if (err.response) throw new Error(`API error: ${err.response.status} - ${err.response.data}`);
        if (err.request) throw new Error('Network error: No response received from the server');
        throw new Error(`Error in processing request: ${err.message}`);
    }
}

function calculateBullFlagPatternScore(data, flagpoleStart, flagStart, breakoutIndex, avgVolumeFlagpole, avgVolumeFlag) {
    let score = 0;
    if (!data[flagpoleStart] || !data[flagStart - 1] || !data[breakoutIndex] || !data[breakoutIndex - 1]) return 0;

    const flagpoleStrength = (data[flagStart - 1].high - data[flagpoleStart].low) / data[flagpoleStart].low;
    score += flagpoleStrength * 40;

    const idealFlagDuration = 7;
    const flagDuration = breakoutIndex - flagStart;
    score += (1 - Math.abs(flagDuration - idealFlagDuration) / idealFlagDuration) * 20;

    const volumeDecrease = 1 - avgVolumeFlag / avgVolumeFlagpole;
    score += volumeDecrease * 20;

    const breakoutStrength = (data[breakoutIndex].close - data[breakoutIndex - 1].close) / data[breakoutIndex - 1].close;
    score += breakoutStrength * 20;

    return Math.min(Math.round(score), 100);
}

/************************************
 * Signal Aggregation & Targets
 ************************************/
function evaluateAssetDirection(predictions) {
    let riseCount = 0;
    let fallCount = 0;
    let neutralCount = 0;

    for (const prediction of predictions) {
        if (prediction.value === 0) riseCount++;
        else if (prediction.value === 1) fallCount++;
        else if (prediction.value === 2) fallCount = fallCount + 2;
        else if (prediction.value === -1) riseCount = riseCount + 2;
        else neutralCount++;
    }

    indicatorState.rise = riseCount;
    indicatorState.fall = fallCount;
    indicatorState.neutral = neutralCount;

    if (riseCount > fallCount && riseCount > neutralCount) return 'rise';
    if (fallCount > riseCount && fallCount > neutralCount) return 'fall';
    return 'neutral';
}

function estimateTargetPrice(currentPrice, technicalData, patternData) {
    const price = Number(currentPrice);

    const {
        rsi,
        macd,
        bollingerBands,
        fibonacciRetracement,
        vosc,
        ema
    } = technicalData;

    const { flagPattern, flagpoleHeight } = patternData;

    // Convert each indicator to a normalized score in [-1, 1]
    const parts = [];
    const push = (w, dir, val) => parts.push(w * scoreFromDirection(dir, val));
    if (rsi) push(1.0, rsi.direction, rsi.value);
    if (macd) push(1.2, macd.direction, macd.value);
    if (bollingerBands) push(1.2, bollingerBands.direction, bollingerBands.value);
    if (fibonacciRetracement) push(0.8, fibonacciRetracement.direction, fibonacciRetracement.value);
    if (vosc) push(0.7, vosc.direction, vosc.value);
    if (ema) push(0.8, ema.direction, ema.value);

    // bonus if both are bullish or both bearish
    if (ema && macd && ema.direction !== 'neutral' && macd.direction === ema.direction) {
        parts.push(0.1 * (ema.direction === 'rise' ? 1 : -1)); // small nudge
    }


    let sumW = 0;
    let sum = 0;
    for (const s of parts) { sum += s; sumW += Math.abs(s) ? (Math.abs(s) / Math.max(Math.abs(s), 1e-9)) : 1; }
    const E = parts.length ? (sum / parts.length) : 0; // ensemble score [-1,1]

    // Volatility base: half BB width in % of price (fallback 1.5%)
    const basePct = bollingerBands
        ? ((bollingerBands.upperBand - bollingerBands.lowerBand) / (2 * price)) * 100
        : 1.5;

    // Scale by ensemble strength
    const k = 1 + 0.5 * Math.abs(E);
    let movePct = k * basePct;

    // Blend flagpole height modestly instead of full projection
    if (flagPattern && flagpoleHeight) {
        const flagPct = (flagpoleHeight / price) * 100;
        movePct += Math.min(flagPct, basePct * 2) * 0.5; // cap contribution
    }

    const predictedDirection = E > 0 ? 'rise' : E < 0 ? 'fall' : 'neutral';
    let targetPrice = price;
    if (predictedDirection === 'rise') targetPrice = price * (1 + movePct / 100);
    else if (predictedDirection === 'fall') targetPrice = price * (1 - movePct / 100);

    const agreement = [
        rsi?.direction, macd?.direction, bollingerBands?.direction,
        fibonacciRetracement?.direction, vosc?.direction, ema?.direction
    ].filter(Boolean);

    const aligned = agreement.filter((d) => d === predictedDirection).length;
    const conf = parts.length ? (50 + 50 * Math.abs(E)) : 50;
    const confidence = Math.round(Math.min(100, Math.max(0, conf * (0.6 + 0.4 * (aligned / Math.max(1, agreement.length))))));

    return {
        currentPrice: price,
        targetPrice: Number(targetPrice.toFixed(8)),
        priceChangePercentage: Number(((targetPrice - price) / price * 100).toFixed(4)),
        predictedDirection,
        confidence,
        rawConfidenceScore: aligned,
        maxConfidenceScore: agreement.length
    };
}

/************************************
 * Profitability Helpers
 ************************************/
function determineProfitability(responses, formula) {
    try {
        switch (formula) {
            case 'formula1': { // RSI
                const cur = responses[0]?.data;               // single object
                const histVals = valuesFromResults(responses[1], 'value'); // array of numbers
                return rsiFormula(cur, histVals);
            }
            case 'formula2': { // MACD
                const cur = responses[0]?.data;               // single object with MACD fields
                const histObjs = objectsFromResults(responses[1]); // array (we reuse slot 2 for MACD hist when called alone)
                return macdFormula(cur, histObjs);
            }
            case 'formula3': { // BB
                const cur = responses[0]?.data;               // single object
                const histObjs = objectsFromResults(responses[1]);
                return bollingerBandsFormula(cur, histObjs, Number(indicatorState.assetPrice));
            }
            case 'formula4': { // Fib retracement
                const cur = responses[0]?.data;
                return fibonacciRetracementFormula(cur);
            }
            case 'formula5': { // VOSC
                const cur = responses[0]?.data;
                const histObjs = objectsFromResults(responses[1]);
                return voscFormula(cur, histObjs);
            }
            default:
                return { direction: 'neutral', value: '00', reason: 'Unknown formula' };
        }
    } catch (e) {
        console.error('determineProfitability error:', e);
        return { direction: 'neutral', value: '00', reason: 'Evaluator error' };
    }
}

/************************************
 * Logging (Consensus/Bull-Bear)
 ************************************/
async function logBullBear(pair, currentPrice, targetPrice, interval, period, direction, direction2, confidence, notifications, notifyEmail, GV) {
    const logDir = path.join(__dirname, 'logs');
    const logFile = path.join(logDir, 'bullbear.log');
    const timestamp = new Date().toISOString();
    const humanTime = formatTimestamp(timestamp);

    const shouldLogDirection = direction !== 'neutral' && direction2 !== 'neutral' && direction === direction2;
    const highConfidence = confidence >= 85;

    if (shouldLogDirection && highConfidence) {
        const prediction = direction === 'rise' ? 'Bullish' : 'Bearish';
        const logEntry = `${humanTime} - ${pair} -${prediction}!- Current Price: ${currentPrice}- Target Price: ${targetPrice}, ${interval}/${period}, Conensus: Rise: ${GV.rise}, Fall: ${GV.fall}, Neutral: ${GV.neutral},\n`;

        try {
            await fs.mkdir(logDir, { recursive: true });
            await fs.appendFile(logFile, logEntry);

            // save log entry to Mongo
            await persistLogEntry(logEntry, prediction, pair);

            // email notification
            if (notifications) {
                await sendEmail('Know Your Strats', 'Zachary', `New log for ${pair}`, logEntry, notifyEmail);
            }

            console.log(`${prediction} signal logged for ${pair}`);
        } catch (err) {
            console.error('Error logging bull/bear signal:', err);
        }
    }
}

/************************************
 * Routes
 ************************************/
app.delete('/api/logEntries', async (req, res) => {
    try {
        await BullBear.deleteMany({});
        res.status(200).send('All logs deleted successfully');
    } catch (err) {
        console.error('Error deleting logs:', err);
        res.status(500).send('Internal server error');
    }
});

app.post('/save-settings', async (req, res) => {
    const settings = {
        theme: req.query.theme,
        exchange: req.query.exchange,
        refreshRate: req.query.refreshRate,
        notifications: req.query.notifications === 'true',
        customIndicator: req.query.customIndicator,
        language: req.query.language
    };
    await saveSettings(settings);
    res.json({ message: 'Settings saved successfully', settings });
});

app.post('/check-profitability', async (req, res) => {
    const { cryptoAsset, formulaType, interval = '1h', period = 14, pair = 'USDT' } = req.body;

    const settings = await loadSettings();
    runtimeSettings.exchange = settings.exchange;
    runtimeSettings.notifications = settings.notifications;
    runtimeSettings.notifyEmail = settings.customIndicator;

    if (formulaType !== 'formula7' && formulaType !== 'formula8') clearObjectValues(indicatorState);

    // Asset price
    try {
        const priceUrl = `https://api.taapi.io/price?secret=${TAAPI_SECRET}&exchange=${settings.exchange}&symbol=${cryptoAsset}/${pair}&interval=1m`;
        const { data } = await axios.get(priceUrl);
        indicatorState.assetPrice = data.value;
        indicatorState.name = cryptoAsset;
    } catch (err) {
        console.error(err);
        return res.status(500).send('Failed to retrieve Asset Price.');
    }

    if (formulaType === 'formula6') {
        try {
            const prediction = await emaCrossoverFormula(cryptoAsset, interval, period);
            return res.json([{ isProfitable: prediction.direction }, indicatorState]);
        } catch (err) {
            console.error(err);
            return res.status(500).send('Failed to retrieve EMA data (server).');
        }
    }

    if (formulaType === 'formula7') {
        try {
            const { flag: flagPeriod } = deriveDynamicPeriods(period);
            const bearFlagPattern = await getBearFlagSignal(TAAPI_SECRET, `${runtimeSettings.exchange}`, `${cryptoAsset}/${pair}`, `${interval}`, `${flagPeriod}`);
            if (bearFlagPattern.patternFound) await renderFlagPatternCanvas(bearFlagPattern.candleData);
            return res.json([
                {
                    isProfitable: bearFlagPattern.patternFound,
                    flagPrice: bearFlagPattern.targetPrice,
                    flagHeight: bearFlagPattern.flagpoleHeight,
                    theError: bearFlagPattern.error
                },
                indicatorState
            ]);
        } catch (err) {
            console.error(err);
            return res.status(500).send('Failed to retrieve bear flag pattern data.');
        }
    }

    if (formulaType === 'formula8') {
        try {
            const { flag: flagPeriod } = deriveDynamicPeriods(period);
            const bullFlagPattern = await getBullFlagSignal(TAAPI_SECRET, `${runtimeSettings.exchange}`, `${cryptoAsset}/${pair}`, `${interval}`, `${flagPeriod}`);
            if (bullFlagPattern.patternFound) await renderFlagPatternCanvas(bullFlagPattern.candleData);
            return res.json([
                {
                    isProfitable: bullFlagPattern.patternFound,
                    flagPrice: bullFlagPattern.targetPrice,
                    flagHeight: bullFlagPattern.flagpoleHeight,
                    theError: bullFlagPattern.error
                },
                indicatorState
            ]);
        } catch (err) {
            console.error(err);
            return res.status(500).send('Failed to retrieve bull flag pattern data.');
        }
    }

    if (formulaType === 'all') {
        try {
            const { fib: fibPeriod, flag: flagPeriod } = deriveDynamicPeriods(period);

            // Request set (note: keep response shape compatible with your client)
            const requests = [
                // RSI current + history
                axios.get(`https://api.taapi.io/rsi?secret=${TAAPI_SECRET}&exchange=${settings.exchange}&symbol=${cryptoAsset}/${pair}&interval=${interval}&period=${period}`),
                axios.get(`https://api.taapi.io/rsi?secret=${TAAPI_SECRET}&exchange=${settings.exchange}&symbol=${cryptoAsset}/${pair}&interval=${interval}&period=${period}&results=30`),

                // MACD current + history
                axios.get(`https://api.taapi.io/macd?secret=${TAAPI_SECRET}&exchange=${settings.exchange}&symbol=${cryptoAsset}/${pair}&interval=${interval}`),
                axios.get(`https://api.taapi.io/macd?secret=${TAAPI_SECRET}&exchange=${settings.exchange}&symbol=${cryptoAsset}/${pair}&interval=${interval}&results=10`),

                // BB current + history
                axios.get(`https://api.taapi.io/bbands?secret=${TAAPI_SECRET}&exchange=${settings.exchange}&symbol=${cryptoAsset}/${pair}&interval=${interval}&period=${period}`),
                axios.get(`https://api.taapi.io/bbands?secret=${TAAPI_SECRET}&exchange=${settings.exchange}&symbol=${cryptoAsset}/${pair}&interval=${interval}&period=${period}&results=10`),

                // Fib retracement current (+ optional results unused)
                axios.get(`https://api.taapi.io/fibonacciretracement?secret=${TAAPI_SECRET}&exchange=${settings.exchange}&symbol=${cryptoAsset}/${pair}&interval=${interval}&period=${period}`),
                axios.get(`https://api.taapi.io/fibonacciretracement?secret=${TAAPI_SECRET}&exchange=${settings.exchange}&symbol=${cryptoAsset}/${pair}&interval=${interval}&period=${period}&results=10`),

                // VOSC (current; if you want history, add results=30)
                axios.get(`https://api.taapi.io/vosc?secret=${TAAPI_SECRET}&exchange=${settings.exchange}&symbol=${cryptoAsset}/${pair}&interval=${interval}&short_period=10&long_period=50`)
            ];

            const results = await Promise.all(requests);

            // Correct evaluator wiring (each indicator gets its own history)
            const rsiNow = results[0].data;
            const rsiHistArr = valuesFromResults(results[1], 'value');

            const macdNow = results[2].data;
            const macdHistObjs = objectsFromResults(results[3]);

            const bbNow = results[4].data;
            const bbHistObjs = objectsFromResults(results[5]);

            const fibNow = results[6].data; // price-based

            const voscNow = results[8].data;
            const voscHist = []; // no extra call here; evaluator handles empty history gracefully

            const emaPred = await emaCrossoverFormula(cryptoAsset, pair, interval, period);

            const predictions = [
                rsiFormula(rsiNow, rsiHistArr, period),
                macdFormula(macdNow, macdHistObjs),
                bollingerBandsFormula(bbNow, bbHistObjs, Number(indicatorState.assetPrice), period),
                fibonacciRetracementFormula(fibNow),
                voscFormula(voscNow, voscHist),
                emaPred
            ];

            const overallPrediction = evaluateAssetDirection(predictions);

            // ✅ Flags use flagPeriod (12×P)
            const bullFlagPattern = await getBullFlagSignal(TAAPI_SECRET, `${runtimeSettings.exchange}`, `${cryptoAsset}/${pair}`, `${interval}`, `${flagPeriod}`);
            const bearFlagPattern = await getBearFlagSignal(TAAPI_SECRET, `${runtimeSettings.exchange}`, `${cryptoAsset}/${pair}`, `${interval}`, `${flagPeriod}`);

            const patternData = {
                flagPattern: bullFlagPattern.patternFound ? 'bull' : bearFlagPattern.patternFound ? 'bear' : null,
                flagpoleHeight: bullFlagPattern.patternFound ? bullFlagPattern.flagpoleHeight : bearFlagPattern.patternFound ? bearFlagPattern.flagpoleHeight : null
            };

            const technicalData = {
                rsi: predictions[0],
                macd: predictions[1],
                bollingerBands: predictions[2],
                fibonacciRetracement: predictions[3],
                vosc: predictions[4],
                ema: predictions[5]
            };

            // --- Human-friendly summary helpers ---------------------------------

            const pretty = (n, d = 2) => (Number.isFinite(n) ? Number(n).toFixed(d) : 'N/A');

            function tagDirection(dir, value) {
                // Map your encoding to words
                if (dir === 'rise') return value === -1 ? 'strongly bullish' : 'slightly bullish';
                if (dir === 'fall') return value === 2 ? 'strongly bearish' : 'slightly bearish';
                return 'neutral';
            }

            function rsiBlurb(rsi) {
                if (!rsi) return null;
                const v = rsi.RSI;
                if (!Number.isFinite(v)) return null;
                if (v >= 70) return 'overbought (can cool off)';
                if (v <= 30) return 'oversold (can bounce)';
                if (v > 55) return 'mildly bullish momentum';
                if (v < 45) return 'mildly bearish momentum';
                return 'balanced momentum';
            }

            function macdBlurb(macd) {
                if (!macd) return null;
                const strong = macd.value === -1 || macd.value === 2;
                if (macd.direction === 'rise') return strong ? 'momentum picking up' : 'momentum improving a bit';
                if (macd.direction === 'fall') return strong ? 'momentum weakening' : 'momentum easing';
                return 'momentum flat';
            }

            function bbBlurb(bb) {
                if (!bb) return null;
                const b = Number(bb.bandwidth);
                const p = Number(bb.percentB);
                if (!Number.isFinite(b) || !Number.isFinite(p)) return null;

                const squeeze = b < 0.06;
                if (p >= 0.95) return 'near the top of its recent range';
                if (p <= 0.05) return 'near the bottom of its recent range';
                if (squeeze) return 'volatility is very low (coiled for a move)';
                return 'trading inside its recent range';
            }

            function fibBlurb(fib) {
                if (!fib) return null;
                if (fib.retracementLevel >= 75 && fib.direction === 'fall') return 'risk of deeper pullback near 78.6%';
                if (fib.retracementLevel >= 38 && fib.retracementLevel <= 62) {
                    return fib.direction === 'rise' ? 'pullback zone that often bounces' : 'rally zone that often stalls';
                }
                return null;
            }

            function voscBlurb(vosc) {
                if (!vosc) return null;
                if (vosc.direction === 'rise') return 'buying volume is above typical';
                if (vosc.direction === 'fall') return 'selling volume is above typical';
                return 'volume is roughly typical';
            }

            // Build a single, simple card
            function buildHumanSummary(symbol, price, technicalData, patternData, targets) {
                const headDir = targets.predictedDirection; // 'rise' | 'fall' | 'neutral'
                const headTxt =
                    headDir === 'rise' ? 'Likely to rise soon'
                        : headDir === 'fall' ? 'Likely to fall soon'
                            : 'Likely to stay range-bound';

                const changeTxt = headDir === 'neutral'
                    ? ''
                    : `~${pretty(Math.abs(targets.priceChangePercentage), 2)}%`;

                // Short "why" from 2–3 best blurbs
                const blurbs = [
                    rsiBlurb(technicalData.rsi),
                    macdBlurb(technicalData.macd),
                    bbBlurb(technicalData.bollingerBands),
                    fibBlurb(technicalData.fibonacciRetracement),
                    voscBlurb(technicalData.vosc),
                    patternData?.flagPattern ? (patternData.flagPattern === 'bull' ? 'bull flag detected' : 'bear flag detected') : null
                ].filter(Boolean);

                const why = blurbs.slice(0, 3).join(' · ');

                // Key levels from BB as simple guardrails
                const upper = technicalData.bollingerBands?.upperBand;
                const lower = technicalData.bollingerBands?.lowerBand;

                // Confidence → stars (1–5) for non-technical users
                const stars = Math.max(1, Math.min(5, Math.round(targets.confidence / 20)));

                return {
                    symbol,
                    price: pretty(price, 2),
                    headline: `${headTxt} ${changeTxt}`.trim(),
                    confidence: `${targets.confidence}%`,
                    confidenceStars: '★'.repeat(stars) + '☆'.repeat(5 - stars),
                    why: why || 'mixed signals',
                    keyLevels: {
                        support: Number.isFinite(lower) ? pretty(lower, 2) : 'N/A',
                        resistance: Number.isFinite(upper) ? pretty(upper, 2) : 'N/A'
                    },
                    // Keep an expert string if you want a toggle
                    expertNote: [
                        `RSI: ${parseFloat(technicalData.rsi?.RSI.toFixed(2)) ?? 'N/A'}`,
                        `MACD: ${tagDirection(technicalData.macd?.direction, technicalData.macd?.value)}`,
                        `BB: %B=${pretty(technicalData.bollingerBands?.percentB)} BW=${pretty(technicalData.bollingerBands?.bandwidth, 3)}`,
                        `EMA: ${technicalData.ema ? (technicalData.ema.direction) : 'N/A'}`,
                    ].join(' | ')
                };
            }


            const targets = estimateTargetPrice(indicatorState.assetPrice, technicalData, patternData);

            const friendly = buildHumanSummary(indicatorState.name, indicatorState.assetPrice, technicalData, patternData, targets);

            await logBullBear(
                indicatorState.name,
                targets.currentPrice,
                targets.targetPrice,
                interval,
                period,
                overallPrediction,
                targets.predictedDirection,
                targets.confidence,
                runtimeSettings.notifications,
                runtimeSettings.notifyEmail,
                indicatorState
            );

            return res.json([
                { isProfitable: overallPrediction },
                indicatorState,
                { reasons: predictions },
                { technicalData, patternData, targets },
                { exchange: settings.exchange },
                { friendly } // <-- new, human-friendly card
            ]);
        } catch (err) {
            console.error(err);
            return res.status(500).send('Failed to retrieve indicator data.');
        }
    }

    // Specific indicator endpoint mapping
    let endpoint = '';
    const base = 'https://api.taapi.io/';
    const common = `secret = ${TAAPI_SECRET} & exchange=${settings.exchange} & symbol=${cryptoAsset} / USDT & interval=${interval}`;

    switch (formulaType) {
        case 'formula1': // RSI
            endpoint = {
                ep: `${base}rsi ? ${common} & period=${period}`,
                ep2: `${base}rsi ? ${common} & period=${period} & results=30`
            };
            break;
        case 'formula2': // MACD
            endpoint = {
                ep: `${base}macd ? ${common}`,
                ep2: `${base}macd ? ${common} & results=10`
            };
            break;
        case 'formula3': // Bollinger Bands
            endpoint = {
                ep: `${base}bbands ? ${common} & period=${period}`,
                ep2: `${base}bbands ? ${common} & period=${period} & results=10`
            };
            break;
        case 'formula4': { // Fibonacci retracement
            const { fib: fibPeriod } = deriveDynamicPeriods(period);
            endpoint = {
                ep: `${base}fibonacciretracement?${common}&period=${fibPeriod}`,
                ep2: `${base}fibonacciretracement?${common}&period=${fibPeriod}&results=10`
            };
            break;
        }
        case 'formula5': // VOSC
            endpoint = {
                ep: `${base}vosc ? ${common} & short_period=10 & long_period=50`,
                ep2: `${base}vosc ? ${common} & short_period=10 & long_period=50 & results=10`
            };
            break;
        default:
            endpoint = {};
    }

    try {
        const requests = [];
        if (endpoint.ep) requests.push(axios.get(endpoint.ep));
        if (endpoint.ep2) requests.push(axios.get(endpoint.ep2));

        const responses = await Promise.all(requests);

        const prediction = determineProfitability(responses, formulaType);
        resetConsensusCounts();
        return res.json([{ isProfitable: prediction.direction }, indicatorState]);
    } catch (err) {
        console.error(err);
        res.json({ Message: 'Nope' });
        return res.status(500).send('Failed to retrieve indicator data.');
    }
});

// Scan a specific pair
app.get('/scan/:asset/:currency/', async (req, res) => {
    const asset = req.params.asset;
    const currency = req.params.currency;
    const pair = `${asset}/${currency}`;
    const interval = req.query.interval;
    const period = parseInt(req.query.period);
    const { flag: flagPeriod } = deriveDynamicPeriods(period);

    try {
        const bullResult = await getBullFlagSignal(TAAPI_SECRET, runtimeSettings.exchange, pair, interval, flagPeriod);
        const bearResult = await getBearFlagSignal(TAAPI_SECRET, runtimeSettings.exchange, pair, interval, flagPeriod);
        const pairData = await getPairData(asset, currency, interval, period);

        if (bullResult.patternFound) await logDetectedFlagPattern(pair, 'Bull', bullResult.targetPrice, bullResult.flagpoleHeight);
        if (bearResult.patternFound) await logDetectedFlagPattern(pair, 'Bear', bearResult.targetPrice, bearResult.flagpoleHeight);

        res.json({ pair, bullFlag: bullResult, bearFlag: bearResult, ...pairData });
    } catch (err) {
        console.error('Error in /scan/:asset/:currency:', err);
        res.status(500).json({
            error: 'An error occurred while scanning',
            message: err.message,
            pair,
            bullFlag: { patternFound: false },
            bearFlag: { patternFound: false },
            assetPrice: 'N/A',
            name: asset
        });
    }
});

// Persist arbitrary log entry
app.post('/api/logEntry', async (req, res) => {
    const { logEntry } = req.body;
    if (!logEntry) return res.status(400).send('Log entry is required');

    try {
        const newLog = new BullBear({ logEntry });
        await newLog.save();
        res.status(201).send('Log entry saved successfully');
    } catch (err) {
        console.error('Error saving log entry:', err);
        res.status(500).send('Internal server error');
    }
});

// Retrieve all logs
app.get('/api/getLogs', async (req, res) => {
    try {
        const logs = await BullBear.find().exec();
        res.json(logs);
    } catch (err) {
        console.error('Error loading bullbear logs:', err);
        res.status(500).send('Internal server error');
    }
});

// Home page (symbols list)
app.get('/', getSymbols, (req, res) => {
    const symbols = req.symbols.sort();
    res.render('index', { symbols });
});

/************************************
 * Aux Data Fetch
 ************************************/
async function getPairData(cryptoAsset, quoteCurrency, interval, period) {
    try {
        const url = `https://api.taapi.io/price?secret=${TAAPI_SECRET}&exchange=${runtimeSettings.exchange}&symbol=${cryptoAsset}/${quoteCurrency}&interval=${interval}&period=${period}`;
        const { data } = await axios.get(url);
        return { assetPrice: data.value, name: cryptoAsset };
    } catch (err) {
        console.error('Error in getPairData:', err);
        throw new Error('Failed to retrieve Asset Price');
    }
}

/************************************
 * Server Boot
 ************************************/
connectToDatabase();
app.listen(PORT, () => {
    console.log(`Server is running on http://${BIND_IP}:${PORT}`);
});
