<script type="text/javascript">
    // Wait for the DOM to fully load
    document.addEventListener('DOMContentLoaded', function() {
        // Add click event listener to the button
        document.getElementById('capture-weight-button').onclick = function() {
            const weightType = document.getElementById('id_weight_type').value; // Get weight type
            const customerId = document.getElementById('id_customer').value; // Get customer ID
            const vehicleId = document.getElementById('id_vehicle').value; // Get vehicle ID

            // Fetch weight data from the external API
            fetch("http://172.29.45.173:8000/SL_weighbridge/api/get_weight/")
                .then(response => {
                    if (!response.ok) {
                        throw new Error('Network response was not ok');
                    }
                    return response.json(); // Parse JSON data
                })
                .then(data => {
                    const tareWeight = data.tare_weight; // Extract tare weight from API data
                    const currentGrossWeight = data.gross_weight; // Extract current gross weight

                    // Check if the weight type is 'First Weight'
                    if (weightType === 'First Weight') {
                        // Update fields for first weight
                        document.getElementById('id_gross_weight').value = currentGrossWeight; // Update gross weight
                        document.getElementById('id_tare_weight').value = tareWeight; // Update tare weight

                        // Set the current date for gross and tare weight
                        const currentDate = new Date().toISOString().slice(0, 19); // Format date
                        document.getElementById('id_gross_weight_date').value = currentDate; // Set gross weight date
                        document.getElementById('id_tare_weight_date').value = currentDate; // Set tare weight date
                    } 
                    // Check if the weight type is 'Second Weight'
                    else if (weightType === 'Second Weight') {
                        // Fetch the last transaction for the same customer and vehicle
                        fetch(`/admin/SL_weighbridge/get_last_transaction/?customer_id=${customerId}&vehicle_id=${vehicleId}`)
                            .then(response => {
                                if (!response.ok) {
                                    throw new Error('Network response was not ok');
                                }
                                return response.json(); // Parse last transaction data
                            })
                            .then(lastTransaction => {
                                // Update fields with last transaction data
                                document.getElementById('id_gross_weight').value = lastTransaction.gross_weight; // Update gross weight
                                document.getElementById('id_tare_weight').value = tareWeight; // Update tare weight

                                // Set dates for gross and tare weight from last transaction
                                document.getElementById('id_gross_weight_date').value = lastTransaction.gross_weight_date; // Set gross weight date
                                document.getElementById('id_tare_weight_date').value = new Date().toISOString().slice(0, 19); // Set tare weight date
                            })
                            .catch(error => {
                                console.error('Error fetching last transaction:', error); // Log error
                            });
                    }
                })
                .catch(error => {
                    console.error('Error fetching weight:', error); // Log error
                });
        }; // End of onclick function
    }); // End of DOMContentLoaded event listener
</script>
