// server.js
// Load environment variables
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const app = express();
const { createCanvas, loadImage } = require('canvas');

const TAAPI_SECRET = process.env.TAAPI_SECRET;

//global variables for the asset being displayed
const GLOBAL_VARIABLES = {
    assetPrice: "",
    rsiValue: "",
    volumeValue: "",
    bollValue: "",
    fibonValue: "",
    MacdValue: "",
    emaValue: "",
    name: "",
}

function clearObject(obj) {
    Object.keys(obj).forEach((key) => {
        obj[key] = '';
    });
}


app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '/frontend/public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '/frontend/views'));

async function getSymbols(req, res, next) {
    try {
        const response = await axios.get(`https://api.taapi.io/exchange-symbols?secret=${TAAPI_SECRET}&exchange=binance`);
        req.symbols = response.data; // Assign the retrieved data to req.symbols
        next(); // Call the next middleware or route handler
    } catch (error) {
        console.error(error);
        // You might want to handle the error and send an appropriate response here
        res.status(500).send('Failed to retrieve symbols data.');
    }
}

app.post('/check-profitability', async (req, res) => {
    const { cryptoAsset, formulaType, interval = '1h', period = 14, pair = 'USDT' } = req.body; // Defaulting to '1h' interval and period of 14 if not provided


    if (formulaType !== "formula7") {
        clearObject(GLOBAL_VARIABLES);
    }

    // Grab asset price
    try {
        let response = await axios.get(`https://api.taapi.io/price?secret=${TAAPI_SECRET}&exchange=binance&symbol=${cryptoAsset}/${pair}&interval=1m`)
        console.log(`Asset Price: ${response.data.value}`)
        GLOBAL_VARIABLES.assetPrice = response.data.value;
        GLOBAL_VARIABLES.name = cryptoAsset
    } catch (error) {
        console.error(error);
        return res.status(500).send('Failed to retrieve Asset Price.');
    }


    if (formulaType === 'formula6') { // EMA Crossover
        try {
            const prediction = await emaCrossoverFormula(cryptoAsset, interval, period); // retrieving prediction from formula 
            return res.json([{ isProfitable: prediction.direction }, GLOBAL_VARIABLES]); // passing prediction back to javascript client
        } catch (error) {
            console.error(error);
            return res.status(500).send('Failed to retrieve EMA data (server).');
        }
    }

    if (formulaType === 'formula7') { // Bear Flag Pattern
        try {
            const bearFlagPattern = await getBearFlagSignal(
                TAAPI_SECRET,
                'binance',
                `${cryptoAsset}/${pair}`,
                `${interval}`,
                `${period}`
            );
            if (bearFlagPattern.patternFound) {
                // Draw the bear flag pattern on a canvas
                await drawBearFlag(bearFlagPattern.candleData);
            }
            return res.json([{
                isProfitable: bearFlagPattern.patternFound,
                flagPrice: bearFlagPattern.targetPrice,
                flagHeight: bearFlagPattern.flagpoleHeight,
                theError: bearFlagPattern.error,
            }, GLOBAL_VARIABLES]);
        } catch (error) {
            console.error(error);
            return res.status(500).send('Failed to retrieve bear flag pattern data.');
        }
    }

    if (formulaType === 'formula8') { // Bull Flag Pattern
        try {
            const bullFlagPattern = await getBullFlagSignal(
                TAAPI_SECRET,
                'binance',
                `${cryptoAsset}/${pair}`,
                `${interval}`,
                `${period}`
            );
            if (bullFlagPattern.patternFound) {
                // Draw the bear flag pattern on a canvas
                await drawBearFlag(bullFlagPattern.candleData);
            }
            return res.json([{
                isProfitable: bullFlagPattern.patternFound,
                flagPrice: bullFlagPattern.targetPrice,
                flagHeight: bullFlagPattern.flagpoleHeight,
                theError: bullFlagPattern.error,
            }, GLOBAL_VARIABLES]);
        } catch (error) {
            console.error(error);
            return res.status(500).send('Failed to retrieve bull flag pattern data.');
        }
    }



    if (formulaType === 'all') {  // Check for all formulas
        try {
            const results = await Promise.all([

                axios.get(`https://api.taapi.io/rsi?secret=${TAAPI_SECRET}&exchange=binance&symbol=${cryptoAsset}/${pair}&interval=${interval}&period=${period}`),
                axios.get(`https://api.taapi.io/rsi?secret=${TAAPI_SECRET}&exchange=binance&symbol=${cryptoAsset}/${pair}&interval=${interval}&period=${period}&results=30`),
                axios.get(`https://api.taapi.io/macd?secret=${TAAPI_SECRET}&exchange=binance&symbol=${cryptoAsset}/${pair}&interval=${interval}`),
                axios.get(`https://api.taapi.io/macd?secret=${TAAPI_SECRET}&exchange=binance&symbol=${cryptoAsset}/${pair}&interval=${interval}&results=10`),
                axios.get(`https://api.taapi.io/bbands?secret=${TAAPI_SECRET}&exchange=binance&symbol=${cryptoAsset}/${pair}&interval=${interval}`),
                axios.get(`https://api.taapi.io/fibonacciretracement?secret=${TAAPI_SECRET}&exchange=binance&symbol=${cryptoAsset}/${pair}&interval=${interval}`),
                axios.get(`https://api.taapi.io/vosc?secret=${TAAPI_SECRET}&exchange=binance&symbol=${cryptoAsset}/${pair}&interval=1h&short_period=10&long_period=50`),
                emaCrossoverFormula(cryptoAsset, interval, period)
            ]);

            const predictions = results.map((response, index) => {
                switch (index) {
                    case 0: if (results[1] && results[1].data) {
                        return rsiFormula(response.data, results[1].data.value);
                    }
                    case 1:
                        return null
                    case 2: if (results[3] && results[3].data) {
                        return macdFormula(response.data, results[1].data.value);
                    }
                    case 3:
                        return null
                    case 4:
                        return bollingerBandsFormula(response.data);
                    case 5:
                        return fibonacciRetracementFormula(response.data);
                    case 6:
                        return voscFormula(response.data);
                    case 7:
                        return response;  // EMA result is already a prediction
                    default:
                        return { direction: 'neutral', value: '00' };
                }
            }).filter(prediction => prediction !== null); // Remove null entries (for index 1)

            const overallPrediction = evaluateAssetDirection(predictions);
            return res.json([{ isProfitable: overallPrediction }, GLOBAL_VARIABLES]);

        } catch (error) {
            console.error(error);
            return res.status(500).send('Failed to retrieve indicator data.');
        }
    }
    let endpoint = '';
    const baseEndpoint = `https://api.taapi.io/`;
    const commonParams = `secret=${TAAPI_SECRET}&exchange=binance&symbol=${cryptoAsset}/USDT&interval=${interval}`;

    // ep is current and ep2 is historical data
    switch (formulaType) {
        case 'formula1':  // Using RSI
            endpoint = {
                ep: `${baseEndpoint}rsi?${commonParams}&period=${period}`,
                ep2: `${baseEndpoint}rsi?${commonParams}&period=${period}&results=30`
            };
            break;
        case 'formula2':  // Using MACD
            endpoint = {
                ep: `${baseEndpoint}macd?${commonParams}`,
                ep2: `${baseEndpoint}rsi?${commonParams}&results=10`
            };
            break;
        case 'formula3':  // Using Bollinger Bands
            endpoint = { ep: `${baseEndpoint}bbands?${commonParams}` };
            break;
        case 'formula4':  // Using Fibonacci retracement
            endpoint = { ep: `${baseEndpoint}fibonacciretracement?${commonParams}` };
            break;
        case 'formula5':  // Using VOSC
            endpoint = { ep: `${baseEndpoint}vosc?${commonParams}&short_period=10&long_period=50` };
            break;
    }

    try {
        // Create an array of promises for the endpoints that are defined
        let promises = [];
        if (endpoint.ep) promises.push(axios.get(endpoint.ep));
        if (endpoint.ep2) promises.push(axios.get(endpoint.ep2));

        // Execute all promises

        const responses = await Promise.all(promises);
        console.log(promises)
        const data = responses.map(response => response.data);
        console.log(`Array Data:`, data)
        const prediction = determineProfitability(data, formulaType);
        res.json([{ isProfitable: prediction.direction }, GLOBAL_VARIABLES]);
    } catch (error) {
        console.error(error);
        res.json({ Message: 'Nope' })
        res.status(500).send('Failed to retrieve indicator data.');
    }
});

// Add an endpoint for scanning a specific pair
app.get('/scan/:asset/:currency', async (req, res) => {
    const asset = req.params.asset;
    const currency = req.params.currency;
    const pair = `${asset}/${currency}`;
    const interval = req.query.interval || '1h';
    const period = parseInt(req.query.period) || 14;

    try {
        const bullResult = await getBullFlagSignal(TAAPI_SECRET, 'binance', pair, interval, period);
        const bearResult = await getBearFlagSignal(TAAPI_SECRET, 'binance', pair, interval, period);
        const pairData = await getPairData(asset, currency, interval);

        // Log bull flag if detected
        if (bullResult.patternFound) {
            await logFlagPattern(pair, 'Bull', bullResult.targetPrice, bullResult.flagpoleHeight);
        }

        // Log bear flag if detected
        if (bearResult.patternFound) {
            await logFlagPattern(pair, 'Bear', bearResult.targetPrice, bearResult.flagpoleHeight);
        }

        res.json({
            pair,
            bullFlag: bullResult,
            bearFlag: bearResult,
            ...pairData
        });
    } catch (error) {
        console.error('Error in /scan/:asset/:currency:', error);
        res.status(500).json({
            error: 'An error occurred while scanning',
            message: error.message,
            pair,
            bullFlag: { patternFound: false },
            bearFlag: { patternFound: false },
            assetPrice: 'N/A',
            name: asset
        });
    }
});

async function getPairData(cryptoAsset, quoteCurrency, interval) {

    try {
        let response = await axios.get(`https://api.taapi.io/price?secret=${TAAPI_SECRET}&exchange=binance&symbol=${cryptoAsset}/${quoteCurrency}&interval=${interval}`);
        console.log(`Asset Price: ${response.data.value}`);
        return {
            assetPrice: response.data.value,
            name: cryptoAsset
        };
    } catch (error) {
        console.error('Error in getPairData:', error);
        throw new Error('Failed to retrieve Asset Price');
    }
}

function determineProfitability(data, formula) {
    switch (formula) {
        case 'formula1':
            return rsiFormula(data[0], data[1].value);
        case 'formula2':
            return macdFormula(data[0], data[1].value);
        case 'formula3':
            return bollingerBandsFormula(data[0]);
        case 'formula4':
            return fibonacciRetracementFormula(data[0]);
        case 'formula5':
            return voscFormula(data[0]);
        default:
            return 'neutral';
    }
}

async function getBearFlagSignal(api_secret, exchange, symbol, interval, period = 14, options = {}) {

    console.log(`Show BearFlagData: ${period}, ${interval}`)
    // Constants and configurable parameters
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
        const response = await axios.get(url);
        const data = response.data;

        if (!data || data.length < period) {
            return { patternFound: false, candleData: null, error: "Insufficient data" };
        }

        let flagpoleStart = -1;
        let flagpoleHigh = 0;
        let flagpoleLow = Infinity;
        let flagStart = -1;
        let volumeDuringFlagpole = 0;
        let volumeDuringFlag = 0;
        let flagDuration = 0;
        let patternScore = 0;

        // Find significant downtrend (flagpole)
        for (let i = 1; i < data.length; i++) {
            if (data[i] && data[i - 1] && (data[i - 1].high - data[i].low) / data[i - 1].high > significantDowntrendPercentage) {
                flagpoleStart = i - 1;
                break;
            }
        }

        if (flagpoleStart === -1) {
            return { patternFound: false, candleData: data, error: "No significant downtrend found" };
        }

        // Analyze flagpole and flag
        for (let i = flagpoleStart; i < data.length; i++) {
            if (!data[i]) continue;  // Skip if current candle is undefined

            if (flagStart === -1) {
                // Still in flagpole
                flagpoleHigh = Math.max(flagpoleHigh, data[i].high);
                flagpoleLow = Math.min(flagpoleLow, data[i].low);
                volumeDuringFlagpole += data[i].volume;

                // Check for potential start of flag
                if (i > 0 && data[i - 1] && data[i].close > data[i - 1].close) {
                    flagStart = i;
                }
            } else {
                // In flag formation
                flagDuration++;
                volumeDuringFlag += data[i].volume;

                // Check flag boundaries
                const flagHighBoundary = flagpoleHigh * (1 - flagThreshold);
                const flagLowBoundary = flagpoleLow * (1 + flagThreshold);

                if (data[i].high > flagHighBoundary || data[i].low < flagLowBoundary) {
                    break;
                }

                // Check for breakout
                if (data[i].close < flagLowBoundary) {
                    const avgVolumeFlagpole = volumeDuringFlagpole / (flagStart - flagpoleStart);
                    const avgVolumeFlag = volumeDuringFlag / flagDuration;

                    if (avgVolumeFlag < avgVolumeFlagpole * volumeDecreaseThreshold &&
                        data[i].volume > avgVolumeFlag * breakoutVolumeIncrease &&
                        flagDuration >= minFlagDuration &&
                        i - flagpoleStart <= maxPatternDuration) {

                        // Calculate pattern score
                        patternScore = calculatePatternScore(data, flagpoleStart, flagStart, i,
                            avgVolumeFlagpole, avgVolumeFlag);

                        const flagpoleHeight = flagpoleHigh - flagpoleLow;
                        const targetPrice = data[i].low - flagpoleHeight;

                        return {
                            patternFound: true,
                            targetPrice: targetPrice,
                            flagpoleHeight: flagpoleHeight,
                            patternScore: patternScore,
                            candleData: data,
                            flagpoleStartIndex: flagpoleStart,
                            flagStartIndex: flagStart,
                            breakoutIndex: i
                        };
                    }
                }
            }
        }
        console.log('no Bear')
        return { patternFound: false, candleData: data, error: "No valid bear flag pattern found" };
    } catch (error) {
        console.error(error);
        if (error.response) {
            throw new Error(`API error: ${error.response.status} - ${error.response.data}`);
        } else if (error.request) {
            throw new Error("Network error: No response received from the server");
        } else {
            throw new Error(`Error in processing request: ${error.message}`);
        }
    }
}

function calculatePatternScore(data, flagpoleStart, flagStart, breakoutIndex, avgVolumeFlagpole, avgVolumeFlag) {
    let score = 0;

    // Ensure all required data points exist
    if (!data[flagpoleStart] || !data[flagStart - 1] || !data[breakoutIndex] || !data[breakoutIndex - 1]) {
        return 0;  // Return 0 if any required data point is missing
    }

    // Score based on flagpole strength
    const flagpoleStrength = (data[flagpoleStart].high - data[flagStart - 1].low) / data[flagpoleStart].high;
    score += flagpoleStrength * 40;  // Max 40 points

    // Score based on flag duration
    const idealFlagDuration = 7;
    const flagDuration = breakoutIndex - flagStart;
    score += (1 - Math.abs(flagDuration - idealFlagDuration) / idealFlagDuration) * 20;  // Max 20 points

    // Score based on volume characteristics
    const volumeDecrease = 1 - (avgVolumeFlag / avgVolumeFlagpole);
    score += volumeDecrease * 20;  // Max 20 points

    // Score based on breakout strength
    const breakoutStrength = (data[breakoutIndex - 1].close - data[breakoutIndex].close) / data[breakoutIndex - 1].close;
    score += breakoutStrength * 20;  // Max 20 points

    return Math.min(Math.round(score), 100);  // Ensure score is between 0 and 100
}

async function getBullFlagSignal(api_secret, exchange, symbol, interval, period = 14, options = {}) {
    // Constants and configurable parameters
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
        const response = await axios.get(url);
        const data = response.data;

        if (!data || data.length < period) {
            return { patternFound: false, candleData: null, error: "Insufficient data" };
        }

        let flagpoleStart = -1;
        let flagpoleHigh = -Infinity;
        let flagpoleLow = Infinity;
        let flagStart = -1;
        let volumeDuringFlagpole = 0;
        let volumeDuringFlag = 0;
        let flagDuration = 0;
        let patternScore = 0;

        // Find significant uptrend (flagpole)
        for (let i = 1; i < data.length; i++) {
            if (data[i] && data[i - 1] && (data[i].high - data[i - 1].low) / data[i - 1].low > significantUptrendPercentage) {
                flagpoleStart = i - 1;
                break;
            }
        }

        if (flagpoleStart === -1) {
            return { patternFound: false, candleData: data, error: "No significant uptrend found" };
        }

        // Analyze flagpole and flag
        for (let i = flagpoleStart; i < data.length; i++) {
            if (!data[i]) continue;  // Skip if current candle is undefined

            if (flagStart === -1) {
                // Still in flagpole
                flagpoleHigh = Math.max(flagpoleHigh, data[i].high);
                flagpoleLow = Math.min(flagpoleLow, data[i].low);
                volumeDuringFlagpole += data[i].volume;

                // Check for potential start of flag
                if (i > 0 && data[i - 1] && data[i].close < data[i - 1].close) {
                    flagStart = i;
                }
            } else {
                // In flag formation
                flagDuration++;
                volumeDuringFlag += data[i].volume;

                // Check flag boundaries
                const flagHighBoundary = flagpoleHigh * (1 + flagThreshold);
                const flagLowBoundary = flagpoleLow * (1 - flagThreshold);

                if (data[i].high > flagHighBoundary || data[i].low < flagLowBoundary) {
                    break;
                }

                // Check for breakout
                if (data[i].close > flagHighBoundary) {
                    const avgVolumeFlagpole = volumeDuringFlagpole / (flagStart - flagpoleStart);
                    const avgVolumeFlag = volumeDuringFlag / flagDuration;

                    if (avgVolumeFlag < avgVolumeFlagpole * volumeDecreaseThreshold &&
                        data[i].volume > avgVolumeFlag * breakoutVolumeIncrease &&
                        flagDuration >= minFlagDuration &&
                        i - flagpoleStart <= maxPatternDuration) {

                        // Calculate pattern score
                        patternScore = calculateBullFlagPatternScore(data, flagpoleStart, flagStart, i,
                            avgVolumeFlagpole, avgVolumeFlag);

                        const flagpoleHeight = flagpoleHigh - flagpoleLow;
                        const targetPrice = data[i].high + flagpoleHeight;

                        return {
                            patternFound: true,
                            targetPrice: targetPrice,
                            flagpoleHeight: flagpoleHeight,
                            patternScore: patternScore,
                            candleData: data,
                            flagpoleStartIndex: flagpoleStart,
                            flagStartIndex: flagStart,
                            breakoutIndex: i
                        };
                    }
                }
            }
        }

        return { patternFound: false, candleData: data, error: "No valid bull flag pattern found" };
    } catch (error) {
        console.error(error);
        if (error.response) {
            throw new Error(`API error: ${error.response.status} - ${error.response.data}`);
        } else if (error.request) {
            throw new Error("Network error: No response received from the server");
        } else {
            throw new Error(`Error in processing request: ${error.message}`);
        }
    }
}

function calculateBullFlagPatternScore(data, flagpoleStart, flagStart, breakoutIndex, avgVolumeFlagpole, avgVolumeFlag) {
    let score = 0;

    // Ensure all required data points exist
    if (!data[flagpoleStart] || !data[flagStart - 1] || !data[breakoutIndex] || !data[breakoutIndex - 1]) {
        return 0;  // Return 0 if any required data point is missing
    }

    // Score based on flagpole strength
    const flagpoleStrength = (data[flagStart - 1].high - data[flagpoleStart].low) / data[flagpoleStart].low;
    score += flagpoleStrength * 40;  // Max 40 points

    // Score based on flag duration
    const idealFlagDuration = 7;
    const flagDuration = breakoutIndex - flagStart;
    score += (1 - Math.abs(flagDuration - idealFlagDuration) / idealFlagDuration) * 20;  // Max 20 points

    // Score based on volume characteristics
    const volumeDecrease = 1 - (avgVolumeFlag / avgVolumeFlagpole);
    score += volumeDecrease * 20;  // Max 20 points

    // Score based on breakout strength
    const breakoutStrength = (data[breakoutIndex].close - data[breakoutIndex - 1].close) / data[breakoutIndex - 1].close;
    score += breakoutStrength * 20;  // Max 20 points

    return Math.min(Math.round(score), 100);  // Ensure score is between 0 and 100
}

async function logFlagPattern(pair, flagType, targetPrice, flagpoleHeight) {
    const logDir = path.join(__dirname, 'logs');
    const logFile = path.join(logDir, 'flag_patterns.log');
    const timestamp = new Date().toISOString();
    const logEntry = `${timestamp} - ${pair} - ${flagType} Flag detected. Target Price: ${targetPrice}, Flagpole Height: ${flagpoleHeight}\n`;

    try {
        // Create logs directory if it doesn't exist
        fs.mkdir(logDir, { recursive: true });

        // Append to the log file
        fs.appendFile(logFile, logEntry);
        console.log(`Flag pattern logged for ${pair}`);
    } catch (error) {
        console.error('Error logging flag pattern:', error);
    }
}

async function drawBearFlag(candleData) {
    const canvasWidth = 1200; // Adjust as needed
    const canvasHeight = 600; // Adjust as needed
    const candleWidth = 20; // Adjust as needed
    const flagpoleLineWidth = 2;
    const flagpoleLineColor = 'red';
    const flagColor = 'rgba(255, 0, 0, 0.3)';
    const textFont = '14px Arial';

    // Find the highest and lowest prices in the candle data
    const prices = candleData.map((candle) => candle.high).concat(candleData.map((candle) => candle.low));
    const maxPrice = Math.max(...prices);
    const minPrice = Math.min(...prices);

    // Calculate the scale for drawing the candle data on the canvas
    const priceRange = maxPrice - minPrice;
    const priceScale = canvasHeight / priceRange;

    // Create a new canvas and context
    const canvas = createCanvas(canvasWidth, canvasHeight);
    const ctx = canvas.getContext('2d');

    // Draw horizontal lines for major price levels (optional)
    const priceStep = 100; // Adjust based on the price range
    ctx.strokeStyle = '#d3d3d3';
    ctx.lineWidth = 1;

    for (let price = Math.ceil(minPrice / priceStep) * priceStep; price <= maxPrice; price += priceStep) {
        const y = canvasHeight - (price - minPrice) * priceScale;
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvasWidth, y);
        ctx.stroke();
    }

    // Draw the bear flag pattern on the canvas
    for (let i = 0; i < candleData.length; i++) {
        const candle = candleData[i];
        const x = i * candleWidth;
        const yOpen = canvasHeight - (candle.open - minPrice) * priceScale;
        const yHigh = canvasHeight - (candle.high - minPrice) * priceScale;
        const yLow = canvasHeight - (candle.low - minPrice) * priceScale;
        const yClose = canvasHeight - (candle.close - minPrice) * priceScale;

        // Draw candle body
        ctx.strokeStyle = candle.close < candle.open ? 'red' : 'green';
        ctx.fillStyle = candle.close < candle.open ? 'red' : 'green';
        ctx.fillRect(x + 2, yOpen, candleWidth - 4, yClose - yOpen);
        ctx.strokeRect(x + 2, yOpen, candleWidth - 4, yClose - yOpen);

        // Draw candle wick
        ctx.beginPath();
        ctx.moveTo(x + candleWidth / 2, yHigh);
        ctx.lineTo(x + candleWidth / 2, yLow);
        ctx.stroke();

        // Draw the flagpole
        if (candle.flagpole) {
            const { high, low } = candle.flagpole;
            const yFlagpoleHigh = canvasHeight - (high - minPrice) * priceScale;
            const yFlagpoleLow = canvasHeight - (low - minPrice) * priceScale;

            // Draw lines connecting flagpole highs and lows
            ctx.strokeStyle = flagpoleLineColor;
            ctx.lineWidth = flagpoleLineWidth;
            ctx.beginPath();
            ctx.moveTo(x + candleWidth / 2, yFlagpoleHigh);
            ctx.lineTo(x + candleWidth / 2, yFlagpoleLow);
            ctx.stroke();

            // Draw the flag area
            ctx.fillStyle = flagColor;
            ctx.fillRect(x, yFlagpoleHigh, candleWidth, yFlagpoleLow - yFlagpoleHigh);
        }
    }

    // Draw price labels for each candle
    ctx.fillStyle = 'black';
    ctx.font = textFont;
    for (let i = 0; i < candleData.length; i++) {
        const candle = candleData[i];
        const x = i * candleWidth + 2;
        const yClose = canvasHeight - (candle.close - minPrice) * priceScale - 18;
        ctx.fillText(candle.close.toFixed(2), x, yClose);
    }

    // Save the canvas as an image (optional)

    const out = fs.createWriteStream(__dirname + '/bear_flag_pattern.png');
    const stream = canvas.createPNGStream();
    stream.pipe(out);
    out.on('finish', () => console.log('Bear flag pattern saved as bear_flag_pattern.png'));
}

// Helper function to calculate volatility
function calculateVolatility(historicalData) {
    const values = historicalData.map(d => d.value);
    const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
    const squaredDifferences = values.map(value => Math.pow(value - mean, 2));
    return Math.sqrt(squaredDifferences.reduce((sum, value) => sum + value, 0) / values.length);
}

// Helper function to get overbought/oversold duration
function getExtremeRSIDuration(historicalData, threshold, isOverbought) {
    let duration = 0;
    for (let i = historicalData.length - 1; i >= 0; i--) {
        if ((isOverbought && historicalData[i].value > threshold) ||
            (!isOverbought && historicalData[i].value < threshold)) {
            duration++;
        } else {
            break;
        }
    }
    return duration;
}

// Updated RSI formula function
function rsiFormula(currentRSI, historicalRSI) {
    const rsiValue = currentRSI.value;

    GLOBAL_VARIABLES.rsiValue = rsiValue;
    console.log(`Current RSI: ${rsiValue}`);
    console.log(`Historical RSI:`, historicalRSI);

    // Get previous RSI value
    const previousRSI = historicalRSI.length > 1 ? historicalRSI[historicalRSI.length - 2].value : rsiValue;

    // Calculate volatility adjustment
    const volatilityAdjustment = Math.min(calculateVolatility(historicalRSI) * 2, 10); // Cap at 10

    // Adjust thresholds based on volatility
    const upperThreshold = 70 + volatilityAdjustment;
    const lowerThreshold = 30 - volatilityAdjustment;

    // Check for extreme RSI durations
    const overboughtDuration = getExtremeRSIDuration(historicalRSI, upperThreshold, true);
    const oversoldDuration = getExtremeRSIDuration(historicalRSI, lowerThreshold, false);

    // Determine signal strength and direction
    if (rsiValue > upperThreshold) {
        const strength = overboughtDuration > 3 ? 2 : 2;
        console.log(`Strength:`, strength)
        return { direction: 'fall', value: strength, reason: `RSI overbought for ${overboughtDuration} periods` };
    } else if (rsiValue < lowerThreshold) {
        const strength = oversoldDuration > 3 ? -1 : -1;
        console.log(`Strength:`, strength)
        return { direction: 'rise', value: strength, reason: `RSI oversold for ${oversoldDuration} periods` };
    } else if (rsiValue > 50 && rsiValue < previousRSI) {
        return { direction: 'fall', value: 1, reason: 'RSI declining from bullish territory' };
    } else if (rsiValue < 50 && rsiValue > previousRSI) {
        return { direction: 'rise', value: 0, reason: 'RSI rising from bearish territory' };
    }

    return { direction: 'neutral', value: '00', reason: 'RSI in neutral zone' };
}

function macdFormula(data, historicalData) {
    const macdLine = parseFloat(data.valueMACD);
    const signalLine = parseFloat(data.valueMACDSignal);
    const histogram = macdLine - signalLine;

    console.log('MACD data:', { macdLine, signalLine, histogram });
    console.log(`MACD Historical:`, historicalData)
    GLOBAL_VARIABLES.MacdValue = `MACD: ${macdLine.toFixed(4)} Signal: ${signalLine.toFixed(4)} Histogram: ${histogram.toFixed(4)}`;

    // Analyze trend
    const previousMACD = historicalData[historicalData.length - 2].valueMACD;
    const previousSignal = historicalData[historicalData.length - 2].valueMACDSignal;
    const macdTrend = macdLine > previousMACD ? 'rising' : 'falling';
    const signalTrend = signalLine > previousSignal ? 'rising' : 'falling';

    // Determine signal strength
    const signalStrength = Math.abs(histogram) / ((macdLine + signalLine) / 2);

    let direction, value, reason;

    if (macdLine > signalLine) {
        direction = 'rise';
        value = signalStrength > 0.1 ? 0 : 0; // Stronger signal if difference is significant
        reason = `MACD (${macdTrend}) above Signal (${signalTrend})`;
        if (macdLine > 0 && signalLine > 0) {
            reason += ' above zero line - strong bullish';
            value = -1;
        }
    } else if (macdLine < signalLine) {
        direction = 'fall';
        value = signalStrength > 0.1 ? 1 : 1;
        reason = `MACD (${macdTrend}) below Signal (${signalTrend})`;
        if (macdLine < 0 && signalLine < 0) {
            reason += ' below zero line - strong bearish';
            value = 2;
        }
    } else {
        direction = 'neutral';
        value = '00';
        reason = 'MACD and Signal lines are equal';
    }

    // Check for potential divergence
    const priceTrend = historicalData[historicalData.length - 1].close > historicalData[0].close ? 'rising' : 'falling';
    if (priceTrend !== macdTrend) {
        reason += ' - Potential divergence detected';
        value = Math.min(value + 1, 2); // Increase signal strength, but cap at 2
    }

    return { direction, value, reason };
}

function bollingerBandsFormula(data) {
    // Assuming current price is middle band, though this may need to be fetched separately
    const price = GLOBAL_VARIABLES.assetPrice;
    const upperBand = parseFloat(data.valueUpperBand).toFixed(4);
    const lowerBand = parseFloat(data.valueLowerBand).toFixed(4);
    GLOBAL_VARIABLES.bollValue = `Upper: ${upperBand} Lower: ${lowerBand}`
    console.log([price, upperBand, lowerBand])
    if (price > upperBand) return { direction: 'fall', value: 1 };
    else if (price < lowerBand) return { direction: 'rise', value: 0 };
    else return { direction: 'neutral', value: '00' };
}

function fibonacciRetracementFormula(data) {
    const retracementValue = parseFloat(data.value).toFixed(4);
    const currentTrend = data.trend;
    GLOBAL_VARIABLES.fibonValue = `Retrace: ${retracementValue} Trend: ${currentTrend}`
    console.log([retracementValue, currentTrend])

    if (data.trend === "DOWNTREND") {
        return retracementValue > 61.8 ? { direction: 'fall', value: 1 } : { direction: 'rise', value: 0 };
    } else { // Assuming UPTREND if not DOWNTREND
        return retracementValue < 38.2 ? { direction: 'rise', value: 0 } : { direction: 'fall', value: 1 };
    }
}

function voscFormula(data) {
    const voscValue = data.value;
    GLOBAL_VARIABLES.volumeValue = voscValue
    console.log([voscValue])
    if (voscValue > 0) {
        return { direction: 'rise', value: 0 };
    } else if (voscValue < 0) {
        return { direction: 'fall', value: 1 };
    } else {
        return { direction: 'neutral', value: '00' };
    }
}

async function emaCrossoverFormula(cryptoAsset, interval, period) {

    const shortPeriod = Number(period);
    const longPeriod = Number(period) + 14;

    const shortEmaEndpoint = `https://api.taapi.io/ema?secret=${TAAPI_SECRET}&exchange=binance&symbol=${cryptoAsset}/USDT&interval=${interval}&backtracks=2&period=${shortPeriod}`;
    const longEmaEndpoint = `https://api.taapi.io/ema?secret=${TAAPI_SECRET}&exchange=binance&symbol=${cryptoAsset}/USDT&interval=${interval}&backtracks=2&period=${longPeriod}`;

    try {
        const [shortEmaResponse, longEmaResponse] = await Promise.all([
            axios.get(shortEmaEndpoint),
            axios.get(longEmaEndpoint)
        ]);

        const currentShortEma = shortEmaResponse.data[0].value;
        const previousShortEma = shortEmaResponse.data[1].value;

        const currentLongEma = longEmaResponse.data[0].value;
        const previousLongEma = longEmaResponse.data[1].value;

        // round to nearest integer
        const roundedCurrentShortEma = parseFloat(currentShortEma.toFixed(4));
        const roundedCurrentLongEma = parseFloat(currentLongEma.toFixed(4));
        const roundedPreviousShortEma = parseFloat(previousShortEma.toFixed(4));
        const roundedPreviousLongEma = parseFloat(previousLongEma.toFixed(4));

        // Update the GLOBAL_VARIABLES.emaValue with the rounded values
        GLOBAL_VARIABLES.emaValue = `CShort: ${roundedCurrentShortEma} CLong: ${roundedCurrentLongEma} PShort: ${roundedPreviousShortEma} Plong: ${roundedPreviousLongEma}`;
        console.log([currentShortEma, currentLongEma, previousShortEma, previousLongEma])

        if (currentShortEma > currentLongEma && previousShortEma <= previousLongEma) return { direction: 'rise', value: 0 };
        if (currentShortEma < currentLongEma && previousShortEma >= previousLongEma) return { direction: 'fall', value: 1 };
        return { direction: 'neutral', value: '00' };
    } catch (error) {
        console.error(error);
        throw new Error('Failed to retrieve EMA data (function).');
        return
    }
}

function evaluateAssetDirection(predictions) {
    let riseCount = 0;
    let fallCount = 0;
    let neutralCount = 0;

    for (let prediction of predictions) {
        if (prediction.value === 0) riseCount++;
        else if (prediction.value === 1) fallCount++;
        else if (prediction.value === 2) fallCount = fallCount + 2;
        else if (prediction.value === -1) riseCount = riseCount + 2;
        else neutralCount++; // prediction.value === '00'
    }

    console.log(['Rise:', riseCount, 'Fall:', fallCount, 'Neutral:', neutralCount])

    if (riseCount > fallCount && riseCount > neutralCount) return "rise";
    if (fallCount > riseCount && fallCount > neutralCount) return "fall";
    return "neutral"; // Default to 'neutral' if unable to determine
}

const PORT = process.env.PORT || 3000;
const IP = '192.168.1.82'

app.listen(PORT, () => {
    console.log(`Server is running on http://${IP}:${PORT}`);
});

app.get('/', getSymbols, (req, res) => {
    let symbols = req.symbols.sort()
    res.render('index', { symbols: symbols });
});