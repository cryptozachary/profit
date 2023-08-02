// server.js
// Load environment variables
const path = require('path');
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const app = express();

const TAAPI_SECRET = process.env.TAAPI_SECRET;

//global variables
const GLOBAL_VARIABLES = {
    assetPrice: ""
}

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../frontend/public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '../frontend/views'));

app.post('/check-profitability', async (req, res) => {
    const { cryptoAsset, formulaType } = req.body;

    // grab asset price
    try {
        let response = await axios.get(`https://api.taapi.io/price?secret=${TAAPI_SECRET}&exchange=binance&symbol=${cryptoAsset}/USDT&interval=1m`)
        console.log(`Asset Price: ${response.data.value}`)
        GLOBAL_VARIABLES.assetPrice = response.data.value
    } catch {
        console.error(error);
        return res.status(500).send('Failed to retrieve Asset Price.');
    }


    if (formulaType === 'formula6') { // EMA Crossover
        try {
            const prediction = await emaCrossoverFormula(cryptoAsset);
            return res.json({ isProfitable: prediction.direction });
        } catch (error) {
            console.error(error);
            return res.status(500).send('Failed to retrieve EMA data.');
        }
    }

    if (formulaType === 'formula7') { // Bear Flag Pattern
        try {
            const bearFlagPattern = await getBearFlagSignal(
                TAAPI_SECRET,
                'binance',
                `${cryptoAsset}/USDT`,
                '1h',
                14
            );
            return res.json({ isProfitable: bearFlagPattern });
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
                emaCrossoverFormula(cryptoAsset)
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
            return res.json({ isProfitable: overallPrediction });

        } catch (error) {
            console.error(error);
            return res.status(500).send('Failed to retrieve indicator data.');
        }
    }

    let endpoint = '';
    switch (formulaType) {
        case 'formula1':  // Using RSI
            endpoint = `https://api.taapi.io/rsi?secret=${TAAPI_SECRET}&exchange=binance&symbol=${cryptoAsset}/USDT&interval=1h`;
            break;
        case 'formula2':  // Using MACD
            endpoint = `https://api.taapi.io/macd?secret=${TAAPI_SECRET}&exchange=binance&symbol=${cryptoAsset}/USDT&interval=1h`;
            break;
        case 'formula3':  // Using Bollinger Bands
            endpoint = `https://api.taapi.io/bbands?secret=${TAAPI_SECRET}&exchange=binance&symbol=${cryptoAsset}/USDT&interval=1h`;
            break;
        case 'formula4':  // Using Fibonacci retracement
            endpoint = `https://api.taapi.io/fibonacciretracement?secret=${TAAPI_SECRET}&exchange=binance&symbol=${cryptoAsset}/USDT&interval=1h`;
            break;
        case 'formula5':  // Using VOSC
            endpoint = `https://api.taapi.io/vosc?secret=${TAAPI_SECRET}&exchange=binance&symbol=${cryptoAsset}/USDT&interval=1h&short_period=10&long_period=50`;
            break;
    }

    try {
        const response = await axios.get(endpoint);
        const prediction = determineProfitability(response.data, formulaType);
        res.json({ isProfitable: prediction.direction });
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
            return false; // No data or invalid response
        }

        // Check for bear flag pattern
        for (let i = 1; i < data.length; i++) {
            // Check for downtrend (flagpole)
            if (data[i].close < data[i - 1].close) {
                const flagpoleHigh = data[i - 1].high;
                const flagpoleLow = data[i].low;

                // Check for consolidation (flag)
                let validFlag = true;
                for (let j = i + 1; j < data.length; j++) {
                    if (data[j].high > flagpoleHigh || data[j].low < flagpoleLow) {
                        validFlag = false;
                        break;
                    }
                }
                if (validFlag) {
                    return true; // Bear flag pattern found
                }
            }
        }

        return false; // No bear flag pattern found
    } catch (error) {
        console.error(error);
        throw new Error('Failed to retrieve candle data.');
    }
}

function rsiFormula(data) {
    const rsiValue = data.value;
    console.log([rsiValue])
    if (rsiValue > 70) return { direction: 'fall', value: 1 };
    else if (rsiValue < 30) return { direction: 'rise', value: 0 };
    else return { direction: 'neutral', value: '00' };

}

function macdFormula(data) {
    const macdLine = data.valueMACD;
    const signalLine = data.valueMACDSignal;
    console.log([macdLine, signalLine])
    if (macdLine > signalLine) return { direction: 'rise', value: 0 };
    else if (macdLine < signalLine) return { direction: 'fall', value: 1 };
    else return { direction: 'neutral', value: '00' };
}

function bollingerBandsFormula(data) {
    // Assuming current price is middle band, though this may need to be fetched separately
    const price = GLOBAL_VARIABLES.assetPrice;
    const upperBand = data.valueUpperBand;
    const lowerBand = data.valueLowerBand;
    console.log([price, upperBand, lowerBand])
    if (price > upperBand) return { direction: 'fall', value: 1 };
    else if (price < lowerBand) return { direction: 'rise', value: 0 };
    else return { direction: 'neutral', value: '00' };
}

function fibonacciRetracementFormula(data) {
    const retracementValue = data.value;
    const currentTrend = data.trend;
    console.log([retracementValue, currentTrend])

    if (data.trend === "DOWNTREND") {
        return retracementValue > 61.8 ? { direction: 'fall', value: 1 } : { direction: 'rise', value: 0 };
    } else { // Assuming UPTREND if not DOWNTREND
        return retracementValue < 38.2 ? { direction: 'rise', value: 0 } : { direction: 'fall', value: 1 };
    }
}

function voscFormula(data) {
    const voscValue = data.value;
    console.log([voscValue])
    if (voscValue > 0) {
        return { direction: 'rise', value: 0 };
    } else if (voscValue < 0) {
        return { direction: 'fall', value: 1 };
    } else {
        return { direction: 'neutral', value: '00' };
    }
}
async function emaCrossoverFormula(cryptoAsset) {
    const shortPeriod = 12;
    const longPeriod = 26;

    const shortEmaEndpoint = `https://api.taapi.io/ema?secret=${TAAPI_SECRET}&exchange=binance&symbol=${cryptoAsset}/USDT&interval=1h&backtracks=2&period=${shortPeriod}`;
    const longEmaEndpoint = `https://api.taapi.io/ema?secret=${TAAPI_SECRET}&exchange=binance&symbol=${cryptoAsset}/USDT&interval=1h&backtracks=2&period=${longPeriod}`;

    try {
        const [shortEmaResponse, longEmaResponse] = await Promise.all([
            axios.get(shortEmaEndpoint),
            axios.get(longEmaEndpoint)
        ]);

        const currentShortEma = shortEmaResponse.data[0].value;
        const previousShortEma = shortEmaResponse.data[1].value;

        const currentLongEma = longEmaResponse.data[0].value;
        const previousLongEma = longEmaResponse.data[1].value;

        console.log([currentShortEma, currentLongEma, previousShortEma, previousLongEma])

        if (currentShortEma > currentLongEma && previousShortEma <= previousLongEma) return { direction: 'rise', value: 0 };
        if (currentShortEma < currentLongEma && previousShortEma >= previousLongEma) return { direction: 'fall', value: 1 };
        return { direction: 'neutral', value: '00' };
    } catch (error) {
        console.error(error);
        throw new Error('Failed to retrieve EMA data.');
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

    console.log([riseCount, fallCount, neutralCount])

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