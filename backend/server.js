// server.js
// Load environment variables
const path = require('path');
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const app = express();

const TAAPI_SECRET = process.env.TAAPI_SECRET;

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, '../frontend/public')));
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.post('/check-profitability', async (req, res) => {
    const { cryptoAsset, formulaType } = req.body;

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
    }

    try {
        const response = await axios.get(endpoint);
        const prediction = determineProfitability(response.data, formulaType);
        res.json({ isProfitable: prediction });
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
        default:
            return 'neutral';
    }
}

function rsiFormula(data) {
    const rsiValue = data.value;
    if (rsiValue > 70) return 'fall';
    else if (rsiValue < 30) return 'rise';
    else return 'neutral';
}

function macdFormula(data) {
    const macdLine = data.valueMACD;
    const signalLine = data.valueMACDSignal;
    if (macdLine > signalLine) return 'rise';
    else if (macdLine < signalLine) return 'fall';
    else return 'neutral';
}

function bollingerBandsFormula(data) {
    // Assuming current price is middle band, though this may need to be fetched separately
    const price = data.valueMiddleBand;
    const upperBand = data.valueUpperBand;
    const lowerBand = data.valueLowerBand;
    if (price > upperBand) return 'fall';
    else if (price < lowerBand) return 'rise';
    else return 'neutral';
}


const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});

app.get('/', (req, res) => {
    res.render('index');
});