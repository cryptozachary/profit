document.getElementById('checkProfitability').addEventListener('click', async () => {
    console.log('clicked')


    const asset = document.getElementById('asset').value;
    const formula = document.getElementById('formula').value;
    const resultElement = document.getElementById('result');

    try {
        if (asset === "") {
            return resultElement.textContent = "Please enter a valid asset ticker symbol"
        }

        const response = await fetch('/check-profitability', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ cryptoAsset: asset, formulaType: formula })
        });

        if (response.ok) {
            const data = await response.json();
            const prediction = data.isProfitable;

            console.log(data)

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
                resultElement.textContent = `Bearflag pattern exist with price target of ${data.bearFlagPrice} and flag pole height of ${data.bearFlagHeight}`
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
