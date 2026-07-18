document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.capture-weight-button').forEach(button => {
        button.addEventListener('click', function() {
            let transactionId = this.getAttribute('data-transaction-id');
            let url = transactionId
                ? `/SL_Weighbridge/transaction/capture-weight/?transaction_id=${transactionId}`
                : `/SL_Weighbridge/transaction/capture-weight/`; // Handle new records

            fetch(url)
                .then(response => response.json())
                .then(data => {
                    if (data.success) {
                        alert(data.message);
                        document.querySelector('#id_gross_weight').value = data.weight;
                    } else {
                        alert('Failed to capture weight.');
                    }
                })
                .catch(error => {
                    console.error('Error:', error);
                });
        });
    });
});
