document.getElementById('checkProfitability').addEventListener('click', async () => {
    console.log('clicked');

    const asset = document.getElementById('asset').value;
    const formula = document.getElementById('formula').value;
    const resultElement = document.getElementById('result');
    const intervalElement = document.getElementById('interval');
    const periodElement = document.getElementById('period');
    const assetNameDisplay = document.getElementById('assetName');
    const assetPriceDisplay = document.getElementById('assetPriceDisplay');
    const rsiValueDisplay = document.getElementById('rsiValue');
    const volumeValueDisplay = document.getElementById('volumeValue');
    const fibonacciValueDisplay = document.getElementById('fibonacciValue');
    const emaValueDisplay = document.getElementById('emaValue');
    const bollingerValueDisplay = document.getElementById('bollingerValue');
    const macdValueDisplay = document.getElementById('macdValue');


    try {
        if (asset === "") {
            return resultElement.textContent = "Please enter a valid asset ticker symbol";
        }

        // Check if the selected formula requires interval and period
        const formulasRequiringParams = ["formula1", "formula2"];

        let requestBody = { cryptoAsset: asset, formulaType: formula };

        if (!intervalElement.disabled && !periodElement.disabled) {
            requestBody.interval = intervalElement.value;
            requestBody.period = periodElement.value;
            console.log(`Interval: ${intervalElement.value}, Period: ${periodElement.value}`);
        }

        const response = await fetch('/check-profitability', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(requestBody)
        });


        if (response.ok) {
            const data = await response.json();
            const prediction = data[0].isProfitable;

            console.log(data)

            assetNameDisplay.textContent = data[1].name.toUpperCase()
            assetPriceDisplay.textContent = data[1].assetPrice;
            rsiValueDisplay.textContent = data[1].rsiValue;
            volumeValueDisplay.textContent = data[1].volumeValue
            fibonacciValueDisplay.textContent = data[1].fibonValue
            emaValueDisplay.textContent = data[1].emaValue
            bollingerValueDisplay.textContent = data[1].bollValue
            macdValueDisplay.textContent = data[1].MacdValue

            if (prediction === 'rise') {
                resultElement.textContent = "The asset is likely to increase in price!";
            }

            if (prediction === 'fall') {
                resultElement.textContent = "The asset is likely to decrease in price!";
            }

            if (prediction === false) {
                resultElement.textContent = "Bear Flag does not exist"
            }

            if (prediction === 'neutral') {
                resultElement.textContent = "The asset's price movement is uncertain.";
            }

            if (prediction === true) {
                resultElement.textContent = `Bearflag pattern exist with price target of ${data[0].bearFlagPrice} and flag pole height of ${data[0].bearFlagHeight}`
            }

            // if (!prediction || (prediction !== 'rise' && prediction !== 'fall')) {
            //     resultElement.textContent = "The asset's price movement is uncertain.";
            // }

        } else {
            console.error('Server returned an error:', await response.text());
        }

    } catch (error) {
        console.error("Error:", error);
    }
});

document.getElementById('checkbox').addEventListener('change', (event) => {
    let checkbox = document.querySelector('#checkbox')
    let parameters = document.querySelectorAll('.params')
    if (checkbox.checked) {
        parameters.forEach(item => {
            item.disabled = false;
        });
    } else {
        parameters.forEach(item => {
            item.disabled = true;
        });
    }
    //     const formulasRequiringParams = ["formula1", "formula2"]; // Replace with actual formulas requiring these parameters
    //     const formulaParametersDiv = document.getElementById('formulaParameters');

    //     if (formulasRequiringParams.includes(event.target.value)) {
    //         formulaParametersDiv.style.display = 'block';
    //     } else {
    //         formulaParametersDiv.style.display = 'none';
    //     }
});