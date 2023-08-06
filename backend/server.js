// server.js
// Load environment variables
const path = require('path');
require('dotenv').config();
const express = require('express');
const axios = require('axios');
const app = express();

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
app.use(express.static(path.join(__dirname, '../frontend/public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../frontend/views'));

app.post('/check-profitability', async (req, res) => {
    const { cryptoAsset, formulaType, interval = '1h', period = 14 } = req.body; // Defaulting to '1h' interval and period of 14 if not provided

    clearObject(GLOBAL_VARIABLES)

    // Grab asset price
    try {
        let response = await axios.get(`https://api.taapi.io/price?secret=${TAAPI_SECRET}&exchange=binance&symbol=${cryptoAsset}/USDT&interval=1m`)
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
                `${cryptoAsset}/USDT`,
                `${interval}`,
                `${period}`
            );
            return res.json([{
                isProfitable: bearFlagPattern.patternFound,
                bearFlagPrice: bearFlagPattern.targetPrice,
                bearFlagHeight: bearFlagPattern.flagpoleHeight,
            }, GLOBAL_VARIABLES]);
        } catch (error) {
            console.error(error);
            return res.status(500).send('Failed to retrieve bear flag pattern data.');
        }
    }


    if (formulaType === 'all') {  // Check for all formulas
        try {
            const results = await Promise.all([
                axios.get(`https://api.taapi.io/rsi?secret=${TAAPI_SECRET}&exchange=binance&symbol=${cryptoAsset}/USDT&interval=1h`),
                axios.get(`https://api.taapi.io/macd?secret=${TAAPI_SECRET}&exchange=binance&symbol=${cryptoAsset}/USDT&interval=1h`),
                axios.get(`https://api.taapi.io/bbands?secret=${TAAPI_SECRET}&exchange=binance&symbol=${cryptoAsset}/USDT&interval=1h`),
                axios.get(`https://api.taapi.io/fibonacciretracement?secret=${TAAPI_SECRET}&exchange=binance&symbol=${cryptoAsset}/USDT&interval=1h`),
                axios.get(`https://api.taapi.io/vosc?secret=${TAAPI_SECRET}&exchange=binance&symbol=${cryptoAsset}/USDT&interval=1h&short_period=10&long_period=50`),
                emaCrossoverFormula(cryptoAsset, interval, period)
            ]);

            const predictions = results.map((response, index) => {
                switch (index) {
                    case 0:
                        return rsiFormula(response.data);
                    case 1:
                        return macdFormula(response.data);
                    case 2:
                        return bollingerBandsFormula(response.data);
                    case 3:
                        return fibonacciRetracementFormula(response.data);
                    case 4:
                        return voscFormula(response.data);
                    case 5:
                        return response;  // EMA result is already a prediction
                    default:
                        return { direction: 'neutral', value: '00' };
                }
            });

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

    switch (formulaType) {
        case 'formula1':  // Using RSI
            endpoint = `${baseEndpoint}rsi?${commonParams}`;
            break;
        case 'formula2':  // Using MACD
            endpoint = `${baseEndpoint}macd?${commonParams}`;
            break;
        case 'formula3':  // Using Bollinger Bands
            endpoint = `${baseEndpoint}bbands?${commonParams}`;
            break;
        case 'formula4':  // Using Fibonacci retracement
            endpoint = `${baseEndpoint}fibonacciretracement?${commonParams}`;
            break;
        case 'formula5':  // Using VOSC
            endpoint = `${baseEndpoint}vosc?${commonParams}&short_period=10&long_period=50`;
            break;
    }

    try {
        const response = await axios.get(endpoint);
        const prediction = determineProfitability(response.data, formulaType);
        res.json([{ isProfitable: prediction.direction }, GLOBAL_VARIABLES]);
    } catch (error) {
        console.error(error);
        res.status(500).send('Failed to retrieve indicator data.');
    }
});

function determineProfitability(data, formula) {
    switch (formula) {
        case 'formula1':
            return rsiFormula(data);
        case 'formula2':
            return macdFormula(data);
        case 'formula3':
            return bollingerBandsFormula(data);
        case 'formula4':
            return fibonacciRetracementFormula(data);
        case 'formula5':
            return voscFormula(data);
        default:
            return 'neutral';
    }
}

async function getBearFlagSignal(api_secret, exchange, symbol, interval, period = 14) {
    const url = `https://api.taapi.io/candles?secret=${api_secret}&exchange=${exchange}&symbol=${symbol}&interval=${interval}&period=${period}`;
    try {
        const response = await axios.get(url);
        const data = response.data;

        if (!data) {
            return { patternFound: false }; // No data or invalid response
        }

        // Check for bear flag pattern
        const minFlagDuration = 5;
        const flagpoleThreshold = 0.02; // 2% threshold for flagpole boundary
        const flagThreshold = 0.01; // 1% threshold for flag boundary
        let flagpoleHigh = 0;
        let flagpoleLow = 0;
        let flagDuration = 0;
        let volumeDuringFlag = 0;
        let slopeCheck = true;

        for (let i = 1; i < data.length; i++) {
            // Check for downtrend (flagpole)
            if (data[i].close < data[i - 1].close) {
                if (flagpoleHigh === 0) {
                    flagpoleHigh = data[i - 1].high;
                    flagpoleLow = data[i].low;
                    flagDuration = 1;
                    volumeDuringFlag = data[i].volume;
                } else {
                    // Update flagpoleHigh and flagpoleLow if a new high or low is detected
                    flagpoleHigh = Math.max(flagpoleHigh, data[i - 1].high);
                    flagpoleLow = Math.min(flagpoleLow, data[i].low);

                    // Check for volume decrease during flag
                    volumeDuringFlag += data[i].volume;
                    flagDuration++;

                    if (flagDuration >= minFlagDuration) {
                        const avgVolumeFlagpole = volumeDuringFlag / flagDuration;
                        if (data[i].volume < avgVolumeFlagpole) {
                            slopeCheck = slopeCheck && (data[i].close < data[i - 1].close);

                            // Check for flag boundaries
                            const flagHighBoundary = flagpoleHigh * (1 - flagpoleThreshold);
                            const flagLowBoundary = flagpoleLow * (1 + flagpoleThreshold);
                            if (data[i].high > flagHighBoundary || data[i].low < flagLowBoundary) {
                                slopeCheck = false;
                                break;
                            }
                        } else {
                            slopeCheck = false;
                            break;
                        }
                    }
                }
            }
        }

        // Check for breakout below the flag's low boundary
        const lastCandle = data[data.length - 1];
        const flagLowBoundary = flagpoleLow * (1 + flagpoleThreshold);
        if (lastCandle.close > flagLowBoundary) {
            return { patternFound: false };
        }

        if (slopeCheck) {
            const flagpoleHeight = flagpoleHigh - flagpoleLow;
            const targetPrice = lastCandle.low - flagpoleHeight; // Projecting downwards from the breakout point

            return {
                patternFound: true,
                targetPrice: targetPrice,
                flagpoleHeight: flagpoleHeight,
            };
        }

        return { patternFound: false }; // No bear flag pattern found
    } catch (error) {
        console.error(error);
        throw new Error('Failed to retrieve candle data.');
    }
}

function rsiFormula(data) {
    const rsiValue = data.value;
    GLOBAL_VARIABLES.rsiValue = rsiValue
    console.log([rsiValue])
    if (rsiValue > 70) return { direction: 'fall', value: 1 };
    else if (rsiValue < 30) return { direction: 'rise', value: 0 };
    else return { direction: 'neutral', value: '00' };

}

function macdFormula(data) {
    const macdLine = parseFloat(data.valueMACD).toFixed(4)
    const signalLine = parseFloat(data.valueMACDSignal).toFixed(4)
    console.log('data:', data)
    GLOBAL_VARIABLES.MacdValue = `MaccdLine: ${macdLine} SignalLine: ${signalLine}`
    console.log([macdLine, signalLine])
    if (macdLine > signalLine) return { direction: 'rise', value: 0 };
    else if (macdLine < signalLine) return { direction: 'fall', value: 1 };
    else return { direction: 'neutral', value: '00' };
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
    const shortPeriod = period;
    const longPeriod = period + 14;

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
    }
}

function evaluateAssetDirection(predictions) {
    let riseCount = 0;
    let fallCount = 0;
    let neutralCount = 0;

    for (let prediction of predictions) {
        if (prediction.value === 0) riseCount++;
        else if (prediction.value === 1) fallCount++;
        else neutralCount++; // prediction.value === '00'
    }

    console.log(['Rise:', riseCount, 'Fall:', fallCount, 'Neutral:', neutralCount])

    if (riseCount > fallCount && riseCount > neutralCount) return "rise";
    if (fallCount > riseCount && fallCount > neutralCount) return "fall";
    return "neutral"; // Default to 'neutral' if unable to determine
}

const PORT = 3000;
const IP = '192.168.1.82'

app.listen(PORT, IP, () => {
    console.log(`Server is running on http://${IP}:${PORT}`);
});

app.get('/', (req, res) => {
    res.render('index');
});