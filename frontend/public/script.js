// Add event listeners for user interactions
document.getElementById('checkProfitability').addEventListener('click', checkProfitability);
document.getElementById('checkbox').addEventListener('change', toggleParameterInputs);

// Function to handle the 'checkProfitability' button click
async function checkProfitability() {
    console.log('Check profitability clicked');

    // Retrieve input values from the DOM
    const asset = document.getElementById('asset').value;
    const formula = document.getElementById('formula').value;
    const chooseAsset = document.getElementById('chooseAsset').value;
    const [asset2, pair] = chooseAsset.split('/');


    // Validate asset input
    if (asset.trim() === "") {
        return displayError("Please enter a valid asset ticker symbol");
    }

    try {
        // Build the request body with necessary parameters
        const requestBody = buildRequestBody(asset2, formula, pair);
        // Send the request and process the response
        const response = await fetchData('/check-profitability', requestBody);
        await processResponse(response);
    } catch (error) {
        console.error("Error:", error);
        displayError(error)
    }
}

// Constructs the request body with user inputs and additional required params
function buildRequestBody(asset2, formula, pair) {
    const requestBody = { cryptoAsset: asset2, formulaType: formula, pair: pair };

    // Include interval and period in the request if they are enabled
    if (!document.getElementById('interval').disabled && !document.getElementById('period').disabled) {
        requestBody.interval = document.getElementById('interval').value;
        requestBody.period = document.getElementById('period').value;
    }

    return requestBody;
}

// Function to fetch data from the server
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

// Process server response and update the UI accordingly
async function processResponse(data) {
    console.log(data)
    const prediction = data[0].isProfitable;
    updateDisplays(data[1]);
    updateResultMessage(prediction, data[0]);
}

// Update display elements with the data received from the server
function updateDisplays(data) {
    document.getElementById('assetName').textContent = data.name.toUpperCase();
    document.getElementById('assetPriceDisplay').textContent = data.assetPrice;
    document.getElementById('rsiValue').textContent = data.rsiValue;
    document.getElementById('volumeValue').textContent = data.volumeValue;
    document.getElementById('fibonacciValue').textContent = data.fibonValue;
    document.getElementById('emaValue').textContent = data.emaValue;
    document.getElementById('bollingerValue').textContent = data.bollValue;
    document.getElementById('macdValue').textContent = data.MacdValue;
}

// Determine and display the appropriate result message based on the prediction
function updateResultMessage(prediction, data) {
    console.log(prediction)
    const resultElement = document.getElementById('result');
    switch (prediction) {
        case 'rise':
            resultElement.textContent = "The asset is likely to increase in price!";
            break;
        case 'fall':
            resultElement.textContent = "The asset is likely to decrease in price!";
            break;
        case false:
            resultElement.textContent = `${data.theError}`;
            break;
        case 'neutral':
            resultElement.textContent = "The asset's price movement is uncertain.";
            break;
        case true:
            resultElement.textContent = `Bearflag pattern exist with price target of ${data.bearFlagPrice} and flag pole height of ${data.bearFlagHeight}`;
            break;
        default:
            resultElement.textContent = "The asset's price movement is uncertain.";
            break;
    }
}

// Display an error message in the result display area
function displayError(message) {
    document.getElementById('result').textContent = message;
}

// Enable or disable parameter inputs based on checkbox state
function toggleParameterInputs(event) {
    const isChecked = event.target.checked;
    document.querySelectorAll('.params').forEach(item => item.disabled = !isChecked);
}
