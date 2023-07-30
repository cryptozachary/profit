document.getElementById('checkProfitability').addEventListener('click', async () => {
    const asset = document.getElementById('asset').value;
    const formula = document.getElementById('formula').value;


    const resultElement = document.getElementById('result');
    if (data.isProfitable === 'rise') {
        resultElement.textContent = "The asset is likely to increase in price!";
    } else if (data.isProfitable === 'fall') {
        resultElement.textContent = "The asset is likely to decrease in price!";
    } else {
        resultElement.textContent = "The asset's price movement is uncertain.";
    }

    try {
        const response = await fetch('/check-profitability', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ asset, formula })
        });
        const data = await response.json();

        const resultElement = document.getElementById('result');
        if (data.isProfitable) {
            resultElement.textContent = "The asset is likely to increase in price!";
        } else {
            resultElement.textContent = "The asset is likely to decrease in price!";
        }
    } catch (error) {
        console.error("Error:", error);
    }
});
