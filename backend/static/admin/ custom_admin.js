document.addEventListener("DOMContentLoaded", function() {
    const vehicleSelect = document.querySelector("#id_vehicle");
    const operatorField = document.querySelector("#id_operator");
    const itemField = document.querySelector("#id_item");
    const vehicleTypeField = document.querySelector("#id_vehicle_type");

    if (vehicleSelect && operatorField && itemField && vehicleTypeField) {
        vehicleSelect.addEventListener("change", function() {
            const vehicleId = this.value;

            if (vehicleId) {
                // Debugging: Log vehicleId to check if correct value is selected
                console.log("Selected Vehicle ID:", vehicleId);

                fetch(`/admin/get-vehicle-details/${vehicleId}/`)
                    .then(response => {
                        if (!response.ok) {
                            throw new Error('Failed to fetch vehicle details');
                        }
                        return response.json();
                    })
                    .then(data => {
                        // Debugging: Log the data returned from server
                        console.log("Vehicle details data:", data);

                        if (data.success) {
                            operatorField.value = data.operator || '';
                            itemField.value = data.item || '';
                            vehicleTypeField.value = data.vehicle_type || '';
                        } else {
                            clearFields();
                        }
                    })
                    .catch(error => {
                        console.error('Error fetching vehicle details:', error);
                        alert("Could not retrieve vehicle details. Please try again.");
                        clearFields();
                    });
            } else {
                clearFields();
            }
        });
    } else {
        console.warn("Some fields are missing in the DOM.");
    }

    function clearFields() {
        operatorField.value = '';
        itemField.value = '';
        vehicleTypeField.value = '';
    }
});
