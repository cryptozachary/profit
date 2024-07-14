// Define global variables
const pairs = Array.from(document.querySelector('#chooseAsset').options).map(option => option.value);
console.log('Available pairs:', pairs);
let currentPairIndex = 0;
let isAutoScanning = false;
let scanInterval;

// Wait for the DOM to be fully loaded before initializing
document.addEventListener('DOMContentLoaded', initializeApplication);

function initializeApplication() {
    initializeUI();
    setupEventListeners();
    if (pairs.length > 0) {
        updateUIWithPairData(pairs[0]);
    } else {
        console.warn('No pairs available for initial update');
    }
}

function initializeUI() {
    // Initialize any UI elements that need setup
    // For now, this is empty but can be used for future UI initializations
}

function setupEventListeners() {
    const toggleButton = document.getElementById('toggleAutoScan');
    if (toggleButton) {
        toggleButton.addEventListener('click', toggleAutoScan);
    } else {
        console.warn('Auto scan toggle button not found');
    }

    document.getElementById('checkProfitability')?.addEventListener('click', () => checkProfitability());
    document.getElementById('checkbox')?.addEventListener('change', toggleParameterInputs);
}

function toggleAutoScan() {
    const toggleButton = document.getElementById('toggleAutoScan');
    const intervalSelect = document.getElementById('scanInterval');

    isAutoScanning = !isAutoScanning;

    if (isAutoScanning) {
        toggleButton.textContent = 'Stop Auto Scan';
        toggleButton.classList.add('active');
        intervalSelect.disabled = true;
        startAutoScanning();
    } else {
        toggleButton.textContent = 'Start Auto Scan';
        toggleButton.classList.remove('active');
        intervalSelect.disabled = false;
        stopAutoScanning();
    }
}

function startAutoScanning() {
    scanInterval = setInterval(scanNextPair, parseInt(document.getElementById('scanInterval').value));
}

function stopAutoScanning() {
    clearInterval(scanInterval);
}

async function scanNextPair() {
    if (pairs.length === 0) {
        console.warn('No pairs available to scan');
        return;
    }
    const pair = pairs[currentPairIndex];
    try {
        await updateUIWithPairData(pair);
    } catch (error) {
        console.error('Error in scanNextPair:', error);
    }
    currentPairIndex = (currentPairIndex + 1) % pairs.length;
}

async function updateUIWithPairData(pair) {
    try {
        const [asset, currency] = pair.split('/');
        const interval = document.querySelector('#interval').value;
        const period = document.getElementById('period').value;
        const response = await fetch(`/scan/${asset}/${currency}?interval=${interval}&period=${period}`);

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();

        console.log('Received data:', data);

        if (!data) {
            throw new Error('No data received from server');
        }

        // Update UI with the received data
        updateElementValue('#chooseAsset', pair);
        //updateElementText('price', data.assetPrice);
        //updateElementText('assetName', data.name?.toUpperCase());

        const resultText = data.bullFlag?.patternFound ? 'Bull Flag Detected' :
            (data.bearFlag?.patternFound ? 'Bear Flag Detected' : `No Flag Detected for: ${data.name} / ${currency}`);
        updateElementText('flagResult', resultText);

        if (data) {
            checkProfitability(data);
        }
    } catch (error) {
        console.error('Error fetching pair data:', error);
        updateElementText('flagResult', 'Error fetching data');
    }
}

// Helper function to safely update element text content
function updateElementText(id, text) {
    const element = document.getElementById(id);
    if (element) {
        element.textContent = text ?? 'N/A';
    } else {
        console.warn(`Element with id '${id}' not found`);
    }
}

// Helper function to safely update element value
function updateElementValue(selector, value) {
    const element = document.querySelector(selector);
    if (element) {
        element.value = value;
    } else {
        console.warn(`Element with selector '${selector}' not found`);
    }
}

async function checkProfitability(data) {
    console.log('Check profitability clicked');

    const chooseAsset = document.getElementById('chooseAsset').value;
    const [asset2, pair] = chooseAsset.split('/');
    const formula = document.getElementById('formula').value;

    if (!asset2 || !pair) {
        return displayError("Please select a valid asset pair");
    }

    try {
        const requestBody = buildRequestBody(asset2, formula, pair);
        const response = await fetchData('/check-profitability', requestBody);
        await processResponse(response);
    } catch (error) {
        console.error("Error:", error);
        displayError(error.message);
    }

    if (data && data.bullFlag) {
        updateElementText('profitable', 'The asset is likely to ' + (data.bullFlag.patternFound ? 'increase' : 'decrease') + ' in price!');
    }
}

function buildRequestBody(asset2, formula, pair) {
    const requestBody = { cryptoAsset: asset2, formulaType: formula, pair: pair };

    if (!document.getElementById('interval').disabled && !document.getElementById('period').disabled) {
        requestBody.interval = document.getElementById('interval').value;
        requestBody.period = document.getElementById('period').value;
    }

    return requestBody;
}

async function fetchData(url, body) {
    const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    if (!response.ok) {
        throw new Error('Server returned an error: ' + await response.text());
    }
    return response.json();
}

async function processResponse(data) {
    console.log("Show Data:", data);
    if (Array.isArray(data) && data.length >= 2) {
        const prediction = data[0].isProfitable;
        updateDisplays(data[1]);
        updateResultMessage(prediction, data[0]);
    } else {
        throw new Error('Unexpected server response format');
    }
}

function updateDisplays(data) {
    updateElementText('assetName', data.name.toUpperCase());
    updateElementText('assetPriceDisplay', data.assetPrice);
    updateElementText('rsiValue', data.rsiValue);
    updateElementText('volumeValue', data.volumeValue);
    updateElementText('fibonacciValue', data.fibonValue);
    updateElementText('emaValue', data.emaValue);
    updateElementText('bollingerValue', data.bollValue);
    updateElementText('macdValue', data.MacdValue);
}

function updateResultMessage(prediction, data) {
    console.log(prediction);
    let resultText;
    switch (prediction) {
        case 'rise':
            resultText = "The asset is likely to increase in price!";
            break;
        case 'fall':
            resultText = "The asset is likely to decrease in price!";
            break;
        case false:
            resultText = `${data.theError}`;
            break;
        case 'neutral':
            resultText = "The asset's price movement is uncertain.";
            break;
        case true:
            resultText = `Bearflag pattern exist with price target of ${data.flagPrice} and flag pole height of ${data.flagHeight}`;
            break;
        default:
            resultText = "The asset's price movement is uncertain.";
            break;
    }
    updateElementText('result', resultText);
}

function displayError(message) {
    updateElementText('result', message);
}

function toggleParameterInputs(event) {
    const isChecked = event.target.checked;
    document.querySelectorAll('.params').forEach(item => item.disabled = !isChecked);
}