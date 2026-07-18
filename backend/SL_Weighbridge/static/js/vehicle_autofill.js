document.addEventListener("DOMContentLoaded", function() {
    const vehicleField = document.getElementById("id_vehicle");

    vehicleField.addEventListener("change", function() {
        const vehicleId = vehicleField.value;
        if (vehicleId) {
            fetch(`/SL_Weighbridge/get-recent-transaction/${vehicleId}/`)
                .then(response => response.json())
                .then(data => {
                    if (data.error) {
                        console.error(data.error);
                    } else {
                        // Populate fields with recent transaction data
                        document.getElementById("id_operator").value = data.operator || "";
                        document.getElementById("id_gross_weight").value = data.gross_weight || "";
                        document.getElementById("id_tare_weight").value = data.tare_weight || "";
                        document.getElementById("id_net_weight").value = data.net_weight || "";
                        document.getElementById("id_item").value = data.item_id || "";
                        document.getElementById("id_branch").value = data.branch_id || "";
                        document.getElementById("id_customer").value = data.customer_id || "";
                        document.getElementById("id_charge").value = data.charge || "";
                        // Add more fields if needed
                    }
                })
                .catch(error => console.error("Error fetching transaction data:", error));
        }
    });
});
