document.addEventListener('DOMContentLoaded', function () {
    const vehicleSelect = document.querySelector('#id_vehicle');

    if (!vehicleSelect) return;

    vehicleSelect.addEventListener('change', function () {
        const vehicleId = this.value;
        if (!vehicleId) return;

        fetch(`/admin/transactions/get_first_weight_data/?vehicle_id=${vehicleId}`)
            .then(response => response.json())
            .then(data => {
                if (data.success) {
                    // Populate fields with data
                    document.querySelector('#id_gross_weight').value = data.gross_weight;
                    document.querySelector('#id_gross_weight_date').value = data.gross_weight_date;
                    document.querySelector('#id_net_weight').value = data.net_weight;
                    // Add more fields as needed
                } else {
                    // Clear fields if no data found
                    document.querySelector('#id_gross_weight').value = '';
                    document.querySelector('#id_gross_weight_date').value = '';
                    document.querySelector('#id_net_weight').value = '';
                    // Add more fields as needed
                }
            })
            .catch(error => {
                console.error('Error fetching data:', error);
            });
    });
});
