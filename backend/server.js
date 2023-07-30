// server.js
// Load environment variables
require('dotenv').config();
const express = require('express');
const bodyParser = require('body-parser');
const axios = require('axios');
const app = express();

const TAAPI_SECRET = process.env.TAAPI_SECRET;

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(express.static('public'));

app.post('/check-profitability', async (req, res) => {
    try {
        const { asset, formula } = req.body;

        let indicatorResponse = await axios.get('https://api.taapi.io/rsi', {
            params: {
                secret: TAAPI_SECRET,
                exchange: "binance",
                symbol: asset,
                interval: "1h",
            }
        });

        // Note: You will need to define the logic for determining profitability using the returned data and selected formula.
        const isProfitable = determineProfitability(indicatorResponse.data, formula);

        res.json({ isProfitable });
    } catch (error) {
        res.status(500).json({ error: "Failed to retrieve data." });
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
    const macdLine = data.macd;
    const signalLine = data.signal;
    if (macdLine > signalLine) return 'rise';
    else if (macdLine < signalLine) return 'fall';
    else return 'neutral';
}

function bollingerBandsFormula(data) {
    const price = data.price;
    const upperBand = data.upperBand;
    const lowerBand = data.lowerBand;
    if (price > upperBand) return 'fall';
    else if (price < lowerBand) return 'rise';
    else return 'neutral';
}


const PORT = 3000;
app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});