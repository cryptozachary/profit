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
const { createCanvas } = require('canvas');
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
    apiKey: 'AIzaSyDaKHxH1IpJdicB7Rx2Fv2SKlGpeSBHkxs',
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
 * Fetch exchange symbols filtered to USDT,  /USDC,/USD and attach to req.symbols.*/

async function getSymbols(req, res, next) {
    try {
        const settings = await loadSettings();
        runtimeSettings.exchange = settings.exchange; // fix: was set on GLOBAL_VARIABLES before

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
    const priceScale = canvasHeight / priceRange;

    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d');

    // grid lines
    const priceStep = 100;
    ctx.strokeStyle = '#d3d3d3';
    ctx.lineWidth = 1;
    for (let p = Math.ceil(minPrice / priceStep) * priceStep; p <= maxPrice; p += priceStep) {
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
        ctx.fillRect(x + 2, yOpen, candleWidth - 4, yClose - yOpen);
        ctx.strokeRect(x + 2, yOpen, candleWidth - 4, yClose - yOpen);

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
        ctx.fillText(c.close.toFixed(2), x, yClose);
    }

    const outPath = path.join(__dirname, 'bear_flag_pattern.png');
    const out = await fs.open(outPath, 'w');
    await out.close();
    const stream = createCanvas(canvasWidth, canvasHeight).createPNGStream();
    // Keep original behavior: write a file named bear_flag_pattern.png
    const fileStream = (await require('fs')).createWriteStream(outPath);
    stream.pipe(fileStream);
    fileStream.on('finish', () => console.log('Bear flag pattern saved as bear_flag_pattern.png'));
}

/************************************
 * Indicator Helpers (volatility, trends)
 ************************************/
function calculateVolatility(historicalData) {
    const values = historicalData.map((d) => d.value);
    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const squared = values.map((v) => Math.pow(v - mean, 2));
    return Math.sqrt(squared.reduce((s, v) => s + v, 0) / values.length);
}

function getExtremeRSIDuration(historicalData, threshold, isOverbought) {
    let duration = 0;
    for (let i = historicalData.length - 1; i >= 0; i--) {
        const val = historicalData[i].value;
        if ((isOverbought && val > threshold) || (!isOverbought && val < threshold)) duration++;
        else break;
    }
    return duration;
}

/************************************
 * Indicator Evaluators (names preserved in behavior)
 ************************************/
function rsiFormula(currentRSI, historicalRSI) {
    const rsiValue = currentRSI.value;
    indicatorState.rsiValue = rsiValue;

    const previousRSI = historicalRSI.length > 1 ? historicalRSI[historicalRSI.length - 2] : rsiValue;
    const volatilityAdjustment = Math.min(calculateVolatility(historicalRSI) * 2, 10);

    const upperThreshold = 70 + volatilityAdjustment;
    const lowerThreshold = 30 - volatilityAdjustment;

    const overboughtDuration = getExtremeRSIDuration(historicalRSI, upperThreshold, true);
    const oversoldDuration = getExtremeRSIDuration(historicalRSI, lowerThreshold, false);

    if (rsiValue > upperThreshold) {
        const strength = overboughtDuration > 3 ? 2 : 2;
        return { direction: 'fall', value: strength, reason: `RSI overbought for ${overboughtDuration} periods`, RSI: rsiValue };
    } else if (rsiValue < lowerThreshold) {
        const strength = oversoldDuration > 3 ? -1 : -1;
        return { direction: 'rise', value: strength, reason: `RSI oversold for ${oversoldDuration} periods`, RSI: rsiValue };
    } else if (rsiValue > 50 && rsiValue < previousRSI) {
        return { direction: 'fall', value: 1, reason: 'RSI declining from bullish territory', RSI: rsiValue };
    } else if (rsiValue < 50 && rsiValue > previousRSI) {
        return { direction: 'rise', value: 0, reason: 'RSI rising from bearish territory', RSI: rsiValue };
    }
    return { direction: 'neutral', value: '00', reason: 'RSI in neutral zone', RSI: rsiValue };
}

function macdFormula(data, historicalData) {
    const macdLine = parseFloat(data.valueMACD);
    const signalLine = parseFloat(data.valueMACDSignal);
    const histogram = macdLine - signalLine;

    indicatorState.MacdValue = `MACD: ${macdLine.toFixed(4)} Signal: ${signalLine.toFixed(4)} Histogram: ${histogram.toFixed(4)}`;

    const previousMACD = historicalData[historicalData.length - 2].valueMACD;
    const previousSignal = historicalData[historicalData.length - 2].valueMACDSignal;
    const macdTrend = macdLine > previousMACD ? 'rising' : 'falling';
    const signalTrend = signalLine > previousSignal ? 'rising' : 'falling';

    const signalStrength = Math.abs(histogram) / ((macdLine + signalLine) / 2);

    let direction, value, reason;

    if (macdLine > signalLine) {
        direction = 'rise';
        value = signalStrength > 0.1 ? 0 : 0;
        reason = `MACD (${macdTrend}) above Signal (${signalTrend})`;
        if (macdLine > 0 && signalLine > 0) {
            reason += 'MACD: above zero line - strong bullish';
            value = -1;
        }
    } else if (macdLine < signalLine) {
        direction = 'fall';
        value = signalStrength > 0.1 ? 1 : 1;
        reason = `MACD (${macdTrend}) below Signal (${signalTrend})`;
        if (macdLine < 0 && signalLine < 0) {
            reason += 'MACD: below zero line - strong bearish';
            value = 2;
        }
    } else {
        direction = 'neutral';
        value = '00';
        reason = 'MACD and Signal lines are equal';
    }

    const priceTrend = historicalData[historicalData.length - 1].close > historicalData[0].close ? 'rising' : 'falling';
    if (priceTrend !== macdTrend) {
        reason += ' - Potential divergence detected';
        value = Math.min(value + 1, 2);
    }

    return { direction, value, reason };
}

function bollingerBandsFormula(data, historicalData = []) {
    const price = parseFloat(indicatorState.assetPrice);
    const upperBand = parseFloat(data.valueUpperBand);
    const lowerBand = parseFloat(data.valueLowerBand);
    const middleBand = parseFloat(data.valueMiddleBand);

    indicatorState.bollValue = `Upper: ${upperBand.toFixed(4)} Middle: ${middleBand.toFixed(4)} Lower: ${lowerBand.toFixed(4)}`;

    const bandwidth = (upperBand - lowerBand) / middleBand;
    const percentB = (price - lowerBand) / (upperBand - lowerBand);

    const trend =
        historicalData.length > 1
            ? middleBand > historicalData[historicalData.length - 2].valueMiddleBand
                ? 'up'
                : 'down'
            : 'unknown';

    let direction, value, reason;

    if (price > upperBand) {
        direction = 'fall';
        value = percentB > 1.05 ? 2 : 1;
        reason = `Price above upper band (${percentB.toFixed(2)}), potential reversal downward`;
    } else if (price < lowerBand) {
        direction = 'rise';
        value = percentB < -0.05 ? 2 : 0;
        reason = `Price below lower band (${percentB.toFixed(2)}), potential reversal upward`;
    } else {
        direction = 'neutral';
        value = '00';
        reason = `Price within bands (${percentB.toFixed(2)})`;
        if (bandwidth < 0.1 && trend !== 'unknown') {
            direction = trend;
            if (direction === 'up') value = -1;
            if (direction === 'down') value = 2;
            reason += `, low bandwidth (${bandwidth.toFixed(2)}), potential ${trend}ward breakout`;
        }
    }

    if (trend !== 'unknown') reason += `, overall trend: ${trend}`;
    if (direction === 'down') direction = 'fall';
    if (direction === 'up') direction = 'rise';

    return { direction, value, reason, percentB, bandwidth, lowerBand, upperBand };
}

function determineTrendStrength(historicalData) {
    if (!historicalData || historicalData.length < 5) return 'unknown';
    const recent = historicalData.slice(-5).map((d) => d.value);
    const avg = recent.reduce((s, v) => s + v, 0) / recent.length;
    if (avg < 38.2) return 'strong';
    if (avg > 61.8) return 'weak';
    return 'moderate';
}

function fibonacciRetracementFormula(data, historicalData = []) {
    const retracementValue = parseFloat(data.value);
    const currentTrend = data.trend;
    const price = parseFloat(indicatorState.assetPrice);

    indicatorState.fibonValue = `Retrace: ${retracementValue.toFixed(4)} Trend: ${currentTrend}`;

    const levels = [0, 23.6, 38.2, 50, 61.8, 78.6, 100];
    const nearestLevel = levels.reduce((prev, curr) => (Math.abs(curr - retracementValue) < Math.abs(prev - retracementValue) ? curr : prev));

    let direction, value, reason;
    const trendStrength = determineTrendStrength(historicalData);

    if (currentTrend === 'DOWNTREND') {
        if (retracementValue > 61.8) {
            direction = 'fall';
            value = retracementValue > 78.6 ? 2 : 2;
            reason = `Strong FIB retracement (${nearestLevel}%) in downtrend, potential continuation`;
        } else {
            direction = 'rise';
            value = retracementValue < 38.2 ? 0 : 0;
            reason = `Weak FIB retracement (${nearestLevel}%) in downtrend, potential reversal`;
        }
    } else {
        if (retracementValue < 38.2) {
            direction = 'rise';
            value = retracementValue < 23.6 ? -1 : -1;
            reason = `Weak FIB retracement (${nearestLevel}%) in uptrend, potential continuation`;
        } else {
            direction = 'fall';
            value = retracementValue > 61.8 ? 1 : 1;
            reason = `Strong FIB retracement (${nearestLevel}%) in uptrend, potential reversal`;
        }
    }

    if (trendStrength === 'strong' && direction === currentTrend.toLowerCase()) {
        value = Math.min(value + 1, 2);
        reason += ', strong overall trend supports this direction';
    } else if (trendStrength === 'weak' && direction !== currentTrend.toLowerCase()) {
        value = Math.min(value + 1, 2);
        reason += ', weak overall trend supports potential reversal';
    }

    return { direction, value, reason, retracementLevel: nearestLevel, trendStrength };
}

function calculateVOSCTrend(historicalData, periods = 5) {
    if (!historicalData || historicalData.length < periods) return 'unknown';
    const recent = historicalData.slice(-periods).map((d) => d.value);
    const first = recent.slice(0, Math.floor(periods / 2));
    const second = recent.slice(-Math.floor(periods / 2));
    const firstAvg = first.reduce((s, v) => s + v, 0) / first.length;
    const secondAvg = second.reduce((s, v) => s + v, 0) / second.length;
    if (secondAvg > firstAvg) return 'rising';
    if (secondAvg < firstAvg) return 'falling';
    return 'neutral';
}

function calculatePriceTrend(historicalData, periods = 5) {
    if (!historicalData || historicalData.length < periods || !historicalData[0].price) return null;
    const recent = historicalData.slice(-periods).map((d) => d.price);
    const first = recent[0];
    const last = recent[recent.length - 1];
    if (last > first) return 'rise';
    if (last < first) return 'fall';
    return 'neutral';
}

function voscFormula(data, historicalData = []) {
    const voscValue = parseFloat(data.value);
    indicatorState.volumeValue = voscValue.toFixed(2);

    const strongSignalThreshold = 20;
    const voscTrend = calculateVOSCTrend(historicalData);

    let direction, value, reason;

    if (voscValue > 0) {
        direction = 'rise';
        value = voscValue > strongSignalThreshold ? 0 : 0;
        reason = `Positive VOSC (${voscValue.toFixed(2)}), indicating higher short-term volume`;
    } else if (voscValue < 0) {
        direction = 'fall';
        value = voscValue < -strongSignalThreshold ? 1 : 1;
        reason = `Negative VOSC (${voscValue.toFixed(2)}), indicating higher long-term volume`;
    } else {
        direction = 'neutral';
        value = '00';
        reason = 'VOSC at zero, indicating balanced short and long-term volumes';
    }

    if (voscTrend === 'rising' && direction === 'rise') {
        value = -1;
        reason += ', with rising trend strengthening the signal';
    } else if (voscTrend === 'falling' && direction === 'fall') {
        value = 2;
        reason += ', with falling trend strengthening the signal';
    } else if (voscTrend !== 'neutral') {
        reason += `, but ${voscTrend} trend suggests caution`;
    }

    const priceTrend = calculatePriceTrend(historicalData);
    if (priceTrend && priceTrend !== direction) {
        reason += '. Potential divergence with price trend detected';
    }

    return { direction, value, reason, voscValue, voscTrend };
}

async function emaCrossoverFormula(cryptoAsset, interval, period) {
    const shortPeriod = Number(period);
    const longPeriod = Number(period) + 14;

    const shortEmaEndpoint = `https://api.taapi.io/ema?secret=${TAAPI_SECRET}&exchange=${runtimeSettings.exchange}&symbol=${cryptoAsset}/USDT&interval=${interval}&backtracks=2&period=${shortPeriod}`;
    const longEmaEndpoint = `https://api.taapi.io/ema?secret=${TAAPI_SECRET}&exchange=${runtimeSettings.exchange}&symbol=${cryptoAsset}/USDT&interval=${interval}&backtracks=2&period=${longPeriod}`;

    try {
        const [shortEmaResponse, longEmaResponse] = await Promise.all([axios.get(shortEmaEndpoint), axios.get(longEmaEndpoint)]);

        if (!shortEmaEndpoint || !longEmaEndpoint) return { direction: 'neutral', value: '00', reason: 'No EMA Candles' };

        const currentShortEma = shortEmaResponse.data[0].value;
        const previousShortEma = shortEmaResponse.data[1].value;
        const currentLongEma = longEmaResponse.data[0].value;
        const previousLongEma = longEmaResponse.data[1].value;

        const rCSE = parseFloat(currentShortEma.toFixed(4));
        const rCLE = parseFloat(currentLongEma.toFixed(4));
        const rPSE = parseFloat(previousShortEma.toFixed(4));
        const rPLE = parseFloat(previousLongEma.toFixed(4));

        indicatorState.emaValue = `CShort: ${rCSE} CLong: ${rCLE} PShort: ${rPSE} Plong: ${rPLE}`;

        if (currentShortEma > currentLongEma && previousShortEma <= previousLongEma) return { direction: 'rise', value: 0 };
        if (currentShortEma < currentLongEma && previousShortEma >= previousLongEma) return { direction: 'fall', value: 1 };
        return { direction: 'neutral', value: '00', reason: 'Unable to determine EMA' };
    } catch (err) {
        console.error(err);
        throw new Error('Failed to retrieve EMA data (function): ' + JSON.stringify(err));
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

                if (data[i].high > flagHighBoundary || data[i].low < flagLowBoundary) break;

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
    const { rsi, macd, bollingerBands, fibonacciRetracement, vosc } = technicalData;
    const { flagPattern, flagpoleHeight } = patternData;

    let priceChangePercentage = 0;
    let confidenceScore = 0;
    let maxConfidenceScore = 0;
    let predictedDirection = 'neutral';

    // RSI contribution
    maxConfidenceScore += 2;
    if (rsi.RSI < 30) {
        priceChangePercentage += 2;
        confidenceScore += 2;
        predictedDirection = 'rise';
    } else if (rsi.RSI > 70) {
        priceChangePercentage -= 2;
        confidenceScore += 2;
        predictedDirection = 'fall';
    }

    // MACD contribution
    maxConfidenceScore += 2;
    if (macd.direction === 'rise') {
        priceChangePercentage += 1.5;
        confidenceScore += 2;
        predictedDirection = 'rise';
    } else if (macd.direction === 'fall') {
        priceChangePercentage -= 1.5;
        confidenceScore += 2;
        predictedDirection = 'fall';
    }

    // Bollinger Bands contribution
    maxConfidenceScore += 2;
    const bbPercentage = (currentPrice - bollingerBands.lowerBand) / (bollingerBands.upperBand - bollingerBands.lowerBand);
    if (bbPercentage < 0.2) {
        priceChangePercentage += 2;
        confidenceScore += 2;
        predictedDirection = 'rise';
    } else if (bbPercentage > 0.8) {
        priceChangePercentage -= 2;
        confidenceScore += 2;
        predictedDirection = 'fall';
    }

    // Fibonacci Retracement contribution
    maxConfidenceScore += 1;
    if (fibonacciRetracement.direction === 'rise') {
        priceChangePercentage += 1;
        confidenceScore += 1;
        predictedDirection = 'rise';
    } else if (fibonacciRetracement.direction === 'fall') {
        priceChangePercentage -= 1;
        confidenceScore += 1;
        predictedDirection = 'fall';
    }

    // VOSC contribution
    maxConfidenceScore += 1;
    if (vosc.direction === 'rise') {
        priceChangePercentage += 1;
        confidenceScore += 1;
        predictedDirection = 'rise';
    } else if (vosc.direction === 'fall') {
        priceChangePercentage -= 1;
        confidenceScore += 1;
        predictedDirection = 'fall';
    }

    // Flag pattern contribution
    maxConfidenceScore += 2;
    if (flagPattern === 'bull' && flagpoleHeight) {
        const flagPct = (flagpoleHeight / currentPrice) * 100;
        priceChangePercentage += flagPct;
        confidenceScore += 2;
        predictedDirection = 'rise';
    } else if (flagPattern === 'bear' && flagpoleHeight) {
        const flagPct = (flagpoleHeight / currentPrice) * 100;
        priceChangePercentage -= flagPct;
        confidenceScore += 2;
        predictedDirection = 'fall';
    }

    if (predictedDirection === 'rise' && priceChangePercentage < 0) priceChangePercentage = Math.abs(priceChangePercentage);
    else if (predictedDirection === 'fall' && priceChangePercentage > 0) priceChangePercentage = -Math.abs(priceChangePercentage);

    const targetPrice = parseFloat((currentPrice * (1 + priceChangePercentage / 100)).toFixed(8));
    const normalizedConfidence = (confidenceScore / maxConfidenceScore) * 100;

    return {
        currentPrice,
        targetPrice,
        priceChangePercentage,
        predictedDirection,
        confidence: Math.round(normalizedConfidence),
        rawConfidenceScore: confidenceScore,
        maxConfidenceScore
    };
}

/************************************
 * Profitability Helpers
 ************************************/
function determineProfitability(data, formula) {
    switch (formula) {
        case 'formula1':
            return rsiFormula(data[0], data[1].value);
        case 'formula2':
            return macdFormula(data[0], data[1].value);
        case 'formula3':
            return bollingerBandsFormula(data[0], data[1].value);
        case 'formula4':
            return fibonacciRetracementFormula(data[0], data[1].value);
        case 'formula5':
            return voscFormula(data[0], data[1].value);
        default:
            return 'neutral';
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
    const highConfidence = confidence >= 80;

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
            const bearFlagPattern = await getBearFlagSignal(TAAPI_SECRET, `${runtimeSettings.exchange}`, `${cryptoAsset}/${pair}`, `${interval}`, `${period}`);
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
            const bullFlagPattern = await getBullFlagSignal(TAAPI_SECRET, `${runtimeSettings.exchange}`, `${cryptoAsset}/${pair}`, `${interval}`, `${period}`);
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
            const requests = [
                axios.get(`https://api.taapi.io/rsi?secret=${TAAPI_SECRET}&exchange=${settings.exchange}&symbol=${cryptoAsset}/${pair}&interval=${interval}&period=${period}`),
                axios.get(`https://api.taapi.io/rsi?secret=${TAAPI_SECRET}&exchange=${settings.exchange}&symbol=${cryptoAsset}/${pair}&interval=${interval}&period=${period}&results=30`),
                axios.get(`https://api.taapi.io/macd?secret=${TAAPI_SECRET}&exchange=${settings.exchange}&symbol=${cryptoAsset}/${pair}&interval=${interval}`),
                axios.get(`https://api.taapi.io/macd?secret=${TAAPI_SECRET}&exchange=${settings.exchange}&symbol=${cryptoAsset}/${pair}&interval=${interval}&results=10`),
                axios.get(`https://api.taapi.io/bbands?secret=${TAAPI_SECRET}&exchange=${settings.exchange}&symbol=${cryptoAsset}/${pair}&interval=${interval}&period=${period}`),
                axios.get(`https://api.taapi.io/bbands?secret=${TAAPI_SECRET}&exchange=${settings.exchange}&symbol=${cryptoAsset}/${pair}&interval=${interval}&period=${period}&results=10`),
                axios.get(`https://api.taapi.io/fibonacciretracement?secret=${TAAPI_SECRET}&exchange=${settings.exchange}&symbol=${cryptoAsset}/${pair}&interval=${interval}&period=${period}`),
                axios.get(`https://api.taapi.io/fibonacciretracement?secret=${TAAPI_SECRET}&exchange=${settings.exchange}&symbol=${cryptoAsset}/${pair}&interval=${interval}&period=${period}&results=10`),
                axios.get(`https://api.taapi.io/vosc?secret=${TAAPI_SECRET}&exchange=${settings.exchange}&symbol=${cryptoAsset}/${pair}&interval=${interval}&short_period=10&long_period=50`)
            ];

            const results = await Promise.all(requests);

            const predictions = results
                .map((resp, index) => {
                    switch (index) {
                        case 0:
                            if (results[1] && results[1].data) return rsiFormula(resp.data, results[1].data.value);
                            break;
                        case 1:
                            return null;
                        case 2:
                            if (results[3] && results[3].data) return macdFormula(resp.data, results[1].data.value); // preserve original mapping
                            break;
                        case 3:
                            return null;
                        case 4:
                            if (results[5] && results[5].data) return bollingerBandsFormula(resp.data, results[1].data.value);
                            break;
                        case 5:
                            return null;
                        case 6:
                            if (results[7] && results[7].data) return fibonacciRetracementFormula(resp.data, results[1].data.value);
                            break;
                        case 7:
                            return null;
                        case 8:
                            if (results[8] && results[8].data) return voscFormula(resp.data, results[1].data.value);
                            break;
                        default:
                            return null;
                    }
                })
                .filter((p) => p !== null);

            const overallPrediction = evaluateAssetDirection(predictions);

            const bullFlagPattern = await getBullFlagSignal(TAAPI_SECRET, `${runtimeSettings.exchange}`, `${cryptoAsset}/${pair}`, `${interval}`, `${period}`);
            const bearFlagPattern = await getBearFlagSignal(TAAPI_SECRET, `${runtimeSettings.exchange}`, `${cryptoAsset}/${pair}`, `${interval}`, `${period}`);

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

            const targets = estimateTargetPrice(indicatorState.assetPrice, technicalData, patternData, overallPrediction);

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
                { exchange: settings.exchange }
            ]);
        } catch (err) {
            console.error(err);
            return res.status(500).send('Failed to retrieve indicator data.');
        }
    }

    // Specific indicator endpoint mapping
    let endpoint = '';
    const base = 'https://api.taapi.io/';
    const common = `secret=${TAAPI_SECRET}&exchange=${settings.exchange}&symbol=${cryptoAsset}/USDT&interval=${interval}`;

    switch (formulaType) {
        case 'formula1': // RSI
            endpoint = {
                ep: `${base}rsi?${common}&period=${period}`,
                ep2: `${base}rsi?${common}&period=${period}&results=30`
            };
            break;
        case 'formula2': // MACD
            endpoint = {
                ep: `${base}macd?${common}`,
                ep2: `${base}rsi?${common}&results=10` // preserve original behavior
            };
            break;
        case 'formula3': // Bollinger Bands
            endpoint = {
                ep: `${base}bbands?${common}&period=${period}`,
                ep2: `${base}rsi?${common}&period=${period}&results=10`
            };
            break;
        case 'formula4': // Fibonacci retracement
            endpoint = {
                ep: `${base}fibonacciretracement?${common}&period=${period}`,
                ep2: `${base}rsi?${common}&period=${period}&results=10`
            };
            break;
        case 'formula5': // VOSC
            endpoint = {
                ep: `${base}vosc?${common}&short_period=10&long_period=50`,
                ep2: `${base}vosc?${common}&short_period=10&long_period=50&results=10`
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
        const data = responses.map((r) => r.data);

        const prediction = determineProfitability(data, formulaType);
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

    try {
        const bullResult = await getBullFlagSignal(TAAPI_SECRET, runtimeSettings.exchange, pair, interval, period);
        const bearResult = await getBearFlagSignal(TAAPI_SECRET, runtimeSettings.exchange, pair, interval, period);
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
