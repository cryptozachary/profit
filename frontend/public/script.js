// Define global variables
const pairs = Array.from(document.querySelector('#chooseAsset').options).map(option => option.value);
console.log('Available pairs:', pairs);
let currentPairIndex = document.getElementById('chooseAsset').selectedIndex
let isAutoScanning = false;
let scanInterval;

// Define functions outside of DOMContentLoaded
function loadSavedSettings() {
    const savedSettings = localStorage.getItem('cryptoAppSettings');
    if (savedSettings) {
        const settings = JSON.parse(savedSettings);

        // Apply saved settings to form elements
        document.getElementById('theme').value = settings.theme;
        document.getElementById('exchange').value = settings.exchange;
        document.getElementById('refreshRate').value = settings.refreshRate;
        document.getElementById('notifications').checked = settings.notifications;
        document.getElementById('customIndicator').value = settings.customIndicator;
        document.getElementById('language').value = settings.language;

        // Apply theme
        applyTheme(settings.theme);
    }
}

function applyTheme(theme) {
    if (theme === 'dark') {
        document.body.classList.add('dark-theme');
        document.body.classList.remove('light-theme');
    } else {
        document.body.classList.add('light-theme');
        document.body.classList.remove('dark-theme');
    }
}

function applySettings() {
    const savedSettings = localStorage.getItem('cryptoAppSettings');
    if (savedSettings) {
        const settings = JSON.parse(savedSettings);

        console.log('Using exchange:', settings.exchange);
        console.log('Refresh rate set to:', settings.refreshRate, 'seconds');
        console.log('Notifications:', settings.notifications ? 'enabled' : 'disabled');
        if (settings.customIndicator) {
            console.log('Using custom indicator:', settings.customIndicator);
        }
        console.log('Language set to:', settings.language);

        // You would typically call functions here to actually apply these settings in your app
    }
}

async function saveSettings() {

    const theme = document.getElementById('theme').value;
    const exchange = document.getElementById('exchange').value;
    const refreshRate = document.getElementById('refreshRate').value;
    const notifications = document.getElementById('notifications').checked;
    const customIndicator = document.getElementById('customIndicator').value;
    const language = document.getElementById('language').value

    const settings = {
        theme: theme,
        exchange: exchange,
        refreshRate: refreshRate,
        notifications: notifications,
        customIndicator: customIndicator,
        language: language
    };

    localStorage.setItem('cryptoAppSettings', JSON.stringify(settings));
    applyTheme(settings.theme);

    document.querySelector('.flip-card').classList.remove('flipped');
    alert('Settings saved successfully!');

    // Construct the query string
    const queryString = new URLSearchParams(settings).toString();

    try {
        const response = await fetch(`/save-settings?${queryString}`, {
            method: 'POST'
        });
        const data = await response.json();
        console.log(`thedata:`, data);
    } catch (error) {
        console.error('Error:', error);
    }
}

async function openModal() {
    // Display the modal
    const modal = document.getElementById('logModal');
    modal.style.display = 'block';

    // Close the modal when the close button is clicked
    document.querySelector('.close').addEventListener('click', () => {
        const modal = document.getElementById('logModal');
        modal.style.display = 'none';
    });

    // Refresh logs in the modal
    await refreshLogEntries();

    // Close the modal when clicking outside of the modal content
    window.addEventListener('click', (event) => {
        const modal = document.getElementById('logModal');
        if (event.target == modal) {
            modal.style.display = 'none';
        }
    })
}

async function deleteLogs() {
    const confirmation = confirm('Are you sure you want to delete all logs?');
    if (!confirmation) return;

    try {
        const response = await fetch('/api/logEntries', {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            }
        });

        if (response.ok) {
            alert('All logs deleted successfully');
            // Optionally, refresh the logs or update the UI
        } else {
            console.error('Failed to delete logs');
        }
    } catch (error) {
        console.error('Error:', error);
    }
}

async function refreshLogEntries() {
    try {
        const response = await fetch('/api/getLogs');
        const logs = await response.json();

        const logEntriesContainer = document.getElementById('logEntries');
        const theLogEntry = document.getElementById('log-entry')
        logEntriesContainer.innerHTML = ''; // Clear any previous entries

        if (logs.length === 0) {
            logEntriesContainer.innerHTML = '<p>No logs available.</p>';
        } else {
            logs.forEach(log => {
                const logEntry = document.createElement('div');
                logEntry.className = 'log-entry';
                logEntry.textContent = log.logEntry;
                logEntriesContainer.appendChild(logEntry);
            });
        }
    } catch (error) {
        console.error('Error fetching log entries:', error);
    }
}

// Wait for the DOM to be fully loaded before initializing
document.addEventListener('DOMContentLoaded', initializeApplication);

async function initializeApplication() {
    showLoadingScreen();
    loadSavedSettings();
    applySettings();
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
    const flipCard = document.querySelector('.flip-card');
    const settingsButton = document.getElementById('settingsButton');
    const saveSettingsButton = document.getElementById('saveSettings');
    const themeSelect = document.getElementById('theme');
    const eraseLogButton = document.getElementById('erase-logs')

    saveSettingsButton.addEventListener('click', saveSettings);
    toggleButton?.addEventListener('click', toggleAutoScan);
    eraseLogButton.addEventListener('click', deleteLogs);
    document.getElementById('checkProfitability')?.addEventListener('click', checkProfitability);
    document.getElementById('checkbox')?.addEventListener('change', toggleParameterInputs);
    document.getElementById('chooseAsset')?.addEventListener('change', updateCurrentPairIndex);
    document.getElementById('seeLogs').addEventListener('click', openModal);

    settingsButton.addEventListener('click', function () {
        flipCard.classList.toggle('flipped');
    });

    themeSelect.addEventListener('change', function () {
        applyTheme(this.value);
    });
};

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
    const intervalSelection = document.getElementById('interval');
    const periodSelection = document.getElementById('period');
    const checkProfitabilityButton = document.getElementById('checkProfitability')


    isAutoScanning = !isAutoScanning;

    if (isAutoScanning) {
        toggleButton.textContent = 'Stop Auto Scan';
        toggleButton.classList.add('active');
        intervalSelect.disabled = true;
        assetOption.disabled = true;
        formulaOption.disabled = true;
        checkProfitabilityButton.disabled = true;
        //checkBox.disabled = true;
        //intervalSelection.disabled = true;
        //periodSelection.disabled = true;
        startAutoScanning();
    } else {
        toggleButton.textContent = 'Auto Scan';
        toggleButton.classList.remove('active');
        intervalSelect.disabled = false;
        assetOption.disabled = false;
        formulaOption.disabled = false;
        checkProfitabilityButton.disabled = false;
        //checkBox.disabled = false;
        //intervalSelection.disabled = false;
        //periodSelection.disabled = false;
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
        console.log(`Interval:`, interval, `Period:`, period)
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
        if (response[3]) {
            const resultText = response[3].patternData?.flagPattern ? 'Bull Flag Detected' :
                (response[3].patternData?.flagPattern ? 'Bear Flag Detected' : `No Flag Detected for: ${response[1].name}`);
            updateElementText('flagResult', resultText);
        }

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
    console.log(`requestbody:`, requestBody)
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
        updateDisplays(data[1], data[3], prediction);
        updateResultMessage(prediction, data[0], theReasons, theDirection, data[1])
    } else {
        throw new Error('Unexpected server response format');
    }
}

function updateDisplays(data, data2, data3) {
    let consensusTotals = `${data3} - [Rise:${data.rise}, Fall:${data.fall}, Neutral:${data.neutral}]`;

    updateElementText('assetName', data.name.toUpperCase());
    updateElementText('assetPriceDisplay', data.assetPrice);
    updateElementText('rsiValue', data.rsiValue);
    updateElementText('volumeValue', data.volumeValue);
    updateElementText('fibonacciValue', data.fibonValue);
    updateElementText('emaValue', data.emaValue);
    updateElementText('bollingerValue', data.bollValue);
    updateElementText('macdValue', data.MacdValue);
    updateElementText('targetValue', "N/A");
    updateElementText('percentageValue', "N/A");
    updateElementText('consensusValue', "N/A");
    updateElementText('singularValue', "N/A");

    if (data2) {
        let singularScore = `${data2.targets.predictedDirection} - [Confidence:${data2.targets.confidence}]`;
        console.log(data2)
        updateElementText('targetValue', data2.targets.targetPrice);
        updateElementText('percentageValue', data2.targets.priceChangePercentage);
        //updateElementText('confidenceValue', data2.targets.confidence);
        updateElementText('consensusValue', consensusTotals);
        updateElementText('singularValue', singularScore
        );
    }
}

function updateResultMessage(prediction, data, reason, direction, name) {
    console.log(`Prediction: ${prediction} (Type: ${typeof prediction})`);
    console.log(`Direction: ${direction} (Type: ${typeof direction})`);
    console.log(`Name: ${name.name}`);
    let resultText;
    let theDirection;

    if (prediction !== direction) {
        theDirection = 'neutral'
    }

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
            resultText = `${name.name} - ${theDirection || prediction} in price!`;
            if (reason) {
                for (let i = 0; i < reason.length - 1; i++) {
                    resultText += ` ${reason[i].reason}. `;
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