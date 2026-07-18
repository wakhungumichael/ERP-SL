document.addEventListener("DOMContentLoaded", function() {
    const vehicleField = document.getElementById("id_vehicle");

    vehicleField.addEventListener("change", function() {
        const vehicleId = this.value;
        if (vehicleId) {
            fetch(`/admin/SL_Weighbridge/transaction/fetch-previous-transaction/?vehicle_id=${vehicleId}`)
                .then(response => response.json())
                .then(data => {
                    if (!data.error) {
                        // Populate fields based on the response data
                        document.getElementById("id_gross_weight").value = data.gross_weight || "";
                        document.getElementById("id_tare_weight").value = data.tare_weight || "";
                        document.getElementById("id_net_weight").value = data.net_weight || "";
                        document.getElementById("id_item").value = data.item || "";
                        document.getElementById("id_vehicle_type").value = data.vehicle_type || "";
                        document.getElementById("id_status").value = data.status || "";
                        document.getElementById("id_payment_mode").value = data.payment_mode || "";
                        document.getElementById("id_charge").value = data.charge || "";
                        document.getElementById("id_destination").value = data.destination || "";
                    } else {
                        alert(data.error);
                    }
                })
                .catch(error => console.error('Error fetching transaction:', error));
        }
    });
});
