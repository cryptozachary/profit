// Define global variables
const pairs = Array.from(document.querySelector('#chooseAsset').options).map(option => option.value);
console.log('Available pairs:', pairs);
let currentPairIndex = document.getElementById('chooseAsset').selectedIndex
let isAutoScanning = false;
let scanInterval;

// Wait for the DOM to be fully loaded before initializing
document.addEventListener('DOMContentLoaded', initializeApplication);

function initializeApplication() {
    showLoadingScreen();
    initializeUI();
    setupEventListeners();
}

function initializeUI() {
    const pair = pairs[currentPairIndex];
    checkProfitability().then(() => {
        hideLoadingScreen();
    });
}

function showLoadingScreen() {
    const loading = true
    document.getElementById('loadingScreen').style.display = 'flex';
    return loading
}

function hideLoadingScreen() {
    const loading = false
    document.getElementById('loadingScreen').style.display = 'none';
    return loading
}

function setupEventListeners() {
    const toggleButton = document.getElementById('toggleAutoScan');
    toggleButton?.addEventListener('click', toggleAutoScan);

    document.getElementById('checkProfitability')?.addEventListener('click', checkProfitability);
    document.getElementById('checkbox')?.addEventListener('change', toggleParameterInputs);
    document.getElementById('chooseAsset')?.addEventListener('change', updateCurrentPairIndex);
}

function updateCurrentPairIndex() {
    currentPairIndex = document.getElementById('chooseAsset').selectedIndex;
    localStorage.setItem('currentPairIndex', currentPairIndex);
}

function toggleAutoScan() {
    const toggleButton = document.getElementById('toggleAutoScan');
    const intervalSelect = document.getElementById('scanInterval');
    const assetOption = document.getElementById('chooseAsset');
    const formulaOption = document.getElementById('formula');
    const checkBox = document.getElementById('checkbox');

    isAutoScanning = !isAutoScanning;

    if (isAutoScanning) {
        toggleButton.textContent = 'Stop Auto Scan';
        toggleButton.classList.add('active');
        intervalSelect.disabled = true;
        assetOption.disabled = true;
        formulaOption.disabled = true;
        checkBox.disabled = true;
        startAutoScanning();
    } else {
        toggleButton.textContent = 'Start Auto Scan';
        toggleButton.classList.remove('active');
        intervalSelect.disabled = false;
        assetOption.disabled = false;
        formulaOption.disabled = false;
        checkBox.disabled = false;
        stopAutoScanning();
    }
}

function startAutoScanning() {
    const intervalValue = parseInt(document.getElementById('scanInterval').value);

    // Call scanNextPair immediately the first time
    scanNextPair();

    // Then set up the interval for subsequent calls
    scanInterval = setInterval(scanNextPair, intervalValue);
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
    localStorage.setItem('currentPairIndex', currentPairIndex);
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

    if (formula !== "all" && formula !== "7" && formula !== "8") {
        const flagResult = document.getElementById('flagResult')
        flagResult.textContent = ""
    }

    if (!asset2 || !pair) {
        return displayError("Please select a valid asset pair");
    }


    showLoadingScreen(); // Show the loading screen

    try {
        const requestBody = buildRequestBody(asset2, formula, pair);
        const response = await fetchData('/check-profitability', requestBody);
        console.log('data', response);
        await processResponse(response);
        const resultText = response[3].patternData?.flagPattern ? 'Bull Flag Detected' :
            (response[3].patternData?.flagPattern ? 'Bear Flag Detected' : `No Flag Detected for: ${response[1].name}`);
        updateElementText('flagResult', resultText);


    } catch (error) {
        console.error("Error:", error);
        displayError(error.message);
    } finally {
        hideLoadingScreen()
    }

    // if (data && data.bullFlag) {
    //     updateElementText('profitable', 'The asset is likely to ' + (data.bullFlag.patternFound ? 'increase' : 'decrease') + ' in price!');
    // }
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
        const theReasons = (data[2] !== null && data[2] !== undefined) ? data[2].reasons : null;
        const theDirection = (data[3] !== null && data[3] !== undefined) ? data[3].targets.predictedDirection : undefined;
        updateDisplays(data[1], data[3]);
        updateResultMessage(prediction, data[0], theReasons, theDirection, data[1])

    } else {
        throw new Error('Unexpected server response format');
    }
}

function updateDisplays(data, data2) {
    updateElementText('assetName', data.name.toUpperCase());
    updateElementText('assetPriceDisplay', data.assetPrice);
    updateElementText('rsiValue', data.rsiValue);
    updateElementText('volumeValue', data.volumeValue);
    updateElementText('fibonacciValue', data.fibonValue);
    updateElementText('emaValue', data.emaValue);
    updateElementText('bollingerValue', data.bollValue);
    updateElementText('macdValue', data.MacdValue);

    if (data2) {
        console.log(data2)
        updateElementText('targetValue', data2.targets.targetPrice);
        updateElementText('percentageValue', data2.targets.priceChangePercentage);
        updateElementText('confidenceValue', data2.targets.confidence);
    }
}

function updateResultMessage(prediction, data, reason, direction, name) {
    console.log(`Prediction: ${prediction} (Type: ${typeof prediction})`);
    console.log(`Direction: ${direction} (Type: ${typeof direction})`);
    console.log(`Name: ${name.name}`);
    let resultText;

    switch (prediction) {
        case false:
            resultText = `${data.theError} `;
            break;
        case true:
            resultText = `Flag pattern exists with a price target of ${data.flagPrice} and flag pole height of ${data.flagHeight} `;
            break;
        case 'rise':
        case 'fall':
        case 'neutral':
            resultText = `${name.name} - ${prediction} in price!`;
            if (reason) {
                for (let i = 0; i < reason.length - 1; i++) {  // Changed loop condition to include the last element
                    resultText += ` ${reason[i].reason}.`;
                }
            };
            break;
        default:
            resultText = `${name.name} price movement is uncertain. Default Prediction.`;
            break;
    }

    console.log(`Result text after prediction switch: ${resultText}`);

    // if (direction) {
    //     switch (direction) {
    //         case 'rise':
    //         case 'fall':
    //         case 'neutral':
    //             resultText = `${name.name} - ${direction} in price!`;
    //             if (reason) {
    //                 for (let i = 0; i < reason.length - 1; i++) {  // Same change as above
    //                     resultText += ` ${reason[i].reason}.`;
    //                 }
    //             };
    //             break;
    //         default:
    //             resultText = `${name.name} price movement is uncertain. Default Direction.`;
    //             break;
    //     }
    // }
    console.log(`Final result text: ${resultText}`);
    updateElementText('result', resultText);
}


function displayError(message) {
    updateElementText('result', message);
}

function toggleParameterInputs(event) {
    const isChecked = event.target.checked;
    document.querySelectorAll('.params').forEach(item => item.disabled = !isChecked);
}